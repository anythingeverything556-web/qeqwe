const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env file (Next.js does this automatically, plain Node doesn't)
try { require('dotenv').config(); } catch {}

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const VOICE_CACHE_PATH = process.env.VOICE_CACHE_PATH || path.join(__dirname, 'data', 'voice-cache.json');
const SETTINGS_PATH = process.env.SETTINGS_PATH || path.join(__dirname, 'data', 'settings.json');
const SESSION_DURATION = 10 * 365.25 * 24 * 60 * 60 * 1000; // 10 years (no auto-logout)

// In-memory settings cache
let ttsSettings = {};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      ttsSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch {}
}

function saveSettings() {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(ttsSettings), 'utf-8');
  } catch {}
}

// Load settings on startup
loadSettings();

// ═══════════════════════════════════════════════════════════
// ENV CONFIG
// ═══════════════════════════════════════════════════════════
function getOwnerAccounts() {
  const accounts = [];
  const o1u = (process.env.OWNER1_USERNAME || '').trim();
  const o1p = (process.env.OWNER1_PASSWORD || '').trim();
  if (o1u && o1p) accounts.push({ username: o1u, password: o1p });
  const o2u = (process.env.OWNER2_USERNAME || '').trim();
  const o2p = (process.env.OWNER2_PASSWORD || '').trim();
  if (o2u && o2p) accounts.push({ username: o2u, password: o2p });
  const au = (process.env.ADMIN_USERNAME || '').trim();
  const ap = (process.env.ADMIN_PASSWORD || '').trim();
  if (au && ap && !accounts.some(a => a.username === au)) accounts.push({ username: au, password: ap });
  return accounts;
}

function getApiKeys() {
  const keys = [];
  for (let i = 1; i <= 20; i++) {
    const k = (process.env[`CAMB_API_KEY_${i}`] || '').trim();
    if (k && !k.startsWith('your-')) keys.push(k);
  }
  const single = (process.env.CAMB_API_KEY || '').trim();
  if (single && !single.startsWith('your-')) keys.push(single);
  return [...new Set(keys)];
}

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || (() => { console.warn('[WARN] No JWT_SECRET or ADMIN_PASSWORD set — using insecure default. Set JWT_SECRET in production!'); return 'fallback-secret-change-me'; })();

function getJwtSecret() {
  return JWT_SECRET;
}

// ═══════════════════════════════════════════════════════════
// AUTH UTILITIES
// ═══════════════════════════════════════════════════════════
async function hashToken(payload, secret) {
  return new Promise((resolve, reject) => {
    const key = crypto.createHmac('sha256', secret);
    resolve(key.update(payload).digest('hex'));
  });
}

async function createSessionToken(username) {
  const secret = getJwtSecret();
  const expiresAt = Date.now() + SESSION_DURATION;
  const payload = JSON.stringify({ username, expiresAt });
  const signature = await hashToken(payload, secret);
  return Buffer.from(payload).toString('base64') + '.' + signature;
}

async function verifySession(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    cookies[k] = decodeURIComponent(v.join('='));
  });
  const token = cookies['admin_session'];
  if (!token) return null;

  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    const secret = getJwtSecret();
    const payload = Buffer.from(payloadB64, 'base64').toString();
    const expectedSig = await hashToken(payload, secret);

    if (signature.length !== expectedSig.length) return null;
    let valid = true;
    for (let i = 0; i < signature.length; i++) {
      if (signature[i] !== expectedSig[i]) valid = false;
    }
    if (!valid) return null;

    const data = JSON.parse(payload);
    if (!data.username || !data.expiresAt) return null;
    if (Date.now() > data.expiresAt) return null;
    return data.username;
  } catch { return null; }
}

function constantTimeCompare(a, b) {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return result === 0;
}

// ═══════════════════════════════════════════════════════════
// MIME TYPES
// ═══════════════════════════════════════════════════════════
const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

