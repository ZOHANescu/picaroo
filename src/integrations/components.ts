export interface PicarooManifest {
  picaroo?: {
    components?: unknown
    angular?: {
      imageSources?: unknown
    }
  }
}

export interface AngularImageSource {
  tag: string
  attributes: string[]
  labelAttributes: string[]
}

const componentName = /^[A-Za-z_$][\w$]*$/
const angularTagName = /^[a-z][a-z0-9-]*$/
const angularAttributeName = /^[A-Za-z_][\w-]*$/

/** Resolve the component contract shared by the standalone service and Vite instrumentation. */
export function resolveImageComponents(
  manifest: PicarooManifest,
  additional: readonly string[] = [],
) {
  const configured = manifest.picaroo?.components
  if (
    configured !== undefined &&
    (!Array.isArray(configured) || configured.some((name) => typeof name !== 'string'))
  )
    throw new Error('package.json picaroo.components must be an array of component names.')
  const components = [...((configured as string[] | undefined) ?? []), ...additional]
  for (const name of components)
    if (!componentName.test(name) || name === 'img')
      throw new Error(`Invalid Picaroo image component name: ${JSON.stringify(name)}.`)
  return [...new Set(components)]
}

function stringArray(value: unknown, field: string, allowEmpty = false) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string')
  )
    throw new Error(
      `package.json picaroo.angular.imageSources ${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array of strings.`,
    )
  return value as string[]
}

/** Resolve additive Angular image-source contracts from project configuration and CLI entries. */
export function resolveAngularImageSources(
  manifest: PicarooManifest,
  additional: readonly AngularImageSource[] = [],
) {
  const configured = manifest.picaroo?.angular?.imageSources
  if (configured !== undefined && !Array.isArray(configured))
    throw new Error('package.json picaroo.angular.imageSources must be an array.')

  const entries = [...((configured as unknown[] | undefined) ?? []), ...additional]
  const merged = new Map<string, AngularImageSource>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Each package.json picaroo.angular.imageSources entry must be an object.')
    const value = entry as Record<string, unknown>
    if (typeof value.tag !== 'string' || !angularTagName.test(value.tag))
      throw new Error(`Invalid Angular image source tag: ${JSON.stringify(value.tag)}.`)
    const attributes = stringArray(value.attributes, 'attributes')
    const labelAttributes =
      value.labelAttributes === undefined
        ? ['alt']
        : stringArray(value.labelAttributes, 'labelAttributes', true)
    for (const attribute of [...attributes, ...labelAttributes])
      if (!angularAttributeName.test(attribute))
        throw new Error(`Invalid Angular image source attribute: ${JSON.stringify(attribute)}.`)

    const tag = value.tag.toLowerCase()
    const current = merged.get(tag) ?? { tag, attributes: [], labelAttributes: [] }
    current.attributes.push(...attributes.map((attribute) => attribute.toLowerCase()))
    current.labelAttributes.push(
      ...labelAttributes.map((attribute) => attribute.toLowerCase()),
    )
    current.attributes = [...new Set(current.attributes)]
    current.labelAttributes = [...new Set(current.labelAttributes)]
    merged.set(tag, current)
  }
  return [...merged.values()]
}
