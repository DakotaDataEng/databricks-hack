import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type GenieAnswer, type GenieInfo, type MapContext } from '../api'
import { int } from '../format'
import { DataTable, type Column } from './DataTable'

type Message =
  | { role: 'user'; text: string; withContext: boolean }
  | { role: 'genie'; answer: GenieAnswer }
  | { role: 'error'; text: string }

type Props = {
  open: boolean
  onClose: () => void
  context: MapContext
  onClearWells: () => void
  prefill: string | null
  onPrefillUsed: () => void
}

// Tiny, safe markdown: paragraphs, "- " bullets, **bold** and `code`. Everything renders as React text.
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code>
        : part)
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>)
    bullets = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const bullet = line.match(/^([-*]|\d+\.)\s+(.*)$/)
    if (bullet) { bullets.push(bullet[2]); continue }
    flush()
    if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>)
  }
  flush()
  return <div className="md">{blocks}</div>
}

// Genie returns raw SQL column names (liq_m3km_saved, fitted_annual_decline); make them readable.
const UNITS: [RegExp, string][] = [
  [/\bboe d\b/g, 'boe/d'], [/\bbbl d\b/g, 'bbl/d'], [/\bmmcf d\b/g, 'MMcf/d'], [/\be3m3km\b/g, 'e³m³·km'],
  [/\bm3km\b/g, 'm³·km'], [/\be3m3\b/g, 'e³m³'], [/\bm3\b/g, 'm³'], [/\s*\b(pct|percent)\b/g, ''], [/\bbaid\b/g, 'BA ID'],
  [/\bid\b/g, 'ID'], [/\bliq\b/g, 'liquids'], [/\bcnrl\b/g, 'CNRL'], [/\bnpv\b/g, 'NPV'], [/\broce\b/g, 'ROCE'],
  [/\balberta\b/g, 'Alberta'], [/\baeco\b/g, 'AECO'], [/\bwti\b/g, 'WTI'], [/\bwcs\b/g, 'WCS'],
]
function humanize(col: string) {
  let s = col.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [re, to] of UNITS) s = s.replace(re, to)
  return s.charAt(0).toUpperCase() + s.slice(1)
}
// Columns named *_pct are already percentages; shares, declines and rates otherwise come back as fractions.
const isPct = (col: string) => /(^|_)(pct|percent)(_|$)/i.test(col)
const isRatio = (col: string) => /(share|decline|ratio|rate|margin|retention|roce|fraction)/i.test(col)

