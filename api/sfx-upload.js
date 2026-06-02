// SFX Upload endpoint — accepts audio files and stores them in Turso
// Custom sounds are stored in a dedicated `custom_sounds` table (not in the settings JSON blob)
// This keeps the settings JSON small and fast, while audio data lives in its own table.
// Requires admin auth. Supports mp3, wav, ogg, webm formats.
// Max file size: 2MB per sound.

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/x-wav'];
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.webm'];
const KV_KEY = 'tts-settings';
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
    console.log('[sfx-upload] Turso client initialized');
  } else {
    console.warn('[sfx-upload] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set');
  }
} catch (e) {
  console.warn('[sfx-upload] @libsql/client not available:', e.message);
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
    console.log('[sfx-upload] Tables ensured');
  } catch (e) {
    console.error('[sfx-upload] Table creation error:', e.message);
  }
}

if (!globalThis.ttsSettings) {
  globalThis.ttsSettings = {};
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
  } catch {}
}

async function getSettingsFromStore() {
  await ensureTableOnce();
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
          globalThis.ttsSettings = { ...parsed };
          return parsed;
        }
      }
    } catch (e) {
      console.error('[sfx-upload] Turso read error:', e.message);
    }
  }
  const mem = globalThis.ttsSettings || {};
  if (Object.keys(mem).length > 0) return mem;
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

async function saveSettingsToStore(settings) {
  await ensureTableOnce();
  globalThis.ttsSettings = { ...settings };
  if (tursoClient) {
    try {
      // BUG FIX: Remove customSounds before saving to settings JSON blob.
      // Custom sounds belong in the dedicated custom_sounds table only.
      // Storing large base64 audio data in the JSON blob makes it huge and slow.
      const settingsCopy = { ...settings };
      delete settingsCopy.customSounds;
      await tursoClient.execute({
        sql: 'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
        args: [KV_KEY, JSON.stringify(settingsCopy)],
      });
    } catch (e) {
      console.error('[sfx-upload] Turso write error:', e.message);
    }
  }
  await writeFileSafe(SETTINGS_PATH, JSON.stringify(settings));
}

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
  } catch { return null; }
}

// Parse multipart form data — handles both raw stream and pre-buffered body
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return reject(new Error('Not multipart/form-data'));
    }
    
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return reject(new Error('No boundary found'));
    
    // Check if body is already buffered (Vercel sometimes does this)
    if (req.body && Buffer.isBuffer(req.body)) {
      resolve(parseBuffer(req.body, boundary));
      return;
    }
    
    // Also handle case where Vercel parsed the body as a string
    if (typeof req.body === 'string') {
      resolve(parseBuffer(Buffer.from(req.body, 'binary'), boundary));
      return;
    }
    
    // Stream mode — read chunks from request
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(parseBuffer(buffer, boundary));
    });
    req.on('error', reject);
  });
}

function parseBuffer(buffer, boundary) {
  const boundaryStr = `--${boundary}`;
  const parts = [];
  let start = buffer.indexOf(boundaryStr) + boundaryStr.length;
  
  while (start < buffer.length) {
    const nextBoundary = buffer.indexOf(boundaryStr, start);
    if (nextBoundary === -1) break;
    
    const partBuffer = buffer.slice(start, nextBoundary);
    const headerEnd = partBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = nextBoundary + boundaryStr.length; continue; }
    
    const headers = partBuffer.slice(0, headerEnd).toString('utf-8');
    const body = partBuffer.slice(headerEnd + 4, partBuffer.length - 2);
    
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
      data: body,
      size: body.length,
    });
    
    start = nextBoundary + boundaryStr.length;
  }
  
  return parts;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Verify admin auth
  const username = await verifySession(req);
  if (!username) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    console.log('[sfx-upload] Starting upload, content-type:', req.headers['content-type']);
    
    const parts = await parseMultipart(req);
    console.log('[sfx-upload] Parsed parts:', parts.map(p => ({ name: p.name, filename: p.filename, size: p.size, contentType: p.contentType })));
    
    const filePart = parts.find(p => p.filename && p.data.length > 0);
    
    if (!filePart) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Validate file type
    const ext = '.' + filePart.filename.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext) && !ALLOWED_TYPES.includes(filePart.contentType)) {
      return res.status(400).json({ 
        error: `Invalid file type "${filePart.contentType || ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
    }

    // Validate file size
    if (filePart.size > MAX_FILE_SIZE) {
      return res.status(400).json({ 
        error: `File too large (${(filePart.size / 1024 / 1024).toFixed(1)}MB). Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
    }

    // Convert to base64 data URL
    const mimeType = filePart.contentType || 'audio/mpeg';
    const base64 = filePart.data.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Generate a name from filename (remove extension)
    const soundName = filePart.filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');

    // Get sound name from form data (if provided)
    const namePart = parts.find(p => p.name === 'name' && !p.filename);
    const customName = namePart ? namePart.data.toString('utf-8').trim() : soundName;

    const newSound = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: customName || soundName,
      dataUrl,
      mimeType,
      size: filePart.size,
      createdAt: new Date().toISOString(),
    };

    console.log(`[sfx-upload] Saving sound: "${newSound.name}" (${newSound.size} bytes, id=${newSound.id})`);

    // Store in Turso custom_sounds table (dedicated table, not in settings JSON)
    await ensureTableOnce();
    if (tursoClient) {
      try {
        // Delete existing sound with same name (upsert by name)
        await tursoClient.execute({
          sql: 'DELETE FROM custom_sounds WHERE name = ?',
          args: [newSound.name],
        });
        await tursoClient.execute({
          sql: 'INSERT INTO custom_sounds (id, name, data_url, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [newSound.id, newSound.name, newSound.dataUrl, newSound.mimeType, newSound.size, newSound.createdAt],
        });
        console.log(`[sfx-upload] Saved to Turso successfully`);
      } catch (e) {
        console.error('[sfx-upload] Turso write error, falling back to settings JSON:', e.message);
        // Fallback: store in settings JSON
        const settings = await getSettingsFromStore();
        if (!Array.isArray(settings.customSounds)) settings.customSounds = [];
        const existingIdx = settings.customSounds.findIndex(s => s.name.toLowerCase() === newSound.name.toLowerCase());
        if (existingIdx >= 0) {
          settings.customSounds[existingIdx] = newSound;
        } else {
          settings.customSounds.push(newSound);
        }
        await saveSettingsToStore(settings);
      }
    } else {
      // Fallback: store in settings JSON (no Turso available)
      console.log('[sfx-upload] No Turso, saving to settings JSON');
      const settings = await getSettingsFromStore();
      if (!Array.isArray(settings.customSounds)) settings.customSounds = [];
      const existingIdx = settings.customSounds.findIndex(s => s.name.toLowerCase() === newSound.name.toLowerCase());
      if (existingIdx >= 0) {
        settings.customSounds[existingIdx] = newSound;
      } else {
        settings.customSounds.push(newSound);
      }
      await saveSettingsToStore(settings);
    }

    return res.status(200).json({ 
      success: true, 
      sound: { id: newSound.id, name: newSound.name, size: newSound.size },
    });
  } catch (e) {
    console.error('[sfx-upload] Error:', e);
    return res.status(500).json({ error: `Upload failed: ${e.message}` });
  }
}
