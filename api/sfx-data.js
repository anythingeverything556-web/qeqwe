// SFX Data endpoint — returns a single custom sound's full dataUrl (base64 audio)
// This is called on-demand when a sound needs to play, keeping the main
// GET /api/settings response lightweight (metadata only, no base64 data).
//
// Usage:
//   GET /api/sfx-data?id=xxx     — fetch by sound ID
//   GET /api/sfx-data?name=xxx   — fetch by sound name
//
// Returns: { id, name, dataUrl, mimeType, size, createdAt }
// Or 404 if not found.

const SETTINGS_PATH = '/tmp/tts-settings.json';

// ── Turso/libsql connection ──
let tursoClient = null;
try {
  const { createClient } = await import('@libsql/client');
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    console.log('[sfx-data] Turso client initialized');
  } else {
    console.warn('[sfx-data] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set');
  }
} catch (e) {
  console.warn('[sfx-data] @libsql/client not available:', e.message);
  tursoClient = null;
}

// Ensure tables exist
let tableEnsured = false;
async function ensureTableOnce() {
  if (tableEnsured || !tursoClient) return;
  try {
    await tursoClient.execute(
      `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    );
    await tursoClient.execute(
      `CREATE TABLE IF NOT EXISTS custom_sounds (id TEXT PRIMARY KEY, name TEXT NOT NULL, data_url TEXT NOT NULL, mime_type TEXT, size INTEGER, created_at TEXT)`
    );
    tableEnsured = true;
  } catch (e) {
    console.error('[sfx-data] Table creation error:', e.message);
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { id, name } = req.query || {};

  if (!id && !name) {
    return res.status(400).json({ error: 'Provide ?id=xxx or ?name=xxx' });
  }

  await ensureTableOnce();
  if (!tursoClient) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    let result;
    if (id) {
      result = await tursoClient.execute({
        sql: 'SELECT id, name, data_url, mime_type, size, created_at FROM custom_sounds WHERE id = ?',
        args: [id],
      });
    } else {
      result = await tursoClient.execute({
        sql: 'SELECT id, name, data_url, mime_type, size, created_at FROM custom_sounds WHERE name = ?',
        args: [name],
      });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sound not found' });
    }

    const row = result.rows[0];
    return res.status(200).json({
      id: row.id,
      name: row.name,
      dataUrl: row.data_url,
      mimeType: row.mime_type,
      size: typeof row.size === 'number' ? row.size : Number(row.size),
      createdAt: row.created_at,
    });
  } catch (e) {
    console.error('[sfx-data] Error:', e.message);
    return res.status(500).json({ error: `Fetch failed: ${e.message}` });
  }
}
