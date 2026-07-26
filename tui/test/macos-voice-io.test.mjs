import assert from 'node:assert/strict'
import test from 'node:test'
import { macVoiceIOBinaryPath } from '../src/macos-voice-io.mjs'

test('uses the standard macOS cache for the native voice helper', () => {
  assert.equal(
    macVoiceIOBinaryPath({
      homeDirectory: '/Users/example',
    }),
    '/Users/example/Library/Caches/qwaudio/tui/macos-voice-io',
  )
})
