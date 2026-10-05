import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAngularImageSource,
  resolveAngularImageSources,
  resolveImageComponents,
} from './components'

test('shares configured components with optional CLI or plugin additions', () => {
  const manifest = {
    picaroo: { components: ['ImagePlaceholder', 'MediaSlot', 'ImagePlaceholder'] },
  }
  assert.deepEqual(resolveImageComponents(manifest, ['ProjectImage', 'MediaSlot']), [
    'ImagePlaceholder',
    'MediaSlot',
    'ProjectImage',
  ])
})

test('rejects invalid component configuration', () => {
  assert.throws(
    () => resolveImageComponents({ picaroo: { components: 'ImagePlaceholder' } }),
    /must be an array/,
  )
  assert.throws(() => resolveImageComponents({}, ['Gallery.Image']), /Invalid Picaroo/)
})

test('resolves and merges Angular image source configuration', () => {
  const manifest = {
    picaroo: {
      angular: {
        imageSources: [
          { tag: 'img', attributes: ['sohImage'], labelAttributes: ['alt'] },
          { tag: 'app-photo', attributes: ['imageUrl'], labelAttributes: ['label'] },
          { tag: 'img', attributes: ['sohImage', 'fallbackImage'] },
        ],
      },
    },
  }

  assert.deepEqual(resolveAngularImageSources(manifest), [
    {
      tag: 'img',
      attributes: ['sohimage', 'fallbackimage'],
      labelAttributes: ['alt'],
    },
    { tag: 'app-photo', attributes: ['imageurl'], labelAttributes: ['label'] },
  ])
})

test('merges package and additive Angular image sources', () => {
  const manifest = {
    picaroo: {
      angular: {
        imageSources: [{ tag: 'img', attributes: ['sohImage'] }],
      },
    },
  }
  assert.deepEqual(
    resolveAngularImageSources(manifest, [
      { tag: 'app-photo', attributes: ['url'], labelAttributes: ['ariaLabel'] },
    ]),
    [
      { tag: 'img', attributes: ['sohimage'], labelAttributes: ['alt'] },
      { tag: 'app-photo', attributes: ['url'], labelAttributes: ['arialabel'] },
    ],
  )
})

test('rejects invalid Angular image source configuration', () => {
  assert.throws(
    () => resolveAngularImageSources({ picaroo: { angular: { imageSources: 'sohImage' } } }),
    /must be an array/,
  )
  assert.throws(
    () =>
      resolveAngularImageSources({
        picaroo: { angular: { imageSources: [{ tag: 'AppPhoto', attributes: ['src'] }] } },
      }),
    /Invalid Angular image source tag/,
  )
  assert.throws(
    () =>
      resolveAngularImageSources({
        picaroo: { angular: { imageSources: [{ tag: 'img', attributes: [] }] } },
      }),
    /attributes must be a non-empty array/,
  )
  assert.throws(
    () =>
      resolveAngularImageSources({
        picaroo: { angular: { imageSources: [{ tag: 'img', attributes: ['[source]'] }] } },
      }),
    /Invalid Angular image source attribute/,
  )
})

test('parses repeatable Angular image source CLI declarations', () => {
  assert.deepEqual(parseAngularImageSource('img:sohImage'), {
    tag: 'img',
    attributes: ['sohimage'],
    labelAttributes: ['alt'],
  })
  assert.deepEqual(parseAngularImageSource('app-photo:imageUrl:label'), {
    tag: 'app-photo',
    attributes: ['imageurl'],
    labelAttributes: ['label'],
  })
})

test('rejects malformed Angular image source CLI declarations', () => {
  assert.throws(() => parseAngularImageSource('sohImage'), /Use tag:sourceAttribute/)
  assert.throws(() => parseAngularImageSource('img::alt'), /Use tag:sourceAttribute/)
  assert.throws(() => parseAngularImageSource('img:source:alt:extra'), /Use tag:sourceAttribute/)
  assert.throws(() => parseAngularImageSource('AppPhoto:src'), /Invalid Angular image source tag/)
})
