// Subtle animated backdrop — a few soft, blurred gradient orbs that drift
// slowly behind the whole app, plus a large, very low-opacity guardian
// emblem (helmet + shield) that slowly "breathes" (scale + glow pulse).
// Pure CSS/SVG, no dependencies. Fixed + pointer-events:none so it never
// interferes with clicking anything, and sits behind all real content.
export default function AmbientBackground() {
  return (
    <div className="ambient-bg" aria-hidden="true">
      <div className="ambient-orb ambient-orb-1" />
      <div className="ambient-orb ambient-orb-2" />
      <div className="ambient-orb ambient-orb-3" />

      <div className="guardian-wrap">
        <div className="guardian-ring guardian-ring-1" />
        <div className="guardian-ring guardian-ring-2" />
        <svg
          className="guardian-emblem"
          viewBox="0 0 340 420"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="guardianMetal" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent-2)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
          </defs>

          <polygon
            points="170,20 300,90 300,300 170,370 40,300 40,90"
            fill="none"
            stroke="url(#guardianMetal)"
            strokeWidth="1.5"
          />
          <polygon
            points="170,50 275,105 275,285 170,340 65,285 65,105"
            fill="none"
            stroke="url(#guardianMetal)"
            strokeWidth="0.75"
            opacity="0.6"
          />

          <path
            d="M 130 80
               Q 130 30 170 20
               Q 210 30 210 80
               L 215 160
               Q 215 200 170 215
               Q 125 200 125 160
               Z"
            fill="url(#guardianMetal)"
          />

          <path
            d="M 170 -5
               C 158 -40 146 -60 122 -80
               C 146 -65 163 -55 170 -30
               C 177 -55 194 -65 218 -80
               C 194 -60 182 -40 170 -5
               Z"
            fill="url(#guardianMetal)"
          />
          <rect x="164" y="-10" width="12" height="35" rx="3" fill="url(#guardianMetal)" />

          <path d="M 130 120 L 103 140 L 108 172 L 130 162 Z" fill="url(#guardianMetal)" />
          <path d="M 210 120 L 237 140 L 232 172 L 210 162 Z" fill="url(#guardianMetal)" />
        </svg>
      </div>
    </div>
  )
}
