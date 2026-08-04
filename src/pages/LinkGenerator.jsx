import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'

const ENTRY_BASE = 'https://pack-talk-dashboard.vercel.app/api/enter'

const EMPTY = {
  client_link: '',
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

function generateEntryToken() {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function LinkGenerator() {
  const { user, canAccessOpsPages } = useAuth()

  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [copiedRowId, setCopiedRowId] = useState(null)

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setProjectsLoading(true)
    let q = supabase
      .from('projects')
      .select('id, project_id, project_name, country, survey_link, entry_token, created_at, created_by, profiles:created_by(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!canAccessOpsPages) q = q.eq('created_by', user.id)
    const { data } = await q
    setProjects(data || [])
    setProjectsLoading(false)
  }

  async function getUniqueEntryToken() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateEntryToken()
      const { data } = await supabase
        .from('projects')
        .select('id')
        .eq('entry_token', candidate)
        .maybeSingle()
      if (!data) return candidate
    }
    throw new Error('Could not generate a unique entry link — try again.')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage(null)
    setResult(null)

    const clientLink = form.client_link.trim()

    if (!clientLink) {
      setMessage({ type: 'error', text: "Paste the client's survey link first, exactly as they gave it to you (including their uid placeholder)." })
      return
    }
    if (!form.project_id.trim() || !form.project_name.trim() || !form.country.trim()) {
      setMessage({ type: 'error', text: 'Project ID, Project Name, and Country are required.' })
      return
    }

    setBusy(true)
    try {
      const entryToken = await getUniqueEntryToken()

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
          // Saved exactly as the client gave it — including their own uid
          // placeholder. Nothing is substituted here; a fresh ID gets
          // generated per real respondent at click-through time instead,
          // by api/enter/[token].js.
          survey_link: clientLink,
          entry_token: entryToken,
          created_by: user.id,
        })
        .select()
        .single()

      if (projectError) throw projectError

      setResult(project)
      setForm(EMPTY)
      loadProjects()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setBusy(false)
  }

  function entryLinkFor(entry_token) {
    return `${ENTRY_BASE}/${entry_token}`
  }

  function copyResult() {
    if (!result) return
    navigator.clipboard.writeText(entryLinkFor(result.entry_token))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function copyRowLink(id, entry_token) {
    navigator.clipboard.writeText(entryLinkFor(entry_token))
    setCopiedRowId(id)
    setTimeout(() => setCopiedRowId(null), 1500)
  }

  return (
    <div className="page">
      <Reveal>
        <div className="page-header">
          <div>
            <h1>Link Generator</h1>
            <p className="page-sub">
              Add a new survey using the client's link. Post the resulting entry link to our own panel — every respondent
              who clicks it gets their own fresh, random ID automatically, and the link itself never reveals our internal
              Project ID.
            </p>
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
            <p className="card-hint" style={{ gridColumn: '1 / -1', marginTop: -6 }}>
              Paste it exactly as the client sent it, including their own uid placeholder (e.g. <code>xxxx</code>) — don't
              replace it with anything, our system fills in a real one per respondent automatically later.
            </p>
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
                Survey created. Post this link to our own panel — it's stable and reusable, the same one for every respondent:
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{entryLinkFor(result.entry_token)}</code>
                <button className="btn-ghost" onClick={copyResult} type="button">
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="card-hint" style={{ marginTop: 8 }}>
                Each person who clicks it gets sent to the client's real survey with their own fresh, randomly generated ID —
                you never need to generate or handle that number yourself, and the link never reveals the Project ID.
              </div>
            </div>
          )}
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="card">
          <div className="card-title">
            {canAccessOpsPages ? 'Recently Generated Surveys' : 'Your Recently Generated Surveys'}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Country</th>
                  <th>Entry Link (for our panel)</th>
                  {canAccessOpsPages && <th>By</th>}
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {projectsLoading && (
                  <tr><td colSpan={canAccessOpsPages ? 5 : 4} className="page-loading">Loading…</td></tr>
                )}
                {!projectsLoading && projects.length === 0 && (
                  <tr><td colSpan={canAccessOpsPages ? 5 : 4} className="card-hint">No surveys created yet.</td></tr>
                )}
                {!projectsLoading && projects.map((p) => (
                  <tr key={p.id}>
                    <td>{p.project_id} — {p.project_name}</td>
                    <td>{p.country}</td>
                    <td>
                      {p.entry_token ? (
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <code style={{ fontSize: 12 }}>{entryLinkFor(p.entry_token)}</code>
                          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => copyRowLink(p.id, p.entry_token)} type="button">
                            {copiedRowId === p.id ? 'Copied ✓' : 'Copy'}
                          </button>
                        </span>
                      ) : (
                        <span className="card-hint">No entry link (created before this feature)</span>
                      )}
                    </td>
                    {canAccessOpsPages && <td>{p.profiles?.full_name || p.profiles?.email || '—'}</td>}
                    <td>{new Date(p.created_at).toLocaleString()}</td>
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
