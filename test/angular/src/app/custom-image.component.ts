import { Component, input } from '@angular/core'

@Component({
  selector: 'app-photo',
  template: `<img [src]="imageUrl()" [alt]="label()" />`,
})
export class CustomImageComponent {
  readonly imageUrl = input.required<string>()
  readonly label = input.required<string>()
}
