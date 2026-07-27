import assert from 'node:assert/strict'
import test from 'node:test'
import {
  audioModeForPlatform,
  canSendMicrophoneAudio,
  completeTranscript,
  createPlayback,
  createTerminalTranscriptRenderer,
  createTranscriptDisplay,
  helpText,
  parseArguments,
  performManualInterrupt,
  websocketUrl,
} from '../src/index.mjs'

test('keeps a streamed tail when a final transcript is unexpectedly shorter', () => {
  assert.equal(
    completeTranscript('我来帮你查一下。', '我来帮你查'),
    '我来帮你查一下。',
  )
  assert.equal(
    completeTranscript('杭州天气', '杭州天气怎么样？'),
    '杭州天气怎么样？',
  )
})

test('parses a custom gateway and session', () => {
  const options = parseArguments([
    '--url',
    'https://voice.example.com/',
    '--session',
    'terminal-one',
    '--takeover',
  ])
  assert.equal(options.url, 'https://voice.example.com')
  assert.equal(options.sessionId, 'terminal-one')
  assert.equal(options.takeover, true)
})

test('builds the realtime websocket URL', () => {
  assert.equal(
    websocketUrl('https://voice.example.com', '中文 session'),
    'wss://voice.example.com/api/realtime?sessionId=%E4%B8%AD%E6%96%87+session',
  )
})

test('uses full duplex on macOS and half duplex elsewhere', () => {
  const mac = audioModeForPlatform('darwin')
  const linux = audioModeForPlatform('linux')
  const windows = audioModeForPlatform('win32')

  assert.equal(mac.fullDuplex, true)
  assert.equal(mac.captureDuringPlayback, true)
  assert.equal(linux.fullDuplex, false)
  assert.equal(linux.captureDuringPlayback, false)
  assert.equal(windows.fullDuplex, false)
  assert.equal(windows.captureDuringPlayback, false)
  assert.match(helpText(mac), /macOS CoreAudio 全双工回声消除/)
  assert.match(helpText(mac), /x  手动打断当前回复/)
  assert.match(helpText(linux), /回复播放完毕后可继续说话/)
  assert.match(helpText(linux), /按 x 可手动打断/)
  assert.doesNotMatch(helpText(linux), /输入文字|text\.message/)
})

test('drops queued microphone frames whenever half-duplex capture is gated', () => {
  assert.equal(canSendMicrophoneAudio({
    connected: true,
    muted: false,
    captureEnabled: true,
  }), true)
  assert.equal(canSendMicrophoneAudio({
    connected: true,
    muted: false,
    captureEnabled: false,
  }), false)
})

test('manual interruption works in both full-duplex and half-duplex modes', () => {
  for (const platform of ['darwin', 'linux']) {
    const events = []
    performManualInterrupt({
      playback: {
        clear: reason => events.push(['clear', reason]),
      },
      transcriptRenderer: {
        cancel: () => events.push(['cancel']),
      },
      socket: {
        readyState: 1,
        send: value => events.push(['send', JSON.parse(value)]),
      },
      startMicrophone: () => events.push(['capture']),
      print: value => events.push(['print', value]),
      audioMode: audioModeForPlatform(platform),
    })
    assert.deepEqual(events.slice(0, 4), [
      ['clear', 'user_interruption'],
      ['cancel'],
      ['send', { type: 'interrupt' }],
      ['capture'],
    ])
  }
})

test('ignores late audio from a response after manual interruption', () => {
  const writes = []
  const playback = createPlayback({
    audioSink: {
      write: buffer => {
        writes.push(buffer)
        return true
      },
      clear() {},
    },
  })

  assert.equal(playback.write('AQI=', 24000, 'response-1'), true)
  playback.clear('user_interruption')
  assert.equal(playback.write('AwQ=', 24000, 'response-1'), false)
  assert.equal(writes.length, 1)
})

test('prints a late final ASR before the assistant response for that turn', () => {
  const output = []
  const display = createTranscriptDisplay({
    onUser: content => output.push(`user:${content}`),
    onAssistant: content => output.push(`assistant:${content}`),
  })

  display.handle({
    type: 'transcript.final',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '你好。',
  })
  assert.deepEqual(output, [])

  display.handle({
    type: 'transcript.final',
    role: 'user',
    turnId: 'turn-1',
    content: '喂，你好。',
  })
  assert.deepEqual(output, [
    'user:喂，你好。',
    'assistant:你好。',
  ])
})

test('prints later responses in the same completed turn immediately', () => {
  const output = []
  const display = createTranscriptDisplay({
    onUser: content => output.push(`user:${content}`),
    onAssistant: content => output.push(`assistant:${content}`),
  })

  display.handle({
    type: 'transcript.final',
    role: 'user',
    turnId: 'turn-1',
    content: '你记得我什么？',
  })
  display.handle({
    type: 'transcript.delta',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '我记得',
  })
  display.handle({
    type: 'transcript.final',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '我记得你喜欢打篮球。',
  })

  assert.deepEqual(output, [
    'user:你记得我什么？',
    'assistant:我记得你喜欢打篮球。',
  ])
})

