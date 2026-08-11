import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'

const STATUS_CLASS = {
  Completed: 'badge-green',
  Terminated: 'badge-red',
  QuotaFull: 'badge-amber',
  Disqualify: 'badge-gray',
}
const PAGE_SIZE = 15
const IR_MIN_SAMPLE = 5
const IR_GOOD_THRESHOLD = 10
const IR_WARN_THRESHOLD = 20

function getIRHealth(expectedIR, completedCount, terminatedCount) {
  const sample = completedCount + terminatedCount
  if (sample === 0) {
    return { status: 'insufficient', label: 'No data', color: '#6B7280', actualIR: null, sample }
  }
  const actualIR = (completedCount / sample) * 100
  const diff = Math.abs(actualIR - expectedIR)

  if (diff <= IR_GOOD_THRESHOLD) {
    return { status: 'good', label: 'On target', color: '#16A34A', actualIR, sample }
  }
  if (diff <= IR_WARN_THRESHOLD) {
    return { status: 'warn', label: 'Watch closely', color: '#D97706', actualIR, sample }
  }
  return { status: 'bad', label: 'Off target', color: '#DC2626', actualIR, sample }
}

export default function ProjectDetail() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [project, setProject] = useState(null)
  const [quotas, setQuotas] = useState([])
  const [copiedLinkKey, setCopiedLinkKey] = useState(null)
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionMessage, setActionMessage] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [irCounts, setIrCounts] = useState({ Completed: 0, Terminated: 0, QuotaFull: 0, Abandoned: 0 })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const [clearConfirmText, setClearConfirmText] = useState('')
  const [clearBusy, setClearBusy] = useState(false)

  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [descriptionBusy, setDescriptionBusy] = useState(false)

  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    setPage(0)
  }, [statusFilter, countryFilter, dateFrom, dateTo])

  useEffect(() => {
    load()
  }, [projectId, page, statusFilter, countryFilter, dateFrom, dateTo])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, statusFilter, countryFilter, dateFrom, dateTo, projectId])

  function buildQuery(base) {
    let q = base.eq('project_id', projectId).eq('deleted', false)
    if (!isAdmin) {
      q = q.not('uid', 'ilike', 'UNASSIGNED-%')
    }
    if (statusFilter) {
      const sf = statusFilter === 'Abandoned' ? 'Disqualify' : statusFilter
      q = q.eq('status', sf)
    }
    if (countryFilter.trim()) q = q.ilike('country', `%${countryFilter.trim()}%`)
    if (dateFrom) q = q.gte('start_time', dateFrom)
    if (dateTo) q = q.lte('start_time', dateTo + 'T23:59:59')
    return q
  }

  async function load() {
    setLoading(true)
    const { data: proj } = await supabase.from('projects').select('*').eq('project_id', projectId).single()
    setProject(proj)

    const { data: quotaData } = await supabase.from('project_quotas').select('*').eq('project_id', projectId).order('country')
    setQuotas(quotaData || [])

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const query = buildQuery(supabase.from('responses').select('*', { count: 'exact' }))
      .order('start_time', { ascending: false })
      .range(from, to)

    const { data, count } = await query
    setRows(data || [])
    setTotal(count || 0)
    setLoading(false)

    const { data: allStatusRows } = await supabase
      .from('responses')
      .select('status, uid')
      .eq('project_id', projectId)
      .eq('deleted', false)
    const counts = { Completed: 0, Terminated: 0, QuotaFull: 0, Abandoned: 0 }
    ;(allStatusRows || []).forEach((r) => { 
      if (!isAdmin && r.uid && r.uid.startsWith('UNASSIGNED-')) return;
      const s = r.status === 'Disqualify' ? 'Abandoned' : r.status;
      if (counts[s] !== undefined) counts[s]++; 
    })
    setIrCounts(counts)
  }

  const irHealth = useMemo(() => {
    if (!project) return null
    return getIRHealth(Number(project.ir) || 0, irCounts.Completed, irCounts.Terminated)
  }, [project, irCounts])

  async function handleDelete(row) {
    const confirmed = window.confirm(`Remove respondent ${row.uid}? This can be restored later by an admin if needed.`)
    if (!confirmed) return

    const { error } = await supabase
      .from('responses')
      .update({ deleted: true })
      .eq('id', row.id)

    if (error) {
      setActionMessage({ type: 'error', text: error.message })
    } else {
      setActionMessage({ type: 'success', text: `Respondent ${row.uid} removed.` })
      load()
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected = rows.length > 0 && rows.every((r) => prev.has(r.id))
      if (allSelected) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    const confirmed = window.confirm(
      `Remove ${selectedIds.size} selected respondent(s)? This can be restored later by an admin if needed.`
    )
    if (!confirmed) return

    setBulkBusy(true)
    const { error } = await supabase
      .from('responses')
      .update({ deleted: true })
      .in('id', Array.from(selectedIds))

    setBulkBusy(false)
    if (error) {
      setActionMessage({ type: 'error', text: error.message })
    } else {
      setActionMessage({ type: 'success', text: `${selectedIds.size} respondent(s) removed.` })
      setSelectedIds(new Set())
      load()
    }
  }

  async function handleClearAllTestData() {
    if (clearConfirmText !== projectId) return
    const confirmed = window.confirm(
      `This will remove ALL respondent rows for ${projectId} (every page, every filter — not just what's currently visible). This can be restored later by an admin if needed. Continue?`
    )
    if (!confirmed) return

    setClearBusy(true)
    const { error, count } = await supabase
      .from('responses')
      .update({ deleted: true })
      .eq('project_id', projectId)
      .eq('deleted', false)
      .select('id', { count: 'exact' })

    setClearBusy(false)
    if (error) {
      setActionMessage({ type: 'error', text: error.message })
    } else {
      setActionMessage({ type: 'success', text: `Cleared ${count ?? 'all'} respondent row(s) for ${projectId}.` })
      setClearConfirmText('')
      setSelectedIds(new Set())
      load()
    }
  }

  async function handleDeleteProject() {
    if (deleteConfirmText !== projectId) return
    const confirmed = window.confirm(
      `This will PERMANENTLY DELETE the project ${projectId} itself — not just its respondent data. This cannot be undone from inside the app (an admin would need to recreate it from scratch in Supabase). Are you absolutely sure?`
    )
    if (!confirmed) return

    setDeleteBusy(true)
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('project_id', projectId)

    setDeleteBusy(false)
    if (error) {
      setActionMessage({ type: 'error', text: `Could not delete project: ${error.message}` })
    } else {
      navigate('/', { replace: true })
    }
  }

  async function handleExport() {
    const query = buildQuery(supabase.from('responses').select('*')).order('start_time', { ascending: false })
    const { data, error } = await query

    if (error) {
      setActionMessage({ type: 'error', text: 'Export failed: ' + error.message })
      return
    }
    if (!data || data.length === 0) {
      setActionMessage({ type: 'error', text: 'No rows to export for the current filters.' })
      return
    }

    const headers = ['UID', 'Start Time', 'End Time', 'Duration (min)', 'Country', 'IP Address', 'Status', 'Age', 'Gender', 'Opinions Count', 'Opinions']
    const csvRows = data.map((r) => {
      let ops = r.opinions || ''
      if (typeof ops === 'string' && ops.startsWith('[')) {
        try { ops = JSON.parse(ops).join(' | ') } catch (e) {}
      } else if (Array.isArray(ops)) {
        ops = ops.join(' | ')
      }

      return [
        r.uid,
        r.start_time ? new Date(r.start_time).toLocaleString() : '',
        r.end_time ? new Date(r.end_time).toLocaleString() : '',
        r.duration_min ?? '',
        r.country ?? '',
        r.ip_address ?? '',
        r.status ?? '',
        r.age ?? '',
        r.gender ?? '',
        r.opinions_count ?? '',
        ops
      ]
    })

    const escapeCell = (cell) => {
      const s = String(cell ?? '')
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    const csvContent = [headers, ...csvRows].map((row) => row.map(escapeCell).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `${projectId}_export_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function startEditDescription() {
    setDescriptionDraft(project.description || '')
    setEditingDescription(true)
  }

  async function saveDescription() {
    setDescriptionBusy(true)
    const { error } = await supabase
      .from('projects')
      .update({ description: descriptionDraft.trim() || null })
      .eq('project_id', projectId)

    setDescriptionBusy(false)
    if (error) {
      setActionMessage({ type: 'error', text: 'Could not save description: ' + error.message })
    } else {
      setProject((prev) => ({ ...prev, description: descriptionDraft.trim() || null }))
      setEditingDescription(false)
    }
  }

  function copyLink(key, url) {
    navigator.clipboard.writeText(url)
    setCopiedLinkKey(key)
    setTimeout(() => setCopiedLinkKey(null), 1500)
  }

  function clearFilters() {
    setStatusFilter('')
    setCountryFilter('')
    setDateFrom('')
    setDateTo('')
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasActiveFilters = statusFilter || countryFilter || dateFrom || dateTo
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const colCount = isAdmin ? 10 : 8
  const clearUnlocked = clearConfirmText === projectId
  const deleteUnlocked = deleteConfirmText === projectId

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Dashboard</Link> <span>›</span> <span>Project {projectId}</span>
      </div>
      <h1>Project Details: {projectId}</h1>
      {project && <p className="page-sub">{project.project_name} · {project.country} · Target {project.target}</p>}

      {actionMessage && (
        <div className={actionMessage.type === 'error' ? 'auth-error' : 'auth-success'} style={{ marginBottom: 12 }}>
          {actionMessage.text}
        </div>
      )}

      {project && irHealth && (
        <Reveal>
        <div className="card" style={{ borderLeft: `3px solid ${irHealth.color}` }}>
          <h2 className="card-title">IR Health Check</h2>
          {irHealth.status === 'insufficient' ? (
            <p className="card-hint">
              Not enough data yet ({irHealth.sample} Completed+Terminated so far — need at least {IR_MIN_SAMPLE} to evaluate).
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '12px 0' }}>
                <div>
                  <div className="card-hint">Expected IR</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{project.ir}%</div>
                </div>
                <div>
                  <div className="card-hint">Actual IR</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: irHealth.color }}>{irHealth.actualIR.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="card-hint">Status</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: irHealth.color }}>{irHealth.label}</div>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table small">
                  <thead>
                    <tr><th></th><th>Expected (of {irCounts.Completed + irCounts.Terminated})</th><th>Actual</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Completed</td>
                      <td>{Math.round((irCounts.Completed + irCounts.Terminated) * (Number(project.ir) || 0) / 100)}</td>
                      <td className="text-green">{irCounts.Completed}</td>
                    </tr>
                    <tr>
                      <td>Terminated</td>
                      <td>{Math.round((irCounts.Completed + irCounts.Terminated) * (100 - (Number(project.ir) || 0)) / 100)}</td>
                      <td className="text-red">{irCounts.Terminated}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="card-hint" style={{ marginTop: 8 }}>
                QuotaFull ({irCounts.QuotaFull}) and Abandoned ({irCounts.Abandoned}) are excluded from this ratio.
              </p>
            </>
          )}
        </div>
        </Reveal>
      )}

      {project && (project.entry_token || quotas.length > 0) && (
        <Reveal>
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="card-title">Panel Entry Link{quotas.length > 1 ? 's' : ''}</h2>
          <p className="card-hint">
            This is the link to post to your own panel — every respondent who clicks it gets a fresh, random ID
            automatically and is sent into the client's real survey. It never reveals the client's domain or our
            internal Project ID.
          </p>

          {project.entry_token && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <span className="badge badge-gray" style={{ minWidth: 90, textAlign: 'center' }}>Entry Link</span>
              <input
                readOnly
                value={`https://pack-talk-dashboard.vercel.app/api/enter?p=${project.entry_token}&uid=xxxx`}
                onFocus={(e) => e.target.select()}
                style={{ flex: 1, minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
              />
              <button type="button" className="btn-ghost" onClick={() => copyLink('main', `https://pack-talk-dashboard.vercel.app/api/enter?p=${project.entry_token}&uid=xxxx`)}>
                {copiedLinkKey === 'main' ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          )}

          {!project.entry_token && (
            <p className="card-hint" style={{ marginTop: 12 }}>
              No entry link exists for this project yet — it was created before this feature, or via the old Manage
              Projects form. Generate one from the Link Generator page.
            </p>
          )}

          {quotas.length > 0 && (
            <div className="table-wrap" style={{ marginTop: project.entry_token ? 16 : 12 }}>
              <table className="data-table small">
                <thead>
                  <tr><th>Country</th><th>Age Band</th><th>Target</th><th>Survey URL</th><th></th></tr>
                </thead>
                <tbody>
                  {quotas.map((q) => {
                    const key = `${q.country}-${q.age_band}`
                    return (
                      <tr key={key}>
                        <td>{q.country}</td>
                        <td>{q.age_band}</td>
                        <td>{q.target_count}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{q.survey_url || '—'}</td>
                        <td>
                          {q.survey_url && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button type="button" className="btn-ghost" onClick={() => copyLink(key, q.survey_url)}>
                                {copiedLinkKey === key ? 'Copied ✓' : 'Copy'}
                              </button>
                              <a href={q.survey_url} target="_blank" rel="noreferrer" className="btn-ghost">Open</a>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </Reveal>
      )}

      {project && (project.description || isAdmin) && (
        <Reveal>
        <div className="card">
          <div className="section-header-row" style={{ marginTop: 0 }}>
            <h2 className="card-title">Description</h2>
            {isAdmin && !editingDescription && (
              <button className="btn-ghost" onClick={startEditDescription}>
                {project.description ? 'Edit' : 'Add Description'}
              </button>
            )}
          </div>
          {editingDescription ? (
            <div>
              <textarea
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                placeholder="Brief background on this survey — target audience, objective, and so on."
                rows={4}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-primary" onClick={saveDescription} disabled={descriptionBusy}>
                  {descriptionBusy ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-ghost" onClick={() => setEditingDescription(false)} disabled={descriptionBusy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="card-hint" style={{ whiteSpace: 'pre-wrap' }}>
              {project.description || 'No description yet.'}
            </p>
          )}
        </div>
        </Reveal>
      )}

      <Reveal>
      <div className="card">
        <div className="section-header-row" style={{ marginTop: 0, marginBottom: 4 }}>
          <h2 className="card-title" style={{ margin: 0 }}>Member Survey Overview</h2>
          {isAdmin && selectedIds.size > 0 && (
            <button
              className="btn-ghost"
              onClick={handleBulkDelete}
              disabled={bulkBusy}
              style={{ color: '#f87171' }}
            >
              {bulkBusy ? 'Removing…' : `Delete Selected (${selectedIds.size})`}
            </button>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: 12,
            padding: '14px 16px',
            margin: '14px 0 18px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', gap: 6, minWidth: 140 }}>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="Completed">Completed</option>
              <option value="Terminated">Terminated</option>
              <option value="QuotaFull">QuotaFull</option>
              <option value="Abandoned">Abandoned</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', gap: 6, minWidth: 160 }}>
            Country
            <input value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} placeholder="Search country…" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', gap: 6, minWidth: 150 }}>
            From Date
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', gap: 6, minWidth: 150 }}>
            To Date
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {hasActiveFilters && (
              <button className="btn-ghost" onClick={clearFilters}>Clear Filters</button>
            )}
            <button className="btn-primary" onClick={handleExport}>Download CSV</button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {isAdmin && (
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      disabled={rows.length === 0}
                    />
                  </th>
                )}
                <th>No</th>
                <th>Project ID</th>
                <th>UID</th>
                <th>Start IP</th>
                <th>End IP</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Duration</th>
                <th>Country</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={colCount + 2} className="empty-row">Loading…</td></tr>}
              {!loading && rows.map((r, i) => (
                <tr key={r.id}>
                  {isAdmin && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                      />
                    </td>
                  )}
                  <td>{page * PAGE_SIZE + i + 1}</td>
                  <td>{projectId}</td>
                  <td>{r.uid}</td>
                  <td>{r.ip_address || '—'}</td>
                  <td>{r.ip_address || '—'}</td>
                  <td>{new Date(r.start_time).toLocaleString()}</td>
                  <td>{r.end_time ? new Date(r.end_time).toLocaleString() : '—'}</td>
                  <td>{r.duration_min != null ? `${r.duration_min} min` : '—'}</td>
                  <td>{r.country || project.country}</td>
                  <td><span className={`badge ${STATUS_CLASS[r.status]}`}>{r.status === 'Disqualify' ? 'Abandoned' : r.status}</span></td>
                  {isAdmin && (
                    <td>
                      <button className="btn-ghost" onClick={() => handleDelete(r)} style={{ color: '#f87171' }}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={colCount + 2} className="empty-row">No respondents match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <button className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page + 1} of {totalPages}</span>
          <button className="btn-ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
      </Reveal>

      {isAdmin && (
        <Reveal>
        <div className="card" style={{ borderLeft: '3px solid #DC2626', marginTop: 20 }}>
          <h2 className="card-title" style={{ color: '#f87171' }}>Danger Zone</h2>
          <p className="card-hint">
            Wipe every respondent row for <strong>{projectId}</strong> — not just this page, all of it, ignoring any filters above. Meant for clearing throwaway test data, not real respondents. This is a soft delete, so an admin can still restore it afterward if needed.
          </p>
          <label style={{ display: 'block', marginTop: 12, marginBottom: 8 }}>
            Type <code>{projectId}</code> to unlock
            <input
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder={projectId}
              style={{ maxWidth: 240, marginTop: 6 }}
            />
          </label>
          <button
            className="btn-ghost"
            onClick={handleClearAllTestData}
            disabled={!clearUnlocked || clearBusy}
            style={{ color: '#f87171', opacity: clearUnlocked ? 1 : 0.5 }}
          >
            {clearBusy ? 'Clearing…' : `Clear All Test Data for ${projectId}`}
          </button>

          <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid rgba(220,38,38,0.3)' }} />

          <h3 style={{ color: '#f87171', fontSize: 15, marginBottom: 4 }}>Delete This Project Permanently</h3>
          <p className="card-hint">
            Removes <strong>{projectId}</strong> itself from Manage Projects — not just its respondent data. This is <strong>not</strong> a soft delete and cannot be undone from inside the app. Only use this for throwaway test projects, never for a project with real client data.
          </p>
          <label style={{ display: 'block', marginTop: 12, marginBottom: 8 }}>
            Type <code>{projectId}</code> to unlock
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={projectId}
              style={{ maxWidth: 240, marginTop: 6 }}
            />
          </label>
          <button
            className="btn-ghost"
            onClick={handleDeleteProject}
            disabled={!deleteUnlocked || deleteBusy}
            style={{ color: '#fff', background: '#DC2626', opacity: deleteUnlocked ? 1 : 0.5 }}
          >
            {deleteBusy ? 'Deleting…' : `Permanently Delete ${projectId}`}
          </button>
        </div>
        </Reveal>
      )}
    </div>
  )
}
