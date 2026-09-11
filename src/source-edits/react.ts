import { parse } from '@babel/parser'
import { VISITOR_KEYS, getBindingIdentifiers } from '@babel/types'
import type { Node, JSXOpeningElement, ImportDeclaration, StringLiteral } from '@babel/types'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import MagicString from 'magic-string'
import type { Target } from '../shared'
import { escapePointer, jsonValue, pointerParts } from './json'
import type { JsonDocument } from './json'
import { hash } from '../hash'
import { analyzeVisual } from './visual'
import type { VisualEdit } from './visual'

const assetPattern = /\.(svg|png|jpe?g|webp|avif)(\?url)?$/i
const slash = (value: string) => value.split(path.sep).join('/')

interface Binding {
  source: StringLiteral
  declaration: ImportDeclaration
  references: number
}

export interface SourceTarget extends Target {
  start: number
  end: number
  insertion: number
  binding?: Binding
  hasSource: boolean
  runtimeId?: string
  visual?: VisualEdit
  angular?: {
    binding: boolean
    quote: '"' | "'"
  }
  runtimeMatch?: boolean
  assetDirectory?: string
}

function walk(node: Node, visit: (node: Node, ancestors: Node[]) => void, ancestors: Node[] = []) {
  visit(node, ancestors)
  const parents = [...ancestors, node]
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) walk(child as Node, visit, parents)
    } else if (value && typeof value === 'object' && 'type' in value) {
      walk(value as Node, visit, parents)
    }
  }
}

