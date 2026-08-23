// Bloub 悬浮球：语音状态 → bloub 引擎状态的映射与外观参数解析。
// 纯函数模块（node --test 可直接导入）；引擎实例与 SVG 渲染在
// DesktopBloubOrb.jsx。bloub 状态语义见 web/src/bloub/bot/states.ts。

import {
  DEFAULT_BLOUB_COLOR,
  DEFAULT_BLOUB_EXPRESSION,
  DEFAULT_BLOUB_SHAPE,
  normalizeBloubColor,
  normalizeBloubExpression,
  normalizeBloubShape,
} from '../../shared/bloub-catalog.mjs'

// 悬浮球视觉状态 → bloub 状态：
// 对话态走表情系（聆听睁眼/思考/播放），后台系走形态系（轨道环/通知/
// 惊叹），生命周期走眨眼与睡眠。alert 的「!」预留给错误，是强信号。
export function bloubStateForOrbState({
  state,
  dragDirection = '',
  cue = null,
} = {}) {
  if (dragDirection === 'left' || dragDirection === 'right') {
    return 'comet'
  }
  if (cue?.name === 'jumping') return 'burst'
  switch (state) {
    case 'listening':
      return 'wide'
    case 'processing':
      return 'thinking'
    case 'speaking':
      return 'play'
    case 'starting':
    case 'connecting':
    case 'working':
      return 'orbit'
    case 'attention':
      return 'notify'
    case 'occupied':
      return 'exclaim'
    case 'error':
      return 'alert'
    case 'waking':
      return 'wink'
    case 'hidden':
      return 'sleep'
    default:
      return 'idle'
  }
}

// burst 的最小完整时长（states.ts minDuration 2.4s + 余量），
// 悬停彩蛋播完这一段再交还状态机。
export const BLOUB_CUE_DURATION_MS = 2600

// orb 页 URL 参数 → 外观三元组。非法值回退默认，不向前端泄漏。
export function bloubAppearanceFromParams(search = '') {
  const params = new URLSearchParams(search)
  return {
    shape: normalizeBloubShape(params.get('orbShape')),
    color: normalizeBloubColor(params.get('orbColor')),
    expression: normalizeBloubExpression(params.get('orbExpression')),
  }
}

// 状态 → 外观自动映射：不同状态使用不同形状/颜色，表情在池内轮换。
// 池内顺序即轮换顺序（首项为进入状态时的表情），空闲久了会从平静
// 走向好奇、无趣，思考时在困惑、怀疑、好奇间游移。16 个表情全部入池。
const BLOUB_STATE_APPEARANCE = Object.freeze({
  idle: { shape: 'cercle', color: 'encre', expressions: ['neutre', 'curieux', 'blase'] },
  wide: { shape: 'goutte', color: 'bleu', expressions: ['surpris', 'curieux'] },
  thinking: { shape: 'nuage', color: 'violet', expressions: ['confus', 'mefiant', 'curieux'] },
  play: { shape: 'galet', color: 'orange', expressions: ['heureux', 'fier'] },
  orbit: { shape: 'capsule', color: 'vert', expressions: ['attentif'] },
  notify: { shape: 'hexagone', color: 'rose', expressions: ['confus', 'mefiant'] },
  exclaim: { shape: 'triangle', color: 'rouge', expressions: ['excite'] },
  alert: { shape: 'triangle', color: 'rouge', expressions: ['colere', 'effraye', 'triste'] },
  wink: { shape: 'cercle', color: 'creme', expressions: ['timide'] },
  sleep: { shape: 'cercle', color: 'gris', expressions: ['somnolent', 'blase'] },
  comet: { shape: 'goutte', color: 'bleu', expressions: ['surpris'] },
  burst: { shape: 'squircle', color: 'ambre', expressions: ['hilare', 'excite'] },
})

// 状态停留期间的表情轮换节奏：思考快、空闲慢，其余用默认节奏。
// comet/burst 等瞬态在轮换触发前就已结束，节奏对它们无意义。
const BLOUB_EXPRESSION_ROTATION_MS = Object.freeze({
  idle: 12000,
  thinking: 5000,
  play: 8000,
})
const BLOUB_DEFAULT_ROTATION_MS = 9000

export function bloubExpressionRotationMs(bloubState = 'idle') {
  return BLOUB_EXPRESSION_ROTATION_MS[bloubState] ?? BLOUB_DEFAULT_ROTATION_MS
}

export function bloubAppearanceForBloubState(bloubState = 'idle', variant = 0) {
  const entry = BLOUB_STATE_APPEARANCE[bloubState]
  if (!entry) return DEFAULT_BLOUB_APPEARANCE
  const expressions = entry.expressions
  const index = expressions.length > 1
    ? Math.abs(variant) % expressions.length
    : 0
  return {
    shape: normalizeBloubShape(entry.shape),
    color: normalizeBloubColor(entry.color),
    expression: normalizeBloubExpression(expressions[index]),
  }
}

export function bloubAppearanceForOrbState({
  state,
  dragDirection = '',
  cue = null,
  variant = 0,
} = {}) {
  const bloubState = bloubStateForOrbState({ state, dragDirection, cue })
  return bloubAppearanceForBloubState(bloubState, variant)
}

export const DEFAULT_BLOUB_APPEARANCE = Object.freeze({
  shape: DEFAULT_BLOUB_SHAPE,
  color: DEFAULT_BLOUB_COLOR,
  expression: DEFAULT_BLOUB_EXPRESSION,
})
