import { parse } from '@babel/parser'
import { VISITOR_KEYS } from '@babel/types'
import type { Node, JSXAttribute } from '@babel/types'
import postcss from 'postcss'
import type { AnyNode } from 'postcss'
import { optimize } from 'svgo'
import path from 'node:path'
import MagicString from 'magic-string'
import { hash } from '../hash'
import type { SourceTarget } from './react'

export interface VisualEdit {
  type: 'css' | 'background' | 'srcset' | 'svg'
  value?: string
  urlStart?: number
  urlEnd?: number
  descriptorStart?: number
  descriptorEnd?: number
  contentStart?: number
  contentEnd?: number
  viewBoxStart?: number
  viewBoxEnd?: number
  mimeStart?: number
  mimeEnd?: number
  format?: 'webp' | 'avif' | 'jpeg' | 'png'
}

function walk(node: Node, visit: (node: Node, parents: Node[]) => void, parents: Node[] = []) {
  visit(node, parents)
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) walk(child, visit, [...parents, node])
    } else if (value && typeof value === 'object' && 'type' in value)
      walk(value as Node, visit, [...parents, node])
  }
}

function base(source: string, file: string, offset: number, label: string): SourceTarget {
  return {
    id: hash(`${file}:visual:${offset}`).slice(0, 20),
    file,
    line: source.slice(0, offset).split('\n').length,
    label,
    kind: 'raster',
    current: '',
    version: hash(source),
    editable: true,
    shared: false,
    start: 0,
    end: 0,
    insertion: -1,
    hasSource: true,
    canMap: false,
  }
}

