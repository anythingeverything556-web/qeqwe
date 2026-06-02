// PUBLIC endpoint — no authentication required.
// Returns only voice names and IDs (no API key info, no voiceKeyMap).
// Also returns chatter-visible settings from Turso (persistent cloud storage).
// Used by the Chatter page so viewers can browse available voices.

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
}

function getApiKeys() {
  const keys = [];
  for (let i = 1; i <= 20; i++) {
    const key = process.env[`CAMB_API_KEY_${i}`];
    if (key && key.trim()) keys.push(key.trim());
  }
  const singleKey = process.env.CAMB_API_KEY;
  if (singleKey && singleKey.trim()) keys.push(singleKey.trim());
  return [...new Set(keys)];
}

const SETTINGS_PATH = '/tmp/tts-settings.json';
const KV_KEY = 'tts-settings';

// ── Turso/libsql connection ──
let tursoClient = null;
try {
  const { createClient } = await import('@libsql/client');
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
} catch {
  tursoClient = null;
}

// Ensure table exists
let tableEnsured = false;
async function ensureTableOnce() {
  if (tableEnsured || !tursoClient) return;
  try {
    await tursoClient.execute(
      `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    );
    tableEnsured = true;
  } catch {}
}

// In-memory settings global — shared with settings.js
if (!globalThis.ttsSettings) {
  globalThis.ttsSettings = {};
}

async function readFileSafe(path) {
  try {
    const fs = await import('fs/promises');
    return await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

// Get settings from all sources (same logic as settings.js)
async function getSettingsFromStore() {
  await ensureTableOnce();

  // Try Turso first (source of truth — survives cold starts)
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
      console.error('[public-voices] Turso read error:', e.message);
    }
  }

  // In-memory
  const mem = globalThis.ttsSettings || {};
  if (Object.keys(mem).length > 0) {
    return mem;
  }

  // /tmp file
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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Get settings from persistent storage
  const settings = await getSettingsFromStore();
  const settingsPayload = {};

  // Extract chatter-visible settings
  if (typeof settings.allowChatterVoice === 'boolean') {
    settingsPayload.allowChatterVoice = settings.allowChatterVoice;
  }
  if (settings.prefix) {
    settingsPayload.prefix = settings.prefix;
  }
  if (settings.channel) {
    settingsPayload.channel = settings.channel;
  }
  if (Array.isArray(settings.chatterVoices) && settings.chatterVoices.length > 0) {
    settingsPayload.chatterVoices = settings.chatterVoices;
  }
  // Pass hiddenSounds so chatter page can filter them out from the sound library
  if (Array.isArray(settings.hiddenSounds)) {
    settingsPayload.hiddenSounds = settings.hiddenSounds;
  }
  // Pass customPresets so chatter page can show all available voice modulator presets
  if (Array.isArray(settings.customPresets) && settings.customPresets.length > 0) {
    settingsPayload.customPresets = settings.customPresets;
  }
  // Pass customSounds metadata (no dataUrl — those are fetched on-demand via /api/sfx-data)
  if (Array.isArray(settings.customSounds) && settings.customSounds.length > 0) {
    settingsPayload.customSounds = settings.customSounds.map(cs => ({
      id: cs.id, name: cs.name, hasDataUrl: true, mimeType: cs.mimeType, size: cs.size, createdAt: cs.createdAt,
    }));
  }
  // Pass leaderboard so chatters can see the TTS leaderboard
  if (settings.leaderboard && typeof settings.leaderboard === 'object' && settings.leaderboard.chatters) {
    settingsPayload.leaderboard = settings.leaderboard;
  }

  // Step 1: Try reading from persistent voice cache file
  const VOICE_CACHE_PATH = process.env.VOICE_CACHE_PATH || '/tmp/voice-cache.json';
  const cacheData = await readFileSafe(VOICE_CACHE_PATH);
  if (cacheData) {
    try {
      const cache = JSON.parse(cacheData);
      if (cache.settings && Object.keys(settingsPayload).length === 0) {
        const cachedSettings = cache.settings;
        if (typeof cachedSettings.allowChatterVoice === 'boolean') {
          settingsPayload.allowChatterVoice = cachedSettings.allowChatterVoice;
        }
        if (cachedSettings.prefix) {
          settingsPayload.prefix = cachedSettings.prefix;
        }
        if (cachedSettings.channel) {
          settingsPayload.channel = cachedSettings.channel;
        }
        if (Array.isArray(cachedSettings.chatterVoices) && cachedSettings.chatterVoices.length > 0) {
          settingsPayload.chatterVoices = cachedSettings.chatterVoices;
        }
        if (Array.isArray(cachedSettings.hiddenSounds)) {
          settingsPayload.hiddenSounds = cachedSettings.hiddenSounds;
        }
        if (Array.isArray(cachedSettings.customPresets) && cachedSettings.customPresets.length > 0) {
          settingsPayload.customPresets = cachedSettings.customPresets;
        }
        if (Array.isArray(cachedSettings.customSounds) && cachedSettings.customSounds.length > 0) {
          settingsPayload.customSounds = cachedSettings.customSounds.map(cs => ({
            id: cs.id, name: cs.name, hasDataUrl: true, mimeType: cs.mimeType, size: cs.size, createdAt: cs.createdAt,
          }));
        }
        if (cachedSettings.leaderboard && typeof cachedSettings.leaderboard === 'object' && cachedSettings.leaderboard.chatters) {
          settingsPayload.leaderboard = cachedSettings.leaderboard;
        }
      }
      if (cache.voices && cache.voices.length > 0) {
        // Deduplicate by voice ID AND name (same key entered twice → duplicate IDs; different keys → same name, different IDs)
        const seenIds = new Set();
        const seenNames = new Set();
        const dedupedVoices = cache.voices.filter(v => {
          const nameKey = v.voice_name.toLowerCase().trim();
          if (seenIds.has(v.id) || seenNames.has(nameKey)) return false;
          seenIds.add(v.id);
          seenNames.add(nameKey);
          return true;
        });
        return res.status(200).json({
          voices: dedupedVoices,
          source: 'cache',
          updatedAt: cache.updatedAt,
          count: dedupedVoices.length,
          ...settingsPayload,
        });
      }
    } catch {}
  }

  // Step 2: Try live fetch from Camb.ai
  const keys = getApiKeys();
  if (keys.length === 0) {
    return res.status(200).json({
      voices: [],
      source: 'none',
      message: 'No voices available yet. An admin needs to log in and load voices first.',
      ...settingsPayload,
    });
  }

  const allVoices = [];
  const seenIds = new Set();
  const seenNames = new Set(); // Also dedup by name

  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch('https://client.camb.ai/apis/list-voices', {
        method: 'GET',
        headers: { 'x-api-key': keys[i] },
      });
      if (!response.ok) continue;
      const voices = await response.json();
      for (const v of voices) {
        // Dedup by ID AND name — handles duplicate keys and shared voices
        const nameKey = v.voice_name.toLowerCase().trim();
        if (!seenIds.has(v.id) && !seenNames.has(nameKey)) {
          seenIds.add(v.id);
          seenNames.add(nameKey);
          allVoices.push({ id: v.id, voice_name: v.voice_name, gender: v.gender });
        }
      }
    } catch {
      // Silently skip failed keys
    }
  }

  // Save to cache for future requests
  if (allVoices.length > 0) {
    try {
      const fs = await import('fs/promises');
      await fs.writeFile(VOICE_CACHE_PATH, JSON.stringify({
        voices: allVoices,
        updatedAt: new Date().toISOString(),
        source: 'public-live-fetch',
        settings: settingsPayload,
      }), 'utf-8');
    } catch {}
  }

  return res.status(200).json({
    voices: allVoices,
    source: 'live',
    count: allVoices.length,
    ...settingsPayload,
  });
}
