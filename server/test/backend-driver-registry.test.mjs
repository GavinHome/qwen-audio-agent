import assert from 'node:assert/strict'
import test from 'node:test'
import { backendNames } from '../../shared/backend-catalog.mjs'
import { backendDriver } from '../src/agent/backends/registry.mjs'
import {
  backendRuntimeDriver,
} from '../src/process/backend-drivers/registry.mjs'

test('every advertised backend has Agent and Runtime drivers', () => {
  for (const protocol of backendNames()) {
    assert.equal(backendDriver(protocol).id, protocol)
    assert.equal(backendRuntimeDriver(protocol).id, protocol)
  }
})
