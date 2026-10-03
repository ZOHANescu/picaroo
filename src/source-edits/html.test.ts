import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeHtml, replaceHtmlReference } from './html'

test('finds and rewrites static HTML images', () => {
  const source = [
    '<img src="/images/hero.jpg" alt="Hero">',
    "<img src='images/logo.svg' alt='Logo'>",
    '<img src="data:image/png;base64,abc" alt="Inline">',
  ].join('\n')
  const targets = analyzeHtml(source, 'index.html')

  assert.deepEqual(
    targets.map((target) => [target.label, target.current, target.kind]),
    [
      ['Hero', '/images/hero.jpg', 'raster'],
      ['Logo', 'images/logo.svg', 'svg'],
    ],
  )
  assert.match(
    replaceHtmlReference(source, targets[0], '/picaroo/replacement.webp'),
    /src="\/picaroo\/replacement\.webp"/,
  )
  assert.match(
    replaceHtmlReference(source, targets[1], '/picaroo/replacement.svg'),
    /src='picaroo\/replacement\.svg'/,
  )
})
