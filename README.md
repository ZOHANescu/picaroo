# Picaroo

A local image editor that makes real source and JSON changes in your application, with an asset library and project-wide reference index. The current scope is this school project, using **React + Vite**. Picaroo itself uses React and TypeScript; its injected overlay uses the DOM directly.

## Run in this repository

Use the repository's recommended Node.js version (22.13+).

```sh
npm install
npm run dev
```

In another terminal, from the repository root:

```sh
npm run picaroo
```

Open **http://localhost:4310**. The school app runs on **http://localhost:4200**.

1. In **Edit images**, select an image in the preview or sidebar.
2. Drop one file onto its highlighted area, or use the file chooser in Image details.
3. For photos, review the crop, focal point, and output settings, then select **Save image**. SVG replacements save directly. Vite refreshes the preview.
4. Open **Change history** to undo the most recent replacement. History survives server restarts.
5. Switch to **Browse** to navigate the app normally. Desktop/mobile buttons change the preview viewport.

If saving a crop fails, the review stays open with your image and settings so you can correct the problem and retry. If the source changed externally, cancel, select the updated target, and review it again. A preview reload during saving may interrupt the confirmation; check Change history before retrying. Thumbnails retry automatically when the preview reconnects.

The header logo is a file-backed SVG target. The project’s `Icon` component accepts an optional SVG source for replacement at its call site. `ImagePlaceholder` accepts a `src` prop and forwards Picaroo's development metadata; its empty states remain photo drop targets.

## Editing capabilities

| Target                                                                       | Behavior                                                                                                                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<img src="/images/photo.jpg" />`                                            | Writes an optimized asset under `public/picaroo`, then updates the literal URL.                                                                     |
| `<img src={photo} />`, with a direct default asset import                    | Writes under `src/assets/picaroo`, then updates the relative import. If the import is shared, creates a separate import for the selected placement. |
| An external SVG rendered through `<img>`                                     | Accepts a static SVG, optimizes it, and updates its path while preserving vector scaling.                                                           |
| Registered empty slot components                                             | Inserts a `src` prop at the component call site.                                                                                                    |
| A direct imported JSON field, such as `content.hero.photo`                   | Updates that JSON string while preserving the component binding.                                                                                    |
| A direct JSON array `.map((item, index) => ...)`, such as `src={item.photo}` | Identifies each record separately and updates only the selected record's image field.                                                               |
| CSS `background` / `background-image` URLs                                   | Replaces one URL in the source rule, retaining gradients, positioning, and other layers.                                                            |
| Literal JSX `style` background URLs                                          | Updates the selected URL within the style object.                                                                                                   |
| Static inline `<svg>`                                                        | Updates vector content and viewBox, retaining root layout/accessibility attributes.                                                                 |
| The project's `Icon` component                                               | Sets its SVG source at an eligible call site.                                                                                                       |
| Literal `srcSet` candidates on `<img>` and `<picture><source>`               | Each candidate is selectable separately; media, sizes, and other candidates remain.                                                                 |
| Other dynamic expressions, spread props, transformed arrays                  | Displays **Needs mapping**; no automatic source writes.                                                                                             |

Animation, API-backed assets, SSR, custom public directories, and non-root Vite base paths remain unsupported. Framework adapters and distribution are deferred. Editable component source files use `.jsx` or `.tsx`; stylesheet edits use plain `.css`.

Editing a source inside a reusable component changes that source wherever the component renders. The sidebar reports multiple instances on the current page. Direct shared asset imports are forked to avoid altering other import references. Name-shadowed bindings are conservatively marked unsupported.

## Asset library and project usage

Open **Asset library** to browse thumbnail previews, search filenames/folders, filter SVGs/photos or referenced/unreferenced assets, and inspect dimensions, size, and source references. Scanning includes unopened pages and local data files; it does not depend on navigating every route.

- Select a target, choose **Choose from library**, select a compatible asset, then **Use this image**. Ordinary image/JSON placements reuse the existing bytes. Backgrounds, inline SVGs, and responsive candidates pass through the visual editing pipeline and may create an optimized derivative. Source imports and public URLs are adjusted for the selected placement. JSON fields need browser URLs, so reusing an asset outside `public/` copies it into `public/picaroo/`.
- **Import image** optimizes a new upload into `public/picaroo/` with a readable name and content hash. Identical optimized contents reuse an existing library asset. Importing alone does not change a placement or create an Undo entry.
- Selecting an asset shows matching imports, literal image paths, CSS URLs, JSON fields, and mapped JSX consumers. JSON consumers are shown even when their page has not been opened.

References are a static source index, not proof of runtime use. Computed URLs, remote assets, arbitrary runtime transformations, and unsupported alias schemes may not resolve. A CSS comment can also contain a matching URL. **Unreferenced** means no recognized source reference; it is not a deletion recommendation. Standard Vite string aliases with filesystem replacements are resolved for usage indexing.

The scan excludes hidden directories, symlinks, dependencies, build output, and Picaroo's own package. It supports PNG, JPEG, WebP, AVIF, and SVG assets up to 15 MB, source files up to 2 MB, and at most 15,000 relevant files. Coverage issues appear in the library. File changes refresh the index automatically. SVG thumbnails are validated and rasterized before display.

## Local JSON mapping

Use default imports from relative or project-root JSON paths and existing string fields. Empty strings are valid photo placeholders:

```tsx
import content from './content.json'
import people from './people.json'

