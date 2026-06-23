#!/usr/bin/env node
import { createServer as createHttpServer } from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

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
      json(res, 500, { error: 'Gateway server error.' })
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
