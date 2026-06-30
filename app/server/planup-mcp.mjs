#!/usr/bin/env node

const gatewayUrl = (process.env.PLAN_UP_GATEWAY_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) handleLine(line)
  }
})

async function handleLine(line) {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  if (request.method?.startsWith('notifications/')) return
  try {
    const result = await dispatch(request.method, request.params ?? {})
    respond({ jsonrpc: '2.0', id: request.id, result })
  } catch (err) {
    respond({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err),
      },
    })
  }
}

async function dispatch(method, params) {
  if (method === 'initialize') {
    return {
      protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'plan-up', version: '0.1.0' },
    }
  }
  if (method === 'tools/list') {
    return { tools: tools() }
  }
  if (method === 'tools/call') {
    return callTool(params.name, params.arguments ?? {})
  }
  throw new Error(`Unsupported MCP method: ${method}`)
}

async function callTool(name, args) {
  if (name === 'planup_list_projects') {
    return jsonContent(await gatewayGet('/api/projects'))
  }
  if (name === 'planup_get_project_context') {
    const projectId = requiredString(args.projectId, 'projectId')
    return jsonContent(await gatewayGet(`/api/projects/${encodeURIComponent(projectId)}/context`))
  }
  if (name === 'planup_apply_actions') {
    const projectId = requiredString(args.projectId, 'projectId')
    const actions = Array.isArray(args.actions) ? args.actions : []
    const body = {
      projectId,
      actions,
      dryRun: Boolean(args.dryRun),
    }
    if (typeof args.sprintId === 'string' && args.sprintId.trim()) body.sprintId = args.sprintId.trim()
    if (typeof args.collectionId === 'string' && args.collectionId.trim()) body.collectionId = args.collectionId.trim()
    return jsonContent(await gatewayPost('/api/actions/apply', body))
  }
  throw new Error(`Unknown tool: ${name}`)
}

async function gatewayGet(path) {
  const response = await fetch(`${gatewayUrl}${path}`, { headers: { Accept: 'application/json' } })
  return readGatewayResponse(response)
}

async function gatewayPost(path, body) {
  const response = await fetch(`${gatewayUrl}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readGatewayResponse(response)
}

async function readGatewayResponse(response) {
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { text }
  }
  if (!response.ok) {
    throw new Error(data?.error || `Gateway request failed (${response.status})`)
  }
  return data
}

function jsonContent(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function tools() {
  return [
    {
      name: 'planup_list_projects',
      description: 'List projects from the running plan-up gateway.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'planup_get_project_context',
      description: 'Get a full project context/export bundle from the running plan-up gateway.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['projectId'],
        properties: {
          projectId: { type: 'string' },
        },
      },
    },
    {
      name: 'planup_apply_actions',
      description: 'Apply plan-up typed actions to the server-primary snapshot through the gateway.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['projectId', 'actions'],
        properties: {
          projectId: { type: 'string' },
          sprintId: {
            type: 'string',
            description: 'Optional target sprint id for sprint-scoped task actions.',
          },
          collectionId: {
            type: 'string',
            description: 'Optional target collection id for collection-scoped task actions.',
          },
          dryRun: {
            type: 'boolean',
            description: 'When true, validate and preview results without writing.',
          },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['type'],
              properties: {
                type: { type: 'string' },
              },
            },
          },
        },
      },
    },
  ]
}
