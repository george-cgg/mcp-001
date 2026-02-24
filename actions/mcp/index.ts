/**
 * MCP Server — Adobe I/O Runtime entry point.
 *
 * Single web action exposed at /mcp with raw-http: true.
 * Handles POST (JSON-RPC), GET (health / SSE graceful), OPTIONS (CORS),
 * DELETE (session termination) per MCP 2025-11-25 Streamable HTTP spec.
 *
 * Session management via @adobe/aio-lib-state with 30-min sliding TTL.
 */

const { Core } = require('@adobe/aio-sdk');
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMCPServer } from './mcp-server';
import { createSession, getSession, deleteSession } from './session';
import * as crypto from 'crypto';

// Polyfill crypto.randomUUID for Web Standard APIs
if (!(global as any).crypto) {
  (global as any).crypto = crypto;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, x-api-key, mcp-session-id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Content-Type, mcp-session-id',
  'Access-Control-Max-Age': '86400'
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseBody(params: any): any {
  if (!params.__ow_body) return null;
  try {
    if (typeof params.__ow_body === 'string') {
      try {
        const decoded = Buffer.from(params.__ow_body, 'base64').toString('utf8');
        return JSON.parse(decoded);
      } catch {
        return JSON.parse(params.__ow_body);
      }
    }
    return params.__ow_body;
  } catch (err: any) {
    throw new Error(`Failed to parse request body: ${err.message}`);
  }
}

function normalizeHeaders(raw: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const key of Object.keys(raw)) {
    out[key.toLowerCase()] = raw[key];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Route handlers                                                     */
/* ------------------------------------------------------------------ */

function handleOptions(): any {
  return { statusCode: 200, headers: CORS_HEADERS, body: '' };
}

function handleHealthCheck(): any {
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'healthy',
      server: 'llm-apps',
      version: '0.0.3',
      transport: 'StreamableHTTP',
      timestamp: new Date().toISOString()
    })
  };
}

function handleSSENotSupported(): any {
  return {
    statusCode: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'close'
    },
    body: 'event: error\ndata: {"error": "SSE not supported in serverless. Use HTTP transport."}\n\n'
  };
}

async function handleDelete(sessionId: string | undefined): Promise<any> {
  if (!sessionId) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Mcp-Session-Id header required' } })
    };
  }
  await deleteSession(sessionId);
  return { statusCode: 200, headers: CORS_HEADERS, body: '' };
}

async function handlePost(params: any, headers: Record<string, string>, logger: any): Promise<any> {
  const body = parseBody(params);
  const sessionId = headers['mcp-session-id'];

  // Determine if this is an initialize request
  const messages = Array.isArray(body) ? body : [body];
  const isInit = messages.some((m: any) => m?.method === 'initialize');

  // If we have a session ID and it's not an init, verify the session exists
  if (sessionId && !isInit) {
    const session = await getSession(sessionId);
    if (!session) {
      return {
        statusCode: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: body?.id || null, error: { code: -32001, message: 'Session not found' } })
      };
    }
  }

  // Create fresh server + transport per request
  const server: McpServer = createMCPServer();

  // For initialize: generate a new session ID and persist it
  // For subsequent requests: pass the existing session ID through
  const newSessionId = crypto.randomUUID();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: isInit ? () => newSessionId : undefined
  });

  await server.connect(transport);

  // Build Web Standard Request — forward all original headers so the SDK
  // transport sees Accept, mcp-session-id, etc. as-is from the client.
  const url = `https://${headers['host'] || 'localhost'}/mcp`;
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...params.__ow_headers
    },
    body: JSON.stringify(body)
  });

  const response = await transport.handleRequest(request);

  // If this was an initialize, persist the session
  if (isInit) {
    await createSession(newSessionId, {
      capabilities: body?.params?.capabilities || {},
      createdAt: new Date().toISOString()
    });
    logger?.info(`Session created: ${newSessionId}`);
  }

  // Extract response
  const responseBody = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value: string, key: string) => {
    responseHeaders[key] = value;
  });

  return {
    statusCode: response.status,
    headers: { ...CORS_HEADERS, ...responseHeaders },
    body: responseBody
  };
}

/* ------------------------------------------------------------------ */
/*  AIO Runtime main                                                   */
/* ------------------------------------------------------------------ */

async function main(params: any): Promise<any> {
  let logger: any = null;
  try {
    try {
      logger = Core.Logger('llm-apps-mcp', { level: params.LOG_LEVEL || 'info' });
    } catch {
      // Logger init can fail outside AIO Runtime — fall back to console
    }

    const method = (params.__ow_method || 'get').toLowerCase();
    const headers = normalizeHeaders(params.__ow_headers);

    logger?.info(`MCP ${method.toUpperCase()} session=${headers['mcp-session-id'] || 'none'}`);

    switch (method) {
      case 'options':
        return handleOptions();

      case 'get': {
        const accept = headers['accept'] || '';
        if (accept.includes('text/event-stream')) {
          return handleSSENotSupported();
        }
        return handleHealthCheck();
      }

      case 'delete':
        return await handleDelete(headers['mcp-session-id']);

      case 'post':
        return await handlePost(params, headers, logger);

      default:
        return {
          statusCode: 405,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: `Method '${method}' not allowed` } })
        };
    }
  } catch (error: any) {
    logger?.error('MCP error:', error);
    console.error('MCP error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: error.message || 'Internal server error' } })
    };
  }
}

module.exports = { main };
