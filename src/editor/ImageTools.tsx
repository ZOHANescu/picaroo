import { useEffect, useRef, useState } from 'react'
import type { ImageOptions, OptimizationProfile } from '../shared'
import { cropBounds } from '../shared'
import './image-tools.css'

function ProfileFields({
  profile,
  onChange,
}: {
  profile: OptimizationProfile
  onChange: (profile: OptimizationProfile) => void
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

export function ImageReview({
  file,
  preview,
  initial,
  label,
  busy,
  saveError,
  connected,
  onCancel,
  onApply,
}: {
  file?: File
  preview?: string | null
  initial: OptimizationProfile
  label: string
  busy: boolean
  saveError: string
  connected: boolean
  onCancel: () => void
  onApply: (options: ImageOptions) => void
}) {
  const [url, setUrl] = useState<string>()
  const [profile, setProfile] = useState(initial)
  const [ratio, setRatio] = useState(0)
  const [focusX, setFocusX] = useState(0.5)
  const [focusY, setFocusY] = useState(0.5)
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 })
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
            if (!busy && loaded && connected) onApply({ profile, ratio, focusX, focusY })
          }}
        >
          <header>
            <div>
              <h2 id="image-review-title">Prepare your image</h2>
              <p>{label}</p>
            </div>
            <button
              type="button"
              aria-label="Cancel image editing"
              onClick={onCancel}
              disabled={busy}
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
                      setDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
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
                <select value={ratio} onChange={(event) => setRatio(Number(event.target.value))}>
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
            <ProfileFields profile={profile} onChange={setProfile} />
          </fieldset>
          <footer>
            <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button className="primary-action" disabled={busy || !loaded || !connected}>
              {busy ? 'Saving…' : 'Save image'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
