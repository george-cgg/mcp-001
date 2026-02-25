"use strict";
/**
 * MCP Server — Adobe I/O Runtime entry point.
 *
 * Single web action exposed at /mcp with raw-http: true.
 * Handles POST (JSON-RPC), GET (health), OPTIONS (CORS)
 * per MCP 2025-11-25 Streamable HTTP spec.
 *
 * Stateless: fresh server and transport per request, no session management.
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
const crypto = __importStar(require("crypto"));
// Polyfill crypto.randomUUID for Web Standard APIs
if (!global.crypto) {
    global.crypto = crypto;
}
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, x-api-key',
    'Access-Control-Expose-Headers': 'Content-Type',
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
async function handlePost(params, headers, logger) {
    const body = parseBody(params);
    const server = (0, mcp_server_1.createMCPServer)();
    try {
        const transport = new webStandardStreamableHttp_js_1.WebStandardStreamableHTTPServerTransport({
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
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });
        logger?.info(`MCP request processed: ${body?.method || 'unknown'}`);
        return {
            statusCode: response.status,
            headers: { ...CORS_HEADERS, ...responseHeaders },
            body: responseBody
        };
    }
    catch (error) {
        logger?.error('Error in handlePost:', error);
        try {
            server.close();
        }
        catch { /* ignore */ }
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
