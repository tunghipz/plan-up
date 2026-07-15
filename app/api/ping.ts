import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Diagnostic baseline. Uses ONLY the raw Node response API (no `.status()`/
 * `.json()` helpers, no imports) so it runs whether the function is loaded as
 * ESM or CJS. If this 200s but /api/share 500s, the problem is in the share code
 * or its imports; if this also fails, it's the functions setup (runtime/module).
 */
export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(
    JSON.stringify({
      ok: true,
      node: process.version,
      hasStatusHelper: typeof (res as unknown as { status?: unknown }).status === 'function',
    })
  )
}
