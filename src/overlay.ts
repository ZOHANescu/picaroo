import type { BridgeEvent, EditorCommand, Snapshot, VisibleTarget, ImageOptions } from './shared'

declare const PICAROO_CONFIG: { token: string; editorOrigin: string }
const channel = 'picaroo:1'
const maxUploadMb = 30
const maxUpload = maxUploadMb * 1024 * 1024

// No React runtime in the target app. The overlay is isolated from application CSS.
if (window.parent !== window) {
  let active = false
  let editing = true
  let previewScale = 1
  let busy = false
  let selected = ''
  let snapshot: Snapshot = {
    project: '',
    framework: '',
    targets: [],
    history: [],
    assets: [],
    fields: [],
    index: { files: 0, revision: 0, issues: [] },
    settings: {
      format: 'webp',
      quality: 85,
      maxWidth: 2400,
      maxHeight: 2400,
      hashFilenames: true,
    },
  }
  let visible: VisibleTarget[] = []
  let signature = ''
  let refreshing = false
  let refreshAgain = false
  const host = document.createElement('picaroo-overlay')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    * { box-sizing: border-box; }
    .zone { position:fixed; border:1px dashed #53cba3; border-radius:5px; pointer-events:auto; background:transparent; transition:background .15s; }
    .zone:hover,.zone.selected { border:2px solid #28ac7e; background:rgb(57 195 148 / .07); }
    .zone.drag { background:rgb(57 195 148 / .22); border:2px solid #16865f; }
    .zone.blocked { border-color:#ad9f7b; pointer-events:none; }
    button { position:absolute; top:7px; left:7px; max-width:calc(100% - 14px); border:1px solid #b2ecd4; border-radius:5px; background:#edfff7; color:#17563f; padding:calc(5px * var(--zoom, 1)) calc(8px * var(--zoom, 1)); font:600 calc(12px * var(--zoom, 1))/1.4 system-ui,sans-serif; box-shadow:0 2px 8px #0001; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    button:focus-visible { outline:3px solid #17563f; outline-offset:2px; }
    .blocked button { background:#fff9e9; color:#776541; border-color:#e9ddb8; pointer-events:auto; }
  `
  shadow.append(style)
  const boxes = new Map<Element, HTMLDivElement>()

  function send(event: BridgeEvent) {
    window.parent.postMessage({ channel, ...event }, PICAROO_CONFIG.editorOrigin)
  }

  function publish(force = false) {
    const next = JSON.stringify({
      visible,
      history: snapshot.history,
      index: snapshot.index.revision,
      path: location.pathname + location.search,
    })
    if (force || signature !== next) {
      signature = next
      send({ type: 'snapshot', snapshot, visible, path: location.pathname + location.search })
    }
  }

  async function api(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('x-picaroo-token', PICAROO_CONFIG.token)
    const response = await fetch(`/__picaroo/api/${route}`, { ...init, headers })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Picaroo could not complete this change.')
    return data as Snapshot
  }

  async function refresh() {
    if (refreshing) {
      refreshAgain = true
      return
    }
    refreshing = true
    try {
      snapshot = await api('snapshot')
      render()
      publish(true)
    } catch (error) {
      send({
        type: 'notice',
        message: String(error instanceof Error ? error.message : error),
        error: true,
      })
    } finally {
      refreshing = false
      if (refreshAgain) {
        refreshAgain = false
        void refresh()
      }
    }
  }

  async function mutate(action: () => Promise<Snapshot>, message: string, requestId?: string) {
    if (busy) {
      if (requestId)
        send({
          type: 'mutation-result',
          requestId,
          error: 'Another change is still saving. Try again when it finishes.',
        })
      return
    }
    busy = true
    send({ type: 'busy', busy: true })
    try {
      snapshot = await action()
      send({ type: 'notice', message })
      render()
      publish(true)
      if (requestId) send({ type: 'mutation-result', requestId })
    } catch (error) {
      if (requestId)
        send({
          type: 'mutation-result',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        })
      send({
        type: 'notice',
        message: error instanceof Error ? error.message : String(error),
        error: true,
      })
    } finally {
      busy = false
      send({ type: 'busy', busy: false })
    }
  }

  function replace(
    id: string,
    file: File,
    version: string,
    options?: ImageOptions,
    requestId?: string,
  ) {
    if (file.size > maxUpload) {
      const message = `Choose a file up to ${maxUploadMb} MB.`
      send({ type: 'notice', error: true, message })
      if (requestId)
        send({ type: 'mutation-result', requestId, error: message })
      return
    }
    void mutate(
      () =>
        api('replace', {
          method: 'POST',
          body: file,
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-picaroo-target': id,
            'x-picaroo-version': version,
            'x-picaroo-options': JSON.stringify(options ?? {}),
            'x-picaroo-name': encodeURIComponent(file.name),
          },
        }),
      'Image saved to your project. The preview is updating.',
      requestId,
    )
  }

  function select(id: string) {
    selected = id
    send({ type: 'selected', id })
    render()
  }

  function render() {
    if (!active) return
    const placements = new Map<Element, string[]>()
    for (const element of document.querySelectorAll('[data-picaroo-id]')) {
      if (element.parentElement?.closest('[data-picaroo-id]')) continue
      const rendered =
        element.tagName === 'SOURCE' ? element.closest('picture')?.querySelector('img') : element
      if (rendered)
        placements.set(rendered, [
          ...(placements.get(rendered) ?? []),
          ...element.getAttribute('data-picaroo-id')!.split(' '),
        ])
    }
    for (const target of snapshot.targets) {
      if (
        !target.selector ||
        !target.matchUrl ||
        target.conditions?.some((condition) =>
          condition.type === 'media'
            ? !matchMedia(condition.value).matches
            : !CSS.supports(condition.value),
        )
      )
        continue
      try {
        const expected = new URL(target.matchUrl, location.origin).href
        for (const element of document.querySelectorAll(target.selector)) {
          if (
            [
              ...getComputedStyle(element).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g),
            ].some((match) => match[1] === expected)
          )
            placements.set(element, [...(placements.get(element) ?? []), target.id])
        }
      } catch {
        /* Unsupported selectors remain indexed but cannot be selected in this viewport. */
      }
    }
    for (const target of snapshot.targets) {
      if (!target.matchUrl || target.selector) continue
      try {
        const expected = new URL(target.matchUrl, location.origin).href
        for (const element of document.querySelectorAll('img')) {
          const image = element as HTMLImageElement
          if ([image.currentSrc, image.src].includes(expected))
            placements.set(element, [...(placements.get(element) ?? []), target.id])
        }
      } catch {
        /* A malformed runtime URL remains available in the source index only. */
      }
    }
    const elements = [...placements.keys()]
    const targets = new Map(snapshot.targets.map((target) => [target.id, target]))
    const occurrences = new Map<string, number>()
    const existing = new Set(elements)
    for (const [element, box] of boxes) {
      if (
        !existing.has(element) ||
        !editing ||
        !placements.get(element)?.includes(box.dataset.id!)
      ) {
        box.remove()
        boxes.delete(element)
      }
    }
    for (const element of elements) {
      const ids = [...new Set(placements.get(element)!)].filter((id) => targets.has(id))
      const id = ids.includes(selected) ? selected : ids[0]
      const target = targets.get(id)
      const rect = element.getBoundingClientRect()
      if (!target || rect.width < 1 || rect.height < 1) {
        boxes.get(element)?.remove()
        boxes.delete(element)
        continue
      }
      for (const candidate of ids)
        if (targets.has(candidate))
          occurrences.set(candidate, (occurrences.get(candidate) ?? 0) + 1)
      if (!editing) continue
      let box = boxes.get(element)
      if (box && box.dataset.id !== id) {
        box.remove()
        boxes.delete(element)
        box = undefined
      }
      if (!box) {
        box = document.createElement('div')
        box.dataset.id = id
        const button = document.createElement('button')
        button.type = 'button'
        button.addEventListener('click', () => select(id))
        box.append(button)
        box.addEventListener('click', (event) => {
          event.preventDefault()
          select(id)
        })
        box.addEventListener('dragover', (event) => {
          if (
            !event.dataTransfer?.types.includes('Files') ||
            !snapshot.targets.find((item) => item.id === id)?.editable
          )
            return
          event.preventDefault()
          event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
          box!.classList.add('drag')
        })
        box.addEventListener('dragleave', () => box!.classList.remove('drag'))
        box.addEventListener('drop', (event) => {
          event.preventDefault()
          event.stopPropagation()
          box!.classList.remove('drag')
          const files = event.dataTransfer?.files
          if (busy) return
          if (!files?.length) return
          if (files.length !== 1) {
            send({ type: 'notice', error: true, message: 'Drop one image at a time.' })
            return
          }
          select(id)
          const latest = snapshot.targets.find((item) => item.id === id)
          if (latest?.editable)
            send({ type: 'upload', id, version: latest.version, file: files[0] })
        })
        shadow.append(box)
        boxes.set(element, box)
      }
      const button = box.firstElementChild as HTMLButtonElement
      button.textContent = target.editable
        ? `${target.kind === 'svg' ? 'SVG' : 'Photo'}${rect.width * previewScale < 130 ? '' : ' · Drop to replace'}`
        : 'Needs mapping'
      button.setAttribute('aria-label', `Select ${target.label}`)
      button.title = target.reason ?? target.label
      button.style.top = `${Math.max(7, 7 - rect.top)}px`
      box.classList.toggle('selected', selected === id)
      box.classList.toggle('blocked', !target.editable)
      box.classList.add('zone')
      box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:${Math.round(1_000_000 - Math.min(rect.width * rect.height, 999_999))};display:${rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth ? 'none' : 'block'};`
    }
    visible = [...occurrences].map(([id, instances]) => ({ ...targets.get(id)!, instances }))
    publish()
  }

  let scheduled = false
  function schedule() {
    if (scheduled || !active) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      render()
    })
  }
  const observer = new MutationObserver(schedule)
  const resize = new ResizeObserver(schedule)
  window.addEventListener('message', (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.origin !== PICAROO_CONFIG.editorOrigin ||
      event.data?.channel !== channel
    )
      return
    const message = event.data as EditorCommand
    if (message.type === 'connect' || message.type === 'viewport') {
      previewScale = Math.max(0.1, Math.min(1, Number(message.scale) || 1))
      host.style.setProperty('--zoom', String(1 / previewScale))
    }
    if (message.type === 'connect') {
      if (!active) {
        active = true
        document.documentElement.append(host)
        observer.observe(document.body, { subtree: true, childList: true, attributes: true })
        resize.observe(document.body)
      }
      editing = message.editing
      void refresh()
    } else if (message.type === 'viewport') {
      render()
    } else if (message.type === 'mode') {
      editing = message.editing
      render()
    } else if (message.type === 'select') {
      select(message.id)
      const element = [...boxes].find(([, box]) => box.dataset.id === message.id)?.[0]
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } else if (message.type === 'replace' && message.file instanceof File)
      replace(message.id, message.file, message.version, message.options, message.requestId)
    else if (message.type === 'thumbnail') {
      void fetch(
        `/__picaroo/api/thumbnail?id=${encodeURIComponent(message.assetId)}&version=${encodeURIComponent(message.version)}`,
        {
          headers: { 'x-picaroo-token': PICAROO_CONFIG.token },
          signal: AbortSignal.timeout(15000),
        },
      )
        .then(async (response) =>
          send({
            type: 'thumbnail',
            assetId: message.assetId,
            version: message.version,
            blob: response.ok ? await response.blob() : null,
          }),
        )
        .catch(() =>
          send({
            type: 'thumbnail',
            assetId: message.assetId,
            version: message.version,
            blob: null,
          }),
        )
    } else if (message.type === 'import' && message.file instanceof File) {
      void mutate(
        () =>
          api('import', {
            method: 'POST',
            body: message.file,
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-picaroo-name': encodeURIComponent(message.file.name),
            },
          }),
        'Image added to your reusable library.',
      )
    } else if (['reuse', 'map', 'settings', 'archive', 'reprocess'].includes(message.type)) {
      void mutate(
        () =>
          api(message.type, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
          }),
        message.type === 'settings'
          ? 'Optimization defaults saved for this project.'
          : message.type === 'archive'
            ? 'Asset moved to Picaroo trash. Restore it from Change history.'
            : message.type === 'reprocess'
              ? 'Crop saved as a new asset. Undo restores the previous source.'
              : message.type === 'reuse'
                ? 'Library image applied. Your source has been updated.'
                : 'Image linked to the JSON field. Future replacements will edit that field.',
        message.type === 'reprocess' ? message.requestId : undefined,
      )
    } else if (message.type === 'undo')
      void mutate(
        () =>
          api('undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: message.id }),
          }),
        'Source restored. Your previous image is back.',
      )
  })
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  // Prevent accidental browser navigation when a file misses a drop zone in edit mode.
  for (const name of ['dragover', 'drop'])
    document.addEventListener(name, (event) => {
      if (active && editing && (event as DragEvent).dataTransfer?.types.includes('Files'))
        event.preventDefault()
    })
  const interval = window.setInterval(() => {
    if (active) {
      schedule()
      void refresh()
    }
  }, 1800)
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(interval)
      observer.disconnect()
      resize.disconnect()
      host.remove()
    },
    { once: true },
  )
  send({ type: 'ready' })
}
