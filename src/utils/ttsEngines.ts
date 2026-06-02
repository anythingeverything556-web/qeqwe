export interface TikTokVoice {
  id: string;
  name: string;
  category: string;
  description: string;
}

// Curated list of high-quality Edge TTS neural voices (Microsoft)
// These are 100% free, no API key, no rate limits.
export const TIKTOK_VOICES: TikTokVoice[] = [
  // Funny & Distinctive
  { id: 'en-US-AnaNeural', name: 'Ana (Cute Child)', category: 'Funny & Expressive', description: 'Cute young child voice — perfect for silly or innocent moments' },
  { id: 'en-US-GuyNeural', name: 'Guy (Newscaster)', category: 'Funny & Expressive', description: 'Booming newscaster voice — great for dramatic announcements' },
  { id: 'en-US-SteffanNeural', name: 'Steffan (Casual Bro)', category: 'Funny & Expressive', description: 'Casual friendly dude vibe' },
  { id: 'en-US-EricNeural', name: 'Eric (Warm)', category: 'Funny & Expressive', description: 'Warm, approachable male voice' },
  { id: 'en-US-MichelleNeural', name: 'Michelle (Friendly)', category: 'Funny & Expressive', description: 'Upbeat, enthusiastic female voice' },
  { id: 'en-US-RogerNeural', name: 'Roger (Deep Narrator)', category: 'Funny & Expressive', description: 'Deep, cinematic narrator' },
  { id: 'en-US-JaneNeural', name: 'Jane (Storyteller)', category: 'Funny & Expressive', description: 'Warm storytelling female voice' },
  { id: 'en-US-DavisNeural', name: 'Davis (News)', category: 'Funny & Expressive', description: 'Crisp news anchor voice' },

  // Accents
  { id: 'en-GB-RyanNeural', name: 'Ryan (British Male)', category: 'Accents', description: 'Crisp British gentleman' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (British Female)', category: 'Accents', description: 'Elegant British lady' },
  { id: 'en-GB-LibbyNeural', name: 'Libby (British Young)', category: 'Accents', description: 'Young British speaker' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha (Australian F)', category: 'Accents', description: 'Friendly Australian woman' },
  { id: 'en-AU-WilliamNeural', name: 'William (Australian M)', category: 'Accents', description: 'Laid-back Australian dude' },
  { id: 'en-IE-ConnorNeural', name: 'Connor (Irish)', category: 'Accents', description: 'Charming Irish fella' },
  { id: 'en-IE-EmilyNeural', name: 'Emily (Irish)', category: 'Accents', description: 'Lively Irish lass' },
  { id: 'en-CA-ClaraNeural', name: 'Clara (Canadian)', category: 'Accents', description: 'Polite Canadian voice' },
  { id: 'en-IN-NeerjaNeural', name: 'Neerja (Indian)', category: 'Accents', description: 'Clear Indian English' },
  { id: 'en-ZA-LukeNeural', name: 'Luke (South African)', category: 'Accents', description: 'South African male voice' },
  { id: 'en-NG-AbeoNeural', name: 'Abeo (Nigerian)', category: 'Accents', description: 'Nigerian English male' },
  { id: 'en-PH-RosaNeural', name: 'Rosa (Filipino)', category: 'Accents', description: 'Filipino English voice' },

  // Standard Narrators
  { id: 'en-US-JennyNeural', name: 'Jenny (Standard Female)', category: 'Standard', description: 'The classic TikTok narrator voice' },
  { id: 'en-US-AriaNeural', name: 'Aria (Newscaster F)', category: 'Standard', description: 'Professional female newscaster' },
  { id: 'en-US-ChristopherNeural', name: 'Christopher (Pro Male)', category: 'Standard', description: 'Professional male voice' },
  { id: 'en-US-AndrewNeural', name: 'Andrew (Calm Male)', category: 'Standard', description: 'Calm, trustworthy male' },

  // Other Languages
  { id: 'es-ES-ElviraNeural', name: 'Elvira (Spanish)', category: 'Multilingual', description: 'Spanish (Spain) female' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise (French)', category: 'Multilingual', description: 'French female narrator' },
  { id: 'de-DE-KatjaNeural', name: 'Katja (German)', category: 'Multilingual', description: 'German female voice' },
  { id: 'it-IT-ElsaNeural', name: 'Elsa (Italian)', category: 'Multilingual', description: 'Italian female voice' },
  { id: 'ja-JP-NanamiNeural', name: 'Nanami (Japanese)', category: 'Multilingual', description: 'Japanese female voice' },
  { id: 'ko-KR-SunHiNeural', name: 'SunHi (Korean)', category: 'Multilingual', description: 'Korean female voice' },
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca (Brazilian)', category: 'Multilingual', description: 'Brazilian Portuguese voice' },
  { id: 'ru-RU-SvetlanaNeural', name: 'Svetlana (Russian)', category: 'Multilingual', description: 'Russian female voice' },
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (Chinese)', category: 'Multilingual', description: 'Mandarin female voice' },
  { id: 'ar-EG-SalmaNeural', name: 'Salma (Arabic)', category: 'Multilingual', description: 'Arabic female voice' },
  { id: 'hi-IN-SwaraNeural', name: 'Swara (Hindi)', category: 'Multilingual', description: 'Hindi female voice' },
];

export interface CambVoice {
  id: number;
  voice_name: string;
  gender: number; // 1 = Male, 0 = Female
  age: number | string;
  description: string | null;
  is_published: boolean;
  language: string | null;
  apiKeyOwner?: string; // Track which API key owns this voice
}

// ═══════════════════════════════════════════════════════════
// LANGUAGE DETECTION — Simple heuristic-based language detection
// Uses Unicode character ranges to identify common languages.
// Also supports explicit prefix: !tts es: hola → detect 'es' and use 'es-es'
// ═══════════════════════════════════════════════════════════

/** Map of 2-letter language codes to BCP-47 locale codes */
const LANG_TO_LOCALE: Record<string, string> = {
  en: 'en-us', es: 'es-es', fr: 'fr-fr', de: 'de-de', it: 'it-it',
  pt: 'pt-br', nl: 'nl-nl', ru: 'ru-ru', pl: 'pl-pl', tr: 'tr-tr',
  ar: 'ar-eg', hi: 'hi-in', zh: 'zh-cn', ja: 'ja-jp', ko: 'ko-kr',
  th: 'th-th', vi: 'vi-vn', sv: 'sv-se', da: 'da-dk', fi: 'fi-fi',
  no: 'nb-no', cs: 'cs-cz', el: 'el-gr', he: 'he-il', id: 'id-id',
  ms: 'ms-my', uk: 'uk-ua', ro: 'ro-ro', hu: 'hu-hu', sk: 'sk-sk',
  bg: 'bg-bg', hr: 'hr-hr', sl: 'sl-si', ca: 'ca-es', fil: 'fil-ph',
};

/**
 * Detect the language of the given text using character-range heuristics.
 * Returns a BCP-47 locale string (e.g. 'en-us', 'zh-cn', 'ja-jp').
 * Falls back to 'en-us' if no specific language is detected.
 */
export function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) return 'en-us';

  // Check for CJK characters first (most distinctive ranges)
  let cjkCount = 0;
  let hiraganaKatakana = 0;
  let hangulCount = 0;
  let cyrillicCount = 0;
  let arabicCount = 0;
  let devanagariCount = 0;
  let thaiCount = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs (Chinese characters, also used in Japanese Kanji)
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x20000 && code <= 0x2A6DF)) {
      cjkCount++;
    }
    // Hiragana + Katakana (Japanese-only scripts)
    if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
      hiraganaKatakana++;
    }
    // Hangul (Korean)
    if ((code >= 0xAC00 && code <= 0xD7AF) || (code >= 0x1100 && code <= 0x11FF) || (code >= 0x3130 && code <= 0x318F)) {
      hangulCount++;
    }
    // Cyrillic (Russian, Ukrainian, etc.)
    if ((code >= 0x0400 && code <= 0x04FF) || (code >= 0x0500 && code <= 0x052F)) {
      cyrillicCount++;
    }
    // Arabic script
    if ((code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) || (code >= 0x08A0 && code <= 0x08FF)) {
      arabicCount++;
    }
    // Devanagari (Hindi, Marathi, etc.)
    if ((code >= 0x0900 && code <= 0x097F) || (code >= 0xA8E0 && code <= 0xA8FF)) {
      devanagariCount++;
    }
    // Thai
    if (code >= 0x0E00 && code <= 0x0E7F) {
      thaiCount++;
    }
  }

  // Determine language based on character counts
  // Japanese: has hiragana/katakana (unique identifier)
  if (hiraganaKatakana > 0) return 'ja-jp';
  // Korean: has hangul characters
  if (hangulCount > 0) return 'ko-kr';
  // Chinese: has CJK but no Japanese kana or Korean hangul
  if (cjkCount > 0) return 'zh-cn';
  // Arabic script
  if (arabicCount > 0) return 'ar-eg';
  // Devanagari (Hindi)
  if (devanagariCount > 0) return 'hi-in';
  // Thai
  if (thaiCount > 0) return 'th-th';
  // Cyrillic (Russian)
  if (cyrillicCount > 0) return 'ru-ru';

  // Default fallback
  return 'en-us';
}

