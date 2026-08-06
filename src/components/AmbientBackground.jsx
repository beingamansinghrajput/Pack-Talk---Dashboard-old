// Subtle animated backdrop — a few soft, blurred gradient orbs that drift
// slowly behind the whole app. Pure CSS animation, no dependencies.
// Fixed + pointer-events:none so it never interferes with clicking anything.
export default function AmbientBackground() {
  return (
    <div className="ambient-bg" aria-hidden="true">
      <div className="ambient-orb ambient-orb-1" />
      <div className="ambient-orb ambient-orb-2" />
      <div className="ambient-orb ambient-orb-3" />
    </div>
  )
}
