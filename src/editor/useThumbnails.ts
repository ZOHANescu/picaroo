import { useCallback, useEffect, useRef, useState } from 'react'
import type { BridgeEvent, EditorCommand } from '../shared'

export const assetKey = (id: string, version: string) => `${id}:${version}`

export function useThumbnails(send: (command: EditorCommand) => void) {
  const cache = useRef(new Map<string, string | null>())
  const pending = useRef(new Set<string>())
  const [previews, setPreviews] = useState<Record<string, string | null>>({})
  const [generation, setGeneration] = useState(0)
  const reconnect = useCallback(() => {
    pending.current.clear()
    for (const [key, url] of cache.current) if (!url) cache.current.delete(key)
    setPreviews(Object.fromEntries(cache.current))
    setGeneration((value) => value + 1)
  }, [])
  const request = useCallback(
    (id: string, version: string) => {
      const key = assetKey(id, version)
      if (cache.current.has(key) || pending.current.has(key)) return
      pending.current.add(key)
      send({ type: 'thumbnail', assetId: id, version })
    },
    [send],
  )
  const receive = useCallback((message: Extract<BridgeEvent, { type: 'thumbnail' }>) => {
    const key = assetKey(message.assetId, message.version)
    if (!pending.current.delete(key) || cache.current.has(key)) return
    const url = message.blob ? URL.createObjectURL(message.blob) : null
    if (cache.current.size >= 160) {
      const oldest = cache.current.keys().next().value!
      const previous = cache.current.get(oldest)
      if (previous) URL.revokeObjectURL(previous)
      cache.current.delete(oldest)
    }
    cache.current.set(key, url)
    setPreviews(Object.fromEntries(cache.current))
  }, [])
  useEffect(() => {
    const urls = cache.current
    const requests = pending.current
    return () => {
      for (const url of urls.values()) if (url) URL.revokeObjectURL(url)
      urls.clear()
      requests.clear()
    }
  }, [])
  return { previews, request, receive, reconnect, generation }
}

export type ThumbnailState = ReturnType<typeof useThumbnails>
