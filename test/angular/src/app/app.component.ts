import { NgOptimizedImage } from '@angular/common'
import { Component, OnInit, signal } from '@angular/core'
import { GalleryComponent, type GalleryImage } from './gallery.component'
import { InlineImageComponent } from './inline-image.component'
import {
  PrimeAvatarStubComponent,
  PrimeChipStubComponent,
  PrimeImageStubComponent,
} from './prime-image-stubs.component'
import { ResponsiveImageDirective } from './responsive-image.directive'

interface FixtureImage {
  src: string
  alt: string
}

@Component({
  selector: 'app-root',
  imports: [
    GalleryComponent,
    InlineImageComponent,
    NgOptimizedImage,
    PrimeAvatarStubComponent,
    PrimeChipStubComponent,
    PrimeImageStubComponent,
    ResponsiveImageDirective,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  readonly images = {
    hero: { src: '/assets/object-hero.svg', alt: 'Angular readonly object hero' },
    secondary: { src: '/assets/object-secondary.svg', alt: 'Angular readonly object secondary' },
  } satisfies Record<string, FixtureImage>

  readonly loopImages: readonly FixtureImage[] = [
    { src: '/assets/loop-one.svg', alt: 'Angular loop image one' },
    { src: '/assets/loop-two.svg', alt: 'Angular loop image two' },
    { src: '/assets/loop-three.svg', alt: 'Angular loop image three' },
  ]

  readonly directiveImage = {
    src: '/assets/directive-bound.svg',
    alt: 'Angular custom directive bound image',
  }

  readonly galleryImages: readonly GalleryImage[] = [
    { src: '/assets/gallery-one.svg', alt: 'Angular gallery image one' },
    { src: '/assets/gallery-two.svg', alt: 'Angular gallery image two' },
    { src: '/assets/gallery-three.svg', alt: 'Angular gallery image three' },
  ]

  readonly delayedImage = {
    src: '/assets/delayed.svg',
    alt: 'Delayed Angular image',
  }

  readonly showDelayed = signal(false)

  ngOnInit(): void {
    window.setTimeout(() => this.showDelayed.set(true), 250)
  }
}
