import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveImageComponents } from './components'

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
