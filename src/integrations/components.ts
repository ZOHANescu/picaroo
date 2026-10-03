export interface PicarooManifest {
  picaroo?: {
    components?: unknown
  }
}

const componentName = /^[A-Za-z_$][\w$]*$/

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
