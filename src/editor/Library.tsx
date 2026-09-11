import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LibraryAsset } from '../shared'
import { Icon } from './Icon'
import { assetKey } from './useThumbnails'
import type { ThumbnailState } from './useThumbnails'
const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function AssetThumbnail({
  asset,
  thumbnails,
  className = '',
}: {
  asset?: LibraryAsset
  thumbnails: ThumbnailState
  className?: string
}) {
  const element = useRef<HTMLSpanElement>(null)
  const preview = asset ? thumbnails.previews[assetKey(asset.id, asset.version)] : undefined
  const id = asset?.id
  const version = asset?.version
  const request = thumbnails.request
  const generation = thumbnails.generation
  useEffect(() => {
    if (!id || !version || !element.current || preview !== undefined) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          request(id, version)
          observer.disconnect()
        }
      },
      { rootMargin: '80px' },
    )
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [id, version, request, preview, generation])
  return (
    <span ref={element} className={`asset-thumbnail ${className}`}>
      {preview ? (
        <img src={preview} alt="" />
      ) : (
        <>
          <Icon name={asset?.kind === 'svg' ? 'cursor' : 'image'} size={26} />
          {preview === null && <small>Preview unavailable</small>}
        </>
      )}
    </span>
  )
}

export function AssetLibrary({
  assets,
  selectedId,
  onSelect,
  thumbnails,
  onImport,
  busy,
  files,
  issues,
  settingsPanel,
}: {
  assets: LibraryAsset[]
  selectedId: string
  onSelect: (id: string) => void
  thumbnails: ThumbnailState
  onImport: (file: File) => void
  busy: boolean
  files: number
  issues: string[]
  settingsPanel?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [usage, setUsage] = useState('all')
  const [page, setPage] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matches = assets.filter(
    (asset) =>
      asset.file.toLowerCase().includes(query.toLowerCase()) &&
      (kind === 'all' || asset.kind === kind) &&
      (usage === 'all' || (usage === 'used' ? asset.usages.length > 0 : asset.usages.length === 0)),
  )
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 60) - 1))
  const visible = matches.slice(currentPage * 60, (currentPage + 1) * 60)
  return (
    <section className="library" aria-label="Project asset library">
      <div className="library-heading">
        <div>
          <span className="eyebrow">YOUR PROJECT, IN PICTURES</span>
          <h2>
            Asset library <span>{assets.length}</span>
          </h2>
          <p>Reuse an image. See every static reference we found.</p>
        </div>
        <button className="primary-action" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" size={16} />
          Import image
        </button>
        <input
          ref={input}
          type="file"
          className="visually-hidden"
          aria-label="Import library image"
          accept=".png,.jpg,.jpeg,.webp,.avif,.svg"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImport(file)
            event.target.value = ''
          }}
        />
      </div>
      <div className="library-filters">
        <input
          aria-label="Search library"
          placeholder="Search filenames or folders…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
        />
        <select
          aria-label="Filter asset type"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value)
            setPage(0)
          }}
        >
          <option value="all">All types</option>
          <option value="raster">Photos</option>
          <option value="svg">SVGs</option>
        </select>
        <select
          aria-label="Filter usage"
          value={usage}
          onChange={(event) => {
            setUsage(event.target.value)
            setPage(0)
          }}
        >
          <option value="all">All references</option>
          <option value="used">Referenced</option>
          <option value="unused">No static references</option>
        </select>
      </div>
      <div className="library-grid">
        {visible.map((asset) => (
          <button
            className={`library-card ${asset.id === selectedId ? 'selected' : ''}`}
            key={asset.id}
            onClick={() => onSelect(asset.id)}
            aria-pressed={asset.id === selectedId}
            title={asset.file}
          >
            <AssetThumbnail asset={asset} thumbnails={thumbnails} />
            <div className="library-card-copy">
              <strong>{asset.name}</strong>
              <span>
                {asset.kind === 'svg' ? 'SVG' : 'PHOTO'} · {formatBytes(asset.bytes)}
              </span>
              <small>
                {asset.usages.length} static{' '}
                {asset.usages.length === 1 ? 'reference' : 'references'}
              </small>
            </div>
          </button>
        ))}
        {!visible.length && (
          <div className="library-empty">
            <Icon name="image" size={36} />
            <h3>{assets.length ? 'No matching assets.' : 'Your library starts here.'}</h3>
            <p>
              {assets.length
                ? 'Try another search or filter.'
                : 'Import a photo or SVG, or add images anywhere in your project.'}
            </p>
          </div>
        )}
      </div>
      {settingsPanel}
      <footer className="library-footer">
        <span>
          {files} source files scanned · {matches.length} matching assets
        </span>
        {matches.length > 60 && (
          <div>
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              Previous
            </button>
            <span>
              {currentPage + 1} / {Math.ceil(matches.length / 60)}
            </span>
            <button
              disabled={(currentPage + 1) * 60 >= matches.length}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </footer>
      <details className="index-coverage">
        <summary>Index coverage{issues.length ? ` · ${issues.length} notices` : ''}</summary>
        <p>
          Scans local source, JSON, styles, and HTML, including unopened pages. Runtime-generated
          URLs cannot always be traced. “No static references” does not guarantee an asset is
          unused. Dependencies, build output, hidden directories, and Picaroo itself are excluded.
        </p>
        {issues.slice(0, 30).map((issue) => (
          <p key={issue}>{issue}</p>
        ))}
      </details>
    </section>
  )
}

