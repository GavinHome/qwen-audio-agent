// Bloub 悬浮球渲染器：web/src/bloub/bot/ 下的引擎（移植自
// github.com/jeremy-prt/bloub 的 src/bot/，MIT）+ 本组件把 sample(t)
// 的输出画成 SVG。状态机与窗口交互都在组件外层，这里只把共享的
// 语音状态翻译成引擎状态，驱动一帧帧连续变形。
//
// 与 BloubBot.vue 的差异：无 montage 播放器（悬浮球由语音状态驱动），
// 保留呼吸、眨眼与视线游移，并在悬停时让眼球跟随指针（按下拖拽时
// 交还给 comet，不追踪）。
import { useEffect, useRef, useState, useCallback } from 'react'
import { BotEngine } from './bloub/bot/engine'
import { NOTIF_BLUE } from './bloub/bot/decor'
import { EXPRESSION_BY_ID } from './bloub/bot/expressions'
import { COLOR_BY_ID, SHAPE_BY_ID, mixHex } from './bloub/bot/skins'
import { DEMI_VIEWBOX, RAYON } from './bloub/bot/repere'
import { bloubCueDurationMs, bloubStateForOrbState } from './bloub-orb.js'

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
  const dragDirectionRef = useRef(dragDirection)
  useEffect(() => { dragDirectionRef.current = dragDirection })
  const [hexCue, setHexCue] = useState(null)
  const hexTimerRef = useRef(null)

  const shapeEntry = SHAPE_BY_ID.get(shape)
  const colorEntry = COLOR_BY_ID.get(color)
  const expressionEntry = EXPRESSION_BY_ID.get(expression)
  const shapeRadii = shapeEntry ? shapeEntry.radii : null
  const expressionPose = expressionEntry ?? null
  const inkTarget = colorEntry ? colorEntry.hex : '#0a0a0c'

  // 身体颜色与形状/表情一样走 morph，而不是瞬切：形状在 0.45s 里滑动时
  // 颜色同步渐变（与引擎 BotEngine.SHAPE_MORPH 同时长、同缓动）。
  const INK_MORPH_S = 0.45
  const easeOutQuint = t => 1 - (1 - t) ** 5
  const inkRef = useRef(inkTarget)
  const inkFromRef = useRef(inkTarget)
  const inkTargetRef = useRef(inkTarget)
  const inkAtRef = useRef(-1e9)

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
      const k = Math.min(
        Math.max((clockRef.current - inkAtRef.current) / INK_MORPH_S, 0),
        1,
      )
      inkRef.current = k >= 1
        ? inkTargetRef.current
        : mixHex(inkFromRef.current, inkTargetRef.current, easeOutQuint(k))
      setFrame(engine.sample(clockRef.current))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  // 颜色目标变化：从当前显示的颜色出发插值，保证连续。
  useEffect(() => {
    if (inkTargetRef.current === inkTarget) return
    inkFromRef.current = inkRef.current
    inkTargetRef.current = inkTarget
    inkAtRef.current = clockRef.current
  }, [inkTarget])

  // 语音状态变化：引擎自带指数缓出变形，这里只递交目标状态。
  const effectiveCue = hexCue || cue
  const target = bloubStateForOrbState({ state, dragDirection, cue: effectiveCue })
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

  // 彩蛋（悬停爆开 / 唤醒孵化 / 六边形脉冲）按各自时长播满再交还状态机。
  // 回调带上 cue.id：上层以 id 比对清除，不传则彩蛋永远留在状态里。
  useEffect(() => {
    if (!cue?.id) return undefined
    const cueId = cue.id
    const timer = setTimeout(
      () => onCueCompleteRef.current?.(cueId),
      bloubCueDurationMs(cue?.name),
    )
    return () => clearTimeout(timer)
  }, [cue?.id, cue?.name])

  // 本地六边形彩蛋完成后清掉 hexCue，让周期定时器能再次触发。
  useEffect(() => {
    if (!hexCue?.id) return
    const timer = setTimeout(() => setHexCue(null), bloubCueDurationMs('hexagon'))
    return () => clearTimeout(timer)
  }, [hexCue?.id])

  // 工作态（orbit）周期彩蛋：每 5 秒变一次六边形再复原，增加画面节奏。
  // 只在真正处于 orbit 且没有更高优先级彩蛋时运行。
  useEffect(() => {
    if (target !== 'orbit') return undefined
    if (hexCue) return undefined
    const id = setInterval(() => {
      setHexCue({ id: Date.now(), name: 'hexagon' })
    }, 5000)
    return () => clearInterval(id)
  }, [target, hexCue])

  const uid = useRef(Math.random().toString(36).slice(2, 8)).current
  const maskId = `bot-mask-${uid}`
  const VB = DEMI_VIEWBOX
  const ink = inkRef.current

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

  // 悬停时眼球跟随指针，按下拖拽或指针离开时交还游移。
  const handlePointerMove = useCallback((event) => {
    if (dragDirectionRef.current || !engineRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const nx = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)
    const ny = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)
    const yaw = Math.max(-40, Math.min(40, nx * 40))
    const pitch = Math.max(-25, Math.min(25, -ny * 25))
    engineRef.current.setLook(
      { yaw, pitch, mix: 0.7, spin: 0, wander: 0.3 },
      clockRef.current,
    )
  }, [])

  const handlePointerLeave = useCallback(() => {
    if (!engineRef.current) return
    engineRef.current.setLook(null, clockRef.current)
  }, [])

  return (
    <div
      className="bloub-orb"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
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
