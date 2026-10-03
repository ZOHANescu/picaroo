# Picaroo

Picaroo is a local visual image editor for web application development. It opens a running application inside an editing workspace, identifies supported image locations, and lets a developer replace images by dropping files directly onto the rendered page.

Changes are written back to the application's source files, JSON data, and asset directories. Picaroo does not use a hosted asset service or a runtime image manifest, and it is never included in the production application.

Picaroo is application-independent: it contains no assumptions about a particular website, brand, page structure, or data model. Its standalone preview gateway works with local HTTP development servers, while small development-only integrations provide framework-aware source detection. Source-aware editing currently supports **React**, **Angular**, and **plain HTML**, and every project benefits from the asset library and project-wide usage scan.

## What Picaroo does

- Shows the running application in a visual editing workspace.
- Adds selectable drop zones to supported images and SVGs.
- Validates raster and SVG replacements before changing the project.
- Optimizes raster images and writes production-ready assets.
- Updates JSX, TSX, CSS, imports, public URLs, and supported JSON fields.
- Tracks static image usage across the whole project.
- Provides a reusable local asset library with thumbnails and filters.
- Supports crop ratios, focal points, output formats, quality, and exact per-image dimensions.
- Edits individual records in supported JSON-backed lists and galleries.
- Handles CSS backgrounds, inline SVG, and existing responsive `srcSet` candidates.
- Keeps persistent, source-aware Undo history.
- Moves eligible unused generated assets to recoverable Picaroo trash.

## Supported environment

- Node.js 22 or newer.
- Any application served from a local HTTP development server.
- React JSX/TSX, Angular HTML templates (including static inline templates), or plain HTML.
- PrimeNG `p-image`, `p-avatar`, and image-bearing `p-chip` components.
- The standard `public/` directory or Angular's `src/assets/` directory.
- Plain CSS stylesheets.
- Local JPEG, PNG, WebP, AVIF, and SVG assets.

Picaroo is currently consumed as a local package, commonly through a Git submodule. Publishing it to npm is outside the current scope.

## Add Picaroo to an application

Add the Picaroo repository as a submodule from the application root:

```sh
git submodule add <PICAROO_REPOSITORY_URL> external/picaroo
```

Add the local package to the application's `package.json`:

```json
{
  "devDependencies": {
    "picaroo": "file:external/picaroo"
  }
}
```

Add a convenient script. Replace port `4200` if the application uses another development port:

```json
{
  "scripts": {
    "picaroo": "picaroo --url http://localhost:4200",
    "picaroo:typecheck": "tsc --noEmit -p external/picaroo/tsconfig.json"
  }
}
```

Install dependencies from the application root:

```sh
npm install
```

Picaroo runs a local preview gateway in front of the development server and injects its editing overlay only into that preview. Angular and plain HTML targets are matched from their rendered image URLs and need no build integration.

React + Vite projects should also enable the development-only `picaroo/vite` adapter. It adds stable `data-picaroo-id` attributes before React compiles JSX, which distinguishes repeated URLs and makes empty registered image slots selectable. The adapter applies only while serving development builds and is not included in production output:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { picaroo } from 'picaroo/vite'

export default defineConfig({
  plugins: [picaroo(), react()],
})
```

### Custom image-slot components

Standard `<img>` and supported SVG markup work without component registration. A React project can also register components that accept a `src` property and forward `data-picaroo-id` to their visible root element. Put the shared registration in the consuming project's `package.json` so the standalone service and Vite instrumentation use exactly the same names:

```json
{
  "picaroo": {
    "components": ["ImagePlaceholder", "MediaSlot"]
  }
}
```

The Vite plugin reads that configuration automatically. Additional names can still be supplied directly when needed:

```ts
export default defineConfig({
  plugins: [
    picaroo({
      components: ['ProjectImage'],
    }),
    react(),
  ],
})
```

A registered component must preserve the injected development attribute:

```tsx
type MediaSlotProps = React.HTMLAttributes<HTMLDivElement> & {
  src?: string
  label: string
}

