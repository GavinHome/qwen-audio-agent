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
const BLOUB_SETTLING_MAX_MS = 5000
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

    console.log('[bloub][transition]', {
      prev,
      orbVisualState,
      wasConversation,
      isConversation,
      isHighPriority,
    })

    if (isHighPriority) {
      setDisplayState(orbVisualState)
      setVariant(0)
      prevVoiceStateRef.current = orbVisualState
      return
    }

    if (wasConversation && isConversation) {
      setDisplayState(prev)
      conversationHoldTimerRef.current = setTimeout(() => {
        setDisplayState(orbVisualState)
        setVariant(0)
        prevVoiceStateRef.current = orbVisualState
        conversationHoldTimerRef.current = null
      }, BLOUB_CONVERSATION_HOLD_MS)
      return
    }

    const recentlyConversation = CONVERSATION_STATES.has(prev)
    if (recentlyConversation) {
      setDisplayState(prev)
      settlingTimerRef.current = setTimeout(() => {
        setDisplayState(orbVisualState)
        setVariant(0)
        prevVoiceStateRef.current = orbVisualState
        settlingTimerRef.current = null
      }, BLOUB_SETTLING_MAX_MS)
      return
    }

    setDisplayState(orbVisualState)
    setVariant(0)
    prevVoiceStateRef.current = orbVisualState
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
    const timer = setInterval(() => {
      setVariant(v => v + 1)
    }, bloubExpressionRotationMs(targetState))
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
    shape,
    color,
    expression,
    autoState,
    fixedShape,
  }
}
