import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'

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
  const { user, isAdmin, canAccessOpsPages } = useAuth()

  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [project, setProject] = useState(null)

  const [templateDraft, setTemplateDraft] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateMessage, setTemplateMessage] = useState(null)

  const [stingInput, setStingInput] = useState('')

  const [rawUid, setRawUid] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const [entries, setEntries] = useState([])
  const [entriesLoading, setEntriesLoading] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [])

  useEffect(() => {
    const p = projects.find((pr) => pr.project_id === projectId) || null
    setProject(p)
    setTemplateDraft(p?.survey_link || '')
    setLastResult(null)
    setGenError(null)
    if (projectId) loadEntries()
    else setEntries([])
  }, [projectId, projects])

  async function loadProjects() {
    const { data } = await supabase
      .from('projects')
      .select('project_id, project_name, survey_link, status')
      .order('project_id')
    setProjects(data || [])
  }

  async function loadEntries() {
    setEntriesLoading(true)
    let q = supabase
      .from('client_link_entries')
      .select('id, client_facing_id, sting, raw_uid, created_at, created_by, profiles:created_by(full_name, email)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (!canAccessOpsPages) q = q.eq('created_by', user.id)
    const { data } = await q
    setEntries(data || [])
    setEntriesLoading(false)
  }

  async function saveTemplate(e) {
    e.preventDefault()
    setTemplateBusy(true)
    setTemplateMessage(null)
    const { error } = await supabase
      .from('projects')
      .update({ survey_link: templateDraft.trim() })
      .eq('project_id', projectId)
    setTemplateBusy(false)
    if (error) {
      setTemplateMessage({ type: 'error', text: error.message })
    } else {
      setTemplateMessage({ type: 'success', text: 'Saved.' })
      loadProjects()
    }
  }

  async function generate(e) {
    e.preventDefault()
    setGenError(null)
    setLastResult(null)

    if (!project?.survey_link) {
      setGenError('This project has no client survey link saved yet. Add it above first.')
      return
    }
    if (!rawUid.trim()) {
      setGenError('Enter the UID string first.')
      return
    }
    if (!stingInput.trim()) {
      setGenError('Enter your sting.')
      return
    }

    setGenBusy(true)
    const cleanedRaw = rawUid.trim()
    const sting = stingInput.trim().toUpperCase()

    // Try a few times in case of a random collision on the unique client_facing_id.
    let saved = null
    let lastErr = null
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      const clientFacingId = randomClientFacingId()
      const finalLink = buildFinalLink(project.survey_link, clientFacingId)
      const { data, error } = await supabase
        .from('client_link_entries')
        .insert({
          project_id: projectId,
          raw_uid: cleanedRaw,
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

    setGenBusy(false)
    if (!saved) {
      setGenError(lastErr?.message || 'Could not generate a link — try again.')
      return
    }
    setLastResult(saved)
    setRawUid('')
    loadEntries()
  }

  function copyResult() {
    if (!lastResult) return
    navigator.clipboard.writeText(lastResult.final_link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="page">
      <Reveal>
        <div className="page-header">
          <div>
            <h1>Link Generator</h1>
            <p className="page-sub">Turn a client's survey link into a per-entry link to open in GoLogin. The client only ever sees a random ID — never the raw UID.</p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={40}>
        <div className="card">
          <div className="card-title">1. Pick a project</div>
          <div className="form-grid">
            <label>
              Project
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.project_id} — {p.project_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </Reveal>

      {projectId && (
        <Reveal delay={80}>
          <div className="card">
            <div className="card-title">2. Client's survey link</div>
            {isAdmin || canAccessOpsPages ? (
              <form className="form-grid" onSubmit={saveTemplate}>
                <label>
                  Base link from the client (with the uid= placeholder)
                  <input
                    type="text"
                    value={templateDraft}
                    onChange={(e) => setTemplateDraft(e.target.value)}
                    placeholder="https://client-domain.com/survey?p=...&uid=xxxx"
                  />
                </label>
                <div>
                  <button className="btn-ghost" type="submit" disabled={templateBusy}>
                    {templateBusy ? 'Saving…' : 'Save link'}
                  </button>
                </div>
                {templateMessage && (
                  <span className={templateMessage.type === 'error' ? 'auth-error' : 'card-hint'}>
                    {templateMessage.text}
                  </span>
                )}
              </form>
            ) : (
              <p className="card-hint">
                {project?.survey_link ? 'Link is set on this project.' : 'No link saved yet — ask an admin to add one.'}
              </p>
            )}
          </div>
        </Reveal>
      )}

      {projectId && (
        <Reveal delay={120}>
          <div className="card">
            <div className="card-title">3. Generate a link</div>
            <form className="form-grid" onSubmit={generate}>
              <label>
                Your UID string
                <input
                  type="text"
                  value={rawUid}
                  onChange={(e) => setRawUid(e.target.value)}
                  placeholder="e.g. euwfgwehfvehfvejfv"
                />
              </label>
              <label>
                Your sting
                <input
                  type="text"
                  value={stingInput}
                  onChange={(e) => setStingInput(e.target.value)}
                  placeholder="e.g. AS02"
                />
              </label>
              <div>
                <button className="btn-primary" type="submit" disabled={genBusy}>
                  {genBusy ? 'Generating…' : 'Generate link'}
                </button>
              </div>
              {genError && <span className="auth-error">{genError}</span>}
            </form>

            {lastResult && (
              <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: 'rgba(124, 92, 252, 0.08)', border: '1px solid rgba(124, 92, 252, 0.25)' }}>
                <div className="card-hint" style={{ marginBottom: 6 }}>
                  Open this in GoLogin — client-facing ID: <code>{lastResult.client_facing_id}</code>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{lastResult.final_link}</code>
                  <button className="btn-ghost" onClick={copyResult} type="button">
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Reveal>
      )}

      {projectId && (
        <Reveal delay={160}>
          <div className="card">
            <div className="card-title">
              {canAccessOpsPages ? 'Recent entries — this project' : 'Your recent entries — this project'}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Client-facing ID</th>
                    {canAccessOpsPages && <th>Raw UID</th>}
                    <th>Sting</th>
                    {canAccessOpsPages && <th>By</th>}
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {entriesLoading && (
                    <tr><td colSpan={canAccessOpsPages ? 5 : 3} className="page-loading">Loading…</td></tr>
                  )}
                  {!entriesLoading && entries.length === 0 && (
                    <tr><td colSpan={canAccessOpsPages ? 5 : 3} className="card-hint">No entries yet.</td></tr>
                  )}
                  {!entriesLoading && entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.client_facing_id}</td>
                      {canAccessOpsPages && <td>{e.raw_uid}</td>}
                      <td>{e.sting}</td>
                      {canAccessOpsPages && <td>{e.profiles?.full_name || e.profiles?.email || '—'}</td>}
                      <td>{new Date(e.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
      )}
    </div>
  )
}
