import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ImageOptions, ImageSaveProgress, OptimizationProfile } from '../shared'
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, cropBounds } from '../shared'
import './image-tools.css'

function ProfileFields({
  profile,
  onChange,
  showLimits = true,
}: {
  profile: OptimizationProfile
  onChange: (profile: OptimizationProfile) => void
  showLimits?: boolean
}) {
  return (
    <div className="profile-fields">
      <label>
        Output format
        <select
          value={profile.format}
          onChange={(event) =>
            onChange({ ...profile, format: event.target.value as OptimizationProfile['format'] })
          }
        >
          <option value="webp">WebP</option>
          <option value="avif">AVIF</option>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG (lossless)</option>
        </select>
      </label>
      <label>
        Quality {profile.quality}
        <input
          aria-label="Output quality"
          type="range"
          min="1"
          max="100"
          disabled={profile.format === 'png'}
          value={profile.quality}
          onChange={(event) => onChange({ ...profile, quality: Number(event.target.value) })}
        />
      </label>
      {showLimits && (
        <>
          <label>
            Maximum width
            <input
              type="number"
              required
              min="16"
              max="4096"
              value={profile.maxWidth}
              onChange={(event) => onChange({ ...profile, maxWidth: Number(event.target.value) })}
            />
          </label>
          <label>
            Maximum height
            <input
              type="number"
              required
              min="16"
              max="4096"
              value={profile.maxHeight}
              onChange={(event) => onChange({ ...profile, maxHeight: Number(event.target.value) })}
            />
          </label>
          <p>
            No upscaling. JPEG places transparency on white. A picture source with a declared format
            keeps that format.
          </p>
        </>
      )}
    </div>
  )
}

const progressSteps = [
  { stage: 'uploading', label: 'Upload' },
  { stage: 'preparing', label: 'Prepare' },
  { stage: 'optimizing', label: 'Resize & optimize' },
  { stage: 'saving', label: 'Save to project' },
  { stage: 'refreshing', label: 'Refresh preview' },
] as const

