const MYINSTANTS_BASE = 'https://www.myinstants.com';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=2592000');
}

function cleanSlug(slug) {
  return String(slug || '')
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanQuery(query) {
  return String(query || '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`html ${res.status}`);
  return await res.text();
}

function makeAbsolute(path) {
  if (!path) return null;
  return path.startsWith('http') ? path : `${MYINSTANTS_BASE}${path}`;
}

function extractAudioPaths(html) {
  const patterns = [
    /href=["']([^"']*\/media\/sounds\/[^"']+\.(?:mp3|wav|ogg))["']/gi,
    /play\(["']([^"']*\/media\/sounds\/[^"']+\.(?:mp3|wav|ogg))["']/gi,
    /(\/media\/sounds\/[^"'<>\s]+\.(?:mp3|wav|ogg))/gi,
  ];
  const out = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (match[1]) out.push(makeAbsolute(match[1]));
    }
  }
  return Array.from(new Set(out.filter(Boolean)));
}

async function verifyAudio(url, referer) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Referer': referer,
      'Range': 'bytes=0-1023',
      'Accept': 'audio/mpeg,audio/*,*/*',
    },
  });
  if (!res.ok && res.status !== 206) throw new Error(`audio ${res.status}`);
  return true;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const rawSlug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const rawQuery = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const slug = cleanSlug(rawSlug);
  const q = cleanQuery(rawQuery || rawSlug);

  const slugCandidates = Array.from(new Set([
    slug,
    slug.replace(/-sound-effect$/i, ''),
    `${slug}-sound-effect`,
  ].filter(Boolean)));

  const attempts = [];
  slugCandidates.forEach(candidate => {
    attempts.push({ type: 'instant', url: `${MYINSTANTS_BASE}/en/instant/${candidate}/`, referer: `${MYINSTANTS_BASE}/en/instant/${candidate}/` });
  });
  if (q) {
    attempts.push({ type: 'search', url: `${MYINSTANTS_BASE}/en/search/?name=${encodeURIComponent(q)}`, referer: `${MYINSTANTS_BASE}/en/search/?name=${encodeURIComponent(q)}` });
  }

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const html = await fetchHtml(attempt.url);
      const paths = extractAudioPaths(html);
      for (const audioUrl of paths.slice(0, 8)) {
        try {
          await verifyAudio(audioUrl, attempt.referer);
          return res.status(200).json({ audioUrl, source: attempt.type, page: attempt.url });
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      lastError = `no media paths in ${attempt.url}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return res.status(404).json({ error: 'sound not resolved', slug, q, detail: lastError });
}