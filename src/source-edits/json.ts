import { parseExpression } from '@babel/parser'
import type { Node } from '@babel/types'
import { hash } from '../hash'
import type { DataField } from '../shared'

export const escapePointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1')
export const pointerParts = (pointer: string) =>
  pointer === ''
    ? []
    : pointer
        .slice(1)
        .split('/')
        .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))

export interface JsonDocument {
  source: string
  value: unknown
  strings: Map<string, { value: string; start: number; end: number; line: number }>
}

export function readJson(source: string): JsonDocument {
  const value: unknown = JSON.parse(source)
  const ast = parseExpression(source)
  const strings: JsonDocument['strings'] = new Map()
  function visit(node: Node, pointer: string) {
    if (node.type === 'StringLiteral')
      strings.set(pointer, {
        value: node.value,
        start: node.start!,
        end: node.end!,
        line: node.loc!.start.line,
      })
    if (node.type === 'ArrayExpression')
      node.elements.forEach((item, index) => {
        if (item) visit(item, `${pointer}/${index}`)
      })
    if (node.type === 'ObjectExpression') {
      const keys = new Set<string>()
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || property.key.type !== 'StringLiteral')
          throw new Error('Only strict JSON data is supported.')
        const key = property.key.value
        if (keys.has(key))
          throw new Error(`Duplicate JSON key: ${key}. Resolve it before mapping images.`)
        keys.add(key)
        visit(property.value, `${pointer}/${escapePointer(key)}`)
      }
    }
  }
  visit(ast, '')
  return { source, value, strings }
}

export function jsonValue(document: JsonDocument, parts: string[]): unknown {
  let current: unknown = document.value
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part))
      return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function dataFields(file: string, document: JsonDocument): DataField[] {
  return [...document.strings]
    .filter(
      ([, entry]) => !entry.value || /\.(png|jpe?g|webp|avif|svg)(?:[?#].*)?$/i.test(entry.value),
    )
    .map(([pointer, entry]) => ({
      file,
      pointer,
      value: entry.value,
      version: hash(document.source),
    }))
}

export function replaceJsonField(document: JsonDocument, pointer: string, value: string) {
  const field = document.strings.get(pointer)
  if (!field) throw new Error('Select an existing string field in a local JSON file.')
  const result =
    document.source.slice(0, field.start) + JSON.stringify(value) + document.source.slice(field.end)
  readJson(result)
  return result
}
