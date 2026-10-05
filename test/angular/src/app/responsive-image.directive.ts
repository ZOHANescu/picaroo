import { Directive, input } from '@angular/core'

@Directive({
  selector: 'img[sohImage]',
  host: {
    '[attr.src]': 'sohImage()',
  },
})
export class ResponsiveImageDirective {
  readonly sohImage = input.required<string>()
}
