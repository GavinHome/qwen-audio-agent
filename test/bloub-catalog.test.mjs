import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BLOUB_COLORS,
  BLOUB_EXPRESSIONS,
  BLOUB_SHAPES,
  bloubEntryLabel,
  normalizeBloubColor,
  normalizeBloubExpression,
  normalizeBloubShape,
} from '../shared/bloub-catalog.mjs'
import { BLOUB_STATE_APPEARANCE } from '../web/src/bloub-orb.js'
import {
  DEFAULT_BLOUB_APPEARANCE,
  bloubAppearanceForBloubState,
  bloubCueDurationMs,
  bloubExpressionRotationMs,
  bloubStateForOrbState,
} from '../web/src/bloub-orb.js'

const CATALOGS = [
  ['shapes', BLOUB_SHAPES],
  ['colors', BLOUB_COLORS],
  ['expressions', BLOUB_EXPRESSIONS],
]

test('bloub catalog entries carry bilingual labels and unique ids', () => {
  for (const [name, catalog] of CATALOGS) {
    const ids = new Set()
    for (const entry of catalog) {
      assert.ok(entry.id, `${name}: entry has an id`)
      assert.ok(!ids.has(entry.id), `${name}: duplicate id ${entry.id}`)
      ids.add(entry.id)
      assert.ok(entry.displayName, `${name}/${entry.id}: missing displayName`)
      assert.ok(entry.displayNameEn, `${name}/${entry.id}: missing displayNameEn`)
      assert.notEqual(entry.displayName, entry.displayNameEn)
    }
  }
})

test('bloubEntryLabel picks the label by interface language with zh fallback', () => {
  const entry = BLOUB_SHAPES[0]
  assert.equal(bloubEntryLabel(entry, 'en'), entry.displayNameEn)
  assert.equal(bloubEntryLabel(entry, 'zh-CN'), entry.displayName)
  assert.equal(bloubEntryLabel(entry), entry.displayName)
  assert.equal(bloubEntryLabel({ id: 'x', displayName: '自定义' }, 'en'), '自定义')
})

test('bloub normalizers fall back to defaults on unknown values', () => {
  assert.equal(normalizeBloubShape('goutte'), 'goutte')
  assert.equal(normalizeBloubShape('../nope'), DEFAULT_BLOUB_APPEARANCE.shape)
  assert.equal(normalizeBloubColor('bleu'), 'bleu')
  assert.equal(normalizeBloubColor(''), DEFAULT_BLOUB_APPEARANCE.color)
  assert.equal(normalizeBloubExpression('curieux'), 'curieux')
  assert.equal(normalizeBloubExpression(undefined), DEFAULT_BLOUB_APPEARANCE.expression)
})

test('every reachable bloub state resolves a valid appearance triple', () => {
  const shapeIds = new Set(BLOUB_SHAPES.map(entry => entry.id))
  const colorIds = new Set(BLOUB_COLORS.map(entry => entry.id))
  const expressionIds = new Set(BLOUB_EXPRESSIONS.map(entry => entry.id))

  const orbStates = [
    'listening', 'processing', 'speaking', 'starting', 'connecting',
    'working', 'attention', 'occupied', 'error', 'waking', 'hidden',
    'idle', 'unknown-private-state',
  ]
  const bloubStates = new Set(orbStates.map(state => (
    bloubStateForOrbState({ state })
  )))
  bloubStates.add(bloubStateForOrbState({ state: 'idle', dragDirection: 'left' }))
  bloubStates.add(bloubStateForOrbState({ state: 'idle', cue: { id: 1, name: 'jumping' } }))

  for (const bloubState of bloubStates) {
    for (const variant of [0, 1, 2, 7]) {
      const appearance = bloubAppearanceForBloubState(bloubState, variant)
      assert.ok(shapeIds.has(appearance.shape), `${bloubState}: bad shape ${appearance.shape}`)
      assert.ok(colorIds.has(appearance.color), `${bloubState}: bad color ${appearance.color}`)
      assert.ok(
        expressionIds.has(appearance.expression),
        `${bloubState}: bad expression ${appearance.expression}`,
      )
    }
  }
})

test('all 16 expressions appear in at least one state rotation pool', () => {
  const covered = new Set()
  for (const entry of Object.values(BLOUB_STATE_APPEARANCE)) {
    for (const id of entry.expressions) covered.add(id)
  }
  assert.deepEqual(
    [...BLOUB_EXPRESSIONS.map(e => e.id)].sort(),
    [...covered].sort(),
    'every expression must be reachable in some state pool',
  )
})

test('expression rotation ticks only for states that show the face', () => {
  // idle/thinking/play/notify/sleep 带 baseFace，表情可见且轮换有意义。
  // wide/alert 没有 baseFace（宽眼/感叹号是字形动画，不带表情），不轮换。
  for (const state of ['idle', 'thinking', 'play', 'notify', 'sleep']) {
    assert.ok(bloubExpressionRotationMs(state) > 0, `${state} should rotate`)
  }
  for (const state of ['wide', 'orbit', 'alert', 'exclaim']) {
    assert.equal(bloubExpressionRotationMs(state), 0)
  }
})

test('sleep uses gris for soft rest feel, wink avoids paper-matching creme', () => {
  const sleepAppearance = bloubAppearanceForBloubState(
    bloubStateForOrbState({ state: 'hidden' }),
  )
  assert.equal(sleepAppearance.color, 'gris')
  const winkAppearance = bloubAppearanceForBloubState(
    bloubStateForOrbState({ state: 'waking' }),
  )
  assert.notEqual(winkAppearance.color, 'creme')
})

test('all usable colors are used in at least one state auto-mapping', () => {
  const covered = new Set()
  for (const entry of Object.values(BLOUB_STATE_APPEARANCE)) {
    covered.add(entry.color)
  }
  // 奶油白因与纸色对比度不足，无法用于任何带脸状态；棕色和灰色已补入映射。
  assert.ok(covered.has('brun'), 'brun should be used by exclaim')
  assert.ok(covered.has('gris'), 'gris should be used by sleep')
  // 11/12：奶油白仅可通过手动设置使用，自动映射表排除它以保证眼睛可读性。
  assert.equal(covered.size, 11, `11 usable colors should be mapped, got ${covered.size}`)
  assert.ok(!covered.has('creme'), 'creme is intentionally excluded from auto-mapping')
})

test('hatching cue maps to egg state with a fixed duration', () => {
  assert.equal(bloubStateForOrbState({ state: 'hidden', cue: { id: 1, name: 'hatching' } }), 'egg')
  assert.equal(bloubCueDurationMs('hatching'), 2200)
  assert.equal(bloubCueDurationMs('jumping'), 1000)
  assert.equal(bloubCueDurationMs('hexagon'), 1800)
  assert.equal(bloubCueDurationMs('unknown'), 2600)
})
