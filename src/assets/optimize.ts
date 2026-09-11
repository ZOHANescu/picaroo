import sharp from 'sharp'
import { optimize } from 'svgo'
import type { AssetKind, ImageOptions, OptimizationProfile } from '../shared'
import { DEFAULT_PROFILE, cropBounds } from '../shared'

export const MAX_UPLOAD = 15 * 1024 * 1024

export function validateProfile(value: OptimizationProfile): OptimizationProfile {
  if (
    !value ||
    !['webp', 'avif', 'jpeg', 'png'].includes(value.format) ||
    !Number.isInteger(value.quality) ||
    value.quality < 1 ||
    value.quality > 100 ||
    !Number.isInteger(value.maxWidth) ||
    !Number.isInteger(value.maxHeight) ||
    value.maxWidth < 16 ||
    value.maxHeight < 16 ||
    value.maxWidth > 4096 ||
    value.maxHeight > 4096 ||
    (value.hashFilenames !== undefined && typeof value.hashFilenames !== 'boolean')
  )
    throw new Error('Choose a valid format, quality 1–100, and dimensions 16–4096 px.')
  return {
    format: value.format,
    quality: value.quality,
    maxWidth: value.maxWidth,
    maxHeight: value.maxHeight,
    hashFilenames: value.hashFilenames ?? true,
  }
}

export async function optimizeAsset(input: Buffer, kind: AssetKind, options: ImageOptions = {}) {
  const profile = validateProfile(options.profile ?? DEFAULT_PROFILE)
  const { ratio = 0, focusX = 0.5, focusY = 0.5 } = options
  if (
    !Number.isFinite(ratio) ||
    ratio < 0 ||
    ratio > 10 ||
    (ratio > 0 && ratio < 0.1) ||
    !Number.isFinite(focusX) ||
    !Number.isFinite(focusY) ||
    focusX < 0 ||
    focusX > 1 ||
    focusY < 0 ||
    focusY > 1
  )
    throw new Error('Invalid crop or focal point.')
  if (!input.length || input.length > MAX_UPLOAD)
    throw new Error('Choose a file smaller than 15 MB.')
  if (kind === 'svg') {
    const text = input
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trim()
    if (!/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
      throw new Error('This is an SVG slot. Drop a valid SVG file here.')
    }
    // A conservative static-SVG policy. SVGO is an optimizer, not a sanitizer.
    const staticOnly = {
      name: 'picaroo-static-svg',
      fn: () => ({
        element: {
          enter(node: { name: string; attributes: Record<string, string> }) {
            if (
              node.name.includes(':') ||
              [
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
              ].includes(node.name.toLowerCase())
            ) {
              throw new Error(
                `SVG element <${node.name}> is not supported. Use a static, self-contained SVG.`,
              )
            }
            for (const [name, value] of Object.entries(node.attributes)) {
              if (
                /^on/i.test(name) ||
                name === 'xml:base' ||
                name === 'style' ||
                ((name === 'href' || name.endsWith(':href')) && !/^#[\w.-]+$/.test(value)) ||
                (/url\s*\(/i.test(value) && !/^url\(\s*['"]?#[\w.-]+['"]?\s*\)$/.test(value)) ||
                /javascript:|data:|\\|\/\*/i.test(value)
              ) {
                throw new Error(
                  'SVG contains active content or external resources. Use a static, self-contained SVG.',
                )
              }
            }
          },
        },
      }),
    }
    if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(text))
      throw new Error(
        'SVG document types, entities, and processing instructions are not supported.',
      )
    const result = optimize(text, {
      multipass: false,
      plugins: [
        staticOnly,
        { name: 'preset-default', params: { overrides: { cleanupIds: false } } },
      ],
    })
    return { data: Buffer.from(result.data), extension: 'svg', width: undefined, height: undefined }
  }
  // Decode by content; extensions and client MIME types are never trusted.
  const decoder = sharp(input, { limitInputPixels: 40_000_000, animated: true, failOn: 'warning' })
  const metadata = await decoder.metadata().catch(() => {
    throw new Error('Choose a valid JPEG, PNG, WebP, or AVIF image.')
  })
  if (!metadata.format || !['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format)) {
    throw new Error('This is a photo slot. Choose JPEG, PNG, WebP, or AVIF; SVG is not accepted.')
  }
  if ((metadata.pages ?? 1) > 1)
    throw new Error('Animated images are not supported in this milestone.')
  const rotated = (metadata.orientation ?? 1) >= 5
  const width = (rotated ? metadata.height : metadata.width)!
  const height = (rotated ? metadata.width : metadata.height)!
  let pipeline = decoder
    .rotate()
    .extract(cropBounds(width, height, ratio, focusX, focusY))
    .resize({
      width: profile.maxWidth,
      height: profile.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
  if (profile.format === 'jpeg')
    pipeline = pipeline
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: profile.quality, mozjpeg: true })
  else if (profile.format === 'png') pipeline = pipeline.png({ compressionLevel: 9 })
  else if (profile.format === 'avif')
    pipeline = pipeline.avif({ quality: profile.quality, effort: 4 })
  else pipeline = pipeline.webp({ quality: profile.quality, effort: 4 })
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return {
    data,
    extension: profile.format === 'jpeg' ? 'jpg' : profile.format,
    width: info.width,
    height: info.height,
  }
}
