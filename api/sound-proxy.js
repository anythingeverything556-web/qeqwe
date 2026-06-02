const MYINSTANTS_BASE = 'https://www.myinstants.com';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
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

async function fetchInstantPage(slug) {
  const url = `${MYINSTANTS_BASE}/en/instant/${slug}/`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`page ${res.status}`);
  return await res.text();
}

async function fetchSearchPage(query) {
  const url = `${MYINSTANTS_BASE}/en/search/?name=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return await res.text();
}

function extractAudioPath(html) {
  const hrefMatch = html.match(/href=["']([^"']*\/media\/sounds\/[^"']+\.(?:mp3|wav|ogg))["']/i);
  if (hrefMatch?.[1]) return hrefMatch[1];
  const playMatch = html.match(/play\(["']([^"']*\/media\/sounds\/[^"']+\.(?:mp3|wav|ogg))["']/i);
  if (playMatch?.[1]) return playMatch[1];
  const mediaMatch = html.match(/(\/media\/sounds\/[^"'<>]+\.(?:mp3|wav|ogg))/i);
  if (mediaMatch?.[1]) return mediaMatch[1];
  return null;
}

function extractAudioPathsFromSearch(html) {
  const matches = Array.from(html.matchAll(/play\(["']([^"']*\/media\/sounds\/[^"']+\.(?:mp3|wav|ogg))["']/gi))
    .map(match => match[1]);
  const hrefs = Array.from(html.matchAll(/href=["']([^"']*\/media\/sounds\/[^"']+\.(?:mp3|wav|ogg))["']/gi))
    .map(match => match[1]);
  return Array.from(new Set([...matches, ...hrefs]));
}

async function streamAudio(audioPath, referer, res) {
  const audioUrl = audioPath.startsWith('http') ? audioPath : `${MYINSTANTS_BASE}${audioPath}`;
  const audioRes = await fetch(audioUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Referer': referer,
      'Accept': 'audio/mpeg,audio/*,*/*',
    },
  });
  if (!audioRes.ok) throw new Error(`audio ${audioRes.status}`);
  const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';
  res.setHeader('Content-Type', contentType);
  const arrayBuffer = await audioRes.arrayBuffer();
  return res.status(200).send(Buffer.from(arrayBuffer));
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const raw = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const rawQuery = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const slug = cleanSlug(raw);
  const searchQuery = cleanQuery(rawQuery || raw);
  if (!slug && !searchQuery) return res.status(400).json({ error: 'missing slug or q' });

  const slugCandidates = Array.from(new Set([
    slug,
    slug.replace(/-sound-effect$/i, ''),
    `${slug}-sound-effect`,
  ]));

  let lastError = '';
  for (const candidate of slugCandidates) {
    try {
      const html = await fetchInstantPage(candidate);
      const path = extractAudioPath(html);
      if (!path) throw new Error('no audio path found');
      return await streamAudio(path, `${MYINSTANTS_BASE}/en/instant/${candidate}/`, res);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  // Fallback: search MyInstants and stream the first playable result.
  if (searchQuery) {
    try {
      const html = await fetchSearchPage(searchQuery);
      const paths = extractAudioPathsFromSearch(html);
      for (const path of paths.slice(0, 5)) {
        try {
          return await streamAudio(path, `${MYINSTANTS_BASE}/en/search/?name=${encodeURIComponent(searchQuery)}`, res);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      lastError = `no audio paths found for search "${searchQuery}"`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return res.status(404).json({ error: 'sound not found', slug, q: searchQuery, detail: lastError });
}