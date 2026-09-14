import { readdir, readFile, stat, realpath } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parse } from '@babel/parser'
import { VISITOR_KEYS } from '@babel/types'
import type { Node } from '@babel/types'
import { hash } from '../hash'
import { dataFields, readJson } from '../source-edits/json'
import type { JsonDocument } from '../source-edits/json'
import type { AssetUsage, DataField, LibraryAsset } from '../shared'
import { MAX_UPLOAD, MAX_UPLOAD_MB } from '../shared'
import { optimizeAsset } from '../assets/optimize'

const imageExtension = /\.(png|jpe?g|webp|avif|svg)$/i
const textExtension = /\.(tsx?|jsx?|mjs|cjs|json|css|scss|less|html|vue)$/i
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'out'])
const slash = (value: string) => value.replaceAll('\\', '/')
type Alias = { find: string; replacement: string }

export class ProjectIndex {
  documents = new Map<string, JsonDocument>()
  sources = new Map<string, string>()
  assets: LibraryAsset[] = []
  fields: DataField[] = []
  issues: string[] = []
  revision = 0
  private fingerprint = ''
  private cache = new Map<string, { signature: string; asset: LibraryAsset }>()
  private thumbnails = new Map<string, Buffer>()
  private scanning: Promise<void> = Promise.resolve()

  constructor(
    readonly root: string,
    private excluded: string,
    private aliases: Alias[] = [],
  ) {}

