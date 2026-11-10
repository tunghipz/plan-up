// Slide decks for the Claude assistant (design-docs/claude-assistant.md). Claude writes the
// deck CONTENT as JSON; this file pours it into one fixed, self-contained HTML template in the
// app's Cupertino style. Claude never writes HTML or JS: every string is escaped here.

export type SlideLayout =
  | 'title'
  | 'section'
  | 'bullets'
  | 'stats'
  | 'progress'
  | 'table'
  | 'timeline'
  | 'columns'

export type MilestoneStatus = 'done' | 'in_progress' | 'todo' | 'late'

export interface Slide {
  layout: SlideLayout
  title: string
  subtitle?: string
  bullets?: string[]
  stats?: { value: string; label: string; note?: string }[]
  bars?: { label: string; done: number; total: number; note?: string }[]
  table?: { columns: string[]; rows: string[][] }
  milestones?: { date: string; label: string; status?: MilestoneStatus }[]
  columns?: { heading: string; bullets: string[] }[]
  notes?: string
}

export interface Deck {
  title: string
  subtitle?: string
  slides: Slide[]
}

const LAYOUTS: SlideLayout[] = ['title', 'section', 'bullets', 'stats', 'progress', 'table', 'timeline', 'columns']
const STATUSES: MilestoneStatus[] = ['done', 'in_progress', 'todo', 'late']
export const MAX_SLIDES = 30

// ── Normalisation ────────────────────────────────────────────────────────────
// The CLI validates against the schema, but the renderer must never trust shape: anything
// missing or wrong is dropped, never thrown on.

function str(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function strList(v: unknown, maxItems: number, maxLen = 300): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function objList(v: unknown, maxItems: number): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').slice(0, maxItems)
    : []
}

export function sanitizeDeck(raw: unknown): Deck | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const slides: Slide[] = []
  for (const s of objList(r.slides, MAX_SLIDES)) {
    const layout = LAYOUTS.includes(s.layout as SlideLayout) ? (s.layout as SlideLayout) : 'bullets'
    const slide: Slide = { layout, title: str(s.title, 200) }
    const subtitle = str(s.subtitle, 300)
    if (subtitle) slide.subtitle = subtitle
    const bullets = strList(s.bullets, 10)
    if (bullets.length) slide.bullets = bullets
    const stats = objList(s.stats, 4)
      .map((x) => ({ value: str(x.value, 24), label: str(x.label, 80), note: str(x.note, 120) }))
      .filter((x) => x.value || x.label)
    if (stats.length) slide.stats = stats
    const bars = objList(s.bars, 12)
      .map((x) => ({ label: str(x.label, 60), done: num(x.done), total: num(x.total), note: str(x.note, 80) }))
      .filter((x) => x.label)
    if (bars.length) slide.bars = bars
    if (s.table && typeof s.table === 'object') {
      const t = s.table as Record<string, unknown>
      const columns = strList(t.columns, 6, 60)
      const rows = (Array.isArray(t.rows) ? t.rows : [])
        .slice(0, 12)
        .map((row) => strList(row, columns.length || 6, 160))
        .filter((row) => row.length)
      if (columns.length && rows.length) slide.table = { columns, rows }
    }
    const milestones = objList(s.milestones, 10)
      .map((x) => ({
        date: str(x.date, 30),
        label: str(x.label, 160),
        status: STATUSES.includes(x.status as MilestoneStatus) ? (x.status as MilestoneStatus) : undefined,
      }))
      .filter((x) => x.label)
    if (milestones.length) slide.milestones = milestones
    const columns = objList(s.columns, 3)
      .map((x) => ({ heading: str(x.heading, 80), bullets: strList(x.bullets, 8) }))
      .filter((x) => x.heading || x.bullets.length)
    if (columns.length) slide.columns = columns
    const notes = str(s.notes, 1500)
    if (notes) slide.notes = notes
    if (slide.title || bullets.length || stats.length || bars.length || slide.table || milestones.length || columns.length) {
      slides.push(slide)
    }
  }
  const title = str(r.title, 200) || slides[0]?.title || 'Untitled deck'
  if (!slides.length) return null
  const deck: Deck = { title, slides }
  const subtitle = str(r.subtitle, 300)
  if (subtitle) deck.subtitle = subtitle
  return deck
}

