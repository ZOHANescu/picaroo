import { Component, input } from '@angular/core'

export interface GalleryImage {
  src: string
  alt: string
}

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.component.html',
})
export class GalleryComponent {
  readonly images = input.required<readonly GalleryImage[]>()
}
