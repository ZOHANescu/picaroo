import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  errorResult,
  formatStabilityReport,
  isStable,
  normalizeDiscoveryResult,
} from './e2e-report.mjs'
import { frameworks } from './e2e-suites.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
let activeChild
let interrupted = false

async function runFramework(framework) {
  const resultFile = path.join(root, 'test', 'results', `${framework}.json`)
  await rm(resultFile, { force: true })
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(72)}`)
    console.log(`Running ${framework.toUpperCase()} image discovery suite`)
    console.log('='.repeat(72))
    activeChild = spawn(
      process.execPath,
      [path.join(root, 'test', 'run-e2e.mjs'), framework],
      { cwd: root, stdio: 'inherit' },
    )
    activeChild.once('error', (error) => {
      activeChild = undefined
      resolve({ exitCode: 1, error })
    })
    activeChild.once('exit', (code, signal) => {
      activeChild = undefined
      resolve({ exitCode: code ?? 1, signal })
    })
  })
}

async function readDiscoveryResult(framework, execution) {
  const resultFile = path.join(root, 'test', 'results', `${framework}.json`)
  try {
    const result = JSON.parse(await readFile(resultFile, 'utf8'))
    return normalizeDiscoveryResult(framework, execution, result)
  } catch (error) {
    return errorResult(framework, execution, error)
  }
}

async function stop() {
  interrupted = true
  if (!activeChild || activeChild.exitCode !== null || activeChild.killed) return
  activeChild.kill()
  await Promise.race([
    once(activeChild, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
}

process.once('SIGINT', () => void stop().finally(() => process.exit(130)))
process.once('SIGTERM', () => void stop().finally(() => process.exit(143)))

const results = []
for (const framework of frameworks) {
  const execution = await runFramework(framework)
  results.push(await readDiscoveryResult(framework, execution))
  if (interrupted) break
}

const stable = isStable(results, frameworks)
console.log(`\n${formatStabilityReport(results, stable)}`)
process.exitCode = stable ? 0 : 1
