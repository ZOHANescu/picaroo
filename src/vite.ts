import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { transformWithEsbuild } from 'vite'
import { readFile } from 'node:fs/promises'
import { ProjectStore } from './server/store'
import { instrument } from './source-edits/react'
import { MAX_UPLOAD } from './assets/optimize'

export interface PicarooOptions {
  /** Exact origin of the Picaroo editor. Both servers must run on the same machine. */
  editorOrigin?: string
  /** Components accepting a src prop and forwarding data-picaroo-id to their visible root. */
  components?: string[]
}

const prefix = '/__picaroo'

export function picaroo(options: PicarooOptions = {}): Plugin {
  let store: ProjectStore
  let server: ViteDevServer
  let root: string
  let aliases: { find: string; replacement: string }[] = []
  const token = randomBytes(32).toString('hex')
  const editorOrigin = new URL(options.editorOrigin ?? 'http://localhost:4310').origin
  let overlay = ''

  return {
    name: 'picaroo',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
      aliases = config.resolve.alias.flatMap((alias) =>
        typeof alias.find === 'string'
          ? [{ find: alias.find, replacement: alias.replacement }]
          : [],
      )
      if (
        config.base !== '/' ||
        !config.publicDir ||
        path.resolve(config.publicDir) !== path.resolve(root, 'public')
      ) {
        throw new Error(
          'Picaroo currently requires Vite base "/" and the standard public directory. Custom asset layouts are planned.',
        )
      }
    },
    async configureServer(devServer) {
      server = devServer
      store = new ProjectStore(root, options.components ?? [], aliases)
      await store.initialize()
      const overlaySource = await readFile(
        fileURLToPath(new URL('./overlay.ts', import.meta.url)),
        'utf8',
      )
      overlay = (
        await transformWithEsbuild(overlaySource, 'picaroo-overlay.ts', {
          loader: 'ts',
          target: 'es2022',
        })
      ).code
      let refreshTimer: ReturnType<typeof setTimeout>
      const changed = (file: string) => {
        if (!store.index.includes(file)) return
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          void store
            .refresh()
            .then(() => server.ws.send({ type: 'custom', event: 'picaroo:refresh', data: {} }))
            .catch((error) => server.config.logger.warn(`Picaroo index: ${String(error)}`))
        }, 250)
      }
      server.watcher.on('add', changed)
      server.watcher.on('change', changed)
      server.watcher.on('unlink', changed)
      server.httpServer?.once('close', () => {
        clearTimeout(refreshTimer)
        server.watcher.off('add', changed)
        server.watcher.off('change', changed)
        server.watcher.off('unlink', changed)
      })
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0]
        if (!pathname?.startsWith(`${prefix}/`)) return next()
        const remote = req.socket.remoteAddress ?? ''
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote))
          return respond(res, 403, { error: 'Picaroo is available only on this computer.' })
        res.setHeader('Cache-Control', 'no-store')
        if (pathname === `${prefix}/overlay.js` && req.method === 'GET') {
          res.setHeader('Content-Type', 'text/javascript')
          res.end(`const PICAROO_CONFIG = ${JSON.stringify({ token, editorOrigin })};\n${overlay}`)
          return
        }
        const authorization = req.headers['x-picaroo-token']
        if (
          typeof authorization !== 'string' ||
          !/^[a-f0-9]{64}$/.test(authorization) ||
          !timingSafeEqual(Buffer.from(authorization), Buffer.from(token))
        )
          return respond(res, 403, { error: 'Invalid Picaroo session.' })
        try {
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
            return respond(res, 403, { error: 'Invalid request origin.' })
          if (pathname === `${prefix}/api/snapshot` && req.method === 'GET')
            return respond(res, 200, store.snapshot())
          if (
            [`${prefix}/api/settings`, `${prefix}/api/archive`, `${prefix}/api/reprocess`].includes(
              pathname,
            ) &&
            req.method === 'POST'
          ) {
            const body = JSON.parse((await readBody(req, 16 * 1024)).toString())
            if (pathname.endsWith('/settings'))
              return respond(res, 200, await store.saveSettings(body.profile))
            if (typeof body.assetId !== 'string' || typeof body.version !== 'string')
              throw new Error('Missing asset or version.')
            if (pathname.endsWith('/archive'))
              return respond(res, 200, await store.archive(body.assetId, body.version))
            if (
              typeof body.id !== 'string' ||
              typeof body.assetVersion !== 'string' ||
              !body.options
            )
              throw new Error('Missing image or crop options.')
            return respond(
              res,
              200,
              await store.reprocess(
                body.id,
                body.version,
                body.assetId,
                body.assetVersion,
                body.options,
              ),
            )
          }
          if (pathname === `${prefix}/api/thumbnail` && req.method === 'GET') {
            const query = new URL(req.url!, 'http://localhost').searchParams
            const thumbnail = await store.index.thumbnail(
              query.get('id') ?? '',
              query.get('version') ?? '',
            )
            res.setHeader('Content-Type', 'image/webp')
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.end(thumbnail)
            return
          }
          if (pathname === `${prefix}/api/import` && req.method === 'POST')
            return respond(
              res,
              200,
              await store.importAsset(
                await readBody(req, MAX_UPLOAD),
                typeof req.headers['x-picaroo-name'] === 'string'
                  ? decodeURIComponent(req.headers['x-picaroo-name'])
                  : undefined,
              ),
            )
          if (
            (pathname === `${prefix}/api/reuse` || pathname === `${prefix}/api/map`) &&
            req.method === 'POST'
          ) {
            const body = JSON.parse((await readBody(req, 16 * 1024)).toString())
            if (typeof body.id !== 'string' || typeof body.version !== 'string')
              throw new Error('Missing image target or source version.')
            if (pathname.endsWith('/reuse')) {
              if (typeof body.assetId !== 'string' || typeof body.assetVersion !== 'string')
                throw new Error('Missing library asset.')
              return respond(
                res,
                200,
                await store.reuse(body.id, body.version, body.assetId, body.assetVersion),
              )
            }
            if (
              !body.field ||
              typeof body.field.file !== 'string' ||
              typeof body.field.pointer !== 'string' ||
              typeof body.field.version !== 'string'
            )
              throw new Error('Choose a JSON field.')
            return respond(res, 200, await store.map(body.id, body.version, body.field))
          }
          if (pathname === `${prefix}/api/replace` && req.method === 'POST') {
            const id = req.headers['x-picaroo-target']
            const version = req.headers['x-picaroo-version']
            if (typeof id !== 'string' || typeof version !== 'string')
              throw new Error('Missing source target or version.')
            const rawOptions = req.headers['x-picaroo-options']
            if (rawOptions && (typeof rawOptions !== 'string' || rawOptions.length > 4096))
              throw new Error('Invalid image options.')
            const options = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : undefined
            const rawName = req.headers['x-picaroo-name']
            if (rawName && (typeof rawName !== 'string' || rawName.length > 1024))
              throw new Error('Invalid image filename.')
            const result = await store.replace(
              id,
              version,
              await readBody(req, MAX_UPLOAD),
              options,
              typeof rawName === 'string' ? decodeURIComponent(rawName) : undefined,
            )
            respond(res, 200, result)
            server.ws.send({ type: 'custom', event: 'picaroo:refresh', data: {} })
            return
          }
          if (pathname === `${prefix}/api/undo` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req, 1024)).toString())
            if (typeof body.id !== 'string') throw new Error('Missing change ID.')
            const result = await store.undo(body.id)
            respond(res, 200, result)
            server.ws.send({ type: 'custom', event: 'picaroo:refresh', data: {} })
            return
          }
          respond(res, 404, { error: 'Unknown Picaroo endpoint.' })
        } catch (error) {
          respond(res, 400, {
            error: error instanceof Error ? error.message : 'Picaroo could not save the change.',
          })
        }
      })
    },
    transform(source, id) {
      const file = id.split('?')[0]
      if (!store || !/\.[jt]sx$/.test(file) || !store.index.includes(file)) return
      const targets = store.register(file, source)
      if (!targets.length) return
      return instrument(source, targets)
    },
    transformIndexHtml() {
      return [
        { tag: 'script', attrs: { type: 'module', src: `${prefix}/overlay.js` }, injectTo: 'body' },
      ]
    },
  }
}

function respond(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, maximum: number) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > maximum) throw new Error('File is too large. Maximum upload size is 15 MB.')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
