import path from 'node:path'
import { parse } from '@babel/parser'
import { VISITOR_KEYS } from '@babel/types'
import type { Node } from '@babel/types'
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

export interface AngularComponentSource {
  file: string
  source: string
}

interface TemplateContext {
  alias: string
  collection: string[]
  start: number
  end: number
}

interface LiteralValue {
  current: string
  start: number
  end: number
  quote: '"' | "'" | '`'
  line: number
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
  component?: AngularComponentSource,
): SourceTarget[] {
  const regions = file.endsWith('.html') ? [{ source, offset: 0 }] : inlineTemplates(source)
  const targets: SourceTarget[] = []
  const componentSource = component ?? (file.endsWith('.ts') ? { file, source } : undefined)
  const fields = componentSource ? componentFields(componentSource.source) : undefined
  const sourceLiterals = new Set<string>()
  let ordinal = 0
  for (const region of regions) {
    const contexts = templateContexts(region.source)
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
      const label =
        attributes
          .find((attribute) => component.labels.includes(attribute.name.toLowerCase()))
          ?.value.trim() ||
        `${element === 'img' ? 'Image' : `PrimeNG ${element.slice(2)}`} · ${path.basename(file)}:${lineAt(source, tagOffset)}`
      if (current && imageUrl.test(current) && !current.includes('{{')) {
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
        continue
      }
      if (!binding || !componentSource || !fields) continue
      const expression = memberExpression(sourceAttr.value)
      if (!expression) continue
      const resolved = resolveTemplateExpression(
        expression,
        tag.index!,
        contexts,
        fields,
        componentSource.source,
      )
      for (const [index, item] of resolved.entries()) {
        if (!imageUrl.test(item.literal.current)) continue
        const literalKey = `${componentSource.file}:${item.literal.start}:${item.literal.end}`
        if (sourceLiterals.has(literalKey)) continue
        sourceLiterals.add(literalKey)
        targets.push({
          id: hash(`${file}:angular-object:${ordinal++}:${index}`).slice(0, 20),
          file: componentSource.file,
          line: item.literal.line,
          label:
            item.label ??
            (resolved.length > 1 ? `${label} · Item ${index + 1}` : label),
          kind: /\.svg(?:[?#]|$)/i.test(item.literal.current) ? 'svg' : 'raster',
          current: item.literal.current,
          version: hash(componentSource.source),
          editable: true,
          shared: false,
          start: item.literal.start,
          end: item.literal.end,
          insertion: -1,
          hasSource: true,
          canMap: false,
          runtimeMatch: true,
          assetDirectory,
          angular: { binding: false, quote: item.literal.quote, sourceLiteral: true },
        })
      }
    }
  }
  return targets
}

function componentFields(source: string) {
  const fields = new Map<string, Node>()
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'decorators-legacy'],
  })
  walk(ast, (node) => {
    if (node.type !== 'ClassProperty' || !node.readonly || !node.value || node.computed) return
    const name = propertyName(node.key)
    if (name) fields.set(name, unwrap(node.value))
  })
  return fields
}

function walk(node: Node, visit: (node: Node) => void) {
  visit(node)
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === 'object' && 'type' in child)
        walk(child as Node, visit)
    } else if (value && typeof value === 'object' && 'type' in value) walk(value as Node, visit)
  }
}

function unwrap(node: Node): Node {
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TypeCastExpression'
  )
    return unwrap(node.expression)
  if (node.type === 'ParenthesizedExpression') return unwrap(node.expression)
  return node
}

function propertyName(node: Node) {
  return node.type === 'Identifier'
    ? node.name
    : node.type === 'StringLiteral' || node.type === 'NumericLiteral'
      ? String(node.value)
      : undefined
}

function memberExpression(value: string) {
  const expression = value.trim()
  if (!/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(expression)) return
  return expression.split('.').map((part) => part.trim())
}

function resolveNode(node: Node | undefined, parts: string[]): Node | undefined {
  if (!node) return
  const value = unwrap(node)
  if (!parts.length) return value
  const [part, ...rest] = parts
  if (value.type === 'ObjectExpression') {
    const property = value.properties.find(
      (item) =>
        item.type === 'ObjectProperty' &&
        !item.computed &&
        propertyName(item.key) === part,
    )
    return property?.type === 'ObjectProperty' ? resolveNode(property.value, rest) : undefined
  }
  if (value.type === 'ArrayExpression' && /^\d+$/.test(part))
    return resolveNode(value.elements[Number(part)] ?? undefined, rest)
}

