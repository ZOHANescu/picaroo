import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAngularImageSources } from '../integrations/components'
import { analyzeAngular, replaceAngularReference } from './angular'

test('finds Base64 image sources', () => {
  const source = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline">'
  const target = analyzeAngular(source, 'src/app.component.html')[0]
  assert.equal(target.current, 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(target.kind, 'raster')
})

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

test('finds static and bound custom image directive sources', () => {
  const template = `
    <img sohImage="/assets/static.webp" alt="Static directive image" />
    <img [sohImage]="hero.src" [alt]="hero.alt" />
  `
  const component = `
    export class HomeComponent {
      readonly hero = { src: '/assets/hero.webp', alt: 'Bound directive image' }
    }
  `
  const targets = analyzeAngular(
    template,
    'src/app/home.component.html',
    'src/assets/picaroo',
    { file: 'src/app/home.component.ts', source: component },
    [],
    [{ tag: 'img', attributes: ['sohImage'], labelAttributes: ['alt'] }],
  )

  assert.deepEqual(
    targets.map((target) => [target.label, target.current]),
    [
      ['Static directive image', '/assets/static.webp'],
      ['Bound directive image', '/assets/hero.webp'],
    ],
  )
  assert.match(
    replaceAngularReference(template, targets[0], '/assets/picaroo/static.webp'),
    /sohImage="\/assets\/picaroo\/static\.webp"/,
  )
  assert.match(
    replaceAngularReference(component, targets[1], '/assets/picaroo/hero.webp'),
    /src: '\/assets\/picaroo\/hero\.webp'/,
  )
})

test('resolves image arrays passed to a reusable child component input', () => {
  const parentTemplate = '<app-gallery [images]="galleryImages" />'
  const parentComponent = `
    export class HomeComponent {
      readonly galleryImages = [
        { src: '/assets/one.webp', alt: 'Gallery one' },
        { src: '/assets/two.webp', alt: 'Gallery two' },
        { src: '/assets/three.webp', alt: 'Gallery three' }
      ] as const
    }
  `
  const childComponent = `
    export class GalleryComponent {
      readonly images = input.required<readonly GalleryImage[]>()
      readonly visibleImages = computed(() =>
        this.images().map((image, originalIndex) => ({ image, originalIndex }))
      )
    }
  `
  const galleryTemplate = `
    @for (item of visibleImages(); track item.originalIndex) {
      <img [sohImage]="item.image.src" [alt]="item.image.alt" />
    }
  `
  const targets = analyzeAngular(
    parentTemplate,
    'src/app/home.component.html',
    'src/assets/picaroo',
    { file: 'src/app/home.component.ts', source: parentComponent },
    [{
      selector: 'app-gallery',
      file: 'src/app/gallery.component.html',
      source: galleryTemplate,
      component: { file: 'src/app/gallery.component.ts', source: childComponent },
    }],
    [{ tag: 'img', attributes: ['sohImage'], labelAttributes: ['alt'] }],
  )

  assert.deepEqual(
    targets.map((target) => [target.file, target.label, target.current]),
    [
      ['src/app/home.component.ts', 'Gallery one', '/assets/one.webp'],
      ['src/app/home.component.ts', 'Gallery two', '/assets/two.webp'],
      ['src/app/home.component.ts', 'Gallery three', '/assets/three.webp'],
    ],
  )
})

test('requires custom Angular image sources to be declared', () => {
  const template = '<img sohImage="/assets/custom.webp" alt="Custom image" />'
  assert.deepEqual(analyzeAngular(template, 'src/app/home.component.html'), [])
})

test('supports configured Angular custom image elements', () => {
  const template = '<app-photo [imageUrl]="\'/assets/custom.webp\'" label="Custom photo" />'
  const targets = analyzeAngular(
    template,
    'src/app/home.component.html',
    'src/assets/picaroo',
    undefined,
    [],
    [{ tag: 'app-photo', attributes: ['imageUrl'], labelAttributes: ['label'] }],
  )
  assert.deepEqual(
    targets.map((target) => [target.label, target.current]),
    [['Custom photo', '/assets/custom.webp']],
  )
})

test('does not duplicate targets from repeated Angular image source declarations', () => {
  const imageSources = resolveAngularImageSources({
    picaroo: {
      angular: {
        imageSources: [
          { tag: 'app-photo', attributes: ['imageUrl'], labelAttributes: ['label'] },
          { tag: 'app-photo', attributes: ['imageUrl'], labelAttributes: ['label'] },
        ],
      },
    },
  })
  const targets = analyzeAngular(
    '<app-photo imageUrl="/assets/custom.webp" label="Only once" />',
    'src/app/home.component.html',
    'src/assets/picaroo',
    undefined,
    [],
    imageSources,
  )
  assert.equal(targets.length, 1)
  assert.equal(targets[0].label, 'Only once')
})
