import { NextRequest } from 'next/server';

// Shared auth utilities — used by all protected API routes
// Session verification uses HMAC-signed tokens stored in httpOnly cookies

const SESSION_DURATION = 3650 * 24 * 60 * 60 * 1000; // 10 years — no auto-logout

async function hashToken(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a session token from the request cookies.
 * Returns the authenticated username, or null if not authenticated.
 */
export async function verifySession(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get('admin_session')?.value;
  if (!token) return null;

  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || (() => { console.warn('[WARN] No JWT_SECRET or ADMIN_PASSWORD set — using insecure default. Set JWT_SECRET in production!'); return 'fallback-secret-change-me'; })();
    const payload = atob(payloadB64);
    const expectedSignature = await hashToken(payload, secret);

    // Constant-time comparison
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

/**
 * Create a signed session token for an authenticated admin.
 */
export async function createSessionToken(username: string): Promise<string> {
  const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || (() => { console.warn('[WARN] No JWT_SECRET or ADMIN_PASSWORD set — using insecure default. Set JWT_SECRET in production!'); return 'fallback-secret-change-me'; })();
  const expiresAt = Date.now() + SESSION_DURATION;
  const tokenPayload = JSON.stringify({ username, expiresAt });
  const signature = await hashToken(tokenPayload, secret);
  return Buffer.from(tokenPayload, 'utf-8').toString('base64') + '.' + signature;
}

/**
 * Get all configured Camb.ai API keys from environment variables.
 */
export function getApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const key = process.env[`CAMB_API_KEY_${i}`];
    if (key && key.trim()) keys.push(key.trim());
  }
  const singleKey = process.env.CAMB_API_KEY;
  if (singleKey && singleKey.trim()) keys.push(singleKey.trim());
  return [...new Set(keys)];
}
