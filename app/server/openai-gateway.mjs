#!/usr/bin/env node
import { createServer as createHttpServer } from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(__dirname, '..')
const distDir = join(root, 'dist')
loadEnvFile(join(root, '.env'))
loadEnvFile(join(root, '.env.local'))

const isProduction = process.env.NODE_ENV === 'production'
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 5173)
const sessionCookie = 'planup_openai_gateway'
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7
const defaultModel = process.env.OPENAI_MODEL || 'gpt-5.2'
const sessions = new Map()
const serverDataDir = resolve(process.env.PLAN_UP_DATA_DIR || join(root, '.plan-up'))
const serverDbFile = join(serverDataDir, 'server-db.json')
const projectCacheDir = join(serverDataDir, 'cache', 'projects')
const projectIndexFile = join(serverDataDir, 'cache', 'projects.json')

async function main() {
  const vite = isProduction ? null : await createDevViteServer()

  const server = createHttpServer(async (req, res) => {
    try {
      if (await handleApi(req, res)) return
      if (vite) {
        vite.middlewares(req, res, () => notFound(res))
        return
      }
      await serveStatic(req, res)
    } catch (err) {
      vite?.ssrFixStacktrace(err)
      console.error(err)
      json(res, err?.statusCode ?? 500, { error: err?.message ?? 'Gateway server error.' })
    }
  })

  server.listen(port, host, () => {
    console.log(`plan-up gateway listening at http://${host}:${port}`)
  })
}

async function createDevViteServer() {
  const { createServer } = await import('vite')
  return createServer({
    root,
    appType: 'spa',
    server: { middlewareMode: true },
  })
}

async function handleApi(req, res) {
  const url = requestUrl(req)
  if (!url.pathname.startsWith('/api/')) return false

  if (req.method === 'GET' && url.pathname === '/api/db/snapshot') {
    const snapshot = await readServerSnapshot()
    json(res, 200, snapshot ? { hasSnapshot: true, snapshot } : { hasSnapshot: false })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/db/snapshot') {
    const body = await readJson(req)
    const snapshot = isExportPayloadLike(body?.snapshot) ? body.snapshot : body
    const saved = await writeServerSnapshot(snapshot)
    json(res, 200, {
      ok: true,
      exportedAt: saved.exportedAt,
      projectCount: Array.isArray(saved.projects) ? saved.projects.length : 0,
    })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/actions/apply') {
    const body = await readJson(req)
    const snapshot = await readServerSnapshot()
    if (!snapshot) {
      json(res, 409, { error: 'Server snapshot is empty. Open the app once first.' })
      return true
    }
    const result = applyPlanupActions(snapshot, body)
    if (!body?.dryRun && result.changed) await writeServerSnapshot(result.snapshot)
    json(res, 200, {
      ok: result.results.every((item) => item.ok),
      changed: result.changed,
      dryRun: Boolean(body?.dryRun),
      exportedAt: result.snapshot.exportedAt,
      results: result.results,
    })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    const snapshot = await readServerSnapshot()
    const projects = snapshot ? projectIndexFromSnapshot(snapshot) : []
    json(res, 200, {
      projects,
      snapshotUpdatedAt: snapshot?.exportedAt ?? null,
    })
    return true
  }

  if (req.method === 'GET') {
    const route = projectApiRoute(url.pathname)
    if (route) {
      const snapshot = await readServerSnapshot()
      const bundle = snapshot ? projectBundleFromSnapshot(snapshot, route.projectId) : null
      if (!bundle) {
        json(res, 404, { error: 'Project not found.' })
        return true
      }
      json(
        res,
        200,
        route.kind === 'context'
          ? { projectId: route.projectId, exportedAt: bundle.exportedAt, bundle }
          : bundle
      )
      return true
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const authenticated = Boolean(validSession(req))
    json(res, 200, {
      authenticated,
      configured: Boolean(openAiKey()),
      user: authenticated ? { name: 'OpenAI gateway' } : undefined,
    })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/openai/start') {
    if (!openAiKey()) {
      html(
        res,
        503,
        'OpenAI gateway is not configured. Set OPENAI_API_KEY on the server and restart.'
      )
      return true
    }
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, Date.now() + sessionMaxAgeSeconds * 1000)
    const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
    res.writeHead(302, {
      Location: returnTo,
      'Set-Cookie': serializeCookie(sessionCookie, token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: sessionMaxAgeSeconds,
      }),
    })
    res.end()
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = readCookie(req, sessionCookie)
    if (token) sessions.delete(token)
    res.writeHead(204, {
      'Set-Cookie': serializeCookie(sessionCookie, '', {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 0,
      }),
    })
    res.end()
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    if (!validSession(req)) {
      json(res, 401, { error: 'OpenAI gateway session required.' })
      return true
    }
    if (!openAiKey()) {
      json(res, 503, { error: 'OpenAI gateway is not configured.' })
      return true
    }
    const body = await readJson(req)
    const messages = sanitizeMessages(body?.messages)
    if (!messages.length) {
      json(res, 400, { error: 'messages is required.' })
      return true
    }
    const model = normalizeModel(body?.model)
    const outputText = await callOpenAiResponses({ model, messages })
    json(res, 200, proposalFromText(outputText))
    return true
  }

  json(res, 404, { error: 'Unknown API route.' })
  return true
}

