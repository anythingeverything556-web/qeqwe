// Proxies Camb.ai TTS API using server-stored API keys
// Strategy: Try multiple model + payload combinations until one works.
// Valid models: mars-8.1-flash-beta, mars-8.1-pro-beta, mars-flash, mars-pro, mars-instruct
// NOTE: 'mars-8.1-beta' NO LONGER EXISTS — causes 422 errors!
// IMPORTANT: mars-8.1-pro-beta and mars-8.1-flash-beta have a DIFFERENT payload schema:
//   They do NOT support: enhance_named_entities_pronunciation,
//   acoustic_quality_boost, temperature, speaker_similarity, stability,
//   output_enhancement, localize_speaker_weight
//   Sending unsupported top-level params with 8.1 models causes 500 Internal Server Errors!
//   voice_settings params (enhance_reference_audio_quality, speaking_rate, maintain_source_accent) ARE supported.
// Environment variables: CAMB_API_KEY_1, CAMB_API_KEY_2, etc.

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

// Extract error detail from a failed HTTP response
async function extractError(response) {
  let errDetail = '';
  try {
    const errData = await response.json();
    if (Array.isArray(errData.detail)) {
      errDetail = errData.detail.map(e => e.msg || JSON.stringify(e)).join('; ');
    } else {
      errDetail = errData.detail || errData.error || errData.message || JSON.stringify(errData);
    }
  } catch {
    errDetail = await response.text().catch(() => `(status ${response.status})`);
  }
  return errDetail;
}

// Build a Camb.ai TTS payload.
// 8.1 models (mars-8.1-pro-beta, mars-8.1-flash-beta) support a SUBSET of params:
//   ✅ text, voice_id, language, speech_model, output_configuration
//   ✅ voice_settings.enhance_reference_audio_quality, voice_settings.speaking_rate,
//      voice_settings.maintain_source_accent
//   ❌ enhance_named_entities_pronunciation,
//      acoustic_quality_boost, temperature, speaker_similarity, stability,
//      output_enhancement, localize_speaker_weight
//   Sending unsupported params with 8.1 models causes 500 Internal Server Errors!
// Older models (mars-flash, mars-pro, mars-instruct) support the full schema.
function buildPayload(text, voiceId, lang, model, enhance, speakingRate) {
  const is8xModel = model.startsWith('mars-8.1-');
  // Per-voice overrides: enhance (default true) and speakingRate (default 0.7)
  const shouldEnhance = enhance !== undefined ? enhance : true;
  const rate = speakingRate !== undefined ? speakingRate : 0.7;

  if (is8xModel) {
    // 8.1 models: include only supported voice_settings params
    return {
      text,
      voice_id: Number(voiceId),
      language: lang,
      speech_model: model,
      voice_settings: {
        enhance_reference_audio_quality: shouldEnhance,
        maintain_source_accent: true,
        speaking_rate: rate,
      },
      output_configuration: {
        format: 'flac',
        sample_rate: 48000,
        apply_enhancement: shouldEnhance,
      },
    };
  }

  // Full payload for older models — includes all voice_settings
  return {
    text,
    voice_id: Number(voiceId),
    language: lang,
    speech_model: model,
    enhance_named_entities_pronunciation: true,
    voice_settings: {
      enhance_reference_audio_quality: shouldEnhance,
      maintain_source_accent: true,
      speaking_rate: rate,
    },
    output_configuration: {
      format: 'flac',
      sample_rate: model === 'mars-flash' || model === 'mars-instruct' ? 22050 : 48000,
      apply_enhancement: shouldEnhance,
    },
  };
}

