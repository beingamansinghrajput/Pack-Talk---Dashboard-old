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
    return res.status(403).json({ error: 'Only Admins and Team Leads can remove employees' })
  }

  const { profile_id, reinstate } = req.body

  if (!profile_id) {
    return res.status(400).json({ error: 'profile_id is required' })
  }

  if (profile_id === callerData.user.id) {
    return res.status(400).json({ error: 'You cannot fire your own account.' })
  }

  // --- Look up the target so we can enforce who's allowed to touch them ---
  const { data: targetProfile, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('role, team_id, full_name')
    .eq('id', profile_id)
    .single()

  if (targetError || !targetProfile) {
    return res.status(404).json({ error: 'Employee not found' })
  }

  if (targetProfile.role === 'admin' || targetProfile.role === 'client') {
    return res.status(403).json({ error: 'This endpoint cannot remove Admins or Clients.' })
  }

  if (isTeamLeadCaller) {
    // Team Leads can only fire Survey Analysts on their own team
    if (targetProfile.role !== 'tl' || targetProfile.team_id !== callerProfile.team_id) {
      return res.status(403).json({ error: 'You can only remove Survey Analysts on your own team.' })
    }
  }

  try {
    // Ban or unban the actual login
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(profile_id, {
      ban_duration: reinstate ? 'none' : '876000h', // ~100 years = effectively permanent
    })

    if (banError) {
      return res.status(400).json({ error: banError.message })
    }

    // Flip the active flag; free up their team slot when firing
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        is_active: !!reinstate,
        team_id: reinstate ? targetProfile.team_id : null,
      })
      .eq('id', profile_id)

    if (profileError) {
      return res.status(400).json({ error: profileError.message })
    }

    return res.status(200).json({ success: true, reinstated: !!reinstate })
  } catch (err) {
    console.error('Fire employee error:', err)
    return res.status(500).json({ error: err.message })
  }
}
