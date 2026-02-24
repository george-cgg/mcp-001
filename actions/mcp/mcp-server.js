"use strict";
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
exports.createMCPServer = createMCPServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const helloWorld = __importStar(require("./experiences/headless/hello-world/index"));
const APP_NAME = 'llm-apps';
/**
 * Experience registry — each entry pairs a schema definition with its handler.
 *
 * During deploy, the pipeline reads experience metadata from the DB and
 * generates this file automatically. For the boilerplate we keep a single
 * hand-written hello-world experience so the server starts with one tool.
 */
const experiences = [
    {
        name: 'hello-world',
        version: '0.0.1',
        definition: {
            title: 'Hello World',
            description: 'Returns a greeting with the current server timestamp. A simple headless action to verify the MCP server is running.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: "Optional name to greet. Defaults to 'World'." }
                },
                required: []
            },
            annotations: {
                destructiveHint: false,
                openWorldHint: false,
                readOnlyHint: true
            }
        },
        handler: helloWorld.handler
    }
];
/**
 * Creates a fresh McpServer instance with all registered tools.
 * Called once per request in the serverless environment.
 */
function createMCPServer() {
    const server = new mcp_js_1.McpServer({ name: APP_NAME, version: '0.0.3' }, { capabilities: { tools: {} } });
    for (const exp of experiences) {
        // Build Zod schema from JSON schema definition
        const zodShape = {};
        const props = exp.definition.inputSchema.properties || {};
        const required = exp.definition.inputSchema.required || [];
        for (const [key, prop] of Object.entries(props)) {
            let field = zod_1.z.string();
            if (prop.description) {
                field = field.describe(prop.description);
            }
            if (!required.includes(key)) {
                field = field.optional();
            }
            zodShape[key] = field;
        }
        const hasProperties = Object.keys(zodShape).length > 0;
        server.tool(exp.name, exp.definition.description, hasProperties ? zodShape : {}, 
        // @ts-ignore — SDK generics cause TS2589 with dynamic Zod shapes
        async (args) => {
            console.log(`[${APP_NAME}] tool invoked: ${exp.name}`);
            return exp.handler(args);
        });
    }
    console.log(`[${APP_NAME}] Registered ${experiences.length} tool(s): ${experiences.map(e => e.name).join(', ')}`);
    return server;
}
