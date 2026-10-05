function assertCount(value, field) {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`Discovery result ${field} must be a non-negative integer.`)
}

export function normalizeDiscoveryResult(framework, execution, payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Discovery result must be an object.')
  if (typeof payload.framework !== 'string' || payload.framework.length === 0)
    throw new Error('Discovery result framework must be a non-empty string.')
  assertCount(payload.expected, 'expected')
  assertCount(payload.found, 'found')
  if (!['SUCCESS', 'FAILED'].includes(payload.result))
    throw new Error('Discovery result status must be SUCCESS or FAILED.')

  return {
    framework: payload.framework,
    expected: payload.expected,
    found: payload.found,
    result: execution.exitCode === 0 ? payload.result : 'FAILED',
    exitCode: execution.exitCode,
    key: framework,
  }
}

export function errorResult(framework, execution, error) {
  return {
    framework: framework[0].toUpperCase() + framework.slice(1),
    expected: '—',
    found: '—',
    result: 'ERROR',
    exitCode: execution.exitCode,
    error: execution.error?.message ?? (error instanceof Error ? error.message : String(error)),
    key: framework,
  }
}

export function isStable(results, expectedFrameworks) {
  return (
    results.length === expectedFrameworks.length &&
    expectedFrameworks.every((framework) => {
      const result = results.find((candidate) => candidate.key === framework)
      return result?.result === 'SUCCESS' && result.exitCode === 0
    })
  )
}

export function formatStabilityReport(results, stable) {
  const lines = [
    '='.repeat(72),
    'PICAROO IMAGE DISCOVERY STABILITY',
    '='.repeat(72),
    'Framework  Expected  Found  Result',
  ]
  for (const result of results) {
    lines.push(
      `${result.framework.padEnd(10)} ${String(result.expected).padStart(8)}  ${String(result.found).padStart(5)}  ${result.result}`,
    )
    if (result.error) lines.push(`           ${result.error}`)
  }
  lines.push('-'.repeat(72), `PICAROO STABILITY: ${stable ? 'SUCCESS' : 'FAILED'}`)
  return lines.join('\n')
}
