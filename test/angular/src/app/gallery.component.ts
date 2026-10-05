import { Component, computed, input } from '@angular/core'
import { ResponsiveImageDirective } from './responsive-image.directive'

export interface GalleryImage {
  src: string
  alt: string
}

@Component({
  selector: 'app-gallery',
  imports: [ResponsiveImageDirective],
  templateUrl: './gallery.component.html',
})
export class GalleryComponent {
  readonly images = input.required<readonly GalleryImage[]>()
  readonly visibleImages = computed(() =>
    this.images().map((image, originalIndex) => ({ image, originalIndex })),
  )
}
