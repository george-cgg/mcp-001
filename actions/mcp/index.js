"use strict";
/**
 * MCP Server — Adobe I/O Runtime entry point.
 *
 * Single web action exposed at /mcp with raw-http: true.
 * Handles POST (JSON-RPC), GET (health / SSE graceful), OPTIONS (CORS),
 * DELETE (session termination) per MCP 2025-11-25 Streamable HTTP spec.
 *
 * Session management via @adobe/aio-lib-state with 30-min sliding TTL.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const { Core } = require('@adobe/aio-sdk');
const webStandardStreamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
const mcp_server_1 = require("./mcp-server");
const session_1 = require("./session");
const crypto = __importStar(require("crypto"));
// Polyfill crypto.randomUUID for Web Standard APIs
if (!global.crypto) {
    global.crypto = crypto;
}
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, x-api-key, mcp-session-id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'Content-Type, mcp-session-id',
    'Access-Control-Max-Age': '86400'
};
/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function parseBody(params) {
    if (!params.__ow_body)
        return null;
    try {
        if (typeof params.__ow_body === 'string') {
            try {
                const decoded = Buffer.from(params.__ow_body, 'base64').toString('utf8');
                return JSON.parse(decoded);
            }
            catch {
                return JSON.parse(params.__ow_body);
            }
        }
        return params.__ow_body;
    }
    catch (err) {
        throw new Error(`Failed to parse request body: ${err.message}`);
    }
}
function normalizeHeaders(raw) {
    const out = {};
    if (!raw)
        return out;
    for (const key of Object.keys(raw)) {
        out[key.toLowerCase()] = raw[key];
    }
    return out;
}
/* ------------------------------------------------------------------ */
/*  Route handlers                                                     */
/* ------------------------------------------------------------------ */
function handleOptions() {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
}
function handleHealthCheck() {
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
function handleSSENotSupported() {
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
async function handleDelete(sessionId) {
    if (!sessionId) {
        return {
            statusCode: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Mcp-Session-Id header required' } })
        };
    }
    await (0, session_1.deleteSession)(sessionId);
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
}
async function handlePost(params, headers, logger) {
    const body = parseBody(params);
    const sessionId = headers['mcp-session-id'];
    // Determine if this is an initialize request
    const messages = Array.isArray(body) ? body : [body];
    const isInit = messages.some((m) => m?.method === 'initialize');
    // If we have a session ID and it's not an init, verify the session exists
    if (sessionId && !isInit) {
        const session = await (0, session_1.getSession)(sessionId);
        if (!session) {
            return {
                statusCode: 404,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: body?.id || null, error: { code: -32001, message: 'Session not found' } })
            };
        }
    }
    // Create fresh server + transport per request
    const server = (0, mcp_server_1.createMCPServer)();
    // For initialize: generate a new session ID and persist it
    // For subsequent requests: pass the existing session ID through
    const newSessionId = crypto.randomUUID();
    const transport = new webStandardStreamableHttp_js_1.WebStandardStreamableHTTPServerTransport({
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
        await (0, session_1.createSession)(newSessionId, {
            capabilities: body?.params?.capabilities || {},
            createdAt: new Date().toISOString()
        });
        logger?.info(`Session created: ${newSessionId}`);
    }
    // Extract response
    const responseBody = await response.text();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
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
async function main(params) {
    let logger = null;
    try {
        try {
            logger = Core.Logger('llm-apps-mcp', { level: params.LOG_LEVEL || 'info' });
        }
        catch {
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
    }
    catch (error) {
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