  includes(file: string) {
    const relative = slash(path.relative(this.root, file))
    return (
      !relative.startsWith('../') &&
      !path.isAbsolute(relative) &&
      !relative.split('/').some((part) => part.startsWith('.') || ignored.has(part)) &&
      !slash(path.resolve(file)).startsWith(this.excluded + '/') &&
      !['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(path.basename(file)) &&
      !/^tsconfig(?:\.[\w-]+)?\.json$/i.test(path.basename(file))
    )
  }

  refresh() {
    const next = this.scanning.then(() => this.scan())
    this.scanning = next.catch(() => {})
    return next
  }

  private async scan() {
    const documents = new Map<string, JsonDocument>()
    const sources = new Map<string, string>()
    const assets: LibraryAsset[] = []
    const issues: string[] = []
    const seen = new Set<string>()
    let count = 0
    const walk = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name)
        if (!this.includes(absolute)) continue
        const file = slash(path.relative(this.root, absolute))
        if (entry.isSymbolicLink()) {
          issues.push(`${file}: symbolic links are excluded from the index.`)
          continue
        }
        if (entry.isDirectory()) {
          await walk(absolute)
          continue
        }
        if (!entry.isFile() || (!imageExtension.test(file) && !textExtension.test(file))) continue
        if (++count > 15000)
          throw new Error('Project index is limited to 15,000 source and image files.')
        try {
          const info = await stat(absolute)
          if (imageExtension.test(file)) {
            if (info.size > MAX_UPLOAD) {
              issues.push(`${file}: images over ${MAX_UPLOAD_MB} MB are excluded from the library.`)
              continue
            }
            const signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
            const cached = this.cache.get(file)
            let asset: LibraryAsset
            if (cached?.signature === signature) asset = { ...cached.asset, usages: [] }
            else {
              const buffer = await readFile(absolute)
              const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 })
                .metadata()
                .catch(() => undefined)
              asset = {
                id: hash(file).slice(0, 20),
                file,
                name: entry.name,
                kind: /\.svg$/i.test(file) ? 'svg' : 'raster',
                version: hash(buffer),
                bytes: buffer.length,
                width: metadata?.width,
                height: metadata?.height,
                usages: [],
              }
              this.cache.set(file, { signature, asset })
            }
            seen.add(file)
            assets.push(asset)
          } else {
            if (info.size > 2 * 1024 * 1024) {
              issues.push(`${file}: source files over 2 MB are not scanned.`)
              continue
            }
            const source = await readFile(absolute, 'utf8')
            sources.set(file, source)
            if (file.endsWith('.json')) documents.set(file, readJson(source))
          }
        } catch (error) {
          issues.push(`${file}: ${error instanceof Error ? error.message : 'could not read file'}`)
        }
      }
    }
    await walk(this.root)
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file)
    const byFile = new Map(assets.map((asset) => [asset.file, asset]))
    const add = (value: string, file: string, usage: Omit<AssetUsage, 'file'>) => {
      const candidates = [
        value,
        ...[...value.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)].map((match) => match[1]),
      ]
      if (/\s\d+(?:\.\d+)?[wx](?:\s*,|\s*$)/.test(value))
        candidates.push(
          ...value.split(',').map((part) => part.trim().replace(/\s+\d+(?:\.\d+)?[wx]$/, '')),
        )
      for (const candidate of candidates) {
        const asset = this.resolve(candidate, file, byFile)
        if (
          asset &&
          !asset.usages.some(
            (item) =>
              item.file === file &&
              item.line === usage.line &&
              item.pointer === usage.pointer &&
              item.type === usage.type,
          )
        )
          asset.usages.push({ file, ...usage })
      }
    }
    for (const [file, source] of sources) {
      if (file.endsWith('.json')) {
        for (const [pointer, field] of documents.get(file)?.strings ?? [])
          add(field.value, file, { line: field.line, type: 'data', pointer })
      } else if (/\.(css|scss|less|html|vue)$/.test(file)) {
        for (const match of source.matchAll(
          /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|(?:srcset|src|href)\s*=\s*['"]([^'"]+)['"]/gi,
        )) {
          add(match[1] ?? match[2], file, {
            line: source.slice(0, match.index).split('\n').length,
            type: /\.(css|scss|less)$/.test(file) ? 'style' : 'source',
          })
        }
      } else {
        try {
          const ast = parse(source, {
            sourceType: 'unambiguous',
            plugins: ['decorators-legacy', 'jsx', 'typescript'],
          })
          const visit = (node: Node, parent?: Node) => {
            if (node.type === 'StringLiteral')
              add(node.value, file, {
                line: node.loc!.start.line,
                type: parent?.type === 'ImportDeclaration' ? 'import' : 'source',
              })
            if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
              add(node.quasis[0]?.value.cooked ?? '', file, {
                line: node.loc!.start.line,
                type: 'source',
              })
            for (const key of VISITOR_KEYS[node.type] ?? []) {
              const value = (node as unknown as Record<string, unknown>)[key]
              if (Array.isArray(value)) {
                for (const item of value) if (item?.type) visit(item, node)
              } else if (value && typeof value === 'object' && 'type' in value)
                visit(value as Node, node)
            }
          }
          visit(ast)
        } catch {
          issues.push(`${file}: could not parse static references.`)
        }
      }
    }
    assets.sort((a, b) => a.file.localeCompare(b.file))
    this.documents = documents
    this.sources = sources
    this.assets = assets
    this.fields = [...documents].flatMap(([file, document]) => dataFields(file, document))
    this.issues = issues
    const fingerprint = hash(JSON.stringify([assets, this.fields, issues]))
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint
      this.revision++
    }
  }

  resolve(
    value: string,
    file: string,
    assets = new Map(this.assets.map((asset) => [asset.file, asset])),
  ) {
    if (!value || /^(?:https?:|data:|blob:|#)/i.test(value)) return
    let clean: string
    try {
      clean = decodeURIComponent(value.split(/[?#]/)[0]).replaceAll('\\', '/')
    } catch {
      return
    }
    for (const alias of this.aliases) {
      if (clean === alias.find || clean.startsWith(alias.find + '/')) {
        const absolute = alias.replacement + clean.slice(alias.find.length)
        return assets.get(slash(path.relative(this.root, absolute)))
      }
    }
    const candidates = clean.startsWith('/')
      ? [`public${clean}`, `src${clean}`, clean.slice(1)]
      : clean.startsWith('.')
        ? [path.posix.normalize(path.posix.join(path.posix.dirname(file), clean))]
        : [
            path.posix.join(path.posix.dirname(file), clean),
            `public/${clean}`,
            `src/${clean}`,
            clean,
          ]
    for (const candidate of candidates) {
      const asset = assets.get(candidate)
      if (asset) return asset
    }
  }

  async readAsset(id: string, version: string) {
    const asset = this.assets.find((item) => item.id === id)
    if (!asset || asset.version !== version)
      throw new Error('The library asset changed. Refresh the library and choose it again.')
    const root = await realpath(this.root)
    const file = await realpath(path.join(root, asset.file))
    const relative = path.relative(root, file)
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Asset is outside this project.')
    const info = await stat(file)
    if (info.size > MAX_UPLOAD)
      throw new Error(`This asset exceeds the ${MAX_UPLOAD_MB} MB limit.`)
    const data = await readFile(file)
    if (hash(data) !== version) throw new Error('The library asset changed. Choose it again.')
    return { asset, data }
  }

  async thumbnail(id: string, version: string) {
    const { asset, data } = await this.readAsset(id, version)
    const key = id + version
    const existing = this.thumbnails.get(key)
    if (existing) return existing
    // SVG previews are validated then rasterized; no active SVG reaches the editor document.
    const input = asset.kind === 'svg' ? (await optimizeAsset(data, 'svg')).data : data
    const result = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 320, height: 220, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer()
    if (this.thumbnails.size >= 160) this.thumbnails.delete(this.thumbnails.keys().next().value!)
    this.thumbnails.set(key, result)
    return result
  }
}