test('streams ASR snapshots and assistant transcript without losing the final tail', () => {
  const output = []
  const display = createTranscriptDisplay({
    onUserDelta: content => output.push(`user-delta:${content}`),
    onUser: content => output.push(`user:${content}`),
    onAssistantDelta: content => output.push(`assistant-delta:${content}`),
    onAssistant: content => output.push(`assistant:${content}`),
  })

  display.handle({
    type: 'transcript.delta',
    role: 'user',
    turnId: 'turn-1',
    content: '杭州',
    replace: true,
  })
  display.handle({
    type: 'transcript.delta',
    role: 'user',
    turnId: 'turn-1',
    content: '杭州天气怎么样',
    replace: true,
  })
  display.handle({
    type: 'transcript.delta',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '我来',
  })
  display.handle({
    type: 'transcript.final',
    role: 'user',
    turnId: 'turn-1',
    content: '杭州天气怎么样？',
  })
  display.handle({
    type: 'transcript.delta',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '帮你查一下。',
  })
  display.handle({
    type: 'transcript.final',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '我来帮你查',
  })

  assert.deepEqual(output, [
    'user-delta:杭州',
    'user-delta:杭州天气怎么样',
    'user:杭州天气怎么样？',
    'assistant-delta:我来',
    'assistant-delta:我来帮你查一下。',
    'assistant:我来帮你查一下。',
  ])
})

test('appends only new assistant text and defers interleaved status lines', () => {
  const writes = []
  const stdout = {
    isTTY: true,
    columns: 40,
    write: content => writes.push(content),
  }
  const renderer = createTerminalTranscriptRenderer({ stdout })

  renderer.stream('qwen-audio >', '从前有一只')
  renderer.print('[正在处理] 查询天气')
  renderer.stream('qwen-audio >', '从前有一只小狐狸')
  renderer.finish('qwen-audio >', '从前有一只小狐狸。')

  assert.equal(
    writes.join(''),
    'qwen-audio > 从前有一只小狐狸。\n'
      + '[正在处理] 查询天气\n',
  )
})

test('does not split a streamed reply on a provisional user ASR snapshot', () => {
  const writes = []
  const stdout = {
    isTTY: true,
    columns: 80,
    write: content => writes.push(content),
  }
  const renderer = createTerminalTranscriptRenderer({ stdout })

  renderer.stream('qwen-audio >', '科比的影响力依然深远。这些新闻')
  renderer.update('你 >', '就')
  renderer.stream(
    'qwen-audio >',
    '科比的影响力依然深远。这些新闻都体现了曼巴精神。',
  )
  renderer.finish(
    'qwen-audio >',
    '科比的影响力依然深远。这些新闻都体现了曼巴精神。',
  )

  assert.equal(
    writes.join(''),
    'qwen-audio > 科比的影响力依然深远。这些新闻都体现了曼巴精神。\n',
  )
})

test('keeps the mutable ASR preview on one physical terminal line', () => {
  const writes = []
  const stdout = {
    isTTY: true,
    columns: 24,
    write: content => writes.push(content),
  }
  const renderer = createTerminalTranscriptRenderer({ stdout })

  renderer.update('你 >', '这是一个很长很长的流式识别结果')
  renderer.update('你 >', '这是一个很长很长的流式识别结果更新')
  renderer.finish('你 >', '这是一个很长很长的流式识别结果更新')

  const rendered = writes.join('')
  assert.match(rendered, /…/)
  assert.equal(
    rendered.endsWith('你 > 这是一个很长很长的流式识别结果更新\n'),
    true,
  )
})

test('does not wait for ASR before showing an asynchronous agent result', () => {
  const output = []
  const display = createTranscriptDisplay({
    onUser: content => output.push(`user:${content}`),
    onAssistant: content => output.push(`assistant:${content}`),
  })

  display.handle({
    type: 'transcript.final',
    role: 'assistant',
    responseId: 'announcement-1',
    turnId: 'older-turn',
    origin: 'agent',
    content: '后台工作已经完成。',
  })

  assert.deepEqual(output, ['assistant:后台工作已经完成。'])
})

test('releases a buffered response when the user transcript is discarded', () => {
  const output = []
  const display = createTranscriptDisplay({
    onUser: content => output.push(`user:${content}`),
    onAssistant: content => output.push(`assistant:${content}`),
  })

  display.handle({
    type: 'transcript.final',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '我听到了。',
  })
  display.handle({
    type: 'transcript.discard',
    role: 'user',
    turnId: 'turn-1',
  })

  assert.deepEqual(output, ['assistant:我听到了。'])
})

test('prints duplicate final transcript events for one response only once', () => {
  const output = []
  const display = createTranscriptDisplay({
    onUser: content => output.push(`user:${content}`),
    onAssistant: content => output.push(`assistant:${content}`),
  })
  const userEvent = {
    type: 'transcript.final',
    role: 'user',
    turnId: 'turn-1',
    content: '查一下最新消息。',
  }
  const assistantEvent = {
    type: 'transcript.final',
    role: 'assistant',
    responseId: 'response-1',
    turnId: 'turn-1',
    origin: 'model',
    content: '我正在查找，请稍等。',
  }

  display.handle(userEvent)
  display.handle(assistantEvent)
  display.handle(assistantEvent)

  assert.deepEqual(output, [
    'user:查一下最新消息。',
    'assistant:我正在查找，请稍等。',
  ])
})
