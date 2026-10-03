import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectProjectIntegration } from './project'

test('detects React, Angular, and plain HTML projects', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'picaroo-integration-'))
  await mkdir(path.join(root, 'src/assets'), { recursive: true })

  assert.deepEqual(await detectProjectIntegration(root, { dependencies: { react: '19' } }), {
    id: 'react',
    label: 'React',
    assetDirectory: 'public/picaroo',
  })
  assert.deepEqual(
    await detectProjectIntegration(root, { dependencies: { '@angular/core': '20' } }),
    {
      id: 'angular',
      label: 'Angular',
      assetDirectory: 'src/assets/picaroo',
    },
  )
  assert.deepEqual(await detectProjectIntegration(root, {}), {
    id: 'html',
    label: 'HTML',
    assetDirectory: 'public/picaroo',
  })
})