async function readServerSnapshot() {
  try {
    const raw = await readFile(serverDbFile, 'utf8')
    const snapshot = JSON.parse(raw)
    if (!isExportPayloadLike(snapshot)) return null
    return snapshot
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

async function writeServerSnapshot(value) {
  if (!isExportPayloadLike(value)) {
    const err = new Error('Not a valid plan-up snapshot.')
    err.statusCode = 400
    throw err
  }
  const snapshot = {
    ...value,
    exportedAt:
      typeof value.exportedAt === 'string' && value.exportedAt.trim()
        ? value.exportedAt
        : new Date().toISOString(),
  }
  await mkdir(serverDataDir, { recursive: true })
  await writeJsonAtomic(serverDbFile, snapshot)
  await writeProjectCache(snapshot)
  return snapshot
}

async function writeProjectCache(snapshot) {
  await rm(projectCacheDir, { recursive: true, force: true })
  await mkdir(projectCacheDir, { recursive: true })
  const index = projectIndexFromSnapshot(snapshot)
  await writeJsonAtomic(projectIndexFile, {
    exportedAt: snapshot.exportedAt,
    projects: index,
  })
  for (const project of Array.isArray(snapshot.projects) ? snapshot.projects : []) {
    const bundle = projectBundleFromSnapshot(snapshot, project.id)
    if (!bundle) continue
    await writeJsonAtomic(join(projectCacheDir, `${encodeURIComponent(project.id)}.json`), bundle)
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

function isExportPayloadLike(value) {
  return (
    value &&
    typeof value === 'object' &&
    [1, 2, 3, 4, 5].includes(value.version) &&
    typeof value.exportedAt === 'string' &&
    Array.isArray(value.members) &&
    Array.isArray(value.sprints) &&
    Array.isArray(value.tasks) &&
    (value.projects === undefined || Array.isArray(value.projects)) &&
    (value.collections === undefined || Array.isArray(value.collections)) &&
    (value.events === undefined || Array.isArray(value.events)) &&
    (value.aiThreads === undefined || Array.isArray(value.aiThreads)) &&
    (value.aiMessages === undefined || Array.isArray(value.aiMessages))
  )
}

function projectIndexFromSnapshot(snapshot) {
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : []
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      description: project.description ?? '',
      color: project.color,
      icon: project.icon,
      memberCount: countByProject(snapshot.members, project.id),
      sprintCount: countByProject(snapshot.sprints, project.id),
      collectionCount: countByProject(snapshot.collections ?? [], project.id),
      taskCount: countByProject(snapshot.tasks, project.id),
    }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

function countByProject(rows, projectId) {
  return rows.filter((row) => row?.projectId === projectId).length
}

function projectApiRoute(pathname) {
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/(context|export)$/)
  if (!match) return null
  return {
    projectId: decodeURIComponent(match[1]),
    kind: match[2],
  }
}

function projectBundleFromSnapshot(snapshot, projectId) {
  const project = (snapshot.projects ?? []).find((p) => p.id === projectId)
  if (!project) return null
  return {
    version: 5,
    kind: 'project',
    exportedAt: snapshot.exportedAt,
    project,
    members: snapshot.members.filter((row) => row.projectId === projectId),
    sprints: snapshot.sprints.filter((row) => row.projectId === projectId),
    collections: (snapshot.collections ?? []).filter((row) => row.projectId === projectId),
    tasks: snapshot.tasks.filter((row) => row.projectId === projectId),
    events: (snapshot.events ?? []).filter((row) => row.projectId === projectId),
    aiThreads: (snapshot.aiThreads ?? []).filter((row) => row.projectId === projectId),
    aiMessages: (snapshot.aiMessages ?? []).filter((row) => row.projectId === projectId),
  }
}

function applyPlanupActions(sourceSnapshot, request) {
  const snapshot = structuredCloneJson(sourceSnapshot)
  const projectId = cleanString(request?.projectId)
  const project = (snapshot.projects ?? []).find((p) => p.id === projectId)
  if (!project) {
    return {
      snapshot,
      changed: false,
      results: [{ ok: false, label: `Project not found: ${projectId ?? 'missing'}` }],
    }
  }

  normalizeSnapshotArrays(snapshot)
  const actions = normalizePlanupActions(request?.actions)
  const ctx = buildActionContext(snapshot, project.id, {
    sprintId: cleanString(request?.sprintId),
    collectionId: cleanString(request?.collectionId),
  })
  const results = []
  let changed = false
  for (const action of actions) {
    try {
      const before = JSON.stringify(snapshot)
      const result = applyOnePlanupAction(snapshot, ctx, action)
      results.push(result)
      if (result.ok && JSON.stringify(snapshot) !== before) {
        changed = true
        refreshActionContext(ctx, snapshot)
      }
    } catch (err) {
      results.push({
        ok: false,
        label: `${action.type} failed`,
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (!actions.length) {
    results.push({ ok: false, label: 'No valid actions supplied.' })
  }
  if (changed) snapshot.exportedAt = new Date().toISOString()
  return { snapshot, changed, results }
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeSnapshotArrays(snapshot) {
  snapshot.projects ??= []
  snapshot.members ??= []
  snapshot.sprints ??= []
  snapshot.collections ??= []
  snapshot.tasks ??= []
  snapshot.events ??= []
  snapshot.people ??= []
  snapshot.aiThreads ??= []
  snapshot.aiMessages ??= []
}

function buildActionContext(snapshot, projectId, selection) {
  const sprints = snapshot.sprints
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
  const collections = snapshot.collections
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const sprint =
    sprints.find((s) => s.id === selection.sprintId) ??
    latestActiveSprintFromList(sprints) ??
    sprints.at(-1) ??
    null
  const collection = collections.find((c) => c.id === selection.collectionId) ?? null
  return {
    projectId,
    sprintId: sprint?.id ?? null,
    collectionId: collection?.id ?? null,
    project: snapshot.projects.find((p) => p.id === projectId) ?? null,
    sprints,
    collections,
    members: snapshot.members.filter((m) => m.projectId === projectId),
    tasks: snapshot.tasks.filter((t) => t.projectId === projectId),
  }
}

function refreshActionContext(ctx, snapshot) {
  const next = buildActionContext(snapshot, ctx.projectId, {
    sprintId: ctx.sprintId,
    collectionId: ctx.collectionId,
  })
  Object.assign(ctx, next)
}

function applyOnePlanupAction(snapshot, ctx, action) {
  if (action.type === 'create_member') {
    if (findMemberByName(action.name, ctx.members)) {
      return { ok: false, label: `Member already exists: ${action.name}` }
    }
    const member = {
      id: uid(),
      projectId: ctx.projectId,
      name: action.name,
      color: colorForName(action.name),
      daysOff: [],
      order: nextMemberOrder(ctx.members),
      ...(action.title ? { title: action.title } : {}),
    }
    snapshot.members.push(member)
    return { ok: true, label: `Created member "${member.name}"` }
  }

  if (action.type === 'update_member') {
    const member = findMemberByName(action.memberName, ctx.members)
    if (!member) return { ok: false, label: `Member not found: ${action.memberName}` }
    if (action.name && findMemberByName(action.name, ctx.members, member.id)) {
      return { ok: false, label: `Member already exists: ${action.name}` }
    }
    if (action.name) member.name = action.name
    if (action.title !== undefined) member.title = action.title ?? ''
    return { ok: true, label: `Updated member "${action.memberName}"` }
  }

  if (action.type === 'delete_member') {
    const member = findMemberByName(action.memberName, ctx.members)
    if (!member) return { ok: false, label: `Member not found: ${action.memberName}` }
    snapshot.members = snapshot.members.filter((m) => m.id !== member.id)
    for (const task of snapshot.tasks) {
      if (task.assigneeId === member.id) task.assigneeId = null
    }
    return { ok: true, label: `Deleted member "${member.name}"` }
  }

  if (action.type === 'set_member_day_off') {
    const member = findMemberByName(action.memberName, ctx.members)
    if (!member) return { ok: false, label: `Member not found: ${action.memberName}` }
    const dayOff = action.halfDay === 'am' || action.halfDay === 'pm'
      ? { date: action.date, half: action.halfDay }
      : { date: action.date }
    member.daysOff = [...(member.daysOff ?? []).filter((d) => d.date !== action.date), dayOff]
      .sort((a, b) => a.date.localeCompare(b.date))
    return { ok: true, label: `Set ${member.name} day off on ${action.date}` }
  }

  if (action.type === 'remove_member_day_off') {
    const member = findMemberByName(action.memberName, ctx.members)
    if (!member) return { ok: false, label: `Member not found: ${action.memberName}` }
    const before = member.daysOff?.length ?? 0
    member.daysOff = (member.daysOff ?? []).filter((d) => d.date !== action.date)
    return {
      ok: before !== member.daysOff.length,
      label: before !== member.daysOff.length
        ? `Removed ${member.name} day off on ${action.date}`
        : `${member.name} has no day off on ${action.date}`,
    }
  }

  if (action.type === 'create_sprint') {
    const startDate = action.startDate ?? defaultSprintDatesFor(ctx.sprints).startDate
    if (!isMonday(startDate)) return { ok: false, label: 'Sprint start must be a Monday.' }
    const sprint = {
      id: uid(),
      projectId: ctx.projectId,
      name: `Sprint ${nextSprintNumber(ctx.sprints)}`,
      startDate,
      endDate: sprintEndForStart(startDate),
      ...(action.note ? { note: action.note } : {}),
    }
    snapshot.sprints.push(sprint)
    snapshot.events.push(sprintEvent(ctx.projectId, sprint.id, 'sprint_started'))
    return { ok: true, label: `Created ${sprint.name}` }
  }

  if (action.type === 'update_sprint' || action.type === 'add_sprint_note') {
    const sprint = ctx.sprints.find((s) => s.id === ctx.sprintId)
    if (!sprint) return { ok: false, label: 'Select a sprint before updating it' }
    if (action.type === 'update_sprint' && action.startDate !== undefined) {
      if (!isMonday(action.startDate)) return { ok: false, label: 'Sprint start must be a Monday.' }
      sprint.startDate = action.startDate
      sprint.endDate = sprintEndForStart(action.startDate)
    }
    const note = action.type === 'add_sprint_note' ? action.note : action.note
    if (note !== undefined) sprint.note = note?.trim() || undefined
    return { ok: true, label: `Updated ${sprint.name}` }
  }

  if (action.type === 'delete_sprint') {
    const sprint = ctx.sprints.find((s) => s.id === ctx.sprintId)
    if (!sprint) return { ok: false, label: 'Select a sprint before deleting it' }
    const deletedTaskIds = new Set(snapshot.tasks.filter((t) => t.sprintId === sprint.id).map((t) => t.id))
    snapshot.sprints = snapshot.sprints.filter((s) => s.id !== sprint.id)
    snapshot.tasks = snapshot.tasks.filter((t) => t.sprintId !== sprint.id)
    snapshot.events = snapshot.events.filter((e) => e.sprintId !== sprint.id)
    stripDanglingTaskReferences(snapshot, deletedTaskIds)
    return { ok: true, label: `Deleted ${sprint.name}` }
  }

  if (action.type === 'create_collection') {
    if (findCollectionByName(action.name, ctx.collections)) {
      return { ok: false, label: `Collection already exists: ${action.name}` }
    }
    const collection = {
      id: uid(),
      projectId: ctx.projectId,
      name: action.name,
      order: nextCollectionOrder(ctx.collections),
      sections: [{ id: uid(), name: 'All' }],
      statuses: [
        { id: uid(), name: 'FEATURE', color: '#FF9500' },
        { id: uid(), name: 'EVENT', color: '#0071E3' },
      ],
      createdAt: Date.now(),
    }
    snapshot.collections.push(collection)
    return { ok: true, label: `Created collection "${collection.name}"` }
  }

  if (action.type === 'update_collection') {
    const collection = findCollection(action, ctx)
    if (!collection) return { ok: false, label: 'Collection not found for update' }
    const dupe = findCollectionByName(action.name, ctx.collections, collection.id)
    if (dupe) return { ok: false, label: `Collection already exists: ${action.name}` }
    const from = collection.name
    collection.name = action.name
    return { ok: true, label: `Renamed collection "${from}" to "${collection.name}"` }
  }

  if (action.type === 'delete_collection') {
    const collection = findCollection(action, ctx)
    if (!collection) return { ok: false, label: 'Collection not found for delete' }
    const deletedTaskIds = new Set(snapshot.tasks.filter((t) => t.collectionId === collection.id).map((t) => t.id))
    snapshot.collections = snapshot.collections.filter((c) => c.id !== collection.id)
    snapshot.tasks = snapshot.tasks.filter((t) => t.collectionId !== collection.id)
    stripDanglingTaskReferences(snapshot, deletedTaskIds)
    return { ok: true, label: `Deleted collection "${collection.name}"` }
  }

  if (action.type === 'create_task' || action.type === 'create_milestone') {
    const sprint = ctx.sprints.find((s) => s.id === ctx.sprintId)
    if (!sprint) return { ok: false, label: 'Select a sprint before creating tasks' }
    const assignee = findMemberByName(action.assigneeName, ctx.members)
    if (action.assigneeName && !assignee) {
      return { ok: false, label: `Member not found: ${action.assigneeName}` }
    }
    const milestoneDate = action.type === 'create_milestone' ? (action.date ?? sprint.startDate) : null
    const task = {
      id: uid(),
      projectId: ctx.projectId,
      sequence: nextTaskSequence(snapshot.tasks, sprint.id),
      title: action.title,
      assigneeId: assignee?.id ?? null,
      sprintId: sprint.id,
      status: action.status ?? 'todo',
      priority: action.priority ?? 'normal',
      startDate: milestoneDate ?? action.startDate ?? sprint.startDate,
      dueDate: milestoneDate ?? action.dueDate ?? null,
      estimate: action.type === 'create_milestone' ? 0 : (action.estimate ?? null),
      createdAt: Date.now(),
      dependsOn: [],
    }
    snapshot.tasks.push(task)
    snapshot.events.push(taskEvent(task, sprint.id, 'created'))
    return { ok: true, label: `Created ${action.type === 'create_milestone' ? 'milestone' : 'task'} #${task.sequence} "${task.title}"` }
  }

  if (action.type === 'update_task' || action.type === 'update_milestone') {
    const task = action.type === 'update_milestone'
      ? findMilestone(action, ctx)
      : findTask(action, ctx)
    if (!task) return { ok: false, label: `${action.type === 'update_milestone' ? 'Milestone' : 'Task'} not found for update` }
    const patch = {}
    if (action.title) patch.title = action.title
    if (action.status) patch.status = action.status
    if (action.priority) patch.priority = action.priority
    if ('estimate' in action && action.estimate !== undefined) patch.estimate = action.estimate
    if ('startDate' in action && action.startDate !== undefined) patch.startDate = action.startDate
    if ('dueDate' in action && action.dueDate !== undefined) patch.dueDate = action.dueDate
    if ('date' in action && action.date !== undefined) {
      patch.startDate = action.date
      patch.dueDate = action.date
    }
    if (action.assigneeName !== undefined) {
      if (action.assigneeName === null) patch.assigneeId = null
      else {
        const assignee = findMemberByName(action.assigneeName, ctx.members)
        if (!assignee) return { ok: false, label: `Member not found: ${action.assigneeName}` }
        patch.assigneeId = assignee.id
      }
    }
    if (!Object.keys(patch).length) return { ok: false, label: `No valid changes for #${task.sequence}` }
    Object.assign(task, patch)
    return { ok: true, label: `Updated ${action.type === 'update_milestone' ? 'milestone' : 'task'} #${task.sequence}` }
  }

  if (action.type === 'delete_task' || action.type === 'delete_milestone') {
    const task = action.type === 'delete_milestone' ? findMilestone(action, ctx) : findTask(action, ctx)
    if (!task) return { ok: false, label: `${action.type === 'delete_milestone' ? 'Milestone' : 'Task'} not found for delete` }
    snapshot.tasks = snapshot.tasks.filter((t) => t.id !== task.id)
    stripDanglingTaskReferences(snapshot, new Set([task.id]))
    for (const child of snapshot.tasks) if (child.parentId === task.id) child.parentId = null
    return { ok: true, label: `Deleted ${action.type === 'delete_milestone' ? 'milestone' : 'task'} #${task.sequence} "${task.title}"` }
  }

  if (action.type === 'move_task_to_next_sprint') {
    const task = findTask(action, ctx)
    if (!task) return { ok: false, label: 'Task not found for move' }
    const sourceId = task.sprintId ?? ctx.sprintId
    const sourceIndex = ctx.sprints.findIndex((s) => s.id === sourceId)
    const target = sourceIndex >= 0 ? ctx.sprints.slice(sourceIndex + 1).find((s) => s.archivedAt == null) : null
    if (!target) return { ok: false, label: 'No next active sprint found for move' }
    moveTaskIntoSprint(snapshot, task, target)
    return { ok: true, label: `Moved task #${task.sequence} to ${target.name}` }
  }

  if (action.type === 'move_task_to_sprint') {
    const task = findTask(action, ctx)
    if (!task) return { ok: false, label: 'Task not found for sprint move' }
    const sprint = findSprint(action, ctx.sprints)
    if (!sprint || sprint.archivedAt != null) {
      return { ok: false, label: `Sprint not found: ${action.sprintName ?? action.sprintId ?? 'unknown'}` }
    }
    moveTaskIntoSprint(snapshot, task, sprint)
    return { ok: true, label: `Moved task #${task.sequence} to ${sprint.name}` }
  }

  if (action.type === 'move_task_to_collection') {
    const task = findTask(action, ctx)
    if (!task) return { ok: false, label: 'Task not found for collection move' }
    const collection = findCollection(action, ctx)
    if (!collection) {
      return { ok: false, label: `Collection not found: ${action.collectionName ?? action.collectionId ?? 'unknown'}` }
    }
    task.sprintId = null
    task.collectionId = collection.id
    task.sectionId = collection.sections?.[0]?.id ?? null
    task.collectionStatusId = collection.statuses?.[0]?.id ?? null
    task.dependsOn = []
    task.parentId = null
    delete task.boardOrder
    delete task.listOrder
    stripDanglingTaskReferences(snapshot, new Set([task.id]))
    return { ok: true, label: `Moved task #${task.sequence} to collection ${collection.name}` }
  }

  return { ok: false, label: `Unsupported action: ${action.type}` }
}

function normalizePlanupActions(value) {
  return (Array.isArray(value) ? value : []).map(normalizePlanupAction).filter(Boolean).slice(0, 100)
}

function normalizePlanupAction(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = raw.type
  const action = { type }
  for (const key of [
    'title', 'taskTitle', 'assigneeName', 'status', 'priority', 'startDate', 'dueDate',
    'date', 'note', 'sprintId', 'sprintName', 'collectionId', 'collectionName',
    'name', 'memberName', 'title',
  ]) {
    if (raw[key] !== undefined) action[key] = raw[key] === null ? null : cleanString(raw[key])
  }
  if (raw.taskSeq !== undefined) action.taskSeq = cleanPositiveInt(raw.taskSeq)
  if (raw.estimate !== undefined) action.estimate = raw.estimate === null ? null : cleanNonNegativeNumber(raw.estimate)
  if (raw.halfDay !== undefined || raw.half !== undefined) action.halfDay = cleanHalfDay(raw.halfDay ?? raw.half)
  if (raw.type === 'create_task' && action.title) return action
  if (raw.type === 'create_milestone' && action.title) return action
  if (raw.type === 'update_task' && (action.taskSeq || action.taskTitle)) return action
  if (raw.type === 'delete_task' && (action.taskSeq || action.taskTitle)) return action
  if (raw.type === 'update_milestone' && (action.taskSeq || action.taskTitle)) return action
  if (raw.type === 'delete_milestone' && (action.taskSeq || action.taskTitle)) return action
  if (raw.type === 'move_task_to_next_sprint' && (action.taskSeq || action.taskTitle)) return action
  if (raw.type === 'move_task_to_sprint' && (action.taskSeq || action.taskTitle) && (action.sprintId || action.sprintName)) return action
  if (raw.type === 'move_task_to_collection' && (action.taskSeq || action.taskTitle) && (action.collectionId || action.collectionName)) return action
  if (raw.type === 'create_sprint') return action
  if (raw.type === 'update_sprint' && (action.startDate !== undefined || action.note !== undefined)) return action
  if (raw.type === 'add_sprint_note' && action.note) return action
  if (raw.type === 'delete_sprint') return action
  if (raw.type === 'create_collection' && action.name) return action
  if (raw.type === 'update_collection' && action.name) return action
  if (raw.type === 'delete_collection') return action
  if (raw.type === 'create_member' && action.name) return action
  if (raw.type === 'update_member' && action.memberName && (action.name || action.title !== undefined)) return action
  if (raw.type === 'delete_member' && action.memberName) return action
  if (raw.type === 'set_member_day_off' && action.memberName && action.date) return action
  if (raw.type === 'remove_member_day_off' && action.memberName && action.date) return action
  return null
}

function cleanString(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function cleanPositiveInt(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

function cleanNonNegativeNumber(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function cleanHalfDay(value) {
  const v = cleanString(value)?.toLowerCase()
  if (!v) return undefined
  if (['all', 'full', 'day', 'full_day', 'full-day'].includes(v)) return 'all'
  if (['am', 'morning'].includes(v)) return 'am'
  if (['pm', 'afternoon'].includes(v)) return 'pm'
  return undefined
}

function uid() {
  return randomUUID()
}

function colorForName(name) {
  const palette = ['#a855f7', '#f97316', '#3b82f6', '#10b981', '#ef4444', '#eab308', '#ec4899', '#14b8a6']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

function findMemberByName(name, members, excludeId) {
  const q = cleanString(name)?.toLowerCase()
  if (!q) return null
  return members.find((m) => m.id !== excludeId && m.name?.toLowerCase() === q) ?? null
}

function findTask(action, ctx) {
  const scope = ctx.collectionId
    ? ctx.tasks.filter((t) => t.collectionId === ctx.collectionId)
    : ctx.sprintId
      ? ctx.tasks.filter((t) => t.sprintId === ctx.sprintId)
      : ctx.tasks
  if (action.taskSeq) {
    const bySeq = scope.find((t) => t.sequence === action.taskSeq)
    if (bySeq) return bySeq
  }
  const title = action.taskTitle?.trim().toLowerCase()
  if (!title) return null
  return scope.find((t) => t.title.toLowerCase() === title) ?? scope.find((t) => t.title.toLowerCase().includes(title)) ?? null
}

function findMilestone(action, ctx) {
  const task = findTask(action, ctx)
  return task?.estimate === 0 ? task : null
}

function findSprint(action, sprints) {
  if (action.sprintId) {
    const byId = sprints.find((s) => s.id === action.sprintId)
    if (byId) return byId
  }
  const q = action.sprintName?.trim().toLowerCase()
  if (!q) return null
  return sprints.find((s) => s.name.toLowerCase() === q) ?? sprints.find((s) => s.name.toLowerCase().includes(q)) ?? null
}

function findCollection(action, ctx) {
  if (action.collectionId) {
    const byId = ctx.collections.find((c) => c.id === action.collectionId)
    if (byId) return byId
  }
  const q = action.collectionName?.trim().toLowerCase()
  if (q) {
    return ctx.collections.find((c) => c.name.toLowerCase() === q) ?? ctx.collections.find((c) => c.name.toLowerCase().includes(q)) ?? null
  }
  return ctx.collections.find((c) => c.id === ctx.collectionId) ?? null
}

function findCollectionByName(name, collections, excludeId) {
  const q = cleanString(name)?.toLowerCase()
  if (!q) return null
  return collections.find((c) => c.id !== excludeId && c.name.toLowerCase() === q) ?? null
}

function nextMemberOrder(members) {
  return members.reduce((max, m) => Math.max(max, m.order ?? -1), -1) + 1
}

function nextCollectionOrder(collections) {
  return collections.reduce((max, c) => Math.max(max, c.order ?? -1), -1) + 1
}

function nextTaskSequence(tasks, sprintId) {
  return tasks.filter((t) => t.sprintId === sprintId).reduce((max, t) => Math.max(max, t.sequence ?? 0), 0) + 1
}

function latestActiveSprintFromList(sprints) {
  for (let i = sprints.length - 1; i >= 0; i--) {
    if (sprints[i].archivedAt == null) return sprints[i]
  }
  return null
}

function nextSprintNumber(sprints) {
  let max = 0
  for (const sprint of sprints) {
    const match = String(sprint.name ?? '').match(/Sprint\s+(\d+)/i)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max > 0 ? max + 1 : sprints.length + 1
}

function defaultSprintDatesFor(sprints) {
  const latest = latestActiveSprintFromList(sprints)
  return defaultSprintDates(latest?.endDate ?? null, todayLocalISO())
}

function todayLocalISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function defaultSprintDates(lastEndDate, todayStr) {
  const thisWeek = snapToMonday(todayStr)
  let startDate = thisWeek
  if (lastEndDate) {
    const d = new Date(`${lastEndDate}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    const afterLast = nextMondayOnOrAfter(d.toISOString().slice(0, 10))
    startDate = afterLast > thisWeek ? afterLast : thisWeek
  }
  return { startDate, endDate: sprintEndForStart(startDate) }
}

function sprintEndForStart(startDate) {
  const date = new Date(`${startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 13)
  return date.toISOString().slice(0, 10)
}

function snapToMonday(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const delta = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - delta)
  return date.toISOString().slice(0, 10)
}

function nextMondayOnOrAfter(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const delta = (8 - date.getUTCDay()) % 7
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

function isMonday(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && snapToMonday(dateStr) === dateStr
}

function sprintEvent(projectId, sprintId, kind) {
  return {
    id: uid(),
    projectId,
    sprintId,
    taskId: null,
    taskSeq: null,
    taskTitle: null,
    kind,
    from: null,
    to: null,
    ts: Date.now(),
  }
}

function taskEvent(task, sprintId, kind) {
  return {
    id: uid(),
    projectId: task.projectId,
    sprintId,
    taskId: task.id,
    taskSeq: task.sequence,
    taskTitle: task.title,
    kind,
    from: null,
    to: null,
    ts: Date.now(),
  }
}

function moveTaskIntoSprint(snapshot, task, sprint) {
  task.sprintId = sprint.id
  task.collectionId = null
  task.sectionId = null
  task.collectionStatusId = null
  task.sequence = nextTaskSequence(snapshot.tasks, sprint.id)
  if (!task.startDate || task.startDate < sprint.startDate) task.startDate = sprint.startDate
  delete task.boardOrder
  delete task.listOrder
  snapshot.events.push(taskEvent(task, sprint.id, 'rolled_over'))
}

function stripDanglingTaskReferences(snapshot, deletedTaskIds) {
  for (const task of snapshot.tasks) {
    if (Array.isArray(task.dependsOn)) {
      task.dependsOn = task.dependsOn.filter((id) => !deletedTaskIds.has(id))
    }
    if (deletedTaskIds.has(task.parentId)) task.parentId = null
  }
}

async function callOpenAiResponses({ model, messages }) {
  const input = messages.map((message) => ({
    role: message.role === 'system' ? 'developer' : message.role,
    content: message.content,
  }))
  const payload = {
    model,
    input,
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 4096),
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${text.slice(0, 400)}`)
  }
  const data = JSON.parse(text)
  return extractOpenAiOutputText(data)
}

function extractOpenAiOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text
  const out = []
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string') out.push(part.text)
    }
  }
  return out.join('\n').trim()
}

function proposalFromText(text) {
  const content = text.trim()
  if (!content) return { reply: 'The model returned an empty response.', actions: [] }
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        // Fall through to plain markdown reply.
      }
    }
  }
  return { reply: content, actions: [] }
}

function sanitizeMessages(value) {
  if (!Array.isArray(value)) return []
  return value
    .slice(-16)
    .map((message) => {
      const role = ['system', 'developer', 'user', 'assistant'].includes(message?.role)
        ? message.role
        : 'user'
      const content = typeof message?.content === 'string' ? message.content : ''
      return { role, content: content.slice(0, 80_000) }
    })
    .filter((message) => message.content.trim())
}

function normalizeModel(value) {
  if (typeof value !== 'string') return defaultModel
  const model = value.trim()
  if (!model || model === 'gpt-5.5') return defaultModel
  return model
}

function validSession(req) {
  const token = readCookie(req, sessionCookie)
  if (!token) return null
  const expiresAt = sessions.get(token)
  if (!expiresAt) return null
  if (expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  return token
}

function openAiKey() {
  return process.env.OPENAI_API_KEY?.trim()
}

function safeReturnTo(value) {
  if (!value) return '/'
  try {
    const url = new URL(value, 'http://local.plan-up')
    if (url.origin !== 'http://local.plan-up') return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const chunk of header.split(';')) {
    const [rawKey, ...rawValue] = chunk.trim().split('=')
    if (rawKey === name) return decodeURIComponent(rawValue.join('='))
  }
  return null
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (process.env.COOKIE_SECURE === 'true') parts.push('Secure')
  return parts.join('; ')
}

function requestUrl(req) {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (!raw.trim()) return null
  return JSON.parse(raw)
}

async function serveStatic(req, res) {
  const url = requestUrl(req)
  const pathname = decodeURIComponent(url.pathname)
  const target = safeStaticPath(pathname)
  if (target) {
    try {
      const info = await stat(target)
      if (info.isFile()) {
        res.writeHead(200, { 'Content-Type': contentType(target) })
        createReadStream(target).pipe(res)
        return
      }
    } catch {
      // Fall back to index.html for SPA routes.
    }
  }
  const index = join(distDir, 'index.html')
  if (!existsSync(index)) {
    html(res, 500, 'Build output not found. Run npm run build first.')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  createReadStream(index).pipe(res)
}

function safeStaticPath(pathname) {
  const clean = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '')
  const target = join(distDir, clean)
  return relative(distDir, target).startsWith('..') ? null : target
}

function contentType(file) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  return types[extname(file)] ?? 'application/octet-stream'
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function html(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<p>${escapeHtml(value)}</p>`)
}

function notFound(res) {
  res.writeHead(404)
  res.end('Not found')
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return entities[char]
  })
}

function loadEnvFile(file) {
  if (!existsSync(file)) return
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 1) continue
    const key = trimmed.slice(0, index).trim()
    if (process.env[key] !== undefined) continue
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '')
    process.env[key] = value
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
