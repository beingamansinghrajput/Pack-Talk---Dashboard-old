import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'

const EMPTY = { project_id: '', project_name: '', description: '', target: '', loi: '', ir: '', country: '', launch_date: '', survey_link: '' }
const TRACK_BASE = 'https://pack-talk-dashboard.vercel.app/api/track'
const REGISTER_BASE = 'https://pack-talk-dashboard.vercel.app/api/register-respondent'

const GLOBAL_TRACKING_LINKS = [
  { label: 'Complete', status: 'complete', url: `${TRACK_BASE}?status=complete&assignUid=RESPONDENT_ID` },
  { label: 'Terminate', status: 'terminate', url: `${TRACK_BASE}?status=terminate&assignUid=RESPONDENT_ID` },
  { label: 'Quota Full', status: 'quotafull', url: `${TRACK_BASE}?status=quotafull&assignUid=RESPONDENT_ID` },
  { label: 'Security', status: 'security', url: `${TRACK_BASE}?status=security&assignUid=RESPONDENT_ID` },
]

function generateApiKey() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return 'pk_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function generateToken() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function getClientLinkUrls(token) {
  // {uid} stays LITERAL — the client's platform substitutes it per respondent.
  // The token in the path is the real, already-generated {id} value.
  return [
    { label: 'Complete', status: 'complete', url: `${TRACK_BASE}/${token}/complete?uid={uid}` },
    { label: 'Terminate', status: 'terminate', url: `${TRACK_BASE}/${token}/terminate?uid={uid}` },
    { label: 'Quota Full', status: 'quotafull', url: `${TRACK_BASE}/${token}/quotafull?uid={uid}` },
    { label: 'Security', status: 'security', url: `${TRACK_BASE}/${token}/security?uid={uid}` },
  ]
}

