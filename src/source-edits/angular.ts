import path from 'node:path'
import MagicString from 'magic-string'
import { hash } from '../hash'
import type { SourceTarget } from './react'

const imageUrl = /\.(?:svg|png|jpe?g|webp|avif)(?:[?#].*)?$/i
const attributePattern = /([:\[\]\w.-]+)\s*=\s*(["'])([\s\S]*?)\2/g

interface Attribute {
  name: string
  value: string
  quote: '"' | "'"
  start: number
  end: number
}

const imageComponents = new Map<string, { sources: string[]; labels: string[] }>([
  ['img', { sources: ['src', 'ngsrc'], labels: ['alt'] }],
  ['p-image', { sources: ['src'], labels: ['alt'] }],
  ['p-avatar', { sources: ['image'], labels: ['arialabel', 'label'] }],
  ['p-chip', { sources: ['image'], labels: ['alt', 'label'] }],
])

export function analyzeAngular(
  source: string,
  file: string,
  assetDirectory = 'public/picaroo',
): SourceTarget[] {
  const regions = file.endsWith('.html') ? [{ source, offset: 0 }] : inlineTemplates(source)
  const targets: SourceTarget[] = []
  let ordinal = 0
  for (const region of regions) {
    for (const tag of region.source.matchAll(/<([a-z][\w-]*)\b[\s\S]*?>/gi)) {
      const element = tag[1].toLowerCase()
      const component = imageComponents.get(element)
      if (!component) continue
      const tagOffset = region.offset + tag.index!
      const attributes = parseAttributes(tag[0], tagOffset)
      const sourceNames = component.sources.flatMap((name) => [name, `[${name}]`, `[attr.${name}]`])
      const sourceAttr = attributes.find((attribute) =>
        sourceNames.includes(attribute.name.toLowerCase()),
      )
      if (!sourceAttr) continue
      const binding = sourceAttr.name.startsWith('[')
      const current = binding ? stringExpression(sourceAttr.value) : sourceAttr.value.trim()
      if (!current || !imageUrl.test(current) || current.includes('{{')) continue
      const label =
        attributes
          .find((attribute) => component.labels.includes(attribute.name.toLowerCase()))
          ?.value.trim() ||
        `${element === 'img' ? 'Image' : `PrimeNG ${element.slice(2)}`} · ${path.basename(file)}:${lineAt(source, tagOffset)}`
      targets.push({
        id: hash(`${file}:angular-image:${ordinal++}`).slice(0, 20),
        file,
        line: lineAt(source, tagOffset),
        label,
        kind: /\.svg(?:[?#]|$)/i.test(current) ? 'svg' : 'raster',
        current,
        version: hash(source),
        editable: true,
        shared: false,
        start: sourceAttr.start,
        end: sourceAttr.end,
        insertion: -1,
        hasSource: true,
        canMap: false,
        runtimeMatch: true,
        assetDirectory,
        angular: { binding, quote: sourceAttr.quote },
      })
    }
  }
  return targets
}

function inlineTemplates(source: string) {
  const regions: { source: string; offset: number }[] = []
  for (const match of source.matchAll(/\btemplate\s*:\s*([`"'])([\s\S]*?)\1/g)) {
    if (match[1] === '`' && /\$\{/.test(match[2])) continue
    const offset = match.index! + match[0].indexOf(match[2])
    regions.push({ source: match[2], offset })
  }
  return regions
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

function stringExpression(value: string) {
  const expression = value.trim()
  const quote = expression[0]
  if ((quote !== '"' && quote !== "'") || expression.at(-1) !== quote) return
  const body = expression.slice(1, -1)
  if (body.includes('\\') || body.includes(quote)) return
  return body
}

function lineAt(source: string, offset: number) {
  return source.slice(0, offset).split('\n').length
}

export function replaceAngularReference(source: string, target: SourceTarget, publicUrl: string) {
  if (!target.angular) throw new Error('Angular source metadata is missing.')
  const output = new MagicString(source)
  const url = target.current.startsWith('/') ? publicUrl : publicUrl.replace(/^\//, '')
  if (target.angular.binding) {
    const quote = target.angular.quote === '"' ? "'" : '"'
    const escaped = url.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)
    output.overwrite(target.start, target.end, `${quote}${escaped}${quote}`)
  } else {
    const escaped = url.replaceAll('&', '&amp;').replaceAll(
      target.angular.quote,
      target.angular.quote === '"' ? '&quot;' : '&#39;',
    )
    output.overwrite(target.start, target.end, escaped)
  }
  return output.toString()
}
