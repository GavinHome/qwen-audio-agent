import { useState, useEffect, useRef } from 'react'
import {
  bloubAppearanceForOrbState,
  bloubExpressionRotationMs,
  bloubStateForOrbState,
} from './bloub-orb.js'

// 从 URL 读取 bloub 外观与开关参数。非法值回退默认，不向外泄漏。
function urlParam(key, fallback = '') {
  if (typeof window === 'undefined') return fallback
  return new URLSearchParams(window.location.search).get(key) || fallback
}

const CONVERSATION_STATES = new Set(['listening', 'processing', 'speaking'])
const HIGH_PRIORITY_STATES = new Set(['error', 'attention', 'occupied', 'working'])
// 对话结束回到空闲的缓冲：读完一次收尾变形即可，拖长会让球显得对
// 「说完了」反应迟钝；太短则来不及从 speaking 的情绪里缓过来。
const BLOUB_SETTLING_MAX_MS = 2500
const BLOUB_CONVERSATION_HOLD_MS = 600

export function useBloubAppearance({ orbSkinId, orbVisualState }) {
  const autoState = urlParam('orbBloubAutoState', 'true') !== 'false'
  const fixedShape = urlParam('orbBloubFixedShape') === 'true'
  const urlShape = urlParam('orbBloubShape')
  const urlColor = urlParam('orbBloubColor')
  const urlExpression = urlParam('orbBloubExpression')

  const [variant, setVariant] = useState(0)
  const [displayState, setDisplayState] = useState(orbVisualState)
  const prevVoiceStateRef = useRef(orbVisualState)
  const settlingTimerRef = useRef(null)
  const conversationHoldTimerRef = useRef(null)

  useEffect(() => {
    const prev = prevVoiceStateRef.current
    const isHighPriority = HIGH_PRIORITY_STATES.has(orbVisualState)
    const wasConversation = CONVERSATION_STATES.has(prev)
    const isConversation = CONVERSATION_STATES.has(orbVisualState)

    if (settlingTimerRef.current) {
      clearTimeout(settlingTimerRef.current)
      settlingTimerRef.current = null
    }
    if (conversationHoldTimerRef.current) {
      clearTimeout(conversationHoldTimerRef.current)
      conversationHoldTimerRef.current = null
    }

    // 提交目标状态。刚聊完回到 idle 时表情从「好奇」起步（variant=1）而
    // 不是每次都「平静」：轮换立即有内容可看，回空闲的情绪是延续的。
    const commit = next => {
      setDisplayState(next)
      const livelyIdle = next === 'idle' && CONVERSATION_STATES.has(prev)
      setVariant(livelyIdle ? 1 : 0)
      prevVoiceStateRef.current = next
    }

    if (isHighPriority) {
      commit(orbVisualState)
      return
    }

    if (wasConversation && isConversation) {
      setDisplayState(prev)
      conversationHoldTimerRef.current = setTimeout(() => {
        commit(orbVisualState)
        conversationHoldTimerRef.current = null
      }, BLOUB_CONVERSATION_HOLD_MS)
      return
    }

    const recentlyConversation = CONVERSATION_STATES.has(prev)
    if (recentlyConversation) {
      setDisplayState(prev)
      settlingTimerRef.current = setTimeout(() => {
        commit(orbVisualState)
        settlingTimerRef.current = null
      }, BLOUB_SETTLING_MAX_MS)
      return
    }

    commit(orbVisualState)
  }, [orbVisualState])

  useEffect(() => {
    return () => {
      if (settlingTimerRef.current) {
        clearTimeout(settlingTimerRef.current)
      }
      if (conversationHoldTimerRef.current) {
        clearTimeout(conversationHoldTimerRef.current)
      }
    }
  }, [])

  const targetState = bloubStateForOrbState({ state: displayState })

  useEffect(() => {
    if (orbSkinId !== 'bloub-bot' || !autoState) return undefined
    // 轮换间隔为 0 的状态（不显示自定义表情）不启定时器，避免无谓的
    // re-render；idle/thinking/play/notify 会真正显示并轮换表情。
    const rotationMs = bloubExpressionRotationMs(targetState)
    if (!rotationMs) return undefined
    const timer = setInterval(() => {
      setVariant(v => v + 1)
    }, rotationMs)
    return () => clearInterval(timer)
  }, [orbSkinId, targetState, autoState])

  const appearance = bloubAppearanceForOrbState({
    state: displayState,
    variant,
  })

  const shape = fixedShape
    ? (urlShape || appearance.shape)
    : autoState
      ? appearance.shape
      : (urlShape || appearance.shape)

  const color = autoState
    ? appearance.color
    : (urlColor || appearance.color)

  const expression = autoState
    ? appearance.expression
    : (urlExpression || appearance.expression)

  return {
    // 防抖后的展示状态：外观（形状/颜色/表情）与引擎动画共用它，
    // 保证形态和颜色总是一起切换。
    state: displayState,
    shape,
    color,
    expression,
    autoState,
    fixedShape,
  }
}
