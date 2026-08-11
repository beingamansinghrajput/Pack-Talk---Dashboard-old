import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const STATUS_MAP = {
  complete: { completed: true, screener_pass: true, quota_status: 'Open' },
  terminate: { completed: false, screener_pass: false, quota_status: 'Open' },
  quotafull: { completed: false, screener_pass: true, quota_status: 'Full' },
  security: { completed: false, screener_pass: false, quota_status: 'Open' },
}

const MAX_OPINIONS = 30
const RATE_LIMIT_MAX_HITS = 10
const RATE_LIMIT_WINDOW_SECONDS = 60

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildClientRedirectUrl(template, { uid, status, country, age_band }) {
  if (!template) return null
  const hasPlaceholder = /\[(UID|STATUS|COUNTRY|AGE_BAND)\]/i.test(template)
  let url = template
    .replace(/\[UID\]/gi, encodeURIComponent(uid))
    .replace(/\[STATUS\]/gi, encodeURIComponent(status))
    .replace(/\[COUNTRY\]/gi, encodeURIComponent(country || ''))
    .replace(/\[AGE_BAND\]/gi, encodeURIComponent(age_band || ''))
  if (!hasPlaceholder) {
    const sep = url.includes('?') ? '&' : '?'
    url += `${sep}status=${encodeURIComponent(status)}&uid=${encodeURIComponent(uid)}`
  }
  return url
}

function confirmationHtml({ project, uid, ip, statusLabel, finalStatusKey, isDuplicateIp, redirectUrl }) {
  const copyText = `UID / Sting ID\tIP Address\tStatus\n${uid}\t${ip}\t${statusLabel}`
  return `
<!DOCTYPE html>
<html>
<head>
<title>Survey Response Recorded</title>
<style>
body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 32px; width: 420px; }
h1 { font-size: 18px; margin: 0 0 20px 0; text-align: center; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
th { text-align: left; padding: 10px 14px; color: #888; font-size: 12px; text-transform: uppercase; }
td { padding: 14px; font-size: 15px; border-bottom: 1px solid #22222f; font-family: monospace; }
.status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; background: rgba(34,197,94,0.15); color: #4ade80; }
.status-badge.term { background: rgba(220,38,38,0.15); color: #f87171; }
.status-badge.qf { background: rgba(217,119,6,0.15); color: #f59e0b; }
.meta { text-align: center; color: #666; font-size: 12px; margin-bottom: 16px; }
.dupe-note { text-align: center; color: #f59e0b; font-size: 12px; margin-bottom: 16px; }
.redirect-note { text-align: center; color: #888; font-size: 13px; margin-top: 16px; }
.redirect-note a { color: #a855f7; }
button { display: block; margin: 0 auto; background: linear-gradient(90deg, #f97316, #a855f7); color: #fff; border: none; border-radius: 10px; padding: 12px 24px; font-size: 14px; cursor: pointer; }
button:hover { opacity: 0.9; }
button:active { transform: scale(0.97); }
.copied { color: #22c55e; text-align: center; font-size: 13px; margin-top: 10px; min-height: 16px; }
</style>
</head>
<body>
<div class="card">
<h1>Response Recorded</h1>
<div class="meta">Project: ${escapeHtml(project)}</div>
${isDuplicateIp ? `<div class="dupe-note">This IP address already submitted a response for this project — recorded as Terminate.</div>` : ''}
<table>
<thead>
<tr><th>UID / Sting ID</th><th>IP Address</th><th>Status</th></tr>
</thead>
<tbody>
<tr>
<td>${escapeHtml(uid)}</td>
<td>${escapeHtml(ip)}</td>
<td><span class="status-badge ${finalStatusKey === 'terminate' || finalStatusKey === 'security' ? 'term' : finalStatusKey === 'quotafull' ? 'qf' : ''}">${escapeHtml(statusLabel)}</span></td>
</tr>
</tbody>
</table>
<button onclick="copyRow()">Copy</button>
<div class="copied" id="copiedMsg"></div>
${redirectUrl ? `<div class="redirect-note" id="redirectNote">Redirecting you back shortly. <a href="${redirectUrl}">Click here if not redirected.</a></div>` : ''}
</div>
<script>
function copyRow() {
  const text = ${JSON.stringify(copyText)};
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('copiedMsg').textContent = 'Copied! Paste directly into your sheet.'
  }).catch(() => {
    document.getElementById('copiedMsg').textContent = 'Could not copy automatically — select and copy manually.'
  });
}
${redirectUrl ? `setTimeout(function () { window.location.href = ${JSON.stringify(redirectUrl)} }, 1800)` : ''}
</script>
</body>
</html>
`
}

