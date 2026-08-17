import { createContext, useContext } from 'react'
import type { ProjectHolidayMap } from './scheduling'

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
