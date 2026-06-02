// Admin authentication endpoint
// Supports POST (login), GET (check session), DELETE (logout)
// Session tokens use HMAC-SHA256 signatures stored in httpOnly cookies

const SESSION_DURATION = 3650 * 24 * 60 * 60 * 1000; // 10 years — no auto-logout

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * BUG FIX: Do NOT return early on length mismatch — that leaks password length.
 * Instead, always compare the full strings, using XOR to detect differences.
 */
function constantTimeCompare(a, b) {
  // Use the longer length to ensure we always do the same amount of work
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length; // Length difference is captured here
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

/**
 * Get all configured owner accounts from environment variables.
 */
function getOwnerAccounts() {
  const accounts = [];

  const o1User = process.env.OWNER1_USERNAME?.trim();
  const o1Pass = process.env.OWNER1_PASSWORD?.trim();
  if (o1User && o1Pass) accounts.push({ username: o1User, password: o1Pass });

  const o2User = process.env.OWNER2_USERNAME?.trim();
  const o2Pass = process.env.OWNER2_PASSWORD?.trim();
  if (o2User && o2Pass) accounts.push({ username: o2User, password: o2Pass });

  const adminUser = process.env.ADMIN_USERNAME?.trim();
  const adminPass = process.env.ADMIN_PASSWORD?.trim();
  if (adminUser && adminPass && !accounts.some(a => a.username === adminUser)) {
    accounts.push({ username: adminUser, password: adminPass });
  }

  return accounts;
}

async function hashToken(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSessionToken(username) {
  const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || (() => { console.warn('[WARN] No JWT_SECRET or ADMIN_PASSWORD set — using insecure default. Set JWT_SECRET in production!'); return 'fallback-secret-change-me'; })();
  const expiresAt = Date.now() + SESSION_DURATION;
  const tokenPayload = JSON.stringify({ username, expiresAt });
  const signature = await hashToken(tokenPayload, secret);
  return Buffer.from(tokenPayload, 'utf-8').toString('base64') + '.' + signature;
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
    const expectedSignature = await hashToken(payload, secret);

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

  // POST — Login
  if (req.method === 'POST') {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const accounts = getOwnerAccounts();
      if (accounts.length === 0) {
        return res.status(500).json({ error: 'No owner credentials configured on server.' });
      }

      let matched = false;
      for (const account of accounts) {
        if (constantTimeCompare(username, account.username) && constantTimeCompare(password, account.password)) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = await createSessionToken(username);
      
      // Set httpOnly cookie BEFORE sending response to ensure it's included
      const isProduction = process.env.NODE_ENV === 'production';
      res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; ${isProduction ? 'Secure;' : ''} SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION / 1000}`);

      return res.status(200).json({
        success: true,
        username,
        expiresAt: Date.now() + SESSION_DURATION,
      });
    } catch {
      return res.status(400).json({ error: 'Invalid request body' });
    }
  }

  // GET — Check session
  if (req.method === 'GET') {
    const username = await verifySession(req);
    if (username) {
      return res.status(200).json({ authenticated: true, username });
    }
    return res.status(401).json({ authenticated: false });
  }

  // DELETE — Logout
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'GET, POST, or DELETE only' });
}
