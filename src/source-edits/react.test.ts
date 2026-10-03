import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze, instrument } from './react'
import { replaceVisual } from './visual'

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

test('updates inline SVG dimensions when replacing its vector content', () => {
  const source = '<svg width="24" viewBox="0 0 24 12"><path d="M0 0h24v12H0z" /></svg>'
  const target = analyze(source, 'src/Icon.tsx', []).find(
    (candidate) => candidate.presentation === 'inline-svg',
  )!
  const replacement = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><circle cx="20" cy="10" r="10"/></svg>',
  )

  const output = replaceVisual(
    source,
    target,
    'public/picaroo/icon_80x40.svg',
    replacement,
    80,
    40,
  )

  assert.match(output, /width=\{80\}/)
  assert.match(output, /height=\{40\}/)
  assert.match(output, /viewBox="0 0 40 20"/)
})
