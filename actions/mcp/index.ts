/**
 * MCP Server — Adobe I/O Runtime entry point.
 *
 * Single web action exposed at /mcp with raw-http: true.
 * Handles POST (JSON-RPC), GET (health), OPTIONS (CORS)
 * per MCP 2025-11-25 Streamable HTTP spec.
 *
 * Stateless: fresh server and transport per request, no session management.
 */

const { Core } = require('@adobe/aio-sdk');
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMCPServer } from './mcp-server';
import * as crypto from 'crypto';

// Polyfill crypto.randomUUID for Web Standard APIs
if (!(global as any).crypto) {
  (global as any).crypto = crypto;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, x-api-key',
  'Access-Control-Expose-Headers': 'Content-Type',
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

async function handlePost(params: any, headers: Record<string, string>, logger: any): Promise<any> {
  const body = parseBody(params);
  const server = createMCPServer();

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    await server.connect(transport);

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

    const responseBody = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key] = value;
    });

    logger?.info(`MCP request processed: ${body?.method || 'unknown'}`);

    return {
      statusCode: response.status,
      headers: { ...CORS_HEADERS, ...responseHeaders },
      body: responseBody
    };
  } catch (error: any) {
    logger?.error('Error in handlePost:', error);
    try { server.close(); } catch { /* ignore */ }
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: `Internal server error: ${error.message}` } })
    };
  }
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

    logger?.info(`MCP ${method.toUpperCase()}`);

    switch (method) {
      case 'options':
        return handleOptions();

      case 'get':
        return handleHealthCheck();

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
