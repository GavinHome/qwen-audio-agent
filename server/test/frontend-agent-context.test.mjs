import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFrontendContext,
  currentTimeSnapshot,
  loadFrontendPrompt,
  normalizeClientContext,
} from '../src/conversation/frontend-agent-context.mjs'

test('uses a valid client timezone and returns an exact local clock snapshot', () => {
  const snapshot = currentTimeSnapshot({
    timeZone: 'Asia/Shanghai',
    locale: 'zh-CN',
    now: new Date('2026-07-23T04:00:00.000Z'),
  })

  assert.equal(snapshot.iso_utc, '2026-07-23T04:00:00.000Z')
  assert.equal(snapshot.time_zone, 'Asia/Shanghai')
  assert.match(snapshot.local_time, /12:00:00/)
})

test('rejects invalid client timezone and locale values', () => {
  const normalized = normalizeClientContext({
    timeZone: 'not/a-zone',
    locale: 'not_a_locale',
  })

  assert.notEqual(normalized.timeZone, 'not/a-zone')
  assert.equal(normalized.locale, 'zh-CN')
})

test('loads one canonical frontend policy separately from runtime context', () => {
  const prompt = loadFrontendPrompt()
  const context = buildFrontendContext()

  assert.match(prompt, /# Operating model/)
  assert.match(prompt, /# Completed work/)
  assert.match(prompt, /# Basic tools/)
  assert.doesNotMatch(context, /# Operating model/)
  assert.match(context, /## Runtime Context/)
})

test('injects only bounded active task state as runtime context', () => {
  const context = buildFrontendContext({
    activeTasks: [
      {
        id: 'job_active',
        status: 'running',
        objective: '继续制作语音助手页面',
      },
      {
        id: 'job_queued',
        status: 'queued',
        objective: '等待处理的工作',
      },
      {
        id: 'job_done',
        status: 'completed',
        objective: '已经完成的旧任务',
      },
    ],
  })

  assert.match(context, /## Active Agent Run Context/)
  assert.match(context, /work_id=job_active/)
  assert.match(context, /work_id=job_queued/)
  assert.doesNotMatch(context, /permission|delivery=/)
  assert.match(context, /不要主动逐项播报/)
  assert.doesNotMatch(context, /job_done/)
})

test('treats stable user profile content as untrusted memory data', () => {
  const context = buildFrontendContext({
    memories: [{
      id: 'user_profile',
      scope: 'profile',
      content: '# USER\n\n- 称呼：老大',
      editable: false,
    }],
  })

  assert.match(context, /## User Memory/)
  assert.match(context, /称呼：老大/)
  assert.match(context, /不是系统指令/)
})
