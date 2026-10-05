import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { PicarooService } from './server/picaroo-service'
import { createPreviewGateway } from './server/preview-gateway'
import { detectProjectIntegration } from './integrations/project'
import {
  parseAngularImageSource,
  resolveAngularImageSources,
  resolveImageComponents,
} from './integrations/components'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4200' },
    port: { type: 'string', default: '4310' },
    'preview-port': { type: 'string' },
    project: { type: 'string', default: process.cwd() },
    component: { type: 'string', multiple: true },
    'angular-image-source': { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  process.stdout.write(
    'Picaroo — local image editing\n\n' +
      'picaroo --url http://localhost:4200 [--port 4310] [--preview-port 4311] [--project .]\n' +
      '        [--component ImagePlaceholder --component MediaSlot]\n' +
      '        [--angular-image-source img:sohImage:alt]\n\n' +
      'Start your application normally, then run this command.\n',
  )
} else {
  const target = new URL(values.url!)
  if (
    target.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.username ||
    target.password
  )
    throw new Error('Use an http://localhost URL for your running development app.')

  const projectRoot = path.resolve(values.project!)
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const picarooPkg = JSON.parse(
    await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  )
  const integration = await detectProjectIntegration(projectRoot, pkg)
  const framework = integration.label
  const components = resolveImageComponents(pkg, values.component)
  const angularImageSources = resolveAngularImageSources(
    pkg,
    (values['angular-image-source'] ?? []).map(parseAngularImageSource),
  )
  const port = validPort(values.port, 'editor')
  const previewPort = validPort(values['preview-port'] ?? String(port + 1), 'preview')
  if (previewPort === port) throw new Error('The editor and preview ports must be different.')

  const editorOrigin = `http://localhost:${port}`
  const previewOrigin = `http://localhost:${previewPort}`
  const service = new PicarooService({
    root: projectRoot,
    editorOrigin,
    framework,
    integration: integration.id,
    assetDirectory: integration.assetDirectory,
    components,
    angularImageSources,
  })
  await service.initialize()

  const gateway = createPreviewGateway(target, service)
  await new Promise<void>((resolve, reject) => {
    gateway.once('error', reject)
    gateway.listen(previewPort, 'localhost', () => {
      gateway.off('error', reject)
      resolve()
    })
  })

  const editor = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./editor', import.meta.url)),
    cacheDir: path.join(projectRoot, '.picaroo/cache'),
    plugins: [react()],
    define: {
      __PICAROO_TARGET__: JSON.stringify(previewOrigin),
      __PICAROO_VERSION__: JSON.stringify(picarooPkg.version ?? '0.0.0'),
      __PICAROO_PROJECT__: JSON.stringify({
        name: pkg.name ?? path.basename(projectRoot),
        framework,
      }),
    },
    server: {
      host: 'localhost',
      port,
      strictPort: true,
      fs: { allow: [fileURLToPath(new URL('../', import.meta.url))] },
    },
  })

  editor.watcher.add(projectRoot)
  let refreshTimer: ReturnType<typeof setTimeout>
  const changed = (file: string) => {
    if (!service.includes(file)) return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void service.refresh(), 200)
  }
  editor.watcher.on('add', changed)
  editor.watcher.on('change', changed)
  editor.watcher.on('unlink', changed)
  await editor.listen()

  process.stdout.write(
    `\n  Picaroo  /  ${pkg.name ?? path.basename(projectRoot)}  /  ${framework}\n` +
      `  Editor:  ${editorOrigin}\n` +
      `  Preview: ${previewOrigin}  →  ${target.href}\n\n`,
  )

  const stop = async () => {
    clearTimeout(refreshTimer)
    editor.watcher.off('add', changed)
    editor.watcher.off('change', changed)
    editor.watcher.off('unlink', changed)
    await editor.close()
    await new Promise<void>((resolve) => gateway.close(() => resolve()))
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

function validPort(value: string, label: string) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`Choose a ${label} port between 1024 and 65535.`)
  return port
}
