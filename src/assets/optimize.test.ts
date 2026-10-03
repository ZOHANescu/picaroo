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
    /no more than 40 megapixels/,
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