function opinionsFormHtml({ project, uid, ip, redirectUrl }) {
  return `
<!DOCTYPE html>
<html>
<head>
<title>One Last Step</title>
<style>
body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 32px; width: 420px; }
h1 { font-size: 18px; margin: 0 0 8px 0; text-align: center; }
p.sub { text-align: center; color: #888; font-size: 13px; margin: 0 0 22px 0; }
label { display: block; font-size: 13px; color: #ccc; margin-bottom: 6px; margin-top: 14px; }
input, textarea { width: 100%; box-sizing: border-box; background: #0f0f16; border: 1px solid #2a2a3a; border-radius: 8px; padding: 10px 12px; color: #fff; font-size: 14px; }
textarea { min-height: 70px; resize: vertical; }
#opinionBoxes { margin-top: 6px; }
.opinion-block { margin-top: 14px; }
.opinion-block label { margin-top: 0; font-weight: 600; color: #f0f0f0; }
button { display: block; width: 100%; margin-top: 22px; background: linear-gradient(90deg, #f97316, #a855f7); color: #fff; border: none; border-radius: 10px; padding: 12px 24px; font-size: 14px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button:active:not(:disabled) { transform: scale(0.98); }
.err { color: #f87171; font-size: 13px; margin-top: 10px; text-align: center; min-height: 16px; }
.hint { font-size: 12px; color: #666; margin-top: 4px; }
</style>
</head>
<body>
<div class="card">
<h1>Almost done</h1>
<p class="sub">Please answer a couple of quick questions before you finish.</p>
<form id="opinionsForm">
<label>Your Age</label>
<input type="number" id="age" min="1" max="120" required />
<label>Number of Opinions Typed</label>
<input type="number" id="opinionsCount" min="1" max="${MAX_OPINIONS}" required />
<div class="hint">Enter how many separate opinions you have, then the matching number of boxes will appear below.</div>
<div id="opinionBoxes"></div>
<button type="submit" id="submitBtn">Submit</button>
<div class="err" id="errMsg"></div>
</form>
</div>
<script>
const MAX_OPINIONS = ${MAX_OPINIONS}
const countInput = document.getElementById('opinionsCount')
const boxesContainer = document.getElementById('opinionBoxes')
const form = document.getElementById('opinionsForm')
const btn = document.getElementById('submitBtn')
const errMsg = document.getElementById('errMsg')

function renderBoxes() {
  let n = parseInt(countInput.value, 10)
  if (isNaN(n) || n < 1) n = 0
  if (n > MAX_OPINIONS) {
    n = MAX_OPINIONS
    countInput.value = MAX_OPINIONS
  }
  const existing = boxesContainer.querySelectorAll('textarea').length
  if (n > existing) {
    for (let i = existing + 1; i <= n; i++) {
      const div = document.createElement('div')
      div.className = 'opinion-block'
      div.innerHTML = '<label>Opinion ' + i + '</label><textarea data-index="' + i + '"></textarea>'
      boxesContainer.appendChild(div)
    }
  } else if (n < existing) {
    const blocks = boxesContainer.querySelectorAll('.opinion-block')
    for (let i = blocks.length - 1; i >= n; i--) {
      blocks[i].remove()
    }
  }
}
countInput.addEventListener('input', renderBoxes)

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  errMsg.textContent = ''
  const age = document.getElementById('age').value
  const opinionsCount = countInput.value
  const textareas = Array.from(boxesContainer.querySelectorAll('textarea'))
  const opinions = textareas.map(t => t.value.trim())

  if (opinions.length === 0 || opinions.some(o => o.length === 0)) {
    errMsg.textContent = 'Please fill in all opinion boxes.'
    return
  }

  btn.disabled = true
  btn.textContent = 'Submitting...'

  try {
    const res = await fetch('/api/save-opinions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: ${JSON.stringify(project)},
        uid: ${JSON.stringify(uid)},
        ip: ${JSON.stringify(ip)},
        age,
        opinionsCount,
        opinions,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Something went wrong. Please try again.')
    }
    const redirectUrl = ${JSON.stringify(redirectUrl || null)}
    if (redirectUrl) {
      document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff;font-family:-apple-system,sans-serif;">Thanks! Redirecting you now...</div>'
      setTimeout(() => { window.location.href = redirectUrl }, 1500)
    } else {
      document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff;font-family:-apple-system,sans-serif;">Thanks for completing the survey!</div>'
    }
  } catch (err) {
    errMsg.textContent = err.message
    btn.disabled = false
    btn.textContent = 'Submit'
  }
})
</script>
</body>
</html>
`
}

function rateLimitedHtml() {
  return `
<!DOCTYPE html>
<html>
<head>
<title>Too Many Requests</title>
<style>
body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 32px; width: 420px; text-align: center; }
h1 { font-size: 18px; margin: 0 0 10px 0; }
p { color: #999; font-size: 14px; }
</style>
</head>
<body>
<div class="card">
<h1>Too Many Requests</h1>
<p>This link has been hit too many times in a short period from this connection. Please wait a moment and try again.</p>
</div>
</body>
</html>
`
}

