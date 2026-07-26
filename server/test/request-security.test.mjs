import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedOrigin } from '../src/core/request-security.mjs'

test('allows same-origin and non-browser requests but rejects foreign browser origins', () => {
  assert.equal(isAllowedOrigin({ headers: { host: 'localhost:3101' } }), true)
  assert.equal(isAllowedOrigin({
    headers: {
      host: 'localhost:3101',
      origin: 'http://localhost:3101',
    },
  }), true)
  assert.equal(isAllowedOrigin({
    headers: {
      host: 'localhost:3101',
      origin: 'https://attacker.example',
    },
  }), false)
})
