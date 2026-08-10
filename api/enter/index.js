import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

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
    if (/[?&]uid=/.test(template)) {
      return template.replace(/([?&]uid=)[^&]*/, `$1${clientFacingId}`)
    }
    const sep = template.includes('?') ? '&' : '?'
    return `${template}${sep}uid=${clientFacingId}`
  }
}

function errorHtml(title, message) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 28px 32px; max-width: 480px; width: 100%; text-align: center; }
        h1 { font-size: 18px; margin: 0 0 10px 0; }
        p { color: #999; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
      </div>
    </body>
    </html>
  `
}

export default async function handler(req, res) {
  const token = req.query.p || req.query.token

  if (!token) {
    res.setHeader('Content-Type', 'text/html')
    return res.status(400).send(errorHtml('Missing Link', 'This entry link is incomplete.'))
  }

  // Looked up by the opaque entry_token only — the project's real ID is
  // never present in this URL and never exposed to whoever clicks it.
  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .select('project_id, survey_link, status')
    .eq('entry_token', token)
    .maybeSingle()

  if (projectError) {
    res.setHeader('Content-Type', 'text/html')
    return res.status(500).send(errorHtml('Error', 'Could not look up this survey. Please try again in a moment.'))
  }

  if (!projectRow || !projectRow.survey_link) {
    res.setHeader('Content-Type', 'text/html')
    return res.status(404).send(errorHtml('Survey Not Found', 'This link is not recognized.'))
  }

  if (projectRow.status && projectRow.status !== 'Live') {
    res.setHeader('Content-Type', 'text/html')
    return res.status(410).send(errorHtml('Survey Not Available', 'This survey is not currently live.'))
  }

  let clientFacingId = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomClientFacingId()
    const { data: existing } = await supabase
      .from('client_link_entries')
      .select('id')
      .eq('client_facing_id', candidate)
      .maybeSingle()
    if (!existing) {
      clientFacingId = candidate
      break
    }
  }

  if (!clientFacingId) {
    res.setHeader('Content-Type', 'text/html')
    return res.status(500).send(errorHtml('Error', 'Could not generate a unique respondent ID. Please try again.'))
  }

  const finalLink = buildFinalLink(projectRow.survey_link, clientFacingId)

  const originalUid = req.query.uid;
  const dbUid = originalUid || ("UNASSIGNED-" + clientFacingId);

  const { error: entryError } = await supabase.from('client_link_entries').insert({
    project_id: projectRow.project_id,
    client_facing_id: clientFacingId,
    original_uid: dbUid,
    final_link: finalLink,
  })

  if (entryError) {
    console.error('client_link_entries insert failed:', entryError.message)
  }

  // Log the initial "Abandoned" hit in responses.
  // We don't block or error if it fails (e.g. duplicate uid) since they should still proceed to the survey.
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  await supabase.from('responses').insert({
    project_id: projectRow.project_id,
    uid: dbUid,
    start_time: new Date().toISOString(),
    screener_pass: true,
    quota_status: 'Open',
    completed: false,
    ip_address: ip,
  })

  res.writeHead(302, { Location: finalLink })
  res.end()
}
