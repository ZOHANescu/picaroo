import type { Plugin, ViteDevServer } from 'vite'
import path from 'node:path'
import { PicarooService } from './server/picaroo-service'
import { instrument } from './source-edits/react'

export interface PicarooOptions {
  /** Exact origin of the Picaroo editor. Both servers must run on the same machine. */
  editorOrigin?: string
  /** Components accepting a src prop and forwarding data-picaroo-id to their visible root. */
  components?: string[]
}

/**
 * Backward-compatible Vite adapter. New projects can use the standalone `picaroo` command
 * without changing their build configuration.
 */
export function picaroo(options: PicarooOptions = {}): Plugin {
  let service: PicarooService
  let server: ViteDevServer

  return {
    name: 'picaroo',
    apply: 'serve',
    enforce: 'pre',
    async configureServer(devServer) {
      server = devServer
      const root = server.config.root
      const aliases = server.config.resolve.alias.flatMap((alias) =>
        typeof alias.find === 'string'
          ? [{ find: alias.find, replacement: alias.replacement }]
          : [],
      )
      if (
        server.config.base !== '/' ||
        !server.config.publicDir ||
        path.resolve(server.config.publicDir) !== path.resolve(root, 'public')
      )
        throw new Error(
          'The legacy Picaroo Vite adapter requires base "/" and the standard public directory. The standalone Picaroo command supports custom target setups.',
        )
      service = new PicarooService({
        root,
        aliases,
        components: options.components,
        framework: 'React + Vite',
        editorOrigin: options.editorOrigin ?? 'http://localhost:4310',
      })
      await service.initialize()
      let refreshTimer: ReturnType<typeof setTimeout>
      const changed = (file: string) => {
        if (!service.includes(file)) return
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          void service
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
      server.middlewares.use((req, res, next) => {
        void service.handle(req, res).then((handled) => {
          if (!handled) next()
        })
      })
    },
    transform(source, id) {
      const file = id.split('?')[0]
      if (!service || !/\.[jt]sx$/.test(file) || !service.includes(file)) return
      const targets = service.store.register(file, source)
      if (!targets.length) return
      return instrument(source, targets)
    },
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/__picaroo/overlay.js' },
          injectTo: 'body',
        },
      ]
    },
  }
}