export function analyze(
  source: string,
  file: string,
  components: string[],
  documents = new Map<string, JsonDocument>(),
): SourceTarget[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  const imports = new Map<string, Binding>()
  const names = new Map<string, number>()
  const shadowed = new Set<string>()
  const mutated = new Set<string>()
  const jsonImports = new Map<string, string>()
  walk(ast, (node) => {
    const changed =
      node.type === 'AssignmentExpression'
        ? node.left
        : node.type === 'UpdateExpression' ||
            (node.type === 'UnaryExpression' && node.operator === 'delete')
          ? node.argument
          : node.type === 'CallExpression' &&
              node.callee.type === 'MemberExpression' &&
              node.callee.property.type === 'Identifier' &&
              [
                'sort',
                'reverse',
                'splice',
                'push',
                'pop',
                'shift',
                'unshift',
                'fill',
                'copyWithin',
              ].includes(node.callee.property.name)
            ? node.callee.object
            : undefined
    const changedRoot = rootIdentifier(changed)
    if (changedRoot) mutated.add(changedRoot)
    // Fail closed if an import name is also declared in a nested scope. A later adapter can
    // resolve these per scope; treating a shadowed prop as an imported asset would be wrong.
    if (
      [
        'VariableDeclarator',
        'FunctionDeclaration',
        'FunctionExpression',
        'ArrowFunctionExpression',
        'ClassDeclaration',
        'CatchClause',
        'ObjectMethod',
        'ClassMethod',
        'ClassPrivateMethod',
      ].includes(node.type)
    ) {
      for (const name of Object.keys(getBindingIdentifiers(node))) shadowed.add(name)
    }
    if (node.type === 'Identifier') names.set(node.name, (names.get(node.name) ?? 0) + 1)
    if (node.type === 'ImportDeclaration' && /\.json$/.test(node.source.value)) {
      const importedFile = node.source.value.startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(file), node.source.value))
        : node.source.value.replace(/^\//, '')
      for (const specifier of node.specifiers)
        if (specifier.type === 'ImportDefaultSpecifier' && documents.has(importedFile))
          jsonImports.set(specifier.local.name, importedFile)
    }
    if (node.type === 'ImportDeclaration' && assetPattern.test(node.source.value)) {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          imports.set(specifier.local.name, {
            source: node.source,
            declaration: node,
            references: 0,
          })
        }
      }
    }
  })
  for (const [name, binding] of imports) binding.references = (names.get(name) ?? 1) - 1
  const result: SourceTarget[] = []
  let ordinal = 0
  walk(ast, (node, ancestors) => {
    if (node.type !== 'JSXOpeningElement' || node.name.type !== 'JSXIdentifier') return
    const component = components.includes(node.name.name)
    if (node.name.name !== 'img' && !component) return
    const index = ordinal++
    const attribute = (name: string) =>
      node.attributes.find(
        (item) =>
          item.type === 'JSXAttribute' &&
          item.name.type === 'JSXIdentifier' &&
          item.name.name === name,
      )
    // Explicit metadata belongs to a parent adapter, e.g. a slot component forwarding its ID.
    if (attribute('data-picaroo-id')) return
    const src = attribute('src')
    const value = src?.type === 'JSXAttribute' ? src.value : undefined
    const expression = value?.type === 'JSXExpressionContainer' ? value.expression : undefined
    const binding =
      expression?.type === 'Identifier' && !shadowed.has(expression.name)
        ? imports.get(expression.name)
        : undefined
    const literal =
      value?.type === 'StringLiteral'
        ? value
        : expression?.type === 'StringLiteral'
          ? expression
          : undefined
    const current = binding?.source.value ?? literal?.value ?? ''
    const hasSpread = node.attributes.some((item) => item.type === 'JSXSpreadAttribute')
    const hasResponsive =
      !!attribute('srcSet') ||
      ancestors.some(
        (parent) =>
          parent.type === 'JSXElement' &&
          parent.openingElement.name.type === 'JSXIdentifier' &&
          parent.openingElement.name.name === 'picture',
      )
    const repeated = ancestors.some(
      (parent) =>
        parent.type === 'CallExpression' &&
        parent.callee.type === 'MemberExpression' &&
        parent.callee.property.type === 'Identifier' &&
        ['map', 'flatMap'].includes(parent.callee.property.name),
    )
    const editable = !hasSpread && !repeated && (!!literal || !!binding || (component && !src))
    const labelAttr = attribute(component ? 'label' : 'alt')
    const label =
      labelAttr?.type === 'JSXAttribute' && labelAttr.value?.type === 'StringLiteral'
        ? labelAttr.value.value
        : `${node.name.name} · ${path.basename(file)}:${node.loc?.start.line}`
    const base: SourceTarget = {
      id: hash(`${file}:${index}`).slice(0, 20),
      file,
      line: node.loc?.start.line ?? 1,
      label: label || 'Decorative image',
      current,
      kind:
        (component && node.name.name === 'Icon') || /\.svg(?:[?#]|$)/i.test(current)
          ? 'svg'
          : 'raster',
      presentation: component && node.name.name === 'Icon' ? 'svg-component' : undefined,
      version: hash(source),
      editable,
      reason: editable
        ? undefined
        : hasSpread
          ? 'Spread props need an explicit mapping.'
          : repeated
            ? 'Use a direct JSON array.map((item, index) => ...) with an existing image field.'
            : hasResponsive
              ? 'This responsive fallback uses a dynamic source. Use a literal URL or a direct asset import.'
              : 'Use a direct local JSON field or a static image source.',
      shared: component || (binding?.references ?? 0) > 1,
      runtimeMatch: !!current,
      start: value?.start ?? 0,
      end: value?.end ?? 0,
      insertion: openingEnd(node, source),
      binding,
      hasSource: !!src,
      canMap: !hasSpread && !hasResponsive && !repeated && (component || !!literal || !!binding),
    }
    // Resolve only direct JSON member access and direct array.map(item, index) callbacks.
    // Filtered/sorted arrays, arbitrary expressions, and shadowed bindings remain unsupported.
    const chain = memberParts(expression)
    let mapping:
      | {
          jsonFile: string
          parts: string[]
          index?: string
          indexPosition?: number
          records?: unknown[]
          labelParts?: string[]
        }
      | undefined
    if (
      chain &&
      jsonImports.has(chain[0]) &&
      !shadowed.has(chain[0]) &&
      !mutated.has(chain[0]) &&
      !repeated
    ) {
      mapping = { jsonFile: jsonImports.get(chain[0])!, parts: chain.slice(1) }
    } else if (chain && repeated && !mutated.has(chain[0])) {
      const loop = [...ancestors]
        .reverse()
        .find(
          (parent) =>
            parent.type === 'CallExpression' &&
            parent.callee.type === 'MemberExpression' &&
            parent.callee.property.type === 'Identifier' &&
            ['map', 'flatMap'].includes(parent.callee.property.name),
        )
      if (
        loop?.type === 'CallExpression' &&
        loop.callee.type === 'MemberExpression' &&
        loop.callee.property.type === 'Identifier' &&
        loop.callee.property.name === 'map'
      ) {
        const collection = memberParts(loop.callee.object)
        const callback = loop.arguments[0]
        if (
          collection &&
          !shadowed.has(collection[0]) &&
          !mutated.has(collection[0]) &&
          jsonImports.has(collection[0]) &&
          callback?.type === 'ArrowFunctionExpression' &&
          callback.params[0]?.type === 'Identifier' &&
          callback.params[0].name === chain[0] &&
          callback.params[1]?.type === 'Identifier' &&
          !mutated.has(callback.params[1].name) &&
          ancestors.filter(
            (parent) =>
              parent.type === 'CallExpression' &&
              parent.callee.type === 'MemberExpression' &&
              parent.callee.property.type === 'Identifier' &&
              ['map', 'flatMap'].includes(parent.callee.property.name),
          ).length === 1 &&
          [...ancestors]
            .reverse()
            .find((parent) =>
              [
                'ArrowFunctionExpression',
                'FunctionExpression',
                'FunctionDeclaration',
                'ObjectMethod',
                'ClassMethod',
                'ClassPrivateMethod',
              ].includes(parent.type),
            ) === callback
        ) {
          const jsonFile = jsonImports.get(collection[0])!
          const records = jsonValue(documents.get(jsonFile)!, collection.slice(1))
          const labelValue =
            labelAttr?.type === 'JSXAttribute' && labelAttr.value?.type === 'JSXExpressionContainer'
              ? memberParts(labelAttr.value.expression)
              : undefined
          if (Array.isArray(records))
            mapping = {
              jsonFile,
              parts: [...collection.slice(1), '*', ...chain.slice(1)],
              index: callback.params[1].name,
              indexPosition: collection.length - 1,
              records,
              labelParts: labelValue?.[0] === chain[0] ? labelValue.slice(1) : undefined,
            }
        }
      }
    }
    if (!mapping || hasSpread || (hasResponsive && !!attribute('srcSet'))) {
      result.push(base)
      return
    }
    const document = documents.get(mapping.jsonFile)!
    const entries = mapping.records ? mapping.records.map((_, index) => index) : [undefined]
    for (const recordIndex of entries) {
      const parts = [...mapping.parts]
      if (recordIndex !== undefined) parts[mapping.indexPosition!] = String(recordIndex)
      const pointer = parts.length ? '/' + parts.map(escapePointer).join('/') : ''
      const field = document.strings.get(pointer)
      let recordLabel: unknown
      if (mapping.labelParts && recordIndex !== undefined) {
        recordLabel = mapping.records![recordIndex]
        for (const part of mapping.labelParts)
          recordLabel =
            recordLabel && typeof recordLabel === 'object' && Object.hasOwn(recordLabel, part)
              ? (recordLabel as Record<string, unknown>)[part]
              : undefined
      }
      result.push({
        ...base,
        id: recordIndex === undefined ? base.id : `${base.id}:${recordIndex}`,
        runtimeId: mapping.index
          ? `${JSON.stringify(base.id + ':')} + ${mapping.index}`
          : undefined,
        data: { file: mapping.jsonFile, pointer },
        label:
          typeof recordLabel === 'string'
            ? recordLabel
            : recordIndex === undefined
              ? base.label
              : `${base.label} · Item ${recordIndex + 1}`,
        version: hash(source + '\0' + document.source),
        current: field?.value ?? '',
        kind: /\.svg(?:\?|$)/i.test(field?.value ?? '') ? 'svg' : 'raster',
        editable: !!field,
        shared: false,
        canMap: false,
        reason: field
          ? undefined
          : 'This JSON field must exist and contain a string (an empty string is allowed).',
      })
    }
  })
  return [...result, ...analyzeVisual(source, file)]
}

function openingEnd(node: JSXOpeningElement, source: string) {
  const end = node.end! - 1
  return source[end - 1] === '/' ? end - 1 : end
}

export function instrument(source: string, targets: SourceTarget[]) {
  const output = new MagicString(source)
  const positions = new Map<number, SourceTarget[]>()
  for (const target of targets) {
    if (target.insertion < 0) continue
    const group = positions.get(target.insertion) ?? []
    group.push(target)
    positions.set(target.insertion, group)
  }
  for (const [position, group] of positions) {
    const target = group[0]
    output.appendLeft(
      position,
      target.runtimeId
        ? ` data-picaroo-id={${target.runtimeId}} `
        : ` data-picaroo-id="${group.map((item) => item.id).join(' ')}" `,
    )
  }
  return { code: output.toString(), map: output.generateMap({ hires: true }) }
}

function memberParts(node: Node | undefined): string[] | undefined {
  if (node?.type === 'Identifier') return [node.name]
  if (node?.type !== 'MemberExpression' || node.optional) return
  const object = memberParts(node.object)
  const property =
    !node.computed && node.property.type === 'Identifier'
      ? node.property.name
      : node.computed &&
          (node.property.type === 'StringLiteral' || node.property.type === 'NumericLiteral')
        ? String(node.property.value)
        : undefined
  return object && property !== undefined ? [...object, property] : undefined
}

function rootIdentifier(node: Node | undefined): string | undefined {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'MemberExpression') return rootIdentifier(node.object)
}

