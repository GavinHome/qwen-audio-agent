import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  buildConversationTurns,
  discardUserTranscript,
  finalAssistantContent,
  insertByTurn,
  normalizeTranscript,
  upsertUserTranscript,
} from './message-order.js'
import MessageContent from './MessageContent.jsx'
import DesktopFluidOrb from './DesktopFluidOrb.jsx'
import { resultLabel } from './presentation.js'
import {
  removeDeliveredTask,
  taskDetail,
  taskLabel,
  taskView,
} from './task-view.js'
import useRealtimeVoice from './useRealtimeVoice.js'
import { requestedSessionId } from './session.js'

const desktopOrbMode = (
  new URLSearchParams(window.location.search).get('desktop') === 'orb'
)
const takeoverRequested = (
  new URLSearchParams(window.location.search).get('takeover') === '1'
)

function getSessionId() {
  const requested = requestedSessionId(window.location.search)
  if (requested) {
    localStorage.setItem('qwen-audio-agent.session', requested)
    return requested
  }
  const current = localStorage.getItem('qwen-audio-agent.session')
  if (current) return current
  const created = crypto.randomUUID()
  localStorage.setItem('qwen-audio-agent.session', created)
  return created
}

function labelFor(state) {
  return {
    idle: '待命',
    listening: '正在听',
    thinking: '思考中',
    speaking: '正在说',
    occupied: '其他入口正在使用',
  }[state] || state
}

function OrbControlIcon({ type, muted = false }) {
  if (type === 'microphone') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3m-3 0h6" />
      {muted && <path d="M4 4 20 20" />}
    </svg>
  }
  if (type === 'settings') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2m0 13v2M3.5 12h2m13 0h2M6 6l1.4 1.4m9.2 9.2L18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
    </svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
}

function upsertTask(items, taskId, update, fallback) {
  const index = items.findIndex(item => item.id === taskId)
  if (index < 0) return fallback ? [...items, fallback] : items
  const next = [...items]
  next[index] = update(next[index])
  return next
}