/**
 * Parse explicit language prefix from TTS message text.
 * Format: "!tts es: hola" → extracts 'es' and returns { language: 'es-es', text: 'hola' }
 * Only matches 2-3 letter ISO language codes followed by a colon.
 * Returns null if no language prefix is found.
 */
export function parseLanguagePrefix(text: string): { language: string; text: string } | null {
  const match = text.match(/^([a-z]{2,3})\s*:\s*(.+)$/i);
  if (match) {
    const langCode = match[1].toLowerCase();
    const locale = LANG_TO_LOCALE[langCode];
    if (locale) {
      return { language: locale, text: match[2].trim() };
    }
  }
  return null;
}

/**
 * Resolve the language for a TTS message.
 * 1. Check for explicit language prefix (e.g. "es: hola")
 * 2. If not found, auto-detect from text content
 * 3. Fall back to 'en-us'
 */
export function resolveLanguage(text: string): { language: string; text: string } {
  const explicit = parseLanguagePrefix(text);
  if (explicit) return explicit;
  return { language: detectLanguage(text), text };
}

export const DEFAULT_PROXY_PREFIX = '';

export function withProxy(targetUrl: string, proxyPrefix = ''): string {
  if (!proxyPrefix.trim()) return targetUrl;

  const trimmed = proxyPrefix.trim();
  if (trimmed.includes('{url}')) {
    return trimmed.replace('{url}', targetUrl);
  }

  if (trimmed.includes('?') || trimmed.endsWith('=')) {
    return `${trimmed}${targetUrl}`;
  }

  return `${trimmed}${targetUrl}`;
}

