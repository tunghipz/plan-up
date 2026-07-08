import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, X, Upload, Trash2 } from 'lucide-react'
import { usePinnedPopover } from './usePinnedPopover'
import {
  db,
  setMemberDaysOff,
  setMemberAvatar,
  resizeImageToDataURL,
  colorForName,
  PALETTE,
  type Member,
} from './db'
import { DateField } from './DatePicker'
import {
  formatShortDate,
  firstGrapheme,
  effectiveDaysOff,
  daysOffInRange,
  fmtDays,
  PROJECT_ICON_EMOJIS,
} from './lib'

/**
 * Shared member controls used by both the Sprint group header and the
 * project settings page, so the two surfaces can never drift.
 */

/**
 * The member avatar — the single render point for a member's face across every
 * surface (sprint header, board, gantt, settings, assignee chips). Resolves in
 * three tiers: uploaded image → emoji → colored initial. Size is in px so the
 * same component serves the 28px header and the 20px assignee chip.
 * See design-docs/member-avatars.md.
 */
export function Avatar({
  member,
  size = 28,
  ring = true,
  className = '',
  ...rest
}: {
  member: Member
  size?: number
  /** The macOS canvas ring (default). Off for dense inline chips. */
  ring?: boolean
  className?: string
} & React.HTMLAttributes<HTMLSpanElement>) {
  const ringCls = ring
    ? 'ring-2 ring-canvas shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-ink)_13%,transparent)]'
    : ''
  const base = `rounded-full inline-flex items-center justify-center text-white font-semibold shrink-0 overflow-hidden select-none ${ringCls} ${className}`
  if (member.avatarImage) {
    return (
      <span
        className={base}
        style={{ width: size, height: size }}
        title={member.name}
        {...rest}
      >
        <img
          src={member.avatarImage}
          alt={member.name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </span>
    )
  }
  return (
    <span
      className={base}
      style={{
        width: size,
        height: size,
        background: member.color || colorForName(member.name),
        fontSize: Math.max(9, Math.round(size * 0.42)),
      }}
      title={member.name}
      {...rest}
    >
      {member.avatarEmoji ? (
        <span style={{ fontSize: Math.round(size * 0.6), lineHeight: 1 }}>
          {member.avatarEmoji}
        </span>
      ) : (
        firstGrapheme(member.name).toUpperCase()
      )}
    </span>
  )
}

/**
 * The project tile — single render point for a project's squircle avatar across
 * every surface (switcher button, switcher dropdown, toolbar breadcrumb, Home
 * cards). Resolves in three tiers like the member Avatar: uploaded photo
 * (`icon` starting with `data:`) → emoji → colored first letter.
 * See design-docs/project-icon-emoji.md.
 */
export function ProjectTile({
  project,
  size = 30,
}: {
  project: { name: string; icon?: string; color?: string }
  size?: number
}) {
  const icon = project.icon
  const isImage = !!icon?.startsWith('data:')
  const isEmoji = !!icon && !isImage
  const radius = Math.round(size * 0.27 * 10) / 10
  if (isImage) {
    return (
      <img
        src={icon}
        alt=""
        aria-hidden
        draggable={false}
        className="shrink-0 object-cover select-none"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    )
  }
  return (
    <span
      className="shrink-0 flex items-center justify-center text-white font-semibold select-none"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: project.color ?? colorForName(project.name),
        fontSize: isEmoji ? Math.round(size * 0.54) : Math.round(size * 0.48),
        letterSpacing: isEmoji ? '0' : '-0.01em',
      }}
      aria-hidden
    >
      {icon || firstGrapheme(project.name).toUpperCase() || '·'}
    </span>
  )
}

/**
 * Searchable emoji set for the avatar picker — curated + keyword-tagged so the
 * user can type a name ("fox", "rocket") to filter. Deliberately a small curated
 * list, not a full emoji-name database (calm, dependency-free). [char, keywords].
 */
