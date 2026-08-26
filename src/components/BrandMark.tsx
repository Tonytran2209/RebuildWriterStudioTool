interface Props { className?: string }

export default function BrandMark({ className = "h-5 w-5" }: Props) {
  return <img src="/f-trademark.svg" alt="" aria-hidden="true" className={`brand-mark ${className}`} />
}