// Convert base64 string to Blob helper
export function base64ToBlob(base64: string, mimeType = 'audio/flac'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

// 1. Browser TTS (free, instant, no server needed)
// Uses the Web Speech API built into every modern browser.
// Pitch, rate, and volume controls make voices sound funny.
export async function generateBrowserTTS(
  text: string,
  voiceName: string,
  pitch = 1,
  rate = 1,
  volume = 1
): Promise<{ promise: Promise<void>; cancel: () => void }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('Web Speech API not available in this browser'));
      return;
    }

    // Cancel any previous speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const selected = voices.find((v) => v.name === voiceName);
    if (selected) utterance.voice = selected;

    utterance.pitch = Math.min(Math.max(pitch, 0.1), 2);
    utterance.rate = Math.min(Math.max(rate, 0.1), 2);
    utterance.volume = Math.min(Math.max(volume, 0), 1);

    let cancelled = false;
    let resolvePromise: () => void = () => {};
    
    // Safety fallback timeout to prevent queue hangs if SpeechSynthesis stalls
    const safetyTimeout = setTimeout(() => {
      cancelled = true;
      try { window.speechSynthesis.cancel(); } catch {}
      resolvePromise();
    }, Math.max(7000, text.length * 80)); // scale with character length

    const promise = new Promise<void>((res, rej) => {
      resolvePromise = () => {
        clearTimeout(safetyTimeout);
        res();
      };
      utterance.onend = () => {
        clearTimeout(safetyTimeout);
        res();
      };
      utterance.onerror = (e) => {
        clearTimeout(safetyTimeout);
        if (!cancelled) rej(new Error(e.error));
        else res();
      };
    });

    resolve({
      promise,
      cancel: () => {
        cancelled = true;
        try { window.speechSynthesis.cancel(); } catch {}
        resolvePromise();
      },
    });

    try { window.speechSynthesis.speak(utterance); } catch (e) {
      cancelled = true; resolvePromise();
    }
  });
}

