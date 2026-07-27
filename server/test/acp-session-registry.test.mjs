import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AcpSessionRegistry } from '../src/agent/acp-session-registry.mjs'

test('preserves legacy coordinator records while persisting project directories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-acp-registry-'))
  const filePath = join(directory, 'acp-sessions.json')
  try {
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      coordinators: {
        'qoder:owner:backend': {
          sessionId: 'coordinator',
          cwd: '/coordinator',
          updatedAt: 1,
        },
      },
    }))
    const registry = new AcpSessionRegistry({ filePath })
    assert.equal(
      registry.get('qoder:owner:backend').sessionId,
      'coordinator',
    )
    registry.setProject('qoder:project-session', {
      sessionId: 'project-session',
      cwd: '/project',
      title: 'Project',
    })

    const reloaded = new AcpSessionRegistry({ filePath })
    assert.deepEqual(
      reloaded.getProject('qoder:project-session'),
      JSON.parse(readFileSync(filePath, 'utf8')).projects[
        'qoder:project-session'
      ],
    )
    assert.equal(
      reloaded.get('qoder:owner:backend').sessionId,
      'coordinator',
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
