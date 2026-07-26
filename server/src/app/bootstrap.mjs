import express from 'express'
import { createServer } from 'http'
import { resolve } from 'path'
import { agent } from '../agent/agent-client.mjs'
import { coordinator } from '../agent/coordinator.mjs'
import { config } from '../core/config.mjs'
import { conversationSync } from '../conversation/conversation-sync.mjs'
import { IdentityManager } from '../core/identity.mjs'
import { FrontendMemoryStore } from '../conversation/frontend-memory.mjs'
import { ProfiledMemoryStore } from '../conversation/profiled-memory-store.mjs'
import { UserProfile } from '../conversation/user-profile.mjs'
import { enforceSameOrigin } from '../core/request-security.mjs'
import { attachRealtimeGateway } from '../voice/realtime-gateway.mjs'
import { describeActiveRealtime } from '../voice/realtime-provider.mjs'
import { taskManager, taskStore } from '../task/task-manager.mjs'
import { webDistributionPath } from '../core/install-paths.mjs'

const identityManager = new IdentityManager({
  secret: config.authSecret,
  mode: config.identityMode,
  personalOwnerId: config.personalOwnerId,
})
taskManager.configureRetention({
  terminalTtlMs: config.taskTerminalTtlMs,
  pendingNotificationTtlMs: config.taskPendingNotificationTtlMs,
  notificationClaimTtlMs: config.taskNotificationClaimTtlMs,
  maxTerminalTasksPerOwner: config.maxTerminalTasksPerOwner,
})
conversationSync.configureRetention({
  sessionTtlMs: config.conversationSessionTtlMs,
  maxSessions: config.maxConversationSessions,
})
const dynamicMemory = new FrontendMemoryStore({
  filePath: config.frontendMemoryPath,
  maxOwners: config.maxFrontendMemoryOwners,
  ownerTtlMs: config.frontendMemoryOwnerTtlMs,
})
const frontendMemory = new ProfiledMemoryStore({
  memoryStore: dynamicMemory,
  userProfile: config.identityMode === 'personal'
    ? new UserProfile({ filePath: config.userProfilePath })
    : null,
})
const app = express()

app.disable('x-powered-by')
app.use(enforceSameOrigin)
app.use((req, res, next) => {
  req.identity = identityManager.resolveHttp(req, res)
  next()
})
app.use(express.json({ limit: '1mb' }))

let realtimeGateway

app.get('/api/health', async (req, res) => {
  const backend = await agent.health()
  const backendDescription = agent.describe()
  const realtime = describeActiveRealtime()
  res.status(backend.ok ? 200 : 503).json({
    ok: backend.ok,
    voiceConfigured: realtime.configured,
    realtimeProvider: realtime.provider,
    realtimeLabel: realtime.label,
    realtimeModel: realtime.model,
    realtimeInputSampleRate: realtime.inputSampleRate,
    announceIntoContext: config.announceIntoContext,
    resultContextMaxChars: config.resultContextMaxChars,
    announcementBatchMs: config.announcementBatchMs,
    announcementQuietMs: config.announcementQuietMs,
    frontendMemory: frontendMemory.health(),
    taskStore: taskStore.health(),
    identityMode: config.identityMode,
    voiceClients: realtimeGateway?.status() || {
      connected: 0,
      activeOwners: 0,
      byType: {},
    },
    backend: {
      ...backendDescription,
      ...backend,
    },
  })
})

app.get('/api/backend/ui', async (req, res, next) => {
  if (agent.protocol !== 'openclaw') {
    try {
      return res.redirect(302, await agent.uiUrl({
        ownerId: req.identity.ownerId,
      }))
    } catch (error) {
      return next(error)
    }
  }
  const dashboard = new URL(config.openClawBaseUrl)
  const gateway = new URL(config.openClawBaseUrl)
  gateway.protocol = gateway.protocol === 'https:' ? 'wss:' : 'ws:'
  gateway.pathname = '/'
  gateway.search = ''
  gateway.hash = ''
  const settings = new URLSearchParams({ gatewayUrl: gateway.toString() })
  if (config.openClawToken) settings.set('token', config.openClawToken)
  dashboard.pathname = '/'
  dashboard.search = ''
  dashboard.hash = settings.toString()
  res.redirect(302, dashboard.toString())
})

app.get('/api/tasks', (req, res) => {
  res.json({
    tasks: taskManager.list({
      ownerId: req.identity.ownerId,
      sessionId: req.query.sessionId,
      active: req.query.active === 'true',
    }),
  })
})

app.get('/api/timeline', (req, res) => {
  const items = taskManager.list({
    ownerId: req.identity.ownerId,
    sessionId: req.query.sessionId,
  })
    .filter(task => task.resultMetadata?.presentation?.inline?.content)
    .map(task => ({
      id: `inline_${task.id}`,
      taskId: task.id,
      turnId: task.turnId || null,
      createdAt: task.completedAt || task.createdAt,
      ...task.resultMetadata.presentation.inline,
    }))
    .sort((left, right) => left.createdAt - right.createdAt)
  res.json({ items })
})

app.get('/api/tasks/:id', (req, res) => {
  const task = taskManager.get(req.params.id, { ownerId: req.identity.ownerId })
  if (!task) return res.status(404).json({ error: 'task not found' })
  res.json(task)
})

app.delete('/api/tasks/:id', (req, res) => {
  const existing = taskManager.get(req.params.id, {
    ownerId: req.identity.ownerId,
  })
  if (!existing) return res.status(404).json({ error: 'task not found' })
  const task = taskManager.cancel(req.params.id, {
    ownerId: req.identity.ownerId,
  })
  if (!task) {
    return res.status(409).json({
      error: 'task is no longer active',
      task: existing,
    })
  }
  res.json(task)
})

app.get('/api/tasks/:id/events', (req, res) => {
  const task = taskManager.get(req.params.id, { ownerId: req.identity.ownerId })
  if (!task) return res.status(404).json({ error: 'task not found' })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  const write = event => res.write(`data: ${JSON.stringify(event)}\n\n`)
  write({ type: 'task.snapshot', task })
  const unsubscribe = taskManager.subscribe(event => {
    if (event.ownerId === req.identity.ownerId && event.task.id === req.params.id) {
      write({ type: event.type, task: event.task })
    }
  })
  res.on('close', unsubscribe)
})

const webDist = webDistributionPath()
app.use(express.static(webDist))
app.get('*', (req, res) => res.sendFile(resolve(webDist, 'index.html')))

const server = createServer(app)
realtimeGateway = attachRealtimeGateway(server, {
  identityManager,
  memoryStore: frontendMemory,
  coordinator,
  coordinatorAvailable: async () => (await agent.health()).ok === true,
})
server.listen(config.port, config.host, () => {
  console.log(`qwen-audio-agent running at http://${config.host}:${config.port}`)
})
