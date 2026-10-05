import { useEffect, useState } from 'react'
import importedAsset from './assets/imported.svg'
import imageData from './data/images.json'
import { ImagePlaceholder, MediaSlot } from './components/ImagePlaceholder'

export function App() {
  const [showDelayed, setShowDelayed] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setShowDelayed(true), 250)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main>
      <h1>Picaroo React discovery fixture</h1>
      <section className="image-grid" aria-label="React image discovery examples">
        <img src="/assets/literal.svg" alt="React literal image" />
        <img src={importedAsset} alt="React imported asset" />
        <ImagePlaceholder src="/assets/custom-component.svg" label="Registered image component" />
        <ImagePlaceholder label="Registered empty image slot" />
        <MediaSlot src={imageData.hero.src} label="Direct JSON image" />
        {imageData.gallery.map((image, index) => (
          <ImagePlaceholder key={image.alt} src={image.src} label={image.alt} />
        ))}
        <img
          src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA3MiI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9IjcyIiBmaWxsPSIjNDBjYjk2Ii8+PC9zdmc+"
          alt="React embedded Base64 image"
        />
        <img
          src="/assets/responsive-fallback.svg"
          srcSet="/assets/responsive-small.svg 1x, /assets/responsive-large.svg 2x"
          alt="Responsive React image"
        />
        <div
          className="visual-target"
          role="img"
          aria-label="Inline React background"
          style={{ backgroundImage: 'url(/assets/inline-background.svg)' }}
        />
        <div className="react-css-background" role="img" aria-label="React CSS background" />
        <svg
          className="visual-target"
          viewBox="0 0 96 72"
          role="img"
          aria-label="Inline React SVG"
        >
          <rect width="96" height="72" fill="#7c6fd0" />
        </svg>
        {showDelayed && <img src="/assets/delayed.svg" alt="Delayed React image" />}
      </section>
    </main>
  )
}
