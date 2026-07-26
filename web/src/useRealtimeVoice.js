import { useEffect, useRef, useState } from 'react'
import { decodePcm, pcmBase64, resample } from './audio.js'

const DEFAULT_INPUT_RATE = 16000
const OUTPUT_RATE = 24000

function socketUrl(sessionId) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const basePath = location.pathname.endsWith('/')
    ? location.pathname
    : location.pathname.replace(/[^/]*$/, '')
  return `${protocol}//${location.host}${basePath}api/realtime?sessionId=${encodeURIComponent(sessionId)}`
}

export function acceptsVoiceState(event, currentTurnId) {
  return (
    !event.turnId
    || event.turnId === currentTurnId
    || event.origin !== 'model'
  )
}

export function visualVoiceState(state, inputActive, enabled) {
  return enabled && inputActive ? 'listening' : state
}

export function shouldClaimReleasedVoice(event, waitingForVoice) {
  return (
    waitingForVoice === true
    && event?.type === 'voice.ownership'
    && event.state === 'available'
  )
}

export default function useRealtimeVoice({
  sessionId,
  enabled,
  outputMuted = false,
  clientType = 'web',
  clientLabel = 'WebUI',
  takeover = false,
  onEvent,
}) {
  const [state, setState] = useState('idle')
  const [inputActive, setInputActive] = useState(false)
  const [error, setError] = useState('')
  const [visualError, setVisualError] = useState(false)
  const [ownership, setOwnership] = useState({
    state: 'available',
    holder: null,
  })
  const eventRef = useRef(onEvent)
  const socketRef = useRef(null)
  const audioRef = useRef(null)
  const levelElementRef = useRef(null)
  const currentTurnId = useRef('')
  const clientInstanceId = useRef(crypto.randomUUID())
  const inputSampleRate = useRef(DEFAULT_INPUT_RATE)
  const enabledRef = useRef(enabled)
  const outputMutedRef = useRef(outputMuted)
  const mutedPlaybackResponses = useRef(new Set())
  const playbackRef = useRef({
    cursor: 0,
    sources: [],
    startTimers: new Map(),
    startedResponses: new Set(),
    sourceCounts: new Map(),
    doneResponses: new Set(),
    endedResponses: new Set(),
  })
  eventRef.current = onEvent
  enabledRef.current = enabled
  outputMutedRef.current = outputMuted

  const setAudioLevel = value => {
    levelElementRef.current?.style.setProperty('--level', String(value))
  }

  const activateAudio = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) {
      setError('当前浏览器不支持实时语音播放')
      setVisualError(true)
      return false
    }
    if (!audioRef.current || audioRef.current.state === 'closed') {
      audioRef.current = new AudioContext()
    }
    audioRef.current.resume().catch(reason => {
      setError(reason?.message || '语音播放没有成功启用，请再点一次开启语音')
      setVisualError(true)
    })
    return true
  }

  const sendSocketEvent = event => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(event))
    return true
  }

  const sendPlaybackEvent = (type, responseId) => {
    if (responseId) sendSocketEvent({ type, responseId })
  }

  const stopPlayback = () => {
    const playback = playbackRef.current
    const activeResponseIds = new Set([
      ...playback.startTimers.keys(),
      ...playback.startedResponses,
      ...playback.sourceCounts.keys(),
    ])
    for (const [responseId, timer] of playback.startTimers) {
      clearTimeout(timer)
    }
    for (const responseId of activeResponseIds) {
      if (!playback.endedResponses.has(responseId)) {
        sendPlaybackEvent('playback.cancelled', responseId)
      }
    }
    playbackRef.current.sources.forEach(source => {
      try {
        source.stop()
      } catch {
        // Source already stopped.
      }
    })
    playbackRef.current = {
      cursor: 0,
      sources: [],
      startTimers: new Map(),
      startedResponses: new Set(),
      sourceCounts: new Map(),
      doneResponses: new Set(),
      endedResponses: new Set(),
    }
  }

  const finishPlaybackIfReady = responseId => {
    if (!responseId) return
    const playback = playbackRef.current
    if (
      !playback.startedResponses.has(responseId)
      || !playback.doneResponses.has(responseId)
      || (playback.sourceCounts.get(responseId) || 0) > 0
      || playback.endedResponses.has(responseId)
    ) return
    playback.endedResponses.add(responseId)
    sendPlaybackEvent('playback.ended', responseId)
    playback.startedResponses.delete(responseId)
    playback.sourceCounts.delete(responseId)
    playback.doneResponses.delete(responseId)
  }

  const markAudioDone = responseId => {
    if (!responseId) return
    playbackRef.current.doneResponses.add(responseId)
    finishPlaybackIfReady(responseId)
  }

  const consumeMutedAudio = responseId => {
    if (!responseId || mutedPlaybackResponses.current.has(responseId)) return
    mutedPlaybackResponses.current.add(responseId)
    sendPlaybackEvent('playback.started', responseId)
  }

  const finishMutedAudio = responseId => {
    if (!responseId || !mutedPlaybackResponses.current.has(responseId)) return
    mutedPlaybackResponses.current.delete(responseId)
    sendPlaybackEvent('playback.ended', responseId)
  }

  const play = (base64, sampleRate = OUTPUT_RATE, responseId = '') => {
    const context = audioRef.current
    if (!context) return
    if (context.state === 'suspended') context.resume().catch(() => {})
    const samples = decodePcm(base64)
    const buffer = context.createBuffer(1, samples.length, sampleRate)
    buffer.copyToChannel(samples, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const start = Math.max(context.currentTime + 0.02, playbackRef.current.cursor)
    playbackRef.current.cursor = start + buffer.duration
    playbackRef.current.sources.push(source)
    if (responseId) {
      playbackRef.current.sourceCounts.set(
        responseId,
        (playbackRef.current.sourceCounts.get(responseId) || 0) + 1,
      )
    }
    if (
      responseId
      && !playbackRef.current.startedResponses.has(responseId)
      && !playbackRef.current.startTimers.has(responseId)
    ) {
      const checkStarted = () => {
        const playback = playbackRef.current
        if (!playback.startTimers.has(responseId)) return
        if (context.state !== 'running' || context.currentTime + 0.005 < start) {
          const timer = setTimeout(checkStarted, 20)
          playback.startTimers.set(responseId, timer)
          return
        }
        playback.startTimers.delete(responseId)
        playback.startedResponses.add(responseId)
        sendPlaybackEvent('playback.started', responseId)
      }
      const delay = Math.max(0, (start - context.currentTime) * 1000)
      const timer = setTimeout(checkStarted, delay)
      playbackRef.current.startTimers.set(responseId, timer)
    }
    source.onended = () => {
      const playback = playbackRef.current
      playback.sources = playback.sources.filter(item => item !== source)
      if (responseId && playback.sourceCounts.has(responseId)) {
        playback.sourceCounts.set(
          responseId,
          Math.max(0, (playback.sourceCounts.get(responseId) || 0) - 1),
        )
        finishPlaybackIfReady(responseId)
      }
    }
    source.start(start)
  }

  useEffect(() => {
    let disposed = false
    let reconnectTimer
    let reconnectDelay = 500
    const connect = () => {
      if (disposed) return
      const socket = new WebSocket(socketUrl(sessionId))
      socketRef.current = socket
      socket.onopen = () => {
        reconnectDelay = 500
        setError('')
        setVisualError(false)
        eventRef.current?.({ type: 'gateway.connected' })
        socket.send(JSON.stringify({
          type: 'connect',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: navigator.language,
          voiceEnabled: enabledRef.current,
          clientType,
          clientLabel,
          clientInstanceId: clientInstanceId.current,
          takeover,
        }))
      }
      socket.onmessage = message => {
        let event
        try {
          event = JSON.parse(message.data)
        } catch {
          return
        }
        if (event.type === 'voice.ready' && event.inputSampleRate) {
          inputSampleRate.current = event.inputSampleRate
          setVisualError(false)
        }
        if (event.type === 'voice.ownership') {
          setOwnership({
            state: event.state || 'available',
            holder: event.holder || null,
          })
        }
        if (event.type === 'voice.deactivated') {
          setOwnership({
            state: 'busy',
            holder: event.holder || null,
          })
        }
        if (event.type === 'turn.started') currentTurnId.current = event.turnId || ''
        if (event.type === 'voice.state') {
          if (acceptsVoiceState(event, currentTurnId.current)) {
            setState(event.state)
            if (event.state === 'listening') stopPlayback()
          }
        }
        if (event.type === 'playback.clear') stopPlayback()
        if (event.type === 'audio.delta') {
          if (outputMutedRef.current) {
            consumeMutedAudio(event.responseId)
          } else {
            play(event.audio, event.sampleRate, event.responseId)
          }
        }
        if (event.type === 'audio.done') {
          if (mutedPlaybackResponses.current.has(event.responseId)) {
            finishMutedAudio(event.responseId)
          } else {
            markAudioDone(event.responseId)
          }
        }
        if (event.type === 'error') setError(event.message)
        eventRef.current?.(event)
      }
      socket.onerror = () => {
        if (!disposed) {
          setError('实时语音连接中断，正在重连')
          setVisualError(true)
        }
      }
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (disposed) return
        stopPlayback()
        setState('idle')
        setError('实时语音连接中断，正在重连')
        setVisualError(true)
        eventRef.current?.({ type: 'gateway.disconnected' })
        reconnectTimer = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(5000, reconnectDelay * 2)
      }
    }
    setError('')
    connect()

    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      socketRef.current?.close()
      socketRef.current = null
      stopPlayback()
      mutedPlaybackResponses.current.clear()
    }
  }, [clientLabel, clientType, sessionId, takeover])

  useEffect(() => {
    if (outputMuted) stopPlayback()
  }, [outputMuted])

  useEffect(() => {
    if (!enabled) {
      sendSocketEvent({ type: 'mute' })
      setAudioLevel(0)
      setInputActive(false)
      return undefined
    }

    let disposed = false
    let media
    let source
    let processor
    let analyser
    let animation
    let visualInputActive = false
    let lastVoiceAt = 0
    const startAudio = async () => {
      try {
        activateAudio()
        const context = audioRef.current
        if (!context) return
        if (context.state === 'suspended') await context.resume()
        media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        if (disposed) return media.getTracks().forEach(track => track.stop())
        setVisualError(false)
        sendSocketEvent({ type: 'unmute', takeover })
        source = context.createMediaStreamSource(media)
        analyser = context.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        processor = context.createScriptProcessor(2048, 1, 1)
        processor.onaudioprocess = event => {
          const socket = socketRef.current
          if (socket?.readyState !== WebSocket.OPEN) return
          const audio = resample(
            event.inputBuffer.getChannelData(0),
            context.sampleRate,
            inputSampleRate.current,
          )
          socket.send(JSON.stringify({ type: 'audio.append', audio: pcmBase64(audio) }))
        }
        source.connect(processor)
        processor.connect(context.destination)
        const samples = new Float32Array(analyser.fftSize)
        const tick = () => {
          analyser.getFloatTimeDomainData(samples)
          const power = samples.reduce((sum, value) => sum + value * value, 0)
          const level = Math.min(1, Math.sqrt(power / samples.length) / 0.18)
          setAudioLevel(level)
          const now = performance.now()
          if (level >= 0.075) {
            lastVoiceAt = now
            if (!visualInputActive) {
              visualInputActive = true
              setInputActive(true)
            }
          } else if (visualInputActive && now - lastVoiceAt >= 140) {
            visualInputActive = false
            setInputActive(false)
          }
          animation = requestAnimationFrame(tick)
        }
        tick()
      } catch (reason) {
        setError(reason.message || '无法打开麦克风')
        setVisualError(true)
      }
    }
    startAudio()

    return () => {
      disposed = true
      cancelAnimationFrame(animation)
      setInputActive(false)
      media?.getTracks().forEach(track => track.stop())
      processor?.disconnect()
      source?.disconnect()
      analyser?.disconnect()
    }
  }, [enabled, sessionId, takeover])

  useEffect(() => () => {
    audioRef.current?.close()
    audioRef.current = null
  }, [])

  const interrupt = () => {
    stopPlayback()
    sendSocketEvent({ type: 'interrupt' })
  }

  return {
    state,
    visualState: visualVoiceState(state, inputActive, enabled),
    error,
    visualError,
    ownership,
    levelElementRef,
    activateAudio,
    interrupt,
  }
}
