import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';

// Proxy audio files to bypass CORS restrictions
// REQUIRES admin authentication via session cookie
export async function GET(request: NextRequest) {
  // AUTH CHECK
  const username = await verifySession(request);
  if (!username) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const audioUrl = searchParams.get('url');

  if (!audioUrl) {
    return NextResponse.json({ error: 'Missing required query parameter: url' }, { status: 400 });
  }

  try {
    const target = new URL(audioUrl);
    const allowedHosts = [
      'www.myinstants.com', 'myinstants.com',
      'assets.mixkit.co', 'www.soundjay.com', 'cdn.freesound.org',
    ];

    const isAllowed = allowedHosts.some(h => target.hostname === h || target.hostname.endsWith('.' + h));
    const isHttpsAudio = target.protocol === 'https:' && target.pathname.match(/\.(mp3|wav|ogg|mpeg)$/i);

    if (!isAllowed && !isHttpsAudio) {
      return NextResponse.json({ error: 'Target host not allowed' }, { status: 403 });
    }

    const upstream = await fetch(audioUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'audio/mpeg,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.8',
        'Referer': target.origin + '/',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Proxy request failed', detail: err.message }, { status: 502 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400',
    },
  });
}
