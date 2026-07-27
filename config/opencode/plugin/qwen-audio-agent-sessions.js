import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"

const BACKEND_AGENT = "qwen-audio-agent-backend"
const MANAGED_TOOL_NAMES = [
  "qwen_audio_agent_sessions_list",
  "qwen_audio_agent_session_start",
  "qwen_audio_agent_session_send",
  "qwen_audio_agent_session_status",
  "qwen_audio_agent_session_cancel",
]
const MAX_STATUS_RESULT_CHARS = 12_000

function unwrap(response, action) {
  if (response?.error) {
    const detail = response.error?.message || JSON.stringify(response.error)
    throw new Error(`${action}失败：${detail}`)
  }
  return response?.data ?? response
}

function requireBackendAgent(context) {
  if (context.agent !== BACKEND_AGENT) {
    throw new Error("这些会话控制工具只允许 qwen-audio-agent 后台 Agent 使用。")
  }
}

function taskDirectory(context, requested) {
  const value = String(requested || "").trim()
  return value
    ? path.resolve(context.directory, value)
    : context.directory
}

function configuredModel() {
  const value = String(process.env.OPENCODE_MODEL || "").trim()
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  return {
    providerID: value.slice(0, slash),
    modelID: value.slice(slash + 1),
  }
}

function taskAgent() {
  return String(process.env.OPENCODE_TASK_AGENT || "build").trim() || "build"
}

function disabledManagementTools() {
  return Object.fromEntries(MANAGED_TOOL_NAMES.map(name => [name, false]))
}

function responseText(message) {
  return (message?.parts || [])
    .filter(part => part?.type === "text")
    .map(part => part.text || "")
    .join("\n")
    .trim()
}

function latestAssistant(messages) {
  return [...(messages || [])].reverse().find(message => (
    message?.info?.role === "assistant"
  ))
}

function publicSession(session, statuses = {}) {
  return {
    session_id: session.id,
    title: session.title,
    directory: session.directory,
    agent: session.agent || null,
    state: statuses?.[session.id]?.type || "idle",
    updated_at: session.time?.updated || session.time?.created || null,
    managed_by_qwen_audio_agent: session.metadata?.qwen_audio_agent_managed === true,
  }
}

function routingMetadata(session, context, runId) {
  return {
    ...(session?.metadata || {}),
    qwen_audio_agent_managed: true,
    qwen_audio_agent_delivery_pending: true,
    qwen_audio_agent_run_id: runId,
    qwen_audio_agent_run_started_at: Date.now(),
    qwen_audio_agent_backend_session_id: context.sessionID,
    qwen_audio_agent_backend_directory: context.directory,
  }
}

function taskSystemPrompt() {
  return [
    "You are working in a normal OpenCode chat on a task delegated by the qwen-audio-agent backend Agent.",
    "Complete the supplied request using the normal OpenCode agent and project context.",
    "Return a concrete, verifiable final result for the backend Agent.",
    "Do not create or control qwen-audio-agent sessions.",
    "Do not open browsers, image viewers, files, or desktop applications unless the user explicitly requested opening or previewing the result.",
  ].join("\n")
}

async function markPending(client, session, context, directory) {
  const runId = randomUUID()
  const response = await client.session.update({
    path: { id: session.id },
    query: { directory },
    body: {
      metadata: routingMetadata(session, context, runId),
    },
  })
  return {
    session: unwrap(response, "记录任务路由"),
    runId,
  }
}

async function sendAsync(client, session, context, directory, prompt) {
  const { session: updated, runId } = await markPending(
    client,
    session,
    context,
    directory,
  )
  try {
    await unwrap(await client.session.promptAsync({
      path: { id: session.id },
      query: { directory },
      body: {
        ...(configuredModel() ? { model: configuredModel() } : {}),
        agent: session.agent || taskAgent(),
        system: taskSystemPrompt(),
        tools: disabledManagementTools(),
        parts: [{ type: "text", text: String(prompt) }],
      },
    }), "发送任务")
  } catch (error) {
    await client.session.update({
      path: { id: session.id },
      query: { directory },
      body: {
        metadata: {
          ...(updated.metadata || {}),
          qwen_audio_agent_delivery_pending: false,
          qwen_audio_agent_last_error: error.message,
        },
      },
    }).catch(() => {})
    throw error
  }
  return { runId }
}

