import { createServer as createHttpServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cypress from 'cypress'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const framework = process.argv[2] ?? 'html'
const suites = {
  html: { appPort: 4401, editorPort: 4501, previewPort: 4601 },
  react: { appPort: 4402, editorPort: 4502, previewPort: 4602 },
  angular: { appPort: 4403, editorPort: 4503, previewPort: 4603 },
}
const suite = suites[framework]
if (!suite) throw new Error(`Unknown E2E framework "${framework}". Choose: ${Object.keys(suites).join(', ')}.`)
const environment = `PICAROO_TEST_${framework.toUpperCase()}`
const fixtureSource = path.join(root, 'test', framework)
const appPort = Number(process.env[`${environment}_PORT`] ?? suite.appPort)
const editorPort = Number(process.env[`${environment}_EDITOR_PORT`] ?? suite.editorPort)
const previewPort = Number(process.env[`${environment}_PREVIEW_PORT`] ?? suite.previewPort)
const appUrl = `http://localhost:${appPort}`
const editorUrl = `http://localhost:${editorPort}`
const previewUrl = `http://localhost:${previewPort}`
const resultFile = path.join(root, 'test', 'results', `${framework}.json`)
const mime = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
])

let picaroo
let fixture
let stopping = false

function staticServer() {
  return createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', appUrl).pathname)
      const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
      const file = path.resolve(fixture, requested)
      const relative = path.relative(fixture, file)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        response.writeHead(403).end('Forbidden')
        return
      }
      await access(file)
      const body = await readFile(file)
      response.writeHead(200, {
        'Content-Type': mime.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
    }
  })
}

async function startApplication() {
  if (framework === 'html') {
    const server = staticServer()
    await listen(server, appPort)
    return { close: () => closeHttpServer(server) }
  }
  if (framework === 'angular') {
    await symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction')
    const child = spawn(
      process.execPath,
      [
        path.join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
        'serve',
        '--host',
        'localhost',
        '--port',
        String(appPort),
        '--configuration',
        'development',
      ],
      { cwd: fixture, stdio: 'inherit' },
    )
    await waitFor(appUrl, 'Angular fixture', child)
    return { close: () => stopChild(child) }
  }
  const child = spawn(
    process.execPath,
    [path.join(root, 'test', 'start-react.mjs'), fixture, String(appPort), editorUrl],
    { cwd: root, stdio: 'inherit' },
  )
  await waitFor(appUrl, 'React fixture', child)
  return { close: () => stopChild(child) }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, 'localhost', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function waitFor(url, label, child) {
  const deadline = Date.now() + 30_000
  let lastError = ''
  const parsed = new URL(url)
  const candidates = [url]
  if (parsed.hostname === 'localhost') {
    for (const hostname of ['127.0.0.1', '[::1]']) {
      parsed.hostname = hostname
      candidates.push(parsed.href)
    }
  }
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null)
      throw new Error(`${label} stopped before it became ready (exit ${child.exitCode}).`)
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate)
        if (response.ok) return
        lastError = `${candidate}: HTTP ${response.status}`
      } catch (error) {
        const cause = error instanceof Error && 'cause' in error ? error.cause : undefined
        const detail =
          cause && typeof cause === 'object' && 'code' in cause ? ` (${cause.code})` : ''
        lastError = `${candidate}: ${error instanceof Error ? error.message : String(error)}${detail}`
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return
  child.kill()
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
}

async function closeHttpServer(server) {
  if (!server.listening) return
  await new Promise((resolve) => server.close(resolve))
}

async function main() {
  await rm(resultFile, { force: true })
  const temporaryPrefix = `picaroo-e2e-${framework}-`
  fixture = await mkdtemp(path.join(tmpdir(), temporaryPrefix))
  await cp(fixtureSource, fixture, { recursive: true })
  let app
  const stop = async () => {
    if (stopping) return
    stopping = true
    await stopChild(picaroo)
    await app?.close()
    const temporaryRoot = path.resolve(tmpdir())
    const runtimeRoot = path.resolve(fixture)
    if (
      path.dirname(runtimeRoot) === temporaryRoot &&
      path.basename(runtimeRoot).startsWith(temporaryPrefix)
    )
      await rm(runtimeRoot, { recursive: true, force: true })
  }
  process.once('SIGINT', () => void stop().finally(() => process.exit(130)))
  process.once('SIGTERM', () => void stop().finally(() => process.exit(143)))

  try {
    app = await startApplication()
    await waitFor(appUrl, `${framework} fixture`)
    console.log(`${framework.toUpperCase()} fixture ready at ${appUrl}`)
    picaroo = spawn(
      process.execPath,
      [
        path.join(root, 'bin', 'picaroo.mjs'),
        '--url',
        appUrl,
        '--port',
        String(editorPort),
        '--preview-port',
        String(previewPort),
        '--project',
        fixture,
      ],
      { cwd: root, stdio: 'inherit' },
    )
    await Promise.all([
      waitFor(editorUrl, 'Picaroo editor', picaroo),
      waitFor(previewUrl, 'Picaroo preview', picaroo),
    ])
    console.log(`Starting Cypress for ${framework} discovery...`)
    const result = await cypress.run({
      browser: 'electron',
      configFile: path.join(root, 'test', 'cypress.config.mjs'),
      spec: path.join(root, 'test', framework, 'discovery.cy.js'),
      config: { baseUrl: editorUrl },
      env: { resultFile },
    })
    console.log(`Cypress finished for ${framework} discovery.`)
    if ('status' in result && result.status === 'failed') {
      console.error(result.message)
      process.exitCode = 1
    } else if ('totalFailed' in result && result.totalFailed > 0) {
      process.exitCode = 1
    }
  } finally {
    await stop()
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
