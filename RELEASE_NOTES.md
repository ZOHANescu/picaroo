# Picaroo release notes

## v1.2.0 — 2026-10-05

Picaroo 1.2.0 restores reliable Angular image discovery and introduces configurable image sources for application-owned Angular directives and components. It also adds a cross-framework stability suite that verifies every supported discovery scenario in plain HTML, React, and Angular before release.

### Highlights

- **Angular discovery restored** — Fixes the regressions found after v1.1.0, including SOH-style image directives and image arrays passed into reusable child gallery components.
- **Configurable Angular image sources** — Register custom element or directive inputs in the consuming application's `package.json`; Picaroo no longer contains an application-specific `sohImage` rule.
- **One-off CLI mappings** — Add repeatable `--angular-image-source tag:sourceAttribute:labelAttribute` options without changing project configuration.
- **Framework-specific regression apps** — Minimal HTML, React, and Angular fixtures cover common image usage patterns drawn from the AIM and SOH projects.
- **One discovery per test** — Every expected image has an independent Cypress test, so failures identify the exact unsupported pattern.
- **One-command stability check** — `npm run test:e2e` starts each fixture and Picaroo, runs all discovery suites, and prints a combined stability result.
- **Continuous stability enforcement** — CI now runs unit tests, type checking, and the complete cross-framework Cypress suite.

### Configure custom Angular image sources

Declare custom sources under `picaroo.angular.imageSources` in the consuming application's `package.json`:

```json
{
  "picaroo": {
    "angular": {
      "imageSources": [
        {
          "tag": "img",
          "attributes": ["sohImage"],
          "labelAttributes": ["alt"]
        },
        {
          "tag": "app-photo",
          "attributes": ["imageUrl"],
          "labelAttributes": ["label", "alt"]
        }
      ]
    }
  }
}
```

The registration is additive to Picaroo's built-in support for native images and PrimeNG image components. Source attributes can be static or bound Angular inputs. As a temporary or one-off alternative, repeat the CLI option:

```sh
npx picaroo --url http://localhost:4200 --angular-image-source img:sohImage:alt --angular-image-source app-photo:imageUrl:label
```

### Stability coverage

The release gate currently verifies 49 independent discovery scenarios:

| Framework | Expected | Result |
| --- | ---: | --- |
| Plain HTML | 12 | 12 discovered |
| React | 16 | 16 discovered |
| Angular | 21 | 21 discovered |

### Upgrade notes

This release has no breaking configuration changes.

1. Update the pinned Picaroo submodule or local dependency to `v1.2.0`.
2. Run `npm install` in the consuming application.
3. If the Angular application uses custom image directives or components, register their source inputs under `picaroo.angular.imageSources` or pass `--angular-image-source` when starting Picaroo.
4. React projects can keep their existing `picaroo.components` configuration unchanged.

Built-in Angular and PrimeNG sources require no configuration. Existing project settings, history, generated assets, and source integrations remain valid.

## v1.1.0 — 2026-10-03

Picaroo 1.1.0 is a feature release focused on richer image editing, broader source detection, and safer asset removal. It remains compatible with the v1.0.0 setup.

### Highlights

- **SVG editing and variants** — Review SVG dimensions, recolor solid fills and strokes, and save readable size/color variants without overwriting the original asset. Inline SVG replacements retain application-owned root attributes and use collision-safe IDs.
- **Embedded Base64 images** — Detect, replace, clear, crop, and optimize supported `data:image/...;base64,...` sources. Raster icons can be recolored in place while retaining alpha transparency.
- **Recoverable image removal** — Clear an image source without deleting its element. A uniquely referenced local asset is moved to `.picaroo/trash` and can be restored with Undo; shared assets are protected.
- **Exact raster output controls** — Set the final width and height in the review dialog, including deliberate upscaling. Active saves can be cancelled safely.
- **Larger source images** — The upload limit is now 50 MB, with a 64-megapixel safety limit.
- **Broader project detection** — Source-aware editing now covers React, Angular, and plain HTML projects through modular framework detection.
- **Shared custom-component registration** — React image component names can be declared once in `package.json` and shared by the standalone service and Vite adapter.
- **More reliable editing** — Expanded automated coverage for raster/SVG processing, React, Angular, HTML, framework detection, and component configuration.

### SVG details

- Live width, height, and hex-color review.
- SVGO optimization with `viewBox` and internal IDs retained.
- Gradients, patterns, `none`, opacity, and transparent regions preserved during recoloring.
- Existing library SVGs can be reopened to create a new variant.
- Readable names such as `location-pin_32x32_ff5733.svg`, with a short content hash added on collision.
- Active content, external resources, embedded images, animation, style elements, and XML entities are rejected.

### Raster and Base64 details

- Uploaded image resolution becomes the initial output size.
- Exact output dimensions are allowed up to 64 megapixels.
- Crop changes reset output dimensions to the crop's native size.
- Embedded PNG, JPEG, WebP, and AVIF sources use the same crop, optimization, and Undo flow.
- Hex recoloring replaces visible RGB pixels and preserves alpha; it is intended for monochrome raster icons.

### Upgrade notes

This release has no known breaking configuration changes.

1. Update the pinned Picaroo submodule or local dependency to `v1.1.0`.
2. Run `npm install` in the consuming application.
3. React + Vite projects should keep the `picaroo/vite` adapter enabled.
4. To make application-owned empty image slots editable, list their component names under `picaroo.components` in the consuming `package.json`.

Picaroo's upload limit changed from 30 MB to 50 MB. Existing project settings, history, generated assets, and source integrations remain valid.
