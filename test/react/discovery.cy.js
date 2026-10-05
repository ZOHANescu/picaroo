const discoveries = [
  { name: 'a literal native image', label: 'React literal image' },
  { name: 'an imported asset', label: 'React imported asset' },
  { name: 'a registered image component', label: 'Registered image component' },
  { name: 'a registered empty image slot', label: 'Registered empty image slot' },
  { name: 'a direct JSON image field', label: 'Direct JSON image' },
  { name: 'the first direct JSON map record', label: 'JSON gallery image one' },
  { name: 'the second direct JSON map record', label: 'JSON gallery image two' },
  { name: 'the third direct JSON map record', label: 'JSON gallery image three' },
  { name: 'an embedded Base64 image', label: 'React embedded Base64 image' },
  { name: 'a responsive fallback', label: 'Responsive React image' },
  { name: 'a responsive 1x candidate', label: 'Responsive React image · 1x' },
  { name: 'a responsive 2x candidate', label: 'Responsive React image · 2x' },
  { name: 'an inline-style background', label: 'Background · Inline React background' },
  { name: 'a stylesheet background', label: 'Background · .react-css-background' },
  { name: 'an inline SVG', label: 'SVG · Inline React SVG' },
  { name: 'an image rendered after initial mount', label: 'Delayed React image' },
]

describe('React image discovery', () => {
  beforeEach(() => {
    cy.visit('/')
    cy.get('[data-testid="connection-status"]', { timeout: 20_000 }).should(
      'contain.text',
      'React · Local project',
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
        .should('match', /^[a-f0-9]{20}(?::\d+)?$/)
    })
  }

  after(() => {
    cy.get('[data-testid="page-image-card"]', { timeout: 20_000 })
      .should('have.length', discoveries.length)
      .then(($cards) => {
        const labels = [...$cards].map((card) => card.querySelector('strong')?.textContent?.trim())
        cy.task('reportDiscovery', {
          framework: 'React',
          expected: discoveries.length,
          found: $cards.length,
          labels,
        })
      })
  })
})