const urls = (value: string) => [...value.matchAll(/url\(\s*(['"]?)([^'"()]+?)\1\s*\)/gi)]

function responsiveEntries(value: string) {
  const entries = value
    .split(',')
    .map((entry) => ({ entry, match: /^(\s*)(\S+?)(?:\s+(\d+(?:\.\d+)?[wx]))?\s*$/.exec(entry) }))
  const descriptors = new Set<string>()
  let mode: string | undefined
  for (const { match } of entries) {
    if (!match || /^(?:data:|blob:)/i.test(match[2])) return undefined
    const descriptor = match[3] ?? '1x'
    const unit = descriptor.slice(-1)
    const size = Number(descriptor.slice(0, -1))
    const key = `${size}${unit}`
    if (
      !Number.isFinite(size) ||
      size <= 0 ||
      (unit === 'w' && (!Number.isSafeInteger(size) || !/^\d+w$/.test(descriptor))) ||
      (mode && mode !== unit) ||
      descriptors.has(key)
    )
      return undefined
    mode = unit
    descriptors.add(key)
  }
  return entries
}

function stableIds(targets: SourceTarget[], file: string) {
  // Source offsets change when an earlier URL or SVG is replaced; target order does not.
  return targets.map((target, index) => ({
    ...target,
    id: hash(`${file}:visual-slot:${index}`).slice(0, 20),
  }))
}

export function analyzeCss(source: string, file: string): SourceTarget[] {
  const targets: SourceTarget[] = []
  const root = postcss.parse(source, { from: file })
  root.walkDecls(/^(background|background-image)$/i, (decl) => {
    const rule = decl.parent
    if (rule?.type !== 'rule' || /::|:(?:before|after)\b|&/.test(rule.selector)) return
    const conditions: NonNullable<SourceTarget['conditions']> = []
    for (let parent: AnyNode | undefined = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule') {
        if (parent.name === 'media' || parent.name === 'supports')
          conditions.push({ type: parent.name, value: parent.params })
        else if (!['layer'].includes(parent.name)) return
      }
      if (parent.type === 'rule') return
    }
    const offset = decl.source?.start?.offset
    if (offset === undefined) return
    const valueStart = source.indexOf(decl.value, offset + decl.prop.length)
    if (valueStart < 0) return
    for (const match of urls(decl.value)) {
      const current = match[2].trim()
      if (!current || current.startsWith('data:') || current.includes('var(')) continue
      const start = valueStart + match.index!
      const target = base(source, file, start, `Background · ${rule.selector}`)
      targets.push({
        ...target,
        selector: rule.selector,
        conditions,
        shared: true,
        current,
        kind: /\.svg(?:[?#]|$)/i.test(current) ? 'svg' : 'raster',
        presentation: 'background',
        start,
        end: start + match[0].length,
        visual: { type: 'css' },
      })
    }
  })
  return stableIds(targets, file)
}

export function analyzeVisual(source: string, file: string): SourceTarget[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  const targets: SourceTarget[] = []
  walk(ast, (node, parents) => {
    if (node.type !== 'JSXOpeningElement' || node.name.type !== 'JSXIdentifier') return
    const attr = (name: string) =>
      node.attributes.find(
        (a): a is JSXAttribute =>
          a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name,
      )
    if (attr('data-picaroo-id')) return
    const literal = (attribute: JSXAttribute | undefined) =>
      attribute?.value?.type === 'StringLiteral'
        ? attribute.value
        : attribute?.value?.type === 'JSXExpressionContainer' &&
            attribute.value.expression.type === 'StringLiteral'
          ? attribute.value.expression
          : undefined
    const repeated = parents.some(
      (p) =>
        p.type === 'CallExpression' &&
        p.callee.type === 'MemberExpression' &&
        p.callee.property.type === 'Identifier' &&
        ['map', 'flatMap', 'from'].includes(p.callee.property.name),
    )
    const spread = node.attributes.some((a) => a.type === 'JSXSpreadAttribute')
    const insertion = node.end! - (source[node.end! - 2] === '/' ? 2 : 1)
    const create = (offset: number, label: string) => ({
      ...base(source, file, offset, label),
      insertion,
      editable: !repeated && !spread,
      reason: repeated
        ? 'This shared visual is repeated. Use an individual JSON image field for each record.'
        : spread
          ? 'Spread props require an explicit source.'
          : undefined,
    })
    const srcset = literal(attr('srcSet'))
    const pictureSource =
      node.name.name === 'source' &&
      parents.some(
        (parent) =>
          parent.type === 'JSXElement' &&
          parent.openingElement.name.type === 'JSXIdentifier' &&
          parent.openingElement.name.name === 'picture',
      )
    if (srcset && (node.name.name === 'img' || pictureSource)) {
      const value = srcset.value
      // Static local/HTTP candidates only; commas inside URLs require manual mapping.
      const entries = responsiveEntries(value)
      const mime = pictureSource ? literal(attr('type')) : undefined
      const unsupportedType =
        pictureSource &&
        attr('type') &&
        (!mime ||
          !['image/webp', 'image/avif', 'image/jpeg', 'image/png', 'image/svg+xml'].includes(
            mime.value,
          ))
      if (!entries || unsupportedType)
        targets.push({
          ...create(srcset.start!, 'Responsive image · Needs mapping'),
          editable: false,
          presentation: 'responsive',
          reason: unsupportedType
            ? 'Use a supported literal image MIME type for this picture source.'
            : 'Use a static srcSet with unique positive widths or densities. Mixed descriptors and data/blob URLs need manual editing.',
        })
      let cursor = 0
      for (const { entry, match: candidate } of !unsupportedType ? (entries ?? []) : []) {
        const match = candidate!
        const urlStart = cursor + match[1].length
        const descriptorStart = match[3] ? cursor + entry.lastIndexOf(match[3]) : undefined
        const kind = /\.svg(?:[?#]|$)/i.test(match[2]) ? 'svg' : 'raster'
        const incompatibleType = mime && (mime.value === 'image/svg+xml') !== (kind === 'svg')
        targets.push({
          ...create(
            srcset.start! + cursor,
            `${node.name.name === 'source' ? `Picture ${literal(attr('media'))?.value ?? 'source'}` : (literal(attr('alt'))?.value ?? 'Responsive image')} · ${match[3] ?? '1x'}`,
          ),
          ...(incompatibleType
            ? {
                editable: false,
                reason:
                  'The candidate kind conflicts with the picture source MIME type. Correct the source before replacing it.',
              }
            : {}),
          current: match[2],
          kind,
          presentation: 'responsive',
          descriptor: match[3],
          start: srcset.start!,
          end: srcset.end!,
          visual: {
            type: 'srcset',
            value,
            urlStart,
            urlEnd: urlStart + match[2].length,
            descriptorStart,
            descriptorEnd:
              descriptorStart === undefined ? undefined : descriptorStart + match[3].length,
            mimeStart: mime?.start ?? undefined,
            mimeEnd: mime?.end ?? undefined,
            format:
              mime && ['image/webp', 'image/avif', 'image/jpeg', 'image/png'].includes(mime.value)
                ? (mime.value.slice(6) as VisualEdit['format'])
                : undefined,
          },
        })
        cursor += entry.length + 1
      }
    }
    const style = attr('style')?.value
    if (style?.type === 'JSXExpressionContainer' && style.expression.type === 'ObjectExpression') {
      const unsafe = style.expression.properties.some(
        (p) => p.type !== 'ObjectProperty' || p.computed,
      )
      if (!unsafe)
        for (const property of style.expression.properties) {
          if (property.type !== 'ObjectProperty' || property.value.type !== 'StringLiteral')
            continue
          const key =
            property.key.type === 'Identifier'
              ? property.key.name
              : property.key.type === 'StringLiteral'
                ? property.key.value
                : ''
          if (!['background', 'backgroundImage'].includes(key)) continue
          for (const match of urls(property.value.value)) {
            const value = property.value.value
            const current = match[2].trim()
            const urlStart = match.index! + match[0].indexOf(match[2])
            targets.push({
              ...create(
                property.value.start! + match.index!,
                `Background · ${literal(attr('aria-label'))?.value ?? node.name.name}`,
              ),
              current,
              kind: /\.svg(?:[?#]|$)/i.test(current) ? 'svg' : 'raster',
              start: property.value.start!,
              end: property.value.end!,
              presentation: 'background',
              visual: { type: 'background', value, urlStart, urlEnd: urlStart + match[2].length },
            })
          }
        }
    }
    if (
      node.name.name !== 'svg' ||
      parents.some(
        (p) =>
          p.type === 'JSXElement' &&
          p.openingElement !== node &&
          p.openingElement.name.type === 'JSXIdentifier' &&
          p.openingElement.name.name === 'svg',
      )
    )
      return
    const element = parents.at(-1)
    if (element?.type !== 'JSXElement' || !element.closingElement) return
    let dynamic = false
    for (const child of element.children)
      walk(child, (n) => {
        if (
          n.type === 'JSXSpreadChild' ||
          (n.type === 'JSXExpressionContainer' &&
            !['StringLiteral', 'NumericLiteral', 'JSXEmptyExpression'].includes(n.expression.type))
        )
          dynamic = true
      })
    if (dynamic) return // Components such as Icon expose a replaceable SVG source at their call sites.
    const viewBox = attr('viewBox')?.value
    targets.push({
      ...create(node.start!, `SVG · ${literal(attr('aria-label'))?.value ?? path.basename(file)}`),
      kind: 'svg',
      presentation: 'inline-svg',
      start: node.start!,
      end: element.end!,
      visual: {
        type: 'svg',
        contentStart: node.end!,
        contentEnd: element.closingElement.start!,
        viewBoxStart: viewBox?.start ?? undefined,
        viewBoxEnd: viewBox?.end ?? undefined,
      },
    })
  })
  return stableIds(targets, file)
}

type SvgNode = {
  type: string
  name?: string
  value?: string
  attributes?: Record<string, string>
  children?: SvgNode[]
}
function svgJsx(input: string, prefix: string) {
  let svg: SvgNode | undefined
  optimize(input, {
    plugins: [
      {
        name: 'prefix-accessibility-references',
        fn: (root) => {
          const elements: SvgNode[] = []
          const collect = (node: SvgNode) => {
            elements.push(node)
            node.children?.forEach(collect)
          }
          collect(root as SvgNode)
          const namespace = `picaroo-${prefix}__`
          const ids = new Map(
            elements.flatMap((node) => {
              const id = node.attributes?.id
              return id ? [[id, id.startsWith(namespace) ? id : namespace + id]] : []
            }),
          )
          for (const node of elements) {
            for (const name of ['aria-labelledby', 'aria-describedby']) {
              const value = node.attributes?.[name]
              if (value)
                node.attributes![name] = value
                  .split(/\s+/)
                  .map((id) => ids.get(id) ?? id)
                  .join(' ')
            }
          }
        },
      },
      { name: 'prefixIds', params: { prefix: `picaroo-${prefix}` } },
      {
        name: 'read-svg',
        fn: (root) => {
          svg = (root as SvgNode).children?.find((n) => n.name === 'svg')
        },
      },
    ],
  })
  if (!svg) throw new Error('SVG root is missing.')
  const attrName = (name: string) =>
    name.startsWith('aria-') || name.startsWith('data-')
      ? name
      : name === 'class'
        ? 'className'
        : name.replace(/[:-]([a-z])/g, (_, c: string) => c.toUpperCase())
  const attrs = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([name, value]) => ` ${attrName(name)}={${JSON.stringify(value)}}`)
      .join('')
  const render = (node: SvgNode): string =>
    node.type === 'text'
      ? `{${JSON.stringify(node.value ?? '')}}`
      : node.type === 'element'
        ? `<${node.name}${attrs(node.attributes ?? {})}>${(node.children ?? []).map(render).join('')}</${node.name}>`
        : ''
  const { viewBox, width, height, ...presentation } = svg.attributes ?? {}
  delete presentation.xmlns
  delete presentation['xmlns:xlink']
  const box =
    viewBox ??
    (width && height && /^\d+(?:\.\d+)?$/.test(width) && /^\d+(?:\.\d+)?$/.test(height)
      ? `0 0 ${width} ${height}`
      : undefined)
  if (!box)
    throw new Error('An inline replacement SVG needs a viewBox or numeric width and height.')
  return {
    box,
    children: `<g${attrs({ fill: 'black', stroke: 'none', ...presentation })}>${(svg.children ?? []).map(render).join('')}</g>`,
  }
}

export function replaceVisual(
  source: string,
  target: SourceTarget,
  asset: string,
  input: Buffer,
  width?: number,
) {
  const edit = target.visual!
  const output = new MagicString(source)
  const url = '/' + asset.replace(/^public\//, '')
  if (edit.type === 'svg') {
    const svg = svgJsx(input.toString('utf8'), target.id)
    if (edit.contentStart === edit.contentEnd) output.appendLeft(edit.contentStart!, svg.children)
    else output.overwrite(edit.contentStart!, edit.contentEnd!, svg.children)
    if (edit.viewBoxStart !== undefined)
      output.overwrite(edit.viewBoxStart, edit.viewBoxEnd!, JSON.stringify(svg.box))
    else output.appendLeft(target.insertion, ` viewBox=${JSON.stringify(svg.box)} `)
  } else if (edit.type === 'css')
    output.overwrite(target.start, target.end, `url(${JSON.stringify(url)})`)
  else {
    const value = new MagicString(edit.value!)
    value.overwrite(edit.urlStart!, edit.urlEnd!, url)
    if (
      edit.type === 'srcset' &&
      target.descriptor?.endsWith('w') &&
      width &&
      edit.descriptorStart !== undefined
    )
      value.overwrite(edit.descriptorStart, edit.descriptorEnd!, `${width}w`)
    if (edit.type === 'srcset') {
      if (!responsiveEntries(value.toString()))
        throw new Error(
          'This image would duplicate another responsive width. Choose a larger image or a different crop/output size.',
        )
    }
    output.overwrite(target.start, target.end, JSON.stringify(value.toString()))
    if (edit.mimeStart !== undefined) {
      const extension = path.extname(asset).slice(1)
      const mime =
        extension === 'svg'
          ? 'image/svg+xml'
          : extension === 'jpg'
            ? 'image/jpeg'
            : `image/${extension}`
      // A <source> type applies to all candidates, so mixed-format lists must retain their format.
      output.overwrite(edit.mimeStart, edit.mimeEnd!, JSON.stringify(mime))
    }
  }
  return output.toString()
}
