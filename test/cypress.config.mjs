import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4501',
    specPattern: 'test/**/*.cy.js',
    supportFile: false,
    setupNodeEvents(on) {
      on('task', {
        reportDiscovery({ framework, expected, found, labels = [] }) {
          const result = expected === found ? 'SUCCESS' : 'FAILED'
          console.log(`${framework.padEnd(9)} ${String(expected).padStart(3)} expected  ${String(found).padStart(3)} found  ${result}`)
          if (result === 'FAILED') console.log(`Found: ${labels.join(', ')}`)
          return null
        },
      })
    },
  },
  screenshotsFolder: 'test/results/screenshots',
  videosFolder: 'test/results/videos',
  video: false,
  viewportWidth: 1440,
  viewportHeight: 900,
})
