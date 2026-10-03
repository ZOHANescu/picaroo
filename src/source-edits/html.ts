import path from 'node:path'
import MagicString from 'magic-string'
import { hash } from '../hash'
import type { SourceTarget } from './react'

const imageUrl = /\.(?:svg|png|jpe?g|webp|avif)(?:[?#].*)?$/i
const base64Image = /^data:image\/(?:png|jpe?g|webp|avif|svg\+xml);base64,/i
const attributePattern = /([:\w.-]+)\s*=\s*(["'])([\s\S]*?)\2/g

interface Attribute {
  name: string
  value: string
  quote: '"' | "'"
  start: number
  end: number
}

export function analyzeHtml(source: string, file: string, assetDirectory = 'public/picaroo') {
  const targets: SourceTarget[] = []
  let ordinal = 0
  for (const tag of source.matchAll(/<img\b[\s\S]*?>/gi)) {
    const attributes = parseAttributes(tag[0], tag.index!)
    if (attributes.some((attribute) => attribute.name.toLowerCase() === 'data-picaroo-id'))
      continue
    const src = attributes.find((attribute) => attribute.name.toLowerCase() === 'src')
    if (!src || (!imageUrl.test(src.value) && !base64Image.test(src.value))) continue
    const alt = attributes.find((attribute) => attribute.name.toLowerCase() === 'alt')
    const line = source.slice(0, tag.index).split('\n').length
    targets.push({
      id: hash(`${file}:html-image:${ordinal++}`).slice(0, 20),
      file,
      line,
      label: alt?.value.trim() || `Image · ${path.basename(file)}:${line}`,
      kind:
        /\.svg(?:[?#]|$)/i.test(src.value) || /^data:image\/svg\+xml;base64,/i.test(src.value)
          ? 'svg'
          : 'raster',
      current: src.value,
      version: hash(source),
      editable: true,
      shared: false,
      start: src.start,
      end: src.end,
      insertion: -1,
      hasSource: true,
      canMap: false,
      runtimeMatch: true,
      assetDirectory,
      html: { quote: src.quote },
    })
  }
  return targets
}

export function replaceHtmlReference(source: string, target: SourceTarget, publicUrl: string) {
  if (!target.html) throw new Error('HTML source metadata is missing.')
  const output = new MagicString(source)
  const url = target.current.startsWith('/') ? publicUrl : publicUrl.replace(/^\//, '')
  const escaped = url
    .replaceAll('&', '&amp;')
    .replaceAll(target.html.quote, target.html.quote === '"' ? '&quot;' : '&#39;')
  output.overwrite(target.start, target.end, escaped)
  return output.toString()
}

function parseAttributes(tag: string, offset: number) {
  const attributes: Attribute[] = []
  for (const match of tag.matchAll(attributePattern)) {
    const valueOffset = match[0].indexOf(match[2]) + 1
    attributes.push({
      name: match[1],
      value: match[3],
      quote: match[2] as Attribute['quote'],
      start: offset + match.index! + valueOffset,
      end: offset + match.index! + valueOffset + match[3].length,
    })
  }
  return attributes
}
