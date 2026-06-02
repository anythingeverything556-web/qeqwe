// Proxies Camb.ai Create Custom Voice API using server-stored API keys
// Endpoint: POST https://client.camb.ai/apis/create-custom-voice
// Accepts multipart/form-data with: voice_name, gender, file, description, age, language
// Always sends enhance_audio: true for better voice quality (noise reduction, volume normalization)
// Requires admin auth

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB for voice reference audio
const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/webm'];
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.webm'];

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

async function verifySession(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  if (!match) return null;
  const token = match[1];
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;
    const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'fallback-secret-change-me';
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

// Parse multipart form data
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return reject(new Error('Not multipart/form-data'));
    }
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return reject(new Error('No boundary found'));

    if (req.body && Buffer.isBuffer(req.body)) {
      resolve(parseBuffer(req.body, boundary));
      return;
    }
    if (typeof req.body === 'string') {
      resolve(parseBuffer(Buffer.from(req.body, 'binary'), boundary));
      return;
    }
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

  const keys = getApiKeys();
  if (keys.length === 0) {
    return res.status(500).json({ error: 'No Camb.ai API keys configured on server' });
  }

  try {
    const parts = await parseMultipart(req);
    console.log('[custom-voice] Parsed parts:', parts.map(p => ({ name: p.name, filename: p.filename, size: p.size, contentType: p.contentType })));

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

    // Extract form fields
    const voiceName = parts.find(p => p.name === 'voice_name')?.data?.toString('utf-8')?.trim() || 'Custom Voice';
    const genderStr = parts.find(p => p.name === 'gender')?.data?.toString('utf-8')?.trim() || '1';
    const gender = parseInt(genderStr, 10);
    const description = parts.find(p => p.name === 'description')?.data?.toString('utf-8')?.trim() || '';
    const ageStr = parts.find(p => p.name === 'age')?.data?.toString('utf-8')?.trim() || '30';
    const age = parseInt(ageStr, 10) || 30;
    const language = parts.find(p => p.name === 'language')?.data?.toString('utf-8')?.trim() || 'en-us';

    console.log(`[custom-voice] Creating voice: name="${voiceName}", gender=${gender}, age=${age}, language=${language}, file=${filePart.filename} (${filePart.size} bytes)`);

    // Build multipart/form-data for Camb.ai API
    // Always set enhance_audio: true for better quality (noise reduction, volume normalization)
    const apiKey = keys[0]; // Use first available key
    const cambBoundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const cambParts = [];

    // voice_name (required)
    cambParts.push(
      `--${cambBoundary}\r\nContent-Disposition: form-data; name="voice_name"\r\n\r\n${voiceName}`
    );

    // gender (required)
    cambParts.push(
      `--${cambBoundary}\r\nContent-Disposition: form-data; name="gender"\r\n\r\n${gender}`
    );

    // file (required)
    const fileCt = filePart.contentType || 'audio/wav';
    cambParts.push(
      `--${cambBoundary}\r\nContent-Disposition: form-data; name="file"; filename="${filePart.filename}"\r\nContent-Type: ${fileCt}\r\n\r\n`
    );

    // description (optional)
    if (description) {
      cambParts.push(
        `\r\n--${cambBoundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}`
      );
    }

    // age (optional, default 30)
    cambParts.push(
      `\r\n--${cambBoundary}\r\nContent-Disposition: form-data; name="age"\r\n\r\n${age}`
    );

    // enhance_audio: true — KEY FEATURE: noise reduction + volume normalization
    cambParts.push(
      `\r\n--${cambBoundary}\r\nContent-Disposition: form-data; name="enhance_audio"\r\n\r\ntrue`
    );

    // language (optional)
    if (language) {
      cambParts.push(
        `\r\n--${cambBoundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}`
      );
    }

    // Final boundary
    cambParts.push(`\r\n--${cambBoundary}--\r\n`);

    // Assemble the multipart body
    // We need to handle binary file data carefully
    const headerBuffers = cambParts.slice(0, 2).map(p => Buffer.from(p, 'utf-8'));
    const filePrefixBuffer = Buffer.from(cambParts[2], 'utf-8');
    const fileDataBuffer = filePart.data;
    const trailerParts = cambParts.slice(3);
    const trailerBuffer = Buffer.from(trailerParts.join(''), 'utf-8');

    const body = Buffer.concat([...headerBuffers, filePrefixBuffer, fileDataBuffer, trailerBuffer]);

    // Try each API key until one succeeds
    let lastError = null;
    for (let ki = 0; ki < keys.length; ki++) {
      const tryKey = keys[ki];
      try {
        console.log(`[custom-voice] Trying key ${ki + 1}/${keys.length}...`);
        const response = await fetch('https://client.camb.ai/apis/create-custom-voice', {
          method: 'POST',
          headers: {
            'x-api-key': tryKey,
            'Content-Type': `multipart/form-data; boundary=${cambBoundary}`,
          },
          body: body,
          signal: AbortSignal.timeout(60000), // 60s timeout — voice creation can take time
        });

        if (!response.ok) {
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
          console.error(`[custom-voice] Key ${ki + 1} failed: ${response.status} - ${errDetail}`);
          lastError = new Error(`API ${response.status}: ${errDetail}`);

          // Auth errors — try next key
          if (response.status === 401 || response.status === 403 || response.status === 402) continue;
          // Rate limited — try next key
          if (response.status === 429) continue;
          // Other errors — still try next key
          continue;
        }

        const result = await response.json();
        console.log(`[custom-voice] SUCCESS: Voice created with key ${ki + 1}`, JSON.stringify(result).slice(0, 300));
        return res.status(200).json({
          success: true,
          voice: result,
          message: `Voice "${voiceName}" created successfully with enhance_audio enabled`,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[custom-voice] Key ${ki + 1} exception: ${errMsg}`);
        lastError = e instanceof Error ? e : new Error(errMsg);
      }
    }

    // All keys failed
    console.error(`[custom-voice] ALL KEYS FAILED`);
    return res.status(502).json({
      error: 'All API keys failed to create custom voice',
      detail: lastError?.message || 'Unknown error',
    });
  } catch (e) {
    console.error('[custom-voice] Error:', e);
    return res.status(500).json({ error: `Voice creation failed: ${e.message}` });
  }
}
