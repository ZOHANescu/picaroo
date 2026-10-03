import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { optimizeAsset } from './optimize'
import { ProjectStore } from '../server/store'
import { DEFAULT_PROFILE } from '../shared'

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

test('recolors raster pixels while preserving transparency', async () => {
  const pixels = Buffer.alloc(16 * 16 * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = index < pixels.length / 2 ? 240 : 10
    pixels[index + 1] = index < pixels.length / 2 ? 20 : 220
    pixels[index + 2] = index < pixels.length / 2 ? 10 : 30
    pixels[index + 3] = index < pixels.length / 2 ? 255 : 96
  }
  const input = await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } })
    .png()
    .toBuffer()

  const result = await optimizeAsset(input, 'raster', {
    outputWidth: 16,
    outputHeight: 16,
    color: '#3a7',
    profile: { ...DEFAULT_PROFILE, format: 'png' },
  })
  const { data, info } = await sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  assert.equal(result.color, '33aa77')
  assert.equal(info.channels, 4)
  for (let index = 0; index < data.length; index += 4) {
    assert.equal(data[index], 0x33)
    assert.equal(data[index + 1], 0xaa)
    assert.equal(data[index + 2], 0x77)
  }
  assert.equal(data[3], 255)
  assert.equal(data.at(-1), 96)
})

test('rejects invalid raster colors', async () => {
  const input = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#ffffff00' },
  })
    .png()
    .toBuffer()

  await assert.rejects(
    optimizeAsset(input, 'raster', { color: '#12xz90' }),
    /valid three- or six-digit hex color/,
  )
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
      <path fill="currentColor" stroke="#00f" d="M16 16h8v8h-8z"/>
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
  assert.doesNotMatch(output, /currentColor|#00f/i)
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

  const secondInput = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
  )
  await store.importAsset(secondInput, 'Location Pin.svg', {
    outputWidth: 32,
    outputHeight: 32,
    color: '#f53',
  })
  await store.importAsset(secondInput, 'Location Pin.svg', {
    outputWidth: 32,
    outputHeight: 32,
    color: '#f53',
  })

  const variants = store.snapshot().assets.filter((item) => item.kind === 'svg')
  assert.equal(variants.length, 2)
  assert.ok(variants.some((item) => item.name === 'location-pin_32x32_ff5533.svg'))
  assert.ok(
    variants.some((item) => /^location-pin_32x32_ff5533_[a-f0-9]{8}\.svg$/.test(item.name)),
  )
})

test('removes a local image and its source path, then restores both with Undo', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'picaroo-remove-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'public', 'picaroo'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'remove-test' }))
  const sourceFile = path.join(root, 'src', 'App.tsx')
  const assetFile = path.join(root, 'public', 'picaroo', 'photo.png')
  const source = 'export const App = () => <img src="/picaroo/photo.png" alt="Photo" />'
  const image = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#ff5533' },
  })
    .png()
    .toBuffer()
  await writeFile(sourceFile, source)
  await writeFile(assetFile, image)
  const store = new ProjectStore(root, [])
  await store.initialize()
  const target = store.snapshot().targets[0]

  const removed = await store.remove(target.id, target.version)
  assert.match(await readFile(sourceFile, 'utf8'), /src=""/)
  await assert.rejects(readFile(assetFile), { code: 'ENOENT' })
  assert.equal(removed.history[0].operation, 'remove')

  await store.undo(removed.history[0].id)
  assert.equal(await readFile(sourceFile, 'utf8'), source)
  assert.deepEqual(await readFile(assetFile), image)
})

test('clears embedded Base64 images without requiring a local file', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'picaroo-base64-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'base64-test' }))
  const sourceFile = path.join(root, 'src', 'App.tsx')
  const source =
    'export const App = () => <img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline" />'
  await writeFile(sourceFile, source)
  const store = new ProjectStore(root, [])
  await store.initialize()
  const target = store.snapshot().targets[0]

  const removed = await store.remove(target.id, target.version)
  assert.match(await readFile(sourceFile, 'utf8'), /src=""/)
  await store.undo(removed.history[0].id)
  assert.equal(await readFile(sourceFile, 'utf8'), source)
})

test('recolors an embedded Base64 PNG in place and restores it with Undo', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'picaroo-base64-color-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'base64-color-test' }))
  const sourceFile = path.join(root, 'src', 'App.tsx')
  const image = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#ff000080' },
  })
    .png()
    .toBuffer()
  const originalDataUrl = `data:image/png;base64,${image.toString('base64')}`
  const source = `export const App = () => <img src=${JSON.stringify(originalDataUrl)} alt="Notes" />`
  await writeFile(sourceFile, source)
  const store = new ProjectStore(root, [])
  await store.initialize()
  const target = store.snapshot().targets[0]

  const changed = await store.replace(
    target.id,
    target.version,
    image,
    {
      outputWidth: 16,
      outputHeight: 16,
      color: '#25a06d',
      profile: { ...DEFAULT_PROFILE, format: 'png' },
    },
    'musical-notes.png',
  )
  const editedSource = await readFile(sourceFile, 'utf8')
  const editedDataUrl = /src="(data:image\/png;base64,[^"]+)"/.exec(editedSource)?.[1]

  assert.ok(editedDataUrl)
  assert.notEqual(editedDataUrl, originalDataUrl)
  assert.equal(changed.assets.length, 0)
  const recolored = Buffer.from(editedDataUrl.slice(editedDataUrl.indexOf(',') + 1), 'base64')
  const pixel = await sharp(recolored).ensureAlpha().raw().toBuffer()
  assert.deepEqual([...pixel.subarray(0, 4)], [0x25, 0xa0, 0x6d, 0x80])

  await store.undo(changed.history[0].id)
  assert.equal(await readFile(sourceFile, 'utf8'), source)
})
