import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transformWithEsbuild } from 'vite'
import { MAX_UPLOAD, MAX_UPLOAD_MB } from '../shared'
import { ProjectStore } from './store'

const prefix = '/__picaroo'

export interface PicarooServiceOptions {
  root: string
  editorOrigin: string
  framework: string
  components?: string[]
  aliases?: { find: string; replacement: string }[]
  assetDirectory?: string
}

export class PicarooService {
  readonly store: ProjectStore
  private readonly token = randomBytes(32).toString('hex')
  private readonly editorOrigin: string
  private overlay = ''

  constructor(options: PicarooServiceOptions) {
    this.editorOrigin = new URL(options.editorOrigin).origin
    this.store = new ProjectStore(
      options.root,
      options.components ?? [],
      options.aliases ?? [],
      options.framework,
      options.assetDirectory,
    )
  }

  async initialize() {
    await this.store.initialize()
    const overlaySource = await readFile(
      fileURLToPath(new URL('../overlay.ts', import.meta.url)),
      'utf8',
    )
    this.overlay = (
      await transformWithEsbuild(overlaySource, 'picaroo-overlay.ts', {
        loader: 'ts',
        target: 'es2022',
      })
    ).code
  }

  refresh() {
    return this.store.refresh()
  }

  includes(file: string) {
    return this.store.index.includes(file)
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const pathname = req.url?.split('?')[0]
    if (!pathname?.startsWith(`${prefix}/`)) return false
    const remote = req.socket.remoteAddress ?? ''
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      respond(res, 403, { error: 'Picaroo is available only on this computer.' })
      return true
    }
    res.setHeader('Cache-Control', 'no-store')
    if (pathname === `${prefix}/overlay.js` && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(
        `const PICAROO_CONFIG = ${JSON.stringify({ token: this.token, editorOrigin: this.editorOrigin })};\n${this.overlay}`,
      )
      return true
    }
    const authorization = req.headers['x-picaroo-token']
    if (
      typeof authorization !== 'string' ||
      !/^[a-f0-9]{64}$/.test(authorization) ||
      !timingSafeEqual(Buffer.from(authorization), Buffer.from(this.token))
    ) {
      respond(res, 403, { error: 'Invalid Picaroo session.' })
      return true
    }
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
        throw new Error('Invalid request origin.')
      if (pathname === `${prefix}/api/snapshot` && req.method === 'GET')
        return respond(res, 200, this.store.snapshot())
      if (
        [`${prefix}/api/settings`, `${prefix}/api/archive`, `${prefix}/api/reprocess`].includes(
          pathname,
        ) &&
        req.method === 'POST'
      ) {
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString())
        if (pathname.endsWith('/settings'))
          return respond(res, 200, await this.store.saveSettings(body.profile))
        if (typeof body.assetId !== 'string' || typeof body.version !== 'string')
          throw new Error('Missing asset or version.')
        if (pathname.endsWith('/archive'))
          return respond(res, 200, await this.store.archive(body.assetId, body.version))
        if (typeof body.id !== 'string' || typeof body.assetVersion !== 'string' || !body.options)
          throw new Error('Missing image or crop options.')
        return respond(
          res,
          200,
          await this.store.reprocess(
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
        const thumbnail = await this.store.index.thumbnail(
          query.get('id') ?? '',
          query.get('version') ?? '',
        )
        res.setHeader('Content-Type', 'image/webp')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.end(thumbnail)
        return true
      }
      if (pathname === `${prefix}/api/import` && req.method === 'POST')
        return respond(
          res,
          200,
          await this.store.importAsset(
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
            await this.store.reuse(body.id, body.version, body.assetId, body.assetVersion),
          )
        }
        if (
          !body.field ||
          typeof body.field.file !== 'string' ||
          typeof body.field.pointer !== 'string' ||
          typeof body.field.version !== 'string'
        )
          throw new Error('Choose a JSON field.')
        return respond(res, 200, await this.store.map(body.id, body.version, body.field))
      }
      if (pathname === `${prefix}/api/replace` && req.method === 'POST') {
        const id = req.headers['x-picaroo-target']
        const version = req.headers['x-picaroo-version']
        if (typeof id !== 'string' || typeof version !== 'string')
          throw new Error('Missing source target or version.')
        const rawOptions = req.headers['x-picaroo-options']
        if (rawOptions && (typeof rawOptions !== 'string' || rawOptions.length > 4096))
          throw new Error('Invalid image options.')
        const rawName = req.headers['x-picaroo-name']
        if (rawName && (typeof rawName !== 'string' || rawName.length > 1024))
          throw new Error('Invalid image filename.')
        const result = await this.store.replace(
          id,
          version,
          await readBody(req, MAX_UPLOAD),
          typeof rawOptions === 'string' ? JSON.parse(rawOptions) : undefined,
          typeof rawName === 'string' ? decodeURIComponent(rawName) : undefined,
        )
        return respond(res, 200, result)
      }
      if (pathname === `${prefix}/api/undo` && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1024)).toString())
        if (typeof body.id !== 'string') throw new Error('Missing change ID.')
        return respond(res, 200, await this.store.undo(body.id))
      }
      respond(res, 404, { error: 'Unknown Picaroo endpoint.' })
    } catch (error) {
      respond(res, 400, {
        error: error instanceof Error ? error.message : 'Picaroo could not save the change.',
      })
    }
    return true
  }
}

function respond(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
  return true
}

async function readBody(req: IncomingMessage, maximum: number) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > maximum) {
      const message =
        maximum === MAX_UPLOAD
          ? `File is too large. Maximum upload size is ${MAX_UPLOAD_MB} MB.`
          : 'Request body is too large.'
      throw new Error(message)
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
