import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { optimizeAsset } from './optimize'

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
