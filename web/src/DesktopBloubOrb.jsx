// Bloub 悬浮球渲染器：web/src/bloub/bot/ 下的引擎（移植自
// github.com/jeremy-prt/bloub 的 src/bot/，MIT）+ 本组件把 sample(t)
// 的输出画成 SVG。状态机与窗口交互都在组件外层，这里只把共享的
// 语音状态翻译成引擎状态，驱动一帧帧连续变形。
//
// 与 BloubBot.vue 的差异：无 montage 播放器（悬浮球由语音状态驱动），
// 无指针跟随（悬浮球窗口内指针即拖拽），保留呼吸、眨眼与视线游移。
import { useEffect, useRef, useState } from 'react'
import { BotEngine } from './bloub/bot/engine'
import { NOTIF_BLUE } from './bloub/bot/decor'
import { EXPRESSION_BY_ID } from './bloub/bot/expressions'
import { COLOR_BY_ID, SHAPE_BY_ID, mixHex } from './bloub/bot/skins'
import { DEMI_VIEWBOX, RAYON } from './bloub/bot/repere'
import { BLOUB_CUE_DURATION_MS, bloubStateForOrbState } from './bloub-orb.js'

// 眼睛是身体上的「洞」，洞里露出这层底色——即原版 x.ai 机器人的纸色。
const PAPER = '#f9f9f9'

export default function DesktopBloubOrb({
  state = 'idle',
  dragDirection = '',
  cue = null,
  onCueComplete,
  shape = 'cercle',
  color = 'encre',
  expression = 'neutre',
}) {
  const onCueCompleteRef = useRef(onCueComplete)
  onCueCompleteRef.current = onCueComplete

  const shapeEntry = SHAPE_BY_ID.get(shape)
  const colorEntry = COLOR_BY_ID.get(color)
  const expressionEntry = EXPRESSION_BY_ID.get(expression)
  const shapeRadii = shapeEntry ? shapeEntry.radii : null
  const expressionPose = expressionEntry ?? null
  const ink = colorEntry ? colorEntry.hex : '#0a0a0c'

  const engineRef = useRef(null)
  if (!engineRef.current) {
    engineRef.current = new BotEngine(
      RAYON,
      'idle',
      shapeRadii,
      expressionPose,
    )
  }
  const engine = engineRef.current
  const clockRef = useRef(0)
  const [frame, setFrame] = useState(() => engine.sample(0))

  // rAF 循环：增量有界的场景时钟（后台标签页恢复不跳帧），
  // 与 BloubBot.vue 的 tick 相同。
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = ms => {
      raf = requestAnimationFrame(tick)
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0
      last = ms
      clockRef.current += dt
      setFrame(engine.sample(clockRef.current))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  // 语音状态变化：引擎自带指数缓出变形，这里只递交目标状态。
  const target = bloubStateForOrbState({ state, dragDirection, cue })
  const targetRef = useRef(target)
  useEffect(() => {
    if (targetRef.current === target) return
    engine.setState(target, clockRef.current)
    targetRef.current = target
  }, [target, engine])

  // 外观变化同样走 morph，而不是瞬切。
  const shapeRef = useRef(shapeRadii)
  useEffect(() => {
    if (shapeRef.current === shapeRadii) return
    engine.setShape(shapeRadii, clockRef.current)
    shapeRef.current = shapeRadii
  }, [shapeRadii, engine])

  const expressionRef = useRef(expressionPose)
  useEffect(() => {
    if (expressionRef.current === expressionPose) return
    engine.setExpression(expressionPose, clockRef.current)
    expressionRef.current = expressionPose
  }, [expressionPose, engine])

  // 悬停彩蛋：burst 播满一个完整时长再交还状态机。
  useEffect(() => {
    if (!cue?.id) return undefined
    const timer = setTimeout(
      () => onCueCompleteRef.current?.(),
      BLOUB_CUE_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [cue?.id])

  const uid = useRef(Math.random().toString(36).slice(2, 8)).current
  const maskId = `bot-mask-${uid}`
  const VB = DEMI_VIEWBOX

  const renderDot = (dot, index, prefix) => {
    const fill = dot.color
      ?? (dot.depth === undefined ? ink : mixHex(PAPER, ink, dot.depth))
    if (dot.d) {
      return (
        <path
          key={`${prefix}${index}`}
          fill={fill}
          opacity={dot.opacity}
          d={dot.d}
          transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`}
        />
      )
    }
    return (
      <circle
        key={`${prefix}${index}`}
        fill={fill}
        opacity={dot.opacity}
        cx={dot.x}
        cy={dot.y}
        r={dot.r}
      />
    )
  }

  return (
    <div className="bloub-orb">
      <svg
        className="bloub-orb-svg"
        viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
        role="img"
        aria-hidden="true"
      >
      <defs>
        {/* 眼睛是身体上真正的洞（同 x.ai 原版）：滑向边缘时被轮廓自动裁剪 */}
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-VB}
          y={-VB}
          width={VB * 2}
          height={VB * 2}
        >
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, index) => (
            <path
              key={index}
              d={eye.d}
              transform={eye.matrix}
              opacity={eye.alpha}
              fill="#000"
            />
          ))}
          {frame.notch
            ? (
              <circle
                cx={frame.notch.x}
                cy={frame.notch.y}
                r={frame.notch.r}
                fill="#000"
              />
            )
            : null}
        </mask>
        {frame.arcs.map(arc => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((stopColor, index) => (
              <stop
                key={index}
                offset={index / (arc.grad.stops.length - 1)}
                stopColor={stopColor}
              />
            ))}
          </linearGradient>
        ))}
      </defs>

      {/* 轨道环的后半圈：先画，被身体遮挡出纵深 */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map(arc => (
          <path
            key={`b${arc.id}`}
            d={arc.back}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>

      {/* 爆发粒子从核心后面飞出 */}
      {frame.dotsBehind
        ? <g>{frame.dots.map((dot, index) => renderDot(dot, index, 'pb'))}</g>
        : null}

      <g opacity={frame.bodyAlpha}>
        {/* 纸色打底：让眼洞露出干净的底色，也遮住穿过身体背后的环 */}
        <path d={frame.bodyPath} fill={PAPER} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {!frame.dotsBehind
        ? <g>{frame.dots.map((dot, index) => renderDot(dot, index, 'pf'))}</g>
        : null}

      {frame.notif
        ? (
          <circle
            cx={frame.notif.x}
            cy={frame.notif.y}
            r={frame.notif.r}
            fill={NOTIF_BLUE}
          />
        )
        : null}

      {/* 轨道环的前半圈 */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map(arc => (
          <path
            key={`f${arc.id}`}
            d={arc.front}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
      </svg>
    </div>
  )
}
