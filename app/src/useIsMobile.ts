import { useEffect, useState } from 'react'

/**
 * Phone-width layout switch: true below Tailwind's `md` (768px). Use it only
 * where BEHAVIOUR changes (drawer vs docked sidebar, `⋯` menu); pure styling
 * belongs in `md:` classes or the index.css "Mobile layout" block so the two
 * can never disagree mid-resize. See design-docs/mobile-layout.md.
 */
export const MOBILE_QUERY = '(max-width: 767px)'

function matches(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE_QUERY).matches
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(matches)
  useEffect(() => {
    const mq = window.matchMedia?.(MOBILE_QUERY)
    if (!mq) return
    const onChange = () => setMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