function literalValue(node: Node | undefined, source: string): LiteralValue | undefined {
  if (!node) return
  const value = unwrap(node)
  let current: string | undefined
  if (value.type === 'StringLiteral') current = value.value
  else if (value.type === 'TemplateLiteral' && value.expressions.length === 0)
    current = value.quasis[0]?.value.cooked ?? undefined
  const start = value.start
  const end = value.end
  if (current === undefined || start === null || start === undefined || end === null || end === undefined)
    return
  const quote = source[start]
  if (quote !== '"' && quote !== "'" && quote !== '`') return
  return {
    current,
    start,
    end,
    quote,
    line: value.loc?.start.line ?? lineAt(source, start),
  }
}

function labelFor(node: Node, parts: string[], source: string) {
  if (parts.at(-1)?.toLowerCase() !== 'src') return
  const label = literalValue(resolveNode(node, [...parts.slice(0, -1), 'alt']), source)?.current
  return label || undefined
}

function resolveTemplateExpression(
  expression: string[],
  offset: number,
  contexts: TemplateContext[],
  fields: Map<string, Node>,
  source: string,
) {
  const context = contexts
    .filter((item) => item.alias === expression[0] && item.start <= offset && offset < item.end)
    .sort((a, b) => b.start - a.start)[0]
  if (context) {
    const root = resolveNode(fields.get(context.collection[0]), context.collection.slice(1))
    if (root?.type !== 'ArrayExpression') return []
    return root.elements.flatMap((element) => {
      if (!element || element.type === 'SpreadElement') return []
      const literal = literalValue(resolveNode(element, expression.slice(1)), source)
      return literal ? [{ literal, label: labelFor(element, expression.slice(1), source) }] : []
    })
  }
  const root = fields.get(expression[0])
  const literal = literalValue(resolveNode(root, expression.slice(1)), source)
  return literal
    ? [{ literal, label: root ? labelFor(root, expression.slice(1), source) : undefined }]
    : []
}

function templateContexts(source: string) {
  const contexts: TemplateContext[] = []
  for (const match of source.matchAll(
    /@for\s*\(\s*([A-Za-z_$][\w$]*)\s+of\s+([^;)]+)[^)]*\)\s*\{/g,
  )) {
    const collection = memberExpression(match[2])
    const start = match.index! + match[0].length
    const end = matchingBrace(source, start - 1)
    if (collection && end > start) contexts.push({ alias: match[1], collection, start, end })
  }
  for (const carousel of source.matchAll(/<p-carousel\b[\s\S]*?>/gi)) {
    const attributes = parseAttributes(carousel[0], carousel.index!)
    const value = attributes.find((item) => item.name.toLowerCase() === '[value]')
    const collection = value ? memberExpression(value.value) : undefined
    if (!collection) continue
    const carouselEnd = source.toLowerCase().indexOf('</p-carousel>', carousel.index! + carousel[0].length)
    if (carouselEnd < 0) continue
    const body = source.slice(carousel.index! + carousel[0].length, carouselEnd)
    for (const template of body.matchAll(/<ng-template\b[^>]*\blet-([A-Za-z_$][\w$]*)\b[^>]*>/gi)) {
      const start = carousel.index! + carousel[0].length + template.index! + template[0].length
      const end = source.toLowerCase().indexOf('</ng-template>', start)
      if (end >= 0 && end <= carouselEnd)
        contexts.push({ alias: template[1], collection, start, end })
    }
  }
  return contexts
}

function matchingBrace(source: string, opening: number) {
  let depth = 0
  let quote = ''
  for (let index = opening; index < source.length; index++) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index++
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth++
    else if (character === '}' && --depth === 0) return index
  }
  return -1
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
  if (target.angular.sourceLiteral) {
    const quote = target.angular.quote
    let escaped = url.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)
    if (quote === '`') escaped = escaped.replaceAll('${', '\\${')
    output.overwrite(target.start, target.end, `${quote}${escaped}${quote}`)
  } else if (target.angular.binding) {
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