// Try /tts-stream endpoint (returns audio directly — fastest)
async function tryTtsStream(apiKey, payload, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const audioRes = await fetch('https://client.camb.ai/apis/tts-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!audioRes.ok) {
      const errDetail = await extractError(audioRes);
      const err = new Error(`tts-stream ${audioRes.status}: ${errDetail}`);
      err.status = audioRes.status;
      throw err;
    }

    const contentType = audioRes.headers.get('content-type') || 'audio/flac';
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error('tts-stream returned empty audio');
    }
    return { buffer, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Try /tts async endpoint (create task → poll for result)
async function tryTtsAsync(apiKey, payload, timeoutMs = 25000) {
  const startTime = Date.now();

  // Step 1: Create TTS task
  const controller = new AbortController();
  const createTimeoutId = setTimeout(() => controller.abort(), 15000);

  let createRes;
  try {
    createRes = await fetch('https://client.camb.ai/apis/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(createTimeoutId);
  }

  if (!createRes.ok) {
    const errDetail = await extractError(createRes);
    const err = new Error(`tts-async create ${createRes.status}: ${errDetail}`);
    err.status = createRes.status;
    throw err;
  }

  const createData = await createRes.json();
  const taskId = createData.task_id || createData.run_id || createData.id;
  if (!taskId) {
    throw new Error(`tts-async: No task ID in response: ${JSON.stringify(createData)}`);
  }

  console.log(`[camb-tts] Async task created: ${taskId}`);

  // Step 2: Poll for result
  const pollInterval = 800;
  const maxPollTime = timeoutMs - (Date.now() - startTime) - 2000;

  while (Date.now() - startTime < maxPollTime) {
    await new Promise(r => setTimeout(r, pollInterval));

    const pollRes = await fetch(`https://client.camb.ai/apis/tts/${taskId}`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    if (!pollRes.ok) {
      if (pollRes.status === 404) continue;
      throw new Error(`tts-async poll ${pollRes.status}`);
    }

    const pollData = await pollRes.json();
    const status = (pollData.status || '').toUpperCase();

    if (status === 'SUCCESS' || status === 'COMPLETED' || pollData.url || pollData.run_url) {
      const audioUrl = pollData.url || pollData.run_url;
      if (!audioUrl) {
        throw new Error(`tts-async: Task completed but no URL: ${JSON.stringify(pollData)}`);
      }

      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        throw new Error(`tts-async: Audio download failed ${audioRes.status}`);
      }

      const contentType = audioRes.headers.get('content-type') || 'audio/flac';
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error('tts-async: Empty audio response');
      }
      return { buffer, contentType };
    }

    if (status === 'FAILED' || status === 'ERROR') {
      throw new Error(`tts-async: Task failed: ${pollData.error || JSON.stringify(pollData)}`);
    }
  }

  throw new Error('tts-async: Timed out');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { text, voiceId, gender, age, keyIndex, language, perVoiceModel, perVoiceEnhance, perVoiceSpeakingRate } = req.body || {};
  if (!text || !voiceId) {
    return res.status(400).json({ error: 'Missing required fields: text, voiceId' });
  }

  const MAX_TEXT_LENGTH = 3000;
  if (text && text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `Text too long (max ${MAX_TEXT_LENGTH} chars)` });
  }

  const keys = getApiKeys();
  if (keys.length === 0) {
    return res.status(500).json({ error: 'No Camb.ai API keys configured on server' });
  }

  const lang = language || 'en-us';

  console.log(`[camb-tts] Request: voiceId=${voiceId}, lang=${lang}, text="${text.slice(0, 80)}", keyIndex=${keyIndex}, keysAvailable=${keys.length}`);

  // Determine which key to use: prefer the keyIndex from the voice list mapping
  const keysToTry = [];
  if (typeof keyIndex === 'number' && keyIndex >= 0 && keyIndex < keys.length) {
    keysToTry.push(keys[keyIndex]);
  }
  for (const key of keys) {
    if (!keysToTry.includes(key)) keysToTry.push(key);
  }

  // If a per-voice model is specified, try it FIRST before falling back to the default order
  const enhance = perVoiceEnhance;
  const speakingRate = perVoiceSpeakingRate;
  const perVoiceModelValid = perVoiceModel && typeof perVoiceModel === 'string' && perVoiceModel.startsWith('mars-');

  const payloadVariants = [];

  // 1. If per-voice model is specified, try it first (both stream and async)
  if (perVoiceModelValid) {
    payloadVariants.push({
      label: `tts-stream + ${perVoiceModel} (per-voice)`,
      method: 'stream',
      payload: buildPayload(text, voiceId, lang, perVoiceModel, enhance, speakingRate),
    });
    payloadVariants.push({
      label: `tts-async + ${perVoiceModel} (per-voice)`,
      method: 'async',
      payload: buildPayload(text, voiceId, lang, perVoiceModel, enhance, speakingRate),
    });
  }

  // 2. Default fallback variants (if per-voice model fails or not specified)
  payloadVariants.push(
    {
      label: 'tts-stream + mars-8.1-pro-beta',
      method: 'stream',
      payload: buildPayload(text, voiceId, lang, 'mars-8.1-pro-beta', enhance, speakingRate),
    },
    {
      label: 'tts-stream + mars-8.1-flash-beta',
      method: 'stream',
      payload: buildPayload(text, voiceId, lang, 'mars-8.1-flash-beta', enhance, speakingRate),
    },
    {
      label: 'tts-stream + mars-flash',
      method: 'stream',
      payload: buildPayload(text, voiceId, lang, 'mars-flash', enhance, speakingRate),
    },
    // Async fallback — only tried if all stream attempts fail
    {
      label: 'tts-async + mars-8.1-pro-beta',
      method: 'async',
      payload: buildPayload(text, voiceId, lang, 'mars-8.1-pro-beta', enhance, speakingRate),
    },
    {
      label: 'tts-async + mars-8.1-flash-beta',
      method: 'async',
      payload: buildPayload(text, voiceId, lang, 'mars-8.1-flash-beta', enhance, speakingRate),
    },
  );

  const allErrors = [];

  // Try each key with each variant until one succeeds
  for (let ki = 0; ki < keysToTry.length; ki++) {
    const apiKey = keysToTry[ki];
    const keyLabel = `key${ki + 1}(${apiKey.slice(0, 6)})`;

    for (const variant of payloadVariants) {
      try {
        console.log(`[camb-tts] Trying ${keyLabel} + ${variant.label}`);
        // Log the actual payload being sent (for debugging 500 errors)
        console.log(`[camb-tts] Payload keys: ${Object.keys(variant.payload).join(', ')}`);

        let result;
        if (variant.method === 'stream') {
          result = await tryTtsStream(apiKey, variant.payload);
        } else {
          result = await tryTtsAsync(apiKey, variant.payload);
        }

        console.log(`[camb-tts] SUCCESS: ${keyLabel} + ${variant.label} — ${result.buffer.length} bytes`);
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Length', String(result.buffer.length));
        return res.status(200).send(result.buffer);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[camb-tts] FAILED: ${keyLabel} + ${variant.label}: ${errMsg}`);
        allErrors.push(`${keyLabel}/${variant.label}: ${errMsg}`);

        // Auth/payment errors — skip remaining variants for this key
        if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('402')) {
          break;
        }
        // Rate limited — try next key immediately
        if (errMsg.includes('429')) {
          console.warn(`[camb-tts] Rate limited on ${keyLabel}, trying next key`);
          break;
        }
        // 422 = validation error, try next variant
        if (errMsg.includes('422')) {
          continue;
        }
        // For other errors (including 500), try next variant
        continue;
      }
    }
  }

  // All attempts failed — return detailed error info
  console.error(`[camb-tts] ALL FAILED. ${allErrors.length} errors:`);
  allErrors.forEach(e => console.error(`  - ${e}`));

  res.status(502).json({
    error: 'All API keys and formats failed',
    detail: allErrors.join(' | '),
    hint: 'Check Vercel function logs for full details. Ensure API keys are valid and have credits.',
  });
}
