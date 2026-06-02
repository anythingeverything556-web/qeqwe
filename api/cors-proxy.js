const ALLOWED_PROXY_HOSTS = new Set(['client.camb.ai', 'assets.mixkit.co', 'www.myinstants.com', 'tiktok-tts.weilnet.workers.dev']);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,x-api-key,xi-api-key,Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type,Content-Length');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function readRawBody(req) {
  // If body is already parsed by Vercel
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'object') return JSON.stringify(req.body);
  }
  // Otherwise read raw stream
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const rawTarget = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!rawTarget) {
    res.status(400).json({ error: 'Missing required query parameter: url' });
    return;
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    res.status(400).json({ error: 'Invalid target URL' });
    return;
  }

  if (!ALLOWED_PROXY_HOSTS.has(target.hostname)) {
    res.status(403).json({ error: 'Target host not allowed' });
    return;
  }

  // Build headers — pretend to be a real browser to bypass WAF blocks
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': req.headers.accept || '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Origin': target.origin,
    'Referer': target.origin + '/',
  };

  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key'];
  if (req.headers['xi-api-key']) headers['xi-api-key'] = req.headers['xi-api-key'];
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await readRawBody(req);
    if (Buffer.isBuffer(body) && body.length === 0) body = undefined;
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body,
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(buffer);
  } catch (error) {
    res.status(502).json({
      error: 'Proxy request failed',
      detail: error instanceof Error ? error.message : 'Unknown proxy error',
    });
  }
}
