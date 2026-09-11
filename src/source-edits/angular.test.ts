import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeAngular, replaceAngularReference } from './angular'

test('finds and rewrites static Angular image sources', () => {
  const source = [
    '<img src="assets/hero.png" alt="Hero">',
    '<img [ngSrc]="\'/assets/logo.svg\'" alt="Logo">',
    '<img [src]="card.image" alt="Dynamic">',
  ].join('\n')
  const targets = analyzeAngular(source, 'src/app/home.component.html', 'src/assets/picaroo')

  assert.equal(targets.length, 2)
  assert.deepEqual(
    targets.map((target) => [target.label, target.current, target.kind]),
    [
      ['Hero', 'assets/hero.png', 'raster'],
      ['Logo', '/assets/logo.svg', 'svg'],
    ],
  )
  assert.match(
    replaceAngularReference(source, targets[0], '/assets/picaroo/new.webp'),
    /src="assets\/picaroo\/new\.webp"/,
  )
  assert.match(
    replaceAngularReference(source, targets[1], '/assets/picaroo/new.svg'),
    /\[ngSrc\]="'\/assets\/picaroo\/new\.svg'"/,
  )
})

test('supports static inline Angular templates', () => {
  const source = `@Component({\n  template: \`<img src="assets/card.jpg" alt="Card">\`,\n})\nexport class Card {}`
  const [target] = analyzeAngular(source, 'src/app/card.component.ts', 'src/assets/picaroo')

  assert.equal(target.current, 'assets/card.jpg')
  const output = replaceAngularReference(source, target, '/assets/picaroo/card.webp')
  assert.match(output, /template: \`<img src="assets\/picaroo\/card\.webp" alt="Card">\`/)
})

test('finds PrimeNG image, avatar, and chip components', () => {
  const source = [
    '<p-image src="assets/gallery.webp" alt="Gallery image" [preview]="true" />',
    '<p-avatar [image]="\'assets/person.jpg\'" ariaLabel="Profile photo" />',
    '<p-chip image="assets/member.png" label="Project member" />',
  ].join('\n')
  const targets = analyzeAngular(source, 'src/app/people.component.html', 'src/assets/picaroo')

  assert.deepEqual(
    targets.map((target) => [target.label, target.current]),
    [
      ['Gallery image', 'assets/gallery.webp'],
      ['Profile photo', 'assets/person.jpg'],
      ['Project member', 'assets/member.png'],
    ],
  )
  assert.match(
    replaceAngularReference(source, targets[0], '/assets/picaroo/gallery.webp'),
    /<p-image src="assets\/picaroo\/gallery\.webp"/,
  )
  assert.match(
    replaceAngularReference(source, targets[1], '/assets/picaroo/person.jpg'),
    /\[image\]="'assets\/picaroo\/person\.jpg'"/,
  )
})
