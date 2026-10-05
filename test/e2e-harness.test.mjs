import assert from 'node:assert/strict'
import test from 'node:test'
import {
  errorResult,
  formatStabilityReport,
  isStable,
  normalizeDiscoveryResult,
} from './e2e-report.mjs'
import { frameworks, resolveSuite } from './e2e-suites.mjs'

test('uses isolated default ports for every framework service', () => {
  const ports = frameworks.flatMap((framework) => {
    const suite = resolveSuite(framework, {})
    return [suite.appPort, suite.editorPort, suite.previewPort]
  })
  assert.equal(new Set(ports).size, ports.length)
})

test('validates port overrides before starting a suite', () => {
  assert.throws(
    () => resolveSuite('html', { PICAROO_TEST_HTML_PORT: 'not-a-port' }),
    /PICAROO_TEST_HTML_PORT must be an integer/,
  )
  assert.throws(
    () => resolveSuite('react', { PICAROO_TEST_REACT_PORT: '4502' }),
    /ports must be different/,
  )
})

test('reports stability only when every framework succeeds', () => {
  const results = frameworks.map((framework) =>
    normalizeDiscoveryResult(framework, { exitCode: 0 }, {
      framework: resolveSuite(framework, {}).name,
      expected: 10,
      found: 10,
      result: 'SUCCESS',
    }),
  )
  assert.equal(isStable(results, frameworks), true)
  results[2] = { ...results[2], found: 8, result: 'FAILED', exitCode: 1 }
  assert.equal(isStable(results, frameworks), false)
  assert.match(formatStabilityReport(results, false), /PICAROO STABILITY: FAILED/)
})

test('distinguishes a missing or invalid result from a discovery failure', () => {
  const result = errorResult('angular', { exitCode: 1 }, new Error('result file missing'))
  assert.equal(result.result, 'ERROR')
  assert.match(formatStabilityReport([result], false), /result file missing/)
  assert.throws(
    () => normalizeDiscoveryResult('html', { exitCode: 0 }, { result: 'SUCCESS' }),
    /framework must be a non-empty string/,
  )
})
