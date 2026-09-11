import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4200' },
    port: { type: 'string', default: '4310' },
    project: { type: 'string', default: process.cwd() },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  process.stdout.write(
    'Picaroo — local image editing\n\npicaroo --url http://localhost:4200 [--port 4310] [--project .]\n\nStart your target app with the picaroo/vite plugin enabled first.\n',
  )
} else {
  const target = new URL(values.url!)
  if (
    target.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.username ||
    target.password
  ) {
    throw new Error('Use an http://localhost URL for your running development app.')
  }
  const projectRoot = path.resolve(values.project!)
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }
  const framework = dependencies['@angular/core']
    ? 'Angular'
    : dependencies.vue
      ? 'Vue'
      : dependencies.react
        ? 'React'
        : 'Unknown'
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Choose a port between 1024 and 65535.')
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./editor', import.meta.url)),
    cacheDir: path.join(projectRoot, 'node_modules/.vite-picaroo'),
    plugins: [react()],
    define: {
      __PICAROO_TARGET__: JSON.stringify(target.href),
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
  await server.listen()
  process.stdout.write(
    `\n  Picaroo  /  ${pkg.name}  /  ${framework}\n  Editor: http://localhost:${port}\n  App:    ${target.href}\n\n`,
  )
  if (framework !== 'React' || !dependencies.vite)
    process.stdout.write('  This milestone supports React + Vite. Other adapters are planned.\n')
  const stop = async () => {
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
