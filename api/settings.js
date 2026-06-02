// Server-side settings storage for TTS Control Room
// PRIMARY: Turso (serverless SQLite — persistent cloud storage, survives cold starts)
// FALLBACK: In-memory globalThis + /tmp file (for local dev only)
// Uses @libsql/client to connect to Turso

const SETTINGS_PATH = '/tmp/tts-settings.json';
const KV_KEY = 'tts-settings';

// In-memory settings global — shared with public-voices.js and sfx-upload.js
if (!globalThis.ttsSettings) {
  globalThis.ttsSettings = {};
}

// ── Turso/libsql connection ──
let tursoClient = null;
try {
  const { createClient } = await import('@libsql/client');
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    console.log('[settings] Turso client initialized');
  } else {
    console.warn('[settings] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set — falling back to in-memory. Connect Turso in Vercel dashboard for persistent cloud storage.');
  }
} catch (e) {
  console.warn('[settings] @libsql/client not available — falling back to in-memory storage.', e.message);
}

// Ensure the settings table exists (idempotent)
async function ensureTable() {
  if (!tursoClient) return;
  try {
    await tursoClient.execute(
      `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    );
    await tursoClient.execute(
      `CREATE TABLE IF NOT EXISTS custom_sounds (id TEXT PRIMARY KEY, name TEXT NOT NULL, data_url TEXT NOT NULL, mime_type TEXT, size INTEGER, created_at TEXT)`
    );
  } catch (e) {
    console.error('[settings] Table creation error:', e.message);
  }
}

// Run table creation once
let tableEnsured = false;
async function ensureTableOnce() {
  if (!tableEnsured) {
    await ensureTable();
    tableEnsured = true;
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function readFileSafe(path) {
  try {
    const fs = await import('fs/promises');
    return await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function writeFileSafe(path, data) {
  try {
    const fs = await import('fs/promises');
    await fs.writeFile(path, data, 'utf-8');
  } catch {
    // Non-critical — /tmp may not persist across instances
  }
}

// Get settings from all sources, with priority:
// 1. Turso SQLite (source of truth — survives cold starts)
// 2. In-memory globalThis (fastest, but lost on cold start)
// 3. /tmp file (local dev fallback)
async function getSettingsFromStore() {
  await ensureTableOnce();

  // Try Turso first — this is the source of truth
  if (tursoClient) {
    try {
      const result = await tursoClient.execute({
        sql: 'SELECT value FROM app_settings WHERE key = ?',
        args: [KV_KEY],
      });
      if (result.rows.length > 0) {
        const rawValue = result.rows[0].value;
        const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        if (parsed && typeof parsed === 'object') {
          // Cache into globalThis for fast reads in this process
          globalThis.ttsSettings = { ...parsed };
          return parsed;
        }
      }
      // No settings in Turso yet
      return {};
    } catch (e) {
      console.error('[settings] Turso read error:', e.message);
    }
  }

  // Fallback: Try in-memory (only useful for same-process warm starts)
  const mem = globalThis.ttsSettings || {};
  if (Object.keys(mem).length > 0) {
    return mem;
  }

  // Fallback: Try /tmp file (local dev or warm starts)
  const fileData = await readFileSafe(SETTINGS_PATH);
  if (fileData) {
    try {
      const parsed = JSON.parse(fileData);
      globalThis.ttsSettings = parsed;
      return parsed;
    } catch {}
  }

  return {};
}

// Get custom sounds METADATA from the dedicated table (lightweight — NO dataUrl)
// This is used for the main GET /api/settings response to keep it small.
// The full dataUrl is fetched on-demand via GET /api/sfx-data?id=xxx
// This prevents the response from exceeding Vercel's body size limit with many sounds.
async function getCustomSoundsMetaFromStore() {
  await ensureTableOnce();
  if (!tursoClient) return null;
  try {
    const result = await tursoClient.execute('SELECT id, name, mime_type, size, created_at FROM custom_sounds ORDER BY created_at DESC');
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      size: typeof row.size === 'number' ? row.size : Number(row.size),
      createdAt: row.created_at,
      // NOTE: dataUrl is NOT included here — fetch it on demand via /api/sfx-data
      hasDataUrl: true, // Signal to client that data exists on server
    }));
  } catch (e) {
    console.error('[settings] Custom sounds meta read error:', e.message);
    return null;
  }
}

// Get a single custom sound's full data (including base64 dataUrl) by ID
// Used for on-demand loading when a sound needs to play
async function getCustomSoundDataById(soundId) {
  await ensureTableOnce();
  if (!tursoClient) return null;
  try {
    const result = await tursoClient.execute({
      sql: 'SELECT id, name, data_url, mime_type, size, created_at FROM custom_sounds WHERE id = ?',
      args: [soundId],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      dataUrl: row.data_url,
      mimeType: row.mime_type,
      size: typeof row.size === 'number' ? row.size : Number(row.size),
      createdAt: row.created_at,
    };
  } catch (e) {
    console.error('[settings] Custom sound data read error:', e.message);
    return null;
  }
}

// Get a custom sound's dataUrl by name (used during TTS playback)
async function getCustomSoundDataByName(soundName) {
  await ensureTableOnce();
  if (!tursoClient) return null;
  try {
    const result = await tursoClient.execute({
      sql: 'SELECT id, name, data_url, mime_type, size, created_at FROM custom_sounds WHERE name = ?',
      args: [soundName],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      dataUrl: row.data_url,
      mimeType: row.mime_type,
      size: typeof row.size === 'number' ? row.size : Number(row.size),
      createdAt: row.created_at,
    };
  } catch (e) {
    console.error('[settings] Custom sound data by name read error:', e.message);
    return null;
  }
}

// Save settings to all available stores
async function saveSettingsToStore(settings) {
  await ensureTableOnce();

  // Update in-memory cache
  globalThis.ttsSettings = { ...settings };

  // Save to Turso (primary — survives cold starts)
  if (tursoClient) {
    try {
      // Remove customSounds from the JSON — they go in their own table
      const settingsCopy = { ...settings };
      delete settingsCopy.customSounds; // Don't store large audio data in the settings blob

      await tursoClient.execute({
        sql: 'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
        args: [KV_KEY, JSON.stringify(settingsCopy)],
      });
    } catch (e) {
      console.error('[settings] Turso write error:', e.message);
    }
  }

  // Also save to /tmp file as backup (local dev)
  await writeFileSafe(SETTINGS_PATH, JSON.stringify(settings));
}

// Simple HMAC-based session verification (matches server/lib/auth.ts)
async function verifySession(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  if (!match) return null;

  const token = match[1];
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || (() => { console.warn('[WARN] No JWT_SECRET or ADMIN_PASSWORD set — using insecure default. Set JWT_SECRET in production!'); return 'fallback-secret-change-me'; })();
    const payload = atob(payloadB64);

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expectedSignature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (signature.length !== expectedSignature.length) return null;
    let valid = true;
    for (let i = 0; i < signature.length; i++) {
      if (signature[i] !== expectedSignature[i]) valid = false;
    }
    if (!valid) return null;

    const data = JSON.parse(payload);
    if (!data.username || !data.expiresAt) return null;
    if (Date.now() > data.expiresAt) return null;

    return data.username;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // GET — return current settings (for admin page load and public-voices)
  // Custom sounds are returned as METADATA only (no base64 dataUrl) to keep
  // the response small. The full audio data is fetched on-demand via /api/sfx-data
  if (req.method === 'GET') {
    try {
      const settings = await getSettingsFromStore();
      // Fetch custom sound METADATA (lightweight — no dataUrl)
      const customSounds = await getCustomSoundsMetaFromStore();
      if (customSounds && customSounds.length > 0) {
        settings.customSounds = customSounds;
      }
      return res.status(200).json(settings);
    } catch (e) {
      console.error('[settings] GET error:', e.message);
      return res.status(200).json({});
    }
  }

  // PUT — auth required: update settings (supports full or partial updates)
  if (req.method === 'PUT') {
    const username = await verifySession(req);
    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const body = req.body || {};
    
    // Load current settings
    const current = await getSettingsFromStore();
    
    // CRITICAL: Custom sounds are NEVER synced via PUT /api/settings.
    // They are managed exclusively through:
    //   - POST /api/sfx-upload (add a sound individually)
    //   - DELETE /api/settings (remove a sound by ID)
    //   - GET /api/settings (read all sounds)
    // Previously, sending all customSounds in the PUT body caused:
    //   1. Vercel's 4.5MB body limit truncates the request → only partial sounds survive
    //   2. DELETE FROM custom_sounds + partial INSERT = data loss
    //   3. Client sees 30 sounds → server only saves 3 after truncation
    if (body.customSounds) {
      delete body.customSounds;
    }
    
    // Merge new settings into current (partial update support)
    const updated = { ...current, ...body };
    
    // Save to all stores
    await saveSettingsToStore(updated);

    return res.status(200).json({ success: true, settings: updated });
  }

  // DELETE — auth required: delete a specific custom sound by ID
  if (req.method === 'DELETE') {
    const username = await verifySession(req);
    if (!username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { soundId } = req.body || req.query || {};
    if (!soundId) {
      return res.status(400).json({ error: 'soundId is required' });
    }

    if (tursoClient) {
      try {
        await tursoClient.execute({
          sql: 'DELETE FROM custom_sounds WHERE id = ?',
          args: [soundId],
        });
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: `Delete failed: ${e.message}` });
      }
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'GET, PUT, or DELETE only' });
}
