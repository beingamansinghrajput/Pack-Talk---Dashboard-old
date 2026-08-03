import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // Full CORS support so the client's frontend can call this directly.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = req.headers['x-api-key']
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-api-key header.' })
  }

  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('label')
    .eq('key_val', apiKey)
    .eq('is_active', true)
    .maybeSingle()

  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid or inactive API key.' })
  }

  const { project_id, uid, country, age_band } = req.body || {}

  if (!project_id || !uid) {
    return res.status(400).json({ error: 'project_id and uid are required.' })
  }

  const { data: projectRow } = await supabase
    .from('projects')
    .select('project_id')
    .eq('project_id', project_id)
    .maybeSingle()

  if (!projectRow) {
    return res.status(404).json({
      error: `Project "${project_id}" does not exist in PackTalk yet. Create it first, then register respondents.`,
    })
  }

  const { error } = await supabase.from('respondent_registry').insert({
    project_id,
    uid,
    country: country || null,
    age_band: age_band || null,
    status: 'pending',
  })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.status(201).json({ success: true, project_id, uid })
}
