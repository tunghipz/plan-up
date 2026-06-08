import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Trash2, UserPlus } from 'lucide-react'
import {
  db,
  uid,
  colorForName,
  deleteProject,
  updateProject,
  deleteMember,
  type Project,
  type Member,
} from './db'
import {
  Avatar,
  ColorSwatchRow,
  MemberColorDot,
  MemberDaysOffButton,
} from './members'
import { useConfirm } from './ConfirmDialog'

/**
 * Settings for the current project: edit the project's own info (name /
 * description / color) and manage its members (name, color, days-off,
 * add/remove). Rendered inside a right-side drawer (App.tsx owns the backdrop
 * + slide); this component is just the header + scrollable body, sized for a
 * narrow single column. See design-docs/project-member-settings.md.
 */
export function ProjectSettingsView({
  project,
  onClose,
}: {
  project: Project
  onClose: () => void
}) {
  const confirm = useConfirm()
  const members = useLiveQuery(
    () => db.members.where('projectId').equals(project.id).toArray(),
    [project.id]
  )

  const [name, setName] = useState(project.name)
  const [desc, setDesc] = useState(project.description ?? '')
  // Re-sync drafts only when switching to a different project (rail click while
  // settings is open). Within the same project the inputs are the source of
  // truth — depending on project.name/description here would let one field's
  // commit (which updates the live row) wipe the other field's in-progress draft.
  useEffect(() => {
    setName(project.name)
    setDesc(project.description ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const commitName = () => {
    const n = name.trim()
    if (!n || n === project.name) {
      setName(project.name)
      return
    }
    void updateProject(project.id, { name: n })
  }
  const commitDesc = () => {
    if (desc === (project.description ?? '')) return
    void updateProject(project.id, { description: desc })
  }

  const removeProject = async () => {
    if (
      !(await confirm({
        title: 'Delete project?',
        message: `“${project.name}” and all its sprints, tasks, and members will be permanently deleted. This can’t be undone.`,
        confirmLabel: 'Delete',
      }))
    )
      return
    await deleteProject(project.id)
    onClose()
  }

  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden">
      <header className="h-[54px] shrink-0 border-b border-border-hair bg-surface flex items-center px-5 gap-3">
        <h1 className="text-[15px] font-semibold text-ink tracking-[-0.01em]">
          Project settings
        </h1>
        <button
          onClick={onClose}
          className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
          title="Close settings (Esc)"
          aria-label="Close settings"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-auto bg-canvas px-5 py-5">
        <div className="space-y-4">
          {/* Project card */}
          <section className="bg-surface rounded-[14px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)] space-y-4">
            <h2 className="text-[12px] font-semibold text-ink-faint uppercase tracking-wide">
              Project
            </h2>
            <label className="block">
              <span className="text-xs text-ink-muted">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    ;(e.target as HTMLInputElement).blur()
                  } else if (e.key === 'Escape') {
                    setName(project.name)
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                className="editable mt-1 block w-full text-[17px] font-semibold text-ink bg-transparent tracking-[-0.01em]"
                aria-label="Project name"
              />
            </label>
            <label className="block">
              <span className="text-xs text-ink-muted">Description</span>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onBlur={commitDesc}
                rows={3}
                placeholder="What is this project about?"
                className="mt-1 block w-full text-sm text-ink bg-canvas border border-border rounded-[8px] px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition placeholder:text-ink-faint"
                aria-label="Project description"
              />
            </label>
            <div>
              <span className="text-xs text-ink-muted">Color</span>
              <div className="mt-1.5">
                <ColorSwatchRow
                  value={project.color ?? colorForName(project.name)}
                  onPick={(c) => void updateProject(project.id, { color: c })}
                />
              </div>
            </div>
          </section>

          {/* Members card */}
          <section className="bg-surface rounded-[14px] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
            <h2 className="text-[12px] font-semibold text-ink-faint uppercase tracking-wide mb-2">
              Members{' '}
              <span className="text-ink-faint/70 normal-case font-normal">
                · {members?.length ?? 0}
              </span>
            </h2>
            <div className="-mx-2">
              {members?.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
              {members && members.length === 0 && (
                <div className="px-3 py-2 text-sm text-ink-faint italic">
                  No members yet.
                </div>
              )}
            </div>
            <AddMember projectId={project.id} />
          </section>

          {/* Danger zone */}
          <section className="rounded-[14px] p-5 border border-red-500/25 bg-red-500/[0.03]">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-red-500/90">
              Danger zone
            </h2>
            <div className="flex items-center justify-between gap-4 mt-2">
              <p className="text-sm text-ink-muted">
                Delete this project and everything in it — sprints, tasks, and
                members. This cannot be undone.
              </p>
              <button
                onClick={removeProject}
                className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400 border border-red-500/40 hover:bg-red-500/10 rounded-[8px] px-3 py-1.5 transition"
              >
                <Trash2 size={14} /> Delete project
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** One editable member row: avatar, name, color, days-off, delete. */
function MemberRow({ member }: { member: Member }) {
  const confirm = useConfirm()
  const [name, setName] = useState(member.name)
  useEffect(() => setName(member.name), [member.id, member.name])

  const [title, setTitle] = useState(member.title ?? '')
  useEffect(() => setTitle(member.title ?? ''), [member.id, member.title])

  const commit = () => {
    const n = name.trim()
    if (!n || n === member.name) {
      setName(member.name)
      return
    }
    void db.members.update(member.id, { name: n })
  }
  // Title is optional free-text; empty string means "no title" (display sites
  // treat falsy as absent). See design-docs/member-title.md.
  const commitTitle = () => {
    const t = title.trim()
    if (t === (member.title ?? '')) return
    void db.members.update(member.id, { title: t })
  }
  const remove = async () => {
    if (
      !(await confirm({
        title: 'Remove member?',
        message: `“${member.name}” will be removed. Their tasks become Unassigned (not deleted).`,
        confirmLabel: 'Remove',
      }))
    )
      return
    void deleteMember(member.id)
  }

  return (
    <div className="group/card flex items-center gap-3 py-2 px-3 rounded-[10px] hover:bg-surface-hover transition">
      <Avatar member={member} />
      <div className="flex flex-col min-w-0 flex-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              setName(member.name)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="editable text-sm font-medium text-ink min-w-0 bg-transparent self-start max-w-full"
          aria-label="Member name"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              setTitle(member.title ?? '')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder="Add a title"
          className="editable text-[12px] text-ink-muted min-w-0 bg-transparent self-start max-w-full mt-0.5"
          aria-label="Member title"
        />
        <div className="mt-0.5">
          <MemberDaysOffButton member={member} variant="metric" />
        </div>
      </div>
      <MemberColorDot member={member} />
      <button
        onClick={remove}
        className="text-ink-faint hover:text-red-500 opacity-0 group-hover/card:opacity-100 transition shrink-0"
        aria-label="Remove member"
        title="Remove member"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

/** Simple add-member row (self-contained; not the Sprint-view toggle variant). */
function AddMember({ projectId }: { projectId: string }) {
  const [name, setName] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const submit = async () => {
    const n = name.trim()
    if (!n) return
    await db.members.add({
      id: uid(),
      projectId,
      name: n,
      color: colorForName(n),
      daysOff: [],
    })
    setName('')
    ref.current?.focus()
  }
  return (
    <div className="flex items-center gap-2 mt-1.5 py-2 px-3 rounded-[10px] border border-dashed border-border">
      <UserPlus size={15} className="text-ink-faint shrink-0" />
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Add member (press Enter)"
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-ink-faint"
        aria-label="Add member"
      />
    </div>
  )
}
