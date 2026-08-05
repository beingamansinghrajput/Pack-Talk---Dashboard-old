import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHEET_TAB_NAME = 'PackTalk Open-Ended Opinions'
const Q = String.fromCharCode(39) // a guaranteed straight single-quote character
const SHEET_RANGE = Q + SHEET_TAB_NAME + Q + '!A:AJ'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed')
  }

  const { project, uid, ip, age, gender, opinionsCount, opinions } = req.body

  if (!project || !uid) {
    return res.status(400).send('Missing required fields.')
  }

  const MAX_OPINIONS = 30
  const safeOpinions = Array.isArray(opinions) ? opinions : []
  const trimmedOpinions = safeOpinions.slice(0, MAX_OPINIONS)
  const paddedOpinions = [
    ...trimmedOpinions,
    ...Array(MAX_OPINIONS - trimmedOpinions.length).fill(''),
  ]

  try {
    // 1. Update Supabase Responses Table
    const { error: dbError } = await supabase
      .from('responses')
      .update({
        age: age || null,
        gender: gender || null,
        opinions_count: opinionsCount ? parseInt(opinionsCount, 10) : 0,
        opinions: JSON.stringify(trimmedOpinions)
      })
      .eq('project_id', project)
      .eq('uid', uid)

    if (dbError) {
      console.error('Supabase update error:', dbError)
    }

    // 2. Save to Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })

    const sheets = google.sheets({ version: 'v4', auth })

    const values = [[
      project,
      uid,
      ip || '',
      gender || '',
      age || '',
      opinionsCount || 0,
      ...paddedOpinions,
      new Date().toISOString(),
    ]]

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.OPINIONS_SHEET_ID,
      range: SHEET_RANGE,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    })

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Save opinions error:', err)
    return res.status(500).json({ error: err.message })
  }
}
