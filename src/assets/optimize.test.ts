import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { optimizeAsset } from './optimize'
import { ProjectStore } from '../server/store'

test('uses requested output dimensions exactly', async () => {
  const input = await sharp({
    create: { width: 320, height: 180, channels: 3, background: '#4f765d' },
  })
    .png()
    .toBuffer()

  const result = await optimizeAsset(input, 'raster', {
    outputWidth: 123,
    outputHeight: 77,
  })

  assert.equal(result.width, 123)
  assert.equal(result.height, 77)
})

test('rejects output dimensions above the safe pixel limit', async () => {
  const input = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#4f765d' },
  })
    .png()
    .toBuffer()

  await assert.rejects(
    optimizeAsset(input, 'raster', { outputWidth: 10_000, outputHeight: 10_000 }),
    /no more than 64 megapixels/,
  )
})

test('stops before processing when the request is cancelled', async () => {
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    optimizeAsset(Buffer.from('not read'), 'raster', {}, { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  )
})

test('sets exact SVG dimensions while preserving its viewBox', async () => {
  const input = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><path fill="#123456" d="M0 0h24v12H0z"/></svg>',
  )

  const result = await optimizeAsset(input, 'svg', {
    outputWidth: 96,
    outputHeight: 48,
  })
  const output = result.data.toString('utf8')

  assert.equal(result.width, 96)
  assert.equal(result.height, 48)
  assert.match(output, /viewBox="0 0 24 12"/)
  assert.match(output, /width="96"/)
  assert.match(output, /height="48"/)
})

test('creates an SVG viewBox from numeric source dimensions before resizing', async () => {
  const input = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M0 0h20v10H0z"/></svg>',
  )

  const result = await optimizeAsset(input, 'svg', {
    outputWidth: 40,
    outputHeight: 20,
  })

  assert.match(result.data.toString('utf8'), /viewBox="0 0 20 10"/)
})

test('recolors solid SVG paint while preserving none, gradients, and opacity', async () => {
  const input = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <defs><linearGradient id="paint"><stop stop-color="#fff"/></linearGradient></defs>
      <path d="M0 0h8v8H0z"/>
      <path fill="none" stroke="#f00" stroke-opacity=".5" d="M1 1h6v6H1z"/>
      <path fill="url(#paint)" d="M8 8h8v8H8z"/>
    </svg>
  `)

  const result = await optimizeAsset(input, 'svg', {
    outputWidth: 48,
    outputHeight: 48,
    color: '#abc',
  })
  const output = result.data.toString('utf8')

  assert.equal(result.color, 'aabbcc')
  assert.match(output, /fill="#aabbcc"/)
  assert.match(output, /stroke="#aabbcc"/)
  assert.match(output, /fill="none"/)
  assert.match(output, /fill="url\(#paint\)"/)
  assert.match(output, /stroke-opacity="\.5"/)
})

test('rejects invalid SVG colors', async () => {
  await assert.rejects(
    optimizeAsset(Buffer.from('<svg viewBox="0 0 10 10"/>'), 'svg', { color: '#12xz90' }),
    /valid three- or six-digit hex color/,
  )
})

test('imports customized SVGs with original name, dimensions, and normalized color', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'picaroo-svg-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'svg-test' }))
  const store = new ProjectStore(root, [])
  await store.initialize()

  await store.importAsset(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
    ),
    'Location Pin.svg',
    { outputWidth: 32, outputHeight: 32, color: '#f53' },
  )

  const asset = store.snapshot().assets.find((item) => item.kind === 'svg')!
  assert.equal(asset.name, 'location-pin_32x32_ff5533.svg')
  assert.equal(asset.width, 32)
  assert.equal(asset.height, 32)
  assert.equal(asset.color, '#ff5533')
  assert.match(await readFile(path.join(root, asset.file), 'utf8'), /fill="#ff5533"/)
})
