const discoveries = [
  { name: 'a root-absolute image path', label: 'Root absolute image' },
  { name: 'a relative image path', label: 'Relative image' },
  { name: 'a dot-relative image path', label: 'Dot-relative image' },
  { name: 'an image path with a query and hash', label: 'Image with query and hash' },
  { name: 'an embedded Base64 image', label: 'Embedded Base64 image' },
  { name: 'an image with multiline markup', label: 'Multiline image' },
  { name: 'a responsive image fallback', label: 'Responsive image fallback' },
  { name: 'a picture fallback', label: 'Picture fallback' },
  { name: 'an image with single-quoted attributes', label: 'Single quoted image' },
  { name: 'an image rendered after initial page load', label: 'Delayed image' },
  { name: 'a stylesheet background image', label: 'Background · .fixture-background' },
  {
    name: 'a background image inside an active media query',
    label: 'Background · .fixture-media-background',
  },
]

describe('plain HTML image discovery', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.get('[data-testid="connection-status"]', { timeout: 20_000 }).should(
      'contain.text',
      'HTML · Local project',
    )
  })

  for (const discovery of discoveries) {
    it(`discovers ${discovery.name}`, () => {
      cy.contains('[data-testid="page-image-card"] strong', discovery.label, {
        timeout: 20_000,
      })
        .parents('[data-testid="page-image-card"]')
        .should('have.length', 1)
        .and('not.contain.text', 'Needs mapping')
        .invoke('attr', 'data-picaroo-target-id')
        .should('match', /^[a-f0-9]{20}$/)
    })
  }

  after(() => {
    cy.get('[data-testid="page-image-card"]', { timeout: 20_000 })
      .should('have.length', discoveries.length)
      .then(($cards) => {
        const labels = [...$cards].map((card) => card.querySelector('strong')?.textContent?.trim())
        cy.task('reportDiscovery', {
          framework: 'HTML',
          expected: discoveries.length,
          found: $cards.length,
          labels,
        })
      })
  })
})
