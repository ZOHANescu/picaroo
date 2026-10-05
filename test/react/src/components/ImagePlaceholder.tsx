interface ImagePlaceholderProps {
  label: string
  src?: string
  'data-picaroo-id'?: string
}

export function ImagePlaceholder({
  label,
  src,
  'data-picaroo-id': picarooId,
}: ImagePlaceholderProps) {
  return (
    <div
      className="image-placeholder"
      role="img"
      aria-label={src ? label : `Empty image slot: ${label}`}
      data-picaroo-id={picarooId}
    >
      {src ? <img src={src} alt="" data-picaroo-id={picarooId} /> : <span>{label}</span>}
    </div>
  )
}

export function MediaSlot({
  label,
  src,
  'data-picaroo-id': picarooId,
}: ImagePlaceholderProps) {
  return (
    <div className="image-placeholder" data-picaroo-id={picarooId}>
      {src ? <img src={src} alt={label} data-picaroo-id={picarooId} /> : label}
    </div>
  )
}
