import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // Setup CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = req.headers['x-api-key']
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' })
  }

  // Validate API key in database
  const { data: keyData, error: keyError } = await supabase
    .from('api_keys')
    .select('id, is_active')
    .eq('key_val', apiKey)
    .maybeSingle()

  if (keyError || !keyData || !keyData.is_active) {
    return res.status(401).json({ error: 'Invalid or inactive API key' })
  }

  const { project_id, uid, country, age_band } = req.body

  if (!project_id || !uid) {
    return res.status(400).json({ error: 'Missing required fields: project_id and uid' })
  }

  // Check if project exists
  const { data: projectData, error: projectError } = await supabase
    .from('projects')
    .select('project_id')
    .eq('project_id', project_id)
    .maybeSingle()

  if (projectError || !projectData) {
    return res.status(404).json({ error: `Project "${project_id}" does not exist in PackTalk.` })
  }

  // Insert a new registration mapping
  const { error: insertError } = await supabase
    .from('respondent_registry')
    .insert({
      uid,
      project_id,
      country: country || null,
      age_band: age_band || null
    })

  if (insertError) {
    return res.status(500).json({ error: 'Failed to register respondent: ' + insertError.message })
  }

  return res.status(200).json({ success: true })
}
