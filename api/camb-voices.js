// Proxies Camb.ai list-voices API using server-stored API keys
// Environment variables: CAMB_API_KEY_1, CAMB_API_KEY_2, ... CAMB_API_KEY_N
// Also supports single CAMB_API_KEY env var
// DEDUPLICATES voices by ID AND name to prevent doubles from duplicate keys

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const keys = getApiKeys();
  if (keys.length === 0) {
    return res.status(500).json({
      error: 'No Camb.ai API keys configured on server. Set CAMB_API_KEY_1, CAMB_API_KEY_2, etc. as Vercel environment variables.',
    });
  }

  const allVoices = [];
  const seenIds = new Set();
  const seenNames = new Set(); // Also dedup by name (same voice, different key, different ID)
  const errors = [];
  const voiceKeyMap = []; // { voiceId, keyIndex }

  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch('https://client.camb.ai/apis/list-voices', {
        method: 'GET',
        headers: { 'x-api-key': keys[i] },
      });
      if (!response.ok) {
        errors.push(`Key ${i + 1}: ${response.status} ${response.statusText}`);
        continue;
      }
      const voices = await response.json();
      for (const v of voices) {
        const vid = Number(v.id);
        const nameKey = v.voice_name.toLowerCase().trim();
        
        // Skip if we've already seen this voice ID OR this voice name
        // This handles: same key entered twice (same IDs) AND different keys with same voices (different IDs, same name)
        if (seenIds.has(vid) || seenNames.has(nameKey)) continue;
        
        seenIds.add(vid);
        seenNames.add(nameKey);
        allVoices.push({ ...v, id: vid, apiKeyOwner: i });
        voiceKeyMap.push({ voiceId: vid, keyIndex: i });
      }
    } catch (e) {
      errors.push(`Key ${i + 1}: ${e.message}`);
    }
  }

  res.status(200).json({
    voices: allVoices,
    keyCount: keys.length,
    errors: errors.length > 0 ? errors : undefined,
    voiceKeyMap,
  });
}
