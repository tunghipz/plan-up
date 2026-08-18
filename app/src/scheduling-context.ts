import { createContext, useContext } from 'react'
import type { ProjectHolidayMap } from './scheduling'
import type { Holiday } from './types'

/**
 * The current project's holidays, in the shape the scheduler wants.
 *
 * Why a context and not a prop: the views compute one `planById` pass at the
 * root and pass it down, but a dozen leaf components still keep a defensive
 * `planById.get(id) ?? computeWorkingPlan(...)` fallback. Threading the map
 * through every one of those prop chains would be noise, and a fallback that
 * silently scheduled WITHOUT holidays would disagree with the row beside it.
 * `scheduling.ts` itself stays framework-free (tests import it without React) —
 * the React seam lives here.
 *
 * Consumed as a raw context (`<ProjectHolidaysContext value={map}>`) rather than
 * a wrapper component, mirroring `SprintRangeContext`. Default is an empty map,
 * so anything rendered outside a provider behaves exactly as it did before
 * holidays existed. See design-docs/project-holidays.md.
 */
export const ProjectHolidaysContext = createContext<ProjectHolidayMap>(new Map())

export function useProjectHolidays(): ProjectHolidayMap {
  return useContext(ProjectHolidaysContext)
}

/**
 * The same holidays, but as the NAMED list the UI needs — the Timeline band's
 * tooltip, the days-off popover's read-only block, the member chip.
 *
 * Kept separate from `ProjectHolidaysContext` on purpose: that one is the
 * scheduler's `Map<projectId, DayOff[]>` and is deliberately name-less, because
 * dragging display strings into the scheduling core buys nothing and `plan`
 * math has no use for them. Two contexts, two audiences, one subscription each.
 *
 * Before this existed, `MemberDaysOffButton` opened its own
 * `useLiveQuery(db.projects.get(...))` — once PER MEMBER CARD, all reading the
 * same row and all woken by every holiday save — and GanttView opened another,
 * while App already held `currentProject` a few lines above the render site.
 * See design-docs/project-holidays.md.
 */
export const ProjectHolidayListContext = createContext<Holiday[]>([])

export function useProjectHolidayList(): Holiday[] {
  return useContext(ProjectHolidayListContext)
}