const ALLOWED_HOSTS = ['www.myinstants.com', 'myinstants.com', 'assets.mixkit.co', 'cdn.myinstants.com'];
function isAllowedHost(urlStr) {
  try { const u = new URL(urlStr); return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h)); }
  catch { return false; }
}

// ═══════════════════════════════════════════════════════════
// PARSE REQUEST BODY
// ═══════════════════════════════════════════════════════════
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════
// API ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════

// POST /api/auth/login — Login
async function handleAuthLogin(req, res) {
  try {
    const { username, password } = await parseBody(req);
    if (!username || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Username and password are required' }));
    }
    const accounts = getOwnerAccounts();
    if (accounts.length === 0) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No owner credentials configured on server.' }));
    }
    let matched = false;
    for (const acct of accounts) {
      if (constantTimeCompare(username, acct.username) && constantTimeCompare(password, acct.password)) {
        matched = true; break;
      }
    }
    if (!matched) {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid username or password' }));
    }
    const token = await createSessionToken(username);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    });
    res.end(JSON.stringify({ success: true, username, expiresAt: Date.now() + SESSION_DURATION }));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request body' }));
  }
}

// GET /api/auth/login — Verify session
async function handleAuthVerify(req, res) {
  const username = await verifySession(req.headers.cookie);
  if (username) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: true, username }));
  } else {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: false }));
  }
}

// DELETE /api/auth/login — Logout
async function handleAuthLogout(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
  });
  res.end(JSON.stringify({ success: true }));
}

// GET /api/camb-voices — Admin voices (requires auth, saves cache)
async function handleCambVoices(req, res) {
  const username = await verifySession(req.headers.cookie);
  if (!username) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Authentication required' }));
  }
  const keys = getApiKeys();
  if (keys.length === 0) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No Camb.ai API keys configured.' }));
  }
  const allVoices = [];
  const seenIds = new Set();
  const seenNames = new Set(); // Also dedup by name (same voice from different keys)
  const errors = [];
  const voiceKeyMap = [];
  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch('https://client.camb.ai/apis/list-voices', {
        method: 'GET', headers: { 'x-api-key': keys[i] },
      });
      if (!response.ok) { errors.push(`Key ${i + 1}: ${response.status}`); continue; }
      const voices = await response.json();
      for (const v of voices) {
        const vid = Number(v.id);
        const nameKey = v.voice_name.toLowerCase().trim();
        // Skip if already seen by ID or name
        if (seenIds.has(vid) || seenNames.has(nameKey)) continue;
        seenIds.add(vid);
        seenNames.add(nameKey);
        allVoices.push({ ...v, id: vid, apiKeyOwner: i });
        voiceKeyMap.push({ voiceId: vid, keyIndex: i });
      }
    } catch (e) { errors.push(`Key ${i + 1}: ${e.message}`); }
  }
  // Save public-safe voice cache
  if (allVoices.length > 0) {
    try {
      const dir = path.dirname(VOICE_CACHE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const publicVoices = allVoices.map(v => ({ id: v.id, voice_name: v.voice_name, gender: v.gender }));
      fs.writeFileSync(VOICE_CACHE_PATH, JSON.stringify({ voices: publicVoices, updatedAt: new Date().toISOString(), source: 'admin-refresh' }), 'utf-8');
    } catch {}
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ voices: allVoices, keyCount: keys.length, errors: errors.length > 0 ? errors : undefined, voiceKeyMap }));
}

// GET /api/settings — Get current settings (public)
async function handleGetSettings(req, res) {
  loadSettings(); // Refresh from file
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(ttsSettings));
}

// PUT /api/settings — Update settings (requires auth, full merge)
async function handlePutSettings(req, res) {
  const username = await verifySession(req.headers.cookie);
  if (!username) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Authentication required' }));
  }
  try {
    const body = await parseBody(req);
    // Full merge: update all provided fields
    ttsSettings = { ...ttsSettings, ...body };
    saveSettings();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, settings: ttsSettings }));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request body' }));
  }
}

