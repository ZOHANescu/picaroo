const definitions = {
  html: { name: 'HTML', appPort: 4401, editorPort: 4501, previewPort: 4601 },
  react: { name: 'React', appPort: 4402, editorPort: 4502, previewPort: 4602 },
  angular: { name: 'Angular', appPort: 4403, editorPort: 4503, previewPort: 4603 },
}

export const frameworks = Object.freeze(Object.keys(definitions))
export const suites = Object.freeze(definitions)

function readPort(value, fallback, variable) {
  if (value === undefined) return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`${variable} must be an integer between 1 and 65535; received "${value}".`)
  return port
}

export function resolveSuite(framework, environment = process.env) {
  const definition = suites[framework]
  if (!definition)
    throw new Error(`Unknown E2E framework "${framework}". Choose: ${frameworks.join(', ')}.`)

  const prefix = `PICAROO_TEST_${framework.toUpperCase()}`
  const variables = {
    app: `${prefix}_PORT`,
    editor: `${prefix}_EDITOR_PORT`,
    preview: `${prefix}_PREVIEW_PORT`,
  }
  const resolved = {
    ...definition,
    appPort: readPort(environment[variables.app], definition.appPort, variables.app),
    editorPort: readPort(environment[variables.editor], definition.editorPort, variables.editor),
    previewPort: readPort(environment[variables.preview], definition.previewPort, variables.preview),
    variables,
  }
  const ports = [resolved.appPort, resolved.editorPort, resolved.previewPort]
  if (new Set(ports).size !== ports.length)
    throw new Error(`${definition.name} app, editor, and preview ports must be different.`)
  return resolved
}