function SaveProgress({ progress }: { progress: ImageSaveProgress }) {
  const matched = progressSteps.findIndex((step) => step.stage === progress.stage)
  const current =
    matched >= 0
      ? matched
      : progress.percent >= 96
        ? 4
        : progress.percent >= 76
          ? 3
          : progress.percent >= 42
            ? 2
            : progress.percent >= 30
              ? 1
              : 0
  const currentLabel =
    progress.stage === 'cancelling' ? 'Stopping safely…' : `${progressSteps[current].label}…`
  return (
    <div className="save-progress" role="status" aria-live="polite">
      <div className="save-progress-heading">
        <strong>{currentLabel}</strong>
        <span>{Math.round(progress.percent)}%</span>
      </div>
      <progress max="100" value={progress.percent} aria-label="Image save progress" />
      <ol>
        {progressSteps.map((step, index) => (
          <li
            key={step.stage}
            className={
              progress.stage === 'cancelling'
                ? index <= current
                  ? 'complete'
                  : ''
                : index < current
                  ? 'complete'
                  : index === current
                    ? 'active'
                    : ''
            }
          >
            <span>{index < current ? '✓' : index + 1}</span>
            {step.label}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function OptimizationSettings({
  initial,
  busy,
  onSave,
}: {
  initial: OptimizationProfile
  busy: boolean
  onSave: (profile: OptimizationProfile) => void
}) {
  const [profile, setProfile] = useState(initial)
  return (
    <details className="optimization-settings">
      <summary>Project optimization defaults</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy) onSave(profile)
        }}
      >
        <ProfileFields profile={profile} onChange={setProfile} />
        <label className="filename-toggle">
          <input
            type="checkbox"
            checked={profile.hashFilenames !== false}
            onChange={(event) => setProfile({ ...profile, hashFilenames: event.target.checked })}
          />
          <span>
            <strong>Hash generated filenames</strong>
            <small>
              {profile.hashFilenames !== false
                ? 'Example: 3f98ab12c5d4.webp'
                : 'Example: original-name_2000x1000.webp'}
            </small>
          </span>
        </label>
        <button className="secondary-action" disabled={busy}>
          Save defaults
        </button>
      </form>
    </details>
  )
}

function svgLength(value: string | null) {
  const match = value?.match(/^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i)
  return match ? Number(match[1]) : undefined
}

function normalizedHex(value: string) {
  const raw = value.trim().replace(/^#/, '').toLowerCase()
  if (/^[a-f0-9]{3}$/.test(raw)) return raw.split('').map((part) => part + part).join('')
  return /^[a-f0-9]{6}$/.test(raw) ? raw : undefined
}

function recolorablePaint(value: string) {
  return (
    !/^(?:none|transparent|inherit|context-fill|context-stroke)$/i.test(value.trim()) &&
    !/^url\s*\(/i.test(value.trim())
  )
}

function safeSvgPreview(source: string) {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = document.documentElement
  if (root.localName.toLowerCase() !== 'svg' || document.querySelector('parsererror'))
    throw new Error('Choose a valid SVG file.')
  const forbidden = new Set([
    'script',
    'foreignobject',
    'iframe',
    'object',
    'embed',
    'style',
    'animate',
    'animatetransform',
    'animatemotion',
    'set',
    'image',
    'feimage',
  ])
  const colors = new Set<string>()
  for (const element of document.querySelectorAll('*')) {
    if (forbidden.has(element.localName.toLowerCase()))
      throw new Error('This SVG contains content that cannot be previewed safely.')
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value
      if (
        name.startsWith('on') ||
        name === 'xml:base' ||
        name === 'style' ||
        ((name === 'href' || name.endsWith(':href')) && !/^#[\w.-]+$/.test(value)) ||
        (/url\s*\(/i.test(value) && !/^url\(\s*['"]?#[\w.-]+['"]?\s*\)$/.test(value)) ||
        /javascript:|data:|\\|\/\*/i.test(value)
      )
        throw new Error('This SVG contains active content or external resources.')
      if (['fill', 'stroke', 'color'].includes(name)) {
        const color = normalizedHex(value)
        if (color) colors.add(`#${color}`)
      }
    }
  }
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const viewBoxWidth = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? viewBox[2] : 0
  const viewBoxHeight = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? viewBox[3] : 0
  let width = svgLength(root.getAttribute('width'))
  let height = svgLength(root.getAttribute('height'))
  if ((!width || !height) && viewBoxWidth > 0 && viewBoxHeight > 0) {
    if (width) height = width * (viewBoxHeight / viewBoxWidth)
    else if (height) width = height * (viewBoxWidth / viewBoxHeight)
    else {
      width = viewBoxWidth
      height = viewBoxHeight
    }
  }
  if (!width || !height)
    throw new Error('This SVG needs a viewBox or numeric width and height before it can be resized.')
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    colors: [...colors],
  }
}

function recoloredSvg(source: string, hex: string) {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = document.documentElement
  const color = `#${hex}`
  root.setAttribute('color', color)
  if (!root.hasAttribute('fill')) root.setAttribute('fill', color)
  for (const element of document.querySelectorAll('*'))
    for (const name of ['fill', 'stroke', 'color']) {
      const value = element.getAttribute(name)
      if (value && recolorablePaint(value)) element.setAttribute(name, color)
    }
  return new XMLSerializer().serializeToString(document)
}

const recentSvgColorsKey = 'picaroo:recent-svg-colors'

export function SvgReview({
  file,
  label,
  busy,
  progress,
  saveError,
  connected,
  onCancel,
  onApply,
}: {
  file: File
  label: string
  busy: boolean
  progress: ImageSaveProgress | null
  saveError: string
  connected: boolean
  onCancel: () => void
  onApply: (options: ImageOptions) => void
}) {
  const [preview, setPreview] = useState<string>()
  const [source, setSource] = useState('')
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 })
  const [outputSize, setOutputSize] = useState({ width: 0, height: 0 })
  const [colorInput, setColorInput] = useState('#000000')
  const [detectedColors, setDetectedColors] = useState<string[]>([])
  const [recentColors, setRecentColors] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(recentSvgColorsKey) ?? '[]')
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && !!normalizedHex(item)).slice(0, 8)
        : []
    } catch {
      return []
    }
  })
  const [locked, setLocked] = useState(true)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    setSource('')
    setError('')
    void file
      .text()
      .then((source) => {
        const size = safeSvgPreview(source)
        if (cancelled) return
        setSourceSize(size)
        setOutputSize(size)
        setDetectedColors(size.colors)
        setColorInput(size.colors[0] ?? recentColors[0] ?? '#000000')
        setSource(source)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Choose a valid SVG file.')
      })
    return () => {
      cancelled = true
    }
  }, [file])
  const color = normalizedHex(colorInput)
  useEffect(() => {
    if (!source) {
      setPreview(undefined)
      return
    }
    const objectUrl = URL.createObjectURL(
      new Blob([color ? recoloredSvg(source, color) : source], { type: 'image/svg+xml' }),
    )
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [source, color])
  const aspect = sourceSize.width && sourceSize.height ? sourceSize.width / sourceSize.height : 1
  const outputValid =
    Number.isInteger(outputSize.width) &&
    Number.isInteger(outputSize.height) &&
    outputSize.width >= 1 &&
    outputSize.height >= 1 &&
    outputSize.width <= MAX_IMAGE_DIMENSION &&
    outputSize.height <= MAX_IMAGE_DIMENSION &&
    outputSize.width * outputSize.height <= MAX_IMAGE_PIXELS
  const palette = [...new Set([...detectedColors, ...recentColors])].slice(0, 10)
  const stem =
    file.name
      .replace(/\.svg$/i, '')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .replace(/_\d+x\d+(?:_[a-f0-9]{6})?(?:_[a-f0-9]{8})?$/i, '') || 'image'
  const filenameStem = stem.slice(0, 60) || 'image'
  return (
    <div className="image-review-backdrop">
      <section
        className="image-review svg-review"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="svg-review-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onCancel()
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && preview && connected && outputValid && color) {
              const selected = `#${color}`
              const nextRecent = [selected, ...recentColors.filter((item) => item !== selected)].slice(0, 8)
              setRecentColors(nextRecent)
              try {
                localStorage.setItem(recentSvgColorsKey, JSON.stringify(nextRecent))
              } catch {
                // Saving an SVG should still work when browser storage is unavailable.
              }
              onApply({
                outputWidth: outputSize.width,
                outputHeight: outputSize.height,
                color: selected,
              })
            }
          }}
        >
          <header>
            <div>
              <h2 id="svg-review-title">Prepare your SVG</h2>
              <p>{label}</p>
            </div>
            <button
              type="button"
              aria-label={busy ? 'Cancel SVG processing' : 'Cancel SVG editing'}
              onClick={onCancel}
              disabled={progress?.stage === 'cancelling'}
            >
              ×
            </button>
          </header>
          {saveError && <p role="alert">{saveError}</p>}
          <fieldset className="image-review-grid" disabled={busy}>
            <div>
              <div className="svg-preview">
                {preview && <img src={preview} alt="SVG preview" />}
                {!preview && !error && <span>Reading SVG…</span>}
              </div>
              {error && <p role="alert">{error}</p>}
              {preview && (
                <p className="crop-help">
                  Vector scaling is preserved. CSS in the application can still override these
                  intrinsic dimensions.
                </p>
              )}
            </div>
            <div className="output-settings">
              <div className="svg-size-heading">
                <strong>Intrinsic size</strong>
                <span>
                  Original: {sourceSize.width || '—'} × {sourceSize.height || '—'} px
                </span>
              </div>
              <div className="output-dimensions">
                <label>
                  Width
                  <span className="dimension-input">
                    <input
                      type="number"
                      required
                      min="1"
                      max={MAX_IMAGE_DIMENSION}
                      value={outputSize.width || ''}
                      onChange={(event) => {
                        const width = Number(event.target.value)
                        setOutputSize({
                          width,
                          height: locked && width ? Math.max(1, Math.round(width / aspect)) : outputSize.height,
                        })
                      }}
                    />
                    <span>px</span>
                  </span>
                </label>
                <label>
                  Height
                  <span className="dimension-input">
                    <input
                      type="number"
                      required
                      min="1"
                      max={MAX_IMAGE_DIMENSION}
                      value={outputSize.height || ''}
                      onChange={(event) => {
                        const height = Number(event.target.value)
                        setOutputSize({
                          width: locked && height ? Math.max(1, Math.round(height * aspect)) : outputSize.width,
                          height,
                        })
                      }}
                    />
                    <span>px</span>
                  </span>
                </label>
                <label className="aspect-lock">
                  <input
                    type="checkbox"
                    checked={locked}
                    onChange={(event) => setLocked(event.target.checked)}
                  />
                  Lock original aspect ratio
                </label>
                <p className={outputValid ? '' : 'dimension-error'}>
                  Output: {outputSize.width || '—'} × {outputSize.height || '—'} px
                  {!outputValid && ` · Keep the output at or below ${MAX_IMAGE_PIXELS / 1_000_000} MP.`}
                </p>
              </div>
              <div className="svg-color-editor">
                <div className="svg-size-heading">
                  <strong>Color</strong>
                  <span>Solid fills and strokes use the selected color.</span>
                </div>
                <div className="svg-color-inputs">
                  <input
                    type="color"
                    aria-label="Choose SVG color"
                    value={`#${color ?? '000000'}`}
                    onChange={(event) => setColorInput(event.target.value)}
                  />
                  <label>
                    Hex color
                    <input
                      type="text"
                      value={colorInput}
                      spellCheck={false}
                      aria-invalid={!color}
                      placeholder="#000000"
                      onChange={(event) => setColorInput(event.target.value)}
                    />
                  </label>
                </div>
                {!color && <p role="alert">Enter a three- or six-digit hex color.</p>}
                {!!palette.length && (
                  <div className="svg-color-palette" aria-label="Detected and recent colors">
                    {palette.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={normalizedHex(item) === color ? 'selected' : ''}
                        style={{ '--swatch': item } as CSSProperties}
                        title={item.toUpperCase()}
                        aria-label={`Use ${item.toUpperCase()}`}
                        onClick={() => setColorInput(item)}
                      >
                        <span />
                        {item.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                <small>Gradients, patterns, transparent paint, and “none” are preserved.</small>
              </div>
              {outputValid && color && (
                <div className="svg-filename-preview">
                  <span>Generated filename</span>
                  <code>{filenameStem}_{outputSize.width}x{outputSize.height}_{color}.svg</code>
                </div>
              )}
            </div>
          </fieldset>
          {progress && <SaveProgress progress={progress} />}
          <footer>
            <button
              type="button"
              className="secondary-action cancel-action"
              onClick={onCancel}
              disabled={progress?.stage === 'cancelling'}
            >
              {busy ? 'Stop saving' : 'Cancel'}
            </button>
            <button
              className="primary-action"
              disabled={busy || !preview || !outputValid || !color || !connected}
            >
              {busy ? 'Saving…' : 'Save SVG'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export function ImageReview({
  file,
  preview,
  initial,
  label,
  busy,
  progress,
  saveError,
  connected,
  sourceDimensions,
  onCancel,
  onApply,
}: {
  file?: File
  preview?: string | null
  initial: OptimizationProfile
  label: string
  busy: boolean
  progress: ImageSaveProgress | null
  saveError: string
  connected: boolean
  sourceDimensions?: { width: number; height: number }
  onCancel: () => void
  onApply: (options: ImageOptions) => void
}) {
  const [url, setUrl] = useState<string>()
  const [profile, setProfile] = useState(initial)
  const [ratio, setRatio] = useState(0)
  const [focusX, setFocusX] = useState(0.5)
  const [focusY, setFocusY] = useState(0.5)
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 })
  const [sourceSize, setSourceSize] = useState(sourceDimensions ?? { width: 1, height: 1 })
  const [outputSize, setOutputSize] = useState(
    sourceDimensions ?? { width: 0, height: 0 },
  )
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  useEffect(() => {
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  const bounds = cropBounds(dimensions.width, dimensions.height, ratio, focusX, focusY)
  const outputValid =
    Number.isInteger(outputSize.width) &&
    Number.isInteger(outputSize.height) &&
    outputSize.width >= 16 &&
    outputSize.height >= 16 &&
    outputSize.width <= MAX_IMAGE_DIMENSION &&
    outputSize.height <= MAX_IMAGE_DIMENSION &&
    outputSize.width * outputSize.height <= MAX_IMAGE_PIXELS
  return (
    <div className="image-review-backdrop">
      <section
        className="image-review"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-review-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onCancel()
          if (event.key === 'Tab') {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'button:enabled, input:enabled, select:enabled',
              ),
            ]
            const first = controls[0]
            const last = controls.at(-1)
            if (!first) event.preventDefault()
            else if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === dialog.current)
            ) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && loaded && connected && outputValid)
              onApply({
                profile,
                ratio,
                focusX,
                focusY,
                outputWidth: outputSize.width,
                outputHeight: outputSize.height,
              })
          }}
        >
          <header>
            <div>
              <h2 id="image-review-title">Prepare your image</h2>
              <p>{label}</p>
            </div>
            <button
              type="button"
              aria-label={busy ? 'Cancel image processing' : 'Cancel image editing'}
              onClick={onCancel}
              disabled={progress?.stage === 'cancelling'}
            >
              ×
            </button>
          </header>
          {saveError && <p role="alert">{saveError}</p>}
          <fieldset
            className="image-review-grid"
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div>
              <div
                className="crop-preview"
                onPointerDown={(event) => {
                  if (busy || !loaded) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const rect = event.currentTarget.getBoundingClientRect()
                  setFocusX(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        ((event.clientX - rect.left) / rect.width -
                          bounds.width / dimensions.width / 2) /
                          Math.max(0.0001, 1 - bounds.width / dimensions.width),
                      ),
                    ),
                  )
                  setFocusY(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        ((event.clientY - rect.top) / rect.height -
                          bounds.height / dimensions.height / 2) /
                          Math.max(0.0001, 1 - bounds.height / dimensions.height),
                      ),
                    ),
                  )
                }}
                onPointerMove={(event) => {
                  if (busy || !loaded) return
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  setFocusX(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        ((event.clientX - rect.left) / rect.width -
                          bounds.width / dimensions.width / 2) /
                          Math.max(0.0001, 1 - bounds.width / dimensions.width),
                      ),
                    ),
                  )
                  setFocusY(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        ((event.clientY - rect.top) / rect.height -
                          bounds.height / dimensions.height / 2) /
                          Math.max(0.0001, 1 - bounds.height / dimensions.height),
                      ),
                    ),
                  )
                }}
              >
                {(url || preview) && (
                  <img
                    src={url ?? preview!}
                    alt="Image crop preview"
                    onLoad={(event) => {
                      const natural = {
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      }
                      setDimensions({
                        width: natural.width,
                        height: natural.height,
                      })
                      if (!sourceDimensions) {
                        setSourceSize(natural)
                        setOutputSize(natural)
                      }
                      setLoaded(true)
                      setError('')
                    }}
                    onError={() => {
                      setLoaded(false)
                      setError('This file cannot be previewed. Choose a supported raster image.')
                    }}
                  />
                )}
                {loaded && (
                  <span
                    className="crop-frame"
                    style={{
                      left: `${(bounds.left / dimensions.width) * 100}%`,
                      top: `${(bounds.top / dimensions.height) * 100}%`,
                      width: `${(bounds.width / dimensions.width) * 100}%`,
                      height: `${(bounds.height / dimensions.height) * 100}%`,
                    }}
                  />
                )}
              </div>
              <p className="crop-help">
                Drag on the preview or use the sliders to position the crop. Existing library assets
                are kept when you save a new crop.
              </p>
              {error && <p role="alert">{error}</p>}
              {!file && preview === null && (
                <p role="alert">
                  The image preview is unavailable. Cancel and reload the preview to try again.
                </p>
              )}
              <label className="crop-control">
                Crop shape
                <select
                  value={ratio}
                  onChange={(event) => {
                    const nextRatio = Number(event.target.value)
                    setRatio(nextRatio)
                    const next = cropBounds(sourceSize.width, sourceSize.height, nextRatio)
                    setOutputSize({ width: next.width, height: next.height })
                  }}
                >
                  <option value="0">Original proportions</option>
                  <option value="1">Square · 1:1</option>
                  <option value={4 / 3}>Landscape · 4:3</option>
                  <option value={16 / 9}>Wide · 16:9</option>
                  <option value={3 / 4}>Portrait · 3:4</option>
                  <option value={9 / 16}>Tall · 9:16</option>
                </select>
              </label>
              <label className="crop-control">
                Horizontal focal point
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={focusX}
                  disabled={!ratio}
                  onChange={(event) => setFocusX(Number(event.target.value))}
                />
              </label>
              <label className="crop-control">
                Vertical focal point
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={focusY}
                  disabled={!ratio}
                  onChange={(event) => setFocusY(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="output-settings">
              <ProfileFields profile={profile} onChange={setProfile} showLimits={false} />
              <div className="output-dimensions">
                <label>
                  Output width
                  <span className="dimension-input">
                    <input
                      type="number"
                      required
                      min="16"
                      max={MAX_IMAGE_DIMENSION}
                      value={outputSize.width || ''}
                      onChange={(event) =>
                        setOutputSize({ ...outputSize, width: Number(event.target.value) })
                      }
                    />
                    <span>px</span>
                  </span>
                </label>
                <label>
                  Output height
                  <span className="dimension-input">
                    <input
                      type="number"
                      required
                      min="16"
                      max={MAX_IMAGE_DIMENSION}
                      value={outputSize.height || ''}
                      onChange={(event) =>
                        setOutputSize({ ...outputSize, height: Number(event.target.value) })
                      }
                    />
                    <span>px</span>
                  </span>
                </label>
                <p className={outputValid ? '' : 'dimension-error'}>
                  Original: {sourceSize.width} × {sourceSize.height} px. The saved image will be
                  exactly {outputSize.width || '—'} × {outputSize.height || '—'} px.
                  {!outputValid && ` Keep the output at or below ${MAX_IMAGE_PIXELS / 1_000_000} MP.`}
                </p>
              </div>
            </div>
          </fieldset>
          {progress && <SaveProgress progress={progress} />}
          <footer>
            <button
              type="button"
              className="secondary-action cancel-action"
              onClick={onCancel}
              disabled={progress?.stage === 'cancelling'}
            >
              {progress?.stage === 'cancelling' ? 'Cancelling…' : busy ? 'Cancel process' : 'Cancel'}
            </button>
            <button
              className="primary-action"
              disabled={busy || !loaded || !connected || !outputValid}
            >
              {busy ? 'Saving…' : 'Save image'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
