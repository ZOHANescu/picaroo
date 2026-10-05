import { Component, input } from '@angular/core'

@Component({
  selector: 'p-image',
  template: `<img [src]="src()" [alt]="alt()" />`,
})
export class PrimeImageStubComponent {
  readonly src = input('')
  readonly alt = input('')
}

@Component({
  selector: 'p-avatar',
  template: `<img [src]="image()" [alt]="ariaLabel() || label()" />`,
})
export class PrimeAvatarStubComponent {
  readonly image = input('')
  readonly ariaLabel = input('')
  readonly label = input('')
}

@Component({
  selector: 'p-chip',
  template: `<img [src]="image()" [alt]="label()" />`,
})
export class PrimeChipStubComponent {
  readonly image = input('')
  readonly label = input('')
}
