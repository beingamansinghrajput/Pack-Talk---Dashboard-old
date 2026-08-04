import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'

const EMPTY = {
  client_link: '',
  raw_uid: '',
  project_id: '',
  project_name: '',
  description: '',
  country: '',
  req_completes: '',
  max_completes: '',
  loi: '',
  ir: '',
  launch_date: '',
}

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
      .select('id, client_facing_id, raw_uid, project_id, created_at, created_by, profiles:created_by(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!canAccessOpsPages) q = q.eq('created_by', user.id)
    const { data } = await q
    setEntries(data || [])
    setEntriesLoading(false)
  }

  async function getUniqueClientFacingId() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomClientFacingId()
      const { data } = await supabase
        .from('client_link_entries')
        .select('id')
        .eq('client_facing_id', candidate)
        .maybeSingle()
      if (!data) return candidate
    }
    throw new Error('Could not generate a unique ID — try again.')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage(null)
    setResult(null)

    const clientLink = form.client_link.trim()
    const rawUid = form.raw_uid.trim()

    if (!clientLink) {
      setMessage({ type: 'error', text: "Paste the client's survey link first." })
      return
    }
    if (!rawUid) {
      setMessage({ type: 'error', text: 'Enter the UID / random letters.' })
      return
    }
    if (!form.project_id.trim() || !form.project_name.trim() || !form.country.trim()) {
      setMessage({ type: 'error', text: 'Project ID, Project Name, and Country are required.' })
      return
    }

    setBusy(true)
    try {
      const clientFacingId = await getUniqueClientFacingId()
      const finalLink = buildFinalLink(clientLink, clientFacingId)

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          project_id: form.project_id.trim(),
          project_name: form.project_name.trim(),
          description: form.description.trim() || null,
          country: form.country.trim(),
          req_completes: Number(form.req_completes) || 0,
          max_completes: Number(form.max_completes) || Number(form.req_completes) || 0,
          loi: Number(form.loi) || 0,
          ir: Number(form.ir) || 0,
          launch_date: form.launch_date || new Date().toISOString().slice(0, 10),
          survey_link: finalLink,
          created_by: user.id,
        })
        .select()
        .single()

      if (projectError) throw projectError

      const { data: entry, error: entryError } = await supabase
        .from('client_link_entries')
        .insert({
          project_id: project.project_id,
          raw_uid: rawUid,
          client_facing_id: clientFacingId,
          final_link: finalLink,
          created_by: user.id,
        })
        .select()
        .single()

      if (entryError) throw entryError

      setResult(entry)
      setForm(EMPTY)
      loadEntries()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setBusy(false)
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
            <p className="page-sub">Add a new survey using the client's link — the client only ever sees a random ID, never the raw UID.</p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={40}>
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 className="card-title">New Survey</h2>
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
            <label>Project ID
              <input required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} />
            </label>
            <label>Project Name
              <input required value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>Description
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief background on this survey — target audience, objective, and so on."
                rows={3}
              />
            </label>
            <label>Country
              <input required value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </label>
            <label>Req Completes
              <input type="number" value={form.req_completes} onChange={(e) => setForm({ ...form, req_completes: e.target.value })} />
            </label>
            <label>Max Completes
              <input type="number" value={form.max_completes} onChange={(e) => setForm({ ...form, max_completes: e.target.value })} placeholder="Defaults to Req Completes if left blank" />
            </label>
            <label>LOI (min)
              <input type="number" value={form.loi} onChange={(e) => setForm({ ...form, loi: e.target.value })} />
            </label>
            <label>IR (%)
              <input type="number" value={form.ir} onChange={(e) => setForm({ ...form, ir: e.target.value })} />
            </label>
            <label>Launch Date
              <input type="date" value={form.launch_date} onChange={(e) => setForm({ ...form, launch_date: e.target.value })} />
            </label>
            {message && <div className={message.type === 'error' ? 'auth-error' : 'auth-success'}>{message.text}</div>}
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Survey'}</button>
          </form>

          {result && (
            <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: 'rgba(124, 92, 252, 0.08)', border: '1px solid rgba(124, 92, 252, 0.25)' }}>
              <div className="card-hint" style={{ marginBottom: 6 }}>
                Survey created. Client-facing ID: <code>{result.client_facing_id}</code>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{result.final_link}</code>
                <button className="btn-ghost" onClick={copyResult} type="button">
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="card-hint" style={{ marginTop: 8 }}>
                This is already saved as the project's Survey Link — nothing else to do.
              </div>
            </div>
          )}
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="card">
          <div className="card-title">
            {canAccessOpsPages ? 'Recently Generated' : 'Your Recently Generated'}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client-facing ID</th>
                  {canAccessOpsPages && <th>Raw UID</th>}
                  {canAccessOpsPages && <th>By</th>}
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {entriesLoading && (
                  <tr><td colSpan={canAccessOpsPages ? 5 : 3} className="page-loading">Loading…</td></tr>
                )}
                {!entriesLoading && entries.length === 0 && (
                  <tr><td colSpan={canAccessOpsPages ? 5 : 3} className="card-hint">No surveys created yet.</td></tr>
                )}
                {!entriesLoading && entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.project_id}</td>
                    <td>{e.client_facing_id}</td>
                    {canAccessOpsPages && <td>{e.raw_uid}</td>}
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
