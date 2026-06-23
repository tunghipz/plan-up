import { describe, expect, it } from 'vitest'
import { aiSystemPrompt, buildAiContext } from './ai/context'
import type { AiRuntimeContext } from './ai/types'

function context(overrides: Partial<AiRuntimeContext> = {}): AiRuntimeContext {
  return {
    today: '2026-06-23',
    screen: 'project',
    containerKind: 'sprint',
    view: 'list',
    project: { id: 'project-1', name: 'Plan Up', createdAt: 0 },
    sprint: {
      id: 'sprint-1',
      projectId: 'project-1',
      name: 'Sprint 1',
      startDate: '2026-06-22',
      endDate: '2026-07-05',
      note: 'Close onboarding gaps',
    },
    collection: null,
    collections: [],
    sprints: [],
    members: [],
    tasks: [],
    ...overrides,
  }
}

describe('AI context', () => {
  it('tells the model to return actions for supported mutations', () => {
    expect(aiSystemPrompt()).toContain('return at least one typed action')
    expect(aiSystemPrompt()).toContain('Do not answer only in prose')
  })

  it('includes the selected sprint identity, dates, and note', () => {
    expect(buildAiContext(context())).toContain(
      'Sprint: Sprint 1 [sprint-1] · 2026-06-22 to 2026-07-05 · note: Close onboarding gaps'
    )
  })

  it('keeps an explicit no-sprint marker when no sprint is selected', () => {
    expect(buildAiContext(context({ sprint: null }))).toContain(
      'Sprint: No sprint selected'
    )
  })

  it('includes member days off in project context', () => {
    expect(
      buildAiContext(
        context({
          members: [
            {
              id: 'member-1',
              projectId: 'project-1',
              name: 'An',
              color: '#0071E3',
              daysOff: [{ date: '2026-06-24', half: 'am' }],
            },
          ],
        })
      )
    ).toContain('- An [member-1] · days off: 2026-06-24 (am)')
  })

  it('includes active sprint choices for collection planning', () => {
    expect(
      buildAiContext(
        context({
          sprints: [
            {
              id: 'sprint-2',
              projectId: 'project-1',
              name: 'Sprint 2',
              startDate: '2026-07-06',
              endDate: '2026-07-19',
            },
          ],
        })
      )
    ).toContain('- Sprint 2 [sprint-2] · 2026-07-06 to 2026-07-19')
  })

  it('includes collection choices and item counts', () => {
    expect(
      buildAiContext(
        context({
          collections: [
            {
              id: 'collection-1',
              projectId: 'project-1',
              name: 'Roadmap',
              order: 1,
              sections: [],
              statuses: [],
              createdAt: 0,
            },
          ],
          collectionItemCounts: { 'collection-1': 3 },
        })
      )
    ).toContain('- Roadmap [collection-1] · 3 items')
  })
})