async function listDirectorySessions(client, directory, query) {
  const [sessionResponse, statusResponse] = await Promise.all([
    client.session.list({ query: { directory } }),
    client.session.status({ query: { directory } }),
  ])
  const sessions = unwrap(sessionResponse, "列出 OpenCode 会话")
  const statuses = unwrap(statusResponse, "读取 OpenCode 会话状态")
  const needle = String(query || "").trim().toLowerCase()
  return sessions
    .filter(session => !session.parentID)
    .filter(session => !["backend", "coordinator"].includes(
      session.metadata?.qwen_audio_agent_role,
    ))
    .filter(session => (
      !needle
      || String(session.title || "").toLowerCase().includes(needle)
      || String(session.directory || "").toLowerCase().includes(needle)
    ))
    .sort((left, right) => (
      Number(right.time?.updated || right.time?.created || 0)
      - Number(left.time?.updated || left.time?.created || 0)
    ))
    .map(session => publicSession(session, statuses))
}

async function listTopLevelSessions(client, context, args) {
  const explicitDirectory = String(args.directory || "").trim()
  let directories
  if (explicitDirectory) {
    directories = [taskDirectory(context, explicitDirectory)]
  } else {
    const projects = unwrap(
      await client.project.list(),
      "列出 OpenCode 项目",
    )
    directories = [
      context.directory,
      ...projects.map(project => project.worktree),
    ]
  }
  const groups = await Promise.all(
    [...new Set(directories.filter(Boolean))].map(async directory => (
      listDirectorySessions(client, directory, args.query).catch(() => [])
    )),
  )
  const sessions = groups.flat()
    .filter((session, index, all) => (
      all.findIndex(candidate => candidate.session_id === session.session_id)
      === index
    ))
    .sort((left, right) => (
      Number(right.updated_at || 0) - Number(left.updated_at || 0)
    ))
  return sessions.slice(0, args.limit || 20)
}

