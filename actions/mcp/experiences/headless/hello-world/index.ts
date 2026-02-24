import type { ActionHandlerResult } from '../../../types';

async function handler(args: { name?: string }): Promise<ActionHandlerResult> {
  const greeting = args.name || 'World';
  const now = new Date();

  return {
    content: [{
      type: 'text' as const,
      text: `Hello, ${greeting}! Server time: ${now.toISOString()}`
    }]
  };
}

export { handler };
