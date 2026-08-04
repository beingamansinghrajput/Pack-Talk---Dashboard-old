import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'

const EMPTY = { client_link: '', raw_uid: '', sting: '', project_note: '' }

function randomClientFacingId() {
  // 15-digit random numeric string, first digit non-zero
  let out = String(Math.floor(Math.random() * 9) + 1)
  for (let i = 0; i < 14; i++) {
    out += String(Math.floor(Math.random() * 10))
  }
  return out
}

function buildFinalLink(template, clientFacingId) {
  try {
    const url = new URL(template)
    url.searchParams.set('uid', clientFacingId)
    return url.toString()
  } catch {
    // Template isn't a full valid URL on its own — fall back to a
    // straightforward text replace on the uid= param.
    if (/[?&]uid=/.test(template)) {
      return template.replace(/([?&]uid=)[^&]*/, `$1${clientFacingId}`)
    }
    const sep = template.includes('?') ? '&' : '?'
    return `${template}${sep}uid=${clientFacingId}`
  }
}

export default function LinkGenerator() {
  const { user, canAccessOpsPages } = useAuth()

  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const [entries, setEntries] = useState([])
  const [entriesLoading, setEntriesLoading] = useState(false)

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    setEntriesLoading(true)
    let q = supabase
      .from('client_link_entries')
      .select('id, client_facing_id, sting, raw_uid, project_note, created_at, created_by, profiles:created_by(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!canAccessOpsPages) q = q.eq('created_by', user.id)
    const { data } = await q
    setEntries(data || [])
    setEntriesLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage(null)
    setResult(null)

    const link = form.client_link.trim()
    const rawUid = form.raw_uid.trim()
    const sting = form.sting.trim().toUpperCase()

    if (!link) {
      setMessage({ type: 'error', text: "Paste the client's survey link first." })
      return
    }
    if (!rawUid) {
      setMessage({ type: 'error', text: 'Enter the UID / random letters.' })
      return
    }
    if (!sting) {
      setMessage({ type: 'error', text: 'Enter the sting.' })
      return
    }

    setBusy(true)

    // Try a few times in case of a random collision on the unique client_facing_id.
    let saved = null
    let lastErr = null
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      const clientFacingId = randomClientFacingId()
      const finalLink = buildFinalLink(link, clientFacingId)
      const { data, error } = await supabase
        .from('client_link_entries')
        .insert({
          project_note: form.project_note.trim() || null,
          raw_uid: rawUid,
          sting,
          client_facing_id: clientFacingId,
          final_link: finalLink,
          created_by: user.id,
        })
        .select()
        .single()
      if (!error) {
        saved = data
      } else {
        lastErr = error
      }
    }

    setBusy(false)
    if (!saved) {
      setMessage({ type: 'error', text: lastErr?.message || 'Could not generate a link — try again.' })
      return
    }
    setResult(saved)
    setForm(EMPTY)
    loadEntries()
  }

  function copyResult() {
    if (!result) return
    navigator.clipboard.writeText(result.final_link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="page">
      <Reveal>
        <div className="page-header">
          <div>
            <h1>Link Generator</h1>
            <p className="page-sub">Paste the client's link and generate the version we actually send out — the client only ever sees a random ID, never the raw UID.</p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={40}>
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 className="card-title">Generate a Link</h2>
          <form onSubmit={handleSubmit} className="form-grid">
            <label>Client's Survey Link
              <input
                required
                value={form.client_link}
                onChange={(e) => setForm({ ...form, client_link: e.target.value })}
                placeholder="https://client-domain.com/survey?p=...&uid=xxxx"
              />
            </label>
            <label>UID / Random Letters
              <input
                required
                value={form.raw_uid}
                onChange={(e) => setForm({ ...form, raw_uid: e.target.value })}
                placeholder="e.g. euwfgwehfvehfvejfv"
              />
            </label>
            <label>Sting
              <input
                required
                value={form.sting}
                onChange={(e) => setForm({ ...form, sting: e.target.value })}
                placeholder="e.g. AS01"
              />
            </label>
            <label>Project / Client Note (optional)
              <input
                value={form.project_note}
                onChange={(e) => setForm({ ...form, project_note: e.target.value })}
                placeholder="For your own reference in the list below"
              />
            </label>
            {message && <div className={message.type === 'error' ? 'auth-error' : 'auth-success'}>{message.text}</div>}
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Generating…' : 'Generate Link'}</button>
          </form>

          {result && (
            <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: 'rgba(124, 92, 252, 0.08)', border: '1px solid rgba(124, 92, 252, 0.25)' }}>
              <div className="card-hint" style={{ marginBottom: 6 }}>
                Client-facing ID: <code>{result.client_facing_id}</code> — internally logged as <code>{result.raw_uid}{result.sting}</code>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{result.final_link}</code>
                <button className="btn-ghost" onClick={copyResult} type="button">
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="card-hint" style={{ marginTop: 8 }}>
                Copy this link and paste it into the project's Survey Link field when you create or edit the project.
              </div>
            </div>
          )}
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="card">
          <div className="card-title">
            {canAccessOpsPages ? 'Recent Links' : 'Your Recent Links'}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client-facing ID</th>
                  {canAccessOpsPages && <th>Raw UID</th>}
                  <th>Sting</th>
                  <th>Note</th>
                  {canAccessOpsPages && <th>By</th>}
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {entriesLoading && (
                  <tr><td colSpan={canAccessOpsPages ? 6 : 4} className="page-loading">Loading…</td></tr>
                )}
                {!entriesLoading && entries.length === 0 && (
                  <tr><td colSpan={canAccessOpsPages ? 6 : 4} className="card-hint">No links generated yet.</td></tr>
                )}
                {!entriesLoading && entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.client_facing_id}</td>
                    {canAccessOpsPages && <td>{e.raw_uid}</td>}
                    <td>{e.sting}</td>
                    <td>{e.project_note || '—'}</td>
                    {canAccessOpsPages && <td>{e.profiles?.full_name || e.profiles?.email || '—'}</td>}
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>
    </div>
  )
}
