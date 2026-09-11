import { useState } from 'react'
import type { DataField } from '../shared'

export function DataMapping({
  fields,
  busy,
  onMap,
}: {
  fields: DataField[]
  busy: boolean
  onMap: (field: DataField) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const candidates = fields.filter(
    (field) => !field.value || /\.(png|jpe?g|webp|avif|svg)(?:[?#].*)?$/i.test(field.value),
  )
  const matches = candidates.filter((field) =>
    `${field.file} ${field.pointer}`.toLowerCase().includes(query.toLowerCase()),
  )
  const key = (field: DataField) => JSON.stringify([field.file, field.pointer])
  const chosen = matches.find((field) => key(field) === selected)
  return (
    <details className="data-mapping">
      <summary>Link to a JSON field</summary>
      <p>
        Choose an existing image URL or empty string. Linking updates this slot’s source; future
        replacements edit the JSON field.
      </p>
      <input
        aria-label="Search JSON fields"
        placeholder="Search file or field…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected('')
        }}
      />
      <select
        aria-label="JSON image field"
        value={chosen ? selected : ''}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">Choose a field</option>
        {matches.slice(0, 300).map((field) => (
          <option key={key(field)} value={key(field)}>
            {field.file} #{field.pointer || '/'}
          </option>
        ))}
      </select>
      {chosen && <code className="source-file">{chosen.value || '(empty image field)'}</code>}
      {!matches.length && (
        <p>
          No matching image fields. Add an empty string field to a local JSON file to make it
          available here.
        </p>
      )}
      <button
        className="secondary-action"
        disabled={!chosen || busy}
        onClick={() => {
          if (chosen) onMap(chosen)
        }}
      >
        Link this field
      </button>
    </details>
  )
}
