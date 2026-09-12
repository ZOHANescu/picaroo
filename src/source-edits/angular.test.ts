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

test('rewrites direct image fields in readonly Angular component objects', () => {
  const template = `
    <img [src]="images.hero.src" [alt]="images.hero.alt" />
    <img [ngSrc]="heroImage.src" [alt]="heroImage.alt" />
  `
  const component = `
    import { Component } from '@angular/core'
    interface ImageAsset { src: string; alt: string }
    @Component({ templateUrl: './home.component.html' })
    export class HomeComponent {
      readonly images = {
        hero: { src: '/assets/hero.webp', alt: 'SOH at sunset' }
      } satisfies Record<string, ImageAsset>
      readonly heroImage: ImageAsset = {
        src: '/assets/about.jpg',
        alt: 'About SOH'
      }
    }
  `
  const targets = analyzeAngular(template, 'src/app/home.component.html', 'src/assets/picaroo', {
    file: 'src/app/home.component.ts',
    source: component,
  })

  assert.deepEqual(
    targets.map((target) => [target.file, target.label, target.current]),
    [
      ['src/app/home.component.ts', 'SOH at sunset', '/assets/hero.webp'],
      ['src/app/home.component.ts', 'About SOH', '/assets/about.jpg'],
    ],
  )
  assert.match(
    replaceAngularReference(component, targets[0], '/assets/picaroo/replacement.webp'),
    /src: '\/assets\/picaroo\/replacement\.webp'/,
  )
})

test('resolves Angular @for arrays and PrimeNG carousel item templates', () => {
  const template = `
    @for (space of cabinSpaces; track space.title) {
      <img [ngSrc]="space.image.src" [alt]="space.image.alt" />
    }
    <p-carousel [value]="galleryImages">
      <ng-template #item let-image>
        <p-image [src]="image.src" [alt]="image.alt">
          <ng-template #image><img [src]="image.src" [alt]="image.alt" /></ng-template>
        </p-image>
      </ng-template>
    </p-carousel>
  `
  const component = `
    export class GalleryComponent {
      readonly cabinSpaces = [
        { image: { src: '/assets/bedroom.webp', alt: 'Bedroom' }, title: 'Bed' },
        { image: { src: '/assets/kitchen.webp', alt: 'Kitchen' }, title: 'Kitchen' }
      ] as const
      readonly galleryImages = [
        { src: '/assets/one.webp', alt: 'One' },
        { src: '/assets/two.webp', alt: 'Two' }
      ]
    }
  `
  const targets = analyzeAngular(template, 'src/app/gallery.component.html', 'src/assets/picaroo', {
    file: 'src/app/gallery.component.ts',
    source: component,
  })

  assert.deepEqual(
    targets.map((target) => [target.label, target.current]),
    [
      ['Bedroom', '/assets/bedroom.webp'],
      ['Kitchen', '/assets/kitchen.webp'],
      ['One', '/assets/one.webp'],
      ['Two', '/assets/two.webp'],
    ],
  )
})