function invalidLinkHtml(reason) {
  return `
<!DOCTYPE html>
<html>
<head>
<title>Invalid Link</title>
<style>
body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 32px; width: 420px; text-align: center; }
h1 { font-size: 18px; margin: 0 0 10px 0; }
p { color: #999; font-size: 14px; }
</style>
</head>
<body>
<div class="card">
<h1>Invalid or Inactive Link</h1>
<p>${escapeHtml(reason)}</p>
</div>
</body>
</html>
`
}

export default async function handler(req, res) {
  const { token, status } = req.query
  const uid = req.query.assignUid || req.query.uid
  res.setHeader('Content-Type', 'text/html')

  if (!token || !status) {
    return res.status(400).send(invalidLinkHtml('This link is missing required parts.'))
  }
  if (!uid) {
    return res.status(400).send(invalidLinkHtml('Missing respondent ID (assignUid) parameter.'))
  }

  const mapping = STATUS_MAP[status.toLowerCase()]
  if (!mapping) {
    return res.status(400).send(invalidLinkHtml('Unrecognized status in this link.'))
  }

  const { data: linkRow } = await supabase
    .from('survey_links')
    .select('project_id, country, age_band, active')
    .eq('token', token)
    .maybeSingle()

  if (!linkRow || !linkRow.active) {
    return res.status(404).send(invalidLinkHtml('This link is not recognized or has been deactivated.'))
  }

  const project = linkRow.project_id
  const country = linkRow.country
  const age_band = linkRow.age_band

  const forwarded = req.headers['x-forwarded-for']
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'unknown'

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
  const { count: recentHitCount } = await supabase
    .from('track_hits')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project)
    .eq('ip_address', ip)
    .gte('created_at', windowStart)

  if ((recentHitCount || 0) >= RATE_LIMIT_MAX_HITS) {
    return res.status(429).send(rateLimitedHtml())
  }

  await supabase.from('track_hits').insert({ project_id: project, ip_address: ip })

  // Only treat this as a duplicate if a DIFFERENT respondent already
  // COMPLETED this project from the same IP. Shared/NAT'd IPs (offices,
  // mobile carriers, VPNs) are common in panel traffic, so matching on IP
  // alone — regardless of status or who it was — was force-downgrading
  // legitimate quotafull/terminate/security hits to Terminate.
  const { data: existingIpRows } = await supabase
    .from('responses')
    .select('id, uid')
    .eq('project_id', project)
    .eq('ip_address', ip)
    .eq('completed', true)
    .neq('uid', uid)
    .limit(1)

  const isDuplicateIp = existingIpRows && existingIpRows.length > 0

  let finalMapping = mapping
  let finalStatusKey = status.toLowerCase()
  if (isDuplicateIp) {
    finalMapping = STATUS_MAP.terminate
    finalStatusKey = 'terminate'
  }

  const now = new Date().toISOString()
  const responseData = {
    project_id: project,
    uid: uid,
    start_time: now,
    end_time: now,
    country: country || null,
    age_band: age_band || null,
    screener_pass: finalMapping.screener_pass,
    quota_status: finalMapping.quota_status,
    completed: finalMapping.completed,
    ip_address: ip,
  }

  const { error } = await supabase.from('responses').insert(responseData)

  if (error) {
    if (error.code === '23503') {
      return res.status(404).send(invalidLinkHtml(`Project "${project}" does not exist in PackTalk yet.`))
    }
    if (error.code === '23505') {
      // Same project_id + uid already has a response — update it to the
      // latest status instead of erroring, matching api/track.js behavior.
      const { error: updateError } = await supabase
        .from('responses')
        .update(responseData)
        .eq('project_id', project)
        .eq('uid', uid)
      if (updateError) {
        return res.status(500).send(invalidLinkHtml('Error updating response: ' + updateError.message))
      }
    } else {
      return res.status(500).send(invalidLinkHtml('Error logging response: ' + error.message))
    }
  }

  let clientRedirectTemplate = null
  if (country) {
    const ageBandForLookup = age_band && age_band.trim() ? age_band : 'All'
    const { data: quotaMatch } = await supabase
      .from('project_quotas')
      .select('client_redirect_url')
      .eq('project_id', project)
      .eq('country', country)
      .eq('age_band', ageBandForLookup)
      .not('client_redirect_url', 'is', null)
      .limit(1)
      .maybeSingle()
    clientRedirectTemplate = quotaMatch?.client_redirect_url || null
  }

  const redirectUrl = buildClientRedirectUrl(clientRedirectTemplate, { uid, status: finalStatusKey, country, age_band })

  if (finalStatusKey === 'complete' && !isDuplicateIp) {
    return res.status(200).send(opinionsFormHtml({ project, uid, ip, redirectUrl }))
  }

  const statusLabel = {
    complete: 'Completed',
    terminate: 'Terminated',
    quotafull: 'Quota Full',
    security: 'Security Terminated',
  }[finalStatusKey]

  return res.status(200).send(confirmationHtml({ project, uid, ip, statusLabel, finalStatusKey, isDuplicateIp, redirectUrl }))
}