function insertImport(output: MagicString, source: string, statement: string) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  const imports = ast.program.body.filter((node) => node.type === 'ImportDeclaration')
  const position =
    imports.at(-1)?.end ?? ast.program.directives.at(-1)?.end ?? ast.program.interpreter?.end ?? 0
  output.appendLeft(position, `\n${statement}\n`)
}

export function reuseReference(source: string, target: SourceTarget, asset: string) {
  if (target.binding && !asset.startsWith('public/')) return replaceReference(source, target, asset)
  const output = new MagicString(source)
  let expression: string
  if (asset.startsWith('public/')) {
    expression = JSON.stringify('/' + asset.slice('public/'.length))
  } else {
    const name = `picarooAsset_${randomBytes(5).toString('hex')}`
    let relative = path.posix.relative(path.posix.dirname(target.file), asset)
    if (!relative.startsWith('.')) relative = './' + relative
    insertImport(output, source, `import ${name} from ${JSON.stringify(relative)}`)
    expression = `{${name}}`
  }
  if (target.hasSource) output.overwrite(target.start, target.end, expression)
  else output.appendLeft(target.insertion, ` src=${expression} `)
  if (target.binding?.references === 1 && asset.startsWith('public/')) {
    if (target.binding.declaration.specifiers.length !== 1)
      throw new Error('Mixed asset imports need a manual source mapping.')
    output.remove(target.binding.declaration.start!, target.binding.declaration.end!)
  }
  return output.toString()
}

