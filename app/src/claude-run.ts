// Runs one Claude question through the desktop app's `claude_stream` command (Claude Code CLI,
// the user's own subscription). See design-docs/claude-assistant.md.

/** Must match `ERROR_NOT_FOUND` in `src-tauri/src/claude.rs`. */
export const CLAUDE_NOT_FOUND = 'claude_not_found'

export type ClaudeModel = 'sonnet' | 'opus'

/** Claude Code fills `--json-schema` output through this tool. */
const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput'
const AUTH_ERROR = /authenticat|oauth|\/login|not logged in/i

type ClaudeEvent = { type: 'line'; line: string } | { type: 'exit'; code?: number | null; stderr: string }

type StreamJsonLine = {
  type: string
  event?: {
    type: string
    index?: number
    content_block?: { type: string; name?: string }
    delta?: { type: string; text?: string; partial_json?: string }
  }
  is_error?: boolean
  result?: string
  structured_output?: unknown
}

export interface RunClaudeOptions {
  model: ClaudeModel
  systemPrompt: string
  prompt: string
  jsonSchema: object
  signal: AbortSignal
  /** The `reply` string so far, while the answer is being written. */
  onReply?: (text: string) => void
  /** First line from the CLI arrived (the run is alive). */
  onAlive?: () => void
}

/** Friendly message for a failed run. */
export function describeClaudeError(message: string): string {
  if (message === CLAUDE_NOT_FOUND) {
    return "Claude Code isn't installed. Install it from claude.com/code, then run `claude` once in Terminal to log in."
  }
  if (AUTH_ERROR.test(message)) {
    return "Claude Code isn't logged in. Run `claude` in Terminal and log in with your Claude account."
  }
  return message
}

/**
 * Runs Claude Code and resolves with the `structured_output` of the final `result` line.
 * Rejects with an `AbortError` when `signal` fires (the process is killed).
 */
export async function runClaude(opts: RunClaudeOptions): Promise<unknown> {
  const { Channel, invoke } = await import('@tauri-apps/api/core')
  if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    let alive = false
    let structured: unknown
    let resultError: string | undefined
    // Index of the StructuredOutput tool_use block in the current assistant message.
    let toolBlock: number | null = null
    let partialJson = ''
    let lastReply = ''

    const onAbort = () => {
      void invoke('claude_cancel', { requestId })
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const channel = new Channel<ClaudeEvent>()
    channel.onmessage = (event) => {
      // Lines already buffered keep arriving until the process dies; a stopped run shows none.
      if (opts.signal.aborted) return
      if (!alive) {
        alive = true
        opts.onAlive?.()
      }
      if (event.type === 'line') {
        const parsed = parseLine(event.line)
        if (!parsed) return
        const ev = parsed.event
        if (parsed.type === 'stream_event' && ev) {
          if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
            if (ev.content_block.name === STRUCTURED_OUTPUT_TOOL) {
              toolBlock = ev.index ?? null
              partialJson = ''
            }
          } else if (
            ev.type === 'content_block_delta' &&
            ev.delta?.type === 'input_json_delta' &&
            ev.index === toolBlock &&
            ev.delta.partial_json
          ) {
            partialJson += ev.delta.partial_json
            const reply = readPartialJsonString(partialJson, 'reply')
            if (reply !== null && reply !== lastReply) {
              lastReply = reply
              opts.onReply?.(reply)
            }
          }
        }
        if (parsed.type === 'result') {
          if (parsed.is_error) resultError = parsed.result || 'Claude returned an error'
          else structured = parsed.structured_output
        }
        return
      }
      opts.signal.removeEventListener('abort', onAbort)
      if (resultError || event.code !== 0) {
        reject(new Error(resultError || event.stderr.trim() || `claude exited with code ${event.code}`))
        return
      }
      if (structured === undefined) {
        reject(new Error('Claude finished without an answer. Try again.'))
        return
      }
      resolve(structured)
    }

    opts.signal.addEventListener('abort', onAbort, { once: true })

    invoke('claude_stream', {
      requestId,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      // One stream-json user message (see src-tauri/src/claude.rs).
      prompt: `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: opts.prompt }] },
      })}\n`,
      jsonSchema: JSON.stringify(opts.jsonSchema),
      onEvent: channel,
    }).catch((err: unknown) => {
      opts.signal.removeEventListener('abort', onAbort)
      reject(new Error(String(err)))
    })
  })
}

function parseLine(line: string): StreamJsonLine | null {
  try {
    return JSON.parse(line) as StreamJsonLine
  } catch {
    return null
  }
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/**
 * The (possibly unfinished) string value of a top-level `key` in a JSON text that is still
 * being streamed. Returns null until the opening quote of the value has arrived. Stops before
 * an escape sequence that is cut off, so the text never shows half an escape.
 */
export function readPartialJsonString(json: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json)
  if (!match) return null
  let out = ''
  let i = match.index + match[0].length
  while (i < json.length) {
    const ch = json[i]
    if (ch === '"') return out
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    const next = json[i + 1]
    if (next === undefined) return out
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6)
      if (hex.length < 4) return out
      out += String.fromCharCode(parseInt(hex, 16))
      i += 6
      continue
    }
    out += SIMPLE_ESCAPES[next] ?? next
    i += 2
  }
  return out
}
