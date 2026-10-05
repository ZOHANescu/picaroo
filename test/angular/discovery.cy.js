const discoveries = [
  { name: 'a static image source', label: 'Angular static image' },
  { name: 'a bound literal image source', label: 'Angular bound literal image' },
  { name: 'an ngSrc image source', label: 'Angular ngSrc image' },
  { name: 'an embedded Base64 image', label: 'Angular embedded Base64 image' },
  { name: 'a readonly object hero image', label: 'Angular readonly object hero' },
  { name: 'a readonly object secondary image', label: 'Angular readonly object secondary' },
  { name: 'the first readonly @for image', label: 'Angular loop image one' },
  { name: 'the second readonly @for image', label: 'Angular loop image two' },
  { name: 'the third readonly @for image', label: 'Angular loop image three' },
  { name: 'an image in an inline component template', label: 'Angular inline template' },
  { name: 'a PrimeNG image component', label: 'PrimeNG image' },
  { name: 'a PrimeNG avatar component', label: 'PrimeNG avatar' },
  { name: 'a PrimeNG chip component', label: 'PrimeNG chip' },
  { name: 'a stylesheet background image', label: 'Background · .angular-css-background' },
  { name: 'an image rendered by a delayed @if', label: 'Delayed Angular image' },
  { name: 'a static SOH-style image directive', label: 'Angular custom directive static image' },
  { name: 'a bound SOH-style image directive', label: 'Angular custom directive bound image' },
  { name: 'the first reusable gallery input record', label: 'Angular gallery image one' },
  { name: 'the second reusable gallery input record', label: 'Angular gallery image two' },
  { name: 'the third reusable gallery input record', label: 'Angular gallery image three' },
]

describe('Angular image discovery', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.get('[data-testid="connection-status"]', { timeout: 30_000 }).should(
      'contain.text',
      'Angular · Local project',
    )
  })

  for (const discovery of discoveries) {
    it(`discovers ${discovery.name}`, () => {
      cy.contains('[data-testid="page-image-card"] strong', discovery.label, {
        timeout: 10_000,
      })
        .parents('[data-testid="page-image-card"]')
        .should('have.length', 1)
        .and('not.contain.text', 'Needs mapping')
        .invoke('attr', 'data-picaroo-target-id')
        .should('match', /^[a-f0-9]{20}$/)
    })
  }

  after(() => {
    cy.get('[data-testid="page-image-card"]', { timeout: 10_000 }).then(($cards) => {
      const labels = [...$cards].map((card) => card.querySelector('strong')?.textContent?.trim())
      cy.task('reportDiscovery', {
        framework: 'Angular',
        expected: discoveries.length,
        found: $cards.length,
        labels,
      })
    })
  })
})