export const QwenAudioAgentSessionsPlugin = async ({ client }) => ({
  tool: {
    qwen_audio_agent_sessions_list: tool({
      description: "列出普通顶层 OpenCode Chat，用于定位用户已有项目或独立任务。不要向用户暴露 Session ID。",
      args: {
        query: tool.schema.string().optional().describe("标题或目录关键词"),
        directory: tool.schema.string().optional().describe("项目目录；省略时使用当前项目"),
        limit: tool.schema.number().int().min(1).max(50).optional().describe("最多返回数量"),
      },
      async execute(args, context) {
        requireBackendAgent(context)
        return JSON.stringify(await listTopLevelSessions(client, context, args))
      },
    }),

    qwen_audio_agent_session_start: tool({
      description: "创建一个普通顶层 OpenCode Chat 并在后台开始独立任务。仅用于用户明确要求新任务、新项目、隔离上下文或持续独立运行的工作。",
      args: {
        title: tool.schema.string().min(1).describe("给 OpenCode UI 显示的简短标题"),
        prompt: tool.schema.string().min(1).describe("忠实、完整、自包含的任务要求"),
        directory: tool.schema.string().optional().describe("目标项目目录；可以是尚未创建的新目录"),
      },
      async execute(args, context) {
        requireBackendAgent(context)
        const directory = taskDirectory(context, args.directory)
        await mkdir(directory, { recursive: true })
        const created = unwrap(await client.session.create({
          query: { directory },
          body: {
            title: args.title,
            agent: taskAgent(),
            ...(configuredModel()
              ? {
                  model: {
                    providerID: configuredModel().providerID,
                    id: configuredModel().modelID,
                  },
                }
              : {}),
            metadata: {
              qwen_audio_agent_managed: true,
              qwen_audio_agent_delivery_pending: false,
              qwen_audio_agent_backend_session_id: context.sessionID,
              qwen_audio_agent_backend_directory: context.directory,
            },
          },
        }), "创建 OpenCode 会话")
        const { runId } = await sendAsync(
          client,
          created,
          context,
          directory,
          args.prompt,
        )
        return JSON.stringify({
          status: "started",
          delegation_id: runId,
          session_id: created.id,
          title: created.title,
          directory: created.directory || directory,
          visible_in_opencode: true,
        })
      },
    }),

    qwen_audio_agent_session_send: tool({
      description: "把新的用户要求发送到已有普通 OpenCode Chat。继续既有工作必须使用原 Session，不得新建同名替代任务。",
      args: {
        session_id: tool.schema.string().min(1).describe("由会话列表或此前工具结果获得的 Session ID"),
        prompt: tool.schema.string().min(1).describe("本次追加的完整要求"),
        directory: tool.schema.string().optional().describe("该 Session 所属项目目录"),
      },
      async execute(args, context) {
        requireBackendAgent(context)
        const directory = taskDirectory(context, args.directory)
        const session = unwrap(await client.session.get({
          path: { id: args.session_id },
          query: { directory },
        }), "读取 OpenCode 会话")
        const { runId } = await sendAsync(
          client,
          session,
          context,
          directory,
          args.prompt,
        )
        return JSON.stringify({
          status: "started",
          delegation_id: runId,
          session_id: session.id,
          title: session.title,
          directory: session.directory || directory,
        })
      },
    }),

    qwen_audio_agent_session_status: tool({
      description: "查询普通 OpenCode Chat 的运行状态和最新结果。仅在用户单独询问既有任务进度或结果时调用；在当前请求中调用 session_start 或 session_send 后严禁轮询。若本工具失败，只能如实报告状态查询失败；不得改用 bash、read、glob、grep 或其他工具扫描目标项目，不得代替目标 Session 重新执行任务。",
      args: {
        session_id: tool.schema.string().min(1),
        directory: tool.schema.string().optional(),
      },
      async execute(args, context) {
        requireBackendAgent(context)
        const directory = taskDirectory(context, args.directory)
        const [sessionResponse, statusResponse, messagesResponse] = await Promise.all([
          client.session.get({
            path: { id: args.session_id },
            query: { directory },
          }),
          client.session.status({ query: { directory } }),
          client.session.messages({
            path: { id: args.session_id },
            query: { directory, limit: 20 },
          }),
        ])
        const session = unwrap(sessionResponse, "读取 OpenCode 会话")
        const statuses = unwrap(statusResponse, "读取 OpenCode 状态")
        const assistant = latestAssistant(
          unwrap(messagesResponse, "读取 OpenCode 消息"),
        )
        return JSON.stringify({
          ...publicSession(session, statuses),
          latest_result:
            responseText(assistant).slice(0, MAX_STATUS_RESULT_CHARS) || null,
        })
      },
    }),

    qwen_audio_agent_session_cancel: tool({
      description: "停止一个正在运行的普通 OpenCode Chat。仅在用户明确要求取消时调用。",
      args: {
        session_id: tool.schema.string().min(1),
        directory: tool.schema.string().optional(),
      },
      async execute(args, context) {
        requireBackendAgent(context)
        const directory = taskDirectory(context, args.directory)
        const response = await client.session.abort({
          path: { id: args.session_id },
          query: { directory },
        })
        return JSON.stringify({
          status: unwrap(response, "取消 OpenCode 会话")
            ? "cancelled"
            : "not_running",
          session_id: args.session_id,
        })
      },
    }),
  },
})

export default QwenAudioAgentSessionsPlugin
