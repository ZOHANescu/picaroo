const expectedLabels = [
  'Root absolute image',
  'Relative image',
  'Dot-relative image',
  'Image with query and hash',
  'Embedded Base64 image',
  'Multiline image',
  'Responsive image fallback',
  'Picture fallback',
  'Single quoted image',
  'Delayed image',
  'Background · .fixture-background',
  'Background · .fixture-media-background',
]

describe('plain HTML image discovery', () => {
  it('discovers every supported visible image in the fixture', () => {
    cy.visit('/')
    cy.get('[data-testid="connection-status"]', { timeout: 20_000 }).should(
      'contain.text',
      'HTML · Local project',
    )
    cy.get('[data-testid="page-images-count"]', { timeout: 20_000 }).should(
      'have.text',
      String(expectedLabels.length),
    )
    cy.get('[data-testid="page-images-editable-count"]').should(
      'have.text',
      `${expectedLabels.length} editable`,
    )
    cy.get('[data-testid="page-image-card"]')
      .should('have.length', expectedLabels.length)
      .then(($cards) => {
        const labels = [...$cards].map((card) => card.querySelector('strong')?.textContent?.trim())
        expect(labels).to.have.members(expectedLabels)
        cy.task('reportDiscovery', {
          framework: 'HTML',
          expected: expectedLabels.length,
          found: $cards.length,
          labels,
        })
      })
    cy.get('[data-testid="page-image-card"]')
      .should('not.contain.text', 'Needs mapping')
      .each(($card) => expect($card.attr('data-picaroo-target-id')).to.match(/^[a-f0-9]{20}$/))
  })
})