export function mapReference(
  source: string,
  target: SourceTarget,
  jsonFile: string,
  pointer: string,
) {
  if (!target.canMap) throw new Error('This source cannot be linked to a JSON field automatically.')
  const name = `picarooData_${randomBytes(5).toString('hex')}`
  let relative = path.posix.relative(path.posix.dirname(target.file), jsonFile)
  if (!relative.startsWith('.')) relative = './' + relative
  const output = new MagicString(source)
  insertImport(output, source, `import ${name} from ${JSON.stringify(relative)}`)
  const expression = `{${name}${pointerParts(pointer)
    .map((part) => `[${JSON.stringify(part)}]`)
    .join('')}}`
  if (target.hasSource) output.overwrite(target.start, target.end, expression)
  else output.appendLeft(target.insertion, ` src=${expression} `)
  if (target.binding?.references === 1) {
    if (target.binding.declaration.specifiers.length !== 1)
      throw new Error('Mixed asset imports need a manual source mapping.')
    output.remove(target.binding.declaration.start!, target.binding.declaration.end!)
  }
  return output.toString()
}

export function replaceReference(source: string, target: SourceTarget, asset: string) {
  const output = new MagicString(source)
  if (target.binding) {
    let relative = slash(path.relative(path.dirname(target.file), asset))
    if (!relative.startsWith('.')) relative = `./${relative}`
    if (target.binding.source.value.endsWith('?url')) relative += '?url'
    if (target.binding.references === 1) {
      output.overwrite(
        target.binding.source.start!,
        target.binding.source.end!,
        JSON.stringify(relative),
      )
    } else {
      // Fork the binding so replacing one placement does not replace other uses of that import.
      const name = `picarooAsset_${randomBytes(5).toString('hex')}`
      output.appendLeft(
        target.binding.declaration.end!,
        `\nimport ${name} from ${JSON.stringify(relative)}\n`,
      )
      output.overwrite(target.start, target.end, `{${name}}`)
    }
  } else {
    const url = `/${slash(asset).replace(/^public\//, '')}`
    if (target.hasSource) output.overwrite(target.start, target.end, JSON.stringify(url))
    else output.appendLeft(target.insertion, ` src=${JSON.stringify(url)} `)
  }
  return output.toString()
}
