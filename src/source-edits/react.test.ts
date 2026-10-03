import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze, instrument } from './react'

test('instruments native images and registered React image components', () => {
  const source = `
    export function Gallery() {
      return <>
        <ImagePlaceholder label="Hero" />
        <MediaSlot src="/images/gallery.webp" label="Gallery" />
        <img src="/images/logo.png" alt="Logo" />
      </>
    }
  `
  const targets = analyze(source, 'src/Gallery.tsx', ['ImagePlaceholder', 'MediaSlot'])
  const output = instrument(source, targets).code

  assert.equal(targets.length, 3)
  assert.equal(targets[0].editable, true)
  assert.equal(targets[0].current, '')
  for (const target of targets) assert.match(output, new RegExp(`data-picaroo-id="${target.id}"`))
})

test('does not treat unregistered React components as image slots', () => {
  const source = '<><Card src="/images/card.webp" /><img src="/images/photo.webp" /></>'
  const targets = analyze(source, 'src/App.tsx', [])
  assert.equal(targets.length, 1)
  assert.equal(targets[0].current, '/images/photo.webp')
})