function fmtCell(v: string | null, col: string) {
  if (v == null || v === '') return '–'
  const n = Number(v)
  if (!Number.isFinite(n) || /^0\d/.test(v.trim()) || /^\d{4}-\d{2}/.test(v)) return v  // text, codes with leading zeros, dates
  if (isPct(col)) return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
  if (isRatio(col) && Math.abs(n) <= 1.5) return `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
  return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 10 ? 1 : 2 })
}

function ResultTable({ a }: { a: GenieAnswer }) {
  // One row reads better as a short list of label: value than as a wide table with a scrollbar.
  if (a.rows.length === 1) {
    return (
      <dl className="genie-kv">
        {a.columns.map((c, j) => (
          <div key={c} title={c}><dt>{humanize(c)}</dt><dd>{fmtCell(a.rows[0][j], c)}</dd></div>
        ))}
      </dl>
    )
  }
  type Row = Record<string, string | null> & { __i: string }
  const rows: Row[] = a.rows.map((r, i) => ({ ...Object.fromEntries(a.columns.map((c, j) => [c, r[j]])), __i: String(i) }) as Row)
  const cols: Column<Row>[] = a.columns.map(c => ({
    key: c, label: humanize(c), title: c,
    // Right-align only truly numeric columns (IDs like "0HE9" mixed with "1234" stay left).
    align: rows.every(r => r[c] == null || (Number.isFinite(Number(r[c])) && !/^0\d/.test(String(r[c])))) ? 'right' : 'left',
    format: v => fmtCell(v as string | null, c),
  }))
  return <DataTable columns={cols} rows={rows} rowKey={r => r.__i} csvName="genie-result" maxRows={50} />
}

function contextSummary(c: MapContext) {
  const parts: string[] = []
  if (c.cnrl_facility_ids.length) parts.push(`${int(c.cnrl_facility_ids.length)} CNRL assets`)
  if (c.competitor_operators.length) parts.push(`${int(c.competitor_operators.length)} nearby operators`)
  if (c.focused_facility) parts.push(`facility ${c.focused_facility.name ?? c.focused_facility.id}`)
  if (c.well_ids.length) parts.push(`${int(c.well_ids.length)} wells`)
  if (c.focused_operator) parts.push(`operator ${c.focused_operator.name}`)
  return parts
}

export function GeniePanel({ open, onClose, context, onClearWells, prefill, onPrefillUsed }: Props) {
  const [info, setInfo] = useState<GenieInfo | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversation, setConversation] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [useContext, setUseContext] = useState(true)
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const lastQuestionRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { api.genieInfo().then(setInfo).catch(() => setInfo(null)) }, [])
  // While Genie works, show the "working" line; when the answer lands, bring the question back to the top so the
  // answer is read from its start rather than from its last follow-up button.
  useEffect(() => {
    if (busy) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    else lastQuestionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [messages, busy])
  const lastUser = messages.map(m => m.role).lastIndexOf('user')
  useEffect(() => {
    if (prefill) { setInput(prefill); onPrefillUsed(); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [prefill, onPrefillUsed])

  const summary = contextSummary(context)
  const attach = useContext && summary.length > 0

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: q, withContext: attach }])
    setBusy(true)
    try {
      const answer = await api.genieAsk(q, conversation, attach ? context : null)
      setConversation(answer.conversation_id)
      setMessages(m => [...m, { role: 'genie', answer }])
    } catch (e) {
      setMessages(m => [...m, { role: 'error', text: String(e) }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <aside className="genie">
      <header className="genie-head">
        <div className="genie-title">
          <h2>Ask Genie</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close Genie" title="Close">✕</button>
        </div>
        <p className="muted small-text">Ask about production, operators, wells and deals in plain English. Answers come from the Petrinex data.</p>
        <div className="genie-actions">
          <button className="link-btn" onClick={() => { setMessages([]); setConversation(null) }} disabled={!messages.length}>New chat</button>
          {info?.url && <a className="link-btn" href={info.url} target="_blank" rel="noreferrer">Open in Databricks ↗</a>}
        </div>
      </header>

      <div className={`genie-context ${attach ? 'on' : ''}`}>
        <label>
          <input type="checkbox" checked={useContext} onChange={e => setUseContext(e.target.checked)} disabled={!summary.length} />
          Attach map context
        </label>
        {summary.length ? (
          <div className="ctx-chips">
            {summary.map(s => <span key={s} className="ctx-chip">{s}</span>)}
            {context.well_ids.length > 0 && <button className="btn ghost small" onClick={onClearWells}>Clear wells</button>}
          </div>
        ) : (
          <p className="muted small-text">Nothing selected. Lasso CNRL assets, click a facility or tick its wells on the map, and they'll be sent to Genie as context.</p>
        )}
      </div>

      <div className="genie-thread">
        {!messages.length && (
          <div className="genie-empty">
            <p className="muted">Ask anything about Alberta production, operators, wells, emissions, prices or CNRL's acquisition picture. Try:</p>
            {(info?.sample_questions ?? []).map(q => (
              <button key={q} className="suggest" onClick={() => send(q)}>{q}</button>
            ))}
            {summary.length > 0 && (
              <button className="suggest ctx" onClick={() => send('Summarize the production of the selected assets and the nearby competitors.')}>
                Summarize the production of the selected assets and the nearby competitors
              </button>
            )}
          </div>
        )}
        {messages.map((m, i) => m.role === 'user' ? (
          <div key={i} className="msg user" ref={i === lastUser ? lastQuestionRef : undefined}>
            <div className="bubble">{m.text}</div>
            {m.withContext && <div className="muted small-text">with your map selection</div>}
          </div>
        ) : m.role === 'error' ? (
          <div key={i} className="msg error-msg">
            <b>Genie couldn’t answer that.</b> <span>{m.text.replace(/^Error:\s*/, '')}</span>
            {i === messages.length - 1 && lastUser >= 0 && (
              <button className="btn small" onClick={() => {
                const q = messages[lastUser]
                if (q.role === 'user') { setMessages(ms => ms.slice(0, lastUser)); send(q.text) }
              }}>Try again</button>
            )}
          </div>
        ) : (
          <div key={i} className="msg genie-msg">
            {m.answer.error && <p className="error">{m.answer.error}</p>}
            {m.answer.text && <Markdown text={m.answer.text} />}
            {m.answer.columns.length > 0 && (
              <>
                {m.answer.row_count > m.answer.rows.length && (
                  <div className="muted small-text">Query returned {int(m.answer.row_count)} rows; the first {m.answer.rows.length} are shown.</div>
                )}
                <ResultTable a={m.answer} />
              </>
            )}
            {m.answer.sql && (
              <details className="sql">
                <summary>How Genie got this (SQL)</summary>
                {m.answer.sql_description && <p className="muted small-text">{m.answer.sql_description}</p>}
                <pre>{m.answer.sql}</pre>
              </details>
            )}
            {m.answer.suggested_questions.length > 0 && i === messages.length - 1 && (
              <div className="follow-ups">
                <span className="follow-label">Ask next</span>
                {m.answer.suggested_questions.slice(0, 3).map(q => <button key={q} className="suggest small" onClick={() => send(q)}>{q}</button>)}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg genie-msg thinking"><span className="spinner" />Genie is working on it. This usually takes 10–60 seconds.</div>}
        <div ref={endRef} />
      </div>

      <form className="genie-input" onSubmit={e => { e.preventDefault(); send(input) }}>
        <textarea
          ref={inputRef}
          value={input}
          placeholder={attach ? 'Ask about your selection, e.g. “Which of these operators is growing fastest?”' : 'Ask a question about the data…'}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
          rows={2}
          disabled={!info?.space_id}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim() || !info?.space_id}>Ask</button>
      </form>
    </aside>
  )
}
