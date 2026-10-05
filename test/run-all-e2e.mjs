import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const frameworks = ['html', 'react', 'angular']
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
    const discoveryResult = execution.exitCode === 0 ? result.result : 'FAILED'
    return {
      framework: result.framework,
      expected: result.expected,
      found: result.found,
      result: discoveryResult,
      exitCode: execution.exitCode,
    }
  } catch (error) {
    return {
      framework: framework[0].toUpperCase() + framework.slice(1),
      expected: '—',
      found: '—',
      result: 'ERROR',
      exitCode: execution.exitCode,
      error: execution.error?.message ?? (error instanceof Error ? error.message : String(error)),
    }
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

console.log(`\n${'='.repeat(72)}`)
console.log('PICAROO IMAGE DISCOVERY STABILITY')
console.log('='.repeat(72))
console.log('Framework  Expected  Found  Result')
for (const result of results) {
  console.log(
    `${result.framework.padEnd(10)} ${String(result.expected).padStart(8)}  ${String(result.found).padStart(5)}  ${result.result}`,
  )
  if (result.error) console.log(`           ${result.error}`)
}

const stable = results.length === frameworks.length && results.every((result) => {
  return result.result === 'SUCCESS' && result.exitCode === 0
})
console.log('-'.repeat(72))
console.log(`PICAROO STABILITY: ${stable ? 'SUCCESS' : 'FAILED'}`)
process.exitCode = stable ? 0 : 1
