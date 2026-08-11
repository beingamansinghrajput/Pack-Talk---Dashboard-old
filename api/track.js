import { createClient } from '@supabase/supabase-js'
import { withRetry } from './_lib/withRetry.js'

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

// Fills [UID] / [STATUS] / [COUNTRY] / [AGE_BAND] placeholders in a client's
// return URL. If the URL has none of those placeholders, appends status
// and uid as query params instead so the client still gets the data.
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
  const copyText = `Project ID\tUser ID\tIP Address\tStatus\n${project}\t${uid}\t${ip}\t${statusLabel}`
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Survey Response Recorded</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 28px 32px; max-width: 720px; width: 100%; }
        h1 { font-size: 18px; margin: 0 0 20px 0; text-align: center; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { text-align: left; padding: 10px 14px; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #2a2a3a; }
        td { padding: 14px; font-size: 15px; border-bottom: 1px solid #22222f; font-family: monospace; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: 600; font-size: 13px; background: rgba(34,197,94,0.15); color: #22c55e; }
        .status-badge.term { background: rgba(220,38,38,0.15); color: #f87171; }
        .status-badge.qf { background: rgba(217,119,6,0.15); color: #f59e0b; }
        .meta { text-align: center; color: #666; font-size: 12px; margin-bottom: 16px; }
        .dupe-note { text-align: center; color: #f59e0b; font-size: 12px; margin-bottom: 16px; }
        .redirect-note { text-align: center; color: #888; font-size: 13px; margin-top: 16px; }
        .redirect-note a { color: #a855f7; }
        button { display: block; margin: 0 auto; background: linear-gradient(90deg, #f97316, #a855f7); color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
        button:hover { opacity: 0.9; }
        button:active { transform: scale(0.97); }
        .copied { color: #22c55e; text-align: center; font-size: 13px; margin-top: 10px; min-height: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Response Recorded</h1>
        <div class="meta">Project: ${escapeHtml(project)}</div>
        ${isDuplicateIp ? `<div class="dupe-note">This IP address already submitted a response for this project. Automatically marked Terminated.</div>` : ''}
        <table>
          <thead>
            <tr><th>Project ID</th><th>User ID</th><th>IP Address</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>${escapeHtml(project)}</td>
              <td>${escapeHtml(uid)}</td>
              <td>${escapeHtml(ip)}</td>
              <td><span class="status-badge ${finalStatusKey === 'terminate' || finalStatusKey === 'security' ? 'term' : finalStatusKey === 'quotafull' ? 'qf' : ''}">${escapeHtml(statusLabel)}</span></td>
            </tr>
          </tbody>
        </table>
        <button onclick="copyRow()">Copy</button>
        <div class="copied" id="copiedMsg"></div>
        ${redirectUrl ? `<div class="redirect-note" id="redirectNote">Redirecting you back in a moment… <a href="${escapeHtml(redirectUrl)}">Continue now</a></div>` : ''}
      </div>
      <script>
        function copyRow() {
          const text = ${JSON.stringify(copyText)};
          navigator.clipboard.writeText(text).then(() => {
            document.getElementById('copiedMsg').textContent = 'Copied! Paste directly into Excel.';
          }).catch(() => {
            document.getElementById('copiedMsg').textContent = 'Could not copy automatically.';
          });
        }
        ${redirectUrl ? `setTimeout(function () { window.location.href = ${JSON.stringify(redirectUrl)}; }, 2000);` : ''}
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
        body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 28px 32px; max-width: 600px; width: 100%; }
        h1 { font-size: 18px; margin: 0 0 8px 0; text-align: center; }
        p.sub { text-align: center; color: #888; font-size: 13px; margin: 0 0 22px 0; }
        label { display: block; font-size: 13px; color: #ccc; margin-bottom: 6px; margin-top: 16px; }
        input, textarea { width: 100%; box-sizing: border-box; background: #0f0f16; border: 1px solid #2a2a3a; border-radius: 8px; padding: 10px 12px; color: #fff; font-size: 14px; font-family: inherit; }
        textarea { min-height: 70px; resize: vertical; }
        #opinionBoxes { margin-top: 6px; }
        .opinion-block { margin-top: 14px; }
        .opinion-block label { margin-top: 0; font-weight: 600; color: #f0f0f0; }
        button { display: block; width: 100%; margin-top: 22px; background: linear-gradient(90deg, #f97316, #a855f7); color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
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
          <label>Your Age (Optional)</label>
          <input type="number" id="age" min="1" max="120" />

          <label>Your Gender (Optional)</label>
          <select id="gender" style="width: 100%; box-sizing: border-box; background: #0f0f16; border: 1px solid #2a2a3a; border-radius: 8px; padding: 10px 12px; color: #fff; font-size: 14px; font-family: inherit; margin-bottom: 6px;">
            <option value="">-- Not Specified --</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Others">Others</option>
          </select>

          <label>Number of Opinions Typed (Optional)</label>
          <input type="number" id="opinionsCount" min="0" max="${MAX_OPINIONS}" value="0" />
          <div class="hint">Enter how many separate opinions you have (if any), then the matching number of boxes will appear below.</div>

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
          if (isNaN(n) || n < 0) n = 0
          if (n > MAX_OPINIONS) {
            n = MAX_OPINIONS
            countInput.value = MAX_OPINIONS
          }

          const existing = boxesContainer.querySelectorAll('textarea').length

          if (n > existing) {
            for (let i = existing + 1; i <= n; i++) {
              const div = document.createElement('div')
              div.className = 'opinion-block'
              div.innerHTML = '<label>Opinion ' + i + '</label><textarea data-index="' + i + '" required placeholder="Type or paste opinion ' + i + '..."></textarea>'
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
          const gender = document.getElementById('gender').value
          const opinionsCount = countInput.value || 0
          const textareas = Array.from(boxesContainer.querySelectorAll('textarea'))
          const opinions = textareas.map(t => t.value.trim())

          if (parseInt(opinionsCount, 10) > 0 && (opinions.length === 0 || opinions.some(o => o.length === 0))) {
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
                gender,
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
              document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;background:#0a0a0f;color:#fff"><div style="text-align:center"><h2>Thank you!</h2><p style="color:#888">Redirecting you back...</p></div></div>'
              setTimeout(() => { window.location.href = redirectUrl }, 1500)
            } else {
              const copyStr = "Project ID\\tUser ID\\tIP Address\\tStatus\\n" + 
                              ${JSON.stringify(project)} + "\\t" + 
                              ${JSON.stringify(uid)} + "\\t" + 
                              ${JSON.stringify(ip)} + "\\t" + 
                              "Completed";
              
              document.body.innerHTML = \`
                <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;background:#0a0a0f;color:#fff;padding:20px;">
                  <div style="background:#16161f;border:1px solid #2a2a3a;border-radius:16px;padding:28px 32px;max-width:720px;width:100%;">
                    <h1 style="text-align:center;margin-top:0;margin-bottom:20px;">✓ Response Submitted!</h1>
                    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                      <thead>
                        <tr>
                          <th style="text-align:left;padding:10px 14px;color:#888;font-size:12px;text-transform:uppercase;border-bottom:1px solid #2a2a3a;">Project ID</th>
                          <th style="text-align:left;padding:10px 14px;color:#888;font-size:12px;text-transform:uppercase;border-bottom:1px solid #2a2a3a;">User ID</th>
                          <th style="text-align:left;padding:10px 14px;color:#888;font-size:12px;text-transform:uppercase;border-bottom:1px solid #2a2a3a;">IP Address</th>
                          <th style="text-align:left;padding:10px 14px;color:#888;font-size:12px;text-transform:uppercase;border-bottom:1px solid #2a2a3a;">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style="padding:14px;font-size:15px;border-bottom:1px solid #22222f;font-family:monospace;">\${${JSON.stringify(project)}}</td>
                          <td style="padding:14px;font-size:15px;border-bottom:1px solid #22222f;font-family:monospace;">\${${JSON.stringify(uid)}}</td>
                          <td style="padding:14px;font-size:15px;border-bottom:1px solid #22222f;font-family:monospace;">\${${JSON.stringify(ip)}}</td>
                          <td style="padding:14px;font-size:15px;border-bottom:1px solid #22222f;font-family:monospace;"><span style="display:inline-block;padding:4px 12px;border-radius:20px;font-weight:600;font-size:13px;background:rgba(34,197,94,0.15);color:#22c55e;">Completed</span></td>
                        </tr>
                      </tbody>
                    </table>
                    <button id="copyBtn" style="display:block;margin:0 auto;background:linear-gradient(90deg,#f97316,#a855f7);color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Copy</button>
                    <div id="copyMsg" style="color:#22c55e;text-align:center;font-size:13px;margin-top:10px;min-height:16px;"></div>
                  </div>
                </div>
              \`;

              document.getElementById('copyBtn').addEventListener('click', () => {
                navigator.clipboard.writeText(copyStr).then(() => {
                  document.getElementById('copyMsg').textContent = 'Copied! Paste directly into Excel.';
                }).catch(() => {
                  document.getElementById('copyMsg').textContent = 'Could not copy automatically.';
                });
              });
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
        body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 28px 32px; max-width: 480px; width: 100%; text-align: center; }
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

function notRegisteredHtml() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Respondent Not Registered</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 16px; padding: 28px 32px; max-width: 480px; width: 100%; text-align: center; }
        h1 { font-size: 18px; margin: 0 0 10px 0; }
        p { color: #999; font-size: 14px; }
        code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Respondent Not Registered</h1>
        <p>This UID has not been registered for any project. The client must call <code>POST /api/register-respondent</code> with this respondent&apos;s UID before sending them to a tracking link.</p>
      </div>
    </body>
    </html>
  `
}

export default async function handler(req, res) {
  const { status } = req.query
  let uid = req.query.assignUid || req.query.uid
  let { project, country, age_band } = req.query

  if (!uid || !status) {
    return res.status(400).send('Missing required parameters: link is missing its status or assignUid.')
  }

  const mapping0 = STATUS_MAP[status.toLowerCase()]
  if (!mapping0) {
    return res.status(400).send('Invalid status. Use: complete, terminate, quotafull, or security')
  }
  let mapping = mapping0

  let startTime = new Date().toISOString()

  // 1. Unconditionally check client_link_entries to map the opaque client_facing_id 
  // back to the original UID and fetch the true start time.
  const { data: cleRows } = await withRetry(() =>
    supabase
      .from('client_link_entries')
      .select('project_id, original_uid, created_at')
      .eq('client_facing_id', uid)
      .limit(1)
  )

  const cleEntry = cleRows && cleRows[0]
  if (cleEntry) {
    if (!project) project = cleEntry.project_id
    if (cleEntry.original_uid) uid = cleEntry.original_uid
    if (cleEntry.created_at) startTime = cleEntry.created_at
  }

  // 2. If no project was found (either directly in URL or via entry link),
  // fall back to the respondent registry API.
  if (!project) {
    const { data: regRows, error: regError } = await withRetry(() =>
      supabase
        .from('respondent_registry')
        .select('project_id, country, age_band')
        .eq('uid', uid)
        .order('registered_at', { ascending: false })
        .limit(1)
    )

    if (regError) {
      return res.status(500).send('Error looking up respondent registration: ' + regError.message)
    }

    const registration = regRows && regRows[0]
    if (registration && registration.project_id) {
      project = registration.project_id
      country = registration.country || null
      age_band = registration.age_band || null
    } else {
      res.setHeader('Content-Type', 'text/html')
      return res.status(400).send(notRegisteredHtml())
    }
  }

  const forwarded = req.headers['x-forwarded-for']
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'unknown'

  // Only treat this as a duplicate if a DIFFERENT respondent already
  // COMPLETED this project from the same IP. Shared/NAT'd IPs (offices,
  // mobile carriers, VPNs) are common in panel traffic, so matching on IP
  // alone — regardless of status or who it was — was force-downgrading
  // legitimate quotafull/terminate/security hits to Terminate.
  const { data: existingIpRows } = await withRetry(() =>
    supabase
      .from('responses')
      .select('id, uid')
      .eq('project_id', project)
      .eq('ip_address', ip)
      .eq('completed', true)
      .neq('uid', uid)
      .limit(1)
  )

  const isDuplicateIp = existingIpRows && existingIpRows.length > 0
  let finalStatusKey = status.toLowerCase()

  if (isDuplicateIp) {
    mapping = STATUS_MAP.terminate
    finalStatusKey = 'terminate'
  }

  const now = new Date().toISOString()

  const responseData = {
    project_id: project,
    uid: uid,
    start_time: startTime,
    end_time: now,
    screener_pass: mapping.screener_pass,
    quota_status: mapping.quota_status,
    completed: mapping.completed,
    ip_address: ip,
  }

  if (country) {
    responseData.country = country
  }
  if (age_band) {
    responseData.age_band = age_band
  }

  const { error } = await withRetry(() => supabase.from('responses').insert(responseData))

  if (error) {
    if (error.code === '23503') {
      return res.status(404).send(`Project "${project}" does not exist in PackTalk yet. Create it first, then this link will start logging hits.`)
    }
    if (error.code === '23505') {
      // The respondent already has a response on this project (unique
      // project_id + uid) — update it to the latest status instead of
      // creating a duplicate row.
      const { error: updateError } = await supabase
        .from('responses')
        .update(responseData)
        .eq('project_id', project)
        .eq('uid', uid)
      if (updateError) {
        return res.status(500).send('Error updating response: ' + updateError.message)
      }
    } else {
      return res.status(500).send('Error logging response: ' + error.message)
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

  res.setHeader('Content-Type', 'text/html')

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
