import { NextResponse } from 'next/server';
import { getApiKeys } from '@/lib/auth';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

// PUBLIC endpoint — no authentication required.
// Returns only voice names and IDs (no API key info, no voiceKeyMap).
// Also returns chatter-visible settings from in-memory global state.
// Used by the Chatter page so viewers can browse available voices.
//
// Strategy:
// 1. Try to serve from the persistent voice cache file (saved when admin loaded voices)
// 2. If no cache exists, try to fetch live from Camb.ai using server API keys
// 3. If that also fails, return empty list
// Also includes settings (allowChatterVoice, prefix, channel, chatterVoices) from global state.

const VOICE_CACHE_PATH = process.env.VOICE_CACHE_PATH || path.join(process.cwd(), 'data', 'voice-cache.json');

// In-memory settings — shared with /api/settings route
declare global {
  var ttsSettings: {
    allowChatterVoice?: boolean;
    prefix?: string;
    channel?: string;
    chatterVoices?: { id: number; voice_name: string; gender: number; engine: 'camb' | 'browser' }[];
  } | undefined;
}

interface CachedVoice {
  id: number;
  voice_name: string;
  gender: number;
}

interface VoiceCacheFile {
  voices: CachedVoice[];
  updatedAt: string;
  source: string;
}

const SETTINGS_PATH = process.env.SETTINGS_PATH || path.join(process.cwd(), 'data', 'settings.json');

async function getSettings() {
  // In-memory takes precedence (freshest data from this process)
  const mem = globalThis.ttsSettings || {};
  if (Object.keys(mem).length > 0 && typeof mem.allowChatterVoice === 'boolean') {
    return mem; // In-memory has the critical setting
  }
  // Try reading from persistent file (survives cold starts / cross-instance)
  try {
    const fileData = await readFile(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(fileData);
    const merged = { ...parsed, ...mem };
    globalThis.ttsSettings = merged;
    return merged;
  } catch {
    return mem;
  }
}

export async function GET() {
  const settings = await getSettings();
  const settingsPayload: Record<string, any> = {};

  // Include settings if available
  if (typeof settings.allowChatterVoice === 'boolean') {
    settingsPayload.allowChatterVoice = settings.allowChatterVoice;
  }
  if (settings.prefix) {
    settingsPayload.prefix = settings.prefix;
  }
  if (settings.channel) {
    settingsPayload.channel = settings.channel;
  }
  if (Array.isArray(settings.chatterVoices) && settings.chatterVoices.length > 0) {
    settingsPayload.chatterVoices = settings.chatterVoices;
  }
  // Pass hiddenSounds, customPresets, customSounds metadata, and leaderboard for chatter page
  if (Array.isArray(settings.hiddenSounds)) {
    settingsPayload.hiddenSounds = settings.hiddenSounds;
  }
  if (Array.isArray(settings.customPresets) && settings.customPresets.length > 0) {
    settingsPayload.customPresets = settings.customPresets;
  }
  if (Array.isArray(settings.customSounds) && settings.customSounds.length > 0) {
    settingsPayload.customSounds = settings.customSounds.map((cs: any) => ({
      id: cs.id, name: cs.name, hasDataUrl: true, mimeType: cs.mimeType, size: cs.size, createdAt: cs.createdAt,
    }));
  }
  if (settings.leaderboard && typeof settings.leaderboard === 'object' && (settings.leaderboard as any).chatters) {
    settingsPayload.leaderboard = settings.leaderboard;
  }

  // Step 1: Try reading from persistent cache file
  try {
    const cacheData = await readFile(VOICE_CACHE_PATH, 'utf-8');
    const cache: VoiceCacheFile = JSON.parse(cacheData);
    if (cache.voices && cache.voices.length > 0) {
      return NextResponse.json({
        voices: cache.voices,
        source: 'cache',
        updatedAt: cache.updatedAt,
        count: cache.voices.length,
        ...settingsPayload,
      });
    }
  } catch {
    // Cache file doesn't exist or is invalid — continue to live fetch
  }

  // Step 2: Try live fetch from Camb.ai
  const keys = getApiKeys();
  if (keys.length === 0) {
    // No API keys and no cache — return empty with settings
    return NextResponse.json({
      voices: [],
      source: 'none',
      message: 'No voices available yet. An admin needs to log in and load voices first.',
      ...settingsPayload,
    });
  }

  const allVoices: CachedVoice[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch('https://client.camb.ai/apis/list-voices', {
        method: 'GET',
        headers: { 'x-api-key': keys[i] },
      });
      if (!response.ok) continue;
      const voices = await response.json();
      for (const v of voices) {
        if (!seen.has(v.id)) {
          seen.add(v.id);
          allVoices.push({
            id: v.id,
            voice_name: v.voice_name,
            gender: v.gender,
          });
        }
      }
    } catch {
      // Silently skip failed keys
    }
  }

  // Save to cache for future requests
  if (allVoices.length > 0) {
    try {
      await writeFile(VOICE_CACHE_PATH, JSON.stringify({
        voices: allVoices,
        updatedAt: new Date().toISOString(),
        source: 'public-live-fetch',
      }), 'utf-8');
    } catch {
      // Non-critical
    }
  }

  return NextResponse.json({
    voices: allVoices,
    source: 'live',
    count: allVoices.length,
    ...settingsPayload,
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
