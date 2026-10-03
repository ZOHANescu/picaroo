# Picaroo

Picaroo is a local, visual image editor for web applications. Open your running app in Picaroo, select an image, and replace, crop, resize, recolor, reuse, or remove it. Picaroo writes the result back to your source code and asset folders—there is no hosted asset service and nothing is added to the production runtime.

Source-aware editing supports **React**, **Angular**, and **plain HTML**. Any project served by a local HTTP development server can use the visual workspace, asset library, and project-wide usage scan.

## What you can do

- Replace images and SVGs directly on the rendered page.
- Crop raster images, set a focal point, choose exact output dimensions, and convert to WebP, AVIF, JPEG, or PNG.
- Resize and recolor SVGs, then save reusable variants without overwriting the original.
- Recolor raster icons while preserving transparency, including embedded Base64 images.
- Edit image paths in JSX/TSX, Angular templates, plain HTML, CSS backgrounds, JSON data, inline SVGs, and existing `srcSet` candidates.
- Browse every project asset, inspect dimensions and usage, and reuse an existing image.
- Remove an image reference and move an unused local file to recoverable Picaroo trash.
- Undo the latest source and asset changes safely.

## Requirements and support

- Node.js 22 or newer.
- A local HTTP development server.
- JPEG, PNG, WebP, AVIF, and SVG assets up to 50 MB and 64 megapixels.
- A standard `public/` directory or Angular `src/assets/` directory.

Picaroo understands native images, CSS backgrounds, static inline SVGs, React asset imports, Angular static bindings and readonly data, direct JSON imports, and PrimeNG `p-image`, `p-avatar`, and image-bearing `p-chip` components. Dynamic or unresolved expressions are marked **Needs mapping** instead of being rewritten speculatively.

Picaroo is currently installed as a local package, usually through a Git submodule. It is not published to npm.

## Install

From the application root, add Picaroo as a submodule and local development dependency:

```sh
git submodule add <PICAROO_REPOSITORY_URL> external/picaroo
```

```json
{
  "devDependencies": {
    "picaroo": "file:external/picaroo"
  },
  "scripts": {
    "picaroo": "picaroo --url http://localhost:4200"
  }
}
```

Replace `4200` with your application's development port, then install dependencies:

```sh
npm install
```

Add Picaroo's local state to the consuming application's `.gitignore`:

```gitignore
.picaroo/
```

Generated assets under `public/picaroo/` or `src/assets/picaroo/` are normal project files and can be committed.

### React + Vite

React + Vite projects should enable the development-only adapter. It gives repeated image URLs stable identities and makes registered empty image slots selectable. It does not affect production builds.

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { picaroo } from 'picaroo/vite'

export default defineConfig({
  plugins: [picaroo(), react()],
})
```

Angular and plain HTML projects need no build integration.

### Custom React image components

Register application-owned components that accept a `src` prop and forward `data-picaroo-id` to their visible root element:

```json
{
  "picaroo": {
    "components": ["ImagePlaceholder", "MediaSlot"]
  }
}
```

```tsx
export function MediaSlot({ src, label, ...rootProps }) {
  return <div {...rootProps}>{src ? <img src={src} alt={label} /> : label}</div>
}
```

The CLI and Vite adapter both read this configuration. For a one-off run, add names with `--component MediaSlot`.

## Run

Keep the application and Picaroo running in separate terminals:

```sh
# Terminal 1
npm run dev

# Terminal 2
npm run picaroo
```

Open [http://localhost:4310](http://localhost:4310). Use `--port`, `--preview-port`, and `--project` to change the defaults:

```sh
npx picaroo --url http://localhost:3000 --port 4310 --preview-port 4311 --project .
```

## Typical workflow

1. Open a route in Picaroo's embedded preview.
2. Select a highlighted image or choose one from **Page images**.
3. Drop a replacement, choose a library asset, edit the current image, or remove it.
4. Review crop, size, format, quality, or SVG color settings and save.
5. Let the application refresh; use **Change history** if you need to undo.

Switch to **Browse** for normal application navigation. Desktop and mobile controls change the preview viewport.

## Where Picaroo can write

| Source | Supported edits |
| --- | --- |
| React JSX/TSX | Literal paths, direct asset imports, registered image components, static JSON fields, inline styles, inline SVG, and literal `srcSet` |
| Angular | Static template sources, static bindings, readonly object/array fields, `@for` records, PrimeNG image components, inline templates, and CSS |
| Plain HTML | Image sources, inline SVG, responsive candidates, and linked CSS backgrounds |
| JSON | Direct imported string fields and direct array `.map()` records |
| CSS | Literal `url(...)` values in `background` and `background-image` |

Editing a source inside a reusable component may change every rendered instance. Picaroo reports shared placements and forks a direct asset import when one placement can be changed safely.

Computed URLs, API-provided images, spread props, transformed collections, CSS variables, preprocessors, Vue/Svelte rewriting, and runtime-generated values require manual source changes. Picaroo edits an existing static responsive set but does not generate a new one.

## Image output

Raster replacements default to auto-orientation, WebP quality 85, a 2400 × 2400 maximum, and no upscaling. The review dialog can request exact dimensions—including intentional upscaling—up to 64 megapixels. Project defaults control format, quality, maximum dimensions, and hashed or readable filenames.

SVGs can be resized and recolored before SVGO optimization. Picaroo preserves transparency, `viewBox`, gradients, patterns, and opacity, but intentionally flattens solid multicolor artwork when a replacement color is selected. Unsafe active or external SVG content is rejected.

Raster recoloring preserves alpha but replaces visible RGB values, so it is intended for monochrome icons rather than photographs.

## Asset library, history, and trash

The asset library scans supported project files without requiring every route to be opened. It shows thumbnails, dimensions, file sizes, and static references, and lets you filter, reuse, import, or create SVG variants.

**No static references** means Picaroo found no supported reference; it is not proof that an asset is unused at runtime.

Picaroo stores its local state in:

```text
.picaroo/history.json   Up to 50 source-aware Undo entries
.picaroo/settings.json  Project output preferences
.picaroo/trash/         Recoverable removed or archived assets
```

Trash is never purged automatically. Undo refuses to overwrite source or asset files that changed outside Picaroo.

## Safety

Picaroo accepts write requests only from loopback connections, uses an ephemeral session token, confines paths to the application root, blocks writes to `.git` and `node_modules`, checks source versions before saving, and serializes atomic file writes.

Avoid editing the same source location in your code editor while Picaroo is saving it.

## Update a consuming project

```sh
git -C external/picaroo fetch origin
git -C external/picaroo checkout <PICAROO_TAG_OR_COMMIT>
npm install
git add external/picaroo package-lock.json
git commit -m "chore: update Picaroo"
```

The submodule pins an exact Picaroo revision, so consuming applications do not change until you update that revision.

## Develop Picaroo

```sh
npm install
npm test
npm run typecheck
```

Picaroo runs its TypeScript source through `tsx`; there is no separate build step.

See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for version highlights and upgrade notes.