export default function App() {
  const [sessionId, setSessionId] = useState(getSessionId)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [messages, setMessages] = useState([])
  const [activity, setActivity] = useState('正在检查后台 Agent')
  const [frontend, setFrontend] = useState({ label: 'Realtime Agent' })
  const [backend, setBackend] = useState({ label: 'Agent', ready: false })
  const [agentTasks, setAgentTasks] = useState([])
  const [orbDragging, setOrbDragging] = useState(false)
  const activeVoiceResponse = useRef('')
  const currentTurnId = useRef('')
  const responseTurnMap = useRef(new Map())
  const agentTurnIds = useRef(new Set())
  const messagesRef = useRef(null)
  const stickToBottom = useRef(true)
  const orbDrag = useRef(null)
  const suppressOrbClick = useRef(false)

  useLayoutEffect(() => {
    const container = messagesRef.current
    if (container && stickToBottom.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, agentTasks])

  useEffect(() => {
    let cancelled = false
    fetch('api/health')
      .then(async response => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return
        const label = payload.backend?.label || payload.backend?.kind || 'Agent'
        setFrontend({
          label: payload.realtimeLabel || payload.realtimeProvider || 'Realtime Agent',
        })
        setBackend({
          label,
          ready: response.ok && payload.backend?.ok,
          url: payload.backend?.uiPath || payload.backend?.baseUrl || '',
        })
        setActivity(response.ok ? '已连接' : '能力服务尚未连接')
      })
      .catch(() => {
        if (!cancelled) setActivity('qwen-audio-agent Gateway 尚未连接')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateUserTranscript = useCallback((event, final = false) => {
    const id = event.turnId ? `user:${event.turnId}` : crypto.randomUUID()
    setMessages(items => upsertUserTranscript(items, {
        id,
        content: event.content,
        turnId: event.turnId,
        final,
      }))
  }, [])

  const updateVoiceMessage = useCallback((event, final = false) => {
    const responseId = event.responseId || activeVoiceResponse.current
    if (!responseId) return
    activeVoiceResponse.current = responseId
    const id = `voice:${responseId}`
    const trackedTurnId = responseTurnMap.current.get(responseId) || event.turnId || currentTurnId.current
    setMessages(items => {
      const index = items.findIndex(item => item.id === id)
      if (index < 0) return insertByTurn(items, {
          id,
          role: 'assistant',
          content: final
            ? finalAssistantContent(event.content)
            : event.content || '',
          turnId: trackedTurnId,
          taskId: event.taskId,
          taskIds: event.taskIds,
          origin: event.origin,
          deliverySequence: event.deliverySequence,
          live: !final,
      })
      const next = [...items]
      next[index] = {
        ...next[index],
        content: final
          ? finalAssistantContent(event.content, next[index].content)
          : next[index].content + (event.content || ''),
        turnId: trackedTurnId || next[index].turnId,
        taskId: event.taskId || next[index].taskId,
        taskIds: event.taskIds || next[index].taskIds,
        origin: event.origin || next[index].origin,
        deliverySequence: event.deliverySequence || next[index].deliverySequence,
        live: !final,
      }
      return next
    })
  }, [])

  const updateTimelineItem = useCallback(item => {
    if (!item?.content) return
    setMessages(items => {
      const id = `inline:${item.id || item.taskId || crypto.randomUUID()}`
      const existing = items.findIndex(message => message.id === id)
      const message = {
        id,
        role: 'assistant',
        content: item.content,
        title: item.title,
        turnId: item.turnId || currentTurnId.current,
        taskId: item.taskId,
        companion: true,
        final: true,
      }
      if (existing < 0) return insertByTurn(items, message)
      const next = [...items]
      next[existing] = message
      return next
    })
  }, [])

  const onRealtimeEvent = useCallback(event => {
    if (event.type === 'turn.started') {
      currentTurnId.current = event.turnId || ''
      activeVoiceResponse.current = ''
      stickToBottom.current = true
      setActivity('正在听你说')
    }
    if (event.type === 'gateway.disconnected') {
      setActivity('qwen-audio-agent Gateway 已断开，正在重连')
      setAgentTasks(items => items.map(task => (
        ['queued', 'running', 'responding'].includes(task.phase)
          ? { ...task, phase: 'disconnected' }
          : task
      )))
    }
    if (event.type === 'gateway.connected') {
      fetch(`api/tasks?sessionId=${encodeURIComponent(sessionId)}`)
        .then(response => response.ok ? response.json() : Promise.reject())
        .then(payload => {
          const serverTasks = payload.tasks || []
          const byId = new Map(serverTasks.map(task => [task.id, task]))
          setAgentTasks(items => {
            const known = new Set(items.map(task => task.id))
            const reconciled = items.map(task => {
              const current = byId.get(task.id)
              if (current) return taskView(current, task)
              if (task.phase !== 'disconnected') return task
              return {
                ...task,
                phase: 'failed',
                error: '网关重连后未找到这次后台执行，请重新提交。',
              }
            })
            serverTasks
              .filter(task => (
                task.workState === 'active'
                && !known.has(task.id)
              ))
              .reverse()
              .forEach(task => reconciled.push(taskView(task)))
            return reconciled
          })
        })
        .catch(() => {})
      fetch(`api/timeline?sessionId=${encodeURIComponent(sessionId)}`)
        .then(response => response.ok ? response.json() : Promise.reject())
        .then(payload => {
          for (const item of payload.items || []) updateTimelineItem(item)
        })
        .catch(() => {})
    }
    if (event.type === 'voice.deactivated') {
      setVoiceEnabled(false)
      setActivity(`${event.holder?.label || '其他入口'}正在使用语音`)
    }
    if (
      event.type === 'voice.ownership'
      && event.state === 'busy'
      && voiceEnabled
    ) {
      setVoiceEnabled(false)
      setActivity(`${event.holder?.label || '其他入口'}正在使用语音`)
    }
    if (
      event.type === 'voice.ownership'
      && event.state === 'available'
      && !voiceEnabled
    ) {
      setActivity('待命')
    }
    if (event.type === 'voice.state') {
      if (
        event.turnId
        && event.turnId !== currentTurnId.current
        && event.origin === 'model'
      ) return
      if (event.state === 'listening') setActivity('正在听你说')
      if (event.state === 'thinking' && !agentTurnIds.current.has(currentTurnId.current)) {
        setActivity('正在理解')
      }
      if (event.state === 'idle' && !agentTurnIds.current.has(currentTurnId.current)) {
        setActivity('待命')
      }
    }
    if (event.type === 'transcript.delta' && event.role === 'user') {
      updateUserTranscript(event)
    }
    if (event.type === 'transcript.final' && event.role === 'user') {
      updateUserTranscript(event, true)
    }
    if (event.type === 'transcript.discard' && event.role === 'user') {
      setMessages(items => discardUserTranscript(items, event.turnId))
    }
    if (event.type === 'timeline.inline' && event.item?.content) {
      updateTimelineItem(event.item)
    }
    if (event.type === 'response.started') {
      activeVoiceResponse.current = event.responseId
      if (event.turnId) {
        responseTurnMap.current.set(event.responseId, event.turnId)
        if (responseTurnMap.current.size > 100) {
          responseTurnMap.current.delete(responseTurnMap.current.keys().next().value)
        }
      }
      if (
        event.turnId === currentTurnId.current
        && !agentTurnIds.current.has(event.turnId)
      ) {
        setActivity('正在回复')
      }
    }
    if (event.type === 'transcript.delta' && event.role === 'assistant') updateVoiceMessage(event)
    if (event.type === 'transcript.final' && event.role === 'assistant') updateVoiceMessage(event, true)
    if (event.type === 'response.interrupted') {
      const id = `voice:${event.responseId}`
      setMessages(items => items.map(message => (
        message.id === id
          ? { ...message, interrupted: true, live: false }
          : message
      )))
    }
    if (event.type === 'task.accepted') {
      const task = event.task
      if (task.turnId) agentTurnIds.current.add(task.turnId)
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity('正在处理')
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.running') {
      const task = event.task
      if (task.turnId) agentTurnIds.current.add(task.turnId)
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity('正在处理')
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => ({
          ...current,
          elapsedMs: task.elapsedMs || 0,
          phase: 'running',
        }),
        {
          id: task.id,
          objective: task.objective,
          elapsedMs: task.elapsedMs || 0,
          phase: 'running',
          turnId: task.turnId,
        },
      ))
    }
    if (event.type === 'task.progress') {
      const progress = event.task
      if (!progress.turnId || progress.turnId === currentTurnId.current) {
        setActivity(`正在处理 · ${Math.round(progress.elapsedMs / 1000)} 秒`)
      }
      setAgentTasks(items => upsertTask(
        items,
        progress.id,
        task => taskView(progress, task),
        taskView(progress),
      ))
    }
    if (event.type === 'task.completed') {
      const completed = event.task
      if (completed.turnId) agentTurnIds.current.delete(completed.turnId)
      if (!completed.turnId || completed.turnId === currentTurnId.current) {
        setActivity(voiceEnabled ? '正在准备回复' : '处理完成')
      }
      setAgentTasks(items => upsertTask(
        items,
        completed.id,
        task => {
          const next = taskView(completed, task)
          return !voiceEnabled && next.phase === 'responding'
            ? { ...next, phase: 'completed' }
            : next
        },
        (() => {
          const next = taskView(completed)
          return !voiceEnabled && next.phase === 'responding'
            ? { ...next, phase: 'completed' }
            : next
        })(),
      ))
    }
    if (event.type === 'task.notification.delivered') {
      const delivered = event.task
      // Delivery is acknowledged after playback ends. The assistant transcript
      // may already have removed this card, so never upsert it again here.
      setAgentTasks(items => removeDeliveredTask(items, delivered.id))
    }
    if (event.type === 'task.failed') {
      const failed = event.task
      if (failed.turnId) agentTurnIds.current.delete(failed.turnId)
      if (!failed.turnId || failed.turnId === currentTurnId.current) {
        setActivity(`后台失败：${failed.error}`)
      }
      setAgentTasks(items => upsertTask(
        items,
        failed.id,
        task => ({ ...task, phase: 'failed', error: failed.error }),
      ))
    }
    if (event.type === 'task.cancelled') {
      const cancelled = event.task
      if (cancelled.turnId) agentTurnIds.current.delete(cancelled.turnId)
      if (!cancelled.turnId || cancelled.turnId === currentTurnId.current) {
        setActivity('已取消')
      }
      setAgentTasks(items => upsertTask(
        items,
        cancelled.id,
        task => ({ ...taskView(cancelled, task), phase: 'cancelled' }),
        { ...taskView(cancelled), phase: 'cancelled' },
      ))
    }
    if (event.type === 'transcript.final' && event.role === 'assistant') {
      if (event.turnId === currentTurnId.current) setActivity('待命')
      const presentedTaskIds = new Set(
        event.taskIds?.length ? event.taskIds : [event.taskId].filter(Boolean),
      )
      setAgentTasks(items => items.filter(task => (
        !presentedTaskIds.has(task.id)
        || !['responding', 'completed'].includes(task.phase)
      )))
    }
  }, [
    backend.label,
    sessionId,
    updateTimelineItem,
    updateUserTranscript,
    updateVoiceMessage,
    voiceEnabled,
  ])

  const voice = useRealtimeVoice({
    sessionId,
    enabled: voiceEnabled,
    outputMuted: false,
    clientType: desktopOrbMode ? 'desktop' : 'web',
    clientLabel: desktopOrbMode ? '桌面端' : 'WebUI',
    takeover: takeoverRequested,
    onEvent: onRealtimeEvent,
  })
  const visualVoiceState = voice.ownership.state === 'busy'
    ? 'occupied'
    : voice.visualState || voice.state
  const ownershipLabel = voice.ownership.holder?.label

  const resetSession = () => {
    const next = crypto.randomUUID()
    localStorage.setItem('qwen-audio-agent.session', next)
    setSessionId(next)
    setMessages([])
    setAgentTasks([])
    currentTurnId.current = ''
    activeVoiceResponse.current = ''
    responseTurnMap.current.clear()
    agentTurnIds.current.clear()
    setActivity('已创建新会话')
  }

  const enableVoice = () => {
    if (voice.ownership.state === 'busy' && !takeoverRequested) {
      setActivity(`${ownershipLabel || '其他入口'}正在使用语音`)
      return
    }
    if (voice.activateAudio()) setVoiceEnabled(true)
  }

  const turns = useMemo(
    () => buildConversationTurns(messages, agentTasks),
    [messages, agentTasks],
  )

  const beginOrbDrag = event => {
    const bridge = window.qwenAudioAgentDesktop
    if (!desktopOrbMode || event.button !== 0 || !bridge) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    orbDrag.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false,
    }
    suppressOrbClick.current = false
    setOrbDragging(true)
    bridge.dragStart(event.screenX, event.screenY)
  }

  const moveOrb = event => {
    const drag = orbDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (
      Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) >= 4
    ) {
      drag.moved = true
    }
    window.qwenAudioAgentDesktop?.dragMove(event.screenX, event.screenY)
  }

  const endOrbDrag = event => {
    const drag = orbDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    suppressOrbClick.current = drag.moved
    orbDrag.current = null
    setOrbDragging(false)
    window.qwenAudioAgentDesktop?.dragEnd()
  }

  const handleOrbClick = () => {
    if (suppressOrbClick.current) {
      suppressOrbClick.current = false
      return
    }
    if (voice.state === 'speaking') {
      voice.interrupt()
      return
    }
    if (desktopOrbMode && voiceEnabled) {
      setVoiceEnabled(false)
      return
    }
    enableVoice()
  }

  if (desktopOrbMode) {
    return <main className="desktop-orb-shell">
      <section
        className="desktop-orb-stage"
        aria-label={`qwen-audio · ${voice.visualError ? '连接异常' : labelFor(visualVoiceState)}`}
        title={
          voice.error
          || (visualVoiceState === 'occupied' && ownershipLabel
            ? `${ownershipLabel}正在使用语音`
            : labelFor(visualVoiceState))
        }
      >
        <button
          ref={voice.levelElementRef}
          className={[
            'orb',
            'desktop-orb',
            visualVoiceState,
            voiceEnabled ? 'enabled' : 'input-muted',
            voice.visualError ? 'error' : '',
            orbDragging ? 'dragging' : '',
          ].filter(Boolean).join(' ')}
          onClick={handleOrbClick}
          onPointerDown={beginOrbDrag}
          onPointerMove={moveOrb}
          onPointerUp={endOrbDrag}
          onPointerCancel={endOrbDrag}
          aria-label={
            voice.state === 'speaking'
              ? '打断 qwen-audio'
              : voiceEnabled ? '麦克风静音' : '开启麦克风'
          }
        >
          <DesktopFluidOrb />
        </button>
        <nav className="desktop-orb-controls" aria-label="语音控制">
          <button
            className={!voiceEnabled ? 'active' : ''}
            onClick={() => {
              if (voiceEnabled) {
                setVoiceEnabled(false)
                return
              }
              enableVoice()
            }}
            aria-label={voiceEnabled ? '麦克风静音' : '开启麦克风'}
            title={voiceEnabled ? '麦克风静音' : '开启麦克风'}
          >
            <OrbControlIcon type="microphone" muted={!voiceEnabled} />
          </button>
          <button
            onClick={() => window.qwenAudioAgentDesktop?.openSettings()}
            aria-label="设置"
            title="设置"
          >
            <OrbControlIcon type="settings" />
          </button>
          <button
            className="danger"
            onClick={() => window.qwenAudioAgentDesktop?.quit()}
            aria-label="退出"
            title="退出"
          >
            <OrbControlIcon type="close" />
          </button>
        </nav>
      </section>
    </main>
  }

  const renderTask = agentTask => <aside
    key={`task:${agentTask.id}`}
    className={`agent-task ${agentTask.phase}`}
  >
    <span className="task-spinner" aria-hidden="true" />
    <div>
      <b>{taskLabel(agentTask)}</b>
      <small>{taskDetail(agentTask)}</small>
    </div>
    {!['failed', 'disconnected'].includes(agentTask.phase) && <div className="task-controls">
      <time>{Math.max(0, Math.round(agentTask.elapsedMs / 1000))}s</time>
    </div>}
  </aside>

  const renderMessage = message => <article
    key={message.id}
    className={`${message.role}${message.companion ? ' companion' : ''}`}
  >
    <label>{message.role === 'user'
      ? '你'
      : message.companion ? resultLabel(message) : 'qwen-audio'}</label>
    <MessageContent
      role={message.role}
      content={message.content}
      live={message.live}
    />
    {message.interrupted && <small className="interrupted">已打断</small>}
  </article>

  return <main className="app">
    <header>
      <div className="brand"><span>V</span><div>qwen-audio-agent<small>REALTIME VOICE · LIVE</small></div></div>
      <a
        className="backend"
        href={backend.url || undefined}
        target="_blank"
        rel="noreferrer"
        title={backend.url ? `打开 ${backend.label}` : backend.label}
      >
        <i className={backend.ready ? 'ready' : ''} />
        {backend.label}
      </a>
      <div className="status"><i className={visualVoiceState} />{labelFor(visualVoiceState)}</div>
      <button className="ghost" onClick={resetSession}>新会话</button>
      <button
        className={voiceEnabled ? 'voice active' : 'voice'}
        onClick={() => {
          if (voiceEnabled) {
            setVoiceEnabled(false)
            return
          }
          enableVoice()
        }}
      >
        {voiceEnabled ? '关闭语音' : '开启语音'}
      </button>
    </header>

    <section className="workspace">
      <div className="hero">
        <button
          ref={voice.levelElementRef}
          className={`orb ${visualVoiceState}`}
          onClick={handleOrbClick}
          aria-label="语音交互"
        >
          <span />
        </button>
        <p>VOICE FRONTEND</p>
        <h1>你说，我来调度。</h1>
        <small>{voice.error || activity}</small>
      </div>

      <div
        className="messages"
        ref={messagesRef}
        aria-live="polite"
        onScroll={event => {
          const container = event.currentTarget
          stickToBottom.current = (
            container.scrollHeight - container.scrollTop - container.clientHeight
            < 48
          )
        }}
      >
        {!turns.length && <div className="empty">
          <b>试着说</b>
          <span>“帮我查一下今天的 AI 新闻，并整理成三点摘要。”</span>
        </div>}
        {turns.map(turn => <section
          key={turn.id}
          className={`conversation-turn${turn.standalone ? ' standalone' : ''}`}
        >
          {turn.beforeActivities.map(renderMessage)}
          {turn.tasks.map(renderTask)}
          {turn.afterActivities.map(renderMessage)}
        </section>)}
      </div>

    </section>
  </main>
}