export function MediaSlot({ src, label, ...rootProps }: MediaSlotProps) {
  return <div {...rootProps}>{src ? <img src={src} alt={label} /> : <span>{label}</span>}</div>
}
```

This makes an empty slot editable before it has an image. Registration should be limited to application-owned components whose source contract is known.

For a one-off standalone run, repeat `--component` for each extra name. These additions should match the names passed to the Vite adapter:

```sh
npx picaroo --url http://localhost:5173 --component ImagePlaceholder --component MediaSlot
```

## Ignore local Picaroo state

Add this entry to the consuming application's `.gitignore`:

```gitignore
.picaroo/
```

`.picaroo/history.json` stores local Undo data, `.picaroo/settings.json` stores project preferences, and `.picaroo/trash/` stores recoverable archived assets. Generated application assets under `public/picaroo/` or `src/assets/picaroo/` are normal project files and may be committed.

## Run Picaroo

Run the application and Picaroo from the consuming application root in two terminals.

Terminal 1:

```sh
npm run dev
```

Terminal 2:

```sh
npm run picaroo
```

Open [http://localhost:4310](http://localhost:4310). Picaroo connects to the application URL configured in the `picaroo` script through an isolated local preview on port `4311`.

The default editor port is `4310`. Both values can be changed:

```sh
npx picaroo --url http://localhost:3000 --port 4310 --preview-port 4311 --project .
```

Keep both development servers running while editing.

## Basic workflow

1. Open a route containing an image in the embedded application preview.
2. Keep **Edit images** enabled.
3. Select a highlighted image in the preview or the **Page images** list.
4. Drop one replacement file or use the file chooser.
5. Review raster crop and optimization settings or SVG dimensions, then save the image.
6. Follow the upload, preparation, optimization, save, and preview-refresh steps. Select **Cancel process** to stop an active raster save safely.
7. Let Vite refresh the application preview.
8. Use **Change history** to undo the newest change when needed.

Switch to **Browse** when normal application navigation is needed. Desktop and mobile buttons change the preview viewport.

If a save fails, the raster review remains open with the selected file and crop settings. If application source changed externally, cancel the review, select the refreshed target, and try again. Check Change history before repeating a save interrupted by a preview reload.

## Supported source patterns

| Source pattern                                                      | Behavior                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `<img src="/images/photo.jpg" />`                                   | Writes an optimized asset under `public/picaroo/` and changes the literal URL.     |
| `<img src="assets/photo.jpg">` in an Angular template               | Writes under `src/assets/picaroo/` when that asset root exists and updates the template. |
| `<img [src]="'assets/photo.jpg'">` in an Angular template           | Preserves the Angular binding and replaces its static string expression.           |
| `<img [src]="images.hero.src">` backed by a readonly TS object      | Updates the exact string in the component's static object initializer.             |
| An Angular `@for` or PrimeNG carousel over a readonly TS array       | Resolves each static record and updates only the selected image string.             |
| `<p-image src="assets/photo.jpg" />`                                | Selects the rendered PrimeNG image and updates the component source.                |
| `<p-avatar image="assets/person.jpg" />`                            | Supports PrimeNG avatar and chip image properties as editable image targets.        |
| `<img src={photo} />` using a direct default asset import           | Writes under `src/assets/picaroo/` and updates or safely forks the import.         |
| An SVG rendered through `<img>`                                     | Validates and optimizes a static SVG before updating its path.                     |
| A registered empty slot component                                   | Adds a `src` property at the component call site.                                  |
| A direct imported JSON field such as `content.hero.image`           | Updates that JSON string while retaining the component binding.                    |
| A direct JSON array `.map((item, index) => ...)` using `item.image` | Identifies and updates the selected JSON record.                                   |
| CSS `background` or `background-image`                              | Replaces one URL while retaining other background layers and values.               |
| A literal JSX `style` background                                    | Updates the selected URL inside the style object.                                  |
| A static inline `<svg>`                                             | Replaces vector content and `viewBox` while retaining root application attributes. |
| Literal `srcSet` on `<img>` or `<picture><source>`                  | Treats each candidate as a separate target and retains other candidates.           |

Computed or unresolved expressions, spread props, transformed collections, runtime-generated URLs, and unsupported bindings are shown as **Needs mapping** rather than being rewritten speculatively.

Editing a source inside a reusable component changes every rendered instance of that source. Picaroo reports multiple instances on the current page. Direct shared asset imports are forked when a single placement can be changed safely.

## JSON-backed images

Picaroo supports direct default JSON imports and existing string fields. Empty image strings can serve as editable placeholders:

```tsx
import content from './content.json'
import cards from './cards.json'

