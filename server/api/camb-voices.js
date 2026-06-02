import { NextRequest, NextResponse } from 'next/server';
import { verifySession, getApiKeys } from '@/lib/auth';
import { writeFile } from 'fs/promises';
import path from 'path';

// Proxies Camb.ai list-voices API using server-stored API keys
// REQUIRES admin authentication via session cookie
// Also saves a public-safe voice cache for the chatter page

const VOICE_CACHE_PATH = process.env.VOICE_CACHE_PATH || path.join(process.cwd(), 'data', 'voice-cache.json');

export async function GET(request: NextRequest) {
  // AUTH CHECK
  const username = await verifySession(request);
  if (!username) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const keys = getApiKeys();
  if (keys.length === 0) {
    return NextResponse.json({
      error: 'No Camb.ai API keys configured on server. Set CAMB_API_KEY_1, CAMB_API_KEY_2, etc. as environment variables.',
    }, { status: 500 });
  }

  const allVoices: any[] = [];
  const seenIds = new Set<number>();
  const seenNames = new Set<string>(); // Also dedup by name (same voice from different keys)
  const errors: string[] = [];
  const voiceKeyMap: { voiceId: number; keyIndex: number }[] = [];

  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch('https://client.camb.ai/apis/list-voices', {
        method: 'GET',
        headers: { 'x-api-key': keys[i] },
      });
      if (!response.ok) {
        errors.push(`Key ${i + 1}: ${response.status} ${response.statusText}`);
        continue;
      }
      const voices = await response.json();
      for (const v of voices) {
        const vid = Number(v.id);
        const nameKey = v.voice_name.toLowerCase().trim();
        // Skip if we've already seen this voice ID OR voice name
        // Handles: same key entered twice (same IDs) AND different keys with same voices (different IDs, same name)
        if (seenIds.has(vid) || seenNames.has(nameKey)) continue;
        seenIds.add(vid);
        seenNames.add(nameKey);
        allVoices.push({ ...v, id: vid, apiKeyOwner: i });
        voiceKeyMap.push({ voiceId: vid, keyIndex: i });
      }
    } catch (e: any) {
      errors.push(`Key ${i + 1}: ${e.message}`);
    }
  }

  // Save public-safe voice cache (only id, voice_name, gender) for the chatter page
  // This ensures chatters can see voice names even if API keys aren't live
  if (allVoices.length > 0) {
    const publicVoices = allVoices.map(v => ({
      id: v.id,
      voice_name: v.voice_name,
      gender: v.gender,
    }));
    try {
      await writeFile(VOICE_CACHE_PATH, JSON.stringify({
        voices: publicVoices,
        updatedAt: new Date().toISOString(),
        source: 'admin-refresh',
      }), 'utf-8');
    } catch {
      // Non-critical — cache write failure shouldn't break the admin response
    }
  }

  return NextResponse.json({
    voices: allVoices,
    keyCount: keys.length,
    errors: errors.length > 0 ? errors : undefined,
    voiceKeyMap,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