// ── HTML ─────────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Escaped text with `**bold**` turned into <strong> (after escaping, so no markup gets in).
 * A stray reference link (`[An](m1)`) keeps only its label — handles mean nothing in a file.
 */
function inline(s: string): string {
  return escapeHtml(s.replace(/\[([^\]\n]+)\]\([tmsn]\d+\)/g, '$1')).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function bulletsHtml(items: string[] | undefined): string {
  if (!items?.length) return ''
  return `<ul class="bullets">${items.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>`
}

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  done: 'Done',
  in_progress: 'In progress',
  todo: 'To do',
  late: 'Late',
}

function bodyHtml(s: Slide): string {
  switch (s.layout) {
    case 'title':
    case 'section':
      return bulletsHtml(s.bullets)
    case 'stats':
      return (
        (s.stats?.length
          ? `<div class="stats n${s.stats.length}">${s.stats
              .map(
                (x) =>
                  `<div class="stat"><div class="stat-value">${escapeHtml(x.value)}</div><div class="stat-label">${inline(x.label)}</div>${
                    x.note ? `<div class="stat-note">${inline(x.note)}</div>` : ''
                  }</div>`
              )
              .join('')}</div>`
          : '') + bulletsHtml(s.bullets)
      )
    case 'progress':
      return (
        (s.bars?.length
          ? `<div class="bars">${s.bars
              .map((b) => {
                const pct = b.total > 0 ? Math.min(100, Math.round((b.done / b.total) * 100)) : 0
                return `<div class="bar-row"><div class="bar-label">${inline(b.label)}</div><div class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></div><div class="bar-num">${
                  b.total > 0 ? `${b.done}/${b.total} · ${pct}%` : '—'
                }</div>${b.note ? `<div class="bar-note">${inline(b.note)}</div>` : ''}</div>`
              })
              .join('')}</div>`
          : '') + bulletsHtml(s.bullets)
      )
    case 'table':
      return s.table
        ? `<table class="tbl"><thead><tr>${s.table.columns
            .map((c) => `<th>${inline(c)}</th>`)
            .join('')}</tr></thead><tbody>${s.table.rows
            .map((r) => `<tr>${s.table!.columns.map((_, i) => `<td>${inline(r[i] ?? '')}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        : bulletsHtml(s.bullets)
    case 'timeline':
      return s.milestones?.length
        ? `<ol class="timeline">${s.milestones
            .map(
              (m) =>
                `<li class="ms ${m.status ?? 'todo'}"><span class="ms-dot"></span><span class="ms-date">${escapeHtml(m.date)}</span><span class="ms-label">${inline(m.label)}</span>${
                  m.status ? `<span class="ms-status">${STATUS_LABEL[m.status]}</span>` : ''
                }</li>`
            )
            .join('')}</ol>`
        : bulletsHtml(s.bullets)
    case 'columns':
      return s.columns?.length
        ? `<div class="cols n${s.columns.length}">${s.columns
            .map((c) => `<div class="col"><h3>${inline(c.heading)}</h3>${bulletsHtml(c.bullets)}</div>`)
            .join('')}</div>`
        : bulletsHtml(s.bullets)
    default:
      return bulletsHtml(s.bullets)
  }
}

// ── Fit ──────────────────────────────────────────────────────────────────────
// Slides are sized in container units (cqw: 1 = 1% of slide width; a 16:9 slide is 56.25
// tall). A dense slide would run past the footer, so the body gets a CSS zoom estimated
// from its content here — this works with scripts off (the in-app preview). In a browser
// the deck's script then measures and trims any remaining overflow.

const BODY_W = 87 // slide width minus side padding
const CHAR_EM = 0.52 // average glyph width, in em

function lines(text: string, fontCqw: number, widthCqw: number): number {
  const plain = text.replace(/\*\*/g, '')
  return Math.max(1, Math.ceil((plain.length * CHAR_EM * fontCqw) / Math.max(widthCqw, 1)))
}

function bulletsHeight(items: string[] | undefined, font: number, width: number, gap: number): number {
  if (!items?.length) return 0
  return items.reduce((h, b) => h + lines(b, font, width - 2.4) * font * 1.45, 0) + gap * (items.length - 1)
}

/**
 * Estimated body height in the body's own (unzoomed) units, when it has `W` cqw of width.
 * Under `zoom: z` the body lays out in W = BODY_W / z: same font size, wider lines, fewer
 * wraps — so the fit is not linear in z, and `slideZoom` searches for it.
 */
function bodyHeight(s: Slide, W: number): number {
  const bullets = (gapBefore: number) => {
    const h = bulletsHeight(s.bullets, 1.85, W, 1.3)
    return h ? h + gapBefore : 0
  }
  switch (s.layout) {
    case 'stats': {
      const tile = s.stats?.length
        ? 2.2 + 5 + 1 + 1.55 * 1.45 + (s.stats.some((x) => x.note) ? 0.5 + 1.3 * 1.45 : 0) + 2 + 2.4
        : 0
      return tile + bullets(0)
    }
    case 'progress': {
      const rows = (s.bars ?? []).reduce((h, b) => h + 1.6 * 1.45 + (b.note ? 1.3 * 1.45 + 0.3 : 0), 0)
      return rows + 1.5 * Math.max(0, (s.bars?.length ?? 0) - 1) + 2 + bullets(0)
    }
    case 'table': {
      if (!s.table) return bullets(0)
      const colW = W / s.table.columns.length - 1.2
      const head = Math.max(...s.table.columns.map((c) => lines(c, 1.2, colW))) * 1.2 * 1.45 + 1
      const rows = s.table.rows.reduce(
        (h, r) => h + Math.max(...r.map((c) => lines(c, 1.5, colW))) * 1.5 * 1.45 + 1.9,
        0
      )
      return head + rows
    }
    case 'timeline': {
      const items = s.milestones ?? []
      return items.reduce((h, m) => h + lines(m.label, 1.7, W - 26) * 1.7 * 1.45, 0) + 1.35 * Math.max(0, items.length - 1)
    }
    case 'columns': {
      const cols = s.columns ?? []
      if (!cols.length) return bullets(0)
      const colW = (W - 2.4 * (cols.length - 1)) / cols.length - 4.4
      return Math.max(
        ...cols.map((c) => 4.4 + lines(c.heading, 1.8, colW) * 1.8 * 1.3 + 1.4 + bulletsHeight(c.bullets, 1.6, colW, 1))
      )
    }
    case 'title':
    case 'section':
      return bullets(0)
    default:
      return bullets(0)
  }
}

/** CSS zoom for the body so the content clears the footer; 1 when it already fits. */
export function slideZoom(s: Slide): number {
  if (s.layout === 'title' || s.layout === 'section') return 1
  const titleH = lines(s.title, 3.3, BODY_W) * 3.3 * 1.15
  const subH = s.subtitle ? 1.1 + lines(s.subtitle, 1.9, BODY_W) * 1.9 * 1.35 : 0
  const available = 56.25 - 6 - 7.5 - titleH - subH - 3
  for (let z = 1; z > 0.5; z = Math.round((z - 0.02) * 100) / 100) {
    if (z * bodyHeight(s, BODY_W / z) <= available) return z
  }
  return 0.5
}

const zoomAttr = (z: number) => (z < 1 ? ` style="zoom:${z}"` : '')

function slideHtml(s: Slide, i: number, total: number, deckTitle: string): string {
  const head =
    s.layout === 'title'
      ? `<div class="kicker"></div><h1>${inline(s.title)}</h1>${s.subtitle ? `<p class="sub">${inline(s.subtitle)}</p>` : ''}`
      : s.layout === 'section'
        ? `<p class="eyebrow">Section</p><h1>${inline(s.title)}</h1>${s.subtitle ? `<p class="sub">${inline(s.subtitle)}</p>` : ''}`
        : `<h2>${inline(s.title)}</h2>${s.subtitle ? `<p class="sub">${inline(s.subtitle)}</p>` : ''}`
  return `<section class="slide ${s.layout}" id="s${i + 1}" aria-label="Slide ${i + 1}">
<div class="inner">${head}<div class="body"${zoomAttr(slideZoom(s))}>${bodyHtml(s)}</div></div>
<footer><span>${escapeHtml(deckTitle)}</span><span>${i + 1} / ${total}</span></footer>
</section>${s.notes ? `\n<aside class="notes"><b>Notes</b> ${inline(s.notes)}</aside>` : ''}`
}

const CSS = `
:root{color-scheme:light;--canvas:#F5F5F7;--surface:#FFFFFF;--ink:#1D1D1F;--muted:#6E6E73;--faint:#76767A;--sep:#E5E5EA;--fill:#F2F2F5;--accent:#0071E3;--accent-soft:rgba(0,113,227,.10);--done:#34C759;--progress:#0071E3;--todo:#8E8E93;--late:#FF3B30}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--canvas)}
body{font-family:-apple-system,'SF Pro Text','SF Pro Display',system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;padding:28px 0 64px}
.bar-top{width:min(1180px,calc(100vw - 32px));margin:0 auto 18px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.bar-top .t{font-size:14px;color:var(--muted)}
.bar-top button{font:inherit;font-size:13px;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:8px;padding:7px 14px;cursor:pointer}
.slide{position:relative;width:min(1180px,calc(100vw - 32px));aspect-ratio:16/9;margin:0 auto 22px;background:var(--surface);border-radius:18px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 22px rgba(0,0,0,.06);overflow:hidden;container-type:inline-size}
.inner{position:absolute;inset:0;padding:6cqw 6.5cqw 7cqw;display:flex;flex-direction:column}
h1{font-size:5.4cqw;font-weight:700;letter-spacing:-.025em;line-height:1.08}
h2{font-size:3.3cqw;font-weight:700;letter-spacing:-.02em;line-height:1.15}
.sub{margin-top:1.1cqw;font-size:1.9cqw;color:var(--muted);line-height:1.35}
.body{margin-top:3cqw;flex:1;min-height:0;font-size:1.85cqw;line-height:1.45;overflow-wrap:anywhere}
strong{font-weight:650}
.title .inner,.section .inner{justify-content:center}
.title .kicker{width:5cqw;height:.55cqw;border-radius:99px;background:var(--accent);margin-bottom:2.6cqw}
.title h1{font-size:6cqw}
.title .body,.section .body{flex:0;margin-top:2.4cqw;color:var(--muted)}
.section{background:#EEF4FC}
.eyebrow{font-size:1.4cqw;font-weight:600;color:var(--accent);margin-bottom:1.2cqw}
.bullets{list-style:none;display:flex;flex-direction:column;gap:1.3cqw}
.bullets li{position:relative;padding-left:2.4cqw}
.bullets li::before{content:"";position:absolute;left:.3cqw;top:.62em;width:.75cqw;height:.75cqw;border-radius:50%;background:var(--accent)}
.stats{display:grid;gap:1.6cqw;margin-bottom:2.4cqw}
.stats.n1{grid-template-columns:1fr}.stats.n2{grid-template-columns:repeat(2,1fr)}.stats.n3{grid-template-columns:repeat(3,1fr)}.stats.n4{grid-template-columns:repeat(4,1fr)}
.stat{background:var(--fill);border-radius:1.4cqw;padding:2.2cqw 2.2cqw 2cqw}
.stat{min-width:0}
.stat-value{font-size:5cqw;font-weight:700;letter-spacing:-.03em;line-height:1;white-space:nowrap}
.stats.n3 .stat-value{font-size:4.2cqw}.stats.n4 .stat-value{font-size:3.4cqw}
.stat-label{margin-top:1cqw;font-size:1.55cqw;font-weight:600}
.stat-note{margin-top:.5cqw;font-size:1.3cqw;color:var(--muted)}
.bars{display:flex;flex-direction:column;gap:1.5cqw;margin-bottom:2cqw}
.bar-row{display:grid;grid-template-columns:20% 1fr 14%;align-items:center;column-gap:1.8cqw;font-size:1.6cqw}
.bar-label{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-track{height:1.3cqw;border-radius:99px;background:#E8E8ED;overflow:hidden}
.bar-fill{display:block;height:100%;border-radius:99px;background:var(--done)}
.bar-num{color:var(--muted);text-align:right;white-space:nowrap}
.bar-note{grid-column:2/4;font-size:1.3cqw;color:var(--muted);margin-top:.3cqw}
.tbl{width:100%;border-collapse:collapse;font-size:1.5cqw}
.tbl th{text-align:left;font-size:1.2cqw;font-weight:600;color:var(--muted);padding:0 1.2cqw .9cqw 0;border-bottom:1px solid var(--sep)}
.tbl td{padding:.95cqw 1.2cqw .95cqw 0;border-bottom:1px solid var(--sep);vertical-align:top}
.tbl tr:last-child td{border-bottom:0}
.timeline{list-style:none;position:relative;display:flex;flex-direction:column;gap:1.35cqw;padding-left:3cqw}
.timeline::before{content:"";position:absolute;left:.75cqw;top:.6cqw;bottom:.6cqw;width:.18cqw;background:var(--sep)}
.ms{position:relative;display:flex;align-items:baseline;gap:1.6cqw;font-size:1.7cqw}
.ms-dot{position:absolute;left:-2.95cqw;top:.45em;width:1.3cqw;height:1.3cqw;border-radius:50%;background:var(--surface);border:.3cqw solid var(--todo)}
.ms.done .ms-dot{background:var(--done);border-color:var(--done)}
.ms.in_progress .ms-dot{border-color:var(--progress);background:linear-gradient(90deg,var(--progress) 50%,var(--surface) 50%)}
.ms.late .ms-dot{border-color:var(--late)}
.ms-date{min-width:9cqw;color:var(--muted);font-size:1.45cqw}
.ms-label{flex:1}
.ms-status{font-size:1.2cqw;font-weight:600;padding:.25cqw .9cqw;border-radius:99px;background:var(--fill);color:var(--muted)}
.ms.done .ms-status{color:#248A3D;background:rgba(52,199,89,.14)}
.ms.in_progress .ms-status{color:var(--accent);background:var(--accent-soft)}
.ms.late .ms-status{color:#D70015;background:rgba(255,59,48,.12)}
.cols{display:grid;gap:2.4cqw}
.cols.n1{grid-template-columns:1fr}.cols.n2{grid-template-columns:repeat(2,1fr)}.cols.n3{grid-template-columns:repeat(3,1fr)}
.col{background:var(--fill);border-radius:1.4cqw;padding:2.2cqw}
.col h3{font-size:1.8cqw;font-weight:650;margin-bottom:1.4cqw}
.col .bullets{gap:1cqw;font-size:1.6cqw}
footer{position:absolute;left:6.5cqw;right:6.5cqw;bottom:2.6cqw;display:flex;justify-content:space-between;font-size:1.1cqw;color:var(--faint)}
.notes{width:min(1180px,calc(100vw - 32px));margin:-10px auto 26px;padding:0 6px;font-size:13px;line-height:1.5;color:var(--muted)}
.notes b{color:var(--ink);font-weight:600;margin-right:4px}
body.present{background:#000;padding:0;overflow:hidden}
body.present .bar-top,body.present .notes{display:none}
body.present .slide{display:none;position:fixed;inset:0;margin:auto;width:min(100vw,calc(100vh * 16 / 9));border-radius:0;box-shadow:none}
body.present .slide.on{display:block}
@media print{
  @page{size:16in 9in;margin:0}
  html,body{background:#fff;padding:0}
  .bar-top,.notes{display:none}
  .slide{width:16in;height:9in;aspect-ratio:auto;margin:0;border-radius:0;box-shadow:none;break-after:page}
}
`

// Progressive enhancement only: without it the deck is a scrollable stack of slides.
const SCRIPT = `
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));var cur=0;
  function fits(b,f){var last=b.getBoundingClientRect().top;[].forEach.call(b.querySelectorAll('*'),function(e){last=Math.max(last,e.getBoundingClientRect().bottom)});return last<=f.getBoundingClientRect().top-4}
  function fit(){slides.forEach(function(s){var b=s.querySelector('.body'),f=s.querySelector('footer');if(!b||!f)return;
    b.style.zoom=1;if(fits(b,f))return;var lo=0.5,hi=1;
    for(var k=0;k<7;k++){var mid=(lo+hi)/2;b.style.zoom=mid;if(fits(b,f))lo=mid;else hi=mid}
    b.style.zoom=Math.floor(lo*100)/100})}
  fit();
  function show(i){cur=Math.max(0,Math.min(slides.length-1,i));slides.forEach(function(s,k){s.classList.toggle('on',k===cur)})}
  function inView(){var best=0,d=1e9;slides.forEach(function(s,k){var t=Math.abs(s.getBoundingClientRect().top);if(t<d){d=t;best=k}});return best}
  function start(i){document.body.classList.add('present');show(i)}
  function stop(){document.body.classList.remove('present');if(document.fullscreenElement)document.exitFullscreen();slides[cur].scrollIntoView({block:'center'})}
  var btn=document.getElementById('present');if(btn)btn.addEventListener('click',function(){start(inView())});
  slides.forEach(function(s,k){s.addEventListener('dblclick',function(){if(!document.body.classList.contains('present'))start(k)})});
  document.addEventListener('keydown',function(e){
    var on=document.body.classList.contains('present');
    if(!on){if(e.key==='p'||e.key==='P')start(inView());return}
    if(['ArrowRight','ArrowDown','PageDown',' ','Enter'].indexOf(e.key)>=0){e.preventDefault();show(cur+1)}
    else if(['ArrowLeft','ArrowUp','PageUp','Backspace'].indexOf(e.key)>=0){e.preventDefault();show(cur-1)}
    else if(e.key==='Home')show(0);else if(e.key==='End')show(slides.length-1);
    else if(e.key==='Escape')stop();
    else if(e.key==='f'||e.key==='F'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()}
  });
  document.addEventListener('click',function(e){if(document.body.classList.contains('present')&&e.target.closest('.slide'))show(cur+1)});
})();
`

/**
 * `script: false` for the in-app preview: its sandboxed iframe runs no scripts anyway, and
 * leaving the tag out keeps the console free of the "blocked script" error.
 */
export function renderDeckHtml(deck: Deck, opts: { script?: boolean } = {}): string {
  const total = deck.slides.length
  const slides = deck.slides.map((s, i) => slideHtml(s, i, total, deck.title)).join('\n')
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="plan-up · Claude">
<title>${escapeHtml(deck.title)}</title>
<style>${CSS}</style>
</head>
<body>
${opts.script === false ? '' : `<div class="bar-top"><span class="t">${escapeHtml(deck.title)} · ${total} slide${total === 1 ? '' : 's'} · double-click a slide or press P to present, ←/→ to move, F full screen, Esc to stop</span><button id="present" type="button">Present</button></div>`}
${slides}
${opts.script === false ? '' : `<script>${SCRIPT}</script>`}
</body>
</html>
`
}

/** File name for a deck: its title without characters a file system rejects. */
export function deckFileName(title: string): string {
  const base = title
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .slice(0, 80)
    // A trailing dot would meet ".html" as ".." — which the Rust side refuses.
    .replace(/[.\s]+$/, '')
  return `${base || 'plan-up deck'}.html`
}