export function LandingPage() {
  return (
    <>
      <img src={content.hero.image} alt={content.hero.title} />

      {cards.map((card, index) => (
        <img key={card.id} src={card.image} alt={card.title} />
      ))}
    </>
  )
}
```

For repeated records, both callback parameters must be named identifiers. Keep the imported array in its original order. Filtering, sorting, mutation, nested transformations, destructuring, and JSON imports through aliases require manual source changes.

Image details show the JSON file and JSON Pointer associated with a mapped target. Replacing the rendered image updates only that JSON string. Multiple recognized consumers are reported because they share the same stored value.

JSON writes preserve surrounding formatting and properties. Duplicate JSON keys are rejected, and source and data versions are checked immediately before saving.

## Asset library and usage index

The **Asset library** scans the project without requiring every route to be opened. It provides:

- Raster and SVG thumbnails.
- Filename and directory search.
- Asset-type and usage filters.
- Dimensions and file sizes.
- Imports, literal paths, CSS URLs, JSON fields, and mapped consumers.
- Reuse across compatible image targets.
- Importing without immediately changing a placement.

The index is static analysis. Computed URLs, API-provided assets, arbitrary runtime transformations, and unsupported aliases may not be detected. **No static references** means the index found no supported reference; it is not proof that an asset is unused at runtime.

The scan excludes hidden directories, symlinks, dependencies, build output, and Picaroo's own submodule. It supports up to 15,000 relevant files, image files up to 50 MB, and source files up to 2 MB. Coverage problems appear in the library.

## Image optimization

Raster input supports JPEG, PNG, WebP, and AVIF. Picaroo rejects animated images and inputs above 64 million pixels or 50 MB.

Default raster processing:

- Auto-orientation.
- WebP output at quality 85.
- Maximum 2400 × 2400 bounding box.
- No upscaling.
- Optional aspect-ratio crop and focal point.

In the image review dialog, the uploaded image's own resolution is used as the initial output size. Editing **Output width** or **Output height** requests that exact final resolution (up to 64 megapixels), including intentional upscaling. Changing the crop shape resets the output dimensions to the crop's native pixel size.

Open **Asset library → Project optimization defaults** to choose WebP, AVIF, JPEG, or lossless PNG; quality from 1–100; and maximum dimensions from 16–4096 pixels for background imports and operations that do not provide an exact output size. JPEG transparency is flattened onto white.

Generated filenames are hashed by default:

```text
3f98ab12c5d4f017a493cc72.webp
```

Turn off **Hash generated filenames** to use the upload name and actual optimized dimensions:

```text
homepage-hero_2000x1000.webp
```

If that readable name already belongs to different contents, Picaroo adds a short hash suffix instead of overwriting it. The setting affects future replacements and library imports. Existing assets are not renamed.

SVG input opens a vector review dialog for intrinsic width, height, and a hex color. Solid fills and strokes are recolored in the live preview while `none`, transparency, gradients, patterns, and opacity are preserved. The result passes through SVGO while retaining `viewBox` and IDs. Customized variants use readable names such as `location-pin_32x32_ff5733.svg` even when hashed filenames are enabled. A conservative static-content policy rejects scripts, event handlers, embedded images, style elements, animation, external resources, and XML entities. Inline SVG replacements prefix internal IDs and their references per source slot.

## Responsive images and backgrounds

Picaroo edits candidates in an existing literal `srcSet`. Width candidates are capped at their declared width, descriptors are adjusted to actual output width, and duplicate descriptors are rejected. Media conditions, `sizes`, density descriptors, fallback sources, and untouched candidates remain in place.

Invalid responsive lists, mixed width and density descriptors, dynamic values, data URLs, blob URLs, and unsupported MIME declarations require manual editing. Picaroo does not automatically generate a new responsive image set.

CSS targets appear when an element uses the exact indexed URL and its media or supports conditions are active. A shared CSS rule changes all matching elements. Pseudo-elements, CSS modules, preprocessors, CSS variables, nesting, and runtime expressions require manual editing.

## Undo and unused assets

Picaroo records the 50 most recent changes in `.picaroo/history.json`. Undo restores the newest compatible source state and refuses to overwrite unrelated external edits. Generated assets remain in the project after source Undo because another source file may reference them.

The library can move an eligible generated asset to `.picaroo/trash/` when the index finds no references or retained Undo dependency. Cleanup is restricted to `public/picaroo/` and `src/assets/picaroo/`; authored assets elsewhere are not cleanup candidates.

Trash is never purged automatically. Undo restores an archived file without overwriting a new file at its original path and validates the archived contents before restoration.

## Safety model

- The write API accepts loopback connections only.
- Every editor session uses an ephemeral token.
- Request origins are checked.
- Paths are confined to the consuming application root.
- Existing symlink ancestors are checked before writes.
- `.git` and `node_modules` are never writable targets.
- Source contents and versions are checked again before saving.
- Writes are serialized and use temporary sibling files followed by rename.
- The overlay accepts messages only from its configured editor origin.

Picaroo uses optimistic source checks rather than a filesystem lock shared with the code editor. Avoid editing the same source location while an image replacement is being saved.

## Cloning an application that uses the submodule

Clone the application and its submodules together:

```sh
git clone --recurse-submodules <APPLICATION_REPOSITORY_URL>
cd <APPLICATION_DIRECTORY>
npm install
```

For an existing clone:

```sh
git submodule update --init --recursive
npm install
```

To select a newer Picaroo revision:

```sh
git -C external/picaroo fetch origin
git -C external/picaroo checkout <PICAROO_TAG_OR_COMMIT>
npm install
git add external/picaroo package-lock.json
git commit -m "chore: update Picaroo"
```

The consuming repository pins one exact Picaroo commit, so application builds do not change when the standalone Picaroo repository moves forward.

## Developing Picaroo

Inside the standalone Picaroo repository:

```sh
npm install
npm run typecheck
```

When editing Picaroo through a submodule, switch the submodule to a branch before committing:

```sh
git -C external/picaroo switch main
```

Commit and push changes inside the Picaroo repository first. Then commit the updated `external/picaroo` gitlink in each consuming application that should use that revision.

## Package layout

```text
bin/picaroo.mjs       CLI entry and TypeScript runtime loader
vite.mjs              Vite integration entry
src/cli.ts            Editor server and standalone integration
src/editor/           React editor workspace
src/integrations/     Framework detection and shared component registration
src/overlay.ts        Framework-neutral DOM overlay and message bridge
src/vite.ts           Development-only React + Vite instrumentation
src/source-edits/     React, Angular, HTML, JSON, CSS, SVG, and responsive source editing
src/server/           Asset index, confined writes, and persistent Undo
src/assets/           Raster and SVG processing
src/shared.ts         Shared editor and bridge types
```

Picaroo runs its TypeScript source through `tsx`, so it currently has no separate build step. React source instrumentation is provided by the development-only Vite adapter; Angular and plain HTML use source analysis plus rendered URL matching through the standalone gateway. Computed or mutable Angular expressions, Vue/Svelte template rewriting, SSR-only images, custom asset mappings, automatic responsive-set generation, and npm distribution remain future adaptations.
