import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // --- Verify the caller is actually an Admin or Team Lead ---
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' })
  }

  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
  if (callerError || !callerData?.user) {
    return res.status(401).json({ error: 'Invalid session' })
  }

  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('profiles')
    .select('role, team_id')
    .eq('id', callerData.user.id)
    .single()

  if (callerProfileError || !callerProfile) {
    return res.status(403).json({ error: 'Could not verify permissions' })
  }

  const isAdminCaller = callerProfile.role === 'admin'
  const isTeamLeadCaller = callerProfile.role === 'team_lead'

  if (!isAdminCaller && !isTeamLeadCaller) {
    return res.status(403).json({ error: 'Only Admins and Team Leads can add employees' })
  }

  // --- Validate input ---
  const { name, email, password, uid_prefix } = req.body
  let { role, team_id } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' })
  }

  if (isTeamLeadCaller) {
    // Team Leads can only create Survey Analysts on their own team — ignore
    // whatever role/team was sent from the client and force it server-side.
    role = 'tl'
    team_id = callerProfile.team_id
    if (!team_id) {
      return res.status(400).json({ error: 'You are not assigned to a team yet — ask an admin to assign you to one first.' })
    }
  } else {
    // Admin: allowed to set either role, defaults to Survey Analyst
    if (!['team_lead', 'tl'].includes(role)) {
      role = 'tl'
    }
  }

  try {
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (userError) {
      return res.status(400).json({ error: userError.message })
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: name,
        role,
        team_id: team_id || null,
      })
      .eq('id', userData.user.id)

    if (profileError) {
      return res.status(400).json({ error: profileError.message })
    }

    const cleanedPrefix = uid_prefix ? uid_prefix.trim().toUpperCase() : null
    if (cleanedPrefix) {
      const { error: stingError } = await supabaseAdmin
        .from('sting_prefixes')
        .insert({ profile_id: userData.user.id, prefix: cleanedPrefix })
      if (stingError) {
        // Account was created successfully — just flag that the sting code didn't save
        return res.status(200).json({
          success: true,
          id: userData.user.id,
          warning: `Account created, but the sting code "${cleanedPrefix}" could not be saved: ${stingError.message}`,
        })
      }
    }

    return res.status(200).json({ success: true, id: userData.user.id })
  } catch (err) {
    console.error('Create employee error:', err)
    return res.status(500).json({ error: err.message })
  }
}