;<img src={content.hero.photo} alt="Our studio" />

{
  people.map((person, index) => <img key={person.id} src={person.photo} alt={person.name} />)
}
```

For repeated items, both callback parameters must be named identifiers. Picaroo uses the index in development metadata to connect each rendered image to its JSON record. Keep the imported array in its original order; filtered, sorted, mutated, nested, or otherwise transformed collections and destructured bindings are not supported. JSON imports through aliases are not automatically mapped. Use the normal application type checker when introducing JSON imports to another project.

Image details show the linked JSON file and JSON Pointer, such as `/0/photo`. Drop a new image or reuse a library asset to update only that string. Existing SVG URLs identify SVG fields; photo and SVG validation still applies. Multiple recognized consumers of the same field are reported because they share its value.

To connect an eligible static image or registered slot, expand **Link to JSON field**, search for an existing empty/image string, and link it. Picaroo adds a JSON import and replaces the slot's source with a field expression. Undo can restore the original binding. It does not invent fields or remap individual rows of an unsupported loop.

JSON edits preserve surrounding formatting and properties. Duplicate JSON keys are rejected. Source and JSON versions are checked before saving. The teachers page has ten independently editable `photo` fields in `src/data/teachers.json`. The location galleries have 15 independent `image` fields in `src/data/galleries.json`; thumbnails and the lightbox use the same records. Edit a gallery thumbnail to update its lightbox image.

## Optimization

- Uploads: one file, maximum 15 MB; contents are decoded rather than trusting extensions or MIME types.
- Raster input: JPEG, PNG, WebP, or AVIF, maximum 40 million input pixels. Animated input is rejected.
- Raster defaults: WebP at quality 85, auto-oriented, maximum 2400 × 2400 bounding box, no upscaling. Change defaults under **Asset library → Project optimization defaults**. Choose WebP, AVIF, JPEG, or lossless PNG; quality 1–100 and bounding dimensions 16–4096 px. PNG ignores quality; JPEG flattens transparency onto white. Generated filenames are hashed by default. Turn off **Hash generated filenames** to use readable names based on the upload and actual output dimensions, such as `original-name_2000x1000.webp`. A short hash is added only when that readable name would collide with different contents. The setting affects future replacements and library imports; existing files are not renamed. Settings persist in `.picaroo/settings.json`. File sizes are shown in history; optimization does not guarantee a smaller file for every input.
- SVG: SVGO with `viewBox` and IDs retained. A conservative static-content policy rejects scripts, event handlers, embedded images, styles, animation, external resources, and XML entities. Convert complex SVGs to self-contained static SVGs first.
- Existing layout, class names, alt text, and image sizing remain in the application. Use **Crop / optimize current image** to create a derivative of a local library image. Pick an aspect ratio, drag the crop or use focal-point sliders, and adjust output options. Uploads offer the same review. Undo restores the previous source; original assets remain available. Repeated cropping starts from the currently selected asset, so choose the original from the library when needed.

## Visual source behavior

CSS targets appear when a matching element uses that exact URL and its media/supports conditions are active. A shared CSS rule updates every matching element. Pseudo-elements, CSS modules, CSS nesting, variables, preprocessors, and runtime-generated background expressions need manual mapping. Literal JSX style URLs are supported; gradients and other URL layers are retained.

Select a responsive candidate from **Page images**, then replace it. The overlay outlines the rendered image even for a non-rendering `<source>`. Width candidates are capped at their declared width; descriptors reflect actual output width, and duplicate descriptors are rejected. A declared PNG/JPEG/WebP/AVIF source keeps its format so its other candidates remain valid. Media conditions, `sizes`, density descriptors, other candidates, and fallback sources remain in place. This edits existing sets; automatic creation of a new responsive set is deferred. Dynamic `srcSet`, data-URL candidate lists, and repeated responsive markup still need explicit mappings.

Responsive lists with invalid, duplicate, or mixed width/density descriptors are blocked as a whole. Declared picture MIME types must be static and supported, and must agree with the SVG/raster kind of the candidate being replaced. Visual target selection survives URL and vector-content replacements.

Static inline SVG replacements preserve the root class, dimensions, accessibility attributes, and event bindings. SVG presentation and viewBox come from the uploaded vector. Uploaded SVG text/attributes are emitted as literal JSX values, never executable expressions. IDs and their references are prefixed per source slot to separate vectors inserted in different slots. Dynamic drawings remain application code. The school project's `Icon` component is explicitly registered as an SVG slot; arbitrary third-party SVG component APIs are not rewritten. Shared or repeated component sources are identified in the inspector.

## Unused generated assets

Filter the library to **No static references**, select an eligible generated image, then **Move to Picaroo trash**. Eligibility requires a complete index, no recognized references, no dependency in retained Undo history, and a file under `public/picaroo/` or `src/assets/picaroo/`. Authored assets elsewhere are never cleanup candidates. Runtime-only references can evade static analysis, so cleanup is deliberately reversible.

Files move to `.picaroo/trash/`. **Change history → Undo** restores them and refuses to overwrite a new file at the original path. Picaroo never permanently purges trash. The most recent 50 changes are available through Undo; older trash files remain on disk for manual recovery. Cleanup and restoration recheck asset versions and project path boundaries.

The CLI attaches to the app started with `npm run dev`; run `npm run picaroo` to open its editor. The existing port/origin CLI options remain available, but multi-project setup and packaging are outside the current work.

## Source editing and recovery

The Vite plugin parses original JSX/TSX and injects target IDs into development responses. IDs and source versions connect DOM elements to parsed source locations. Edits use narrow source-range patches, preserving the surrounding code. Picaroo uses source files and ordinary asset URLs/imports as the application's source of truth; it does not require a runtime image manifest.

Writes are serialized. Picaroo checks source contents again after processing and before saving. Writes use temporary sibling files and rename; history is persisted before the source update. Undo checks the saved source and refuses to overwrite unrelated external edits. This is an optimistic check, not a filesystem lock shared with your editor: avoid simultaneous edits to the same source during a replacement.

`.picaroo/history.json` holds up to 50 changes with before/after source snapshots. Keep `.picaroo/` ignored by Git. Undo restores the source but deliberately retains generated assets because another file might reference them. Eligible unused generated assets can be moved to Picaroo trash from the library. The verification images used during development are not part of the shipped app.

The write API accepts loopback connections only, requires an ephemeral session token, checks request origins, and resolves paths against the project root, including existing symlink ancestors. It does not write inside `.git` or `node_modules`. The overlay only accepts messages from the configured editor origin.

Picaroo's Vite plugin applies to development serving only. The editor, token, and source instrumentation are not injected into production builds. Once images are saved, the app runs without Picaroo. The package runs TypeScript through `tsx`, so there is no separate Picaroo build step or test suite.

## Package layout

```text
bin/picaroo.mjs       CLI entry, development TypeScript loader
vite.mjs             Vite integration entry, no package build required
src/cli.ts           Editor server and project detection
src/editor/          React workspace and styles
src/overlay.ts       Framework-independent DOM overlay and message bridge
src/vite.ts          Development instrumentation and local API
src/source-edits/    React, JSON, CSS, SVG, and responsive source changes
src/server/          Asset/reference index, confined writes, and persistent Undo
src/assets/          Raster and SVG processing
src/shared.ts        Typed editor/bridge protocol
```

Type checking uses `npm run picaroo:typecheck` from the repository root. The repository's existing lint and formatting commands include Picaroo. Verification is manual; no automated tests or build pipeline were added.

## Current roadmap

Completed for this project: reusable library, static usage tracking, local JSON mapping, individual teacher/gallery photos, CSS and inline backgrounds, static inline SVG and project Icon slots, existing responsive candidate editing, crop/focal-point controls, saved optimization profiles, and reversible cleanup.

Deferred until adaptation work is requested: Vue and Angular adapters, workspace/project selection, custom asset directories/base paths, and independent npm distribution. More complex runtime data mappings, arbitrary SVG component libraries, and automatic responsive-set generation can be added when the project needs them.
# picaroo