// POST /api/sfx-upload — Upload custom sound (requires auth)
async function handleSfxUpload(req, res) {
  const username = await verifySession(req.headers.cookie);
  if (!username) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Authentication required' }));
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Multipart form data required' }));
  }

  try {
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No boundary in multipart data' }));
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

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

    const filePart = parts.find(p => p.filename && p.data.length > 0);
    if (!filePart) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No audio file provided' }));
    }

    if (filePart.size > 1024 * 1024) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File too large. Max 1MB.' }));
    }

    const ext = filePart.filename.split('.').pop().toLowerCase();
    if (!['mp3', 'wav', 'ogg', 'webm'].includes(ext)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid file type. Use mp3, wav, ogg, or webm.' }));
    }

    const mimeType = filePart.contentType || 'audio/mpeg';
    const base64 = filePart.data.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;
    const soundName = filePart.filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
    const namePart = parts.find(p => p.name === 'name' && !p.filename);
    const customName = namePart ? namePart.data.toString('utf-8').trim() : soundName;

    loadSettings();
    if (!Array.isArray(ttsSettings.customSounds)) ttsSettings.customSounds = [];

    const newSound = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: customName || soundName,
      dataUrl,
      mimeType,
      size: filePart.size,
      createdAt: new Date().toISOString(),
    };

    const existingIdx = ttsSettings.customSounds.findIndex(s => s.name.toLowerCase() === newSound.name.toLowerCase());
    if (existingIdx >= 0) ttsSettings.customSounds[existingIdx] = newSound;
    else ttsSettings.customSounds.push(newSound);

    saveSettings();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, sound: { id: newSound.id, name: newSound.name, size: newSound.size }, totalCustomSounds: ttsSettings.customSounds.length }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Upload failed: ${e.message}` }));
  }
}

// GET /api/public-voices — Public voices (no auth, reads cache first)
// Also returns chatter-visible settings from persistent storage
async function handlePublicVoices(req, res) {
  loadSettings(); // Refresh settings from file
  const settingsPayload = {};
  if (typeof ttsSettings.allowChatterVoice === 'boolean') settingsPayload.allowChatterVoice = ttsSettings.allowChatterVoice;
  if (ttsSettings.prefix) settingsPayload.prefix = ttsSettings.prefix;
  if (ttsSettings.channel) settingsPayload.channel = ttsSettings.channel;
  if (Array.isArray(ttsSettings.chatterVoices) && ttsSettings.chatterVoices.length > 0) settingsPayload.chatterVoices = ttsSettings.chatterVoices;

  // Step 1: Try cache
  try {
    if (fs.existsSync(VOICE_CACHE_PATH)) {
      const cache = JSON.parse(fs.readFileSync(VOICE_CACHE_PATH, 'utf-8'));
      if (cache.voices && cache.voices.length > 0) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ voices: cache.voices, source: 'cache', updatedAt: cache.updatedAt, count: cache.voices.length, ...settingsPayload }));
      }
    }
  } catch {}

  // Step 2: Try live fetch
  const keys = getApiKeys();
  if (keys.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ voices: [], source: 'none', message: 'No voices available yet.', ...settingsPayload }));
  }
  const allVoices = [];
  const seen = new Set();
  const seenNames = new Set();
  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch('https://client.camb.ai/apis/list-voices', {
        method: 'GET', headers: { 'x-api-key': keys[i] },
      });
      if (!response.ok) continue;
      const voices = await response.json();
      for (const v of voices) {
        const nameKey = v.voice_name.toLowerCase().trim();
        if (!seen.has(v.id) && !seenNames.has(nameKey)) {
          seen.add(v.id);
          seenNames.add(nameKey);
          allVoices.push({ id: v.id, voice_name: v.voice_name, gender: v.gender });
        }
      }
    } catch {}
  }
  if (allVoices.length > 0) {
    try {
      const dir = path.dirname(VOICE_CACHE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(VOICE_CACHE_PATH, JSON.stringify({ voices: allVoices, updatedAt: new Date().toISOString(), source: 'public-live' }), 'utf-8');
    } catch {}
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ voices: allVoices, source: 'live', count: allVoices.length, ...settingsPayload }));
}

// POST /api/camb-tts — TTS proxy (requires auth)
// Uses /tts-stream endpoint — returns audio directly (no polling needed).
// Model: MARS 8.1 (Beta) + Enhance Reference Audio Quality
async function handleCambTTS(req, res) {
  const username = await verifySession(req.headers.cookie);
  if (!username) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Authentication required' }));
  }
  const keys = getApiKeys();
  if (keys.length === 0) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No Camb.ai API keys configured.' }));
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid request body' }));
  }

  const { text, voiceId, gender, age, keyIndex } = body || {};
  if (!text || !voiceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing required fields: text, voiceId' }));
  }

  const MAX_TEXT_LENGTH = 2000;
  if (text && text.length > MAX_TEXT_LENGTH) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Text too long (max ${MAX_TEXT_LENGTH} chars)` }));
  }

  // Determine which key to use: prefer the keyIndex from the voice list mapping
  const keysToTry = [];
  if (typeof keyIndex === 'number' && keyIndex >= 0 && keyIndex < keys.length) {
    keysToTry.push(keys[keyIndex]);
  }
  // Add remaining keys as fallbacks
  for (const key of keys) {
    if (!keysToTry.includes(key)) keysToTry.push(key);
  }

  let lastError = null;

  for (const apiKey of keysToTry) {
    try {
      // Using /tts-stream — returns audio directly, no task creation or polling needed.
      // Much faster than the deprecated /tts async flow.
      const payload = {
        text,
        voice_id: Number(voiceId),
        language: 'en-us', // BCP-47 locale (new API format, replaces numeric language code)
        speech_model: 'mars-8.1-beta', // MARS 8.1 (Beta) — high quality voice cloning
        voice_settings: {
          enhance_reference_audio_quality: true, // Higher quality voice cloning output
          speaking_rate: 1.0,
        },
        output_configuration: {
          format: 'mp3',
        },
      };

      const audioRes = await fetch('https://client.camb.ai/apis/tts-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(payload),
      });

      if (!audioRes.ok) {
        // Try to extract error detail
        let errDetail = '';
        try {
          const errData = await audioRes.json();
          errDetail = errData.detail || errData.error || JSON.stringify(errData);
        } catch {
          errDetail = await audioRes.text().catch(() => '');
        }
        // If 401/403, try next key
        if (audioRes.status === 401 || audioRes.status === 403) {
          lastError = `Key ${apiKey.slice(0, 5)}...: ${audioRes.status} - ${errDetail}`;
          continue;
        }
        res.writeHead(audioRes.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Camb.ai TTS failed: ${audioRes.status} - ${errDetail}` }));
      }

      // Stream audio back directly
      const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(buffer.length) });
      return res.end(buffer);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'All API keys failed', detail: lastError }));
}

// GET /api/sound-proxy — CORS proxy for sounds
async function handleSoundProxy(req, res) {
  const urlStr = new URL(req.url, 'http://localhost').searchParams.get('url');
  if (!urlStr) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Missing url'); }
  if (!isAllowedHost(urlStr)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Host not allowed'); }
  try {
    const remoteRes = await fetch(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!remoteRes.ok) { res.writeHead(remoteRes.status); return res.end(`Upstream: ${remoteRes.statusText}`); }
    const ct = remoteRes.headers.get('content-type') || 'audio/mpeg';
    const buf = Buffer.from(await remoteRes.arrayBuffer());
    res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400', 'Content-Length': buf.length });
    res.end(buf);
  } catch (e) { res.writeHead(502); res.end(`Proxy error: ${e.message}`); }
}

// GET /api/sound-resolve — MyInstants scraper
async function handleSoundResolve(req, res) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const pageUrl = params.get('url');
  const slug = params.get('slug');
  const query = params.get('q');
  let targetUrl = pageUrl;
  if (!targetUrl && slug) targetUrl = `https://www.myinstants.com/en/instant/${slug}/`;
  if (!targetUrl && query) targetUrl = `https://www.myinstants.com/en/search/?query=${encodeURIComponent(query)}`;
  if (!targetUrl) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Missing url, slug, or q' })); }
  try {
    const remoteRes = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (!remoteRes.ok) { res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `Upstream ${remoteRes.status}` })); }
    const html = await remoteRes.text();
    let audioUrl = null;
    const m1 = html.match(/preloadAudioUrl\s*=\s*['"]([^'"]+)['"]/); if (m1) audioUrl = m1[1];
    if (!audioUrl) { const m2 = html.match(/data-url\s*=\s*['"]([^'"]+)['"]/); if (m2) audioUrl = m2[1]; }
    if (!audioUrl) { const m3 = html.match(/playSound\(['"]([^'"]+)['"]\)/); if (m3) audioUrl = m3[1]; }
    if (!audioUrl) { const m4 = html.match(/<source[^>]+src\s*=\s*['"]([^'"]+)['"]/); if (m4) audioUrl = m4[1]; }
    if (!audioUrl && query) {
      const m5 = html.match(/href="\/en\/instant\/([^\/]+)\/"/);
      if (m5) {
        const slugRes = await fetch(`https://www.myinstants.com/en/instant/${m5[1]}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
        const slugHtml = await slugRes.text();
        const m6 = slugHtml.match(/preloadAudioUrl\s*=\s*['"]([^'"]+)['"]/); if (m6) audioUrl = m6[1];
        if (!audioUrl) { const m7 = slugHtml.match(/data-url\s*=\s*['"]([^'"]+)['"]/); if (m7) audioUrl = m7[1]; }
      }
    }
    if (audioUrl && !audioUrl.startsWith('http')) audioUrl = `https://www.myinstants.com${audioUrl}`;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(audioUrl ? { audioUrl } : { error: 'No audio URL found' }));
  } catch (e) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
}

// ═══════════════════════════════════════════════════════════
// MAIN SERVER
// ═══════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }

  // API routes
  if (urlPath === '/api/auth/login' && method === 'POST') return await handleAuthLogin(req, res);
  if (urlPath === '/api/auth/login' && method === 'GET') return await handleAuthVerify(req, res);
  if (urlPath === '/api/auth/login' && method === 'DELETE') return await handleAuthLogout(req, res);
  if (urlPath === '/api/settings' && method === 'GET') return await handleGetSettings(req, res);
  if (urlPath === '/api/settings' && method === 'PUT') return await handlePutSettings(req, res);
  if (urlPath === '/api/camb-voices' && method === 'GET') return await handleCambVoices(req, res);
  if (urlPath === '/api/public-voices' && method === 'GET') return await handlePublicVoices(req, res);
  if (urlPath === '/api/camb-tts' && method === 'POST') return await handleCambTTS(req, res);
  if (urlPath === '/api/sfx-upload' && method === 'POST') return await handleSfxUpload(req, res);
  if (urlPath === '/api/sound-proxy' && method === 'GET') return await handleSoundProxy(req, res);
  if (urlPath === '/api/sound-resolve' && method === 'GET') return await handleSoundResolve(req, res);

  // Static files — serve tts-app.html for the root
  let filePath;
  if (urlPath === '/') {
    filePath = path.join(PUBLIC_DIR, 'tts-app.html');
  } else {
    filePath = path.join(PUBLIC_DIR, urlPath);
  }

  // Path traversal prevention — ensure resolved path stays within PUBLIC_DIR
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // If file not found, serve the TTS app (SPA fallback)
      if (urlPath !== '/') {
        fs.readFile(path.join(PUBLIC_DIR, 'tts-app.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); return res.end('Not Found'); }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(d2);
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CHATGBT TTS Control Room server running at http://localhost:${PORT}/`);
  console.log(`Voice cache: ${VOICE_CACHE_PATH}`);
  console.log(`Owner accounts: ${getOwnerAccounts().length}`);
  console.log(`API keys: ${getApiKeys().length}`);
});
