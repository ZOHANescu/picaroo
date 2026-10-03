import sharp from 'sharp'
import { optimize } from 'svgo'
import type { AssetKind, ImageOptions, OptimizationProfile } from '../shared'
import {
  DEFAULT_PROFILE,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_UPLOAD,
  MAX_UPLOAD_MB,
  cropBounds,
} from '../shared'

export interface OptimizeControl {
  signal?: AbortSignal
  onProgress?: (percent: number) => void
}

function cancellationError() {
  const error = new Error('Image processing was cancelled.')
  error.name = 'AbortError'
  return error
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw cancellationError()
}

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

export async function optimizeAsset(
  input: Buffer,
  kind: AssetKind,
  options: ImageOptions = {},
  control: OptimizeControl = {},
) {
  throwIfCancelled(control.signal)
  const profile = validateProfile(options.profile ?? DEFAULT_PROFILE)
  const { ratio = 0, focusX = 0.5, focusY = 0.5, outputWidth, outputHeight } = options
  const rawColor = options.color?.trim().replace(/^#/, '').toLowerCase()
  const selectedColor = rawColor?.match(/^[a-f0-9]{3}$/)
    ? rawColor
        .split('')
        .map((value) => value + value)
        .join('')
    : rawColor?.match(/^[a-f0-9]{6}$/)
      ? rawColor
      : undefined
  if (options.color !== undefined && !selectedColor)
    throw new Error('Choose a valid three- or six-digit hex color.')
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
  const hasExactSize = outputWidth !== undefined || outputHeight !== undefined
  const minimumOutputDimension = kind === 'svg' ? 1 : 16
  if (
    hasExactSize &&
    (!Number.isInteger(outputWidth) ||
      !Number.isInteger(outputHeight) ||
      outputWidth! < minimumOutputDimension ||
      outputHeight! < minimumOutputDimension ||
      outputWidth! > MAX_IMAGE_DIMENSION ||
      outputHeight! > MAX_IMAGE_DIMENSION ||
      outputWidth! * outputHeight! > MAX_IMAGE_PIXELS)
  )
    throw new Error(
      `Choose output dimensions of at least 16 px and no more than ${MAX_IMAGE_PIXELS / 1_000_000} megapixels.`,
    )
  if (!input.length || input.length > MAX_UPLOAD)
    throw new Error(`Choose a file up to ${MAX_UPLOAD_MB} MB.`)
  if (kind === 'svg') {
    throwIfCancelled(control.signal)
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
    const sizeSvg = {
      name: 'picaroo-svg-size',
      fn: () => ({
        element: {
          enter(node: { name: string; attributes: Record<string, string> }) {
            if (node.name.toLowerCase() !== 'svg' || !hasExactSize) return
            if (!node.attributes.viewBox) {
              const numeric = (value?: string) => {
                const match = value?.match(/^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i)
                return match ? Number(match[1]) : undefined
              }
              const sourceWidth = numeric(node.attributes.width)
              const sourceHeight = numeric(node.attributes.height)
              if (!sourceWidth || !sourceHeight)
                throw new Error(
                  'This SVG needs a viewBox or numeric width and height before it can be resized.',
                )
              node.attributes.viewBox = `0 0 ${sourceWidth} ${sourceHeight}`
            }
            node.attributes.width = String(outputWidth)
            node.attributes.height = String(outputHeight)
          },
        },
      }),
    }
    const recolorSvg = {
      name: 'picaroo-svg-color',
      fn: () => ({
        element: {
          enter(node: { name: string; attributes: Record<string, string> }) {
            if (!selectedColor) return
            const color = `#${selectedColor}`
            const recolorable = (value: string) =>
              !/^(?:none|transparent|inherit|context-fill|context-stroke)$/i.test(value.trim()) &&
              !/^url\s*\(/i.test(value.trim())
            if (node.name.toLowerCase() === 'svg') {
              node.attributes.color = color
              if (!node.attributes.fill) node.attributes.fill = color
            }
            for (const attribute of ['fill', 'stroke', 'color'])
              if (node.attributes[attribute] && recolorable(node.attributes[attribute]))
                node.attributes[attribute] = color
          },
        },
      }),
    }
    const result = optimize(text, {
      multipass: false,
      plugins: [
        staticOnly,
        { name: 'preset-default', params: { overrides: { cleanupIds: false } } },
        recolorSvg,
        sizeSvg,
        { ...staticOnly, name: 'picaroo-static-svg-output' },
      ],
    })
    return {
      data: Buffer.from(result.data),
      extension: 'svg',
      width: hasExactSize ? outputWidth : undefined,
      height: hasExactSize ? outputHeight : undefined,
      color: selectedColor,
    }
  }
  // Decode by content; extensions and client MIME types are never trusted.
  const decoder = sharp(input, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    animated: true,
    failOn: 'warning',
  })
  const metadata = await decoder.metadata().catch((error: unknown) => {
    if (error instanceof Error && /pixel limit/i.test(error.message))
      throw new Error(
        `This image exceeds the ${MAX_IMAGE_PIXELS / 1_000_000} megapixel resolution limit.`,
      )
    throw new Error('Choose a valid JPEG, PNG, WebP, or AVIF image.')
  })
  throwIfCancelled(control.signal)
  control.onProgress?.(48)
  if (!metadata.format || !['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format)) {
    throw new Error('This is a photo slot. Choose JPEG, PNG, WebP, or AVIF; SVG is not accepted.')
  }
  if ((metadata.pages ?? 1) > 1)
    throw new Error('Animated images are not supported in this milestone.')
  const rotated = (metadata.orientation ?? 1) >= 5
  const width = (rotated ? metadata.height : metadata.width)!
  const height = (rotated ? metadata.width : metadata.height)!
  let pipeline = decoder.rotate().extract(cropBounds(width, height, ratio, focusX, focusY))
  pipeline = hasExactSize
    ? pipeline.resize({ width: outputWidth, height: outputHeight, fit: 'fill' })
    : pipeline.resize({
        width: profile.maxWidth,
        height: profile.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
  if (selectedColor) {
    const red = Number.parseInt(selectedColor.slice(0, 2), 16)
    const green = Number.parseInt(selectedColor.slice(2, 4), 16)
    const blue = Number.parseInt(selectedColor.slice(4, 6), 16)
    // Replace RGB while retaining the source alpha channel, including anti-aliased edges.
    pipeline = pipeline.ensureAlpha().linear([0, 0, 0, 1], [red, green, blue, 0])
  }
  if (profile.format === 'jpeg')
    pipeline = pipeline
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: profile.quality, mozjpeg: true })
  else if (profile.format === 'png') pipeline = pipeline.png({ compressionLevel: 9 })
  else if (profile.format === 'avif')
    pipeline = pipeline.avif({ quality: profile.quality, effort: 4 })
  else pipeline = pipeline.webp({ quality: profile.quality, effort: 4 })
  throwIfCancelled(control.signal)
  control.onProgress?.(55)
  const cancelPipeline = () => pipeline.destroy(cancellationError())
  control.signal?.addEventListener('abort', cancelPipeline, { once: true })
  const { data, info } = await pipeline
    .toBuffer({ resolveWithObject: true })
    .finally(() => control.signal?.removeEventListener('abort', cancelPipeline))
  throwIfCancelled(control.signal)
  control.onProgress?.(68)
  return {
    data,
    extension: profile.format === 'jpeg' ? 'jpg' : profile.format,
    width: info.width,
    height: info.height,
    color: selectedColor,
  }
}
