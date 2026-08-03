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

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: projectData }, { data: teamData }, { data: tpData }, { data: memberData }, { data: rateData }, { data: quotaData }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('teams').select('*').order('name'),
      supabase.from('team_projects').select('*'),
      supabase.from('profiles').select('*'),
      supabase.from('rates').select('*'),
      supabase.from('project_quotas').select('*'),
    ])
    setProjects(projectData || [])
    setTeams(teamData || [])
    setTeamProjects(tpData || [])
    setMembers(memberData || [])
    setRates(rateData || [])
    setAllQuotas(quotaData || [])
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
      load
