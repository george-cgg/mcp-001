import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Action } from './types';
// @ts-ignore — plain JS handler, no declaration file
import * as helloWorld from './experiences/headless/hello-world/index';

const APP_NAME = 'llm-apps';

/**
 * Experience registry — each entry pairs a schema definition with its handler.
 *
 * During deploy, the pipeline reads experience metadata from the DB and
 * generates this file automatically. For the boilerplate we keep a single
 * hand-written hello-world experience so the server starts with one tool.
 */
const experiences: Action[] = [
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
export function createMCPServer(): McpServer {
  const server = new McpServer(
    { name: APP_NAME, version: '0.0.3' },
    { capabilities: { tools: {} } }
  );

  for (const exp of experiences) {
    // Build Zod schema from JSON schema definition
    const zodShape: Record<string, z.ZodTypeAny> = {};
    const props = exp.definition.inputSchema.properties || {};
    const required = exp.definition.inputSchema.required || [];

    for (const [key, prop] of Object.entries(props) as [string, any][]) {
      let field: z.ZodTypeAny = z.string();
      if (prop.description) {
        field = (field as z.ZodString).describe(prop.description);
      }
      if (!required.includes(key)) {
        field = field.optional();
      }
      zodShape[key] = field;
    }

    const hasProperties = Object.keys(zodShape).length > 0;

    server.tool(
      exp.name,
      exp.definition.description,
      hasProperties ? zodShape : {},
      // @ts-ignore — SDK generics cause TS2589 with dynamic Zod shapes
      async (args: any) => {
        console.log(`[${APP_NAME}] tool invoked: ${exp.name}`);
        return exp.handler(args);
      }
    );
  }

  console.log(`[${APP_NAME}] Registered ${experiences.length} tool(s): ${experiences.map(e => e.name).join(', ')}`);
  return server;
}
