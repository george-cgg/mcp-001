"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMCPServer = createMCPServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const APP_NAME = 'llm-apps';
/**
 * Experience registry — populated at deploy time by the pipeline which reads
 * experience metadata from the DB and generates this module automatically.
 */
const experiences = [];
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
