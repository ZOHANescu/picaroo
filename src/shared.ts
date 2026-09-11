export type AssetKind = 'raster' | 'svg'

export interface Target {
  id: string
  file: string
  line: number
  label: string
  kind: AssetKind
  current: string
  version: string
  editable: boolean
  reason?: string
  shared: boolean
  assetId?: string
  data?: { file: string; pointer: string; consumers?: number }
  canMap?: boolean
  presentation?: 'background' | 'inline-svg' | 'responsive' | 'svg-component'
  selector?: string
  conditions?: { type: 'media' | 'supports'; value: string }[]
  matchUrl?: string
  descriptor?: string
}

export interface AssetUsage {
  file: string
  line: number
  type: 'import' | 'source' | 'style' | 'data'
  pointer?: string
}

export interface LibraryAsset {
  id: string
  file: string
  name: string
  kind: AssetKind
  version: string
  bytes: number
  width?: number
  height?: number
  usages: AssetUsage[]
  canArchive?: boolean
}

export interface DataField {
  file: string
  pointer: string
  value: string
  version: string
}

export interface Change {
  id: string
  label: string
  file: string
  asset: string
  kind: AssetKind
  createdAt: string
  inputBytes: number
  outputBytes: number
  width?: number
  height?: number
  operation?: 'replace' | 'reuse' | 'map' | 'archive'
}

export interface Snapshot {
  project: string
  framework: string
  targets: Target[]
  history: Change[]
  assets: LibraryAsset[]
  fields: DataField[]
  index: { files: number; revision: number; issues: string[] }
  settings: OptimizationProfile
}

export interface VisibleTarget extends Target {
  instances: number
}

export type EditorCommand =
  | { type: 'connect'; editing: boolean; scale: number }
  | { type: 'viewport'; scale: number }
  | { type: 'mode'; editing: boolean }
  | { type: 'select'; id: string }
  | {
      type: 'replace'
      id: string
      file: File
      version: string
      options?: ImageOptions
      requestId?: string
    }
  | { type: 'undo'; id: string }
  | { type: 'thumbnail'; assetId: string; version: string }
  | { type: 'reuse'; id: string; version: string; assetId: string; assetVersion: string }
  | { type: 'import'; file: File }
  | { type: 'map'; id: string; version: string; field: DataField }
  | { type: 'settings'; profile: OptimizationProfile }
  | { type: 'archive'; assetId: string; version: string }
  | {
      type: 'reprocess'
      requestId?: string
      id: string
      version: string
      assetId: string
      assetVersion: string
      options: ImageOptions
    }

export type BridgeEvent =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot; visible: VisibleTarget[]; path: string }
  | { type: 'selected'; id: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'mutation-result'; requestId: string; error?: string }
  | { type: 'notice'; message: string; error?: boolean }
  | { type: 'thumbnail'; assetId: string; version: string; blob: Blob | null }
  | { type: 'upload'; id: string; version: string; file: File }

export interface OptimizationProfile {
  format: 'webp' | 'avif' | 'jpeg' | 'png'
  quality: number
  maxWidth: number
  maxHeight: number
  hashFilenames?: boolean
}

export interface ImageOptions {
  profile?: OptimizationProfile
  ratio?: number
  focusX?: number
  focusY?: number
}

export const DEFAULT_PROFILE: OptimizationProfile = {
  format: 'webp',
  quality: 85,
  maxWidth: 2400,
  maxHeight: 2400,
  hashFilenames: true,
}

export function cropBounds(width: number, height: number, ratio = 0, focusX = 0.5, focusY = 0.5) {
  const cropWidth = ratio > 0 ? Math.max(1, Math.min(width, Math.round(height * ratio))) : width
  const cropHeight = ratio > 0 ? Math.max(1, Math.min(height, Math.round(width / ratio))) : height
  return {
    left: Math.round((width - cropWidth) * focusX),
    top: Math.round((height - cropHeight) * focusY),
    width: Math.max(1, cropWidth),
    height: Math.max(1, cropHeight),
  }
}

export const CHANNEL = 'picaroo:1'