export default function ProjectsAdmin() {
  const { user, isAdmin } = useAuth()
  const [projects, setProjects] = useState([])
  const [teams, setTeams] = useState([])
  const [teamProjects, setTeamProjects] = useState([])
  const [members, setMembers] = useState([])
  const [rates, setRates] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ratesProjectId, setRatesProjectId] = useState(null)
  const [linksProjectId, setLinksProjectId] = useState(null)
  const [copiedKey, setCopiedKey] = useState(null)
  const [search, setSearch] = useState('')

  const [apiKeys, setApiKeys] = useState([])
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  const [apiKeyMessage, setApiKeyMessage] = useState(null)
  const [justCreatedKey, setJustCreatedKey] = useState(null)

  const [quotaFile, setQuotaFile] = useState(null)
  const [quotaPreview, setQuotaPreview] = useState([])
  const [quotaError, setQuotaError] = useState(null)
  const [quotaProjectId, setQuotaProjectId] = useState('')
  const [quotaMessage, setQuotaMessage] = useState(null)
  const [quotaBusy, setQuotaBusy] = useState(false)

  const [allQuotas, setAllQuotas] = useState([])

  const [surveyLinks, setSurveyLinks] = useState([])
  const [genCountry, setGenCountry] = useState('')
  const [genAgeBand, setGenAgeBand] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genMessage, setGenMessage] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: projectData }, { data: teamData }, { data: tpData }, { data: memberData }, { data: rateData }, { data: quotaData }, { data: linksData }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('teams').select('*').order('name'),
      supabase.from('team_projects').select('*'),
      supabase.from('profiles').select('*'),
      supabase.from('rates').select('*'),
      supabase.from('project_quotas').select('*'),
      supabase.from('survey_links').select('*').order('created_at', { ascending: false }),
    ])
    setProjects(projectData || [])
    setTeams(teamData || [])
    setTeamProjects(tpData || [])
    setMembers(memberData || [])
    setRates(rateData || [])
    setAllQuotas(quotaData || [])
    setSurveyLinks(linksData || [])
    if (!quotaProjectId && projectData && projectData.length > 0) {
      setQuotaProjectId(projectData[0].project_id)
    }
    if (isAdmin) {
      const { data: keyData } = await supabase.from('api_keys').select('*').order('created_at', { ascending: false })
      setApiKeys(keyData || [])
    } else {
      setApiKeys([])
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.from('projects').insert({
      ...form,
      target: Number(form.target) || 0,
      loi: Number(form.loi) || 0,
      ir: Number(form.ir) || 0,
      launch_date: form.launch_date || new Date().toISOString().slice(0, 10),
      survey_link: form.survey_link || null,
      created_by: user.id,
    })
    setBusy(false)
    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: `Project ${form.project_id} created.` })
      setForm(EMPTY)
      load()
    }
  }

  async function updateStatus(project_id, status) {
    await supabase.from('projects').update({ status }).eq('project_id', project_id)
    load()
  }

  async function updateSurveyLink(project_id, survey_link) {
    await supabase.from('projects').update({ survey_link: survey_link || null }).eq('project_id', project_id)
    load()
  }

  async function toggleTeamAccess(project_id, team_id, currentlyLinked) {
    if (currentlyLinked) {
      await supabase.from('team_projects').delete().eq('project_id', project_id).eq('team_id', team_id)
    } else {
      await supabase.from('team_projects').insert({ project_id, team_id })
    }
    load()
  }

  function getRate(userId, project_id) {
    return rates.find((r) => r.user_id === userId && r.project_id === project_id)?.amount ?? ''
  }

  async function updateRate(userId, project_id, amount) {
    const numAmount = Number(amount) || 0
    await supabase.from('rates').upsert(
      { user_id: userId, project_id, amount: numAmount, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,project_id' }
    )
    load()
  }

  function getGenericTrackingLinks() {
    return [
      { label: 'Complete', status: 'complete', url: `${TRACK_BASE}?project=[PID]&uid=[UID]&status=complete` },
      { label: 'Terminate', status: 'terminate', url: `${TRACK_BASE}?project=[PID]&uid=[UID]&status=terminate` },
      { label: 'Quota Full', status: 'quotafull', url: `${TRACK_BASE}?project=[PID]&uid=[UID]&status=quotafull` },
      { label: 'Security', status: 'security', url: `${TRACK_BASE}?project=[PID]&uid=[UID]&status=security` },
    ]
  }

  function copyAllGenericLinks() {
    const links = getGenericTrackingLinks()
    const formatted = [
      'PackTalk Tracking Links — Generic Template',
      '',
      ...links.map((l) => `${l.label}: ${l.url}`),
      '',
      "Replace [PID] with the Project ID for this survey, [UID] with your respondent ID variable.",
      'The Project ID must be created in PackTalk before the survey goes live, or hits will fail.',
    ].join('\n')
    navigator.clipboard.writeText(formatted)
    setCopiedKey('generic_all')
    setTimeout(() => setCopiedKey(null), 1500)
  }

  function getTrackingLinks(project_id) {
    return [
      { label: 'Complete', status: 'complete', url: `${TRACK_BASE}?project=${project_id}&uid=[UID]&status=complete` },
      { label: 'Terminate', status: 'terminate', url: `${TRACK_BASE}?project=${project_id}&uid=[UID]&status=terminate` },
      { label: 'Quota Full', status: 'quotafull', url: `${TRACK_BASE}?project=${project_id}&uid=[UID]&status=quotafull` },
      { label: 'Security', status: 'security', url: `${TRACK_BASE}?project=${project_id}&uid=[UID]&status=security` },
    ]
  }

  function copyLink(key, url) {
    navigator.clipboard.writeText(url)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  function copyAllGlobalLinks() {
    const formatted = [
      'PackTalk Panel Vendor Registration Links',
      '',
      ...GLOBAL_TRACKING_LINKS.map((l) => `${l.label}: ${l.url}`),
      '',
      'RESPONDENT_ID is a literal placeholder — the panel platform substitutes its own respondent ID.',
      `Before sending a respondent to one of these links, call POST ${REGISTER_BASE} with a valid API key.`,
    ].join('\n')
    navigator.clipboard.writeText(formatted)
    setCopiedKey('global_all')
    setTimeout(() => setCopiedKey(null), 1500)
  }

  async function createApiKey(e) {
    e.preventDefault()
    if (!newKeyLabel.trim()) {
      setApiKeyMessage({ type: 'error', text: 'Give the key a label first (e.g. the client or platform name).' })
      return
    }
    setApiKeyBusy(true)
    setApiKeyMessage(null)
    const keyVal = generateApiKey()
    const { error } = await supabase.from('api_keys').insert({
      key_val: keyVal,
      label: newKeyLabel.trim(),
      is_active: true,
      created_by: user.id,
    })
    setApiKeyBusy(false)
    if (error) {
      setApiKeyMessage({ type: 'error', text: error.message })
    } else {
      setJustCreatedKey(keyVal)
      setNewKeyLabel('')
      load()
    }
  }

  async function toggleKeyActive(id, currentlyActive) {
    await supabase.from('api_keys').update({ is_active: !currentlyActive }).eq('id', id)
    load()
  }

  async function generateClientLink(project_id) {
    setGenBusy(true)
    setGenMessage(null)
    const token = generateToken()
    const { error } = await supabase.from('survey_links').insert({
      project_id,
      country: genCountry.trim() || null,
      age_band: genAgeBand.trim() || null,
      token,
      active: true,
      created_by: user.id,
    })
    setGenBusy(false)
    if (error) {
      setGenMessage({ type: 'error', text: error.message })
    } else {
      setGenMessage({ type: 'success', text: `Link generated for ${project_id}.` })
      setGenCountry('')
      setGenAgeBand('')
      load()
    }
  }

  async function toggleLinkActive(id, currentlyActive) {
    await supabase.from('survey_links').update({ active: !currentlyActive }).eq('id', id)
    load()
  }

  function handleQuotaFile(e) {
    const f = e.target.files[0]
    setQuotaError(null)
    setQuotaPreview([])
    if (!f) return
    const validExtensions = ['.xlsx', '.xls', '.csv']
    const hasValidExtension = validExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
    if (!hasValidExtension) {
      setQuotaError('Unsupported file type. Please upload a .xlsx, .xls, or .csv file.')
      setQuotaFile(null)
      return
    }
    setQuotaFile(f)
    const reader = new FileReader()
    reader.onerror = () => {
      setQuotaError('Could not read this file. Try re-exporting it and uploading again.')
      setQuotaFile(null)
    }
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        if (json.length === 0) {
          setQuotaError('This file has no data rows.')
          setQuotaFile(null)
          return
        }
        const firstRow = json[0]
        const hasCountry = 'Country' in firstRow
        const hasAgeBand = 'Age Band' in firstRow
        const hasTarget = 'Target Count' in firstRow
        if (!hasCountry || !hasAgeBand || !hasTarget) {
          setQuotaError('Missing required columns. File must include: Country, Age Band, Target Count.')
          setQuotaFile(null)
          return
        }
        setQuotaPreview(json.slice(0, 5))
      } catch (err) {
        setQuotaError('Could not parse this file. Make sure it is a valid Excel or CSV file.')
        setQuotaFile(null)
      }
    }
    reader.readAsBinaryString(f)
  }

  async function handleQuotaUpload() {
    if (!quotaFile || !quotaProjectId) {
      setQuotaMessage({ type: 'error', text: 'Pick a project and a file first.' })
      return
    }
    setQuotaBusy(true)
    setQuotaMessage(null)
    const reader = new FileReader()
    reader.onerror = () => {
      setQuotaBusy(false)
      setQuotaMessage({ type: 'error', text: 'Could not read the file during upload.' })
    }
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        const payload = []
        const invalidRows = []
        const labelCounters = {}
        json.forEach((row, idx) => {
          const country = String(row.Country || '').trim()
          const ageBand = String(row['Age Band'] || '').trim()
          const targetCount = Number(row['Target Count'])
          const surveyUrl = String(row['Survey URL'] || '').trim()
          const clientRedirectUrl = String(row['Client Redirect URL'] || '').trim()
          let linkLabel = String(row['Link Label'] || '').trim()
          const rowNum = idx + 2
          if (!country || !ageBand || isNaN(targetCount)) {
            invalidRows.push(`Row ${rowNum}: missing Country, Age Band, or a valid Target Count.`)
            return
          }
          if (!linkLabel) {
            const groupKey = `${country}|||${ageBand}`
            labelCounters[groupKey] = (labelCounters[groupKey] || 0) + 1
            linkLabel = `Link ${labelCounters[groupKey]}`
          }
          payload.push({
            project_id: quotaProjectId,
            country,
            age_band: ageBand,
            link_label: linkLabel,
            target_count: targetCount,
            survey_url: surveyUrl || null,
            client_redirect_url: clientRedirectUrl || null,
          })
        })
        if (payload.length === 0) {
          setQuotaMessage({ type: 'error', text: `No valid rows found. ${invalidRows.slice(0, 3).join(' ')}` })
          setQuotaBusy(false)
          return
        }
        const { error } = await supabase
          .from('project_quotas')
          .upsert(payload, { onConflict: 'project_id,country,age_band,link_label' })
        setQuotaBusy(false)
        if (error) {
          setQuotaMessage({ type: 'error', text: error.message })
        } else {
          let text = `${payload.length} quota row(s) saved for ${quotaProjectId}.`
          if (invalidRows.length > 0) text += ` (${invalidRows.length} row(s) skipped.)`
          setQuotaMessage({ type: 'success', text })
          setQuotaFile(null)
          setQuotaPreview([])
          load()
        }
      } catch (err) {
        setQuotaBusy(false)
        setQuotaMessage({ type: 'error', text: 'Could not process this file.' })
      }
    }
    reader.readAsBinaryString(quotaFile)
  }

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) =>
      `${p.project_id} ${p.project_name} ${p.country}`.toLowerCase().includes(q)
    )
  }, [projects, search])

  return (
    <div className="page">
      <h1>Manage Projects</h1>
      <p className="page-sub">Add a new survey project so your team can start punching in responses.</p>

      <Reveal>
        <div className="card" style={{ maxWidth: 720, marginBottom: 20 }}>
          <h2 className="card-title">Generic Integration Links</h2>
          <p className="card-hint">
            Send these to a new client before their project even exists in PackTalk. Replace <code>[PID]</code> with the real Project ID,
            <code>[UID]</code> with their respondent ID variable. Just make sure the Project ID is created below before the survey actually goes live.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button type="button" className="btn-ghost" onClick={copyAllGenericLinks}>
              {copiedKey === 'generic_all' ? 'Copied All ✓' : 'Copy All Links'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {getGenericTrackingLinks().map((link) => (
              <div key={link.status} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="badge badge-gray" style={{ minWidth: 90, textAlign: 'center' }}>{link.label}</span>
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.target.select()}
                  style={{ flex: 1, minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                />
                <button type="button" className="btn-ghost" onClick={() => copyLink('generic_' + link.status, link.url)}>
                  {copiedKey === ('generic_' + link.status) ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {isAdmin && (
        <Reveal>
          <div className="card" style={{ maxWidth: 720, marginBottom: 20, borderLeft: '3px solid rgba(168,85,247,0.5)' }}>
            <h2 className="card-title">Global Tracking Links (No Project ID in URL)</h2>
            <p className="card-hint">
              For a client whose platform can only send <code>status</code> and its own respondent ID.
              Before sending a respondent to one of these links, your client (or your team) must call{' '}
              <code>POST {REGISTER_BASE}</code> with an API key (below), the <code>project_id</code>, and the respondent's <code>uid</code>,
              so the registration tells us which project the hit belongs to.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
              <button type="button" className="btn-ghost" onClick={copyAllGlobalLinks}>
                {copiedKey === 'global_all' ? 'Copied All ✓' : 'Copy All Links'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {GLOBAL_TRACKING_LINKS.map((link) => (
                <div key={link.status} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="badge badge-gray" style={{ minWidth: 90, textAlign: 'center' }}>{link.label}</span>
                  <input
                    readOnly
                    value={link.url}
                    onFocus={(e) => e.target.select()}
                    style={{ flex: 1, minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                  />
                  <button type="button" className="btn-ghost" onClick={() => copyLink('global_' + link.status, link.url)}>
                    {copiedKey === ('global_' + link.status) ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>API Keys</h3>
              <p className="card-hint" style={{ marginBottom: 10 }}>
                Each client or platform using the registration endpoint needs its own key, sent as a header on <code>POST {REGISTER_BASE}</code>.
              </p>
              <form onSubmit={createApiKey} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <input
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="Label, e.g. Client X Exchange"
                  style={{ flex: 1, minWidth: 200 }}
                />
                <button className="btn-primary" type="submit" disabled={apiKeyBusy}>
                  {apiKeyBusy ? 'Generating…' : 'Generate Key'}
                </button>
              </form>
              {apiKeyMessage && <div className="auth-error" style={{ marginBottom: 10 }}>{apiKeyMessage.text}</div>}
              {justCreatedKey && (
                <div className="auth-success" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>New key created — copy it now, it won't be highlighted like this again:</span>
                  <input readOnly value={justCreatedKey} onFocus={(e) => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12, flex: 1 }} />
                  <button type="button" className="btn-ghost" onClick={() => copyLink('newkey', justCreatedKey)}>
                    {copiedKey === 'newkey' ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              )}
              <div className="table-wrap">
                <table className="data-table small">
                  <thead>
                    <tr><th>Label</th><th>Key</th><th>Status</th><th>Created</th><th></th></tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((k) => (
                      <tr key={k.id}>
                        <td>{k.label}</td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <code style={{ fontSize: 12 }}>{k.key_val}</code>
                            <button type="button" className="btn-ghost" style={{ padding: '2px 8px' }} onClick={() => copyLink('key_' + k.id, k.key_val)}>
                              {copiedKey === 'key_' + k.id ? 'Copied ✓' : 'Copy'}
                            </button>
                          </span>
                        </td>
                        <td><span className={`badge ${k.is_active ? 'badge-green' : 'badge-gray'}`}>{k.is_active ? 'Active' : 'Disabled'}</span></td>
                        <td>{k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}</td>
                        <td>
                          <button type="button" className="btn-ghost" onClick={() => toggleKeyActive(k.id, k.is_active)}>
                            {k.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {apiKeys.length === 0 && (
                      <tr><td colSpan={5} className="empty-row">No API keys yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Reveal>
      )}

      <Reveal>
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 className="card-title">New Project</h2>
          <form onSubmit={handleSubmit} className="form-grid">
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
            <label>Target
              <input type="number" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
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
            <label>Survey Link (optional)
              <input value={form.survey_link} onChange={(e) => setForm({ ...form, survey_link: e.target.value })} />
            </label>
            {message && <div className={message.type === 'error' ? 'auth-error' : 'auth-success'}>{message.text}</div>}
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Project'}</button>
          </form>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="card">
          <div className="section-header-row">
            <h2 className="card-title">All Projects</h2>
            <input
              className="search-input"
              placeholder="Search by Project ID, name, or country…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Project ID</th><th>Name</th><th>Country</th><th>Target</th><th>Status</th><th>Teams</th><th></th></tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => {
                  const linkedTeamIds = teamProjects.filter((tp) => tp.project_id === p.project_id).map((tp) => tp.team_id)
                  return (
                    <tr key={p.project_id}>
                      <td>{p.project_id}</td>
                      <td>{p.project_name}</td>
                      <td>{p.country}</td>
                      <td>{p.target}</td>
                      <td><span className={`badge ${p.status === 'Live' ? 'badge-green' : 'badge-gray'}`}>{p.status}</span></td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {teams.length === 0 && <span className="card-hint">No teams yet</span>}
                          {teams.map((t) => {
                            const linked = linkedTeamIds.includes(t.id)
                            return (
                              <button
                                key={t.id}
                                onClick={() => toggleTeamAccess(p.project_id, t.id, linked)}
                                className={linked ? 'badge badge-green' : 'badge badge-gray'}
                                style={{ cursor: 'pointer', border: 'none' }}
                                title={linked ? 'Click to remove access' : 'Click to grant access'}
                              >
                                {t.name} {linked ? '✓' : '+'}
                              </button>
                            )
                          })}
                        </div>
                      </td>
                      <td style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <select value={p.status} onChange={(e) => updateStatus(p.project_id, e.target.value)}>
                          <option value="Live">Live</option>
                          <option value="Paused">Paused</option>
                          <option value="Closed">Closed</option>
                        </select>
                        <button
                          className="btn-ghost"
                          onClick={() => setRatesProjectId(ratesProjectId === p.project_id ? null : p.project_id)}
                        >
                          {ratesProjectId === p.project_id ? 'Hide Rates' : 'Manage Rates'}
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => setLinksProjectId(linksProjectId === p.project_id ? null : p.project_id)}
                        >
                          {linksProjectId === p.project_id ? 'Hide Links' : 'Tracking Links'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filteredProjects.length === 0 && (
                  <tr><td colSpan={7} className="empty-row">No projects match your search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {ratesProjectId && (
            <div className="card" style={{ marginTop: 16, background: 'rgba(255,255,255,0.02)' }}>
              <h2 className="card-title">Pay Rates — {ratesProjectId}</h2>
              <p className="card-hint">Set how much each person earns per Completed respondent on this project.</p>
              <div className="table-wrap">
                <table className="data-table small">
                  <thead>
                    <tr><th>Name</th><th>Email</th><th>Rate per Completed (₹)</th></tr>
                  </thead>
                  <tbody>
                    {members.filter((m) => m.role !== 'admin').map((m) => (
                      <tr key={m.id}>
                        <td>{m.full_name || '—'}</td>
                        <td>{m.email}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={getRate(m.id, ratesProjectId)}
                            onBlur={(e) => updateRate(m.id, ratesProjectId, e.target.value)}
                            style={{ width: 100 }}
                            placeholder="0"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {linksProjectId && (
            <div className="card" style={{ marginTop: 16, background: 'rgba(255,255,255,0.02)' }}>
              <h2 className="card-title">Tracking Links — {linksProjectId}</h2>
              <p className="card-hint">
                Replace <code>[UID]</code> with your respondent ID variable.
              </p>
              <div style={{ marginTop: 12, marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--muted, #888)' }}>
                  Client's Survey Link
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    defaultValue={projects.find((p) => p.project_id === linksProjectId)?.survey_link || ''}
                    onBlur={(e) => updateSurveyLink(linksProjectId, e.target.value)}
                    placeholder="e.g. https://forms.gle/xxxxx"
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {getTrackingLinks(linksProjectId).map((link) => (
                  <div key={link.status} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="badge badge-gray" style={{ minWidth: 90, textAlign: 'center' }}>{link.label}</span>
                    <input
                      readOnly
                      value={link.url}
                      onFocus={(e) => e.target.select()}
                      style={{ flex: 1, minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => copyLink(link.status, link.url)}
                    >
                      {copiedKey === link.status ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 style={{ fontSize: 15, marginBottom: 6 }}>Generate Client Link (Token-in-Path)</h3>
                <p className="card-hint" style={{ marginBottom: 10 }}>
                  For clients whose platform issues one fixed URL per vendor and can't accept custom query params.
                  Optionally scope to a country/age-band, or leave blank for a project-wide link.
                  <code> {'{uid}'} </code> stays literal — their system fills it in per respondent.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <input
                    value={genCountry}
                    onChange={(e) => setGenCountry(e.target.value)}
                    placeholder="Country (optional)"
                    style={{ width: 160 }}
                  />
                  <input
                    value={genAgeBand}
                    onChange={(e) => setGenAgeBand(e.target.value)}
                    placeholder="Age Band (optional)"
                    style={{ width: 160 }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={genBusy}
                    onClick={() => generateClientLink(linksProjectId)}
                  >
                    {genBusy ? 'Generating…' : 'Generate Client Link'}
                  </button>
                </div>
                {genMessage && (
                  <div className={genMessage.type === 'error' ? 'auth-error' : 'auth-success'} style={{ marginBottom: 10 }}>
                    {genMessage.text}
                  </div>
                )}

                <div className="table-wrap">
                  <table className="data-table small">
                    <thead>
                      <tr><th>Token</th><th>Country</th><th>Age Band</th><th>Status</th><th>Created</th><th></th></tr>
                    </thead>
                    <tbody>
                      {surveyLinks.filter((l) => l.project_id === linksProjectId).map((l) => (
                        <tr key={l.id}>
                          <td><code style={{ fontSize: 12 }}>{l.token}</code></td>
                          <td>{l.country || '—'}</td>
                          <td>{l.age_band || '—'}</td>
                          <td><span className={`badge ${l.active ? 'badge-green' : 'badge-gray'}`}>{l.active ? 'Active' : 'Inactive'}</span></td>
                          <td>{l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}</td>
                          <td>
                            <button type="button" className="btn-ghost" onClick={() => toggleLinkActive(l.id, l.active)}>
                              {l.active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {surveyLinks.filter((l) => l.project_id === linksProjectId).length === 0 && (
                        <tr><td colSpan={6} className="empty-row">No client links generated yet for this project.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {surveyLinks.filter((l) => l.project_id === linksProjectId && l.active).length > 0 && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {getClientLinkUrls(surveyLinks.find((l) => l.project_id === linksProjectId && l.active)?.token).map((link) => (
                      <div key={link.status} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="badge badge-gray" style={{ minWidth: 90, textAlign: 'center' }}>{link.label}</span>
                        <input
                          readOnly
                          value={link.url}
                          onFocus={(e) => e.target.select()}
                          style={{ flex: 1, minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                        />
                        <button type="button" className="btn-ghost" onClick={() => copyLink('client_' + link.status, link.url)}>
                          {copiedKey === ('client_' + link.status) ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Reveal>

      {projects.length > 0 && (
        <Reveal delay={120}>
          <div className="card" style={{ maxWidth: 640 }}>
            <h2 className="card-title">Upload Quota Brief</h2>
            <p className="card-hint">
              Set quotas for any project yourself — no need to wait on a client. Upload an Excel or CSV file with columns: Country, Age Band, Target Count (Survey URL, Client Redirect URL, and Link Label are optional).
            </p>
            <label className="field-label">Project
              <select value={quotaProjectId} onChange={(e) => setQuotaProjectId(e.target.value)}>
                {projects.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
              </select>
            </label>
            <label className="field-label">Quota File (.xlsx / .csv)
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleQuotaFile} />
            </label>
            {quotaError && <div className="auth-error" style={{ marginTop: 8 }}>{quotaError}</div>}
            {quotaPreview.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data-table small">
                  <thead>
                    <tr>{Object.keys(quotaPreview[0]).map((k) => <th key={k}>{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {quotaPreview.map((row, i) => (
                      <tr key={i}>{Object.values(row).map((v, j) => <td key={j}>{String(v)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                <p className="card-hint">Showing first {quotaPreview.length} rows as a preview.</p>
              </div>
            )}
            {quotaMessage && (
              <div className={quotaMessage.type === 'error' ? 'auth-error' : 'auth-success'} style={{ marginTop: 10 }}>{quotaMessage.text}</div>
            )}
            <button className="btn-primary" onClick={handleQuotaUpload} disabled={quotaBusy} style={{ marginTop: 12 }}>
              {quotaBusy ? 'Uploading…' : 'Upload Quota File'}
            </button>
          </div>
        </Reveal>
      )}
    </div>
  )
}
