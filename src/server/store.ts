import { readFile, writeFile, mkdir, rename, realpath, unlink, copyFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { analyze, replaceReference, reuseReference, mapReference } from '../source-edits/react'
import type { SourceTarget } from '../source-edits/react'
import { optimizeAsset, validateProfile } from '../assets/optimize'
import type {
  Change,
  DataField,
  Snapshot,
  ImageOptions,
  OptimizationProfile,
  LibraryAsset,
} from '../shared'
import { DEFAULT_PROFILE } from '../shared'
import { analyzeCss, replaceVisual } from '../source-edits/visual'
import { ProjectIndex } from './project-index'
import { fileURLToPath } from 'node:url'
import { replaceJsonField } from '../source-edits/json'
import { hash } from '../hash'
import { analyzeAngular, replaceAngularReference } from '../source-edits/angular'
import type { AngularComponentSource } from '../source-edits/angular'

interface JournalEntry extends Change {
  before: string
  after: string
  trashFile?: string
  assetVersion?: string
}
const slash = (value: string) => value.split(path.sep).join('/')

export class ProjectStore {
  private targets = new Map<string, SourceTarget>()
  private history: JournalEntry[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private realRoot = ''
  private project = ''
  private settings: OptimizationProfile = { ...DEFAULT_PROFILE }
  readonly index: ProjectIndex

  constructor(
    readonly root: string,
    private components: string[],
    aliases: { find: string; replacement: string }[] = [],
    private framework = 'React + Vite',
    private assetDirectory = 'public/picaroo',
  ) {
    this.index = new ProjectIndex(
      root,
      path.resolve(fileURLToPath(new URL('../../', import.meta.url))).replaceAll('\\', '/'),
      aliases,
    )
  }

  async initialize() {
    this.realRoot = await realpath(this.root)
    const pkg = JSON.parse(await readFile(path.join(this.root, 'package.json'), 'utf8'))
    this.project = pkg.name ?? path.basename(this.root)
    const file = await this.safePath('.picaroo/history.json')
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
      if (
        !Array.isArray(parsed) ||
        parsed.some(
          (item) =>
            !item ||
            typeof item.before !== 'string' ||
            typeof item.after !== 'string' ||
            typeof item.file !== 'string',
        )
      ) {
        throw new Error('Picaroo history is invalid. Restore .picaroo/history.json before editing.')
      }
      this.history = parsed as JournalEntry[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      this.settings = validateProfile(
        JSON.parse(await readFile(await this.safePath('.picaroo/settings.json'), 'utf8')),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await this.reindex()
  }

  register(file: string, source: string) {
    const relative = slash(path.relative(this.root, file))
    if (relative.startsWith('../') || path.isAbsolute(relative)) return []
    const targets = analyze(source, relative, this.components, this.index.documents)
    for (const [id, target] of this.targets) if (target.file === relative) this.targets.delete(id)
    for (const target of targets) this.targets.set(target.id, target)
    return targets
  }

  private async reindex() {
    await this.index.refresh()
    this.targets.clear()
    const angularComponents = new Map<string, AngularComponentSource>()
    if (this.framework.startsWith('Angular')) {
      for (const [file, source] of this.index.sources) {
        if (!file.endsWith('.ts')) continue
        for (const match of source.matchAll(/\btemplateUrl\s*:\s*(["'])([^"']+)\1/g)) {
          const template = path.posix.normalize(
            path.posix.join(path.posix.dirname(file), match[2]),
          )
          angularComponents.set(template, { file, source })
        }
      }
    }
    for (const [file, source] of this.index.sources) {
      try {
        if (/\.[jt]sx$/.test(file)) this.register(path.join(this.root, file), source)
        else if (
          this.framework.startsWith('Angular') &&
          (file.endsWith('.html') || file.endsWith('.ts'))
        )
          for (const target of analyzeAngular(
            source,
            file,
            this.assetDirectory,
            file.endsWith('.html') ? angularComponents.get(file) : undefined,
          ))
            this.targets.set(target.id, target)
        else if (file.endsWith('.css'))
          for (const target of analyzeCss(source, file)) this.targets.set(target.id, target)
      } catch {
        this.index.issues.push(`${file}: image targets could not be parsed.`)
      }
    }
  }

  refresh() {
    return this.serialize(() => this.reindex())
  }

  forget(file: string) {
    const relative = slash(path.relative(this.root, file))
    for (const [id, target] of this.targets) if (target.file === relative) this.targets.delete(id)
  }

  snapshot(): Snapshot {
    const assets = this.index.assets.map((asset) => ({ ...asset, usages: [...asset.usages] }))
    const assetsByFile = new Map(assets.map((asset) => [asset.file, asset]))
    const targets = [...this.targets.values()]
    const consumers = new Map<string, number>()
    const dataKey = (data: NonNullable<SourceTarget['data']>) =>
      JSON.stringify([data.file, data.pointer])
    for (const target of targets) {
      if (!target.data) continue
      const key = dataKey(target.data)
      consumers.set(key, (consumers.get(key) ?? 0) + 1)
      const asset = this.index.resolve(target.current, target.data.file, assetsByFile)
      const pointer = `${target.data.file}#${target.data.pointer}`
      if (
        asset &&
        !asset.usages.some(
          (item) =>
            item.file === target.file && item.line === target.line && item.pointer === pointer,
        )
      )
        asset.usages.push({ file: target.file, line: target.line, type: 'source', pointer })
    }
    return {
      project: this.project,
      framework: this.framework,
      targets: targets.map((target) => ({
        id: target.id,
        file: target.file,
        line: target.line,
        label: target.label,
        kind: target.kind,
        current: target.current,
        version: target.version,
        editable: target.editable,
        reason: target.reason,
        shared: target.shared,
        assetId: this.index.resolve(target.current, target.data?.file ?? target.file, assetsByFile)
          ?.id,
        data: target.data
          ? {
              ...target.data,
              consumers: consumers.get(dataKey(target.data)),
            }
          : undefined,
        canMap: target.canMap,
        presentation: target.presentation,
        selector: target.selector,
        conditions: target.conditions,
        descriptor: target.descriptor,
        matchUrl:
          target.selector || target.runtimeMatch
            ? this.assetUrl(target.current, target.file)
            : undefined,
      })),
      history: this.history.map((entry) => ({
        id: entry.id,
        label: entry.label,
        file: entry.file,
        asset: entry.asset,
        kind: entry.kind,
        createdAt: entry.createdAt,
        inputBytes: entry.inputBytes,
        outputBytes: entry.outputBytes,
        width: entry.width,
        height: entry.height,
        operation: entry.operation,
      })),
      assets: assets.map((asset) => ({ ...asset, canArchive: this.canArchive(asset) })),
      settings: this.settings,
      fields: this.index.fields,
      index: {
        files: this.index.sources.size,
        revision: this.index.revision,
        issues: this.index.issues,
      },
    }
  }

  private async safePath(relative: string) {
    const absolute = path.resolve(this.realRoot, relative)
    const inside = (candidate: string) => {
      const difference = path.relative(this.realRoot, candidate)
      return (
        difference !== '..' &&
        !difference.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(difference)
      )
    }
    if (!inside(absolute) || /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(relative)) {
      throw new Error('Picaroo can only write application files inside this project.')
    }
    // Resolve the nearest existing ancestor too, so symlinked asset directories cannot escape.
    let existing = absolute
    while (true) {
      try {
        if (!inside(await realpath(existing)))
          throw new Error('Symlinks outside the project are not editable.')
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const parent = path.dirname(existing)
        if (parent === existing) throw error
        existing = parent
      }
    }
    return absolute
  }

  private async atomicWrite(relative: string, contents: string | Buffer) {
    const file = await this.safePath(relative)
    await mkdir(path.dirname(file), { recursive: true })
    await this.safePath(relative)
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, contents, { flag: 'wx' })
      await rename(temp, file)
    } finally {
      await unlink(temp).catch(() => {})
    }
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action)
    this.queue = next.catch(() => {})
    return next
  }

  replace(
    id: string,
    version: string,
    input: Buffer,
    options: ImageOptions = {},
    originalName = 'image',
  ) {
    return this.serialize(() => this.replaceInput(id, version, input, options, originalName))
  }

  private async replaceInput(
    id: string,
    version: string,
    input: Buffer,
    options: ImageOptions = {},
    originalName = 'image',
  ) {
    const { target, source } = await this.resolveTarget(id, version)
    if (!target.editable) throw new Error('This source needs a mapping before it can be edited.')
    const profile = { ...(options.profile ?? this.settings) }
    if (target.visual?.format) profile.format = target.visual.format
    if (target.descriptor?.endsWith('w'))
      profile.maxWidth = Math.min(profile.maxWidth, parseInt(target.descriptor, 10))
    const optimized = await optimizeAsset(input, target.kind, { ...options, profile })
    const directory =
      target.assetDirectory ?? (target.binding ? 'src/assets/picaroo' : this.assetDirectory)
    const asset = this.generatedAssetPath(directory, originalName, optimized)
    const publicUrl = this.publicUrl(asset)
    const document = target.data ? this.index.documents.get(target.data.file)! : undefined
    const file = target.data?.file ?? target.file
    const before = document?.source ?? source
    const after =
      document && target.data
        ? replaceJsonField(document, target.data.pointer, publicUrl)
        : target.visual
          ? replaceVisual(source, target, asset, optimized.data, optimized.width, publicUrl)
          : target.angular
            ? replaceAngularReference(source, target, publicUrl)
            : replaceReference(source, target, asset)
    if (!document) {
      if (target.visual?.type === 'css') analyzeCss(after, file)
      else if (target.angular) analyzeAngular(after, target.file, this.assetDirectory)
      else analyze(after, target.file, this.components, this.index.documents)
    }
    await this.saveAsset(asset, optimized.data)
    return this.commit(
      {
        id: randomUUID(),
        label: target.label,
        file,
        asset,
        kind: target.kind,
        createdAt: new Date().toISOString(),
        inputBytes: input.length,
        outputBytes: optimized.data.length,
        width: optimized.width,
        height: optimized.height,
        before,
        after,
        operation: 'replace',
      },
      [
        { file: target.file, source },
        { file, source: before },
      ],
    )
  }

  reprocess(
    id: string,
    version: string,
    assetId: string,
    assetVersion: string,
    options: ImageOptions,
  ) {
    return this.serialize(async () => {
      const { target } = await this.resolveTarget(id, version)
      const current = this.index.resolve(target.current, target.data?.file ?? target.file)
      if (current?.id !== assetId) throw new Error('The selected image no longer uses this asset.')
      const { asset, data } = await this.index.readAsset(assetId, assetVersion)
      return this.replaceInput(id, version, data, options, asset.name)
    })
  }

  saveSettings(profile: OptimizationProfile) {
    return this.serialize(async () => {
      const validated = validateProfile(profile)
      await this.atomicWrite('.picaroo/settings.json', JSON.stringify(validated, null, 2))
      this.settings = validated
      return this.snapshot()
    })
  }

  private assetUrl(current: string, file: string) {
    const asset = this.index.resolve(current, file)
    if (asset) return this.publicUrl(asset.file)
    if (/^https?:/.test(current) || current.startsWith('/')) return current
    return '/' + path.posix.normalize(path.posix.join(path.posix.dirname(file), current))
  }

  private publicUrl(asset: string) {
    if (asset.startsWith('public/')) return '/' + asset.slice('public/'.length)
    if (asset.startsWith('src/assets/')) return '/assets/' + asset.slice('src/assets/'.length)
    return '/' + asset
  }

  private generatedAssetPath(
    directory: string,
    originalName: string,
    optimized: { data: Buffer; extension: string; width?: number; height?: number },
  ) {
    const version = hash(optimized.data)
    if (this.settings.hashFilenames !== false)
      return `${directory}/${version.slice(0, 24)}.${optimized.extension}`
    const stem =
      path
        .basename(originalName, path.extname(originalName))
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .replace(/_\d+x\d+(?:_[a-f0-9]{8})?$/i, '')
        .slice(0, 60) || 'image'
    const dimensions =
      optimized.width && optimized.height ? `_${optimized.width}x${optimized.height}` : ''
    const readable = `${directory}/${stem}${dimensions}.${optimized.extension}`
    const existing = this.index.assets.find(
      (asset) => asset.file.toLowerCase() === readable.toLowerCase(),
    )
    if (!existing || existing.version === version) return readable
    return `${directory}/${stem}${dimensions}_${version.slice(0, 8)}.${optimized.extension}`
  }

  private canArchive(asset: LibraryAsset) {
    return (
      !asset.usages.length &&
      !this.index.issues.length &&
      /^(public|src\/assets)\/picaroo\//.test(asset.file) &&
      !this.history.some(
        (entry) =>
          entry.operation !== 'archive' &&
          (entry.asset === asset.file ||
            entry.before.includes(asset.name) ||
            entry.after.includes(asset.name)),
      )
    )
  }

  archive(assetId: string, version: string) {
    return this.serialize(async () => {
      await this.reindex()
      const { asset } = await this.index.readAsset(assetId, version)
      const visible = this.snapshot().assets.find((item) => item.id === assetId)!
      if (!visible.canArchive)
        throw new Error(
          'Only unreferenced Picaroo assets outside Undo history can be moved to trash. Resolve index coverage issues first.',
        )
      const id = randomUUID()
      const trashFile = `.picaroo/trash/${id}${path.extname(asset.file)}`
      const entry: JournalEntry = {
        id,
        label: `Archived ${asset.name}`,
        file: asset.file,
        asset: asset.file,
        kind: asset.kind,
        createdAt: new Date().toISOString(),
        inputBytes: asset.bytes,
        outputBytes: asset.bytes,
        before: '',
        after: '',
        operation: 'archive',
        trashFile,
        assetVersion: asset.version,
      }
      const history = [entry, ...this.history].slice(0, 50)
      await mkdir(path.dirname(await this.safePath(trashFile)), { recursive: true })
      await this.atomicWrite('.picaroo/history.json', JSON.stringify(history, null, 2))
      try {
        await this.index.readAsset(assetId, version)
        await rename(await this.safePath(asset.file), await this.safePath(trashFile))
      } catch (error) {
        await this.atomicWrite('.picaroo/history.json', JSON.stringify(this.history, null, 2))
        throw error
      }
      this.history = history
      await this.reindex()
      return this.snapshot()
    })
  }

  importAsset(input: Buffer, name = 'image') {
    return this.serialize(async () => {
      await this.reindex()
      const kind = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
        input.toString('utf8').replace(/^\uFEFF/, ''),
      )
        ? 'svg'
        : 'raster'
      const optimized = await optimizeAsset(input, kind, { profile: this.settings })
      const version = hash(optimized.data)
      if (this.index.assets.some((asset) => asset.version === version)) return this.snapshot()
      const file = this.generatedAssetPath(this.assetDirectory, name, optimized)
      await this.saveAsset(file, optimized.data)
      await this.reindex()
      return this.snapshot()
    })
  }

  private async saveAsset(file: string, data: Buffer) {
    try {
      const current = await readFile(await this.safePath(file))
      if (!current.equals(data)) throw new Error('An existing asset has conflicting contents.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.atomicWrite(file, data)
    }
  }

  private async resolveTarget(id: string, version: string) {
    await this.reindex()
    const target = this.targets.get(id)
    if (!target) throw new Error('The image target no longer exists. Refresh the preview.')
    if (target.version !== version)
      throw new Error('The source or JSON data changed. Refresh the preview and try again.')
    const source = await readFile(await this.safePath(target.file), 'utf8')
    return { target, source }
  }

  private async commit(entry: JournalEntry, guards: { file: string; source: string }[]) {
    const verify = async () => {
      for (const guard of guards)
        if ((await readFile(await this.safePath(guard.file), 'utf8')) !== guard.source)
          throw new Error('The source, JSON data, or asset changed before saving. Try again.')
    }
    await verify()
    if (entry.before === entry.after) return this.snapshot()
    const history = [entry, ...this.history].slice(0, 50)
    await this.atomicWrite('.picaroo/history.json', JSON.stringify(history, null, 2))
    try {
      await verify()
      await this.atomicWrite(entry.file, entry.after)
    } catch (error) {
      await this.atomicWrite('.picaroo/history.json', JSON.stringify(this.history, null, 2))
      throw error
    }
    this.history = history
    await this.reindex()
    return this.snapshot()
  }

  reuse(id: string, version: string, assetId: string, assetVersion: string) {
    return this.serialize(async () => {
      const { target, source } = await this.resolveTarget(id, version)
      if (!target.editable) throw new Error('Map this image source before reusing a library asset.')
      const { asset, data } = await this.index.readAsset(assetId, assetVersion)
      if (target.visual) return this.replaceInput(id, version, data, {}, asset.name)
      if (asset.kind !== target.kind)
        throw new Error(
          `This ${target.kind === 'svg' ? 'SVG' : 'photo'} slot cannot accept that asset type.`,
        )
      await optimizeAsset(data, asset.kind) // Validate contents; existing assets are reused without re-encoding.
      let destination = asset.file
      if (target.data && !destination.startsWith('public/')) {
        destination = `public/picaroo/${asset.version.slice(0, 24)}${path.extname(asset.file).toLowerCase()}`
        await this.saveAsset(destination, data)
      }
      if (
        target.angular &&
        target.assetDirectory?.startsWith('src/assets/') &&
        !destination.startsWith('src/assets/')
      ) {
        destination = `${target.assetDirectory}/${asset.version.slice(0, 24)}${path.extname(asset.file).toLowerCase()}`
        await this.saveAsset(destination, data)
      }
      const document = target.data ? this.index.documents.get(target.data.file)! : undefined
      const before = document?.source ?? source
      const file = target.data?.file ?? target.file
      const after =
        document && target.data
          ? replaceJsonField(document, target.data.pointer, this.publicUrl(destination))
          : target.angular
            ? replaceAngularReference(source, target, this.publicUrl(destination))
            : reuseReference(source, target, destination)
      if (!document) {
        if (target.angular) analyzeAngular(after, target.file, this.assetDirectory)
        else analyze(after, target.file, this.components, this.index.documents)
      }
      await this.index.readAsset(assetId, assetVersion)
      return this.commit(
        {
          id: randomUUID(),
          label: target.label,
          file,
          asset: destination,
          kind: target.kind,
          createdAt: new Date().toISOString(),
          inputBytes: asset.bytes,
          outputBytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          before,
          after,
          operation: 'reuse',
        },
        [
          { file: target.file, source },
          { file, source: before },
        ],
      )
    })
  }

  map(id: string, version: string, field: DataField) {
    return this.serialize(async () => {
      const { target, source } = await this.resolveTarget(id, version)
      const document = this.index.documents.get(field.file)
      const value = document?.strings.get(field.pointer)?.value
      if (!document || hash(document.source) !== field.version || value === undefined)
        throw new Error('The selected JSON field changed. Choose it again.')
      if (value && !/\.(png|jpe?g|webp|avif|svg)(?:[?#].*)?$/i.test(value))
        throw new Error('Choose an empty string or a field containing an image URL.')
      if (target.kind === 'svg' && !/\.svg(?:[?#]|$)/i.test(value))
        throw new Error('Link an SVG slot to a field that already contains an SVG URL.')
      if (target.kind === 'raster' && /\.svg(?:[?#]|$)/i.test(value))
        throw new Error('A photo slot cannot be mapped to an SVG field.')
      const after = mapReference(source, target, field.file, field.pointer)
      analyze(after, target.file, this.components, this.index.documents)
      return this.commit(
        {
          id: randomUUID(),
          label: target.label,
          file: target.file,
          asset: value,
          kind: target.kind,
          createdAt: new Date().toISOString(),
          inputBytes: 0,
          outputBytes: 0,
          before: source,
          after,
          operation: 'map',
        },
        [
          { file: target.file, source },
          { file: field.file, source: document.source },
        ],
      )
    })
  }

  undo(id: string) {
    return this.serialize(async () => {
      const entry = this.history[0]
      if (!entry || entry.id !== id) throw new Error('Undo the most recent change first.')
      if (entry.operation === 'archive' && entry.trashFile) {
        const destination = await this.safePath(entry.file)
        const backup = await this.safePath(entry.trashFile)
        const readIfPresent = async (file: string) => {
          try {
            return await readFile(file)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
            throw error
          }
        }
        const archived = await readIfPresent(backup)
        const expected = entry.assetVersion ?? (archived ? hash(archived) : undefined)
        if (archived && hash(archived) !== expected)
          throw new Error(
            'The archived asset changed outside Picaroo. Restore is blocked to preserve it.',
          )
        const current = await readIfPresent(destination)
        if (current) {
          // Finish an interrupted restore only when the restored bytes match the journal.
          if (!expected || hash(current) !== expected)
            throw new Error(
              'A file already exists at the original path. Restore is blocked to preserve it.',
            )
        } else {
          if (!archived)
            throw new Error(
              'The archived asset is missing. Restore it from your backup before retrying Undo.',
            )
          await mkdir(path.dirname(destination), { recursive: true })
          await copyFile(backup, destination, constants.COPYFILE_EXCL)
          if (hash(await readFile(destination)) !== expected)
            throw new Error(
              'The asset changed during restoration. Review the original path and Picaroo trash before retrying.',
            )
        }
        if (archived) await unlink(backup)
        const remaining = this.history.slice(1)
        await this.atomicWrite('.picaroo/history.json', JSON.stringify(remaining, null, 2))
        this.history = remaining
        await this.reindex()
        return this.snapshot()
      }
      const file = await this.safePath(entry.file)
      const current = await readFile(file, 'utf8')
      if (current !== entry.after && current !== entry.before) {
        throw new Error(
          'This file was edited outside Picaroo. Undo is blocked to preserve your changes.',
        )
      }
      if (current !== entry.before) await this.atomicWrite(entry.file, entry.before)
      const remaining = this.history.slice(1)
      await this.atomicWrite('.picaroo/history.json', JSON.stringify(remaining, null, 2))
      this.history = remaining
      await this.reindex()
      // Retain generated assets: another page may now reference them.
      return this.snapshot()
    })
  }
}
