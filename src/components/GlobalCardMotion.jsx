import { useEffect } from 'react'

// Applies the same 3D tilt + cursor-spotlight effect already used on the
// Dashboard KPI cards (see src/lib/tilt.js) to every .card element across
// the whole app automatically — via one delegated listener, not by editing
// every page. New cards that appear later (conditional panels, etc.) are
// picked up automatically via a MutationObserver.
//
// Respects prefers-reduced-motion (checked once; if set, this component
// does nothing at all).

let activeCard = null

function applyTilt(card, clientX, clientY) {
  const rect = card.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  const cx = rect.width / 2
  const cy = rect.height / 2
  const rotateX = ((y - cy) / cy) * -4
  const rotateY = ((x - cx) / cx) * 4

  card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`
  card.style.setProperty('--mx', `${x}px`)
  card.style.setProperty('--my', `${y}px`)
}

function resetTilt(card) {
  if (!card) return
  card.style.transform = ''
}

export default function GlobalCardMotion() {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    function tagCards(root = document) {
      root.querySelectorAll('.card:not(.card-motion)').forEach((el) => {
        el.classList.add('card-motion')
      })
    }

    tagCards()

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length) {
          tagCards()
          break
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    let rafId = null

    function handleMove(e) {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const card = e.target.closest ? e.target.closest('.card-motion') : null

        if (card !== activeCard) {
          resetTilt(activeCard)
          activeCard = card
        }
        if (card) {
          applyTilt(card, e.clientX, e.clientY)
        }
      })
    }

    function handleLeaveWindow() {
      resetTilt(activeCard)
      activeCard = null
    }

    document.addEventListener('mousemove', handleMove, { passive: true })
    document.addEventListener('mouseleave', handleLeaveWindow)

    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseleave', handleLeaveWindow)
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      resetTilt(activeCard)
      activeCard = null
    }
  }, [])

  return null
}
