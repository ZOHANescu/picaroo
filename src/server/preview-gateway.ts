import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import type { PicarooService } from './picaroo-service'

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

export function createPreviewGateway(target: URL, service: PicarooService) {
  const server = createServer(async (req, res) => {
    if (await service.handle(req, res)) return
    proxyRequest(target, req, res)
  })
  server.on('upgrade', (req, socket, head) => proxyUpgrade(target, req, socket, head))
  return server
}

function hostname(target: URL) {
  return target.hostname.replace(/^\[|\]$/g, '')
}

function targetPath(target: URL, requestUrl = '/') {
  const requested = new URL(requestUrl, 'http://picaroo.local')
  const base = target.pathname.endsWith('/') ? target.pathname.slice(0, -1) : target.pathname
  return `${base}${requested.pathname}${requested.search}` || '/'
}

function proxyHeaders(headers: IncomingHttpHeaders, target: URL) {
  const next: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !hopByHop.has(name.toLowerCase())) next[name] = value
  }
  next.host = target.host
  next['accept-encoding'] = 'identity'
  next['x-forwarded-host'] = String(headers.host ?? '')
  next['x-forwarded-proto'] = 'http'
  return next
}

function proxyRequest(target: URL, req: IncomingMessage, res: ServerResponse) {
  const upstream = httpRequest(
    {
      hostname: hostname(target),
      port: target.port || 80,
      method: req.method,
      path: targetPath(target, req.url),
      headers: proxyHeaders(req.headers, target),
    },
    (response) => {
      const contentType = String(response.headers['content-type'] ?? '')
      const responseHeaders = { ...response.headers }
      const location = responseHeaders.location
      if (location) {
        try {
          const redirect = new URL(location, target)
          if (redirect.origin === target.origin)
            responseHeaders.location = `${redirect.pathname}${redirect.search}${redirect.hash}`
        } catch {
          /* Preserve malformed upstream redirects for the browser to report. */
        }
      }
      if (!/\btext\/html\b/i.test(contentType)) {
        res.writeHead(response.statusCode ?? 502, response.statusMessage, responseHeaders)
        response.pipe(res)
        return
      }
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length <= 8 * 1024 * 1024) chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => {
        if (length > 8 * 1024 * 1024) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('The preview HTML is too large for Picaroo to instrument.')
          return
        }
        const html = Buffer.concat(chunks).toString('utf8')
        const script = '<script type="module" src="/__picaroo/overlay.js"></script>'
        const output = /<\/body\s*>/i.test(html)
          ? html.replace(/<\/body\s*>/i, `${script}</body>`)
          : html + script
        const headers = responseHeaders
        delete headers['content-length']
        delete headers['content-encoding']
        delete headers['content-security-policy']
        delete headers['content-security-policy-report-only']
        delete headers['x-frame-options']
        headers['content-length'] = String(Buffer.byteLength(output))
        res.writeHead(response.statusCode ?? 200, response.statusMessage, headers)
        res.end(output)
      })
    },
  )
  upstream.on('error', (error) => {
    if (res.headersSent) return res.destroy(error)
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Picaroo could not reach ${target.origin}. Keep the development server running.\n`)
  })
  req.pipe(upstream)
}

function proxyUpgrade(target: URL, req: IncomingMessage, socket: Duplex, head: Buffer) {
  const upstream = connect(Number(target.port || 80), hostname(target), () => {
    const headers = { ...req.headers, host: target.host }
    const lines = [`${req.method ?? 'GET'} ${targetPath(target, req.url)} HTTP/${req.httpVersion}`]
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`)
      else if (value !== undefined) lines.push(`${name}: ${value}`)
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n')
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
}
