import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';

// Scrape a MyInstants page to extract the MP3 URL
// REQUIRES admin authentication via session cookie

async function scrapeMyInstantsPage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    const html = await res.text();

    const preloadMatch = html.match(/var\s+preloadAudioUrl\s*=\s*['"]([^'"]+\.mp3)['"]/);
    if (preloadMatch) {
      const path = preloadMatch[1];
      return path.startsWith('http') ? path : `https://www.myinstants.com${path}`;
    }

    const dataUrlMatch = html.match(/data-url=['"]([^'"]+\.mp3)['"]/);
    if (dataUrlMatch) {
      const path = dataUrlMatch[1];
      return path.startsWith('http') ? path : `https://www.myinstants.com${path}`;
    }

    const playSoundMatch = html.match(/playSound\(['"]([^'"]+\.mp3)['"]\)/);
    if (playSoundMatch) {
      const path = playSoundMatch[1];
      return path.startsWith('http') ? path : `https://www.myinstants.com${path}`;
    }

    const mediaMatch = html.match(/(\/media\/sounds\/[^'"\s\)]+\.mp3)/);
    if (mediaMatch) {
      return `https://www.myinstants.com${mediaMatch[1]}`;
    }

    return null;
  } catch {
    return null;
  }
}

async function searchMyInstants(query: string): Promise<string | null> {
  try {
    const searchUrl = `https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    const html = await res.text();
    const instantMatch = html.match(/href=["']\/en\/instant\/([^/]+)\/["']/);
    if (instantMatch) {
      const pageUrl = `https://www.myinstants.com/en/instant/${instantMatch[1]}/`;
      return await scrapeMyInstantsPage(pageUrl);
    }

    return null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  // AUTH CHECK
  const username = await verifySession(request);
  if (!username) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  const query = searchParams.get('q');
  const url = searchParams.get('url');

  let audioUrl: string | null = null;

  if (url) {
    audioUrl = await scrapeMyInstantsPage(url);
    if (audioUrl) return NextResponse.json({ audioUrl, source: 'direct' });
  }

  if (slug) {
    const pageUrl = `https://www.myinstants.com/en/instant/${slug}/`;
    audioUrl = await scrapeMyInstantsPage(pageUrl);
    if (audioUrl) return NextResponse.json({ audioUrl, source: 'slug' });
  }

  if (query) {
    audioUrl = await searchMyInstants(query);
    if (audioUrl) return NextResponse.json({ audioUrl, source: 'search' });
  }

  return NextResponse.json({ error: 'Could not resolve sound', slug, query }, { status: 404 });
}
