import { NextRequest, NextResponse } from 'next/server';
import { verifySession, getApiKeys } from '@/lib/auth';

// Proxies Camb.ai TTS-Stream API using server-stored API keys
// Valid models: mars-8.1-flash-beta, mars-8.1-pro-beta, mars-flash, mars-pro, mars-instruct
// NOTE: 'mars-8.1-beta' NO LONGER EXISTS — causes 422 errors!
// REQUIRES admin authentication via session cookie
// IMPORTANT: mars-8.1-pro-beta and mars-8.1-flash-beta have a DIFFERENT payload schema:
//   They do NOT support: enhance_named_entities_pronunciation,
//   acoustic_quality_boost, temperature, speaker_similarity, stability,
//   output_enhancement, localize_speaker_weight
//   Sending unsupported top-level params with 8.1 models causes 500 Internal Server Errors!
//   voice_settings params (enhance_reference_audio_quality, speaking_rate, maintain_source_accent) ARE supported.

// Build a Camb.ai TTS payload.
// 8.1 models support a SUBSET of params:
//   ✅ text, voice_id, language, speech_model, output_configuration
//   ✅ voice_settings.enhance_reference_audio_quality, voice_settings.speaking_rate,
//      voice_settings.maintain_source_accent
//   ❌ enhance_named_entities_pronunciation,
//      acoustic_quality_boost, temperature, speaker_similarity, stability,
//      output_enhancement, localize_speaker_weight
//   Sending unsupported params with 8.1 models causes 500 Internal Server Errors!
// Older models support the full schema.
function buildPayload(text: string, voiceId: number, lang: string, model: string, enhance?: boolean, speakingRate?: number) {
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

export async function POST(request: NextRequest) {
  // AUTH CHECK
  const username = await verifySession(request);
  if (!username) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { text, voiceId, gender, age, keyIndex, language, perVoiceModel, perVoiceEnhance, perVoiceSpeakingRate } = body || {};
  if (!text || !voiceId) {
    return NextResponse.json({ error: 'Missing required fields: text, voiceId' }, { status: 400 });
  }

  const MAX_TEXT_LENGTH = 3000;
  if (text && text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: `Text too long (max ${MAX_TEXT_LENGTH} chars)` }, { status: 400 });
  }

  const keys = getApiKeys();
  if (keys.length === 0) {
    return NextResponse.json({ error: 'No Camb.ai API keys configured on server' }, { status: 500 });
  }

  const lang = language || 'en-us';

  const keysToTry: string[] = [];
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

  // Build models to try: per-voice model first, then defaults
  const modelsToTry: string[] = [];
  if (perVoiceModelValid) {
    modelsToTry.push(perVoiceModel);
  }
  // Default fallback models (only add if not already added as per-voice)
  const defaultModels = ['mars-8.1-pro-beta', 'mars-8.1-flash-beta', 'mars-flash'];
  for (const m of defaultModels) {
    if (!modelsToTry.includes(m)) modelsToTry.push(m);
  }
  const allErrors: string[] = [];

  for (const apiKey of keysToTry) {
    for (const model of modelsToTry) {
      try {
        const payload = buildPayload(text, voiceId, lang, model, enhance, speakingRate);

        console.log(`[camb-tts] Trying key ${apiKey.slice(0, 5)}/model ${model}`);
        console.log(`[camb-tts] Payload keys: ${Object.keys(payload).join(', ')}`);

        // Add 20s timeout to prevent hung connections blocking the server
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        let audioRes;
        try {
          audioRes = await fetch('https://client.camb.ai/apis/tts-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!audioRes.ok) {
          let errDetail = '';
          try {
            const errData = await audioRes.json();
            if (Array.isArray(errData.detail)) {
              errDetail = errData.detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
            } else {
              errDetail = errData.detail || errData.error || JSON.stringify(errData);
            }
          } catch {
            errDetail = await audioRes.text().catch(() => '');
          }
          const errMsg = `Key ${apiKey.slice(0, 5)}/model ${model}: ${audioRes.status} - ${errDetail}`;
          allErrors.push(errMsg);
          console.error(`[camb-tts] FAILED: ${errMsg}`);
          // Auth/payment errors — try next key
          if (audioRes.status === 401 || audioRes.status === 403 || audioRes.status === 402) {
            break;
          }
          // Rate limited — try next key immediately
          if (audioRes.status === 429) {
            console.warn(`[camb-tts] Rate limited on key ${apiKey.slice(0, 5)}, trying next key`);
            break;
          }
          // 422 = model not valid, try next model
          continue;
        }

        // Stream audio back directly
        const contentType = audioRes.headers.get('content-type') || 'audio/flac';
        const buffer = Buffer.from(await audioRes.arrayBuffer());
        if (buffer.length === 0) {
          allErrors.push(`Key ${apiKey.slice(0, 5)}/model ${model}: Empty audio response`);
          continue;
        }
        console.log(`[camb-tts] SUCCESS: ${buffer.length} bytes`);
        return new NextResponse(buffer, {
          status: 200,
          headers: { 'Content-Type': contentType, 'Content-Length': String(buffer.length) },
        });
      } catch (e: any) {
        const errMsg = `Key ${apiKey.slice(0, 5)}/model ${model}: ${e instanceof Error ? e.message : String(e)}`;
        allErrors.push(errMsg);
        console.error(`[camb-tts] EXCEPTION: ${errMsg}`);
      }
    }
  }

  console.error(`[camb-tts] ALL FAILED. ${allErrors.length} errors:`);
  allErrors.forEach(e => console.error(`  - ${e}`));

  return NextResponse.json({
    error: 'All API keys and models failed',
    detail: allErrors.join(' | '),
    hint: 'Check server logs. Ensure API keys are valid and have credits.',
  }, { status: 502 });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
