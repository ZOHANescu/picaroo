import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BridgeEvent,
  EditorCommand,
  Snapshot,
  VisibleTarget,
  Target,
  LibraryAsset,
} from '../shared'
import { CHANNEL, DEFAULT_PROFILE } from '../shared'
import { Icon } from './Icon'
import { AssetLibrary, AssetDetails, AssetThumbnail } from './Library'
import { useThumbnails, assetKey } from './useThumbnails'
import { ImageReview, OptimizationSettings } from './ImageTools'
import { DataMapping } from './DataMapping'
import './library.css'

declare const __PICAROO_TARGET__: string
declare const __PICAROO_PROJECT__: { name: string; framework: string }
declare const __PICAROO_VERSION__: string
const targetUrl = __PICAROO_TARGET__
const targetOrigin = new URL(targetUrl).origin
const bytes = (value: number) => (value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`)

export function App() {
  const frame = useRef<HTMLIFrameElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const saveRequest = useRef<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [pending, setPending] = useState<{
    target: Target
    file?: File
    asset?: LibraryAsset
  } | null>(null)
  const [targets, setTargets] = useState<VisibleTarget[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [editing, setEditing] = useState(true)
  const editingRef = useRef(editing)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'missing'>('connecting')
  const [mobile, setMobile] = useState(false)
  const [panel, setPanel] = useState<'images' | 'history' | 'library'>('images')
  const [libraryAssetId, setLibraryAssetId] = useState('')
  const [query, setQuery] = useState('')
  const [route, setRoute] = useState(new URL(targetUrl).pathname)
  const [revision, setRevision] = useState(0)
  const [scale, setScale] = useState(1)
  const scaleRef = useRef(scale)
  const stage = useRef<HTMLDivElement>(null)
  const selected = targets.find((target) => target.id === selectedId)
  const assets = snapshot?.assets ?? []
  const libraryAsset = assets.find((asset) => asset.id === libraryAssetId)
  const currentAsset = assets.find((asset) => asset.id === selected?.assetId)
  const filtered = targets.filter((target) =>
    `${target.label} ${target.file}`.toLowerCase().includes(query.toLowerCase()),
  )

  const send = useCallback((command: EditorCommand) => {
    frame.current?.contentWindow?.postMessage({ channel: CHANNEL, ...command }, targetOrigin)
  }, [])
  const thumbnails = useThumbnails(send)
  const receiveThumbnail = thumbnails.receive
  const reconnectThumbnails = thumbnails.reconnect
  const prepareUpload = useCallback(
    (target: Target, file: File) => {
      setSaveError('')
      if (file.size > 15 * 1024 * 1024) {
        setNotice({ error: true, message: 'Choose a file smaller than 15 MB.' })
        return
      }
      if (target.kind === 'svg')
        send({ type: 'replace', id: target.id, version: target.version, file })
      else setPending({ target, file })
    },
    [send],
  )

  useEffect(() => {
    const container = stage.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) =>
      setScale(Math.max(0.1, Math.min(1, (entry.contentRect.width - 64) / (mobile ? 390 : 1280)))),
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [mobile])

  useEffect(() => {
    scaleRef.current = scale
    send({ type: 'viewport', scale })
  }, [scale, send])

  useEffect(() => {
    editingRef.current = editing
    send({ type: 'mode', editing })
  }, [editing, send])

  useEffect(() => {
    const timeout = window.setTimeout(() => setConnection('missing'), 10000)
    let lastSeen = Date.now()
    function onMessage(event: MessageEvent) {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== targetOrigin ||
        event.data?.channel !== CHANNEL
      )
        return
      const message = event.data as BridgeEvent
      if (message.type === 'ready') {
        setBusy(false)
        reconnectThumbnails()
        if (saveRequest.current) {
          saveRequest.current = null
          setSaveError(
            'The preview reloaded while saving. Check Change history before trying again; your image and crop settings are still here.',
          )
        }
        send({ type: 'connect', editing: editingRef.current, scale: scaleRef.current })
        return
      }
      if (message.type === 'snapshot') {
        lastSeen = Date.now()
        clearTimeout(timeout)
        setConnection('connected')
        setSnapshot(message.snapshot)
        snapshotRef.current = message.snapshot
        setTargets(message.visible)
        setRoute(message.path)
      } else if (message.type === 'mutation-result') {
        if (message.requestId !== saveRequest.current) return
        saveRequest.current = null
        if (message.error) setSaveError(message.error)
        else setPending(null)
      } else if (message.type === 'selected') {
        setSelectedId(message.id)
        setPanel('images')
      } else if (message.type === 'busy') setBusy(message.busy)
      else if (message.type === 'notice') setNotice(message)
      else if (message.type === 'thumbnail') receiveThumbnail(message)
      else if (message.type === 'upload') {
        const target = snapshotRef.current?.targets.find((item) => item.id === message.id)
        if (target) {
          setSelectedId(target.id)
          prepareUpload({ ...target, version: message.version }, message.file)
        }
      }
    }
    window.addEventListener('message', onMessage)
    const heartbeat = window.setInterval(() => {
      if (Date.now() - lastSeen > 10000) setConnection('missing')
      send({ type: 'connect', editing: editingRef.current, scale: scaleRef.current })
    }, 5000)
    return () => {
      clearTimeout(timeout)
      clearInterval(heartbeat)
      window.removeEventListener('message', onMessage)
    }
  }, [send, revision, receiveThumbnail, reconnectThumbnails, prepareUpload])

  function choose(target: VisibleTarget) {
    setSelectedId(target.id)
    send({ type: 'select', id: target.id })
  }

  function upload(file: File | undefined) {
    if (!file || !selected || busy) return
    setNotice(null)
    prepareUpload(selected, file)
  }

  return (
    <div className="workspace">
      <aside className="sidebar" inert={!!pending}>
        <div className="brand">
          <span className="brand-mark">
            <Icon name="image" size={25} />
          </span>
          <span>
            picaroo<span className="brand-dot">.</span>
          </span>
          <span className="version">v{__PICAROO_VERSION__}</span>
        </div>
        <div className="project-card">
          <span className="project-avatar">
            {(snapshot?.project ?? __PICAROO_PROJECT__.name).slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{snapshot?.project ?? __PICAROO_PROJECT__.name}</strong>
            <span>
              <i className={connection === 'connected' ? 'live-dot' : 'live-dot pending'} />
              {snapshot?.framework ?? __PICAROO_PROJECT__.framework} · Local project
            </span>
          </div>
        </div>
        <div className="section-label">WORKSPACE</div>
        <nav className="panel-nav" aria-label="Workspace panels">
          <button
            className={panel === 'library' ? 'active' : ''}
            onClick={() => setPanel('library')}
          >
            <Icon name="image" />
            Asset library<span className="count">{assets.length}</span>
          </button>
          <button className={panel === 'images' ? 'active' : ''} onClick={() => setPanel('images')}>
            <Icon name="grid" />
            Page images<span className="count">{targets.length}</span>
          </button>
          <button
            className={panel === 'history' ? 'active' : ''}
            onClick={() => setPanel('history')}
          >
            <Icon name="undo" />
            Change history<span className="count">{snapshot?.history.length ?? 0}</span>
          </button>
        </nav>
        {panel === 'images' ? (
          <>
            <div className="list-heading">
              <h2>On this page</h2>
              <span>{targets.filter((item) => item.editable).length} editable</span>
            </div>
            <div className="search">
              <Icon name="image" size={16} />
              <input
                aria-label="Find an image"
                placeholder="Find an image…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="target-list">
              {filtered.map((target) => (
                <button
                  key={target.id}
                  className={`target-card ${selectedId === target.id ? 'selected' : ''}`}
                  onClick={() => choose(target)}
                >
                  <span className={`asset-symbol ${target.kind}`}>
                    <AssetThumbnail
                      asset={assets.find((asset) => asset.id === target.assetId)}
                      thumbnails={thumbnails}
                    />
                  </span>
                  <span className="target-copy">
                    <strong>{target.label}</strong>
                    <span>
                      {!target.editable
                        ? 'Needs mapping'
                        : target.kind === 'svg'
                          ? 'SVG vector'
                          : 'Photo'}
                      {target.instances > 1 ? ` · ${target.instances} instances` : ''}
                    </span>
                  </span>
                  {selectedId === target.id && <span className="selected-dot" />}
                </button>
              ))}
              {!filtered.length && (
                <p className="empty-list">
                  {connection !== 'connected'
                    ? 'Your page images will appear when the app connects.'
                    : query
                      ? 'No images match your search.'
                      : 'No supported image targets on this page. Navigate to a page with images.'}
                </p>
              )}
            </div>
          </>
        ) : panel === 'history' ? (
          <>
            <div className="list-heading">
              <h2>Saved changes</h2>
              <span>Newest first</span>
            </div>
            <div className="history-list">
              {snapshot?.history.map((change, index) => (
                <article className="history-card" key={change.id}>
                  <div className="history-icon">
                    <Icon name="check" size={16} />
                    <span>
                      {new Date(change.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <h3>{change.label}</h3>
                  <p>{change.file}</p>
                  <small>
                    {change.operation === 'archive'
                      ? 'Moved to Picaroo trash'
                      : change.operation === 'map'
                        ? 'Linked JSON field'
                        : change.operation === 'reuse'
                          ? 'Reused library image'
                          : 'Replaced image'}
                  </small>
                  {change.operation !== 'map' && (
                    <>
                      <div className="size-change">
                        {bytes(change.inputBytes)} <Icon name="arrow" size={13} />{' '}
                        <strong>{bytes(change.outputBytes)}</strong>
                      </div>
                      {change.width && (
                        <small>
                          {change.width} × {change.height}
                        </small>
                      )}
                    </>
                  )}
                  <button
                    className="undo-button"
                    disabled={index !== 0 || busy || connection !== 'connected'}
                    onClick={() => send({ type: 'undo', id: change.id })}
                  >
                    <Icon name="undo" size={14} />
                    {index === 0 ? 'Undo this change' : 'Undo newer changes first'}
                  </button>
                </article>
              ))}
              {!snapshot?.history.length && (
                <div className="empty-history">
                  <Icon name="undo" size={28} />
                  <h3>A fresh canvas.</h3>
                  <p>Your saved replacements appear here. Every change comes with Undo.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="library-sidebar">
            <div className="list-heading">
              <h2>Project overview</h2>
            </div>
            <p>
              <strong>{assets.length}</strong> images in your project
            </p>
            <p>
              <strong>{assets.filter((asset) => asset.usages.length > 0).length}</strong> with
              static references
            </p>
            <p>
              <strong>{snapshot?.index.files ?? 0}</strong> source files scanned
            </p>
            <div className="library-sidebar-note">
              {selected ? (
                <>
                  Choosing an image for
                  <br />
                  <strong>{selected.label}</strong>
                </>
              ) : (
                'Select a page image to replace it with an asset from this library.'
              )}
            </div>
            <button className="undo-button" onClick={() => setPanel('images')}>
              Back to page images
            </button>
          </div>
        )}
        <div className="sidebar-footer">
          <span className="local-icon">
            <Icon name="monitor" size={16} />
          </span>
          <div>
            <strong>Made for your localhost.</strong>
            <span>Assets and edits stay in your project.</span>
          </div>
        </div>
      </aside>

      <main className="main" inert={!!pending}>
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              Workspace <span>/</span>
            </span>
            <h1>Image editor</h1>
          </div>
          <div className="topbar-right">
            <span className="dev-badge">
              <i />
              DEVELOPMENT ONLY
            </span>
            <a href={targetUrl} target="_blank" rel="noreferrer">
              Open app <Icon name="arrow" size={16} />
            </a>
          </div>
        </header>
        <section className="intro">
          <div>
            <div className="eyebrow">A LITTLE LESS FILE HUNTING.</div>
            <h2>The right image. Right here.</h2>
            <p>Drop an image into your page. Picaroo takes care of the source.</p>
          </div>
          <div className="intro-tag">
            <span>01</span> SELECT <Icon name="arrow" size={12} />
            <span>02</span> DROP <Icon name="arrow" size={12} />
            <span>03</span> DONE
          </div>
        </section>
        <div className="editor-layout">
          <section className="preview-section" aria-label="Application preview">
            {panel === 'library' && (
              <div className="library-cover">
                <AssetLibrary
                  assets={assets}
                  selectedId={libraryAssetId}
                  onSelect={setLibraryAssetId}
                  thumbnails={thumbnails}
                  busy={busy || connection !== 'connected'}
                  onImport={(file) => send({ type: 'import', file })}
                  files={snapshot?.index.files ?? 0}
                  issues={snapshot?.index.issues ?? []}
                  settingsPanel={
                    <OptimizationSettings
                      key={JSON.stringify(snapshot?.settings)}
                      initial={snapshot?.settings ?? DEFAULT_PROFILE}
                      busy={busy || connection !== 'connected'}
                      onSave={(profile) => send({ type: 'settings', profile })}
                    />
                  }
                />
              </div>
            )}
            <div
              className={`preview-body ${panel === 'library' ? 'preview-concealed' : ''}`}
              aria-hidden={panel === 'library'}
              inert={panel === 'library'}
            >
              <div className="preview-toolbar">
                <div className="mode-toggle" role="group" aria-label="Preview mode">
                  <button
                    aria-pressed={editing}
                    className={editing ? 'active' : ''}
                    onClick={() => setEditing(true)}
                  >
                    <Icon name="cursor" size={14} />
                    Edit images
                  </button>
                  <button
                    aria-pressed={!editing}
                    className={!editing ? 'active' : ''}
                    onClick={() => setEditing(false)}
                  >
                    Browse
                  </button>
                </div>
                <div className="device-toggle" role="group" aria-label="Preview width">
                  <button
                    title="Desktop preview"
                    aria-label="Desktop preview"
                    aria-pressed={!mobile}
                    className={!mobile ? 'active' : ''}
                    onClick={() => setMobile(false)}
                  >
                    <Icon name="monitor" size={17} />
                  </button>
                  <button
                    title="Mobile preview"
                    aria-label="Mobile preview"
                    aria-pressed={mobile}
                    className={mobile ? 'active' : ''}
                    onClick={() => setMobile(true)}
                  >
                    <Icon name="phone" size={17} />
                  </button>
                </div>
                <span className="zoom">{Math.round(scale * 100)}%</span>
              </div>
              <div className="preview-stage" ref={stage}>
                <div className="browser-chrome" style={{ width: (mobile ? 390 : 1280) * scale }}>
                  <span className="traffic-lights">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="address">
                    {new URL(targetUrl).host}
                    {route}
                  </span>
                  <button
                    title="Reload app preview"
                    aria-label="Reload app preview"
                    onClick={() => {
                      setConnection('connecting')
                      setBusy(false)
                      setRevision((value) => value + 1)
                    }}
                  >
                    <Icon name="refresh" size={14} />
                  </button>
                </div>
                <div className="frame-outer" style={{ width: (mobile ? 390 : 1280) * scale }}>
                  <iframe
                    key={revision}
                    ref={frame}
                    title="Your app — Picaroo preview"
                    src={targetUrl}
                    onLoad={() => send({ type: 'connect', editing, scale })}
                    style={{
                      width: mobile ? 390 : 1280,
                      transform: `scale(${scale})`,
                      height: `calc(100% / ${scale})`,
                    }}
                  />
                </div>
                {connection === 'missing' && (
                  <div className="connection-card" role="status">
                    <Icon name="monitor" size={25} />
                    <h3>Let’s connect your app.</h3>
                    <p>
                      Start your app normally, then keep its local development server running.
                      Picaroo connects through its own preview—no framework plugin is required.
                    </p>
                    <p>
                      Target: {targetUrl}
                      <br />
                      Editor origin: {location.origin}
                    </p>
                    <button
                      onClick={() => {
                        setConnection('connecting')
                        setRevision((value) => value + 1)
                      }}
                    >
                      Reconnect preview
                    </button>
                  </div>
                )}
              </div>
              <footer className="preview-status">
                <span>
                  <i className={connection === 'connected' ? 'live-dot' : 'live-dot pending'} />
                  {busy
                    ? 'Optimizing and saving…'
                    : connection === 'connected'
                      ? 'Connected to your local app'
                      : 'Waiting for your app'}
                </span>
                <span>
                  {editing ? 'Drop onto a highlighted image' : 'Browse your app normally'}
                </span>
              </footer>
            </div>
          </section>
          <aside className="inspector" aria-label="Image properties">
            <div className="inspector-heading">
              <Icon name="image" size={17} />
              <h2>
                {panel === 'library'
                  ? 'Asset details'
                  : selected
                    ? 'Image details'
                    : 'Your next image'}
              </h2>
            </div>
            {panel === 'library' ? (
              <AssetDetails
                asset={libraryAsset}
                thumbnails={thumbnails}
                targetLabel={selected?.label}
                canUse={
                  !!selected?.editable &&
                  libraryAsset?.kind === selected.kind &&
                  connection === 'connected'
                }
                busy={busy}
                onArchive={() => {
                  if (libraryAsset)
                    send({
                      type: 'archive',
                      assetId: libraryAsset.id,
                      version: libraryAsset.version,
                    })
                }}
                onUse={() => {
                  if (selected && libraryAsset)
                    send({
                      type: 'reuse',
                      id: selected.id,
                      version: selected.version,
                      assetId: libraryAsset.id,
                      assetVersion: libraryAsset.version,
                    })
                }}
              />
            ) : selected ? (
              <>
                {currentAsset ? (
                  <AssetThumbnail
                    asset={currentAsset}
                    thumbnails={thumbnails}
                    className="detail-thumbnail"
                  />
                ) : (
                  <div className={`selection-art ${selected.kind}`}>
                    <Icon name={selected.kind === 'svg' ? 'cursor' : 'image'} size={46} />
                    <span>
                      {selected.kind === 'svg'
                        ? 'SVG VECTOR'
                        : selected.current
                          ? 'PHOTO'
                          : 'EMPTY PHOTO SLOT'}
                    </span>
                  </div>
                )}
                <h3 className="selection-name">{selected.label}</h3>
                {selected.presentation && (
                  <p className="library-hint">
                    {selected.presentation === 'background'
                      ? 'Background image · shared CSS rules update every matching element.'
                      : selected.presentation === 'responsive'
                        ? `Responsive candidate ${selected.descriptor ?? ''} · other candidates keep their sources.`
                        : selected.presentation === 'inline-svg'
                          ? 'Inline vector · layout attributes are preserved.'
                          : 'SVG component · only this source placement is replaced.'}
                  </p>
                )}
                <div className="detail-label">SOURCE FILE</div>
                <code className="source-file">
                  {selected.file}:{selected.line}
                </code>
                <div className="detail-label">CURRENT ASSET</div>
                <code className="source-file">{selected.current || 'No image assigned yet'}</code>
                {selected.data && (
                  <div className="mapped-field">
                    <span>LINKED JSON FIELD</span>
                    <code>
                      {selected.data.file} #{selected.data.pointer || '/'}
                    </code>
                    <p>
                      {(selected.data.consumers ?? 1) > 1
                        ? `This field feeds ${selected.data.consumers} image placements. Updating it affects all of them.`
                        : 'Replacements edit this field. Other records remain unchanged.'}
                    </p>
                  </div>
                )}
                {selected.canMap && (
                  <DataMapping
                    key={selected.id}
                    fields={snapshot?.fields ?? []}
                    busy={busy}
                    onMap={(field) =>
                      send({ type: 'map', id: selected.id, version: selected.version, field })
                    }
                  />
                )}
                {selected.instances > 1 && (
                  <p className="mapping-note">
                    This source renders {selected.instances} times on this page. Replacing it
                    updates every instance.
                  </p>
                )}
                {!selected.editable ? (
                  <p className="mapping-note">{selected.reason}</p>
                ) : (
                  <>
                    {currentAsset?.kind === 'raster' && (
                      <button
                        className="secondary-action"
                        disabled={busy}
                        onClick={() => setPending({ target: selected, asset: currentAsset })}
                      >
                        Crop / optimize current image
                      </button>
                    )}
                    <button
                      className="secondary-action"
                      disabled={busy}
                      onClick={() => {
                        setLibraryAssetId(currentAsset?.id ?? '')
                        setPanel('library')
                      }}
                    >
                      <Icon name="grid" size={16} />
                      Choose from library
                    </button>
                    <button
                      className="drop-card"
                      disabled={busy || connection !== 'connected'}
                      onClick={() => input.current?.click()}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        if (event.dataTransfer.files.length === 1)
                          upload(event.dataTransfer.files[0])
                        else setNotice({ error: true, message: 'Drop one image at a time.' })
                      }}
                    >
                      <Icon name="upload" size={27} />
                      <strong>{busy ? 'Saving your image…' : 'Drop a replacement'}</strong>
                      <span>or click to choose a file</span>
                      <small>
                        {selected.kind === 'svg' ? 'Static SVG only' : 'JPG, PNG, WebP, AVIF'} · up
                        to 15 MB
                      </small>
                    </button>
                    <input
                      ref={input}
                      className="visually-hidden"
                      type="file"
                      tabIndex={-1}
                      aria-label="Choose replacement image"
                      accept={
                        selected.kind === 'svg'
                          ? '.svg,image/svg+xml'
                          : '.jpg,.jpeg,.png,.webp,.avif'
                      }
                      onChange={(event) => {
                        upload(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                    <div className="optimization-note">
                      <Icon name="check" size={15} />
                      <p>
                        {selected.kind === 'svg'
                          ? 'Optimized as SVG. Vector scaling is preserved.'
                          : `Auto-oriented. ${snapshot?.settings.format.toUpperCase() ?? 'WEBP'} defaults; crop and adjust output before saving.`}
                      </p>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="unselected">
                <div className="empty-art">
                  <span className="art-back" />
                  <span className="art-front">
                    <Icon name="image" size={42} />
                  </span>
                  <span className="art-plus">+</span>
                </div>
                <h3>
                  Give your page
                  <br />a fresh perspective.
                </h3>
                <p>
                  Select an image on the page or in the list to see its source and drop in a
                  replacement.
                </p>
                <div className="tip">
                  <span>TRY IT OUT</span>
                  <p>Start with the school logo or one of the photo placeholders.</p>
                </div>
              </div>
            )}
            <div className="inspector-bottom">
              <Icon name="undo" size={15} />
              <span>Changed your mind? Undo from history.</span>
            </div>
          </aside>
        </div>
        {notice && (
          <div
            className={`notice ${notice.error ? 'error' : ''}`}
            role={notice.error ? 'alert' : 'status'}
          >
            <Icon name={notice.error ? 'image' : 'check'} size={18} />
            <span>{notice.message}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        )}
      </main>
      {pending && (
        <ImageReview
          file={pending.file}
          preview={
            pending.asset
              ? thumbnails.previews[assetKey(pending.asset.id, pending.asset.version)]
              : undefined
          }
          initial={snapshot?.settings ?? DEFAULT_PROFILE}
          label={pending.target.label}
          busy={busy}
          saveError={
            saveError ||
            (connection !== 'connected'
              ? 'The project is disconnected. Keep the app running to save this image.'
              : '')
          }
          connected={connection === 'connected'}
          onCancel={() => {
            setPending(null)
            setSaveError('')
          }}
          onApply={(options) => {
            if (busy || saveRequest.current || connection !== 'connected') return
            const requestId = crypto.randomUUID()
            saveRequest.current = requestId
            setSaveError('')
            setBusy(true)
            if (pending.file)
              send({
                type: 'replace',
                requestId,
                id: pending.target.id,
                version: pending.target.version,
                file: pending.file,
                options,
              })
            else if (pending.asset)
              send({
                type: 'reprocess',
                requestId,
                id: pending.target.id,
                version: pending.target.version,
                assetId: pending.asset.id,
                assetVersion: pending.asset.version,
                options,
              })
          }}
        />
      )}
    </div>
  )
}
