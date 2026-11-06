import { useMemo, useRef, useState } from 'react'

export type Option = { value: string; label: string; title?: string }

/** Two or three mutually exclusive choices, all visible at once (instead of a native dropdown). */
export function Segmented({ options, value, onChange, label }: {
  options: Option[]; value: string; onChange: (v: string) => void; label?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title ?? o.label}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Number input with its unit inside the box: "$" as a prefix, anything else as a suffix. */
export function NumberField({ value, onChange, unit, changed }: {
  value: string; onChange: (v: string) => void; unit?: string; changed?: boolean
}) {
  const prefix = unit === '$' ? '$' : undefined
  const suffix = unit && unit !== '$' ? unit : undefined
  return (
    <span className={`num-field ${changed ? 'changed' : ''}`}>
      {prefix && <span className="affix">{prefix}</span>}
      <input type="number" step="any" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  )
}

/** Type-to-search list for picking one item out of many (e.g. an operator out of ~120). */
export function SearchPicker({ options, onPick, placeholder }: {
  options: Option[]; onPick: (v: string) => void; placeholder: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? options.filter(o => o.label.toLowerCase().includes(s)) : options).slice(0, 50)
  }, [q, options])

  const pick = (v: string) => { onPick(v); setQ(''); setActive(0); input.current?.blur() }

  return (
    <div className="picker">
      <input ref={input} value={q} placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); pick(matches[active].value) }
          else if (e.key === 'Escape') input.current?.blur()
        }} />
      {open && (
        <ul className="picker-list" role="listbox">
          {matches.length ? matches.map((o, i) => (
            <li key={o.value} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(o.value) }}>
              {o.label}
            </li>
          )) : <li className="none">No match</li>}
        </ul>
      )}
    </div>
  )
}