export function AssetDetails({
  asset,
  thumbnails,
  targetLabel,
  canUse,
  busy,
  onUse,
  onArchive,
}: {
  asset?: LibraryAsset
  thumbnails: ThumbnailState
  targetLabel?: string
  canUse: boolean
  busy: boolean
  onUse: () => void
  onArchive: () => void
}) {
  if (!asset)
    return (
      <div className="unselected">
        <Icon name="grid" size={40} />
        <h3>
          One library.
          <br />
          Every image.
        </h3>
        <p>Select an asset to inspect its dimensions and references across your project.</p>
      </div>
    )
  return (
    <>
      <AssetThumbnail asset={asset} thumbnails={thumbnails} className="detail-thumbnail" />
      <h3 className="selection-name">{asset.name}</h3>
      <code className="source-file">{asset.file}</code>
      <p className="asset-dimensions">
        {formatBytes(asset.bytes)}
        {asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''} ·{' '}
        {asset.kind === 'svg' ? 'SVG' : 'Raster'}
      </p>
      <button className="primary-action reuse-button" onClick={onUse} disabled={!canUse || busy}>
        {busy ? 'Applying…' : 'Use this image'}
      </button>
      <p className="library-hint">
        {targetLabel
          ? canUse
            ? `Replace “${targetLabel}”.`
            : `This asset cannot be used for “${targetLabel}”. Select a compatible image type or map the source.`
          : 'Select a page image first, then choose an asset to reuse.'}
      </p>
      <div className="detail-label">STATIC REFERENCES · {asset.usages.length}</div>
      {asset.canArchive && (
        <div className="mapped-field">
          <p>
            No static references or Undo dependencies were found for this generated asset.
            Runtime-generated references may still exist.
          </p>
          <button className="secondary-action" disabled={busy} onClick={onArchive}>
            Move to Picaroo trash
          </button>
          <p>Restore from Change history if needed.</p>
        </div>
      )}
      <div className="usage-list">
        {asset.usages.map((usage, index) => (
          <article key={`${usage.file}:${usage.line}:${index}`}>
            <span>{usage.type === 'data' ? 'JSON FIELD' : usage.type.toUpperCase()}</span>
            <code>
              {usage.file}:{usage.line}
            </code>
            {usage.pointer && <small>{usage.pointer}</small>}
          </article>
        ))}
        {!asset.usages.length && <p>No static references found. Runtime usage may still exist.</p>}
      </div>
    </>
  )
}
