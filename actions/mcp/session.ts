/**
 * Session manager using @adobe/aio-lib-state.
 *
 * Each MCP session is stored as a key-value pair:
 *   key   = Mcp-Session-Id (UUID)
 *   value = JSON-serialised session metadata (capabilities, serverInfo, createdAt)
 *
 * TTL is refreshed (slid forward) on every request so an active session
 * stays alive indefinitely while an idle one expires after SESSION_TTL seconds.
 */

const stateLib = require('@adobe/aio-lib-state');

/** 30 minutes in seconds */
const SESSION_TTL = 30 * 60;

export interface SessionData {
  capabilities: Record<string, any>;
  createdAt: string;
}

let stateInstance: any = null;

async function getState(): Promise<any> {
  if (!stateInstance) {
    stateInstance = await stateLib.init();
  }
  return stateInstance;
}

/**
 * Create a new session. Stores metadata with a 30-min TTL.
 */
export async function createSession(sessionId: string, data: SessionData): Promise<void> {
  const state = await getState();
  await state.put(sessionId, JSON.stringify(data), { ttl: SESSION_TTL });
}

/**
 * Load an existing session and slide the TTL forward (+30 min from now).
 * Returns null if the session has expired or does not exist.
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
  const state = await getState();
  const res = await state.get(sessionId);
  if (!res || !res.value) {
    return null;
  }
  // Slide TTL
  await state.put(sessionId, res.value, { ttl: SESSION_TTL });
  return JSON.parse(res.value) as SessionData;
}

/**
 * Explicitly delete a session (e.g. on DELETE /mcp).
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const state = await getState();
  await state.delete(sessionId);
}