// 2. Camb.ai API calls
export async function fetchCambVoices(apiKey: string, proxyUrl = ''): Promise<CambVoice[]> {
  const url = withProxy('https://client.camb.ai/apis/list-voices', proxyUrl);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Camb.ai voices: ${response.statusText}`);
  }

  return await response.json();
}

// Camb.ai speech models — updated to current valid model names
// NOTE: 'mars-8.1-beta' NO LONGER EXISTS — it was renamed. Valid models:
//   mars-8.1-flash-beta (fastest, 312 locales), mars-8.1-pro-beta (best quality),
//   mars-flash (ultra-low latency), mars-pro (balanced), mars-instruct (emotional control)
export const CAMB_SPEECH_MODEL = 'mars-8.1-pro-beta';

export async function generateCambTTS(
  text: string,
  voiceId: number,
  apiKey: string,
  _gender = 1,
  _age = 30,
  proxyUrl = '',
  // FIX: Default no-op so callers can omit progress callback without crash
  onProgress: (status: string) => void = () => {},
  language = 'en-us'
): Promise<Blob> {
  // Using the new /tts-stream endpoint — returns audio directly (no polling needed).
  // Much faster and simpler than the deprecated /tts async flow.
  onProgress('Generating speech with MARS 8.1 Beta + Enhance...');
  const streamUrl = withProxy('https://client.camb.ai/apis/tts-stream', proxyUrl);
  // IMPORTANT: mars-8.1-pro-beta and mars-8.1-flash-beta support a SUBSET of params:
  //   ✅ text, voice_id, language, speech_model, output_configuration
  //   ✅ voice_settings.enhance_reference_audio_quality, voice_settings.speaking_rate,
  //      voice_settings.maintain_source_accent
  //   ❌ enhance_named_entities_pronunciation,
  //      acoustic_quality_boost, temperature, speaker_similarity, stability,
  //      output_enhancement, localize_speaker_weight
  //   Sending unsupported params with 8.1 models causes 500 Internal Server Errors!
  let payload: Record<string, unknown>;
  if (CAMB_SPEECH_MODEL.startsWith('mars-8.1-')) {
    // 8.1 models: include only supported voice_settings params
    payload = {
      text,
      voice_id: voiceId,
      language,
      speech_model: CAMB_SPEECH_MODEL,
      voice_settings: {
        enhance_reference_audio_quality: true,
        maintain_source_accent: true,
        speaking_rate: 0.7,
      },
      output_configuration: {
        format: 'flac',
        sample_rate: 48000,
        apply_enhancement: true,
      },
    };
  } else {
    // Full payload for older models (mars-pro, mars-flash, mars-instruct)
    payload = {
      text,
      voice_id: voiceId,
      language,
      speech_model: CAMB_SPEECH_MODEL,
      enhance_named_entities_pronunciation: true,
      voice_settings: {
        enhance_reference_audio_quality: true,
        maintain_source_accent: true,
        speaking_rate: 0.7,
      },
      output_configuration: {
        format: 'flac',
        sample_rate: CAMB_SPEECH_MODEL === 'mars-flash' || CAMB_SPEECH_MODEL === 'mars-instruct' ? 22050 : 48000,
        apply_enhancement: true,
      },
    };
  }

  const audioResponse = await fetch(streamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    // BUG FIX: Add 30s timeout to prevent hung connections from blocking TTS forever
    signal: AbortSignal.timeout(30000),
  });

  if (!audioResponse.ok) {
    // Try to extract error detail from response
    let errDetail = '';
    try {
      const errData = await audioResponse.json();
      // Handle nested objects, arrays, and non-string fields properly
      const flatten = (val: unknown): string => {
        if (val == null) return '';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return val.map(flatten).filter(Boolean).join(', ');
        if (typeof val === 'object') {
          const obj = val as Record<string, unknown>;
          return (obj.message || obj.error || obj.detail || obj.msg || JSON.stringify(val)) as string;
        }
        return String(val);
      };
      errDetail = flatten(errData.detail) || flatten(errData.error) || flatten(errData.message) || JSON.stringify(errData);
    } catch {
      errDetail = await audioResponse.text().catch(() => '');
    }
    throw new Error(`Camb.ai TTS failed: ${audioResponse.status} - ${errDetail}`);
  }

  onProgress('Downloading synthesized voice...');
  return await audioResponse.blob();
}

// 3. Server-side Camb.ai voices (via Vercel API route) — requires admin auth
// Uses API keys stored as Vercel environment variables (CAMB_API_KEY_1, CAMB_API_KEY_2, etc.)
// No client-side API key needed — all auth happens server-side.
export async function fetchCambVoicesServer(): Promise<{
  voices: CambVoice[];
  keyCount: number;
  errors?: string[];
  voiceKeyMap: { voiceId: number; keyIndex: number }[];
}> {
  const response = await fetch('/api/camb-voices');
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to fetch voices from server' }));
    throw new Error(err.error || `Server voices error: ${response.status}`);
  }
  return await response.json();
}

// 3b. Public Camb.ai voices — NO authentication required
// Returns only safe fields (id, voice_name, gender) — no API key info.
// Also returns chatter-visible settings (allowChatterVoice, prefix, channel, chatterVoices),
// custom sounds (customSounds), and usage leaderboard data.
// Used by the Chatter page to show available voices.
export async function fetchCambVoicesPublic(): Promise<{
  voices: { id: number; voice_name: string; gender: number }[];
  source?: string;
  count?: number;
  allowChatterVoice?: boolean;
  prefix?: string;
  channel?: string;
  chatterVoices?: { id: number; voice_name: string; gender: number; engine: 'camb' | 'browser' }[];
  hiddenSounds?: string[];
  customPresets?: { name: string; fx: any }[];
  customSounds?: Array<{ id: string; name: string; hasDataUrl: boolean; mimeType: string; size: number; createdAt: string }>;
  leaderboard?: {
    chatters: Record<string, { count: number; lastVoice: string; lastPreset: string; lastTimestamp?: number }>;
    voices: Record<string, number>;
    presets: Record<string, number>;
  };
}> {
  try {
    const response = await fetch('/api/public-voices');
    if (!response.ok) {
      return { voices: [], source: 'error', customSounds: [], leaderboard: { chatters: {}, voices: {}, presets: {} } };
    }
    return await response.json();
  } catch {
    return { voices: [], source: 'error', customSounds: [], leaderboard: { chatters: {}, voices: {}, presets: {} } };
  }
}

// 4. Server-side Camb.ai TTS (via Vercel API route)
// Proxies the TTS endpoint through Vercel — tries /tts-stream and /tts async.
// API keys are managed server-side; the frontend only specifies which key index to prefer
// (from the voiceKeyMap returned by fetchCambVoicesServer).
// Includes automatic retry with backoff for transient failures.
export async function generateCambTTSServer(
  text: string,
  voiceId: number,
  keyIndex: number = 0,
  gender: number = 1,
  age: number = 30,
  language: string = 'en-us',
  maxRetries: number = 3,
  perVoiceModel?: string,
  perVoiceEnhance?: boolean,
  perVoiceSpeakingRate?: number,
): Promise<Blob> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/camb-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId, gender, age, keyIndex, language, perVoiceModel, perVoiceEnhance, perVoiceSpeakingRate }),
        signal: AbortSignal.timeout(45000), // 45s timeout (server does parallel key tries)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `TTS server error: ${response.status}` }));
        const detail = err.detail || '';
        const mainError = err.error || `TTS failed: ${response.status}`;
        console.error(`[camb-tts-client] Server returned ${response.status}:`, JSON.stringify(err).slice(0, 500));
        lastError = new Error(detail ? `${mainError} — ${detail}` : mainError);

        // Don't retry on client errors (400-level) — they won't change
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw lastError;
        }
        // Retry on 429 (rate limited), 500-level (server errors), or network errors
        if (attempt < maxRetries) {
          const delay = Math.min(500 * Math.pow(1.5, attempt), 2000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw lastError;
      }

      return await response.blob();
    } catch (e: any) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Don't retry on abort (user cancelled) or client errors
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      if (attempt < maxRetries) {
        const delay = Math.min(500 * Math.pow(1.5, attempt), 2000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('TTS generation failed after retries');
}

// 5. Create a custom voice clone via the server API proxy
// Uploads an audio file reference to Camb.ai to create a cloned voice.
// The server endpoint always sends enhance_audio: true for better quality
// (noise reduction, volume normalization on the reference audio).
// Returns the created voice data (id, voice_name, etc.)
export async function createCustomVoiceServer(
  file: File,
  voiceName: string,
  gender: number = 1,
  age: number = 30,
  language: string = 'en-us',
  description: string = '',
): Promise<{ success: boolean; voice: any; message?: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('voice_name', voiceName);
  formData.append('gender', String(gender));
  formData.append('age', String(age));
  formData.append('language', language);
  if (description) formData.append('description', description);
  // enhance_audio is set server-side (always true) — no need to send from client

  const response = await fetch('/api/custom-voice', {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(120000), // 2 min timeout — voice creation can be slow
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `Voice creation failed: ${response.status}` }));
    throw new Error(err.error || err.detail || `Voice creation failed: ${response.status}`);
  }

  return await response.json();
}
