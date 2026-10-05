import { defineConfig } from 'cypress'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4501',
    specPattern: 'test/**/*.cy.js',
    supportFile: false,
    setupNodeEvents(on, config) {
      on('task', {
        async reportDiscovery({ framework, expected, found, labels = [] }) {
          const result = expected === found ? 'SUCCESS' : 'FAILED'
          console.log(`${framework.padEnd(9)} ${String(expected).padStart(3)} expected  ${String(found).padStart(3)} found  ${result}`)
          if (result === 'FAILED') console.log(`Found: ${labels.join(', ')}`)
          const resultFile = config.env.resultFile
          if (typeof resultFile === 'string' && resultFile.length > 0) {
            await mkdir(path.dirname(resultFile), { recursive: true })
            await writeFile(
              resultFile,
              `${JSON.stringify({ framework, expected, found, result, labels }, null, 2)}\n`,
              'utf8',
            )
          }
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