const EMOJI: [string, string][] = [
  ['😀', 'smile happy'], ['😎', 'cool sunglasses'], ['🤓', 'nerd geek'], ['🥳', 'party celebrate'],
  ['😴', 'sleep tired'], ['🤖', 'robot bot'], ['👻', 'ghost'], ['💀', 'skull'],
  ['🦸', 'hero superhero'], ['🧙', 'wizard mage'], ['🧑‍💻', 'coder developer dev'], ['👑', 'crown king queen'],
  ['🦊', 'fox'], ['🐙', 'octopus'], ['🐧', 'penguin'], ['🦉', 'owl'],
  ['🐢', 'turtle tortoise'], ['🐝', 'bee'], ['🦄', 'unicorn'], ['🐳', 'whale'],
  ['🦁', 'lion'], ['🐯', 'tiger'], ['🐱', 'cat kitty'], ['🐶', 'dog puppy'],
  ['🐰', 'rabbit bunny'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐸', 'frog'],
  ['🐵', 'monkey'], ['🦅', 'eagle bird'], ['🦋', 'butterfly'], ['🐺', 'wolf'],
  ['🦈', 'shark'], ['🐬', 'dolphin'], ['🦦', 'otter'], ['🦥', 'sloth'],
  ['🐉', 'dragon'], ['🦖', 'dinosaur trex'], ['🦒', 'giraffe'], ['🐘', 'elephant'],
  ['🦔', 'hedgehog'], ['🐮', 'cow'], ['🐷', 'pig'], ['🦜', 'parrot bird'],
  ['🌸', 'flower blossom'], ['🌹', 'rose'], ['🌻', 'sunflower'], ['🌵', 'cactus'],
  ['🌲', 'tree pine'], ['🍀', 'clover luck'], ['🔥', 'fire flame'], ['⚡', 'lightning bolt'],
  ['⭐', 'star'], ['🌙', 'moon'], ['☀️', 'sun'], ['🌈', 'rainbow'],
  ['🌊', 'wave ocean'], ['❄️', 'snow snowflake'], ['💧', 'water drop'],
  ['🍕', 'pizza'], ['🍔', 'burger'], ['🌶️', 'pepper chili spicy'], ['🍑', 'peach'],
  ['🍎', 'apple'], ['🍓', 'strawberry'], ['🍉', 'watermelon'], ['🍌', 'banana'],
  ['🥑', 'avocado'], ['🍩', 'donut'], ['🍰', 'cake'], ['🍪', 'cookie'],
  ['🍦', 'icecream'], ['☕', 'coffee'], ['🍵', 'tea'], ['🍺', 'beer'],
  ['🍷', 'wine'], ['🥕', 'carrot'], ['🌽', 'corn'], ['🍣', 'sushi'],
  ['🚀', 'rocket launch space'], ['✈️', 'plane airplane travel'], ['🚗', 'car'], ['🚲', 'bike bicycle'],
  ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🎸', 'guitar music'], ['🎮', 'game gaming controller'],
  ['🎨', 'art paint'], ['📚', 'book books read'], ['💡', 'idea lightbulb'], ['🔔', 'bell'],
  ['🎯', 'target dart goal'], ['🏆', 'trophy win'], ['🎁', 'gift present'], ['💎', 'diamond gem'],
  ['🧩', 'puzzle'], ['🔑', 'key'], ['🛠️', 'tools build'], ['📌', 'pin'],
  ['❤️', 'heart love red'], ['💙', 'blue heart'], ['💚', 'green heart'], ['💜', 'purple heart'],
  ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['✨', 'sparkles'], ['✅', 'check done'],
  ['👍', 'thumbsup like'], ['👋', 'wave hello hi'], ['🙌', 'raise celebrate'], ['🤝', 'handshake deal'],
  // Project / planning oriented — keeps the trimmed project-icon set reachable
  // by name now that the picker shows only two curated rows (see EmojiPickerRow).
  ['📅', 'calendar date schedule'], ['📋', 'clipboard list tasks'], ['🗂️', 'folder files archive'],
  ['🔧', 'wrench fix tool repair'], ['🐛', 'bug issue defect'], ['💬', 'chat comment message'],
  ['📈', 'chart growth trending up'], ['📊', 'chart bar data stats'], ['📦', 'box package ship release'],
  ['🧪', 'lab test experiment'], ['🌐', 'globe web world internet'], ['🔍', 'search find magnify'],
  ['⏱️', 'timer stopwatch deadline'], ['📝', 'memo note write doc'], ['🎓', 'graduate learn education'],
]

/** Default grid shown when the search box is empty. */
const DEFAULT_EMOJI = [
  '🦊', '🐙', '🚀', '🐧', '🦉', '🐢', '🌶️', '🍑',
  '🐝', '🦄', '🐳', '🍕', '⚡', '🌸', '🦁', '🤖',
]

/** Resolve the emoji grid for a search query (empty → default set). A query that
 *  itself contains an emoji (paste) surfaces that emoji as the first result. */
function emojiResultsFor(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return DEFAULT_EMOJI
  const matches = EMOJI.filter(
    ([char, kw]) => kw.includes(q) || char === query.trim()
  ).map(([char]) => char)
  const typed = /\p{Extended_Pictographic}/u.test(query) ? firstGrapheme(query) : ''
  if (typed && !matches.includes(typed)) matches.unshift(typed)
  return matches.slice(0, 24)
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
/** Approximate decoded byte size of a base64 data-URL. */
function dataUrlBytes(d: string): number {
  return Math.round((d.length - (d.indexOf(',') + 1)) * 0.75)
}

/**
 * Avatar editor for the project settings member row. The member's Avatar is the
 * trigger; clicking opens a small popover with a `Photo | Emoji` segmented
 * control (Cupertino DNA), one panel at a time, plus Remove. Lives only here —
 * one place to edit a member, no drifting affordances. Absolute popover (no
 * portal): the Members card has no overflow clip. See design-docs/member-avatars.md.
 */
export function AvatarPicker({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'photo' | 'emoji'>(
    member.avatarImage ? 'photo' : 'emoji'
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savings, setSavings] = useState<string | null>(null)
  const [emojiQuery, setEmojiQuery] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Popover lives in a portal with fixed positioning (like MemberDaysOffButton)
  // so it escapes the settings drawer's `overflow-auto` scroll container, which
  // would otherwise clip it. Pins to the trigger, flipping above when there's
  // no room below; the hook re-pins after every committed render, so a panel
  // height change (tab / busy / error / emoji search) re-anchors automatically.
  // See design-docs/member-avatars.md.
  const pos = usePinnedPopover({
    open,
    onClose: () => setOpen(false),
    anchorRef: btnRef,
    popRef,
    place: () => {
      const W = 264
      const GAP = 8
      const br = btnRef.current?.getBoundingClientRect()
      if (!br) return null
      const h = popRef.current?.offsetHeight ?? 320
      let top = br.bottom + GAP
      if (top + h > window.innerHeight - GAP) top = br.top - GAP - h // flip up
      if (top < GAP) top = GAP
      let left = br.left
      if (left + W > window.innerWidth - GAP) left = window.innerWidth - W - GAP
      if (left < GAP) left = GAP
      return { top, left }
    },
  })

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!f) return
    setBusy(true)
    setError(null)
    setSavings(null)
    try {
      const data = await resizeImageToDataURL(f, 128)
      await setMemberAvatar(member.id, { avatarImage: data })
      setSavings(`${fmtBytes(f.size)} → ${fmtBytes(dataUrlBytes(data))} · 128px`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that image.')
    } finally {
      setBusy(false)
    }
  }

  const hasAvatar = !!(member.avatarImage || member.avatarEmoji)
  const emojiResults = emojiResultsFor(emojiQuery)

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!open) {
            // Opening: reset the panel to the member's current state. Done
            // here at the trigger — not in an effect — so there's no
            // post-render state cascade. (Positioning is the pin hook's job;
            // it re-pins pre-paint, so a stale pos from the last open never
            // shows.)
            setTab(member.avatarImage ? 'photo' : 'emoji')
            setError(null)
            setEmojiQuery('')
          }
          setOpen(!open)
        }}
        aria-label="Change avatar"
        title="Change avatar"
        className="relative block rounded-full transition hover:scale-105 motion-reduce:transform-none group/avatar"
      >
        <Avatar member={member} />
        <span
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full bg-accent text-white grid place-items-center ring-2 ring-surface opacity-0 group-hover/avatar:opacity-100 transition"
        >
          <span className="text-[8px] leading-none">✎</span>
        </span>
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className={`z-[60] w-[264px] bg-surface border border-border-hair rounded-[14px] shadow-[0_10px_36px_rgba(0,0,0,0.18)] p-3.5 transition-opacity ${
            pos ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Preview row */}
          <div className="flex items-center gap-2.5 mb-3">
            <Avatar member={member} size={44} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-ink truncate">
                {member.name}
              </div>
              {member.title && (
                <div className="text-[11.5px] text-ink-faint truncate">
                  {member.title}
                </div>
              )}
            </div>
          </div>

          {/* Segmented Photo | Emoji */}
          <div className="flex items-center bg-fill rounded-[9px] p-0.5 mb-3">
            {(
              [
                ['photo', 'Photo'],
                ['emoji', 'Emoji'],
              ] as ['photo' | 'emoji', string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={`flex-1 text-[12.5px] py-1 rounded-[7px] transition ${
                  tab === k
                    ? 'bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]'
                    : 'text-ink-muted font-medium hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Panel — distinct keys so React remounts instead of reusing the
              <input> across tabs (controlled text → uncontrolled file). */}
          {tab === 'emoji' ? (
            <div key="emoji-panel">
              <input
                type="text"
                value={emojiQuery}
                onChange={(e) => setEmojiQuery(e.target.value)}
                placeholder="Search (fox, rocket…) or paste an emoji"
                maxLength={24}
                autoFocus
                aria-label="Search emoji"
                className="mb-2 w-full text-[13px] bg-canvas border border-border rounded-[8px] px-2.5 py-1.5 outline-none focus:border-accent"
              />
              {emojiResults.length > 0 ? (
                <div className="grid grid-cols-6 gap-0.5">
                  {emojiResults.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => void setMemberAvatar(member.id, { avatarEmoji: em })}
                      className={`text-[19px] leading-none py-1 rounded-[7px] transition hover:bg-surface-hover ${
                        member.avatarEmoji === em ? 'bg-accent-tint' : ''
                      }`}
                      aria-label={`Use ${em}`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-ink-faint text-center py-3">
                  No emoji found
                </div>
              )}
            </div>
          ) : (
            <div key="photo-panel">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onFile}
                className="hidden"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 text-[13px] font-medium bg-accent text-white rounded-[9px] py-2 transition hover:brightness-105 disabled:opacity-55"
              >
                <Upload size={14} />
                {busy ? 'Resizing…' : 'Upload photo'}
              </button>
              {savings && !error && (
                <div className="mt-2 text-[11.5px] text-center text-status-done bg-status-done/15 rounded-[7px] py-1.5 tabular-nums">
                  {savings}
                </div>
              )}
              {error && (
                <div className="mt-2 text-[11.5px] text-center text-overdue bg-overdue/10 rounded-[7px] py-1.5">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Remove */}
          {hasAvatar && (
            <button
              type="button"
              onClick={() => {
                void setMemberAvatar(member.id, {
                  avatarImage: null,
                  avatarEmoji: null,
                })
                setSavings(null)
                setOpen(false)
              }}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[12.5px] text-overdue rounded-[9px] py-1.5 transition hover:bg-overdue/10"
            >
              <Trash2 size={13} /> Remove avatar
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

/**
 * A row of palette swatches. The currently-selected color gets a ring.
 * Generic so it serves both members and projects.
 */
export function ColorSwatchRow({
  value,
  onPick,
}: {
  value: string | undefined
  onPick: (c: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {PALETTE.map((c) => {
        const active = value === c
        return (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            aria-label={`Pick color ${c}`}
            aria-pressed={active}
            title={c}
            className={`w-5 h-5 rounded-full transition ${
              active
                ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink/45'
                : 'opacity-80 hover:opacity-100 hover:scale-110 motion-reduce:transform-none'
            }`}
            style={{ background: c }}
          />
        )
      })}
    </div>
  )
}

/** Inline emoji picker mirroring ColorSwatchRow's `{ value, onPick }` shape.
 *  A search box sits on top: empty → two curated rows of project emoji (with a
 *  leading "Aa" chip that clears the emoji → first-letter fallback); non-empty →
 *  results from the shared `EMOJI` keyword set, which also surfaces any pasted
 *  emoji as the first hit (full coverage, no dependency). `undefined` = unset. */
export function EmojiPickerRow({
  value,
  onPick,
}: {
  value: string | undefined
  onPick: (icon: string | undefined) => void
}) {
  const [query, setQuery] = useState('')
  const results = query.trim() ? emojiResultsFor(query) : null

  const cell = (e: string) => {
    const active = value === e
    return (
      <button
        key={e}
        type="button"
        onClick={() => onPick(e)}
        aria-label={`Icon ${e}`}
        aria-pressed={active}
        title={e}
        className={`w-8 h-8 rounded-[8px] grid place-items-center text-[18px] leading-none transition ${
          active
            ? 'bg-surface ring-2 ring-accent'
            : 'bg-canvas hover:bg-surface-hover hover:scale-110 motion-reduce:transform-none'
        }`}
      >
        {e}
      </button>
    )
  }

  return (
    <div className="w-[298px]">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji (rocket, chart, fire…) or paste one"
        maxLength={24}
        aria-label="Search emoji"
        className="mb-2 w-full text-[13px] bg-canvas border border-border rounded-[8px] px-2.5 py-1.5 outline-none transition focus:ring-2 focus:ring-accent/40 focus:border-accent placeholder:text-ink-faint"
      />
      {results ? (
        results.length > 0 ? (
          <div className="grid grid-cols-8 gap-1.5">{results.map(cell)}</div>
        ) : (
          <div className="py-3 text-center text-[12px] text-ink-faint">
            No emoji found — try another word.
          </div>
        )
      ) : (
        <div className="grid grid-cols-8 gap-1.5">
          <button
            type="button"
            onClick={() => onPick(undefined)}
            aria-label="No emoji — show the first letter"
            aria-pressed={!value}
            title="No emoji — show the first letter"
            className={`w-8 h-8 rounded-[8px] grid place-items-center text-[11px] font-semibold text-ink-muted transition ${
              !value
                ? 'bg-surface ring-2 ring-accent'
                : 'bg-canvas hover:bg-surface-hover'
            }`}
          >
            Aa
          </button>
          {PROJECT_ICON_EMOJIS.map(cell)}
        </div>
      )}
    </div>
  )
}

/**
 * Quiet color control: a single dot of the member's current color; click opens
 * a small palette popover. Color is secondary here (the constitution treats it
 * as deterministic), so it stays collapsed instead of an always-on swatch row.
 */
export function MemberColorDot({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Outside-click / Escape close; absolute-positioned (scrolls with its row),
  // so no pin — the ref wraps trigger + palette.
  usePinnedPopover({ open, onClose: () => setOpen(false), popRef: ref })
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Member color"
        title="Change color"
        className="block w-[18px] h-[18px] rounded-full transition hover:scale-110 motion-reduce:transform-none"
        style={{ background: member.color, boxShadow: '0 0 0 1px rgba(0,0,0,0.10)' }}
      />
      {open && (
        <div className="absolute right-0 top-7 z-20 bg-surface border border-border-hair rounded-[12px] shadow-[0_10px_36px_rgba(0,0,0,0.18)] p-2">
          <ColorSwatchRow
            value={member.color}
            onPick={(c) => {
              void db.members.update(member.id, { color: c })
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Calendar button on a member. Opens a popover where the manager picks days
 * the member is off (vacation, holidays). Weekends are already implicit; this
 * is only the extra off-days. Saving recomputes every task assigned to this
 * member (and forward through their deps).
 */
export function MemberDaysOffButton({
  member,
  variant = 'header',
  range,
}: {
  member: Member
  /** 'header' = Sprint group-header chip; 'metric' = always-visible settings line. */
  variant?: 'header' | 'metric'
  /**
   * When set (sprint view), scope the list + chip + entry to this sprint's
   * inclusive date range. Settings passes no range and sees the full aggregate.
   * See design-docs/members-and-days-off.md.
   */
  range?: { start: string; end: string }
}) {
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState('')
  const [draftHalf, setDraftHalf] = useState<'all' | 'am' | 'pm'>('all')
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Popover lives in a portal (escapes Card's overflow-hidden), pinned to the
  // trigger. `outsideIgnore`: the date picker's calendar is portaled to <body>,
  // so it sits OUTSIDE popRef — without the guard, clicking a day would close
  // this popover and unmount the calendar before the day's click lands.
  // See design-docs/members-and-days-off.md.
  const pos = usePinnedPopover({
    open,
    onClose: () => setOpen(false),
    anchorRef: btnRef,
    popRef,
    outsideIgnore: '[data-calendar-popover]',
    place: () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (!rect) return null
      return {
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      }
    },
  }) ?? { top: 0, right: 0 }

  // Full list drives mutations (date-keyed); the sprint view only displays and
  // counts the subset within its range. Out-of-range days stay untouched.
  const days = member.daysOff ?? []
  const visibleDays = range
    ? daysOffInRange(days, range.start, range.end)
    : days
  const count = visibleDays.length
  const effDays = effectiveDaysOff(visibleDays)
  const offLabel = effDays === 1 ? '1 day off' : `${fmtDays(effDays)} days off`

  const updateOne = async (date: string, half: 'all' | 'am' | 'pm') => {
    const next = days.filter((d) => d.date !== date)
    next.push(half === 'all' ? { date } : { date, half })
    await setMemberDaysOff(member.id, next)
  }
  const removeDay = async (date: string) => {
    await setMemberDaysOff(
      member.id,
      days.filter((d) => d.date !== date)
    )
  }
  const addDraft = async () => {
    if (!draftDate) return
    // Defensive: the picker is range-clamped, but never let a scoped view add
    // an off-day outside its sprint.
    if (range && (draftDate < range.start || draftDate > range.end)) return
    await updateOne(draftDate, draftHalf)
    setDraftDate('')
    setDraftHalf('all')
  }

  return (
    <>
      {variant === 'metric' ? (
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={`inline-flex items-center gap-1.5 transition text-[12px] ${
            count > 0 ? 'text-ink-muted' : 'text-ink-faint'
          } hover:text-ink`}
          title={count > 0 ? 'Click to edit days off' : 'Set days off'}
          aria-label="Days off"
        >
          <Calendar size={13} />
          <span className="whitespace-nowrap">
            {count > 0
              ? offLabel
              : range
                ? 'No days off this sprint'
                : 'No days off'}
          </span>
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={
            count > 0
              ? 'inline-flex items-center gap-1 text-sm text-ink hover:text-ink transition'
              : // Resting (no off-days in this sprint): always-visible quiet
                // dashed "add" pill — calm at rest, accent on hover.
                'inline-flex items-center gap-1.5 text-[12px] font-medium rounded-full px-2.5 py-1 border border-dashed border-border-strong text-ink-muted hover:text-accent hover:border-accent hover:bg-accent-soft transition'
          }
          title={
            count > 0
              ? `${fmtDays(effDays)} day${effDays === 1 ? '' : 's'} off — click to edit`
              : 'Set days off'
          }
          aria-label="Days off"
        >
          <Calendar size={count > 0 ? 14 : 13} />
          {count > 0 ? (
            <span className="text-[11px] font-medium whitespace-nowrap">
              {fmtDays(effDays)}d off
            </span>
          ) : (
            <span className="whitespace-nowrap">Days off</span>
          )}
        </button>
      )}
      {open && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-72 bg-surface border border-border-hair rounded-[14px] shadow-[0_10px_36px_rgba(0,0,0,0.18)] p-2"
        >
          <div className="text-[11px] tracking-normal text-ink-faint px-1 pb-1.5">
            Days off — {member.name}
          </div>
          {visibleDays.length === 0 && (
            <div className="text-sm text-ink-faint px-1 pb-1.5">
              {range ? 'None this sprint. ' : 'None. '}Weekends are already off.
            </div>
          )}
          {visibleDays.map((d) => (
            <div
              key={d.date}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-hover group/day"
            >
              <span className="text-sm text-ink tabular-nums w-16 shrink-0">
                {formatShortDate(d.date)}
              </span>
              <select
                value={d.half ?? 'all'}
                onChange={(e) =>
                  updateOne(d.date, e.target.value as 'all' | 'am' | 'pm')
                }
                className="flex-1 text-sm bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-accent cursor-pointer"
              >
                <option value="all">Off all day</option>
                <option value="am">AM off (morning)</option>
                <option value="pm">PM off (afternoon)</option>
              </select>
              <button
                onClick={() => removeDay(d.date)}
                className="text-ink-faint hover:text-overdue opacity-0 group-hover/day:opacity-100 transition"
                aria-label={`Remove ${d.date}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="border-t border-border mt-1 pt-2 space-y-1.5">
            <div className="flex gap-2">
              <DateField
                value={draftDate}
                onChange={setDraftDate}
                placeholder="Pick a date"
                min={range?.start}
                max={range?.end}
                sprintRange={range ?? null}
                daysOff={visibleDays}
                className="relative flex-1 text-sm bg-canvas border border-border rounded px-2 py-1 text-left h-7 focus:border-accent outline-none"
              />
              <select
                value={draftHalf}
                onChange={(e) =>
                  setDraftHalf(e.target.value as 'all' | 'am' | 'pm')
                }
                className="text-sm bg-canvas border border-border rounded px-1.5 py-1 outline-none focus:border-accent cursor-pointer"
              >
                <option value="all">All</option>
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
              <button
                onClick={addDraft}
                disabled={!draftDate}
                className="text-sm px-2 py-1 rounded bg-accent text-white disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <div className="text-[10px] text-ink-faint px-1">
              Half-day off counts as 0.5 day toward effort.
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
