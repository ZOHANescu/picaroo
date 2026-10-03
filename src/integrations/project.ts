import { access } from 'node:fs/promises'
import path from 'node:path'

export type ProjectFramework = 'angular' | 'react' | 'html'

export interface ProjectIntegration {
  id: ProjectFramework
  label: string
  assetDirectory: string
}

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface IntegrationDetector {
  id: ProjectFramework
  label: string
  matches(dependencies: Record<string, string>): boolean
  assetDirectory(root: string): Promise<string>
}

const publicAssets = async () => 'public/picaroo'

const detectors: IntegrationDetector[] = [
  {
    id: 'angular',
    label: 'Angular',
    matches: (dependencies) => '@angular/core' in dependencies,
    assetDirectory: async (root) =>
      (await exists(path.join(root, 'src/assets'))) ? 'src/assets/picaroo' : 'public/picaroo',
  },
  {
    id: 'react',
    label: 'React',
    matches: (dependencies) => 'react' in dependencies,
    assetDirectory: publicAssets,
  },
  {
    id: 'html',
    label: 'HTML',
    matches: () => true,
    assetDirectory: publicAssets,
  },
]

export async function detectProjectIntegration(
  root: string,
  manifest: PackageManifest,
): Promise<ProjectIntegration> {
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  const detector = detectors.find((candidate) => candidate.matches(dependencies))!
  return {
    id: detector.id,
    label: detector.label,
    assetDirectory: await detector.assetDirectory(root),
  }
}

export function reactProjectIntegration(): ProjectIntegration {
  return { id: 'react', label: 'React + Vite', assetDirectory: 'public/picaroo' }
}

async function exists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  )
}
