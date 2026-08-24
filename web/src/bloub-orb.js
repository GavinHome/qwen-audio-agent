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
  // 唤醒彩蛋：从休眠里醒来时先做一颗蛋（egg），再孵化回正常形态。
  if (cue?.name === 'hatching') return 'egg'
  // 工作态周期彩蛋：球变六边形再复原，增加画面节奏。
  if (cue?.name === 'hexagon') return 'hexagon'
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

// 彩蛋的最小完整时长（对应状态在 states.ts 的 duration/minDuration + 余量），
// 播完这一段再交还状态机。burst 2.4s、egg 1.8s 各自按需。
const BLOUB_CUE_DURATIONS_MS = Object.freeze({
  jumping: 1000,
  hatching: 2200,
  hexagon: 1800,
})
const BLOUB_DEFAULT_CUE_DURATION_MS = 2600

export function bloubCueDurationMs(cueName = '') {
  return BLOUB_CUE_DURATIONS_MS[cueName] ?? BLOUB_DEFAULT_CUE_DURATION_MS
}

// 状态 → 外观自动映射：不同状态使用不同形状/颜色，表情在池内轮换。
// 引擎里形状作用于 baseBody 状态，表情作用于 baseFace 状态；「!」、睡眠等
// 字形动画自带轮廓，映射字段对它们是进出该状态时 morph 的路径终点。
// notify 在 states.ts 开了 baseFace=true，其表情池现在真正渲染。
// 16 个表情全部入池，确保每个表情至少在一个状态的轮换里实际显示。
export const BLOUB_STATE_APPEARANCE = Object.freeze({
  idle: { shape: 'cercle', color: 'encre', expressions: ['neutre', 'curieux', 'blase', 'attentif', 'surpris', 'effraye', 'timide'] },
  wide: { shape: 'goutte', color: 'bleu', expressions: [] },
  thinking: { shape: 'nuage', color: 'violet', expressions: ['confus', 'mefiant', 'curieux', 'excite', 'somnolent'] },
  play: { shape: 'galet', color: 'orange', expressions: ['heureux', 'fier', 'hilare', 'excite', 'triste'] },
  orbit: { shape: 'capsule', color: 'vert', expressions: ['attentif'] },
  notify: { shape: 'hexagone', color: 'rose', expressions: ['confus', 'mefiant', 'colere', 'surpris', 'effraye', 'triste'] },
  exclaim: { shape: 'triangle', color: 'brun', expressions: ['excite'] },
  alert: { shape: 'triangle', color: 'rouge', expressions: [] },
  // 眼睛是纸色 (#f9f9f9) 的洞：身体必须与纸色有对比度，sleep 用灰色更柔和。
  wink: { shape: 'cercle', color: 'turquoise', expressions: ['timide'] },
  sleep: { shape: 'cercle', color: 'gris', expressions: ['somnolent', 'blase', 'triste'] },
  comet: { shape: 'goutte', color: 'bleu', expressions: ['surpris'] },
  burst: { shape: 'squircle', color: 'ambre', expressions: ['hilare', 'excite'] },
})

// 表情轮换的节奏：只对带 baseFace 的状态有意义，其余状态表情不参与渲染，
// 返回 0 表示不轮换、不启定时器。alert 保留红色倾斜「！」字形，不显示表情；
// wide 强制睁大眼（baseFace=false），表情不渲染。生气的表情由 notify 承载并轮换。
const BLOUB_EXPRESSION_ROTATION_MS = Object.freeze({
  idle: 12000,
  notify: 7000,
  wide: 0,
  thinking: 5000,
  play: 8000,
  sleep: 9000,
})
const BLOUB_DEFAULT_ROTATION_MS = 0

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
