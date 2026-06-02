import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useReducedMotion } from 'motion/react';
import {
  Play, Trash2, RefreshCw, Heart, HeartOff, Radio, Mic2, SlidersHorizontal,
  Clock, Tv, MessageSquareText, Sparkles, Plus, X, Download, Upload,
  BarChart3, Volume2, UserCheck, Languages, Eye, Minimize2, Save, Search,
  LayoutGrid, Shield, Waves, Palette, SkipForward, Repeat, Volume, HelpCircle,
  AlertTriangle, UserX, Siren, Lock, Music,
  LogOut, Users, ShieldCheck, EyeOff, RotateCcw, Zap, Activity, Disc3, Wifi, WifiOff,
  Sun, Moon, Trophy, Terminal,
  AlertCircle, CheckCircle, Info, Copy, Share2, Shuffle, GripVertical,
  FileDown, FileJson, ArrowUpToLine, Volume1
} from 'lucide-react';
import { FXSettings, playAudioWithFX, PlayingAudioControl, DEFAULT_FX } from './utils/audioFX';
import HelpSystem from './components/HelpSystem';
import {
  spring, springBouncy, springGentle, springMicro,
  StaggerGroup, QueueItemMotion, ScalePop, SlideUp,
  FadeIn, Float, ScaleIn, AnimatedCounter, PulseRing,
  MotionToggle, MagneticButton,
  OrbitalLoader, ConsoleLine,
  PageEntrance, ParticleBurst, VoiceMorphText,
  QueueProgress, VirtualList, BackdropOverlay,
  Ripple, StatCelebration, SpeakingGlow
} from './components/MotionAnimations';
import { TwitchIRCClient } from './utils/twitchIRC';
import { CambVoice, generateBrowserTTS, fetchCambVoicesServer, fetchCambVoicesPublic, generateCambTTSServer, detectLanguage, resolveLanguage } from './utils/ttsEngines';
import { SOUND_LIBRARY, DEFAULT_SOUND_BASE_URL, SoundBite } from './utils/soundLibrary';
import {
  filterProfanity, detectSpam,
  getDefaultBannedWordsString, getSoundVolume, SoundVolumeConfig
} from './utils/abusePrevention';

type Engine = 'camb' | 'webspeech';
type RoleFilter = 'all' | 'subs_vip_mods' | 'mods_broadcaster' | 'broadcaster';

// Custom sound interface — defined OUTSIDE the component to avoid re-declaration on every render
// NOTE: dataUrl is OPTIONAL — the server returns metadata-only (no base64) in the main
// GET /api/settings response to keep it lightweight. The full dataUrl is fetched on-demand
// from GET /api/sfx-data when a sound needs to play, then cached in memory.
interface CustomSound {
  id: string;
  name: string;
  dataUrl?: string; // Optional — fetched on demand from /api/sfx-data
  hasDataUrl?: boolean; // Server signals that data exists on the server
  mimeType: string;
  size: number;
  createdAt: string;
}



interface QueueItem {
  id: string; user: string; engine: Engine; voice: string; fx: FXSettings; timestamp: Date; chunks: { type: 'text' | 'sfx'; content: string }[];
  cambKeyUsed?: string; // Which API key was used for this item's Camb.ai voice
  voiceDisplayName?: string; // Human-readable voice name for logging/display
}
interface UserMapping { username: string; engine: Engine; voice: string; preset: string; }
interface WordAlias { from: string; to: string; }
interface SavedPreset { name: string; fx: FXSettings; }
interface SoundAlert { word: string; url: string; volume: number; }

// Chatter-visible voice entry — stores curated voices that chatters can see and use
interface ChatterVoice {
  id: number;
  voice_name: string;
  gender: number;
  engine: 'camb' | 'browser';
}

// Leaderboard data structures
interface LeaderboardChatter { count: number; lastVoice: string; lastPreset: string; lastTimestamp?: number; }
interface LeaderboardData { chatters: Record<string, LeaderboardChatter>; voices: Record<string, number>; presets: Record<string, number>; }

// Toast notification types
interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}

// Extended preset descriptions shown in the chatter page
const PRESET_DESCRIPTIONS: Record<string, string> = {
  clean:      'Natural voice — no effects',
  helium:     'Tiny squeaky helium balloon voice',
  giganerd:   'Super nasally buzzing hyper-nerd voice',
  demon:      'Deep growling demonic voice with real reverb',
  robot:      'Classic Dalek 30Hz ring-modulator — dry & mechanical',
  alien:      'Pulsing alien transmission — ring mod + tremolo',
  megaphone:  'Blown-speaker loud PA system distortion',
  drunk:      'Wobbly pitch-and-volume slurred voice',
  underwater: 'Muffled deep-sea chorus + reverb',
  cave:       'Big stone cave — pitch down + cathedral reverb',
  echo:       'Huge open-air canyon multi-tap echo',
};

const PRESETS: Record<string, FXSettings> = {

  // ─── Clean ───────────────────────────────────────────────────
  // Flat — no effects. Always keep this as the zero baseline.
  clean: {
    pitch: 1.0, lowPassFreq: 0, highPassFreq: 0,
    distortionAmount: 0, robotFrequency: 0, robotMix: 0.5,
    megaphone: false, echoDelay: 0, echoFeedback: 0, echoMix: 0.4,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.0,
  },

  // ─── Helium ──────────────────────────────────────────────────
  // Pitch 1.62x triggers the automatic formant shift upward (>1.15 threshold)
  // which shifts the vocal resonances to match, making it sound genuinely
  // tiny rather than just fast. No other effects — keep it pure.
  helium: {
    pitch: 1.62, lowPassFreq: 0, highPassFreq: 0,
    distortionAmount: 0, robotFrequency: 0, robotMix: 0.5,
    megaphone: false, echoDelay: 0, echoFeedback: 0, echoMix: 0.4,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 0.88,
  },

  // ─── GigaNerd ────────────────────────────────────────────────
  // Pitch 1.32 lands in the nasally nerd register (below chipmunk, above normal).
  // HP 380Hz + LP 6500Hz creates a tight telephone-like nasal band.
  // 18Hz ring mod at low mix (0.22) adds a subtle but distinct buzz
  // without going full-robot. Light saturation (0.07) glues it together.
  giganerd: {
    pitch: 1.32, lowPassFreq: 6500, highPassFreq: 380,
    distortionAmount: 0.07, robotFrequency: 18, robotMix: 0.22,
    megaphone: false, echoDelay: 0, echoFeedback: 0, echoMix: 0.4,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.08,
  },

  // ─── Demon ───────────────────────────────────────────────────
  // Pitch 0.52 triggers downward formant shift (<0.85 threshold), making
  // vocals truly massive. LP 3500Hz warms the body. Hard-distortion at 0.28
  // adds grit without muddying. The REAL REVERB (reverbAmount 0.65) is what
  // makes this genuinely terrifying — previously it was just delay echo.
  demon: {
    pitch: 0.52, lowPassFreq: 3500, highPassFreq: 0,
    distortionAmount: 0.28, robotFrequency: 0, robotMix: 0.5,
    megaphone: false, echoDelay: 0.18, echoFeedback: 0.45, echoMix: 0.38,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0.65,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.1,
  },

  // ─── Robot ───────────────────────────────────────────────────
  // The original BBC Dalek used exactly 30Hz ring modulation.
  // This preset is intentionally dry (no reverb/chorus) — mechanical
  // and clinical. HP 80Hz removes mud. Bit crush 0.25 = metallic texture.
  // Robot and Alien must sound nothing alike — this stays purely dry.
  robot: {
    pitch: 1.0, lowPassFreq: 0, highPassFreq: 80,
    distortionAmount: 0.14, robotFrequency: 30, robotMix: 0.65,
    megaphone: false, echoDelay: 0, echoFeedback: 0, echoMix: 0.4,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0.25,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.05,
  },

  // ─── Alien ───────────────────────────────────────────────────
  // Distinguished from Robot by three things: (1) 55Hz carrier vs 30Hz =
  // different tonal quality. (2) Tremolo at 7Hz = pulsing energy burst
  // that sounds like a radio transmission. (3) Heavier bit crush = more
  // degraded digital texture. These three together = totally alien.
  alien: {
    pitch: 1.05, lowPassFreq: 0, highPassFreq: 100,
    distortionAmount: 0.15, robotFrequency: 55, robotMix: 0.62,
    megaphone: false, echoDelay: 0, echoFeedback: 0, echoMix: 0.4,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0.32,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0,
    tremoloSpeed: 7.0, tremoloDepth: 0.35, volume: 1.0,
  },

  // ─── Megaphone ───────────────────────────────────────────────
  // Megaphone flag applies the telephone bandpass (450–3200Hz).
  // Pitch 1.06 = nasal bark quality. Heavy distortion 0.28 = blown speaker.
  // No spatial effects — megaphone should sound close and aggressive.
  megaphone: {
    pitch: 1.06, lowPassFreq: 0, highPassFreq: 0,
    distortionAmount: 0.28, robotFrequency: 0, robotMix: 0.5,
    megaphone: true, echoDelay: 0, echoFeedback: 0, echoMix: 0.4,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.2,
  },

  // ─── Drunk ───────────────────────────────────────────────────
  // Two modulations working together: wobble (pitch LFO) for the slurred
  // word-to-word pitch variation, and tremolo (amplitude LFO at 1.8Hz) for
  // the unsteady volume wobble of someone who can't hold still. Together
  // they're convincing. Short echo (0.06s) = blurry drunk perception.
  drunk: {
    pitch: 0.9, lowPassFreq: 8000, highPassFreq: 0,
    distortionAmount: 0.04, robotFrequency: 0, robotMix: 0.5,
    megaphone: false, echoDelay: 0.06, echoFeedback: 0.08, echoMix: 0.14,
    wobbleSpeed: 3.8, wobbleDepth: 0.82, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0,
    tremoloSpeed: 1.8, tremoloDepth: 0.2, volume: 1.0,
  },

  // ─── Underwater ──────────────────────────────────────────────
  // Three things make this work: (1) LP 650Hz = heavy muffling (hearing
  // through water). (2) CHORUS at 0.38Hz / depth 0.88 = the lush detune
  // of sounds propagating through liquid — this was completely missing
  // before. (3) REVERB at 0.38 = diffuse wet acoustic space. Together
  // these three are unmistakably underwater.
  underwater: {
    pitch: 0.88, lowPassFreq: 650, highPassFreq: 0,
    distortionAmount: 0, robotFrequency: 0, robotMix: 0.5,
    megaphone: false, echoDelay: 0.05, echoFeedback: 0.06, echoMix: 0.1,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0.38, chorusDepth: 0.88, reverbAmount: 0.38,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.14,
  },

  // ─── Cave ────────────────────────────────────────────────────
  // Very different from Demon: cave is spatial/architectural, not gritty.
  // Heavy reverb (0.78) is the dominant effect — the actual acoustic space
  // of a large stone cavern. Pitch 0.78 adds depth without going demonic.
  // Long echo with moderate feedback = the cave's natural delay reflections.
  // Minimal distortion (0.05) — the cave should sound natural, not hellish.
  cave: {
    pitch: 0.78, lowPassFreq: 5500, highPassFreq: 0,
    distortionAmount: 0.05, robotFrequency: 0, robotMix: 0.5,
    megaphone: false, echoDelay: 0.3, echoFeedback: 0.46, echoMix: 0.42,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0.78,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.06,
  },

  // ─── Echo ────────────────────────────────────────────────────
  // Clean pitch, maximum delay effect. Long delay (0.38s) + high feedback
  // (0.58) + mix (0.52) through the 3-tap engine = three staggered echoes
  // for wide canyon ambience. Slight reverb (0.14) gives the tails a
  // natural diffuse tail rather than hard repeats.
  echo: {
    pitch: 1.0, lowPassFreq: 0, highPassFreq: 0,
    distortionAmount: 0, robotFrequency: 0, robotMix: 0.5,
    megaphone: false, echoDelay: 0.38, echoFeedback: 0.58, echoMix: 0.52,
    wobbleSpeed: 0, wobbleDepth: 0, bitCrush: 0,
    chorusRate: 0, chorusDepth: 0, reverbAmount: 0.14,
    tremoloSpeed: 0, tremoloDepth: 0, volume: 1.0,
  },

};

const DEFAULT_SFX: SoundAlert[] = [
  { word: '!coin', url: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-84.wav', volume: 0.5 },
  { word: '!horn', url: 'https://assets.mixkit.co/active_storage/sfx/2756/2756-84.wav', volume: 0.4 },
  { word: '!applause', url: 'https://assets.mixkit.co/active_storage/sfx/2813/2813-84.wav', volume: 0.5 },
];

const PHRASES = [
  'Have some goddamn faith, Arthur!', 'We just need one more score, then Tahiti.',
  'Lumbago is a very serious condition.', 'I have a plan, you just need to trust me!',
  'Outlaws for life!', 'Welcome to the stream, chat!', 'Let\'s go!', 'That was absolutely insane!',
];

function escapeRegex(v: string) { return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }

const getSoundSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '_');

// Parse inline sound effects — supports BOTH built-in sounds and custom uploaded sounds
// Built-in sounds use SOUND_LIBRARY, custom sounds use dataUrl for playback
// Custom sounds are prefixed with "custom:" in the chunk content for identification
// Usage: (sound_name) in text — e.g. "Hello (bruh) everyone (vine_boom)" → text + sfx + text + sfx
function parseInlineSfx(text: string, customSoundList?: { id: string; name: string; dataUrl?: string; hasDataUrl?: boolean; mimeType: string; size: number; createdAt: string }[]): { type: 'text' | 'sfx'; content: string }[] {
  const chunks: { type: 'text' | 'sfx'; content: string }[] = [];
  const regex = /\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;
  let sfxCount = 0;

  // Build a fresh merged slug map each time (no stale global state)
  const builtInSlugMap = new Map(SOUND_LIBRARY.map(s => [getSoundSlug(s.name), s.name]));
  const customSlugMap = new Map<string, string>();
  if (customSoundList && customSoundList.length > 0) {
    for (const cs of customSoundList) {
      const slug = getSoundSlug(cs.name);
      customSlugMap.set(slug, cs.name);
    }
  }
  
  while ((match = regex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index).trim();
    if (textBefore) chunks.push({ type: 'text', content: textBefore });
    
    if (sfxCount < 20) {
      const sfxNames = match[1].split(/\s+/).map(s => s.trim()).filter(s => s.length > 0);
      for (const name of sfxNames) {
        if (sfxCount >= 20) break;
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        // Custom sounds take priority (admin uploaded), then built-in
        if (customSlugMap.has(slug)) {
          chunks.push({ type: 'sfx', content: `custom:${customSlugMap.get(slug)}` });
          sfxCount++;
        } else if (builtInSlugMap.has(slug)) {
          chunks.push({ type: 'sfx', content: builtInSlugMap.get(slug)! });
          sfxCount++;
        }
      }
    }
    lastIndex = regex.lastIndex;
  }
  
  const textAfter = text.slice(lastIndex).trim();
  if (textAfter) chunks.push({ type: 'text', content: textAfter });
  
  return chunks;
}

// ═══════════════════════════════════════════════════════════
// VOICE ALIAS SYSTEM — Underscore voice names for chat commands
// Chatters type: !tts Voice_Name: message
// "Google US English" → "Google_US_English"
// ═══════════════════════════════════════════════════════════

/** Convert a voice name to its underscore alias for chat commands */
function voiceNameToAlias(name: string): string {
  return name.replace(/[\s-]+/g, '_');
}

/** Result of looking up a voice by its underscore alias */
interface VoiceLookupResult {
  found: boolean;
  engine: Engine;
  voice: string; // Camb voice ID as string, or browser voice name
  voiceDisplayName: string;
}

/**
 * Look up a voice by its underscore alias.
 * Searches both Camb.ai voices and browser/system voices.
 * Supports: exact alias match, partial match, and voice ID (numbers).
 */
function lookupVoiceByAlias(
  alias: string,
  cambVoices: CambVoice[],
  browserVoices: SpeechSynthesisVoice[],
  currentEngine: Engine,
  currentVoiceId: number,
  currentBrowserVoice: string,
): VoiceLookupResult {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) return { found: false, engine: currentEngine, voice: currentEngine === 'camb' ? String(currentVoiceId) : currentBrowserVoice, voiceDisplayName: '' };

  // 1. Try exact numeric voice ID (Camb.ai)
  if (/^\d+$/.test(normalizedAlias)) {
    const vid = Number(normalizedAlias);
    const match = cambVoices.find(v => v.id === vid);
    if (match) return { found: true, engine: 'camb', voice: String(vid), voiceDisplayName: match.voice_name };
  }

  // Normalize: treat hyphens and underscores as equivalent (users type both)
  const aliasLower = normalizedAlias.toLowerCase().replace(/-/g, '_');
  const cambExact = cambVoices.find(v => voiceNameToAlias(v.voice_name).toLowerCase() === aliasLower);
  if (cambExact) return { found: true, engine: 'camb', voice: String(cambExact.id), voiceDisplayName: cambExact.voice_name };

  // 3. Try exact alias match on browser voices
  const browserExact = browserVoices.find(v => voiceNameToAlias(v.name).toLowerCase() === aliasLower);
  if (browserExact) return { found: true, engine: 'webspeech', voice: browserExact.name, voiceDisplayName: browserExact.name };

  // 4. Try partial match on Camb.ai voice names (alias starts with query, or query starts with alias)
  // Require minimum 3 chars to avoid single-letter matches triggering random voices
  const cambPartial = cambVoices.find(v => {
    const vAlias = voiceNameToAlias(v.voice_name).toLowerCase();
    return (aliasLower.length >= 3 && vAlias.startsWith(aliasLower)) ||
           (vAlias.length >= 3 && aliasLower.startsWith(vAlias));
  });
  if (cambPartial) return { found: true, engine: 'camb', voice: String(cambPartial.id), voiceDisplayName: cambPartial.voice_name };

  // 5. Try partial match on browser voices
  const browserPartial = browserVoices.find(v => {
    const vAlias = voiceNameToAlias(v.name).toLowerCase();
    return (aliasLower.length >= 3 && vAlias.startsWith(aliasLower)) ||
           (vAlias.length >= 3 && aliasLower.startsWith(vAlias));
  });
  if (browserPartial) return { found: true, engine: 'webspeech', voice: browserPartial.name, voiceDisplayName: browserPartial.name };

  // 6. Try contains match on Camb.ai voice names (for fuzzy matching like "dutch" in "dutch_van_der_linde")
  if (aliasLower.length >= 3) {
    const cambContains = cambVoices.find(v => {
      const vAlias = voiceNameToAlias(v.voice_name).toLowerCase();
      return vAlias.includes(aliasLower) || aliasLower.includes(vAlias);
    });
    if (cambContains) return { found: true, engine: 'camb', voice: String(cambContains.id), voiceDisplayName: cambContains.voice_name };

    const browserContains = browserVoices.find(v => {
      const vAlias = voiceNameToAlias(v.name).toLowerCase();
      return vAlias.includes(aliasLower) || aliasLower.includes(vAlias);
    });
    if (browserContains) return { found: true, engine: 'webspeech', voice: browserContains.name, voiceDisplayName: browserContains.name };
  }

  // Not found
  return { found: false, engine: currentEngine, voice: currentEngine === 'camb' ? String(currentVoiceId) : currentBrowserVoice, voiceDisplayName: normalizedAlias };
}

/**
 * Parse a TTS message for the modulator preset prefix.
 * Format: "#PresetName# message text" or "#PresetName#VoiceName: message text"
 * The #PresetName# must appear at the very start of the text (after prefix removal).
 * Preset names are case-insensitive and match against PRESETS and customPresets.
 * Returns { presetName, remainingText } — presetName is empty if no preset was specified.
 */
function parsePresetPrefix(text: string, availablePresets: string[]): { presetName: string; remainingText: string } {
  // Match #WordChars# at the start of text (letters, digits, underscores, hyphens)
  const match = text.match(/^#([A-Za-z0-9_-]+)#\s*(.*)$/);
  if (match) {
    const candidate = match[1].toLowerCase();
    // Find a matching preset (case-insensitive)
    const found = availablePresets.find(p => p.toLowerCase() === candidate);
    if (found) {
      return { presetName: found, remainingText: match[2].trim() };
    }
    // No matching preset — treat the # as regular text (don't strip it)
  }
  return { presetName: '', remainingText: text };
}

/**
 * Parse a TTS message for the voice selection prefix.
 * Format: "VoiceName: message text" or "VoiceName:message text"
 * Returns { voiceAlias, messageText } — voiceAlias is empty if no voice was specified.
 */
function parseVoicePrefix(text: string): { voiceAlias: string; messageText: string } {
  // Match: WordCharacters (with underscores & hyphens): followed by message
  // The voice name must be at the start, use underscores or hyphens for spaces, and end with a colon
  const match = text.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
  if (match) {
    return { voiceAlias: match[1], messageText: match[2].trim() };
  }
  return { voiceAlias: '', messageText: text };
}

function Toggle({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return <MotionToggle enabled={enabled} onClick={onClick} />;
}

function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-stone-100 text-stone-600 border-stone-200/80',
    red: 'bg-red-50 text-red-700 border-red-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${colors[color]}`}>{children}</span>;
}

function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`classic-card p-6 ${className}`} style={style}>{children}</div>;
}

// Deferred mount: renders children after 1 animation frame to avoid blocking tab switch
function DeferredMount({ children, delay = 1 }: { children: React.ReactNode; delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const id = requestAnimationFrame(() => {
      if (delay > 1) {
        timeoutId = setTimeout(() => setShow(true), delay);
      } else {
        setShow(true);
      }
    });
    return () => {
      cancelAnimationFrame(id);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [delay]);
  if (!show) return <div className="min-h-[200px]" />; // lightweight placeholder
  return <>{children}</>;
}

const Slider = memo(function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="slider-section rounded-xl p-4 border transition-all" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold uppercase tracking-wider" style={{color: 'var(--text-secondary)'}}>{label}</span>
        <span className="text-sm font-mono font-bold" style={{color: 'var(--text-primary)'}}>{value.toFixed(step < 1 ? 2 : 0)}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-red-500" />
    </div>
  );
});

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM — Feature 1
// ═══════════════════════════════════════════════════════════
function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  const iconMap = {
    success: <CheckCircle size={16} />,
    error: <AlertCircle size={16} />,
    info: <Info size={16} />,
    warning: <AlertTriangle size={16} />,
  };
  const colorMap = {
    success: { border: '#059669', bg: 'rgba(5,150,105,0.08)', text: '#059669' },
    error: { border: '#dc3535', bg: 'rgba(220,53,53,0.08)', text: '#dc3535' },
    info: { border: '#2563eb', bg: 'rgba(37,99,235,0.08)', text: '#2563eb' },
    warning: { border: '#d97706', bg: 'rgba(217,119,6,0.08)', text: '#d97706' },
  };
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm" style={{ pointerEvents: 'none' }}>
      <AnimatePresence>
        {toasts.map(t => {
          const c = colorMap[t.type];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 80, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.85, height: 0, marginBottom: 0 }}
              transition={{ ...springBouncy, duration: 0.3 }}
              style={{ pointerEvents: 'auto', borderLeft: `4px solid ${c.border}`, background: 'var(--bg-surface)', boxShadow: '0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px var(--border-subtle)' }}
              className="rounded-xl px-4 py-3 flex items-start gap-3"
            >
              <span style={{ color: c.text, marginTop: 1 }}>{iconMap[t.type]}</span>
              <span className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{t.message}</span>
              <button onClick={() => onDismiss(t.id)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer mt-0.5"><X size={14} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PRESET SHARE MODAL — Feature 9
// ═══════════════════════════════════════════════════════════
function PresetShareModal({ isOpen, onClose, preset, onImport }: {
  isOpen: boolean; onClose: () => void;
  preset: { name: string; fx: FXSettings } | null;
  onImport: (code: string) => string | null;
}) {
  const [importCode, setImportCode] = useState('');
  const [importError, setImportError] = useState('');
  const [copied, setCopied] = useState(false);
  const shareCode = useMemo(() => {
    if (!preset) return '';
    try {
      const json = JSON.stringify({ n: preset.name, f: preset.fx });
      return btoa(encodeURIComponent(json));
    } catch { return ''; }
  }, [preset]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(shareCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  const doImport = () => {
    const err = onImport(importCode.trim());
    if (err) { setImportError(err); } else { setImportCode(''); setImportError(''); onClose(); }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <BackdropOverlay isOpen onClose={onClose}>
          <ScaleIn>
            <div className="classic-card p-8 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}><Share2 size={20} /></div>
                  <div>
                    <h2 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>Share Preset</h2>
                    <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-tertiary)' }}>{preset?.name || 'Export / Import'}</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-stone-100 transition cursor-pointer" style={{ color: 'var(--text-tertiary)' }}><X size={18} /></button>
              </div>

              {preset && (
                <div className="mb-6">
                  <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Share Code</div>
                  <div className="rounded-lg p-3 font-mono text-xs break-all select-all" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>{shareCode}</div>
                  <button onClick={copyCode} className="btn-classic-secondary text-xs mt-3 w-full py-2.5 flex items-center justify-center gap-2">
                    {copied ? <><CheckCircle size={14} style={{ color: '#059669' }} /> Copied!</> : <><Copy size={14} /> Copy to Clipboard</>}
                  </button>
                </div>
              )}

              <div className="border-t pt-5" style={{ borderColor: 'var(--border-default)' }}>
                <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Import Preset</div>
                <div className="flex gap-2">
                  <input value={importCode} onChange={e => { setImportCode(e.target.value); setImportError(''); }} placeholder="Paste share code..." className="flex-1 classic-input text-xs" />
                  <button onClick={doImport} className="btn-classic-primary text-xs px-4">Import</button>
                </div>
                {importError && <p className="text-xs mt-2 font-bold" style={{ color: '#dc3535' }}>{importError}</p>}
              </div>
            </div>
          </ScaleIn>
        </BackdropOverlay>
      )}
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════
// LOGIN SCREEN — Server-side auth with admin + chatter paths
// ═══════════════════════════════════════════════════════════
function LoginScreen({ onAdminLogin, onChatterView }: { onAdminLogin: (username: string) => void; onChatterView: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onAdminLogin(data.username);
      } else {
        setError(data.error || 'Login failed');
        setPassword('');
      }
    } catch {
      setError('Network error — check your connection');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageEntrance>
    <div className="min-h-screen font-sf flex flex-col" style={{background: 'var(--bg-base)', color: 'var(--text-primary)'}}>
      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={springGentle}
        style={{background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)'}}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-2.5">
          <img src="/images/logo.png" alt="CHATGBT" className="h-9 w-auto" />
          <div className="flex flex-col">
            <h1 className="text-xl font-black tracking-tight leading-none flex items-center">
              <span style={{color: 'var(--text-primary)'}}>CHAT</span>
              <span className="chatgbt-gradient-text">GBT</span>
            </h1>
            <span className="text-[7px] font-bold tracking-[0.18em] uppercase mt-0.5" style={{color: 'var(--text-tertiary)'}}>Twitch Text to Speech</span>
          </div>
        </div>
      </motion.header>

      {/* Login content */}
      <div className="flex-1 flex items-center justify-center py-12" style={{paddingLeft: 'var(--page-padding)', paddingRight: 'var(--page-padding)'}}>
        <div className="w-full max-w-md mx-auto">
          {/* Ambient glow behind the card */}
          <div className="relative">
            <div className="absolute -inset-8 rounded-3xl opacity-30 blur-2xl pointer-events-none" style={{background: 'radial-gradient(ellipse at center, rgba(220,53,53,0.15) 0%, transparent 70%)'}} />
            <motion.div
              className="classic-card p-10 text-center relative"
              initial={{ opacity: 0, y: 40, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...springGentle, delay: 0.15 }}
            >
              <motion.div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{background: 'rgba(220,53,53,0.08)', color: '#dc3535', boxShadow: 'inset 0 0 0 1px rgba(220,53,53,0.1)'}}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ ...springBouncy, delay: 0.3 }}
              >
                <ShieldCheck size={32} />
              </motion.div>
              <motion.h2
                className="text-xl font-black mb-2"
                style={{color: 'var(--text-primary)'}}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springGentle, delay: 0.35 }}
              >Admin Login</motion.h2>
              <motion.p
                className="text-sm mb-8"
                style={{color: 'var(--text-tertiary)'}}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >Enter your credentials to access the Control Room.</motion.p>
              <form onSubmit={handleSubmit} className="space-y-3">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.4 }}>
                <input
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError(''); }}
                  placeholder="Username"
                  autoFocus
                  autoComplete="username"
                  className="w-full classic-input text-sm"
                />
                </motion.div>
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.47 }}>
                <input
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="Password"
                  autoComplete="current-password"
                  className="w-full classic-input text-sm"
                />
                </motion.div>
                {error && <SlideUp><p className="text-xs font-bold" style={{color: '#dc3535'}}>{error}</p></SlideUp>}
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.55 }}>
                <MagneticButton strength={0.15}>
                <motion.button type="submit" disabled={loading} className="w-full btn-classic-primary py-3.5 disabled:opacity-50 text-sm"
                  whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.97, y: 0.5 }} transition={springBouncy}
                >
                  {loading ? <span className="flex items-center justify-center gap-2"><OrbitalLoader size={16} color="#fff" /> Signing in...</span> : <span className="flex items-center justify-center gap-2"><Lock size={14} /> Sign In</span>}
                </motion.button>
                </MagneticButton>
                </motion.div>
              </form>

              {/* Divider */}
              <motion.div
                className="flex items-center gap-3 my-7"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <div className="flex-1 h-px" style={{background: 'var(--border-default)'}} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{color: 'var(--text-muted)'}}>or</span>
                <div className="flex-1 h-px" style={{background: 'var(--border-default)'}} />
              </motion.div>

              {/* Chatter button */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: 0.65 }}
              >
                <motion.button
                  onClick={onChatterView}
                  className="w-full py-3.5 rounded-xl text-sm font-bold cursor-pointer flex items-center justify-center gap-2"
                  style={{background: 'rgba(37,99,235,0.08)', color: '#2563eb', border: '1.5px solid rgba(37,99,235,0.12)'}}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springBouncy}
                >
                  <Users size={16} />
                  I am a Chatter
                </motion.button>
                <motion.p
                  className="text-[10px] mt-3"
                  style={{color: 'var(--text-muted)'}}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 }}
                >Browse voices and learn how to use TTS in chat.</motion.p>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
    </PageEntrance>
  );
}

// ═══════════════════════════════════════════════════════════
// CHATTER VIEW — Read-only page for chat viewers (no auth needed)
// This page is PUBLIC — it contains NO API keys, NO admin controls.
// Chatters can only browse voices, preview sounds, and learn how to use TTS.
// ═══════════════════════════════════════════════════════════
function ChatterView({ channel, sfx, prefix, allowChatterVoice: allowChatterVoiceProp, chatterVoices: chatterVoicesProp, hiddenSounds, customPresets: customPresetsProp, customSounds: customSoundsProp, leaderboard: leaderboardProp, onBack }: {
  channel: string;
  sfx: SoundAlert[];
  prefix: string;
  allowChatterVoice: boolean;
  chatterVoices: ChatterVoice[];
  hiddenSounds?: string[];
  customPresets?: SavedPreset[];
  customSounds?: CustomSound[];
  leaderboard?: LeaderboardData;
  onBack: () => void;
}) {
  // Server settings fetched from public-voices endpoint (same request as voice data)
  const [serverSettings, setServerSettings] = useState<{ allowChatterVoice: boolean; prefix: string; channel: string; chatterVoices?: ChatterVoice[]; hiddenSounds?: string[]; customPresets?: SavedPreset[]; customSounds?: CustomSound[]; leaderboard?: LeaderboardData } | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [cambVoices, setCambVoices] = useState<{ id: number; voice_name: string; gender: number }[]>([]);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesSource, setVoicesSource] = useState<string>('');
  const [soundSearch, setSoundSearch] = useState('');
  const [soundCategory, setSoundCategory] = useState<string>('all');
  const [playingSound, setPlayingSound] = useState<string | null>(null);
  const soundAudioRef = useRef<HTMLAudioElement | null>(null);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [cheatsheetSearch, setCheatsheetSearch] = useState('');
  const favs = useMemo(() => { try { const f = JSON.parse(localStorage.getItem('favs') || '[]'); return Array.isArray(f) ? f : []; } catch { return []; } }, []);

  // Use server settings if available, otherwise fall back to prop
  const allowChatterVoice = serverSettings?.allowChatterVoice ?? allowChatterVoiceProp;
  const activePrefix = serverSettings?.prefix ?? prefix;
  const _activeChannel = serverSettings?.channel ?? channel;
  void _activeChannel;
  const activeHiddenSounds = serverSettings?.hiddenSounds ?? hiddenSounds ?? [];

  // Fetch Camb.ai voices + settings from public endpoint + browser voices on mount
  // The public-voices endpoint now also returns allowChatterVoice, prefix, channel
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let gotSettings = false;

      // Fetch Camb.ai voices AND settings from public API (no auth required)
      try {
        const cambData = await fetchCambVoicesPublic();
        if (!cancelled) {
          setCambVoices(cambData.voices);
          setVoicesSource(cambData.source || '');
          // Extract settings from the same response
          if (typeof cambData.allowChatterVoice === 'boolean') {
            gotSettings = true;
            setServerSettings({
              allowChatterVoice: cambData.allowChatterVoice,
              prefix: cambData.prefix || '!tts',
              channel: cambData.channel || '',
              chatterVoices: Array.isArray(cambData.chatterVoices) ? cambData.chatterVoices : undefined,
              hiddenSounds: Array.isArray(cambData.hiddenSounds) ? cambData.hiddenSounds : undefined,
              customPresets: Array.isArray(cambData.customPresets) ? cambData.customPresets : undefined,
              customSounds: Array.isArray(cambData.customSounds) ? cambData.customSounds : undefined,
              leaderboard: cambData.leaderboard && typeof cambData.leaderboard === 'object' && cambData.leaderboard.chatters ? cambData.leaderboard : undefined,
            });
          }
        }
      } catch {
        if (!cancelled) setVoicesSource('error');
      }

      // Fallback: Also try /api/settings directly — on Vercel, different serverless
      // functions may not share globalThis or /tmp, so public-voices might miss settings.
      // The /api/settings endpoint is more likely to be on the same instance that received
      // the admin's PUT, so it may have fresher data.
      if (!cancelled && !gotSettings) {
        try {
          const settingsRes = await fetch('/api/settings', { credentials: 'include' });
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            if (typeof settingsData.allowChatterVoice === 'boolean') {
              setServerSettings({
                allowChatterVoice: settingsData.allowChatterVoice,
                prefix: settingsData.prefix || '!tts',
                channel: settingsData.channel || '',
                chatterVoices: Array.isArray(settingsData.chatterVoices) ? settingsData.chatterVoices : undefined,
                hiddenSounds: Array.isArray(settingsData.hiddenSounds) ? settingsData.hiddenSounds : undefined,
                customPresets: Array.isArray(settingsData.customPresets) ? settingsData.customPresets : undefined,
                customSounds: Array.isArray(settingsData.customSounds) ? settingsData.customSounds : undefined,
                leaderboard: settingsData.leaderboard && typeof settingsData.leaderboard === 'object' && settingsData.leaderboard.chatters ? settingsData.leaderboard : undefined,
              });
            }
          }
        } catch {
          // Non-critical fallback
        }
      }

      if (!cancelled) setSettingsLoaded(true);

      // Load browser/system voices
      const loadBrowserVoices = () => {
        if (!cancelled) {
          const sv = window.speechSynthesis.getVoices();
          if (sv.length > 0) setBrowserVoices(sv);
        }
      };
      loadBrowserVoices();
      window.speechSynthesis?.addEventListener('voiceschanged', loadBrowserVoices);

      if (!cancelled) setVoicesLoading(false);
      return () => { window.speechSynthesis?.removeEventListener('voiceschanged', loadBrowserVoices); };
    })();
    return () => { cancelled = true; };
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (soundAudioRef.current) {
        try { soundAudioRef.current.pause(); soundAudioRef.current.src = ''; } catch {}
        soundAudioRef.current = null;
      }
    };
  }, []);

  // Play a sound preview from the sound library
  const previewSound = (sound: SoundBite) => {
    // Stop any currently playing preview
    if (soundAudioRef.current) {
      try { soundAudioRef.current.pause(); soundAudioRef.current.src = ''; } catch {}
      soundAudioRef.current = null;
    }
    if (playingSound === sound.name) {
      setPlayingSound(null);
      return;
    }

    const mp3Url = (sound as any).mp3Url;
    if (!mp3Url) return;

    const audio = new Audio(mp3Url);
    audio.volume = 0.7;
    audio.onended = () => setPlayingSound(null);
    audio.onerror = () => setPlayingSound(null);
    soundAudioRef.current = audio;
    setPlayingSound(sound.name);
    audio.play().catch(() => setPlayingSound(null));
  };

  // Play a custom sound preview — fetches dataUrl on-demand from /api/sfx-data
  const customSoundCache = useRef<Map<string, string>>(new Map());
  const previewCustomSound = async (cs: CustomSound) => {
    if (soundAudioRef.current) {
      try { soundAudioRef.current.pause(); soundAudioRef.current.src = ''; } catch {}
      soundAudioRef.current = null;
    }
    if (playingSound === cs.name) {
      setPlayingSound(null);
      return;
    }
    // Check cache first
    let dataUrl = customSoundCache.current.get(cs.name) || cs.dataUrl;
    if (!dataUrl) {
      try {
        const res = await fetch(`/api/sfx-data?id=${encodeURIComponent(cs.id)}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.dataUrl) {
            dataUrl = data.dataUrl;
            customSoundCache.current.set(cs.name, dataUrl);
          }
        }
      } catch { return; }
    }
    if (!dataUrl) return;
    const audio = new Audio(dataUrl);
    audio.volume = 0.7;
    audio.onended = () => setPlayingSound(null);
    audio.onerror = () => setPlayingSound(null);
    soundAudioRef.current = audio;
    setPlayingSound(cs.name);
    audio.play().catch(() => setPlayingSound(null));
  };

  // Leaderboard: use server-fetched if available, otherwise prop
  const activeLeaderboard = serverSettings?.leaderboard ?? leaderboardProp ?? { chatters: {}, voices: {}, presets: {} };

  // Combine voices: favorites first, then alphabetical
  // If the admin has curated chatterVoices, only show those voices.
  // If chatterVoices is empty, show all voices (backward compatible).
  const activeChatterVoices = serverSettings?.chatterVoices ?? chatterVoicesProp;
  const hasCuratedVoices = activeChatterVoices && activeChatterVoices.length > 0;

  // Custom presets from admin (server or prop)
  const activeCustomPresets = serverSettings?.customPresets ?? customPresetsProp ?? [];

  const allVoices = (() => {
    if (hasCuratedVoices) {
      // Only show curated voices — filter from both Camb.ai and browser lists
      const curatedCambIds = new Set(activeChatterVoices!.filter(v => v.engine === 'camb').map(v => v.id));
      const curatedBrowserNames = new Set(activeChatterVoices!.filter(v => v.engine === 'browser').map(v => v.voice_name));
      return [
        ...cambVoices.filter(v => curatedCambIds.has(v.id)).map(v => ({ name: v.voice_name, alias: voiceNameToAlias(v.voice_name), id: v.id, isFav: favs.includes(v.id), engine: 'camb' as const, gender: v.gender })),
        ...browserVoices.filter(v => curatedBrowserNames.has(v.name)).map(v => ({ name: v.name, alias: voiceNameToAlias(v.name), id: -1, isFav: false, engine: 'webspeech' as const, gender: -1 })),
      ].sort((a, b) => (b.isFav ? 1 : 0) - (a.isFav ? 1 : 0) || a.name.localeCompare(b.name));
    }
    // No curated list — show all voices
    return [
      ...cambVoices.map(v => ({ name: v.voice_name, alias: voiceNameToAlias(v.voice_name), id: v.id, isFav: favs.includes(v.id), engine: 'camb' as const, gender: v.gender })),
      ...browserVoices.map(v => ({ name: v.name, alias: voiceNameToAlias(v.name), id: -1, isFav: false, engine: 'webspeech' as const, gender: -1 })),
    ].sort((a, b) => (b.isFav ? 1 : 0) - (a.isFav ? 1 : 0) || a.name.localeCompare(b.name));
  })();

  const filteredVoices = allVoices.filter(v =>
    v.name.toLowerCase().includes(voiceSearch.toLowerCase()) ||
    v.alias.toLowerCase().includes(voiceSearch.toLowerCase())
  );

  // Sound library filtering — exclude sounds hidden by admin
  const hiddenSet = new Set(activeHiddenSounds || []);
  // Custom sounds: use server-fetched if available, otherwise prop
  const activeCustomSounds = (serverSettings?.customSounds || customSoundsProp || []).filter(cs => !hiddenSet.has(cs.name));
  const filteredCustomSounds = activeCustomSounds.filter(cs => {
    const matchesSearch = cs.name.toLowerCase().includes(soundSearch.toLowerCase());
    const matchesCategory = soundCategory === 'all' || soundCategory === 'Custom';
    return matchesSearch && matchesCategory;
  });
  const categories = ['all', ...Array.from(new Set(SOUND_LIBRARY.filter(s => !hiddenSet.has(s.name)).map(s => s.category))), ...(activeCustomSounds.length > 0 ? ['Custom'] : [])];
  const filteredSounds = SOUND_LIBRARY.filter(s => {
    if (hiddenSet.has(s.name)) return false; // Hide from chatters
    const matchesSearch = s.name.toLowerCase().includes(soundSearch.toLowerCase()) ||
      s.category.toLowerCase().includes(soundSearch.toLowerCase());
    const matchesCategory = soundCategory === 'all' || s.category === soundCategory;
    return matchesSearch && matchesCategory;
  });

  const cmd = activePrefix || '!tts';

  // Step labels for the how-to section
  const steps = [
    { num: 1, title: 'Send a TTS Message', desc: 'Type the TTS command followed by your message in Twitch chat. The streamer controls the command prefix, but it is usually !tts. Your message will be read aloud on stream using the selected AI voice.', example: `${cmd} Hello everyone, welcome to the stream!` },
    { num: 2, title: 'Apply a Voice Modulator (Optional)', desc: 'Add a voice modulator preset to your message using the # symbol. Put the preset name between two # signs at the start of your message. Available presets: Clean, Helium, GigaNerd, Demon, Robot, Alien, Megaphone, Drunk, Underwater, Cave, and Echo. You can combine a modulator with a voice selection.', example: `${cmd} #GigaNerd# Hello from the funny voice!` },
    { num: 3, title: 'Choose a Voice (Optional)', desc: 'If the streamer has enabled voice selection, you can pick a specific voice by typing the voice name with underscores instead of spaces, followed by a colon, then your message. You can also use the numeric voice ID for precision. Combine with a modulator for maximum effect.', example: `${cmd} #Helium# Arthur_Morgan: I have a plan, trust me` },
    { num: 4, title: 'Add Sound Effects', desc: 'Insert meme sounds directly into your message by putting the sound name in parentheses. The TTS will read your text, play the sound, then continue reading. You can add up to 20 sound effects in a single message. Browse the sound list below for all available sounds.', example: `${cmd} #Demon# Watch out (bruh) that was close (vine_boom)` },
    { num: 5, title: 'Use Trigger Commands', desc: 'Some sounds are mapped to quick trigger commands. Just type the command in chat (no message needed) and the sound plays instantly. These are set up by the streamer and shown in the SFX Trigger Words section below.', example: `!coin` },
  ];

  return (
    <div className="min-h-screen font-sf flex flex-col" style={{background: 'var(--bg-base)', color: 'var(--text-primary)'}}>
      {/* Header */}
      <header style={{background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)'}}>
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-4 sm:py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src="/images/logo.png" alt="CHATGBT" className="h-7 sm:h-9 w-auto" />
              <div className="flex flex-col">
                <h1 className="text-lg sm:text-xl font-black tracking-tight leading-none flex items-center">
                  <span style={{color: 'var(--text-primary)'}}>CHAT</span>
                  <span className="chatgbt-gradient-text">GBT</span>
                </h1>
                <span className="text-[8px] sm:text-[9px] font-bold tracking-[0.15em] uppercase mt-0.5" style={{color: 'var(--text-tertiary)'}}>TTS for {channel || 'your channel'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <motion.button
                onClick={() => setCheatsheetOpen(true)}
                className="btn-classic-secondary text-xs py-2 px-4 flex items-center gap-1.5"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                transition={springMicro}
              >
                <Terminal size={12} /> Cheatsheet
              </motion.button>
              <motion.button
                onClick={onBack}
                className="btn-classic-secondary text-xs py-2 px-4 flex items-center gap-1.5"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                transition={springMicro}
              >
                <Lock size={12} /> Admin Login
              </motion.button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-8 flex-1 w-full">
        {/* How to Use TTS — Detailed Step-by-Step */}
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background: 'rgba(220,53,53,0.08)', color: '#dc3535', boxShadow: 'inset 0 0 0 1px rgba(220,53,53,0.1)'}}><MessageSquareText size={18} /></div>
            <div>
              <h2 className="font-bold text-lg" style={{color: 'var(--text-primary)'}}>How to Use TTS</h2>
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{color: 'var(--text-tertiary)'}}>Step-by-step guide</p>
            </div>
          </div>
          <StaggerGroup className="space-y-4" delay={0.08}>
            {steps.map((step) => (
              <motion.div
                key={step.num}
                className="rounded-xl p-5 border transition-all duration-200"
                style={{background: 'var(--bg-inset)', borderColor: 'var(--border-subtle)'}}
                whileHover={{ scale: 1.005, borderColor: 'rgba(220,53,53,0.15)', boxShadow: '0 2px 12px rgba(220,53,53,0.06)' }}
                transition={springMicro}
              >
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0" style={{background: 'rgba(220,53,53,0.1)', color: '#dc3535', border: '1px solid rgba(220,53,53,0.15)'}}>{step.num}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold mb-1.5" style={{color: 'var(--text-primary)'}}>{step.title}</h3>
                    <p className="text-xs leading-relaxed mb-3" style={{color: 'var(--text-secondary)'}}>{step.desc}</p>
                    <code className="text-[11px] font-mono px-3 py-2 rounded-lg block break-all" style={{background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-default)'}}>{step.example}</code>
                  </div>
                </div>
              </motion.div>
            ))}
          </StaggerGroup>
          {allowChatterVoice && (
            <motion.div
              className="mt-5 rounded-xl p-5 border"
              style={{background: 'linear-gradient(to right, var(--dm-grad-blue-from), var(--dm-grad-purple-to))', borderColor: 'var(--dm-grad-blue-border)'}}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, ...springGentle }}
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-blue-900 mb-2">Voice Name Tips</h3>
              <ul className="text-xs text-blue-700 space-y-1.5 list-disc list-inside">
                <li>Replace spaces with underscores: <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>Arthur Morgan</code> becomes <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>Arthur_Morgan</code></li>
                <li>You can use partial names: <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>Dutch</code> will match <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>Dutch_Van_Der_Linde</code></li>
                <li>Numeric voice IDs work too: <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>{cmd} 147320: message</code></li>
                <li>Sound names also use underscores: <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>Vine Boom</code> becomes <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>vine_boom</code></li>
              </ul>
              <h3 id="chatter-section-presets" className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2 mt-4">Voice Modulator Presets</h3>
              <p className="text-xs text-amber-700 mb-2">Use <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>#PresetName#</code> at the start of your message to apply a voice effect. All presets are available unless the streamer has restricted them:</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                {Object.entries(PRESET_DESCRIPTIONS).map(([name, desc]) => (
                  <motion.div key={name} className="rounded-lg px-2.5 py-2.5 border" style={{background: 'var(--dm-btn-secondary-bg)', borderColor: 'var(--border-default)'}} whileHover={{ scale: 1.04, borderColor: 'rgba(217,119,6,0.3)' }} transition={springMicro}>
                    <code className="font-mono font-bold text-amber-800 text-[10px]">#{name}#</code>
                    <p className="text-[9px] text-amber-600 mt-0.5 leading-tight">{desc}</p>
                  </motion.div>
                ))}
                {activeCustomPresets.map(p => (
                  <div key={p.name} className="bg-amber-50 rounded-lg px-2.5 py-2 border border-amber-300">
                    <code className="font-mono font-bold text-amber-800 text-[10px]">#{p.name}#</code>
                    <p className="text-[9px] text-amber-600 mt-0.5 leading-tight">Custom preset</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-amber-600 mt-2">Combine with a voice: <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>{cmd} #Demon# Arthur_Morgan: message</code> — or go wild: <code className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>{cmd} #GigaNerd# message</code></p>
            </motion.div>
          )}
        </Card>

        {/* Available Voices */}
        <Card style={{scrollMarginTop: 80}} className="[id:chatter-section-voices]">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background: 'rgba(124,58,237,0.08)', color: '#7c3aed', boxShadow: 'inset 0 0 0 1px rgba(124,58,237,0.1)'}}><Mic2 size={18} /></div>
            <div>
              <h2 className="font-bold text-lg" style={{color: 'var(--text-primary)'}}>Available Voices</h2>
              {hasCuratedVoices && <Badge color="purple">Curated</Badge>}
            </div>
          </div>
          {!settingsLoaded ? (
            <div className="text-xs text-gray-400 text-center py-6 flex items-center justify-center gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading settings...
            </div>
          ) : allowChatterVoice ? (
            <>
              {!voicesLoading && (
                <div className="flex items-center gap-3 mb-3 text-[10px] font-bold uppercase tracking-wider">
                  {allVoices.length > 0 && (
                    <span className="flex items-center gap-1 text-purple-700"><span className="w-2 h-2 rounded-full bg-purple-500" /> {allVoices.length} Voice{allVoices.length !== 1 ? 's' : ''} Available</span>
                  )}
                  {hasCuratedVoices && cambVoices.length > allVoices.filter(v => v.engine === 'camb').length && (
                    <span className="flex items-center gap-1 text-stone-400">({cambVoices.length - allVoices.filter(v => v.engine === 'camb').length} hidden)</span>
                  )}
                  {cambVoices.length === 0 && voicesSource !== 'live' && (
                    <span className="flex items-center gap-1 text-stone-400"><RefreshCw size={10} className="animate-spin" /> Loading AI voices from server cache...</span>
                  )}
                </div>
              )}
              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={voiceSearch}
                  onChange={e => setVoiceSearch(e.target.value)}
                  placeholder="Search voices... (e.g. Arthur, Brian, Sarah)"
                  className="classic-input pl-10 w-full text-sm"
                />
              </div>
              {voicesLoading ? (
                <div className="text-xs text-gray-400 text-center py-6 flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" /> Loading voices...
                </div>
              ) : (
              <div className="max-h-96 overflow-y-auto pr-1 scrollbar-thin space-y-2 sm:space-y-2" data-lenis-prevent>
                {filteredVoices.length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-6 italic">No voices found.</div>
                )}
                {filteredVoices.map(v => (
                  <motion.div key={v.name + v.engine} className={`rounded-xl px-3 sm:px-4 py-3 sm:py-3 min-h-[44px] flex items-center justify-between text-xs border transition-all duration-200 ${v.isFav ? '' : ''}`} style={{background: v.isFav ? 'rgba(220,53,53,0.04)' : 'var(--bg-inset)', borderColor: v.isFav ? 'rgba(220,53,53,0.15)' : 'var(--border-subtle)'}} whileHover={{ scale: 1.008, borderColor: 'rgba(220,53,53,0.2)' }} transition={springMicro}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900">{v.name}</span>
                        {v.isFav && <Heart size={10} className="text-red-500 fill-red-500 shrink-0" />}
                        <Badge color={v.engine === 'camb' ? 'blue' : 'amber'}>{v.engine === 'camb' ? 'AI' : 'Browser'}</Badge>
                        {v.gender === 1 && <Badge color='blue'>Male</Badge>}
                        {v.gender === 0 && <Badge color='purple'>Female</Badge>}
                      </div>
                    </div>
                    <code className="text-[10px] font-mono px-2.5 py-1 rounded shrink-0 ml-2" style={{background: 'var(--bg-surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border-default)'}}>
                      {cmd} {v.alias}:
                    </code>
                  </motion.div>
                ))}
              </div>
              )}
            </>
          ) : (
            <div className="rounded-xl p-5 border text-center" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}}>
              <p className="text-xs italic" style={{color: 'var(--text-tertiary)'}}>Voice selection is not enabled by the streamer. The streamer picks the voice for you.</p>
            </div>
          )}
        </Card>

        {/* Sound Effects — Full Preview */}
        <Card style={{scrollMarginTop: 80}} className="[id:chatter-section-sounds]">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background: 'rgba(217,119,6,0.08)', color: '#b45309', boxShadow: 'inset 0 0 0 1px rgba(217,119,6,0.1)'}}><Music size={18} /></div>
            <div>
              <h2 className="font-bold text-lg" style={{color: 'var(--text-primary)'}}>Sound Effects</h2>
              <span className="text-[10px] font-mono" style={{color: 'var(--text-tertiary)'}}>{filteredSounds.length + filteredCustomSounds.length} sounds</span>
            </div>
          </div>
          <p className="text-xs mb-4" style={{color: 'var(--text-secondary)'}}>Click the play button to preview a sound. Use the name in parentheses inside your TTS message to insert it.</p>

          {/* Search + Category Filter */}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={soundSearch}
                onChange={e => setSoundSearch(e.target.value)}
                placeholder="Search sounds... (e.g. bruh, mario, sad)"
                className="classic-input pl-9 w-full text-xs"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSoundCategory(cat)}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${soundCategory === cat ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Sounds Grid */}
          {filteredCustomSounds.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Music size={12} className="text-blue-500" />
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Custom Sounds</span>
                <span className="text-[9px] text-blue-400 font-mono">({filteredCustomSounds.length})</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin" data-lenis-prevent>
                {filteredCustomSounds.map(cs => {
                  const slug = getSoundSlug(cs.name);
                  const isPlaying = playingSound === cs.name;
                  return (
                    <div key={cs.id} className={`rounded-xl px-3 py-3 min-h-[44px] flex items-center gap-2.5 border transition-all duration-200`} style={{background: isPlaying ? 'rgba(59,130,246,0.06)' : 'var(--bg-inset)', borderColor: isPlaying ? 'rgba(59,130,246,0.25)' : 'var(--border-subtle)'}}>
                      <button
                        onClick={() => previewCustomSound(cs)}
                        className={`w-8 h-8 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${isPlaying ? 'bg-blue-500 text-white shadow-sm' : 'bg-blue-50 text-blue-500 hover:bg-blue-100 hover:text-blue-600'}`}
                        title={isPlaying ? 'Stop preview' : 'Preview custom sound'}
                      >
                        {isPlaying ? <Volume2 size={12} /> : <Play size={11} fill="currentColor" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-gray-900 leading-tight">{cs.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge color="blue">Custom</Badge>
                          <code className="text-[9px] font-mono text-stone-400">({slug})</code>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Built-in Sounds Grid */}
          {(filteredCustomSounds.length > 0 && filteredSounds.length > 0) && (
            <div className="flex items-center gap-2 mb-2">
              <Volume2 size={12} style={{color: 'var(--text-tertiary)'}} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{color: 'var(--text-tertiary)'}}>Built-in Sounds</span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin" data-lenis-prevent>
            {filteredSounds.length === 0 && filteredCustomSounds.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-6 italic col-span-2">No sounds found.</div>
            )}
            {filteredSounds.map(s => {
              const slug = getSoundSlug(s.name);
              const isPlaying = playingSound === s.name;
              return (
                <div key={s.name} className={`rounded-xl px-3 py-3 min-h-[44px] flex items-center gap-2.5 border transition-all duration-200 ${isPlaying ? '' : ''}`} style={{background: isPlaying ? 'rgba(5,150,105,0.06)' : 'var(--bg-inset)', borderColor: isPlaying ? 'rgba(5,150,105,0.25)' : 'var(--border-subtle)'}}>
                  <button
                    onClick={() => previewSound(s)}
                    className={`w-8 h-8 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${isPlaying ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-600'}`}
                    title={isPlaying ? 'Stop preview' : 'Preview sound'}
                  >
                    {isPlaying ? <Volume2 size={12} /> : <Play size={11} fill="currentColor" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-gray-900 leading-tight">{s.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge color={s.category === 'Memes' ? 'green' : s.category === 'Gaming' ? 'blue' : s.category === 'Reactions' ? 'purple' : 'amber'}>{s.category}</Badge>
                      <code className="text-[9px] font-mono text-stone-400">({slug})</code>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* TTS Leaderboard */}
        {Object.keys(activeLeaderboard.chatters).length > 0 && (
          <Card>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background: 'rgba(234,179,8,0.08)', color: '#ca8a04', boxShadow: 'inset 0 0 0 1px rgba(234,179,8,0.1)'}}><Trophy size={18} /></div>
              <div>
                <h2 className="font-bold text-lg" style={{color: 'var(--text-primary)'}}>TTS Leaderboard</h2>
                <span className="text-[10px] uppercase tracking-wider font-semibold" style={{color: 'var(--text-tertiary)'}}>Top chatters</span>
              </div>
            </div>
            <p className="text-xs mb-4" style={{color: 'var(--text-secondary)'}}>See who has sent the most TTS messages! The more you chat, the higher you rank.</p>

            {/* Top Chatters */}
            <div className="space-y-2">
              {Object.entries(activeLeaderboard.chatters)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 10)
                .map(([user, data], i) => (
                  <div key={user} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border" style={{background: i === 0 ? 'rgba(234,179,8,0.06)' : i === 1 ? 'rgba(148,163,184,0.04)' : i === 2 ? 'rgba(217,119,6,0.04)' : 'var(--bg-inset)', borderColor: i === 0 ? 'rgba(234,179,8,0.15)' : i === 1 ? 'rgba(148,163,184,0.12)' : i === 2 ? 'rgba(217,119,6,0.1)' : 'var(--border-subtle)'}}>
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700 border border-amber-200' : i === 1 ? 'bg-slate-100 text-slate-600 border border-slate-200' : i === 2 ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'bg-gray-50 text-gray-400 border border-gray-100'}`}>{i + 1}</span>
                    <span className="text-sm font-bold flex-1" style={{color: 'var(--text-primary)'}}>{user}</span>
                    <span className="text-xs font-mono font-bold" style={{color: 'var(--crimson-400)'}}>{data.count}</span>
                    {data.lastVoice && <span className="text-[10px] truncate max-w-[80px] hidden sm:inline" style={{color: 'var(--text-tertiary)'}}>{data.lastVoice}</span>}
                  </div>
                ))}
            </div>

            {/* Top Voices & Presets */}
            {(Object.keys(activeLeaderboard.voices).length > 0 || Object.keys(activeLeaderboard.presets).length > 0) && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                {Object.keys(activeLeaderboard.voices).length > 0 && (
                  <div className="rounded-xl p-3 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-subtle)'}}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{color: 'var(--text-tertiary)'}}>Top Voices</div>
                    <div className="space-y-1">
                      {Object.entries(activeLeaderboard.voices)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([voice, count], i) => (
                          <div key={voice} className="flex items-center gap-1.5 text-[11px]">
                            <span className="w-4 text-center font-bold" style={{color: i === 0 ? '#ca8a04' : 'var(--text-muted)'}}>{i + 1}</span>
                            <span className="truncate flex-1" style={{color: 'var(--text-secondary)'}}>{voice}</span>
                            <span className="font-mono font-bold" style={{color: 'var(--text-tertiary)'}}>{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                {Object.keys(activeLeaderboard.presets).length > 0 && (
                  <div className="rounded-xl p-3 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-subtle)'}}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{color: 'var(--text-tertiary)'}}>Top Presets</div>
                    <div className="space-y-1">
                      {Object.entries(activeLeaderboard.presets)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([preset, count], i) => (
                          <div key={preset} className="flex items-center gap-1.5 text-[11px]">
                            <span className="w-4 text-center font-bold" style={{color: i === 0 ? '#ca8a04' : 'var(--text-muted)'}}>{i + 1}</span>
                            <span className="truncate flex-1 capitalize" style={{color: 'var(--text-secondary)'}}>{preset}</span>
                            <span className="font-mono font-bold" style={{color: 'var(--text-tertiary)'}}>{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {/* SFX Trigger Words */}
        {sfx.length > 0 && (
          <Card>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background: 'rgba(234,88,12,0.08)', color: '#b45309', boxShadow: 'inset 0 0 0 1px rgba(234,88,12,0.1)'}}><Volume2 size={18} /></div>
              <div>
                <h2 className="font-bold text-lg" style={{color: 'var(--text-primary)'}}>SFX Trigger Words</h2>
                <p className="text-[10px] uppercase tracking-wider font-semibold" style={{color: 'var(--text-tertiary)'}}>Instant commands</p>
              </div>
            </div>
            <p className="text-xs mb-4" style={{color: 'var(--text-secondary)'}}>Type these commands in chat to instantly play a sound (no TTS message needed). Just type the command and hit enter.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {sfx.map(a => (
                <div key={a.word} className="rounded-lg px-3 py-2.5 text-xs flex items-center gap-2 border" style={{background: 'rgba(234,88,12,0.06)', borderColor: 'rgba(234,88,12,0.15)'}}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background: '#ea580c'}} />
                  <code className="font-mono font-bold text-orange-800">{a.word}</code>
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t" style={{borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)'}}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 text-center">
          <p className="text-[10px] uppercase tracking-widest font-semibold flex items-center justify-center gap-1" style={{color: 'var(--text-muted)'}}>Powered by <span className="chatgbt-gradient-text">CHATGBT</span> TTS Control Room</p>
        </div>
      </footer>

      {/* Mobile Bottom Navigation (Feature 2) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 border-t" style={{background: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: '0 -2px 10px rgba(0,0,0,0.06)'}}>
        <div className="flex items-center justify-around py-2">
          {[
            { id: 'voices', label: 'Voices', icon: <Mic2 size={18} /> },
            { id: 'presets', label: 'Presets', icon: <SlidersHorizontal size={18} /> },
            { id: 'sounds', label: 'Sounds', icon: <Music size={18} /> },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                const el = document.getElementById(`chatter-section-${tab.id}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="flex flex-col items-center gap-0.5 px-4 py-1 min-h-[44px] justify-center"
              style={{color: 'var(--text-tertiary)'}}
            >
              {tab.icon}
              <span className="text-[9px] font-bold">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Command Cheatsheet Modal */}
      <BackdropOverlay isOpen={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)}>
        <div className="classic-card p-0 w-full max-w-2xl max-h-[85vh] flex flex-col" style={{background: 'var(--bg-surface)'}}>
          <div className="p-4 border-b flex items-center justify-between" style={{borderColor: 'var(--border-default)'}}>
            <div className="flex items-center gap-2">
              <Terminal size={18} style={{color: '#dc3535'}} />
              <h2 className="font-bold text-base" style={{color: 'var(--text-primary)'}}>Command Cheatsheet</h2>
            </div>
            <button onClick={() => setCheatsheetOpen(false)} className="p-1 rounded-lg hover:bg-stone-100 cursor-pointer" style={{color: 'var(--text-tertiary)'}}>
              <X size={18} />
            </button>
          </div>
          <div className="px-4 pt-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color: 'var(--text-muted)'}} />
              <input
                value={cheatsheetSearch}
                onChange={e => setCheatsheetSearch(e.target.value)}
                placeholder="Search commands, voices, presets..."
                className="w-full classic-input pl-9 text-sm"
                autoFocus
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-5" data-lenis-prevent>
            {(() => {
              const q = cheatsheetSearch.toLowerCase();
              const cmd = activePrefix || '!tts';
              const commands = [
                { syntax: `${cmd} message`, desc: 'Send a TTS message' },
                { syntax: `${cmd} Voice_Name: message`, desc: 'Use a specific voice' },
                { syntax: `${cmd} #PresetName# message`, desc: 'Apply voice effect preset' },
                { syntax: `${cmd} #PresetName# Voice_Name: message`, desc: 'Preset + voice combo' },
                { syntax: `${cmd} en: message`, desc: 'Force English locale' },
                { syntax: '(sound_name)', desc: 'Inline sound effect in message' },
                ...sfx.map(a => ({ syntax: a.word, desc: `Trigger: ${a.word}` })),
              ];
              const cheatVoices = allVoices.slice(0, 50).map(v => ({ syntax: `${cmd} ${v.alias}:`, desc: `${v.name} (${v.engine === 'camb' ? 'AI' : 'Browser'}${v.gender === 1 ? ', Male' : v.gender === 0 ? ', Female' : ''})` }));
              const presets = Object.keys(PRESETS).concat((activeCustomPresets || []).map(p => p.name)).map(n => ({ syntax: `#${n}#`, desc: PRESET_DESCRIPTIONS[n] || 'Custom voice preset' }));
              const sfxItems = [
                ...SOUND_LIBRARY.filter(s => !new Set(activeHiddenSounds || []).has(s.name)).slice(0, 40).map(s => ({ syntax: `(${getSoundSlug(s.name)})`, desc: `Sound: ${s.name}` })),
                ...activeCustomSounds.slice(0, 20).map(cs => ({ syntax: `(${getSoundSlug(cs.name)})`, desc: `Custom Sound: ${cs.name}` })),
              ];

              const filteredCommands = commands.filter(c => !q || c.syntax.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
              const filteredVoices = cheatVoices.filter(v => !q || v.syntax.toLowerCase().includes(q) || v.desc.toLowerCase().includes(q));
              const filteredPresets = presets.filter(p => !q || p.syntax.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q));
              const filteredSfx = sfxItems.filter(s => !q || s.syntax.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q));

              const Section = ({ title, items, icon }: { title: string; items: { syntax: string; desc: string }[]; icon: React.ReactNode }) => {
                if (items.length === 0) return null;
                return (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{color: 'var(--text-tertiary)'}}>{icon} {title}</h3>
                    <div className="space-y-1">
                      {items.map((item, i) => (
                        <div key={i} className="flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-stone-50" style={{color: 'var(--text-secondary)'}}>
                          <code className="text-xs font-mono font-bold shrink-0 px-1.5 py-0.5 rounded" style={{background: 'var(--bg-inset)', color: '#dc3535'}}>{item.syntax}</code>
                          <span className="text-xs">{item.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              };

              return (
                <>
                  <Section title="Commands" items={filteredCommands} icon={<MessageSquareText size={12} />} />
                  <Section title="Voices" items={filteredVoices} icon={<Mic2 size={12} />} />
                  <Section title="Presets" items={filteredPresets} icon={<SlidersHorizontal size={12} />} />
                  <Section title="Sound Effects" items={filteredSfx} icon={<Music size={12} />} />
                  {filteredCommands.length === 0 && filteredVoices.length === 0 && filteredPresets.length === 0 && filteredSfx.length === 0 && (
                    <div className="text-center py-8 text-sm" style={{color: 'var(--text-muted)'}}>No results found for "{cheatsheetSearch}"</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </BackdropOverlay>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CUSTOM CURSOR — Zero-lag arrow with click burst
// Pure DOM manipulation (NO Motion, NO React re-renders)
// Uses requestAnimationFrame for 60fps cursor tracking
// ═══════════════════════════════════════════════════════════
// Click ring — lightweight click feedback, NO rAF loop, NO position tracking
// Cursor visual is handled by CSS cursor: url() — runs in OS compositor, ZERO lag
function ClickRing() {
  useEffect(() => {
    const isTouch = window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches;
    if (isTouch) return;

    // Create a container for click rings (no position tracking needed)
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;';
    document.body.appendChild(container);

    const handleMouseDown = (e: MouseEvent) => {
      const ring = document.createElement('div');
      ring.className = 'cursor-click-ring';
      ring.style.left = e.clientX + 'px';
      ring.style.top = e.clientY + 'px';
      container.appendChild(ring);
      setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 350);
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      if (container.parentNode) container.parentNode.removeChild(container);
    };
  }, []);

  return null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dash' | 'voice' | 'rules' | 'overlay' | 'soundboard'>('dash');
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['dash']));
  const [tabTransitioning, setTabTransitioning] = useState(false);
  // Tab switching
  const prevTabRef = useRef<string>('dash');
  const switchTab = useCallback((tab: 'dash' | 'voice' | 'rules' | 'overlay' | 'soundboard') => {
    if (tab === activeTab) return;
    prevTabRef.current = activeTab;
    setTabTransitioning(true);
    setActiveTab(tab);
    setVisitedTabs(prev => new Set(prev).add(tab));
    // Short delay to let the loading spinner show, then content renders
    setTimeout(() => setTabTransitioning(false), 150);
  }, [activeTab]);

  // Twitch
  const [channel, setChannel] = useState(() => localStorage.getItem('ch') || '');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  // Feature 33: WebSocket reconnection tracking
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [reconnectProgress, setReconnectProgress] = useState(0);
  const [reconnectStartTime, setReconnectStartTime] = useState<number | null>(null);
  const prevStatusRef = useRef(status);

  // Track status transitions for reconnection UI
  useEffect(() => {
    if (prevStatusRef.current === 'connected' && status === 'connecting') {
      setReconnectAttempt(prev => prev + 1);
      setReconnectStartTime(Date.now());
      setReconnectProgress(0);
    } else if (status === 'connected') {
      setReconnectStartTime(null);
      setReconnectProgress(100);
      setTimeout(() => { setReconnectProgress(0); setReconnectAttempt(0); }, 2000);
    }
    prevStatusRef.current = status;
  }, [status]);

  // Animate reconnection progress bar over ~5 seconds
  useEffect(() => {
    if (status !== 'connecting' || !reconnectStartTime) return;
    const duration = 5000;
    const interval = setInterval(() => {
      const elapsed = Date.now() - reconnectStartTime;
      const progress = Math.min((elapsed / duration) * 100, 95); // Cap at 95% until actually connected
      setReconnectProgress(progress);
    }, 100);
    return () => clearInterval(interval);
  }, [status, reconnectStartTime]);

  // Engine
  const [engine, setEngine] = useState<Engine>(() => (localStorage.getItem('eng') as Engine) || 'camb');
  const [voiceId, setVoiceId] = useState(() => Number(localStorage.getItem('camb_vid')) || 147320);
  const [cambGender, setCambGender] = useState(() => Number(localStorage.getItem('camb_g')) || 1);
  const [cambAge, setCambAge] = useState(() => Number(localStorage.getItem('camb_a')) || 30);
  // Per-voice volume multiplier for CAMB voices — each voice gets its own volume control (0.2–5.0)
  // 0.2 = very quiet (20%), 1.0 = normal (100%), 5.0 = 5x louder
  // Stored as { voiceId: boostValue } in localStorage key 'camb_voice_boosts'
  const [cambVoiceBoosts, setCambVoiceBoosts] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem('camb_voice_boosts') || '{}'); } catch { return {}; }
  });
  const cambVoiceBoostsRef = useRef<Record<number, number>>(cambVoiceBoosts);
  useEffect(() => {
    cambVoiceBoostsRef.current = cambVoiceBoosts;
    try { localStorage.setItem('camb_voice_boosts', JSON.stringify(cambVoiceBoosts)); } catch {}
  }, [cambVoiceBoosts]);

  // Per-voice model / enhance / speakingRate settings for Camb voices
  // Stored as { voiceId: { model?: string, enhance?: boolean, speakingRate?: number } }
  // model: which Camb model to use (e.g. 'mars-8.1-pro-beta' or 'mars-8.1-flash-beta')
  // enhance: whether to apply audio enhancement (default true if not set)
  // speakingRate: TTS speaking speed (0.3 slow → 1.0 normal → 2.0 fast, default 0.7)
  interface VoiceSettings { model?: string; enhance?: boolean; speakingRate?: number; }
  const [cambVoiceSettings, setCambVoiceSettings] = useState<Record<number, VoiceSettings>>(() => {
    try { return JSON.parse(localStorage.getItem('camb_voice_settings') || '{}'); } catch { return {}; }
  });
  const cambVoiceSettingsRef = useRef<Record<number, VoiceSettings>>(cambVoiceSettings);
  useEffect(() => {
    // Invalidate the voice hover-preview cache for any voice whose settings changed.
    // Without this, changing the model/enhance/speakingRate for a voice and then
    // previewing it again would silently play the old cached audio.
    const prev = cambVoiceSettingsRef.current;
    const next = cambVoiceSettings;
    const allIds = new Set([...Object.keys(prev), ...Object.keys(next)].map(Number));
    allIds.forEach(id => {
      const p = prev[id]; const n = next[id];
      const changed =
        p?.model !== n?.model ||
        p?.enhance !== n?.enhance ||
        p?.speakingRate !== n?.speakingRate;
      if (changed) voicePreviewCache.current.delete(id);
    });
    cambVoiceSettingsRef.current = cambVoiceSettings;
    try { localStorage.setItem('camb_voice_settings', JSON.stringify(cambVoiceSettings)); } catch {}
  }, [cambVoiceSettings]);

  const [voices, setVoices] = useState<CambVoice[]>([]);
  const voicesRef = useRef<CambVoice[]>([]);
  const [fetching, setFetching] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [favs, setFavs] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem('favs') || '[]'); } catch { return []; } });

  // Chatter voice selection toggle (abuse prevention: off by default)
  // Now synced with server so ALL browsers see the same setting
  const [allowChatterVoice, setAllowChatterVoice] = useState(() => localStorage.getItem('chatter_voice') === 'true');

  // Curated list of voices visible to chatters (admin selects these from the full voice list)
  // When empty, chatters see all voices. When populated, chatters only see these.
  const [chatterVoices, setChatterVoices] = useState<ChatterVoice[]>(() => { try { return JSON.parse(localStorage.getItem('chatter_voices') || '[]'); } catch { return []; } });
  const [chatterVoiceSearch, setChatterVoiceSearch] = useState('');

  // Sync specific settings to server (for partial updates like toggling chatter voice)
  const syncSettingsToServer = useCallback(async (settings: { allowChatterVoice?: boolean; prefix?: string; channel?: string; chatterVoices?: ChatterVoice[] }) => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
      });
    } catch {
      // Non-critical — server sync failure shouldn't break the app
    }
  }, []);

  // NOTE: syncAllSettingsToServer is defined below, after all state declarations

  // Browser
  const [browserVoice, setBrowserVoice] = useState(() => localStorage.getItem('bvoice') || '');
  const [sysVoices, setSysVoices] = useState<SpeechSynthesisVoice[]>([]);
  const sysVoicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // FX — Initialize with DEFAULT_FX (handles missing/old fields gracefully)
  const [fx, setFx] = useState<FXSettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fx') || '');
      // Merge with DEFAULT_FX to ensure all new fields have valid defaults
      // (old saves won't have lowPassFreq, highPassFreq, bitCrush, robotMix, echoMix)
      return { ...DEFAULT_FX, ...saved };
    } catch { return { ...PRESETS.clean }; }
  });
  const [presetName, setPresetName] = useState(() => localStorage.getItem('preset') || 'clean');
  const [customPresets, setCustomPresets] = useState<SavedPreset[]>(() => { try { return JSON.parse(localStorage.getItem('cpresets') || '[]'); } catch { return []; } });
  const customPresetsRef = useRef<SavedPreset[]>(customPresets);
  useEffect(() => { customPresetsRef.current = customPresets; }, [customPresets]);
  const [newPresetName, setNewPresetName] = useState('');

  // Track the last selected preset name separately from the "modified" state.
  // This allows the Save button to stay visible even after the user tweaks sliders.
  // When the user clicks a preset → lastSelectedPreset = that preset name.
  // When the user adjusts a slider → presetName becomes 'custom' but lastSelectedPreset stays.
  const [lastSelectedPreset, setLastSelectedPreset] = useState(() => localStorage.getItem('preset') || 'clean');

  // Effects rack ON/OFF — when OFF, TTS plays with clean (no effects) regardless of settings
  const [fxEnabled, setFxEnabled] = useState(() => localStorage.getItem('fx_enabled') !== 'false');

  // Rules
  const [allowedRoles, setAllowedRoles] = useState<RoleFilter>(() => (localStorage.getItem('roles') as RoleFilter) || 'all');
  const [requirePrefix, setRequirePrefix] = useState(() => localStorage.getItem('reqprefix') !== 'false');
  const [prefix, setPrefix] = useState(() => localStorage.getItem('prefix') || '!tts');
  const [maxChars, setMaxChars] = useState(() => Number(localStorage.getItem('maxchars')) || 180);
  const [blacklist, setBlacklist] = useState(() => localStorage.getItem('blacklist') || '');
  const [whitelist, setWhitelist] = useState(() => localStorage.getItem('whitelist') || '');
  const [userCooldown, setUserCooldown] = useState(() => Number(localStorage.getItem('cooldown')) || 0);
  const [queueSizeLimit, setQueueSizeLimit] = useState(() => Number(localStorage.getItem('qlimit')) || 20);

  // Mappings
  const [mappings, setMappings] = useState<UserMapping[]>(() => { try { return JSON.parse(localStorage.getItem('mappings') || '[]'); } catch { return []; } });
  const [mapUser, setMapUser] = useState('');
  const [mapEngine, setMapEngine] = useState<Engine>('camb');
  const [mapVoice, setMapVoice] = useState('');
  const [mapPreset, setMapPreset] = useState('clean');

  // Aliases
  const [aliases, setAliases] = useState<WordAlias[]>(() => { try { return JSON.parse(localStorage.getItem('aliases') || '[]'); } catch { return []; } });
  const [aliasFrom, setAliasFrom] = useState('');
  const [aliasTo, setAliasTo] = useState('');

  // SFX
  const [sfx, setSfx] = useState<SoundAlert[]>(() => { try { return JSON.parse(localStorage.getItem('sfx') || ''); } catch { return DEFAULT_SFX; } });
  const [sfxWord, setSfxWord] = useState('');
  const [sfxUrl, setSfxUrl] = useState('');

  // Soundboard
  const [soundSearch, setSoundSearch] = useState('');
  const [soundBaseUrl, setSoundBaseUrl] = useState(() => localStorage.getItem('sound_base_url') || DEFAULT_SOUND_BASE_URL);
  const [soundUrlCache, setSoundUrlCache] = useState<Record<string, string>>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('sound_url_cache') || '{}');
      const keys = Object.keys(cached);
      // Cap cache at 200 entries to prevent localStorage overflow
      if (keys.length > 200) {
        const trimmed: Record<string, string> = {};
        keys.slice(-200).forEach(k => { trimmed[k] = cached[k]; });
        return trimmed;
      }
      return cached;
    } catch { return {}; }
  });
  const [resolvingSounds, setResolvingSounds] = useState(false);

  // ── ABUSE PREVENTION ──
  // Advanced bad word filter (leetspeak/unicode bypass detection)
  const [advancedFilterEnabled, setAdvancedFilterEnabled] = useState(() => localStorage.getItem('adv_filter') !== 'false');
  const [bannedWordsString, setBannedWordsString] = useState(() => localStorage.getItem('banned_words_adv') || getDefaultBannedWordsString());
  const [filterMode, setFilterMode] = useState<'censor' | 'block'>(() => (localStorage.getItem('filter_mode') as 'censor' | 'block') || 'block');

  // User blocklist (always blocked, regardless of role)
  const [blockedUsers, setBlockedUsers] = useState(() => localStorage.getItem('blocked_users') || '');



  // Soundboard volume controls
  const [soundVolumes, setSoundVolumes] = useState<SoundVolumeConfig>(() => {
    try { return JSON.parse(localStorage.getItem('sound_volumes') || '{}'); } catch { return {}; }
  });
  const [soundboardMasterVol, setSoundboardMasterVol] = useState(() => Number(localStorage.getItem('sb_master_vol')) || 1.0);

  // Active sound tracking for pause/play in soundboard
  // Audio element stored in ref to avoid preventing GC and causing unnecessary re-renders
  const activeSoundRef = useRef<HTMLAudioElement | null>(null);
  const [activeSoundName, setActiveSoundName] = useState<string | null>(null);

  // Custom sounds (uploaded by admin, stored as base64 in Turso cloud)
  // NOTE: Custom sounds are NEVER stored in localStorage — they're too large
  // (base64 audio easily exceeds the 5MB localStorage limit, causing data loss).
  // They load from the server on mount instead.
  // CLEANUP: Remove any old `custom_sounds` key from localStorage that was
  // written by a previous version of the app. This prevents the stale huge
  // key from consuming the 5MB quota and crashing other setItem calls.
  useEffect(() => { try { localStorage.removeItem('custom_sounds'); } catch {} }, []);
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([]);
  // BUG FIX: Add customSoundsRef so the Twitch onMessage callback always reads
  // the latest customSounds list. Without this, inline SFX parsing in the
  // onMessage handler uses a stale closure — new custom sounds added after
  // connecting to Twitch won't be recognized until the user reconnects.
  const customSoundsRef = useRef<CustomSound[]>(customSounds);
  useEffect(() => { customSoundsRef.current = customSounds; }, [customSounds]);
  const [, setCustomSoundsLoaded] = useState(false);
  const [sfxUploading, setSfxUploading] = useState(false);
  const [sfxUploadName, setSfxUploadName] = useState('');

  // Sounds hidden from chatter page (admin can still see & use them)
  const [hiddenSounds, setHiddenSounds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('hidden_sounds') || '[]'); } catch { return []; } });



  // Track recent messages per user for spam detection
  const recentMessagesRef = useRef<Record<string, string[]>>({});
  


  // Server-side API key mode (always on — keys stored as env vars on server)
  const [voiceKeyMap, setVoiceKeyMap] = useState<{ voiceId: number; keyIndex: number }[]>([]);
  const [serverKeyCount, setServerKeyCount] = useState(0);

  // OBS
  const [subColor, setSubColor] = useState(() => localStorage.getItem('subcol') || '#000000');
  const [subSize, setSubSize] = useState(() => Number(localStorage.getItem('subsz')) || 36);
  const [subBg, setSubBg] = useState(() => localStorage.getItem('subbg') || '#ffffff');

  // Proxy
  const [useProxy, setUseProxy] = useState(() => localStorage.getItem('proxy') === 'true');
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem('proxyurl') || '/api/cors-proxy?url=');

  // Stats — persisted to cloud & localStorage
  const [stats, setStats] = useState<{ total: number; chatters: number; avgChars: number; peakQ: number }>(() => {
    try {
      const saved = localStorage.getItem('tts_stats');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.total === 'number') return parsed;
      }
    } catch {}
    return { total: 0, chatters: 0, avgChars: 0, peakQ: 0 };
  });

  // Runtime
  const [logs, setLogs] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playing, setPlaying] = useState<QueueItem | null>(null);
  const [history, setHistory] = useState<QueueItem[]>(() => {
    try {
      const saved = localStorage.getItem('tts_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((item: any) => ({ ...item, timestamp: new Date(item.timestamp) }));
        }
      }
    } catch {}
    return [];
  });
  const [testText, setTestText] = useState('Have some goddamn faith, Arthur.');
  const [overlay, setOverlay] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [subUser, setSubUser] = useState('');
  const [subText, setSubText] = useState('');

  // Feature 2: Particle burst on skip
  const [particleBurst, setParticleBurst] = useState<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });

  // Feature 6: Header parallax on scroll — useMotionValue + useTransform
  const headerScrollY = useMotionValue(0);
  const prefersReducedMotion = useReducedMotion();
  const headerTranslateY = useTransform(headerScrollY, [0, 300], [0, -8]);
  const headerScale = useTransform(headerScrollY, [0, 300], [1, 0.995]);

  // Feature 9: Auto-switch voice for languages
  const [autoLangSwitch, setAutoLangSwitch] = useState(() => localStorage.getItem('auto_lang_switch') !== 'false');

  // Feature 11: Service worker + cache stats
  const [audioCacheCount, setAudioCacheCount] = useState(0);

  // Feature 18: Stat counter celebration — confetti on milestone
  const [celebratingStat, setCelebratingStat] = useState<string | null>(null);
  const prevStatsRef = useRef({ total: 0, chatters: 0, avgChars: 0, peakQ: 0 });
  const MILESTONES = [25, 50, 100, 200, 500, 1000];
  // BUG FIX: Track celebration timeout for cleanup on unmount
  const celebratingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const curr = { total: stats.total, chatters: stats.chatters, avgChars: stats.avgChars, peakQ: stats.peakQ };
    const prev = prevStatsRef.current;
    const labels: { key: keyof typeof curr; label: string }[] = [
      { key: 'total', label: 'Dispatched' },
      { key: 'chatters', label: 'Chatters' },
      { key: 'avgChars', label: 'Avg Chars' },
      { key: 'peakQ', label: 'Peak Queue' },
    ];
    for (const { key, label } of labels) {
      if (curr[key] !== prev[key]) {
        for (const m of MILESTONES) {
          if (prev[key] < m && curr[key] >= m) {
            setCelebratingStat(label);
            // BUG FIX: Clear previous timeout before setting new one to prevent
            // multiple overlapping timers, and store ref for cleanup.
            if (celebratingTimerRef.current !== null) clearTimeout(celebratingTimerRef.current);
            celebratingTimerRef.current = setTimeout(() => setCelebratingStat(null), 800);
            break;
          }
        }
      }
    }
    prevStatsRef.current = curr;
  }, [stats.total, stats.chatters, stats.avgChars, stats.peakQ]);

  // Auth state — server-side authentication
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [showChatterView, setShowChatterView] = useState(false);

  // ──── Dark Mode (DEFAULT: dark) ────
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('darkMode');
    // Default to dark unless explicitly set to 'false'
    return stored !== 'false';
  });
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // ──── Lenis Smooth Scrolling ────
  useEffect(() => {
    let lenis: { destroy: () => void; raf: (time: number) => void } | null = null;
    let rafId: number = 0;

    const initLenis = async () => {
      try {
        const Lenis = (await import('lenis')).default;
        lenis = new Lenis({
          duration: 1.2,
          easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          orientation: 'vertical',
          gestureOrientation: 'vertical',
          smoothWheel: true,
          wheelMultiplier: 1,
          touchMultiplier: 2,
          prevent: (node: EventTarget | null) => {
            // Prevent Lenis from intercepting scroll in overflow containers
            if (node instanceof HTMLElement) {
              return node.hasAttribute('data-lenis-prevent') || !!node.closest('[data-lenis-prevent]');
            }
            return false;
          },
        });

        function raf(time: number) {
          lenis?.raf(time);
          rafId = requestAnimationFrame(raf);
        }
        rafId = requestAnimationFrame(raf);
      } catch {
        // Lenis not available, fall back to native scroll
      }
    };

    initLenis();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      lenis?.destroy();
    };
  }, []);

  // ──── Feature 1: Toast Notification System ────
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // BUG FIX: Track toast auto-dismiss timers so they can be cleaned up.
  // Without this, timers fire after unmount or when a toast is manually dismissed,
  // potentially causing the wrong toast to be removed if IDs collide.
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const addToast = useCallback((message: string, type: ToastItem['type'] = 'info', duration?: number) => {
    const id = genId();
    const dur = duration ?? (type === 'error' ? 6000 : type === 'warning' ? 5000 : 4000);
    setToasts(p => [...p.slice(-6), { id, message, type, duration: dur }]);
    // BUG FIX: Clear any existing timer for this ID and store the new one
    const existing = toastTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setToasts(p => p.filter(t => t.id !== id));
      toastTimersRef.current.delete(id);
    }, dur);
    toastTimersRef.current.set(id, timer);
  }, []);
  const dismissToast = useCallback((id: string) => {
    // BUG FIX: Clear the auto-dismiss timer when manually dismissing
    const timer = toastTimersRef.current.get(id);
    if (timer) { clearTimeout(timer); toastTimersRef.current.delete(id); }
    setToasts(p => p.filter(t => t.id !== id));
  }, []);

  // ──── Feature 5: Voice Preview on Hover ────
  const [previewingVoiceId, setPreviewingVoiceId] = useState<number | null>(null);
  const voicePreviewCache = useRef<Map<number, Blob>>(new Map());
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ──── Feature 6: Leaderboard Time Range ────
  const [lbTimeRange, setLbTimeRange] = useState<'today' | 'week' | 'all'>(() => (localStorage.getItem('lb_time_range') as 'today' | 'week' | 'all') || 'all');
  useEffect(() => { localStorage.setItem('lb_time_range', lbTimeRange); }, [lbTimeRange]);

  // ──── Feature 9: Preset Share Modal ────
  const [sharePreset, setSharePreset] = useState<{ name: string; fx: FXSettings } | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // ──── Feature 3: Queue drag state ────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ──── Offline Mode Indicator (Feature 6) ────
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showBackOnline, setShowBackOnline] = useState(false);
  useEffect(() => {
    let backOnlineTimer: ReturnType<typeof setTimeout> | null = null;
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
      setIsOffline(false);
      setShowBackOnline(true);
      // BUG FIX: Store timeout ID so it can be cleaned up on unmount.
      // Without cleanup, the setTimeout can fire after component unmount,
      // causing a setState on unmounted component warning.
      backOnlineTimer = setTimeout(() => setShowBackOnline(false), 3000);
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (backOnlineTimer !== null) clearTimeout(backOnlineTimer);
    };
  }, []);

  // ──── Connection Health Monitor (Feature 7) ────
  const [twitchLatency, setTwitchLatency] = useState<number | null>(null);
  const [apiLatency, setApiLatency] = useState<number | null>(null);
  const connectionHealth = useMemo(() => {
    const twOk = twitchLatency !== null && twitchLatency < 2000;
    const twSlow = twitchLatency !== null && twitchLatency >= 2000 && twitchLatency < 5000;
    const apiOk = apiLatency !== null && apiLatency < 5000;
    const apiSlow = apiLatency !== null && apiLatency >= 5000 && apiLatency < 15000;
    if ((twitchLatency !== null && twitchLatency > 5000) || (apiLatency !== null && apiLatency > 15000)) return 'degraded';
    if (twSlow || apiSlow) return 'slow';
    if (twOk && apiOk) return 'good';
    return 'unknown';
  }, [twitchLatency, apiLatency]);

  // ──── Pre-fetch Next Queue Item (Feature 5) ────
  const nextItemPrefetched = useRef<Map<string, Blob>>(new Map());

  // ──── Chatter History Lookup ────
  const [chatterLookupUser, setChatterLookupUser] = useState<string | null>(null);
  const [chatterSearchQuery, setChatterSearchQuery] = useState('');
  const [messageSearchQuery, setMessageSearchQuery] = useState('');

  // ──── TTS Leaderboard ────
  const [leaderboard, setLeaderboard] = useState<LeaderboardData>(() => {
    try {
      const saved = localStorage.getItem('tts_leaderboard');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.chatters === 'object') return parsed;
      }
    } catch {}
    return { chatters: {}, voices: {}, presets: {} };
  });
  // Persist leaderboard to localStorage
  useEffect(() => {
    try { localStorage.setItem('tts_leaderboard', JSON.stringify(leaderboard)); } catch {}
  }, [leaderboard]);

  // Hash routing
  const [currentHash, setCurrentHash] = useState(() => window.location.hash);

  // BUG FIX: Clean up hidden sounds that reference deleted custom sounds.
  // When a custom sound is deleted, its name may still be in hiddenSounds.
  // This causes ghost entries in the "Hidden from Chatters" section.
  useEffect(() => {
    if (hiddenSounds.length === 0) return;
    const builtInNames = new Set(SOUND_LIBRARY.map(s => s.name));
    const customNames = new Set(customSounds.map(cs => cs.name));
    const validHidden = hiddenSounds.filter(name => builtInNames.has(name) || customNames.has(name));
    if (validHidden.length !== hiddenSounds.length) {
      setHiddenSounds(validHidden);
    }
  }, [customSounds]); // Only re-check when custom sounds change (deletion)

  // Refs
  const clientRef = useRef<TwitchIRCClient | null>(null);
  const playRef = useRef<PlayingAudioControl | null>(null);
  const playingFlag = useRef(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const activeSfxRef = useRef<HTMLAudioElement[]>([]);
  const timestampsRef = useRef<Record<string, number>>({});
  const queueRef = useRef<QueueItem[]>([]);
  const queueLenRef = useRef(0);
  const chattersSetRef = useRef<Set<string>>(new Set());
  const autoLangSwitchRef = useRef(autoLangSwitch);
  autoLangSwitchRef.current = autoLangSwitch;
  const settingsRef = useRef({
    sfx, requirePrefix, prefix, whitelist, allowedRoles, userCooldown,
    queueSizeLimit, maxChars, mappings, engine, voiceId, browserVoice, fx, presetName, customPresets, fxEnabled, aliases, blacklist,
    advancedFilterEnabled, bannedWordsString, filterMode, blockedUsers,
    allowChatterVoice, chatterVoices,
  });

  // ==================== PERSISTENCE ====================
  // BUG FIX: Removed duplicate volume persistence effect — soundVolumes and
  // soundboardMasterVol are already persisted by the unified fxPersistRef effect below.
  // The old separate effect was causing double writes on every change.

  // ═══ FX PERSISTENCE — Save FX settings to localStorage on every change ═══
  // Feature 35: Unified debounced settings sync — replaces scattered individual timers
  const [cloudSyncing, setCloudSyncing] = useState(false);

  // FX + volume persistence (localStorage only, fast)
  const fxPersistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (fxPersistRef.current) clearTimeout(fxPersistRef.current);
    fxPersistRef.current = setTimeout(() => {
      try { localStorage.setItem('sound_volumes', JSON.stringify(soundVolumes)); } catch {}
      try { localStorage.setItem('sb_master_vol', String(soundboardMasterVol)); } catch {}
      try { localStorage.setItem('fx', JSON.stringify(fx)); } catch {}
      try { localStorage.setItem('preset', presetName); } catch {}
      try { localStorage.setItem('cpresets', JSON.stringify(customPresets)); } catch {}
      try { localStorage.setItem('fx_enabled', String(fxEnabled)); } catch {}
    }, 200);
    return () => { if (fxPersistRef.current) clearTimeout(fxPersistRef.current); };
  }, [fx, presetName, customPresets, fxEnabled, soundVolumes, soundboardMasterVol]);

  // PERSISTENCE: Moved to after syncAllSettingsToServer definition

  // ==================== EFFECTS ====================

  // Debounced FULL settings sync to server — pushes ALL settings to cloud
  // Feature 35: Shows cloud sync indicator while syncing
  const fullSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncAllSettingsToServer = useCallback(() => {
    if (fullSyncRef.current) clearTimeout(fullSyncRef.current);
    fullSyncRef.current = setTimeout(async () => {
      setCloudSyncing(true);
      try {
        const allSettings = {
          channel, engine, voiceId, cambGender, cambAge, browserVoice,
          fx, presetName, customPresets, favs,
          allowedRoles, requirePrefix, prefix, maxChars, blacklist, whitelist, userCooldown, queueSizeLimit,
          mappings, aliases, sfx,
          subColor, subSize, subBg, useProxy, proxyUrl,
          advancedFilterEnabled, bannedWordsString, filterMode, blockedUsers,
          soundVolumes, soundboardMasterVol,
          allowChatterVoice, chatterVoices,
          hiddenSounds,
          soundBaseUrl,
          soundUrlCache,
          // BUG FIX: autoLangSwitch and darkMode were missing from server sync
          autoLangSwitch,
          darkMode,
          // Per-voice volume boosts — persisted to cloud so they survive browser changes
          cambVoiceBoosts,
          cambVoiceSettings,
          // NOTE: ttsHistory is synced separately via syncHistoryToServer (3s debounce)
          // to avoid sending large payloads with every settings update
          ttsStats: stats,
          // Leaderboard — synced to cloud so chatters can see it on the public page
          leaderboard,
        };
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(allSettings),
        });
      } catch {
        // Non-critical
      }
      setCloudSyncing(false);
    }, 1500); // Debounce 1.5s to avoid hammering server during rapid changes
  }, [channel, engine, voiceId, cambGender, cambAge, browserVoice, fx, presetName, customPresets, favs,
    allowedRoles, requirePrefix, prefix, maxChars, blacklist, whitelist, userCooldown, queueSizeLimit,
    mappings, aliases, sfx, subColor, subSize, subBg, useProxy, proxyUrl,
    advancedFilterEnabled, bannedWordsString, filterMode, blockedUsers,
    soundVolumes, soundboardMasterVol, allowChatterVoice, chatterVoices, hiddenSounds, soundBaseUrl, soundUrlCache, stats, autoLangSwitch, darkMode, cambVoiceBoosts, cambVoiceSettings, leaderboard]);

  // Sync history to server (debounced, separate from settings)
  // History can be very large, so we don't send it with every settings update.
  // Instead, we use a longer 3-second debounce and only send the last 200 items.
  const historySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncHistoryToServer = useCallback(() => {
    if (historySyncTimerRef.current) clearTimeout(historySyncTimerRef.current);
    historySyncTimerRef.current = setTimeout(() => {
      try {
        const serialized = history.slice(-200).map(item => ({
          id: item.id,
          user: item.user,
          engine: item.engine,
          voice: item.voice,
          fx: item.fx,
          timestamp: item.timestamp.toISOString(),
          chunks: item.chunks,
          voiceDisplayName: item.voiceDisplayName,
          cambKeyUsed: item.cambKeyUsed,
        }));
        fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ttsHistory: serialized }),
        }).catch(() => {});
      } catch {}
    }, 3000); // 3 second debounce — longer than settings sync to reduce server load
  }, [history]);

  useEffect(() => {
    if (history.length > 0) {
      syncHistoryToServer();
    }
  }, [history, syncHistoryToServer]);

  // On mount, load ALL settings from server cloud (Turso / fallback)
  // Server is the source of truth ONLY if it has real saved data.
  // If server returns empty/default data (e.g. after DB reset), localStorage values are preserved.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings', { credentials: 'include' });
        if (res.ok) {
          const d = await res.json();
          if (typeof d === 'object' && d !== null) {
            // Check if server actually has saved data (not just defaults/empty)
            const meaningfulKeys = Object.keys(d).filter(k => {
              const v = d[k];
              if (v === undefined || v === null || v === '') return false;
              if (Array.isArray(v) && v.length === 0) return false;
              if (typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v) === '{}') return false;
              return true;
            });

            // Only apply server data if it looks like a real save (at least 3 meaningful fields)
            // This prevents wiping localStorage when server DB was reset after redeployment

            if (meaningfulKeys.length < 3) {
              console.log('[sync] Server has no meaningful saved data — keeping localStorage values');
              setCustomSoundsLoaded(true); // Mark loaded even if empty
              return;
            }

            // Apply every setting from server, falling back to current (localStorage) value
            // Apply settings from server and cache to localStorage
            // All localStorage writes are wrapped in try/catch to prevent
            // QuotaExceededError from crashing the app
            const ls = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
            if (typeof d.allowChatterVoice === 'boolean') { setAllowChatterVoice(d.allowChatterVoice); ls('chatter_voice', String(d.allowChatterVoice)); }
            if (d.prefix !== undefined) { setPrefix(d.prefix); ls('prefix', d.prefix); }
            if (d.channel !== undefined) { setChannel(d.channel); ls('ch', d.channel); }
            if (Array.isArray(d.chatterVoices) && d.chatterVoices.length > 0) { setChatterVoices(d.chatterVoices); ls('chatter_voices', JSON.stringify(d.chatterVoices)); }
            if (d.engine) { setEngine(d.engine); ls('eng', d.engine); }
            if (typeof d.voiceId === 'number') { setVoiceId(d.voiceId); ls('camb_vid', String(d.voiceId)); }
            if (typeof d.cambGender === 'number') { setCambGender(d.cambGender); ls('camb_g', String(d.cambGender)); }
            if (typeof d.cambAge === 'number') { setCambAge(d.cambAge); ls('camb_a', String(d.cambAge)); }
            if (d.browserVoice !== undefined) { setBrowserVoice(d.browserVoice); ls('bvoice', d.browserVoice); }
            if (d.fx) { setFx({ ...DEFAULT_FX, ...d.fx }); ls('fx', JSON.stringify({ ...DEFAULT_FX, ...d.fx })); }
            if (d.presetName) { setPresetName(d.presetName); ls('preset', d.presetName); }
            if (Array.isArray(d.customPresets)) { setCustomPresets(d.customPresets.map((p: any) => ({ ...p, fx: { ...DEFAULT_FX, ...p.fx } }))); ls('cpresets', JSON.stringify(d.customPresets)); }
            if (Array.isArray(d.favs)) { setFavs(d.favs); ls('favs', JSON.stringify(d.favs)); }
            if (d.allowedRoles) { setAllowedRoles(d.allowedRoles); ls('roles', d.allowedRoles); }
            if (typeof d.requirePrefix === 'boolean') { setRequirePrefix(d.requirePrefix); ls('reqprefix', String(d.requirePrefix)); }
            if (typeof d.maxChars === 'number') { setMaxChars(d.maxChars); ls('maxchars', String(d.maxChars)); }
            if (d.blacklist !== undefined) { setBlacklist(d.blacklist); ls('blacklist', d.blacklist); }
            if (d.whitelist !== undefined) { setWhitelist(d.whitelist); ls('whitelist', d.whitelist); }
            if (typeof d.userCooldown === 'number') { setUserCooldown(d.userCooldown); ls('cooldown', String(d.userCooldown)); }
            if (typeof d.queueSizeLimit === 'number') { setQueueSizeLimit(d.queueSizeLimit); ls('qlimit', String(d.queueSizeLimit)); }
            if (Array.isArray(d.mappings)) { setMappings(d.mappings); ls('mappings', JSON.stringify(d.mappings)); }
            if (Array.isArray(d.aliases)) { setAliases(d.aliases); ls('aliases', JSON.stringify(d.aliases)); }
            if (Array.isArray(d.sfx)) { setSfx(d.sfx); ls('sfx', JSON.stringify(d.sfx)); }
            if (d.subColor) { setSubColor(d.subColor); ls('subcol', d.subColor); }
            if (typeof d.subSize === 'number') { setSubSize(d.subSize); ls('subsz', String(d.subSize)); }
            if (d.subBg) { setSubBg(d.subBg); ls('subbg', d.subBg); }
            if (typeof d.useProxy === 'boolean') { setUseProxy(d.useProxy); ls('proxy', String(d.useProxy)); }
            if (d.proxyUrl !== undefined) { setProxyUrl(d.proxyUrl); ls('proxyurl', d.proxyUrl); }
            if (typeof d.advancedFilterEnabled === 'boolean') { setAdvancedFilterEnabled(d.advancedFilterEnabled); ls('adv_filter', String(d.advancedFilterEnabled)); }
            if (d.bannedWordsString !== undefined) { setBannedWordsString(d.bannedWordsString); ls('banned_words_adv', d.bannedWordsString); }
            if (d.filterMode) { setFilterMode(d.filterMode); ls('filter_mode', d.filterMode); }
            if (d.blockedUsers !== undefined) { setBlockedUsers(d.blockedUsers); ls('blocked_users', d.blockedUsers); }
            if (d.soundVolumes) { setSoundVolumes(d.soundVolumes); ls('sound_volumes', JSON.stringify(d.soundVolumes)); }
            if (typeof d.soundboardMasterVol === 'number') { setSoundboardMasterVol(d.soundboardMasterVol); ls('sb_master_vol', String(d.soundboardMasterVol)); }
            if (Array.isArray(d.customSounds)) {
              const validSounds = d.customSounds.filter((cs: any) => cs && typeof cs.name === 'string');
              setCustomSounds(validSounds);
            }
            setCustomSoundsLoaded(true);
            if (d.soundBaseUrl !== undefined) { setSoundBaseUrl(d.soundBaseUrl); ls('sound_base_url', d.soundBaseUrl); }
            if (d.soundUrlCache && typeof d.soundUrlCache === 'object') {
              setSoundUrlCache(d.soundUrlCache);
              ls('sound_url_cache', JSON.stringify(d.soundUrlCache));
            }
            if (Array.isArray(d.hiddenSounds)) { setHiddenSounds(d.hiddenSounds); ls('hidden_sounds', JSON.stringify(d.hiddenSounds)); }
            // BUG FIX: Load autoLangSwitch and darkMode from server (were missing)
            if (typeof d.autoLangSwitch === 'boolean') { setAutoLangSwitch(d.autoLangSwitch); ls('auto_lang_switch', String(d.autoLangSwitch)); }
            if (typeof d.darkMode === 'boolean') { setDarkMode(d.darkMode); ls('darkMode', String(d.darkMode)); }
            // Per-voice volume boosts — load from cloud so they persist across browser changes
            if (d.cambVoiceBoosts && typeof d.cambVoiceBoosts === 'object' && Object.keys(d.cambVoiceBoosts).length > 0) { setCambVoiceBoosts(d.cambVoiceBoosts); ls('camb_voice_boosts', JSON.stringify(d.cambVoiceBoosts)); }
            // Per-voice model/enhance/speed settings — load from cloud
            if (d.cambVoiceSettings && typeof d.cambVoiceSettings === 'object' && Object.keys(d.cambVoiceSettings).length > 0) { setCambVoiceSettings(d.cambVoiceSettings); ls('camb_voice_settings', JSON.stringify(d.cambVoiceSettings)); }
            if (Array.isArray(d.ttsHistory) && d.ttsHistory.length > 0) {
              // Only use server data if it's more than what we have locally
              const deserialized = d.ttsHistory.map((item: any) => ({ ...item, timestamp: new Date(item.timestamp) }));
              setHistory(prev => {
                if (deserialized.length > prev.length) {
                  return deserialized;
                }
                return prev;
              });
            }
            // Load persisted stats from cloud
            if (d.ttsStats && typeof d.ttsStats === 'object' && typeof d.ttsStats.total === 'number') {
              setStats(d.ttsStats);
              try { localStorage.setItem('tts_stats', JSON.stringify(d.ttsStats)); } catch {}
              // Don't rebuild chattersSet from persisted count — it's a runtime set
              // The chatters count in stats is just a historical number, not actual usernames
            }
          }
        }
      } catch {}
    })();
  }, []);

  // PERSISTENCE: Save to localStorage (cache) AND sync to server (cloud)
  // NOTE: fx, presetName, customPresets, soundVolumes, soundboardMasterVol are persisted
  // by the dedicated fxPersistRef effect (with 200ms debounce) — not duplicated here.
  useEffect(() => {
    const s: Record<string, string> = {
      ch: channel, eng: engine, camb_vid: String(voiceId), camb_g: String(cambGender), camb_a: String(cambAge),
      bvoice: browserVoice,
      roles: allowedRoles, reqprefix: String(requirePrefix), prefix, maxchars: String(maxChars),
      blacklist, whitelist, cooldown: String(userCooldown), qlimit: String(queueSizeLimit),
      mappings: JSON.stringify(mappings), aliases: JSON.stringify(aliases), sfx: JSON.stringify(sfx),
      subcol: subColor, subsz: String(subSize), subbg: subBg, proxy: String(useProxy), proxyurl: proxyUrl,
      favs: JSON.stringify(favs),
      sound_base_url: soundBaseUrl,
      adv_filter: String(advancedFilterEnabled),
      banned_words_adv: bannedWordsString,
      filter_mode: filterMode,
      blocked_users: blockedUsers,
      chatter_voice: String(allowChatterVoice),
      chatter_voices: JSON.stringify(chatterVoices),
      hidden_sounds: JSON.stringify(hiddenSounds),
      tts_stats: JSON.stringify(stats),
      // BUG FIX: autoLangSwitch and darkMode were missing from localStorage persistence
      auto_lang_switch: String(autoLangSwitch),
      darkMode: String(darkMode),
      // Per-voice volume boosts — saved to localStorage cache
      camb_voice_boosts: JSON.stringify(cambVoiceBoosts),
      // Per-voice model/enhance/speed settings — saved to localStorage cache
      camb_voice_settings: JSON.stringify(cambVoiceSettings),
    };
    // Save to localStorage (cache) — custom_sounds is NEVER written to localStorage
    // (they're too large and would exceed the 5MB quota, crashing the app).
    // All writes are wrapped in try/catch to prevent QuotaExceededError crashes.
    Object.entries(s).forEach(([k, v]) => {
      try { localStorage.setItem(k, v); } catch {
        // QuotaExceededError — silently skip. The server has the real data.
      }
    });
    // Also sync all settings to server cloud (debounced)
    // customSounds are synced separately to avoid huge payloads
    syncAllSettingsToServer();
  }, [channel, engine, voiceId, cambGender, cambAge, browserVoice,
    allowedRoles, requirePrefix, prefix, maxChars, blacklist, whitelist, userCooldown, queueSizeLimit,
    mappings, aliases, sfx, subColor, subSize, subBg, useProxy, proxyUrl, favs, soundBaseUrl,
    advancedFilterEnabled, bannedWordsString, filterMode, blockedUsers, allowChatterVoice, chatterVoices,
    hiddenSounds, stats, syncAllSettingsToServer, autoLangSwitch, darkMode, cambVoiceBoosts]);

  // CUSTOM SOUNDS: These are managed exclusively through:
  //   - POST /api/sfx-upload (add individually — avoids Vercel's 4.5MB body limit)
  //   - DELETE /api/settings (remove by ID)
  //   - GET /api/settings (load all on mount)
  // They are NEVER sent via the general settings sync PUT (which caused data loss
  // when Vercel truncated the large base64 payload, and the server did DELETE ALL + partial INSERT)

  // Persist history to localStorage
  useEffect(() => {
    try {
      const serialized = history.map(item => ({
        ...item,
        timestamp: item.timestamp.toISOString(),
      }));
      localStorage.setItem('tts_history', JSON.stringify(serialized));
    } catch {}
  }, [history]);

  useEffect(() => { logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight }); }, [logs]);
  useEffect(() => { queueRef.current = queue; queueLenRef.current = queue.length; }, [queue]);
  useEffect(() => { voicesRef.current = voices; }, [voices]);
  useEffect(() => { sysVoicesRef.current = sysVoices; }, [sysVoices]);
  
  useEffect(() => {
    settingsRef.current = {
      sfx, requirePrefix, prefix, whitelist, allowedRoles, userCooldown,
      queueSizeLimit, maxChars, mappings, engine, voiceId, browserVoice, fx, presetName, customPresets, fxEnabled, aliases, blacklist,
      advancedFilterEnabled, bannedWordsString, filterMode, blockedUsers,
      allowChatterVoice, chatterVoices,
    };
  });

  useEffect(() => {
    return () => {
      try { clientRef.current?.disconnect(); } catch {}
      try { playRef.current?.stop(); } catch {}
      try { window.speechSynthesis?.cancel(); } catch {}
      // Clean up any orphaned SFX audio elements
      activeSfxRef.current.forEach(audio => { try { audio.pause(); audio.src = ''; } catch {} });
      activeSfxRef.current = [];
      // BUG FIX: Clean up soundboard active sound on unmount
      if (activeSoundRef.current) { try { activeSoundRef.current.pause(); } catch {} activeSoundRef.current = null; }
      // BUG FIX: Clean up celebration timer on unmount
      if (celebratingTimerRef.current !== null) clearTimeout(celebratingTimerRef.current);
      // BUG FIX: Clean up toast auto-dismiss timers on unmount
      toastTimersRef.current.forEach(timer => clearTimeout(timer));
      toastTimersRef.current.clear();
    };
  }, []);

  // PERSISTENCE: Save stats to cloud on page unload/visibility change
  // This ensures stats survive even if the user closes the tab
  useEffect(() => {
    const saveStats = () => {
      try {
        const statsData = JSON.stringify({ ttsStats: { total: stats.total, chatters: stats.chatters, avgChars: stats.avgChars, peakQ: stats.peakQ } });
        // BUG FIX: sendBeacon always sends POST, but /api/settings only accepts PUT.
        // Use fetch with keepalive instead, which supports PUT and still works during page unload.
        try {
          fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: statsData,
            keepalive: true, // Ensures the request survives page unload
          });
        } catch {}
        // Also save to localStorage immediately
        localStorage.setItem('tts_stats', JSON.stringify(stats));
      } catch {}
    };
    const handleBeforeUnload = () => { saveStats(); };
    const handleVisibilityChange = () => { if (document.visibilityState === 'hidden') saveStats(); };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stats]);

  const log = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(p => [...p.slice(-120), `[${t}] ${msg}`]);
  }, []);

  // ──── Feature 5: Voice Preview on Hover ────
  const voicePreviewUrlRef = useRef<string | null>(null); // BUG FIX: Track object URL for cleanup
  const startVoicePreview = useCallback((voiceId: number) => {
    if (voicePreviewTimerRef.current) { clearTimeout(voicePreviewTimerRef.current); voicePreviewTimerRef.current = null; }
    voicePreviewTimerRef.current = setTimeout(async () => {
      // BUG FIX: Revoke previous object URL to prevent memory leak
      if (voicePreviewUrlRef.current) { try { URL.revokeObjectURL(voicePreviewUrlRef.current); } catch {} voicePreviewUrlRef.current = null; }
      if (voicePreviewCache.current.has(voiceId)) {
        const blob = voicePreviewCache.current.get(voiceId)!;
        const url = URL.createObjectURL(blob);
        voicePreviewUrlRef.current = url;
        const audio = new Audio(url);
        voicePreviewAudioRef.current = audio;
        setPreviewingVoiceId(voiceId);
        audio.onended = () => { setPreviewingVoiceId(null); URL.revokeObjectURL(url); voicePreviewUrlRef.current = null; };
        audio.onerror = () => { setPreviewingVoiceId(null); URL.revokeObjectURL(url); voicePreviewUrlRef.current = null; };
        audio.play().catch(() => setPreviewingVoiceId(null));
      } else {
        try {
          const keyIdx = voiceKeyMap.find(m => m.voiceId === voiceId)?.keyIndex ?? 0;
          const blob = await generateCambTTSServer('Hello there', voiceId, keyIdx, cambGender, cambAge, 'en', 3,
            cambVoiceSettingsRef.current[voiceId]?.model,
            cambVoiceSettingsRef.current[voiceId]?.enhance,
            cambVoiceSettingsRef.current[voiceId]?.speakingRate,
          );
          if (blob) {
            voicePreviewCache.current.set(voiceId, blob);
            // BUG FIX: Limit cache size to prevent unbounded memory growth
            if (voicePreviewCache.current.size > 30) {
              const oldestKey = voicePreviewCache.current.keys().next().value;
              if (oldestKey !== undefined) voicePreviewCache.current.delete(oldestKey);
            }
            if (voicePreviewAudioRef.current) { try { voicePreviewAudioRef.current.pause(); } catch {} }
            const url = URL.createObjectURL(blob);
            voicePreviewUrlRef.current = url;
            const audio = new Audio(url);
            voicePreviewAudioRef.current = audio;
            setPreviewingVoiceId(voiceId);
            audio.onended = () => { setPreviewingVoiceId(null); URL.revokeObjectURL(url); voicePreviewUrlRef.current = null; };
            audio.onerror = () => { setPreviewingVoiceId(null); URL.revokeObjectURL(url); voicePreviewUrlRef.current = null; };
            audio.play().catch(() => setPreviewingVoiceId(null));
          }
        } catch { setPreviewingVoiceId(null); }
      }
    }, 600);
  }, [voiceKeyMap, cambGender, cambAge]);
  const cancelVoicePreview = useCallback(() => {
    if (voicePreviewTimerRef.current) { clearTimeout(voicePreviewTimerRef.current); voicePreviewTimerRef.current = null; }
    if (voicePreviewAudioRef.current) { try { voicePreviewAudioRef.current.pause(); voicePreviewAudioRef.current = null; } catch {} }
    setPreviewingVoiceId(null);
  }, []);

  // ──── Feature 6: Filtered Leaderboard by Time ────
  const filteredLeaderboard = useMemo(() => {
    if (lbTimeRange === 'all') return leaderboard;
    const now = Date.now();
    const cutoff = lbTimeRange === 'today' ? now - 86400000 : now - 604800000;
    const filtered: LeaderboardData = { chatters: {}, voices: {}, presets: {} };
    // BUG FIX: Only include voices/presets from chatters within the time range.
    // Previously, ALL voices and presets were copied regardless of the time filter,
    // making the "today" and "week" filters show all-time voice/preset counts.
    const activeVoiceCounts: Record<string, number> = {};
    const activePresetCounts: Record<string, number> = {};
    for (const [user, data] of Object.entries(leaderboard.chatters)) {
      if (data.lastTimestamp && data.lastTimestamp >= cutoff) {
        filtered.chatters[user] = data;
        // Accumulate voice/preset counts only for active chatters
        activeVoiceCounts[data.lastVoice] = (activeVoiceCounts[data.lastVoice] || 0) + data.count;
        activePresetCounts[data.lastPreset] = (activePresetCounts[data.lastPreset] || 0) + data.count;
      }
    }
    // BUG FIX: Only copy voice/preset counts for voices/presets used by chatters
    // within the selected time range, instead of copying all counts unconditionally.
    for (const [voice, count] of Object.entries(activeVoiceCounts)) { filtered.voices[voice] = count; }
    for (const [preset, count] of Object.entries(activePresetCounts)) { filtered.presets[preset] = count; }
    return filtered;
  }, [leaderboard, lbTimeRange]);

  // ──── Feature 7: Export History/Leaderboard ────
  const exportHistoryCSV = useCallback(() => {
    const header = 'User,Engine,Voice,Text,Timestamp\n';
    const rows = history.map(h =>
      `"${h.user}","${h.engine}","${h.voiceDisplayName || h.voice}","${h.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ').replace(/"/g, '""')}","${h.timestamp.toISOString()}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `tts-history-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addToast('History exported as CSV', 'success');
  }, [history, addToast]);
  const exportHistoryJSON = useCallback(() => {
    const data = history.map(h => ({ user: h.user, engine: h.engine, voice: h.voiceDisplayName || h.voice, text: h.chunks.filter(c => c.type === 'text').map(c => c.content).join(' '), timestamp: h.timestamp.toISOString() }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `tts-history-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addToast('History exported as JSON', 'success');
  }, [history, addToast]);
  const exportLeaderboardCSV = useCallback(() => {
    const header = 'User,Count,LastVoice,LastPreset\n';
    const rows = Object.entries(leaderboard.chatters).sort((a, b) => b[1].count - a[1].count).map(([u, d]) => `"${u}",${d.count},"${d.lastVoice}","${d.lastPreset}"`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `tts-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addToast('Leaderboard exported as CSV', 'success');
  }, [leaderboard, addToast]);
  const exportLeaderboardJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(leaderboard, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `tts-leaderboard-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addToast('Leaderboard exported as JSON', 'success');
  }, [leaderboard, addToast]);

  // ──── Feature 9: Preset Import ────
  const importPresetFromCode = useCallback((code: string): string | null => {
    try {
      const json = decodeURIComponent(atob(code));
      const parsed = JSON.parse(json);
      if (!parsed.n || typeof parsed.n !== 'string') return 'Invalid code: missing preset name';
      if (!parsed.f || typeof parsed.f !== 'object') return 'Invalid code: missing FX settings';
      const fxSettings = { ...DEFAULT_FX, ...parsed.f };
      setCustomPresets(prev => {
        const existing = prev.findIndex(p => p.name === parsed.n);
        const newPreset: SavedPreset = { name: parsed.n, fx: fxSettings };
        if (existing >= 0) { const updated = [...prev]; updated[existing] = newPreset; return updated; }
        return [...prev, newPreset];
      });
      addToast(`Imported preset "${parsed.n}"`, 'success');
      return null;
    } catch { return 'Invalid share code — could not decode'; }
  }, [addToast]);

  // ──── Feature 3: Queue Management ────
  const shuffleQueue = useCallback(() => {
    setQueue(prev => {
      const arr = [...prev];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
    addToast('Queue shuffled', 'info');
  }, [addToast]);
  const moveQueueItemToFront = useCallback((id: string) => {
    setQueue(prev => {
      const item = prev.find(x => x.id === id);
      if (!item) return prev;
      return [item, ...prev.filter(x => x.id !== id)];
    });
  }, []);
  const removeQueueItem = useCallback((id: string) => {
    setQueue(prev => prev.filter(x => x.id !== id));
  }, []);
  const avgTTSDuration = useMemo(() => {
    if (history.length < 3) return 8;
    return Math.max(3, Math.min(15, history.slice(0, 10).reduce((sum, h) => {
      const charLen = h.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ').length;
      return sum + (charLen / 150) * 10;
    }, 0) / Math.min(history.length, 10)));
  }, [history]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      setSysVoices(v);
      if (v[0]) setBrowserVoice(pv => pv || v[0].name);
    };
    load();
    // BUG FIX: Use addEventListener instead of direct property assignment.
    // Direct assignment (onvoiceschanged = load) can be overwritten by other code.
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => { window.speechSynthesis.removeEventListener('voiceschanged', load); };
  }, []);

  // Feature 6: Header parallax on scroll — useMotionValue approach
  useEffect(() => {
    const handleScroll = () => headerScrollY.set(window.scrollY);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [headerScrollY]);

  // Feature 11: Register service worker on mount
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        // Listen for messages from the service worker
        if (reg.active) {
          reg.active.postMessage({ type: 'REQUEST_CACHE_COUNT' });
        }
      }).catch(() => {});
      // Listen for cache count messages from SW
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'CACHE_COUNT') {
          setAudioCacheCount(event.data.count || 0);
        }
      };
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }
    // Check cache stats periodically
    const checkCache = async () => {
      if ('caches' in window) {
        try {
          const cache = await caches.open('chatgbt-audio-cache-v2');
          const keys = await cache.keys();
          setAudioCacheCount(keys.length);
        } catch {}
      }
    };
    checkCache();
    const interval = setInterval(checkCache, 30000);
    return () => clearInterval(interval);
  }, []);

  // Feature 9: Persist autoLangSwitch setting
  useEffect(() => {
    localStorage.setItem('auto_lang_switch', String(autoLangSwitch));
  }, [autoLangSwitch]);

  // Hash routing listener
  useEffect(() => {
    const onHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (isAdmin) {
      const t = setTimeout(() => loadVoices(), 900);
      return () => clearTimeout(t);
    }
  }, [isAdmin]);

  // ==================== VOICES ====================
  const loadVoices = async () => {
    if (!isAdmin) return;
    setFetching(true);

    try {
      // Server-side mode: use API routes (keys stored in env vars, never exposed to browser)
      log('Loading voices from server API...');
      const data = await fetchCambVoicesServer();
      // Deduplicate by voice ID AND name in case server returns duplicates
      // (same key entered twice → same ID; different keys → same voice with different IDs)
      const seenVoiceIds = new Set<number>();
      const seenVoiceNames = new Set<string>();
      const dedupedVoices = data.voices.filter((v: CambVoice) => {
        const vid = Number(v.id);
        const nameKey = v.voice_name.toLowerCase().trim();
        if (seenVoiceIds.has(vid)) return false;
        if (seenVoiceNames.has(nameKey)) return false;
        seenVoiceIds.add(vid);
        seenVoiceNames.add(nameKey);
        return true;
      });
      setVoices(dedupedVoices);
      setVoiceKeyMap(data.voiceKeyMap);
      setServerKeyCount(data.keyCount);
      log(`Loaded ${data.voices.length} voices from ${data.keyCount} server key(s).`);
      if (data.errors && data.errors.length > 0) {
        log(`Server key errors: ${data.errors.join(', ')}`);
      }
      if (data.voices.length > 0 && !data.voices.some(v => v.id === voiceId)) {
        setVoiceId(data.voices[0].id);
      }
    } catch (e: any) {
      log(`Voice load failed: ${e.message || e}`);
    } finally {
      setFetching(false);
    }
  };

  const toggleFav = (id: number) => setFavs(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const favVoices = useMemo(() => voices.filter(v => favs.includes(v.id)), [voices, favs]);
  const voiceSearchLower = voiceSearch.toLowerCase();
  const filteredVoices = useMemo(() => voices
    .filter(v => v.voice_name.toLowerCase().includes(voiceSearchLower) || String(v.id).includes(voiceSearch))
    .sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0) || a.voice_name.localeCompare(b.voice_name)),
    [voices, voiceSearch, voiceSearchLower, favs]
  );

  const connect = () => {
    if (!channel.trim()) return log('Enter channel name');
    clientRef.current?.disconnect();
    recentMessagesRef.current = {};
    const c = new TwitchIRCClient({
      channel,
      onMessage: (msg) => {
        const s = settingsRef.current;
        const raw = msg.message.trim();
        const tokens = raw.toLowerCase().split(/\s+/);
        const username = msg.user.toLowerCase();

        // ═══════════════════════════════════════════
        // LAYER 1: Hard blocklist (always enforced)
        // ═══════════════════════════════════════════
        const blockedList = s.blockedUsers.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
        if (blockedList.includes(username) && !msg.isBroadcaster) {
          log(`BLOCKED: ${msg.user} (user blocklist)`);
          return;
        }

        // ═══════════════════════════════════════════
        // LAYER 2: SFX trigger check
        // Only triggers on messages that are standalone SFX commands,
        // not messages that contain SFX words inside TTS text.
        // ═══════════════════════════════════════════
        const sfxHit = s.sfx.find(a => tokens.includes(a.word.toLowerCase()));
        // Only trigger SFX if: prefix is NOT required, OR the message starts with the prefix
        const hasValidPrefix = !s.requirePrefix || raw.toLowerCase().startsWith(s.prefix.toLowerCase());
        if (sfxHit && hasValidPrefix) {
          triggerSfx(sfxHit.url, sfxHit.volume);
          return;
        }

        // ═══════════════════════════════════════════
        // LAYER 3: Prefix check
        // Supports flexible prefix matching:
        //   - Exact match: "!tts hello" matches prefix "!tts"
        //   - Also accepts common Twitch command chars (, ! . /) as the first character
        //     So if prefix is "!tts", ",tts" and ".tts" and "/tts" also work
        //   - Case-insensitive matching
        // ═══════════════════════════════════════════
        let text = '';
        if (s.requirePrefix) {
          const prefixLower = s.prefix.toLowerCase();
          const rawLower = raw.toLowerCase();
          // Direct match
          if (rawLower.startsWith(prefixLower)) {
            text = raw.slice(s.prefix.length).trim();
          } else {
            // Flexible prefix: if the configured prefix starts with ! , . /, also accept
            // other common Twitch command prefixes with the same command body
            // e.g. "!tts" also matches ",tts" and ".tts" and "/tts"
            const prefixBody = prefixLower.replace(/^[!.,\/]/, ''); // "tts" from "!tts"
            const prefixChar = prefixLower[0]; // "!" from "!tts"
            if (prefixBody && /^[!.,\/]/.test(rawLower[0] || '')) {
              const altPrefixes = ['!', ',', '.', '/'].map(c => c + prefixBody);
              const match = altPrefixes.find(p => rawLower.startsWith(p));
              if (match) {
                text = raw.slice(match.length).trim();
              } else {
                return; // No prefix match
              }
            } else {
              return; // No prefix match
            }
          }
        } else { text = raw; }
        if (!text) return;

        // ═══════════════════════════════════════════
        // LAYER 3.25: Chatter Modulator Preset Selection
        // !tts #Helium# message → applies Helium FX preset
        // !tts #Helium# VoiceName: message → applies Helium FX + voice
        // ═══════════════════════════════════════════
        let chatterPresetOverride: string | null = null;
        {
          const allPresetNames = [...Object.keys(PRESETS), ...customPresetsRef.current.map(p => p.name)];
          const { presetName: extractedPreset, remainingText } = parsePresetPrefix(text, allPresetNames);
          if (extractedPreset) {
            chatterPresetOverride = extractedPreset;
            text = remainingText;
            log(`FX preset override: ${msg.user} → ${extractedPreset}`);
          }
        }

        // ═══════════════════════════════════════════
        // LAYER 3.5: Chatter Voice Selection
        // !tts Voice_Name: message → uses that voice
        // ═══════════════════════════════════════════
        let chatterVoiceOverride: { engine: Engine; voice: string; displayName: string } | null = null;
        {
          const { voiceAlias, messageText } = parseVoicePrefix(text);
          if (voiceAlias && messageText) {
            if (s.allowChatterVoice) {
              const lookup = lookupVoiceByAlias(
                voiceAlias,
                voicesRef.current,
                sysVoicesRef.current,
                s.engine,
                s.voiceId,
                s.browserVoice,
              );
              if (lookup.found) {
                chatterVoiceOverride = { engine: lookup.engine, voice: lookup.voice, displayName: lookup.voiceDisplayName };
                text = messageText;
                log(`Voice override: ${msg.user} → ${lookup.voiceDisplayName} (${lookup.engine})`);
              } else {
                log(`Voice not found: "${voiceAlias}" — no match among ${voicesRef.current.length} camb + ${sysVoicesRef.current.length} browser voices. Treating as regular message.`);
              }
            } else {
              log(`Voice prefix "${voiceAlias}:" detected but Chatter Voice Selection is OFF. Enable it in Rules tab.`);
            }
          }
        }

        // ═══════════════════════════════════════════
        // LAYER 4: Whitelist / Role check
        // ═══════════════════════════════════════════
        if (s.whitelist.trim()) {
          const users = s.whitelist.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
          if (!users.includes(username)) { log(`Ignored ${msg.user} (not whitelisted)`); return; }
        } else {
          if (s.allowedRoles === 'broadcaster' && !msg.isBroadcaster) { log(`Ignored ${msg.user} (rank)`); return; }
          if (s.allowedRoles === 'mods_broadcaster' && !msg.isMod && !msg.isBroadcaster) { log(`Ignored ${msg.user} (rank)`); return; }
          if (s.allowedRoles === 'subs_vip_mods' && !msg.isSubscriber && !msg.isVip && !msg.isMod && !msg.isBroadcaster) { log(`Ignored ${msg.user} (rank)`); return; }
        }

        // ═══════════════════════════════════════════
        // LAYER 5: Per-user Cooldown
        // ═══════════════════════════════════════════
        if (s.userCooldown > 0) {
          const now = Date.now();
          const last = timestampsRef.current[username] || 0;
          if ((now - last) / 1000 < s.userCooldown) { log(`Cooldown: ${msg.user}`); return; }
          timestampsRef.current[username] = now;
        }

        // ═══════════════════════════════════════════
        // LAYER 6: Spam Detection
        // ═══════════════════════════════════════════
        const recentMsgs = recentMessagesRef.current[username] || [];
        const spamResult = detectSpam(text, recentMsgs);
        if (spamResult.isSpam) {
          log(`SPAM BLOCKED: ${msg.user} (score: ${spamResult.score}, reason: ${spamResult.reason})`);
          return;
        }
        // Track recent messages (keep last 5)
        recentMessagesRef.current[username] = [text, ...recentMsgs].slice(0, 5);

        // Queue size check
        if (queueLenRef.current >= s.queueSizeLimit) { log(`Queue full: ${msg.user}`); return; }

        // ═══════════════════════════════════════════
        // LAYER 7: Advanced Profanity Filter
        // ═══════════════════════════════════════════
        let processed = text;
        
        // Apply slang/alias replacements first
        s.aliases.forEach(a => { if (a.from.trim()) processed = processed.replace(new RegExp(`\\b${escapeRegex(a.from)}\\b`, 'gi'), a.to); });
        
        // Advanced filter (leetspeak/unicode bypass detection)
        if (s.advancedFilterEnabled) {
          const bannedWords = s.bannedWordsString.split(',').map(w => w.trim()).filter(Boolean);
          if (bannedWords.length > 0) {
            const filterResult = filterProfanity(processed, bannedWords, { mode: s.filterMode as 'censor' | 'block' });
            if (filterResult.severity === 'blocked') {
              log(`BLOCKED: ${msg.user} (banned word detected: ${filterResult.matchedWords.join(', ')})`);
              return;
            }
            if (filterResult.wasFiltered) {
              processed = filterResult.filtered;
              log(`FILTERED: ${msg.user} (censored: ${filterResult.matchedWords.join(', ')})`);
            }
          }
        } else {
          // Legacy simple blacklist
          s.blacklist.split(',').map(w => w.trim()).filter(Boolean).forEach(w => {
            processed = processed.replace(new RegExp(`\\b${escapeRegex(w)}\\b`, 'gi'), '[censored]');
          });
        }
        
        // Parse inline sound effects using brackets ()
        // BUG FIX: Use customSoundsRef instead of customSounds to avoid stale closure.
        // The onMessage callback is created once when connect() is called, so it
        // captures the customSounds value at that time. Using the ref ensures we
        // always parse with the latest custom sounds list.
        let chunks = parseInlineSfx(processed, customSoundsRef.current);
        // Enforce max chars on text chunks only
        let charCount = 0;
        chunks = chunks.map(c => {
          if (c.type === 'text') {
            if (charCount + c.content.length > s.maxChars) {
              const remaining = s.maxChars - charCount;
              const truncated = remaining > 0 ? c.content.slice(0, remaining) + '...' : '';
              charCount = s.maxChars;
              return { ...c, content: truncated };
            }
            charCount += c.content.length;
          }
          return c;
        }).filter(c => c.content.length > 0);

        // If all text was filtered/censored out, don't queue
        const hasText = chunks.some(c => c.type === 'text' && c.content.replace(/\[censored\]/g, '').trim().length > 0);
        if (!hasText && chunks.every(c => c.type !== 'sfx')) return;

        const map = s.mappings.find(m => m.username.toLowerCase() === username);
        // Priority for FX: Chatter #Preset# override > User mapping preset > Admin's default FX
        // If the chatter doesn't specify #PresetName#, the admin's current FX preset applies.
        // Priority for voice: Chatter voice override > User mapping > Default settings
        let mappedEngine: Engine;
        let mappedVoice: string;
        let mappedFx: FXSettings;

        if (chatterPresetOverride) {
          // Chatter explicitly chose a preset via #PresetName# — this overrides everything
          // FIX: Custom override checked FIRST, then built-in preset, then fallback.
          // Previously PRESETS[name] was checked first, so custom saves for built-in
          // presets (like Demon) were always ignored.
          const customPreset = customPresetsRef.current.find(p => p.name.toLowerCase() === chatterPresetOverride.toLowerCase());
          if (customPreset) {
            mappedFx = { ...DEFAULT_FX, ...customPreset.fx };
          } else if (PRESETS[chatterPresetOverride]) {
            mappedFx = { ...PRESETS[chatterPresetOverride] };
          } else {
            mappedFx = s.fx;
          }
          // Voice: chatter voice override > user mapping > default
          if (chatterVoiceOverride) {
            mappedEngine = chatterVoiceOverride.engine;
            mappedVoice = chatterVoiceOverride.voice;
          } else if (map) {
            mappedEngine = map.engine;
            mappedVoice = map.voice;
          } else {
            mappedEngine = s.engine;
            mappedVoice = s.engine === 'camb' ? String(s.voiceId) : s.browserVoice;
          }
        } else if (chatterVoiceOverride) {
          // Chatter chose a voice but no preset → admin's FX applies
          mappedEngine = chatterVoiceOverride.engine;
          mappedVoice = chatterVoiceOverride.voice;
          mappedFx = s.fx;
        } else if (map) {
          // User has a specific mapping → use mapping's preset FX
          mappedEngine = map.engine;
          mappedVoice = map.voice;
          mappedFx = (() => {
            // Check for custom override of the built-in preset
            // FIX: Use customPresetsRef (live local state) instead of s.customPresets (server settings)
            // so the user's latest saved overrides are applied, not stale server data.
            const customOverride = customPresetsRef.current.find(p => p.name === map.preset);
            if (customOverride) return { ...DEFAULT_FX, ...customOverride.fx };
            return PRESETS[map.preset] ? { ...PRESETS[map.preset] } : s.fx;
          })();
        } else {
          // No overrides → admin's voice + admin's FX
          mappedEngine = s.engine;
          mappedVoice = s.engine === 'camb' ? String(s.voiceId) : s.browserVoice;
          mappedFx = s.fx;
        }

        // If effects rack is OFF, use clean FX (unless chatter explicitly chose a #PresetName#)
        // FIX: Also check for custom clean override so saved volume persists even with FX off
        if (!s.fxEnabled && !chatterPresetOverride) {
          const cleanOverride = customPresetsRef.current.find(p => p.name.toLowerCase() === 'clean');
          mappedFx = cleanOverride ? { ...DEFAULT_FX, ...cleanOverride.fx } : { ...PRESETS.clean };
        }

        let keyUsed = '';
        if (mappedEngine === 'camb') {
          const activeVoice = voicesRef.current.find(v => v.id === Number(mappedVoice));
          keyUsed = activeVoice?.apiKeyOwner != null ? String(activeVoice.apiKeyOwner) : '';
        }

        const sfxInMsg = chunks.filter(c => c.type === 'sfx').map(c => c.content);
        const sfxLog = sfxInMsg.length > 0 ? ` + [${sfxInMsg.join(', ')}]` : '';

        setQueue(p => [...p, {
          id: genId(), user: msg.user, engine: mappedEngine,
          voice: mappedVoice, fx: { ...mappedFx }, timestamp: new Date(),
          cambKeyUsed: keyUsed, chunks,
          voiceDisplayName: chatterVoiceOverride?.displayName || undefined,
        }]);
        const voiceLabel = chatterVoiceOverride ? ` [${chatterVoiceOverride.displayName}]` : '';
        const presetLabel = chatterPresetOverride ? ` <${chatterPresetOverride}>` : '';
        log(`Queued: ${msg.user}${voiceLabel}${presetLabel}${sfxLog}`);
      },
      onStatusChange: (s) => setStatus(s),
      onLog: log,
      onLatencyUpdate: (latencyMs) => setTwitchLatency(latencyMs),
    });
    clientRef.current = c;
    c.connect();
    addToast('Connecting to Twitch...', 'info', 3000);
  };

  const disconnect = () => { clientRef.current?.disconnect(); clientRef.current = null; setStatus('disconnected'); log('Disconnected.'); addToast('Disconnected from Twitch', 'warning'); };

  // ==================== TTS PROCESSING ====================
  // Safety: If playingFlag gets stuck true for >30s (e.g. browser tab was backgrounded
  // and audio context was killed by the browser), force-reset so queue doesn't freeze.
  // Only resets the flag — does NOT call setPlaying(null) to avoid race condition with
  // an in-flight processQueue whose finally block would then kill the next item.
  const playingStartTimeRef = useRef<number>(0);
  const stuckRecoveryGenerationRef = useRef<number>(0); // track which processQueue run set the flag
  useEffect(() => {
    const interval = setInterval(() => {
      if (playingFlag.current && playingStartTimeRef.current > 0) {
        const stuckMs = Date.now() - playingStartTimeRef.current;
        if (stuckMs > 30000) { // 30 seconds (was 2 minutes — too long, caused excessive delays)
          console.warn('[TTS] playingFlag stuck for 2min — force resetting flag only');
          playingFlag.current = false;
          playingStartTimeRef.current = 0;
          stuckRecoveryGenerationRef.current += 1;
          // Stop any active audio source
          try { playRef.current?.stop(); } catch {}
          try { window.speechSynthesis?.cancel(); } catch {}
          activeSfxRef.current.forEach(audio => { try { audio.pause(); audio.currentTime = 0; } catch {} });
          activeSfxRef.current = [];
          playRef.current = null;
          // Clear playing state AFTER stopping audio — this triggers processQueue via useEffect
          setPlaying(null);
          setSubText(''); setSubUser('');
          log('Recovered from stuck playback.');
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const processQueue = useCallback(async () => {
    if (playingFlag.current || queue.length === 0) return;
    playingFlag.current = true;
    playingStartTimeRef.current = Date.now();
    const thisGeneration = ++stuckRecoveryGenerationRef.current; // unique ID for this processQueue run
    const item = queue[0];
    setQueue(p => p.slice(1));
    queueLenRef.current = Math.max(0, queueLenRef.current - 1);
    setPlaying(item);

    const isInternal = item.user === 'Test' || item.user === 'Operator';
    if (!isInternal) chattersSetRef.current.add(item.user.toLowerCase());
    
    const totalText = item.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ');
    setStats(p => ({
      total: p.total + 1,
      chatters: chattersSetRef.current.size,
      avgChars: Math.round((p.avgChars * p.total + totalText.length) / (p.total + 1)),
      peakQ: Math.max(p.peakQ, queueLenRef.current),
    }));

    // ──── Update TTS Leaderboard ────
    const voiceName = item.voiceDisplayName
      || (item.engine === 'camb' ? voicesRef.current.find(v => v.id === Number(item.voice))?.voice_name : item.voice)
      || item.voice;
    // Determine the preset used (from the FX settings, find matching preset name)
    const matchedPreset = Object.entries(PRESETS).find(([, fx]) => {
      return fx.pitch === item.fx.pitch && fx.megaphone === item.fx.megaphone && fx.robotFrequency === item.fx.robotFrequency;
    })?.[0] || 'custom';
    setLeaderboard(prev => {
      const userKey = item.user.toLowerCase();
      const updatedChatters = { ...prev.chatters };
      updatedChatters[userKey] = {
        count: (updatedChatters[userKey]?.count || 0) + 1,
        lastVoice: voiceName,
        lastPreset: matchedPreset,
        lastTimestamp: Date.now(),
      };
      const updatedVoices = { ...prev.voices };
      updatedVoices[voiceName] = (updatedVoices[voiceName] || 0) + 1;
      const updatedPresets = { ...prev.presets };
      updatedPresets[matchedPreset] = (updatedPresets[matchedPreset] || 0) + 1;
      return { chatters: updatedChatters, voices: updatedVoices, presets: updatedPresets };
    });

    // Declare effective vars for logging (set later in autoLangSwitch block)
    let effectiveEngine = item.engine;
    let effectiveVoiceDisplayName = voiceName;
    log(`Speaking: ${item.user} via ${effectiveEngine} [${effectiveVoiceDisplayName}]`);
    try {
      // ==================== PRE-FETCH PHASE ====================
      // For Camb.ai: fetch ALL text chunk audio blobs in parallel BEFORE playing anything.
      // This eliminates the 10-15s delay between chunks caused by sequential API calls.
      // For SFX: pre-load the first fallback URL for each sound effect.
      const prefetched = new Map<number, Blob>(); // chunk index → audio blob
      const prefetchedSfx = new Map<number, string[]>(); // chunk index → resolved URLs
      
      // ──── Feature 9: Multi-Language TTS Auto-Switch ────
      // When autoLangSwitch is enabled, detect the text language and find a compatible voice
      effectiveEngine = item.engine;
      let effectiveVoice = item.voice;
      effectiveVoiceDisplayName = item.voiceDisplayName || voiceName;
      let detectedLocale: string | null = null; // Hoisted so non-English guard below can access it

      if (autoLangSwitchRef.current) {
        const firstText = item.chunks.find(c => c.type === 'text')?.content || '';
        if (firstText) {
          detectedLocale = detectLanguage(firstText);
          const locale = detectedLocale; // Local const for TypeScript null-safety inside this block
          const isNonEnglish = locale !== 'en-us';

          if (isNonEnglish && locale) {
            // For browser TTS: find a voice matching the detected locale
            if (item.engine === 'webspeech') {
              const currentVoiceObj = sysVoicesRef.current.find(v => v.name === item.voice);
              const currentLang = currentVoiceObj?.lang?.toLowerCase() || '';
              // Check if current voice already matches the detected language
              if (!currentLang.startsWith(locale.split('-')[0])) {
                const compatibleVoice = sysVoicesRef.current.find(v =>
                  v.lang.toLowerCase().startsWith(locale.split('-')[0])
                );
                if (compatibleVoice) {
                  effectiveVoice = compatibleVoice.name;
                  effectiveVoiceDisplayName = compatibleVoice.name;
                  log(`Auto-switched voice: ${compatibleVoice.name} (${compatibleVoice.lang}) for detected ${locale}`);
                }
              }
            }
            // For Camb.ai: check if the voice has a matching language field, or fall back to browser TTS
            if (item.engine === 'camb') {
              const currentCambVoice = voicesRef.current.find(v => v.id === Number(item.voice));
              // Type guard: Camb.ai API sometimes returns language as array or non-string
              const safeLang = (lang: unknown): string => {
                if (typeof lang === 'string') return lang;
                if (Array.isArray(lang) && lang.length > 0 && typeof lang[0] === 'string') return lang[0];
                return '';
              };
              const currentVoiceLang = safeLang(currentCambVoice?.language).toLowerCase();
              // Check if current Camb voice already matches
              if (currentVoiceLang && !currentVoiceLang.startsWith(locale.split('-')[0])) {
                // Try to find a Camb voice with matching language
                const compatibleCamb = voicesRef.current.find(v =>
                  safeLang(v.language).toLowerCase().startsWith(locale.split('-')[0])
                );
                if (compatibleCamb) {
                  effectiveVoice = String(compatibleCamb.id);
                  effectiveVoiceDisplayName = compatibleCamb.voice_name;
                  log(`Auto-switched Camb voice: ${compatibleCamb.voice_name} for detected ${locale}`);
                } else {
                  // No compatible Camb voice — fall back to browser TTS for this item
                  const compatibleBrowser = sysVoicesRef.current.find(v =>
                    v.lang.toLowerCase().startsWith(locale.split('-')[0])
                  );
                  if (compatibleBrowser) {
                    effectiveEngine = 'webspeech';
                    effectiveVoice = compatibleBrowser.name;
                    effectiveVoiceDisplayName = compatibleBrowser.name;
                    log(`Auto-switched to browser TTS: ${compatibleBrowser.name} (${compatibleBrowser.lang}) for detected ${locale}`);
                  }
                }
              }
            }
          }
        }
      }

      // Non-English language guard: Camb.ai /tts-stream returns 422 for non-English text
      // If we detected a non-English language AND didn't find a compatible Camb voice,
      // fall back to browser TTS BEFORE burning all API keys with doomed requests.
      if (effectiveEngine === 'camb' && detectedLocale && !detectedLocale.startsWith('en')) {
        const safeLang2 = (lang: unknown): string => {
          if (typeof lang === 'string') return lang;
          if (Array.isArray(lang) && lang.length > 0 && typeof lang[0] === 'string') return lang[0];
          return '';
        };
        const currentCambVoice = voicesRef.current.find(v => v.id === Number(effectiveVoice));
        const voiceLang = safeLang2(currentCambVoice?.language).toLowerCase();
        if (!voiceLang.startsWith(detectedLocale.split('-')[0])) {
          // No compatible Camb voice for this language — switch to browser TTS
          const compatibleBrowser = sysVoicesRef.current.find(v =>
            v.lang.toLowerCase().startsWith(detectedLocale.split('-')[0])
          );
          if (compatibleBrowser) {
            log(`Non-English detected (${detectedLocale}) — auto-switching to browser TTS: ${compatibleBrowser.name} (${compatibleBrowser.lang})`);
            effectiveEngine = 'webspeech';
            effectiveVoice = compatibleBrowser.name;
            effectiveVoiceDisplayName = compatibleBrowser.name;
          } else {
            log(`Non-English detected (${detectedLocale}) — no matching browser voice either. Attempting Camb.ai anyway.`);
          }
        }
      }

      if (effectiveEngine === 'camb') {
        const vid = Number(effectiveVoice);
        if (!Number.isFinite(vid) || vid <= 0) throw new Error(`Invalid Camb.ai voice ID: "${effectiveVoice}"`);

        // Fire all text chunk TTS requests in parallel
        const textChunkIndices = item.chunks.map((c, i) => c.type === 'text' ? i : -1).filter(i => i >= 0);
        
        log(`Pre-fetching ${textChunkIndices.length} Camb.ai audio chunks in parallel...`);
        
        const fetchPromises = textChunkIndices.map(async (idx) => {
          const text = item.chunks[idx].content;
          try {
            // Check if this item's first chunk was pre-fetched
            if (idx === textChunkIndices[0] && nextItemPrefetched.current.has(item.id)) {
              const cachedBlob = nextItemPrefetched.current.get(item.id)!;
              log('Using pre-fetched audio for queue item');
              prefetched.set(idx, cachedBlob);
              nextItemPrefetched.current.delete(item.id);
              return;
            }
            // Server-side mode: API keys are stored as env vars, never exposed to browser
            const keyIdx = voiceKeyMap.find(m => m.voiceId === vid)?.keyIndex ?? 0;
            // Auto-detect language from text content (or use explicit prefix like "es: hola")
            const { language: detectedLang } = resolveLanguage(text);
            // Measure API latency for connection health monitor
            const apiStart = performance.now();
            const blob = await generateCambTTSServer(text, vid, keyIdx, cambGender, cambAge, detectedLang, 3,
              cambVoiceSettingsRef.current[vid]?.model,
              cambVoiceSettingsRef.current[vid]?.enhance,
              cambVoiceSettingsRef.current[vid]?.speakingRate,
            );
            const apiEnd = performance.now();
            setApiLatency(apiEnd - apiStart);
            if (blob) prefetched.set(idx, blob);
          } catch (e: any) {
            // BUG FIX: Log chunk failures more prominently so the user knows what's happening
            const errMsg = e?.message || String(e);
            log(`⚠ Camb.ai chunk ${idx} FAILED: ${errMsg}`);
            console.error(`[TTS] Chunk ${idx} fetch error:`, e);
          }
        });

        await Promise.all(fetchPromises);
        // BUG FIX: Check if ANY chunks were successfully fetched before trying to play
        const fetchedCount = textChunkIndices.filter(idx => prefetched.has(idx)).length;
        if (fetchedCount === 0 && textChunkIndices.length > 0) {
          log(`❌ All audio chunks failed to fetch — skipping item`);
          throw new Error('All Camb.ai chunks failed');
        }
        log(`Pre-fetch complete: ${fetchedCount}/${textChunkIndices.length} chunks ready. Playing now...`);
      }

      // Pre-load SFX audio elements so they're already buffered when playback starts
      const prefetchedAudio = new Map<number, HTMLAudioElement>();
      const sfxLoadPromises: Promise<void>[] = [];

      item.chunks.forEach((chunk, idx) => {
        if (chunk.type === 'sfx') {
          // Check if this is a custom sound (prefixed with "custom:")
          const isCustomSfx = chunk.content.startsWith('custom:');
          const customName = isCustomSfx ? chunk.content.slice(7) : null;
          const customSound = isCustomSfx ? customSounds.find(cs => cs.name === customName) : null;

          if (customSound) {
            // Custom sound — dataUrl may or may not be loaded yet
            // If dataUrl is available, create Audio immediately. Otherwise, defer loading.
            const sfxVol = getSoundVolume(customName!, soundVolumes, 1.0) * soundboardMasterVol;
            if (customSound.dataUrl) {
              // Data already loaded — create and preload audio element
              const audio = new Audio(customSound.dataUrl);
              audio.preload = 'auto';
              audio.volume = Math.min(1, sfxVol);
              prefetchedAudio.set(idx, audio);
              sfxLoadPromises.push(
                new Promise<void>((resolve) => {
                  const timer = setTimeout(() => resolve(), 3000);
                  audio.oncanplaythrough = () => { clearTimeout(timer); resolve(); };
                  audio.onloadeddata = () => { clearTimeout(timer); resolve(); };
                  audio.onerror = () => { clearTimeout(timer); resolve(); };
                  audio.load();
                })
              );
            } else {
              // Data NOT loaded yet — fetch on-demand from server during preload phase
              // Store the fetch promise so the audio is ready by playback time
              sfxLoadPromises.push(
                fetchCustomSoundDataByName(customName!).then(dataUrl => {
                  if (dataUrl) {
                    const audio = new Audio(dataUrl);
                    audio.preload = 'auto';
                    audio.volume = Math.min(1, sfxVol);
                    prefetchedAudio.set(idx, audio);
                    return new Promise<void>((resolve) => {
                      const timer = setTimeout(() => resolve(), 4000);
                      audio.oncanplaythrough = () => { clearTimeout(timer); resolve(); };
                      audio.onloadeddata = () => { clearTimeout(timer); resolve(); };
                      audio.onerror = () => { clearTimeout(timer); resolve(); };
                      audio.load();
                    });
                  }
                  return; // Fetch failed — will be skipped during playback
                })
              );
            }
          } else {
            // Built-in sound — resolve URLs and preload
            const soundName = isCustomSfx ? customName! : chunk.content;
            const sound = SOUND_LIBRARY.find(s => s.name === soundName);
            if (sound) {
              const urls = resolveSoundUrls(sound);
              prefetchedSfx.set(idx, urls);
              // Start loading all fallback URLs immediately and cache the first one that works.
              if (urls.length > 0) {
                const sfxVol = getSoundVolume(soundName, soundVolumes, 1.0) * soundboardMasterVol;
                sfxLoadPromises.push(
                  preloadAudioUrlFallback(urls, Math.min(1, sfxVol)).then(audio => {
                    if (audio) prefetchedAudio.set(idx, audio);
                  })
                );
              }
            }
          }
        }
      });

      // Wait briefly for all SFX to pre-buffer. Playback then has near-zero gap.
      await Promise.all(sfxLoadPromises);

      // ==================== PLAYBACK PHASE ====================
      // Now play everything sequentially with ZERO network delay.
      for (let i = 0; i < item.chunks.length; i++) {
        const chunk = item.chunks[i];
        
        if (chunk.type === 'text') {
          setSubUser(item.user);
          setSubText(chunk.content);

          if (effectiveEngine === 'webspeech') {
            const { promise, cancel } = await generateBrowserTTS(chunk.content, effectiveVoice, item.fx.pitch, 1.0, item.fx.volume);
            playRef.current = { stop: cancel, onEnded: () => {} };
            await promise;
          } else {
            const blob = prefetched.get(i);
            if (!blob) { log(`Skipping chunk ${i} (fetch failed)`); continue; }
            // Apply per-voice volume multiplier for Camb.ai voices (supports 0.2x quiet to 5.0x loud)
            const voiceBoost = (effectiveEngine === 'camb' && cambVoiceBoostsRef.current[Number(effectiveVoice)] !== undefined)
              ? cambVoiceBoostsRef.current[Number(effectiveVoice)]
              : 1.0;
            const ctrl = await playAudioWithFX(blob, item.fx, voiceBoost);
            playRef.current = ctrl;
            await new Promise<void>(r => ctrl.onEnded(r));
          }
        } else if (chunk.type === 'sfx') {
          // Use pre-loaded audio element if available (instant), otherwise fallback
          const preloaded = prefetchedAudio.get(i);
          if (preloaded && preloaded.readyState >= 1) {
            // Already buffered — play instantly, let it finish naturally (safety cap at 15s)
            await new Promise<void>((resolve) => {
              activeSfxRef.current.push(preloaded);
              const cap = setTimeout(() => { try { preloaded.pause(); } catch {} activeSfxRef.current = activeSfxRef.current.filter(a => a !== preloaded); resolve(); }, 15000);
              preloaded.onended = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== preloaded); resolve(); };
              preloaded.onerror = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== preloaded); resolve(); };
              preloaded.play().catch(() => { clearTimeout(cap); resolve(); });
            });
          } else {
            // Fallback: For custom sounds, fetch dataUrl on-demand and play
            const isCustom = chunk.content.startsWith('custom:');
            const customName = isCustom ? chunk.content.slice(7) : null;
            const customSound = isCustom ? customSounds.find(cs => cs.name === customName) : null;
            if (customSound) {
              try {
                const dataUrl = await fetchCustomSoundData(customSound);
                if (!dataUrl) { log(`Custom SFX "${customName}" data not available`); continue; }
                const fallbackAudio = new Audio(dataUrl);
                fallbackAudio.volume = Math.min(1, getSoundVolume(customName!, soundVolumes, 1.0) * soundboardMasterVol);
                await new Promise<void>((resolve) => {
                  const cap = setTimeout(() => { try { fallbackAudio.pause(); } catch {} resolve(); }, 15000);
                  fallbackAudio.oncanplaythrough = () => {
                    activeSfxRef.current.push(fallbackAudio);
                    fallbackAudio.onended = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== fallbackAudio); resolve(); };
                    fallbackAudio.onerror = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== fallbackAudio); resolve(); };
                    fallbackAudio.play().catch(() => { clearTimeout(cap); resolve(); });
                  };
                  fallbackAudio.onerror = () => { clearTimeout(cap); resolve(); };
                  fallbackAudio.load();
                  // If canplaythrough doesn't fire within 3s, try play() anyway
                  setTimeout(() => {
                    if (fallbackAudio.readyState >= 2) return; // already handled by oncanplaythrough
                    clearTimeout(cap);
                    try {
                      activeSfxRef.current.push(fallbackAudio);
                      fallbackAudio.onended = () => { activeSfxRef.current = activeSfxRef.current.filter(a => a !== fallbackAudio); resolve(); };
                      fallbackAudio.onerror = () => { activeSfxRef.current = activeSfxRef.current.filter(a => a !== fallbackAudio); resolve(); };
                      fallbackAudio.play().catch(() => resolve());
                    } catch { resolve(); }
                  }, 3000);
                });
              } catch {
                log(`Custom SFX "${customName}" fallback play failed`);
              }
            } else {
              // Built-in sound that couldn't preload — try on-demand load with timeout
              const sound = SOUND_LIBRARY.find(s => s.name === chunk.content);
              if (sound) {
                const urls = resolveSoundUrls(sound);
                const sfxVol = getSoundVolume(chunk.content, soundVolumes, 1.0) * soundboardMasterVol;
                try {
                  const onDemandAudio = await preloadAudioUrlFallback(urls, Math.min(1, sfxVol));
                  if (onDemandAudio && onDemandAudio.readyState >= 1) {
                    await new Promise<void>((resolve) => {
                      activeSfxRef.current.push(onDemandAudio);
                      const cap = setTimeout(() => { try { onDemandAudio.pause(); } catch {} activeSfxRef.current = activeSfxRef.current.filter(a => a !== onDemandAudio); resolve(); }, 15000);
                      onDemandAudio.onended = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== onDemandAudio); resolve(); };
                      onDemandAudio.onerror = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== onDemandAudio); resolve(); };
                      onDemandAudio.play().catch(() => { clearTimeout(cap); resolve(); });
                    });
                  } else {
                    log(`Skipped SFX ${chunk.content} (not preloaded fast enough)`);
                  }
                } catch {
                  log(`Skipped SFX ${chunk.content} (on-demand load failed)`);
                }
              } else {
                log(`Skipped SFX ${chunk.content} (not found in library)`);
              }
            }
          }
        }
      }
      setSubText('');
    } catch (e: any) {
      const msg = e?.message || e?.toString?.() || 'Unknown TTS error';
      // Suppress noisy DOMException from audio context (browser autoplay policy)
      if (msg.includes('NotAllowedError') || msg.includes('autoplay')) {
        log(`Audio blocked by browser — click anywhere to enable audio, then retry.`);
      } else {
        log(`Error: ${msg}`);
        addToast(msg.includes('NotAllowed') ? 'Audio blocked by browser — click to enable' : `TTS Error: ${msg.slice(0, 80)}`, 'error');
      }
    }
    finally {
      playRef.current = null; playingFlag.current = false;
      playingStartTimeRef.current = 0;
      // Only update playing state if this is still the current generation
      // (prevents stale finally from a stuck-recovery-killed processQueue from killing the NEXT item)
      if (stuckRecoveryGenerationRef.current === thisGeneration) {
        setPlaying(null); setSubText(''); setSubUser('');
      }
      setHistory(p => [item, ...p].slice(0, 20));
    }
  }, [queue, cambGender, cambAge, useProxy, proxyUrl, log, voiceKeyMap, soundVolumes, soundboardMasterVol, customSounds]);

  useEffect(() => { if (!playing && queue.length > 0) processQueue(); }, [playing, queue, processQueue]);

  // ──── Pre-fetch Next Queue Item (Feature 5) ────
  // After the current TTS item starts playing, pre-fetch audio for the NEXT item in the queue
  useEffect(() => {
    if (!playing || queue.length === 0) return;
    const nextItem = queue[0];
    if (!nextItem || nextItem.engine !== 'camb') return;
    // Already prefetched?
    if (nextItemPrefetched.current.has(nextItem.id)) return;

    const prefetchNext = async () => {
      try {
        const firstTextChunk = nextItem.chunks.find(c => c.type === 'text');
        if (!firstTextChunk) return;
        const vid = Number(nextItem.voice);
        if (!Number.isFinite(vid) || vid <= 0) return;
        const keyIdx = voiceKeyMap.find(m => m.voiceId === vid)?.keyIndex ?? 0;
        const { language: detectedLang } = resolveLanguage(firstTextChunk.content);
        log('Pre-fetching next queue item...');
        const blob = await generateCambTTSServer(firstTextChunk.content, vid, keyIdx, cambGender, cambAge, detectedLang, 3,
          cambVoiceSettingsRef.current[vid]?.model,
          cambVoiceSettingsRef.current[vid]?.enhance,
          cambVoiceSettingsRef.current[vid]?.speakingRate,
        );
        if (blob) {
          nextItemPrefetched.current.set(nextItem.id, blob);
          log(`Pre-fetched audio for next queue item (${nextItem.user})`);
        }
      } catch {
        // Non-critical — if prefetch fails, processQueue will fetch normally
      }
    };
    prefetchNext();
  }, [playing, queue, voiceKeyMap, cambGender, cambAge, log]);

  // Clean up prefetched blobs when items are removed from queue
  useEffect(() => {
    const queueIds = new Set(queue.map(i => i.id));
    const playingId = playing?.id;
    for (const key of nextItemPrefetched.current.keys()) {
      if (key !== playingId && !queueIds.has(key)) {
        nextItemPrefetched.current.delete(key);
      }
    }
  }, [queue, playing]);

  // ==================== CONTROLS ====================
  const skip = (e?: React.MouseEvent) => {
    // Feature 2: Particle burst on skip
    if (e && e.currentTarget) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setParticleBurst({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, active: true });
      setTimeout(() => setParticleBurst(prev => ({ ...prev, active: false })), 700);
    }
    playRef.current?.stop();
    activeSfxRef.current.forEach(audio => {
      try { audio.pause(); audio.currentTime = 0; } catch {}
    });
    activeSfxRef.current = [];
    window.speechSynthesis?.cancel();
    playRef.current = null;
    playingFlag.current = false;
    playingStartTimeRef.current = 0;
    setPlaying(null);
    setSubText('');
    setSubUser('');
    log('Skipped.');
  };

  const quickMuteUser = useCallback((username: string) => {
    const lowerUser = username.toLowerCase();
    setBlockedUsers(prev => {
      const list = prev.split(',').map(u => u.trim()).filter(Boolean);
      if (list.some(u => u.toLowerCase() === lowerUser)) return prev;
      const updated = [...list, username].join(', ');
      try { localStorage.setItem('blocked_users', updated); } catch {}
      settingsRef.current.blockedUsers = updated;
      return updated;
    });
    if (playing && playing.user.toLowerCase() === lowerUser) {
      playRef.current?.stop();
      activeSfxRef.current.forEach(audio => { try { audio.pause(); audio.currentTime = 0; } catch {} });
      activeSfxRef.current = [];
      window.speechSynthesis?.cancel();
      playRef.current = null;
      playingFlag.current = false;
      playingStartTimeRef.current = 0;
      setPlaying(null);
      setSubText(''); setSubUser('');
      log(`Muted & skipped: ${username}`);
    } else {
      log(`Muted: ${username}`);
    }
    setQueue(prev => {
      const filtered = prev.filter(item => item.user.toLowerCase() !== lowerUser);
      if (filtered.length < prev.length) log(`Removed ${prev.length - filtered.length} queued item(s) from ${username}`);
      return filtered;
    });
  }, [playing, log]);
  const resolveSoundUrls = (sound: SoundBite) => {
    const cacheKey = getSoundSlug(sound.name);
    // Priority 1: Cached resolved URL (already verified working) — proxy through our server
    const cached = soundUrlCache[cacheKey] ? [
      `/api/sound-proxy?url=${encodeURIComponent(soundUrlCache[cacheKey])}`,
      soundUrlCache[cacheKey],
    ] : [];

    // Priority 2: Direct mp3Url from soundLibrary (scraped from MyInstants pages)
    const mp3Urls: string[] = [];
    if ((sound as any).mp3Url) {
      // Proxy the MP3 through our server to avoid CORS issues
      mp3Urls.push(`/api/sound-proxy?url=${encodeURIComponent((sound as any).mp3Url)}`);
      // Also try direct URL as fallback (works if browser doesn't enforce CORS for audio)
      mp3Urls.push((sound as any).mp3Url);
    }

    // Priority 3: Direct file URLs proxied through our server
    const files = Array.isArray(sound.file) ? sound.file : [sound.file];
    const base = soundBaseUrl.replace(/\/$/, '');
    const directProxied = files.slice(0, 2).map(file => {
      const directUrl = /^https?:\/\//i.test(file) ? file : `${base}/${file}`;
      return `/api/sound-proxy?url=${encodeURIComponent(directUrl)}`;
    });

    return Array.from(new Set([...cached, ...mp3Urls, ...directProxied]));
  };

  const resolveSoundBite = async (sound: SoundBite) => {
    const key = getSoundSlug(sound.name);

    // Strategy 1: Use mp3Url directly if available
    if ((sound as any).mp3Url) {
      setSoundUrlCache(prev => {
        const next = { ...prev, [key]: (sound as any).mp3Url };
        const keys = Object.keys(next);
        if (keys.length > 200) {
          const trimmed: Record<string, string> = {};
          keys.slice(-200).forEach(k => { trimmed[k] = next[k]; });
          return trimmed;
        }
        return next;
      });
      log(`Resolved ${sound.name} (direct)`);
      return (sound as any).mp3Url as string;
    }

    // Strategy 2: Use pageUrl to resolve
    const query = sound.query || sound.name;
    const endpoints: string[] = [];
    if ((sound as any).pageUrl) {
      endpoints.push(`/api/sound-resolve?url=${encodeURIComponent((sound as any).pageUrl)}&q=${encodeURIComponent(query)}`);
    }

    // Strategy 3: Slug-based
    const slugs = Array.from(new Set([
      ...(sound.slugs || []),
      getSoundSlug(sound.name).replace(/_/g, '-'),
      ...(Array.isArray(sound.file) ? sound.file : [sound.file]).map(file => file.replace(/\.(mp3|wav|ogg)$/i, '').replace(/_/g, '-')),
    ])).filter(Boolean);
    endpoints.push(
      ...slugs.slice(0, 5).map(slug => `/api/sound-resolve?slug=${encodeURIComponent(slug)}&q=${encodeURIComponent(query)}`),
    );

    // Strategy 4: Search by name
    endpoints.push(`/api/sound-resolve?q=${encodeURIComponent(query)}`);

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.audioUrl) {
          setSoundUrlCache(prev => {
            const next = { ...prev, [key]: data.audioUrl };
            const keys = Object.keys(next);
            if (keys.length > 200) {
              const trimmed: Record<string, string> = {};
              keys.slice(-200).forEach(k => { trimmed[k] = next[k]; });
              return trimmed;
            }
            return next;
          });
          log(`Resolved ${sound.name}`);
          return data.audioUrl as string;
        }
      } catch {}
    }
    log(`Could not resolve ${sound.name}`);
    return null;
  };

  const resolveVisibleSounds = async () => {
    setResolvingSounds(true);
    const list = filteredSounds.slice(0, 80);
    for (const sound of list) {
      if (!soundUrlCache[getSoundSlug(sound.name)]) await resolveSoundBite(sound);
    }
    setResolvingSounds(false);
  };

  const playAudioUrlFallback = async (urls: string[], volume = 1.0, maxPlayMs = 0) => {
    const candidates = Array.from(new Set(urls.filter(Boolean)));
    if (candidates.length === 0) throw new Error('no sound URLs supplied');

    await new Promise<void>((resolve, reject) => {
      let started = false;
      let failed = 0;
      const audios: HTMLAudioElement[] = [];

      const kill = (audio: HTMLAudioElement) => {
        audio.onloadedmetadata = null;
        audio.oncanplay = null;
        audio.onloadeddata = null;
        audio.onerror = null;
        audio.onended = null;
      };

      const go = async (audio: HTMLAudioElement) => {
        if (started) return;
        started = true;
        clearTimeout(deadline);

        // Kill all losers instantly
        audios.forEach(a => { if (a !== audio) { kill(a); try { a.pause(); a.src = ''; } catch {} } });

        activeSfxRef.current.push(audio);
        audio.volume = volume;

        // Only set a forced stop cap if maxPlayMs > 0 (0 = play to completion)
        // Safety cap at 30s to prevent infinite audio
        const effectiveCap = maxPlayMs > 0 ? maxPlayMs : 30000;
        const cap = window.setTimeout(() => {
          try { audio.pause(); } catch {}
          activeSfxRef.current = activeSfxRef.current.filter(a => a !== audio);
          kill(audio);
          resolve();
        }, effectiveCap);

        audio.onended = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== audio); kill(audio); resolve(); };
        audio.onerror = () => { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== audio); kill(audio); resolve(); };

        try { await audio.play(); } catch { clearTimeout(cap); activeSfxRef.current = activeSfxRef.current.filter(a => a !== audio); kill(audio); resolve(); }
      };

      const miss = () => { failed++; if (!started && failed >= candidates.length) { clearTimeout(deadline); reject(new Error('all URLs failed')); } };

      // 1200ms to find ANY working URL. The same-origin sound proxy needs a moment
      // to scrape MyInstants pages, but good local/direct files still start fast.
      const deadline = window.setTimeout(() => { if (!started) { audios.forEach(a => { kill(a); try { a.pause(); a.src = ''; } catch {} }); resolve(); } }, 5000);

      candidates.forEach(url => {
        const a = new Audio(url);
        a.preload = 'auto';
        a.volume = volume;
        audios.push(a);
        a.onloadedmetadata = () => go(a); // fires earliest
        a.oncanplay = () => go(a);
        a.onloadeddata = () => go(a);
        a.onerror = miss;
        a.load();
      });
    });
  };

  const preloadAudioUrlFallback = async (urls: string[], volume = 1.0): Promise<HTMLAudioElement | null> => {
    const candidates = Array.from(new Set(urls.filter(Boolean)));
    if (candidates.length === 0) return null;

    return await new Promise<HTMLAudioElement | null>((resolve) => {
      let resolved = false;
      const audios: HTMLAudioElement[] = [];

      const cleanupLosers = (winner?: HTMLAudioElement) => {
        audios.forEach(audio => {
          audio.onloadedmetadata = null;
          audio.onloadeddata = null;
          audio.oncanplay = null;
          audio.onerror = null;
          if (audio !== winner) {
            try { audio.pause(); audio.src = ''; } catch {}
          }
        });
      };

      const done = (audio: HTMLAudioElement) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        cleanupLosers(audio);
        resolve(audio);
      };

      const timer = window.setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanupLosers();
        resolve(null);
      }, 4000); // 4s deadline — network sounds can take a moment

      candidates.forEach(url => {
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = volume;
        audios.push(audio);
        audio.onloadedmetadata = () => done(audio);
        audio.onloadeddata = () => done(audio);
        audio.oncanplay = () => done(audio);
        audio.onerror = () => {};
        audio.load();
      });
    });
  };

  const triggerSfx = async (url: string, volume = 0.5) => {
    try {
      const urls = url.split('||').map(x => x.trim()).filter(Boolean);
      await playAudioUrlFallback(urls, volume, 0);
      log('SFX played.');
    } catch (e: any) { log(`SFX error: ${e.message}`); }
  };
  const clearQueue = () => { setQueue([]); log('Queue cleared.'); };
  const repeatLast = () => { if (history.length) setQueue(p => [...p, history[0]]); };
  
  const exportLogs = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chatgbt-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log('Logs exported.');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (shareModalOpen) { setShareModalOpen(false); return; }
        if (helpOpen) { setHelpOpen(false); return; }
        if (overlay) { setOverlay(false); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shareModalOpen, helpOpen, overlay]);

  const testSpeak = () => {
    if (!testText.trim()) return;
    const mappedVoice = engine === 'camb' ? String(voiceId) : browserVoice;
    const activeVoice = voices.find(v => v.id === Number(mappedVoice));
    const keyUsed = activeVoice?.apiKeyOwner != null ? String(activeVoice.apiKeyOwner) : '';
    const chunks = parseInlineSfx(testText, customSounds);
    const testFx = fxEnabled ? { ...fx } : { ...PRESETS.clean };
    
    setQueue(p => [...p, {
      id: genId(), user: 'Test', engine, voice: mappedVoice,
      fx: testFx, timestamp: new Date(), cambKeyUsed: keyUsed, chunks,
      voiceDisplayName: activeVoice?.voice_name || browserVoice,
    }]);
  };
  const randomPhrase = () => setTestText(PHRASES[Math.floor(Math.random() * PHRASES.length)]);
  const updateFx = (key: keyof FXSettings, v: number | boolean) => {
    setPresetName('custom'); // Mark as modified — but keep lastSelectedPreset for save button
    setFx(p => ({ ...p, [key]: v }));
  };

  // Save current FX settings to an existing preset (built-in or custom)
  const saveToPreset = (name: string) => {
    setCustomPresets(prev => {
      const existing = prev.findIndex(p => p.name === name);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { name, fx: { ...fx } };
        return updated;
      }
      return [...prev, { name, fx: { ...fx } }];
    });
    setPresetName(name);
    setLastSelectedPreset(name);
    log(`Saved current settings to preset "${name}"`);
    addToast(`Preset "${name}" saved`, 'success');
  };

  // ==================== SOUNDBOARD ====================
  const playSoundBite = async (sound: SoundBite) => {
    // If the same sound is currently playing → pause it
    if (activeSoundRef.current && activeSoundName === sound.name) {
      activeSoundRef.current.pause();
      activeSoundRef.current = null;
      setActiveSoundName(null);
      log(`Paused sound: ${sound.name}`);
      return;
    }
    // Stop any currently playing sound
    if (activeSoundRef.current) {
      try { activeSoundRef.current.pause(); activeSoundRef.current.currentTime = 0; } catch {}
      activeSoundRef.current = null;
      setActiveSoundName(null);
    }

    const perSoundVol = getSoundVolume(sound.name, soundVolumes, 1.0);
    const volume = Math.min(1, perSoundVol * soundboardMasterVol);
    try {
      const urls = resolveSoundUrls(sound);
      const candidates = Array.from(new Set(urls.filter(Boolean)));
      if (candidates.length === 0) throw new Error('no sound URLs supplied');

      // Try each URL until one loads successfully
      const audio = await new Promise<HTMLAudioElement>((resolve, reject) => {
        let resolved = false;
        const audios: HTMLAudioElement[] = [];
        const kill = (a: HTMLAudioElement) => { a.onloadedmetadata = null; a.oncanplay = null; a.onloadeddata = null; a.onerror = null; };
        let failed = 0;
        const miss = () => { failed++; if (!resolved && failed >= candidates.length) { reject(new Error('all URLs failed')); } };
        const deadline = window.setTimeout(() => { if (!resolved) { audios.forEach(a => { kill(a); try { a.pause(); a.src = ''; } catch {} }); reject(new Error('timeout')); } }, 5000);

        candidates.forEach(url => {
          const a = new Audio(url);
          a.preload = 'auto';
          a.volume = volume;
          audios.push(a);
          a.onloadedmetadata = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(deadline);
            audios.forEach(other => { if (other !== a) { kill(other); try { other.pause(); other.src = ''; } catch {} } });
            resolve(a);
          };
          a.oncanplay = () => { if (!resolved) { resolved = true; clearTimeout(deadline); audios.forEach(other => { if (other !== a) { kill(other); try { other.pause(); other.src = ''; } catch {} } }); resolve(a); } };
          a.onerror = miss;
          a.load();
        });
      });

      audio.volume = volume;
      // BUG FIX: Use activeSoundRef.current === audio instead of activeSoundName === sound.name
      // to avoid stale closure. The activeSoundName state value is captured at the time
      // playSoundBite is called. If another sound starts playing before this one ends,
      // the stale activeSoundName would still equal sound.name, causing the callback to
      // incorrectly null out the new active sound. Checking the ref against the specific
      // audio element is always accurate.
      audio.onended = () => { if (activeSoundRef.current === audio) { activeSoundRef.current = null; setActiveSoundName(null); } };
      audio.onerror = () => { if (activeSoundRef.current === audio) { activeSoundRef.current = null; setActiveSoundName(null); } };
      activeSoundRef.current = audio;
      setActiveSoundName(sound.name);
      await audio.play();
      log(`Played sound: ${sound.name} (vol: ${Math.round(volume * 100)}%)`);
    } catch (e: any) {
      log(`Failed to play ${sound.name}: ${e.message}`);
    }
  };

  const addSoundToSfx = (sound: SoundBite) => {
    const triggerWord = `!${sound.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const url = resolveSoundUrls(sound).join('||');
    setSfx(prev => {
      const exists = prev.find(s => s.word.toLowerCase() === triggerWord);
      if (exists) {
        log(`Sound already mapped to ${triggerWord}`);
        return prev;
      }
      return [...prev, { word: triggerWord, url, volume: 0.5 }];
    });
    log(`Mapped ${triggerWord} → ${sound.name}`);
  };

  // ── ON-DEMAND CUSTOM SOUND DATA LOADING ──
  // Custom sounds are stored on the server with METADATA only in the main settings response.
  // The actual base64 audio dataUrl is fetched on-demand from /api/sfx-data when needed,
  // then cached in memory. This prevents the GET /api/settings response from exceeding
  // Vercel's body size limit when there are many custom sounds.
  const sfxDataCache = useRef<Map<string, string>>(new Map()); // name → dataUrl cache (Map preserves insertion order for LRU eviction)

  const fetchCustomSoundData = useCallback(async (cs: CustomSound): Promise<string | null> => {
    // 1. Check if dataUrl is already in the CustomSound object (e.g. after upload)
    if (cs.dataUrl) return cs.dataUrl;
    // 2. Check in-memory cache
    if (sfxDataCache.current.has(cs.name)) return sfxDataCache.current.get(cs.name)!;
    // 3. Fetch from server on-demand
    try {
      const res = await fetch(`/api/sfx-data?id=${encodeURIComponent(cs.id)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.dataUrl) {
          sfxDataCache.current.set(cs.name, data.dataUrl);
          // BUG FIX: Limit sfxDataCache size to prevent unbounded memory growth
          // Map preserves insertion order so the first key is the oldest (LRU eviction)
          if (sfxDataCache.current.size > 20) { const oldest = sfxDataCache.current.keys().next().value; if (oldest !== undefined) sfxDataCache.current.delete(oldest); }
          // Also update the customSounds state so it's available for next use
          setCustomSounds(prev => prev.map(s => s.id === cs.id ? { ...s, dataUrl: data.dataUrl } : s));
          return data.dataUrl;
        }
      }
    } catch {
      // Network error — non-critical
    }
    return null;
  }, []);

  const fetchCustomSoundDataByName = useCallback(async (name: string): Promise<string | null> => {
    // 1. Check if customSound already has dataUrl
    const cs = customSounds.find(s => s.name === name);
    if (cs?.dataUrl) return cs.dataUrl;
    // 2. Check in-memory cache
    if (sfxDataCache.current.has(name)) return sfxDataCache.current.get(name)!;
    // 3. Fetch from server by name
    try {
      const res = await fetch(`/api/sfx-data?name=${encodeURIComponent(name)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.dataUrl) {
          sfxDataCache.current.set(name, data.dataUrl);
          // BUG FIX: Limit sfxDataCache size to prevent unbounded memory growth
          // Map preserves insertion order so the first key is the oldest (LRU eviction)
          if (sfxDataCache.current.size > 20) { const oldest = sfxDataCache.current.keys().next().value; if (oldest !== undefined) sfxDataCache.current.delete(oldest); }
          if (data.id) {
            setCustomSounds(prev => prev.map(s => s.id === data.id ? { ...s, dataUrl: data.dataUrl } : s));
          }
          return data.dataUrl;
        }
      }
    } catch {
      // Network error — non-critical
    }
    return null;
  }, [customSounds]);

  // Play a custom uploaded sound — fetches dataUrl on-demand if needed
  const playCustomSound = async (cs: CustomSound) => {
    // If the same sound is currently playing → pause it
    if (activeSoundRef.current && activeSoundName === cs.name) {
      activeSoundRef.current.pause();
      activeSoundRef.current = null;
      setActiveSoundName(null);
      log(`Paused custom sound: ${cs.name}`);
      return;
    }
    // Stop any currently playing sound
    if (activeSoundRef.current) {
      try { activeSoundRef.current.pause(); activeSoundRef.current.currentTime = 0; } catch {}
      activeSoundRef.current = null;
      setActiveSoundName(null);
    }

    const perSoundVol = getSoundVolume(cs.name, soundVolumes, 1.0);
    const volume = Math.min(1, perSoundVol * soundboardMasterVol);
    try {
      const dataUrl = await fetchCustomSoundData(cs);
      if (!dataUrl) {
        log(`Failed to load sound data: ${cs.name}`);
        return;
      }
      const audio = new Audio(dataUrl);
      audio.volume = volume;
      // BUG FIX: Same stale closure fix as playSoundBite — check activeSoundRef
      // against the specific audio element instead of comparing activeSoundName.
      audio.onended = () => { if (activeSoundRef.current === audio) { activeSoundRef.current = null; setActiveSoundName(null); } };
      audio.onerror = () => { if (activeSoundRef.current === audio) { activeSoundRef.current = null; setActiveSoundName(null); } };
      activeSoundRef.current = audio;
      setActiveSoundName(cs.name);
      await audio.play();
      log(`Played custom sound: ${cs.name}`);
    } catch (e: any) {
      log(`Failed to play ${cs.name}: ${e.message}`);
    }
  };

  // Upload a custom sound file to the server
  const uploadCustomSound = async (file: File) => {
    if (!file) return;
    // Validate type
    const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/x-wav'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['mp3', 'wav', 'ogg', 'webm'].includes(ext) && !allowed.includes(file.type)) {
      log(`Invalid file type: ${file.type || ext}. Use mp3, wav, ogg, or webm.`);
      return;
    }
    // Validate size (2MB max — must match server's MAX_FILE_SIZE in sfx-upload.js)
    if (file.size > 2 * 1024 * 1024) {
      log(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 2MB.`);
      return;
    }

    setSfxUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (sfxUploadName.trim()) formData.append('name', sfxUploadName.trim());

      const res = await fetch('/api/sfx-upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        log(`Uploaded custom sound: ${data.sound.name} (${(data.sound.size / 1024).toFixed(0)}KB)`);
        setSfxUploadName('');
        // Reload custom sounds metadata from server (no dataUrl in response — keeps it lightweight)
        try {
          const settingsRes = await fetch('/api/settings', { credentials: 'include' });
          if (settingsRes.ok) {
            const settings = await settingsRes.json();
            if (Array.isArray(settings.customSounds)) {
              // Accept sounds with or without dataUrl (metadata-only is the new normal)
              const validSounds = settings.customSounds.filter((cs: any) => cs && typeof cs.name === 'string');
              setCustomSounds(validSounds);
            }
          }
        } catch {}
      } else {
        log(`Upload failed: ${data.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      log(`Upload error: ${e.message}`);
    } finally {
      setSfxUploading(false);
    }
  };

  // Delete a custom sound (from Turso cloud + local state)
  const deleteCustomSound = async (id: string) => {
    setCustomSounds(prev => prev.filter(s => s.id !== id));
    log('Custom sound deleted.');
    // Also delete from Turso via API
    try {
      await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ soundId: id }),
      });
    } catch {
      // Non-critical — already removed from local state
    }
  };

  const soundSearchLower = soundSearch.toLowerCase();
  const filteredSounds = useMemo(() => SOUND_LIBRARY.filter(s => 
    s.name.toLowerCase().includes(soundSearchLower) ||
    s.category.toLowerCase().includes(soundSearchLower)
  ), [soundSearchLower]);
  const applyPreset = (name: string) => {
    setPresetName(name);
    setLastSelectedPreset(name);
    // Check if user has a custom override for this built-in preset
    const customOverride = customPresets.find(p => p.name === name);
    if (customOverride) {
      setFx({ ...DEFAULT_FX, ...customOverride.fx });
    } else if (PRESETS[name]) {
      setFx({ ...PRESETS[name] });
    } else {
      // Shouldn't happen, but fallback
      setFx({ ...DEFAULT_FX });
    }
  };
  const addPreset = () => {
    if (!newPresetName.trim()) return;
    const name = newPresetName.trim();
    setCustomPresets(p => [...p, { name, fx: { ...fx } }]);
    setPresetName(name);
    setLastSelectedPreset(name);
    setNewPresetName('');
    log(`Created new preset "${name}"`);
    addToast(`Preset "${name}" created`, 'success');
  };

  const exportSettings = () => {
    const data = {
      version: 6,
      channel, engine, voiceId, cambGender, cambAge, browserVoice,
      fx, presetName, customPresets, favs,
      allowedRoles, requirePrefix, prefix, maxChars, blacklist, whitelist, userCooldown, queueSizeLimit,
      mappings, aliases, sfx,
      subColor, subSize, subBg, useProxy, proxyUrl,
      advancedFilterEnabled, bannedWordsString, filterMode, blockedUsers, soundVolumes,
      soundboardMasterVol, allowChatterVoice, chatterVoices, hiddenSounds,
      soundBaseUrl, soundUrlCache,
      // BUG FIX: autoLangSwitch and darkMode were missing from export
      autoLangSwitch, darkMode,
      // Per-voice volume boosts — included in export so they survive backup/restore
      cambVoiceBoosts,
      // Per-voice model/enhance/speed settings — included in export
      cambVoiceSettings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chatgbt-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log('Settings exported.');
  };

  const importSettings = (s: string) => {
    try {
      const d = JSON.parse(s);
      if (!window.confirm('Import settings? This will overwrite current configuration.')) return;
      if (d.channel !== undefined) setChannel(d.channel);
      if (d.engine) setEngine(d.engine);
      if (typeof d.voiceId === 'number') setVoiceId(d.voiceId);
      if (typeof d.cambGender === 'number') setCambGender(d.cambGender);
      if (typeof d.cambAge === 'number') setCambAge(d.cambAge);
      if (d.browserVoice !== undefined) setBrowserVoice(d.browserVoice);
      if (d.fx) setFx({ ...DEFAULT_FX, ...d.fx });
      if (d.presetName) setPresetName(d.presetName);
      if (Array.isArray(d.customPresets)) setCustomPresets(d.customPresets);
      if (Array.isArray(d.favs)) setFavs(d.favs);
      if (d.allowedRoles) setAllowedRoles(d.allowedRoles);
      if (typeof d.requirePrefix === 'boolean') setRequirePrefix(d.requirePrefix);
      if (d.prefix !== undefined) setPrefix(d.prefix);
      if (typeof d.maxChars === 'number') setMaxChars(d.maxChars);
      if (d.blacklist !== undefined) setBlacklist(d.blacklist);
      if (d.whitelist !== undefined) setWhitelist(d.whitelist);
      if (typeof d.userCooldown === 'number') setUserCooldown(d.userCooldown);
      if (typeof d.queueSizeLimit === 'number') setQueueSizeLimit(d.queueSizeLimit);
      if (Array.isArray(d.mappings)) setMappings(d.mappings);
      if (Array.isArray(d.aliases)) setAliases(d.aliases);
      if (Array.isArray(d.sfx)) setSfx(d.sfx);
      if (d.subColor) setSubColor(d.subColor);
      if (typeof d.subSize === 'number') setSubSize(d.subSize);
      if (d.subBg) setSubBg(d.subBg);
      if (typeof d.useProxy === 'boolean') setUseProxy(d.useProxy);
      if (d.proxyUrl !== undefined) setProxyUrl(d.proxyUrl);
      // Anti-abuse settings
      if (typeof d.advancedFilterEnabled === 'boolean') setAdvancedFilterEnabled(d.advancedFilterEnabled);
      if (d.bannedWordsString !== undefined) setBannedWordsString(d.bannedWordsString);
      if (d.filterMode) setFilterMode(d.filterMode);
      if (d.blockedUsers !== undefined) setBlockedUsers(d.blockedUsers);
      if (d.soundVolumes) setSoundVolumes(d.soundVolumes);
      if (typeof d.soundboardMasterVol === 'number') setSoundboardMasterVol(d.soundboardMasterVol);
      if (typeof d.allowChatterVoice === 'boolean') setAllowChatterVoice(d.allowChatterVoice);
      if (Array.isArray(d.chatterVoices)) { setChatterVoices(d.chatterVoices); syncSettingsToServer({ chatterVoices: d.chatterVoices }); }
      // Custom sounds are NOT imported via settings JSON (too large, causes data loss)
      // They must be uploaded individually via the SFX Upload feature
      if (typeof d.soundBaseUrl === 'string') { setSoundBaseUrl(d.soundBaseUrl); }
      if (Array.isArray(d.hiddenSounds)) { setHiddenSounds(d.hiddenSounds); }
      if (d.soundUrlCache && typeof d.soundUrlCache === 'object') { setSoundUrlCache(d.soundUrlCache); }
      // BUG FIX: autoLangSwitch and darkMode were missing from import
      if (typeof d.autoLangSwitch === 'boolean') { setAutoLangSwitch(d.autoLangSwitch); }
      if (typeof d.darkMode === 'boolean') { setDarkMode(d.darkMode); }
      // Per-voice volume boosts — restore from backup
      if (d.cambVoiceBoosts && typeof d.cambVoiceBoosts === 'object') { setCambVoiceBoosts(d.cambVoiceBoosts); }
      // Per-voice model/enhance/speed settings — restore from backup
      if (d.cambVoiceSettings && typeof d.cambVoiceSettings === 'object') { setCambVoiceSettings(d.cambVoiceSettings); }
      log('Settings imported successfully.');
    } catch { log('Invalid backup file.'); }
  };

  // ═══════════════════════════════════════════════════
  // AUTH: Check existing session on mount
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/login', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            setIsAdmin(true);
            setAdminUsername(data.username);
          }
        }
      } catch {
        // Network error - not authenticated
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  // NOTE: Cursor spotlight removed — querySelectorAll + getBoundingClientRect
  // on every mousemove was causing 2 FPS in Voice FX tab (forced layout reflow).
  // Card hover glow is now handled purely by CSS :hover with no JS.

  // Auth handlers
  const handleAdminLogin = (username: string) => {
    setIsAdmin(true);
    setAdminUsername(username);
    setShowChatterView(false);
  };

  const handleShowChatter = () => {
    setShowChatterView(true);
  };

  const handleLogout = async () => {
    try { await fetch('/api/auth/login', { method: 'DELETE', credentials: 'include' }); } catch {}
    setIsAdmin(false);
    setAdminUsername('');
  };

  const handleBackFromChatter = () => {
    setShowChatterView(false);
  };

  // ═══════════════════════════════════════════════════
  // ROUTING: Chatter view / Login / Admin dashboard
  // ═══════════════════════════════════════════════════

  // Hash-based chatter view (direct URL access)
  if (currentHash === '#/chatter' || showChatterView) {
    return (
      <ChatterView
        channel={channel}
        sfx={sfx}
        prefix={prefix}
        allowChatterVoice={allowChatterVoice}
        chatterVoices={chatterVoices}
        hiddenSounds={hiddenSounds}
        customPresets={customPresets}
        customSounds={customSounds}
        leaderboard={leaderboard}
        onBack={handleBackFromChatter}
      />
    );
  }

  // Loading state while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'var(--bg-base)'}}>
        <motion.div
          className="text-center"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={springGentle}
        >
          <motion.img
            src="/images/logo.png" alt="CHATGBT"
            className="h-12 w-auto mx-auto mb-4"
            animate={{ scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <OrbitalLoader size={28} className="mx-auto mb-3" />
          <p className="text-sm" style={{color: 'var(--text-tertiary)'}}>Checking authentication...</p>
        </motion.div>
      </div>
    );
  }

  // Login screen (not authenticated)
  if (!isAdmin) {
    return (
      <LoginScreen
        onAdminLogin={handleAdminLogin}
        onChatterView={handleShowChatter}
      />
    );
  }

  return (
    <PageEntrance>
    <ClickRing />
    <div className="min-h-screen pb-20 font-sf overflow-x-hidden" style={{background: 'var(--bg-base)', color: 'var(--text-primary)'}}>
      {/* Floating Particles */}
      <div className="particles-container">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="particle" style={{
            left: `${Math.random() * 100}%`,
            bottom: '-10px',
            '--duration': `${12 + Math.random() * 18}s`,
            '--delay': `${Math.random() * 15}s`,
            width: `${1 + Math.random() * 2}px`,
            height: `${1 + Math.random() * 2}px`,
            opacity: 0.15 + Math.random() * 0.25,
          } as React.CSSProperties} />
        ))}
      </div>
      {/* Decorative background glow — static CSS, no animation cost */}
      <div className="fixed top-[-10%] right-[-5%] opacity-20 z-[-1] pointer-events-none" style={{
        width: 350, height: 350, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(220,53,53,0.06), rgba(124,58,237,0.03))',
        filter: 'blur(40px)',
      }} />

      {/* Header — Premium Frosted Glass */}
      <motion.header
        className="sticky top-0 z-50 card-enter header-gradient-anim"
        style={{
          background: darkMode ? 'rgba(12, 14, 20, 0.75)' : 'rgba(255, 255, 255, 0.82)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          borderBottom: darkMode ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(0,0,0,0.06)',
          '--enter-delay': '0s',
          y: prefersReducedMotion ? 0 : headerTranslateY,
          scale: prefersReducedMotion ? 1 : headerScale,
        } as React.CSSProperties}
      >
        <div className="mx-auto h-16 flex items-center justify-between" style={{paddingLeft: 'var(--page-padding)', paddingRight: 'var(--page-padding)'}}>
          {/* Logo — shrinks on small widths */}
          <div className="flex items-center gap-2.5 card-enter shrink-0" style={{'--enter-delay': '0.05s'} as React.CSSProperties}>
            <img src="/images/logo.png" alt="CHATGBT" className="h-9 w-auto transition-transform duration-200 hover:scale-110 active:scale-95 logo-glow" />
            <div className="flex flex-col">
              <h1 className="text-xl font-black tracking-tight leading-none flex items-center">
                <span style={{color: 'var(--text-primary)'}}>CHAT</span>
                <span className="chatgbt-gradient-text">GBT</span>
              </h1>
              <span className="text-[7px] font-bold tracking-[0.18em] uppercase mt-0.5" style={{color: 'var(--text-tertiary)'}}>Twitch Text to Speech</span>
            </div>
          </div>
          
          {/* Nav with layoutId for smooth pill transition — can shrink, hides labels on medium widths */}
          <nav
            className="flex gap-1 rounded-full p-1 border relative card-enter shrink-0"
            style={{background: 'var(--dm-nav-bg)', borderColor: 'var(--border-subtle)', '--enter-delay': '0.1s'} as React.CSSProperties}
          >
            {[
              { id: 'dash' as const, label: 'Dashboard', icon: <LayoutGrid size={14} /> },
              { id: 'voice' as const, label: 'Voice & FX', icon: <Mic2 size={14} /> },
              { id: 'rules' as const, label: 'Rules', icon: <Shield size={14} /> },
              { id: 'soundboard' as const, label: 'Soundboard', icon: <Volume size={14} /> },
              { id: 'overlay' as const, label: 'Overlay', icon: <Palette size={14} /> },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => { switchTab(t.id); }}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold relative transition-transform duration-150 active:scale-95 hover:scale-[1.02] ${
                  activeTab === t.id ? 'text-[var(--text-primary)]' : ''
                }`}
                style={activeTab !== t.id ? {color: 'var(--text-tertiary)'} : {}}
              >
                {activeTab === t.id && (
                  <motion.div
                    layoutId="activeTabPill"
                    className="absolute inset-0 rounded-full tab-active-pill"
                    style={{background: 'var(--dm-engine-active)', boxShadow: '0 0 0 1px var(--border-subtle), 0 2px 8px rgba(0,0,0,0.12)'}}
                    transition={spring}
                  />
                )}
                {activeTab === t.id && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-[20%] right-[20%] h-[3px] rounded-full"
                    style={{background: 'linear-gradient(90deg, #dc3535, #f28b8b, #dc3535)'}}
                    transition={spring}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  {t.icon}
                  {t.label}
                </span>
              </button>
            ))}
          </nav>

          {/* Right side buttons */}
          <div
            className="flex items-center gap-2.5 card-enter shrink-0"
            style={{'--enter-delay': '0.15s'} as React.CSSProperties}
            data-help-id="help-obs-button"
          >
            {/* Dark mode toggle */}
            <MagneticButton strength={0.12}>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="btn-classic-secondary py-1.5 px-3 text-xs h-9 dark-mode-toggle"
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            </MagneticButton>
            {/* Help */}
            <MagneticButton strength={0.12}>
            <button
              onClick={() => setHelpOpen(true)}
              className="btn-classic-secondary py-1.5 px-3 text-xs h-9"
              title="Help & Guide"
            >
              <HelpCircle size={14} /> Help
            </button>
            </MagneticButton>
            {/* OBS */}
            <MagneticButton strength={0.12}>
            <button
              onClick={() => setOverlay(true)}
              className="btn-classic-secondary py-1.5 px-3 text-xs h-9"
            >
              <Tv size={14} /> OBS
            </button>
            </MagneticButton>
            {/* Connection status pill */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[10px] font-bold uppercase ${status === 'connected' ? 'status-connected' : status === 'connecting' ? 'status-connecting' : ''}`}
              style={status === 'connected' ? {background: 'rgba(5,150,105,0.08)', color: '#059669', borderColor: 'rgba(5,150,105,0.15)'} : status === 'connecting' ? {background: 'rgba(217,119,6,0.08)', color: '#b45309', borderColor: 'rgba(217,119,6,0.15)'} : {background: 'var(--bg-surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border-default)'}}
              title={`Connection: ${status}${connectionHealth !== 'unknown' ? ` · Health: ${connectionHealth}` : ''}${twitchLatency !== null ? ` · Twitch: ${Math.round(twitchLatency)}ms` : ''}${apiLatency !== null ? ` · API: ${Math.round(apiLatency)}ms` : ''}`}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{background: status === 'connected' ? '#10b981' : status === 'connecting' ? '#d97706' : 'var(--text-muted)', animation: status === 'connected' ? 'connectionPulse 2s ease-in-out infinite' : status === 'connecting' ? 'statusBlink 1s ease-in-out infinite' : 'none'}}
              />
              {status === 'connected' ? <Wifi size={12} /> : status === 'connecting' ? <Activity size={12} /> : <WifiOff size={12} />}
              <span className="hidden lg:inline">{status}</span>
            </div>
            {/* Connection Health */}
            <div
              className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase relative group"
              style={{
                background: connectionHealth === 'good' ? 'rgba(5,150,105,0.08)' : connectionHealth === 'slow' ? 'rgba(217,119,6,0.08)' : connectionHealth === 'degraded' ? 'rgba(220,53,53,0.08)' : 'var(--bg-surface)',
                color: connectionHealth === 'good' ? '#059669' : connectionHealth === 'slow' ? '#b45309' : connectionHealth === 'degraded' ? '#dc3535' : 'var(--text-tertiary)',
                borderColor: connectionHealth === 'good' ? 'rgba(5,150,105,0.15)' : connectionHealth === 'slow' ? 'rgba(217,119,6,0.15)' : connectionHealth === 'degraded' ? 'rgba(220,53,53,0.15)' : 'var(--border-default)',
              }}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{background: connectionHealth === 'good' ? '#10b981' : connectionHealth === 'slow' ? '#d97706' : connectionHealth === 'degraded' ? '#dc3535' : 'var(--text-muted)'}}
              />
              {connectionHealth === 'good' ? 'Good' : connectionHealth === 'slow' ? 'Slow' : connectionHealth === 'degraded' ? 'Degraded' : '—'}
              {/* Tooltip with exact latencies */}
              <div className="absolute top-full right-0 mt-1 px-3 py-2 rounded-lg text-[10px] font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50" style={{background: 'var(--bg-surface)', border: '1px solid var(--border-default)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', color: 'var(--text-primary)'}}>
                <div>Twitch: {twitchLatency !== null ? `${Math.round(twitchLatency)}ms` : 'N/A'}</div>
                <div>API: {apiLatency !== null ? `${Math.round(apiLatency)}ms` : 'N/A'}</div>
              </div>
            </div>
            {/* Cloud sync indicator */}
            {cloudSyncing && (
              <div className="flex items-center gap-1 text-[10px] font-bold" style={{color: 'var(--text-tertiary)'}}>
                <RefreshCw size={10} className="animate-spin" />
              </div>
            )}
            {/* Admin identity & logout */}
            <div className="flex items-center gap-2 pl-3" style={{borderLeft: '1px solid var(--border-default)'}}>
            <div className="flex items-center gap-1.5 text-[10px] font-bold" style={{color: '#059669'}}>
              <ShieldCheck size={12} />
              <span className="hidden sm:inline">{adminUsername}</span>
            </div>
            <button
              onClick={handleLogout}
              className="transition-all duration-150 hover:text-red-400 active:scale-90"
              style={{color: 'var(--text-tertiary)'}}
              title="Logout"
            >
              <LogOut size={14} />
            </button>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Animated accent line under header */}
      <div
        className="h-[2px] w-full section-header-line"
        style={{background: 'linear-gradient(90deg, transparent, rgba(220,53,53,0.3), rgba(124,58,237,0.15), transparent)', '--enter-delay': '0.2s'} as React.CSSProperties}
      />

      {/* Offline Mode Banner (Feature 6) */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ...springGentle, duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-center gap-2 py-2.5 px-4 text-white text-xs font-bold" style={{background: 'linear-gradient(135deg, #dc3535, #a51c1c)'}}>
              <AlertTriangle size={14} />
              You're offline — TTS and Twitch connection may be affected
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feature 33: Reconnection Banner */}
      <AnimatePresence>
        {reconnectAttempt > 0 && status === 'connecting' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ...springGentle, duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 py-2.5 px-4 text-xs font-bold" style={{background: 'rgba(217,119,6,0.08)', color: '#b45309', borderBottom: '1px solid rgba(217,119,6,0.15)'}}>
              <Activity size={14} className="animate-pulse" />
              <span>Reconnecting to Twitch... (attempt {reconnectAttempt})</span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background: 'rgba(217,119,6,0.12)', maxWidth: 200}}>
                <motion.div
                  className="h-full rounded-full"
                  style={{background: 'linear-gradient(90deg, #d97706, #fbbf24)'}}
                  initial={{ width: '0%' }}
                  animate={{ width: `${reconnectProgress}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {reconnectAttempt > 0 && status === 'connected' && reconnectProgress === 100 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ...springGentle, duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 py-2 px-4 text-xs font-bold" style={{background: 'rgba(5,150,105,0.08)', color: '#059669', borderBottom: '1px solid rgba(5,150,105,0.15)'}}>
              <Wifi size={14} /> Connected!
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Back online toast */}
      <AnimatePresence>
        {showBackOnline && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            transition={springGentle}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs font-bold shadow-lg"
            style={{background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 20px rgba(5,150,105,0.3)'}}
          >
            <Wifi size={14} /> Back online!
          </motion.div>
        )}
      </AnimatePresence>

      {/* TAB CONTENT — Crossfade transitions with loading spinner */}
      {/* Loading overlay during tab transitions */}
      <AnimatePresence>
        {tabTransitioning && (
          <motion.div
            key="tab-loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none"
            style={{background: 'var(--bg-base)'}}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="tab-loader-spinner" />
              <span className="text-xs font-semibold" style={{color: 'var(--text-tertiary)'}}>Loading...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative">
        <AnimatePresence mode="wait">
        {activeTab === 'dash' && visitedTabs.has('dash') && (
          <motion.div
            key="dash"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="full-width-layout mx-auto py-8"
            style={{ paddingLeft: 'var(--page-padding)', paddingRight: 'var(--page-padding)' }}
          >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 stagger-group">
            {/* Left Column */}
            <div className="lg:col-span-8 space-y-6">
              {/* Stats */}
              <div className="stats-grid grid grid-cols-4 gap-4" data-help-id="help-stats">
                {[
                  { v: stats.total, l: 'Dispatched', icon: <BarChart3 size={22} />, c: '#ef4444', bg: 'rgba(220,53,53,0.08)', glow: '0 4px 16px rgba(220,53,53,0.1)' },
                  { v: stats.chatters, l: 'Chatters', icon: <UserCheck size={22} />, c: '#60a5fa', bg: 'rgba(37,99,235,0.08)', glow: '0 4px 16px rgba(37,99,235,0.1)' },
                  { v: stats.avgChars, l: 'Avg Chars', icon: <MessageSquareText size={22} />, c: '#fbbf24', bg: 'rgba(180,83,9,0.08)', glow: '0 4px 16px rgba(180,83,9,0.1)' },
                  { v: stats.peakQ, l: 'Peak Queue', icon: <SlidersHorizontal size={22} />, c: '#a78bfa', bg: 'rgba(124,58,237,0.08)', glow: '0 4px 16px rgba(124,58,237,0.1)' },
                ].map((s, i) => (
                  <Card key={i} className="text-center py-7 px-4 group card-enter relative" style={{boxShadow: s.glow, '--enter-delay': `${i * 0.06}s`} as React.CSSProperties}>
                    <StatCelebration active={celebratingStat === s.l} />
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 transition-transform duration-200 hover:scale-110 hover:rotate-3 active:scale-95" style={{background: s.bg, color: s.c, boxShadow: `inset 0 0 0 1px ${s.c}22`}}>{s.icon}</div>
                    <AnimatedCounter value={s.v} className="text-4xl font-black font-mono leading-none mb-2" style={{color: s.c, textShadow: `0 0 20px ${s.c}44`}} />
                    <div className="text-[10px] uppercase tracking-[0.15em] font-bold" style={{color: 'var(--text-tertiary)'}}>{s.l}</div>
                  </Card>
                ))}
                {/* Feature 11: Audio cache stats */}
                {audioCacheCount > 0 && (
                  <Card className="text-center py-5 px-4 col-span-4 card-enter" style={{'--enter-delay': '0.25s'} as React.CSSProperties}>
                    <div className="flex items-center justify-center gap-2">
                      <Disc3 size={16} style={{color: 'var(--text-tertiary)'}} />
                      <span className="text-xs font-bold" style={{color: 'var(--text-secondary)'}}>Audio Cache: {audioCacheCount} files</span>
                    </div>
                  </Card>
                )}
              </div>

              {/* Sound Effect Instructions */}
              <div className="card-enter" style={{'--enter-delay': '0.15s'} as React.CSSProperties}><Card className="p-5 transition-all duration-300" style={{background: 'linear-gradient(135deg, rgba(180,83,9,0.04) 0%, rgba(217,119,6,0.03) 100%)', borderColor: 'rgba(180,83,9,0.1)'}} data-help-id="help-inline-sfx-guide">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{background: 'rgba(180,83,9,0.08)', color: '#b45309'}}><Volume2 size={16} /></div>
                  <div className="flex-1" data-help-id="help-tts-command">
                    <h3 className="font-bold text-sm mb-1" style={{color: 'var(--text-primary)'}}>Inline Sound Effects Guide</h3>
                    <p className="text-xs mb-3" style={{color: 'var(--text-secondary)'}}>Add sound effects between words using parentheses <code className="px-1.5 py-0.5 rounded font-mono" style={{background: 'var(--bg-surface)', color: '#b45309', border: '1px solid rgba(180,83,9,0.12)'}}>()</code>. Replace spaces with underscores <code className="px-1.5 py-0.5 rounded font-mono" style={{background: 'var(--bg-surface)', color: '#b45309', border: '1px solid rgba(180,83,9,0.12)'}}>_</code>. Max 20 sounds per message.</p>
                <div className="rounded-lg p-3 font-mono text-xs space-y-1" style={{background: 'var(--bg-surface)', border: '1px solid rgba(180,83,9,0.08)'}}>
                  <div><span className="font-bold" style={{color: '#b45309'}}>Ex 1:</span> <code style={{color: 'var(--text-primary)'}}>!tts Hello (vine_boom) world</code></div>
                  <div className="text-[10px]" style={{color: 'var(--text-tertiary)'}}>→ Says "Hello" → Plays Vine Boom → Says "world"</div>
                  <div className="mt-1"><span className="font-bold" style={{color: '#b45309'}}>Ex 2:</span> <code style={{color: 'var(--text-primary)'}}>!tts Start (bruh) middle (bruh) end</code></div>
                  <div className="text-[10px]" style={{color: 'var(--text-tertiary)'}}>→ Says "Start" → Plays Bruh → Says "middle" → Plays Bruh → Says "end"</div>
                </div>
                  </div>
                </div>
              </Card></div>

              {/* Connect + Tester */}
              <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 gap-6" delay={0.08}>
                <div className="card-enter" style={{'--enter-delay': '0.1s'} as React.CSSProperties}><Card className="p-6 transition-all duration-300 hover:shadow-lg" data-help-id="help-twitch-connect">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-red-700 shadow-sm" style={{background: 'var(--dm-grad-red-from)'}}><Radio size={18} /></div>
                    <div><h2 className="font-bold text-sm" style={{color: 'var(--text-primary)'}}>Twitch Chat</h2><p className="text-[10px] uppercase tracking-wider font-semibold" style={{color: 'var(--text-tertiary)'}}>Anonymous WebSocket</p></div>
                  </div>
                  <input value={channel} onChange={e => { setChannel(e.target.value); syncSettingsToServer({ channel: e.target.value }); }} disabled={status === 'connected'}
                    placeholder="your_channel" className="w-full classic-input mb-4 font-mono text-sm" />
                  {status === 'connected' ? (
                    <button onClick={disconnect} className="w-full btn-classic-primary bg-red-700 hover:bg-red-800"
                    >Disconnect</button>
                  ) : (
                    <button onClick={connect} className="w-full btn-classic-primary"
                    >Connect to Twitch</button>
                  )}
                </Card></div>
                <div className="card-enter" style={{'--enter-delay': '0.16s'} as React.CSSProperties}><Card className="p-6 transition-all duration-300 hover:shadow-lg" data-help-id="help-test-voice">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-600 shadow-sm" style={{background: 'var(--dm-grad-amber-to)'}}><Sparkles size={18} /></div>
                    <div><h2 className="font-bold text-sm" style={{color: 'var(--text-primary)'}}>Test Voice</h2><p className="text-[10px] uppercase tracking-wider font-semibold" style={{color: 'var(--text-tertiary)'}}>Preview Settings</p></div>
                  </div>
                  <textarea value={testText} onChange={e => setTestText(e.target.value)} rows={3}
                    className="w-full classic-input resize-none mb-4 text-sm" />
                  <div className="flex gap-3">
                    <button onClick={testSpeak} className="flex-1 btn-classic-primary"
                    >
                      <Play size={14} /> Speak
                    </button>
                    <button onClick={randomPhrase} className="btn-classic-secondary px-4 vol-btn"
                      title="Random Phrase"
                    >🎲</button>
                  </div>
                </Card></div>
              </StaggerGroup>

              {/* Queue */}
              <div className="card-enter" style={{'--enter-delay': '0.22s'} as React.CSSProperties}><Card className="p-6 transition-all duration-300" data-help-id="help-queue">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="font-bold text-lg flex items-center gap-2" style={{color: 'var(--text-primary)'}}><Clock size={18} className="text-red-700" /> Dispatch Queue</h2>
                    <p className="text-[10px] font-mono mt-0.5 uppercase tracking-wider font-semibold" style={{color: 'var(--text-tertiary)'}}>{queue.length} pending {queue.length > 0 && <span>• ~{Math.round(queue.length * avgTTSDuration / 60)}m est.</span>}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={shuffleQueue} disabled={queue.length < 2} className="btn-classic-secondary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1.5 vol-btn"
                    ><Shuffle size={12} /> Shuffle</button>
                    <button onClick={repeatLast} disabled={!history.length} className="btn-classic-secondary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1.5 vol-btn"
                    ><Repeat size={12} /> Repeat</button>
                    <button onClick={(e) => skip(e)} disabled={!playing} className="btn-classic-secondary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1.5 vol-btn"
                    ><SkipForward size={12} /> Skip</button>
                    <button onClick={clearQueue} className="btn-classic-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 vol-btn"
                    ><Trash2 size={12} /> Clear</button>
                    <button onClick={() => { chattersSetRef.current.clear(); setStats({ total: 0, chatters: 0, avgChars: 0, peakQ: 0 }); try { localStorage.removeItem('tts_stats'); } catch {} fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ttsStats: { total: 0, chatters: 0, avgChars: 0, peakQ: 0 } }) }).catch(() => {}); log('Stats reset (local + cloud).'); addToast('Stats reset', 'info', 2000); }} className="btn-classic-secondary text-xs py-1.5 px-3 flex items-center gap-1.5" style={{color: 'var(--text-tertiary)'}}>Reset Stats</button>
                  </div>
                </div>
                {playing ? (
                  <SpeakingGlow>
                  <ScalePop className="mb-6 p-6 rounded-2xl relative overflow-hidden now-speaking-card" style={{background: 'linear-gradient(135deg, rgba(220,53,53,0.06) 0%, rgba(124,58,237,0.03) 100%)', boxShadow: '0 0 0 1px rgba(220,53,53,0.12), 0 4px 16px rgba(220,53,53,0.06)', border: '1px solid rgba(220,53,53,0.1)'}}>
                    <div className="absolute top-0 left-0 right-0 h-[2px] animate-gradient-line" style={{background: 'linear-gradient(90deg, transparent, #dc3535, #7c3aed, #dc3535, transparent)', backgroundSize: '200% 100%'}} />
                    <div className="absolute top-3 right-3">
                      <PulseRing color="#dc3535" size={12} />
                    </div>
                    <div className="flex items-center gap-2.5 mb-3">
                      <span
                        className="w-2 h-2 rounded-full animate-pulse-dot"
                        style={{background: '#dc3535', boxShadow: '0 0 6px rgba(220,53,53,0.4)'}}
                      />
                      <span className="text-xs font-bold uppercase tracking-wider" style={{color: '#dc3535'}}>Now Speaking</span>
                      {/* Typing indicator animation */}
                      <span className="flex items-center gap-[3px] ml-1">
                        <span className="typing-dot w-[4px] h-[4px] rounded-full bg-red-500" style={{animationDelay: '0ms'}} />
                        <span className="typing-dot w-[4px] h-[4px] rounded-full bg-red-500" style={{animationDelay: '150ms'}} />
                        <span className="typing-dot w-[4px] h-[4px] rounded-full bg-red-500" style={{animationDelay: '300ms'}} />
                      </span>
                      <Badge color={playing.engine === 'camb' ? 'blue' : 'amber'}>{playing.engine}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-black" style={{color: 'var(--text-primary)'}}>
                        {/* Feature 3: Voice morph text for voice name */}
                        <VoiceMorphText text={playing.voiceDisplayName || playing.voice} />
                      </div>
                      <div className="text-sm" style={{color: 'var(--text-tertiary)'}}>by {playing.user}</div>
                      <motion.button onClick={() => quickMuteUser(playing.user)} className="hover:bg-orange-100 rounded-lg p-1" style={{color: '#b45309'}} title="Mute this user" whileHover={{ scale: 1.2, rotate: -5 }} whileTap={{ scale: 0.9 }} transition={springBouncy}><UserX size={16} /></motion.button>
                    </div>
                    <p className="text-sm italic mt-1" style={{color: 'var(--text-secondary)'}}>"{playing.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ')}"</p>
                    {/* Feature 5: Queue progress bar */}
                    <QueueProgress isPlaying={!!playing} estimatedDuration={playing.engine === 'camb' ? 10 : Math.max(5, (playing.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ').length / 150) * 10)} />
                  </ScalePop>
                  </SpeakingGlow>
                ) : (
                  <motion.div className="mb-6 p-8 rounded-2xl border border-dashed text-center" style={{background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)'}}
                    initial={{ opacity: 0.5 }} animate={{ opacity: [0.5, 0.8, 0.5] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <div className="text-sm font-semibold uppercase tracking-wider" style={{color: 'var(--text-tertiary)'}}>Ready for transmission</div>
                  </motion.div>
                )}

                {/* Quick Mute Bar — always visible when users are muted */}
                {blockedUsers.trim().length > 0 && (
                  <div className="mb-4 p-3 rounded-xl border shadow-sm" style={{background: 'linear-gradient(to right, var(--dm-grad-orange-from), var(--dm-grad-amber-to))', borderColor: 'var(--dm-grad-orange-border)'}}>
                    <div className="flex items-center gap-2 mb-2">
                      <UserX size={12} className="text-orange-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Muted Users</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {blockedUsers.split(',').map(u => u.trim()).filter(Boolean).map((user, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[10px] font-bold">
                          {user}
                          <button
                            onClick={() => {
                              const updated = blockedUsers.split(',').map(u => u.trim()).filter(u => u.toLowerCase() !== user.toLowerCase()).join(', ');
                              setBlockedUsers(updated);
                              try { localStorage.setItem('blocked_users', updated); } catch {}
                              settingsRef.current.blockedUsers = updated;
                              log(`Unmuted: ${user}`);
                            }}
                            className="text-orange-400 hover:text-orange-700 ml-0.5 cursor-pointer"
                            title={`Unmute ${user}`}
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 scrollbar-thin" data-lenis-prevent>
                  {queue.length === 0 && <FadeIn><div className="text-xs text-center py-10 font-medium" style={{color: 'var(--text-tertiary)'}}>Queue empty</div></FadeIn>}
                  <AnimatePresence>
                  {queue.map((item, i) => (
                    <QueueItemMotion key={item.id}>
                    <motion.div
                      className="border rounded-xl p-3 flex items-center justify-between group"
                      style={{
                        background: dragOverIdx === i ? 'rgba(220,53,53,0.05)' : 'var(--bg-surface)',
                        borderColor: dragOverIdx === i ? 'rgba(220,53,53,0.3)' : 'var(--border-subtle)',
                        opacity: dragIdx === i ? 0.5 : 1,
                      }}
                      whileHover={{ borderColor: 'rgba(220,53,53,0.3)', backgroundColor: 'rgba(220,53,53,0.02)', x: 4 }}
                      transition={springMicro}
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragOverIdx(i); }}
                      onDragLeave={() => setDragOverIdx(null)}
                      onDrop={() => {
                        if (dragIdx !== null && dragIdx !== i) {
                          setQueue(prev => {
                            const arr = [...prev];
                            const [moved] = arr.splice(dragIdx, 1);
                            arr.splice(i, 0, moved);
                            return arr;
                          });
                        }
                        setDragIdx(null); setDragOverIdx(null);
                      }}
                      onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <GripVertical size={12} className="cursor-grab shrink-0" style={{color: 'var(--text-muted)'}} />
                        <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold shrink-0" style={{background: i === 0 ? 'rgba(220,53,53,0.1)' : 'var(--bg-inset)', color: i === 0 ? 'var(--crimson-400)' : 'var(--text-tertiary)'}}>#{i + 1}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm" style={{color: 'var(--text-primary)'}}>{item.user}</span>
                            <Badge color={item.engine === 'camb' ? 'blue' : 'amber'}>{item.engine}</Badge>
                            <span className="text-[9px] font-mono" style={{color: 'var(--text-tertiary)'}}>~{Math.round(avgTTSDuration * item.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ').length / 150)}s</span>
                          </div>
                          <p className="text-xs truncate" style={{color: 'var(--text-secondary)'}}>"{item.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ')}"</p>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0 items-center">
                        <button onClick={() => quickMuteUser(item.user)} className="text-orange-400 hover:text-orange-600 p-1 cursor-pointer" title="Mute this user"><UserX size={13} /></button>
                        <button onClick={() => moveQueueItemToFront(item.id)} className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded hover:bg-amber-100 cursor-pointer" title="Play next"><ArrowUpToLine size={12} /></button>
                        <button onClick={() => removeQueueItem(item.id)} className="text-gray-400 hover:text-red-600 p-1 cursor-pointer"><Trash2 size={14} /></button>
                      </div>
                    </motion.div>
                    </QueueItemMotion>
                  ))}
                  </AnimatePresence>
                </div>
              </Card></div>

              {/* TTS History — always visible */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.3 }}><Card className="p-6 transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-red-600" />
                    <h2 className="font-bold text-base" style={{color: 'var(--text-primary)'}}>TTS History</h2>
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full" style={{color: 'var(--text-tertiary)', background: 'var(--bg-inset)'}}>{history.length} items</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {history.length > 0 && (
                      <>
                        {/* Feature 7: Export buttons */}
                        <div className="relative group">
                          <button className="btn-classic-secondary text-[10px] py-1 px-2 flex items-center gap-1" title="Export"><FileDown size={11} /> Export</button>
                          <div className="absolute right-0 top-full mt-1 classic-card p-1.5 min-w-[140px] z-50 hidden group-hover:block" style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>
                            <button onClick={exportHistoryCSV} className="w-full text-left text-[10px] px-3 py-1.5 rounded-lg hover:bg-stone-100 font-semibold flex items-center gap-2 cursor-pointer" style={{color: 'var(--text-secondary)'}}><FileDown size={11} /> Export CSV</button>
                            <button onClick={exportHistoryJSON} className="w-full text-left text-[10px] px-3 py-1.5 rounded-lg hover:bg-stone-100 font-semibold flex items-center gap-2 cursor-pointer" style={{color: 'var(--text-secondary)'}}><FileJson size={11} /> Export JSON</button>
                          </div>
                        </div>
                        <button onClick={() => { setHistory([]); try { localStorage.removeItem('tts_history'); } catch {} log('History cleared.'); addToast('History cleared', 'info', 2000); }} className="text-gray-400 hover:text-red-600 p-1" title="Clear history"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
                {history.length > 0 && (
                  <div className="relative mb-3">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color: 'var(--text-muted)'}} />
                    <input
                      type="text"
                      value={chatterSearchQuery}
                      onChange={e => setChatterSearchQuery(e.target.value)}
                      placeholder="Search user to look up..."
                      className="classic-input w-full pl-9 text-sm"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && chatterSearchQuery.trim()) {
                          const match = history.find(h => h.user.toLowerCase().includes(chatterSearchQuery.trim().toLowerCase()));
                          if (match) {
                            setChatterLookupUser(match.user);
                            setMessageSearchQuery('');
                          }
                        }
                      }}
                    />
                  </div>
                )}
                {history.length === 0 ? (
                  <div className="py-12 text-center">
                    <Float className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-sm" style={{background: 'var(--bg-inset)'}}>
                      <Clock size={28} style={{color: 'var(--text-muted)'}} />
                    </Float>
                    <p className="text-sm font-semibold" style={{color: 'var(--text-secondary)'}}>No TTS history yet</p>
                    <p className="text-[11px] mt-1" style={{color: 'var(--text-muted)'}}>Messages will appear here after being spoken</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-2 scrollbar-thin" data-lenis-prevent>
                    {history.map((item) => (
                      <motion.div key={item.id} className="border rounded-lg p-3 flex items-center justify-between" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-subtle)'}} whileHover={{ borderColor: 'rgba(0,0,0,0.15)', x: 3 }} transition={springMicro}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span 
                                className="font-bold text-xs cursor-pointer hover:underline" 
                                style={{color: 'var(--crimson-400)'}} 
                                onClick={() => { setChatterLookupUser(item.user); setMessageSearchQuery(''); }}
                                title="View message history"
                              >{item.user}</span>
                              <Badge color={item.engine === 'camb' ? 'blue' : 'amber'}>{item.engine}</Badge>
                              <span className="text-[9px] font-mono" style={{color: 'var(--text-tertiary)'}}>{item.timestamp.toLocaleTimeString()}</span>
                            </div>
                            <p className="text-[11px] truncate max-w-xs" style={{color: 'var(--text-secondary)'}}>"{item.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ')}"</p>
                          </div>
                        </div>
                        <div className="flex items-center shrink-0">
                          <button onClick={() => quickMuteUser(item.user)} className="text-orange-400 hover:text-orange-500 p-1" title="Mute this user"><UserX size={12} /></button>
                          <button onClick={() => setQueue(p => [...p, { ...item, id: genId(), timestamp: new Date() }])} className="text-gray-300 hover:text-red-500 p-1" title="Re-queue this message"><Repeat size={12} /></button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </Card></motion.div>
            </div>

            {/* Right: Console (Sticky) */}
            <div className="lg:col-span-4">
              <div className="sticky top-24 space-y-6">
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.15 }}><Card className="!p-0 overflow-hidden border-gray-200 shadow-lg" data-help-id="help-console">
                  <div className="p-3 flex items-center justify-between border-b" style={{borderColor: 'var(--border-subtle)', background: 'var(--bg-inset)'}}>
                    <div className="flex items-center gap-2">
                      <MessageSquareText size={14} className="text-red-600" />
                      <span className="text-xs font-bold uppercase tracking-wider" style={{color: 'var(--text-secondary)'}}>Console</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono mr-2" style={{color: 'var(--text-tertiary)'}}>{logs.length}</span>
                      <button onClick={exportLogs} disabled={logs.length === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-1 rounded"><Download size={12} /></button>
                      <button onClick={() => { setLogs([]); }} disabled={logs.length === 0} className="text-gray-400 hover:text-red-600 disabled:opacity-30 p-1 rounded"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div ref={logsRef} className="h-[500px] overflow-y-auto bg-gray-900 p-4 font-mono text-[11px] text-green-400 leading-relaxed scrollbar-thin" data-lenis-prevent>
                    {logs.length === 0 && <span className="text-gray-600 block text-center mt-20 italic">System ready...</span>}
                    {logs.map((l, i) => (
                      <ConsoleLine key={`${i}-${l}`} className="mb-1 hover:opacity-100" isLast={i === logs.length - 1} textContent={l}>
                        <span className="text-gray-600 select-none mr-2">{l.slice(0, 10)}</span>
                        <span className="text-green-400">{l.slice(11)}</span>
                      </ConsoleLine>
                    ))}
                  </div>
                </Card></motion.div>

                {/* TTS Leaderboard */}
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.25 }}>
                  <Card className="p-6" data-help-id="help-leaderboard">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Trophy size={16} className="text-amber-500" />
                        <h2 className="font-bold text-base" style={{color: 'var(--text-primary)'}}>TTS Leaderboard</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Feature 7: Export leaderboard */}
                        <div className="relative group">
                          <button className="btn-classic-secondary text-[10px] py-1 px-2 flex items-center gap-1" title="Export"><FileDown size={11} /></button>
                          <div className="absolute right-0 top-full mt-1 classic-card p-1.5 min-w-[140px] z-50 hidden group-hover:block" style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>
                            <button onClick={exportLeaderboardCSV} className="w-full text-left text-[10px] px-3 py-1.5 rounded-lg hover:bg-stone-100 font-semibold flex items-center gap-2 cursor-pointer" style={{color: 'var(--text-secondary)'}}><FileDown size={11} /> Export CSV</button>
                            <button onClick={exportLeaderboardJSON} className="w-full text-left text-[10px] px-3 py-1.5 rounded-lg hover:bg-stone-100 font-semibold flex items-center gap-2 cursor-pointer" style={{color: 'var(--text-secondary)'}}><FileJson size={11} /> Export JSON</button>
                          </div>
                        </div>
                        <button
                          onClick={() => { setLeaderboard({ chatters: {}, voices: {}, presets: {} }); try { localStorage.removeItem('tts_leaderboard'); } catch {} log('Leaderboard reset.'); addToast('Leaderboard reset', 'info', 2000); }}
                          className="text-gray-400 hover:text-red-600 p-1"
                          title="Reset Leaderboard"
                        >
                          <RotateCcw size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Feature 6: Time Range Filter */}
                    <div className="flex gap-1.5 mb-4">
                      {(['all', 'today', 'week'] as const).map(range => (
                        <button
                          key={range}
                          onClick={() => setLbTimeRange(range)}
                          className="px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer transition"
                          style={lbTimeRange === range
                            ? { background: 'var(--crimson-500)', color: '#fff' }
                            : { background: 'var(--bg-inset)', color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' }
                          }
                        >
                          {range === 'all' ? 'All Time' : range === 'today' ? 'Today' : 'This Week'}
                        </button>
                      ))}
                    </div>

                    {/* Top Chatters */}
                    <div className="mb-4">
                      <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{color: 'var(--text-tertiary)'}}>Top Chatters</div>
                      {Object.entries(filteredLeaderboard.chatters).length === 0 ? (
                        <div className="text-xs text-center py-4" style={{color: 'var(--text-muted)'}}>No data yet</div>
                      ) : (
                        <div className="space-y-1.5">
                          {Object.entries(filteredLeaderboard.chatters)
                            .sort((a, b) => b[1].count - a[1].count)
                            .slice(0, 5)
                            .map(([user, data], i) => (
                              <div key={user} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg" style={{background: i === 0 ? 'rgba(234,179,8,0.06)' : 'transparent'}}>
                                <span className={`leaderboard-rank ${i === 0 ? 'leaderboard-rank-1' : i === 1 ? 'leaderboard-rank-2' : i === 2 ? 'leaderboard-rank-3' : 'leaderboard-rank-default'}`}>{i + 1}</span>
                                <span 
                                  className="text-sm font-bold flex-1 cursor-pointer hover:underline" 
                                  style={{color: 'var(--crimson-400)'}} 
                                  onClick={() => { setChatterLookupUser(user); setMessageSearchQuery(''); }}
                                  title="View message history"
                                >{user}</span>
                                <span className="text-xs font-mono font-bold" style={{color: 'var(--crimson-400)'}}>{data.count}</span>
                                <span className="text-[10px] truncate max-w-[80px]" style={{color: 'var(--text-tertiary)'}} title={data.lastVoice}>{data.lastVoice}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Top Voices & Presets — side by side */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{color: 'var(--text-tertiary)'}}>Top Voices</div>
                        {Object.entries(filteredLeaderboard.voices).length === 0 ? (
                          <div className="text-[10px] text-center py-2" style={{color: 'var(--text-muted)'}}>-</div>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(filteredLeaderboard.voices)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 3)
                              .map(([voice, count], i) => (
                                <div key={voice} className="flex items-center gap-1.5 text-[11px]">
                                  <span className="w-4 text-center font-bold" style={{color: i === 0 ? '#ca8a04' : 'var(--text-muted)'}}>{i + 1}</span>
                                  <span className="truncate flex-1" style={{color: 'var(--text-secondary)'}} title={voice}>{voice}</span>
                                  <span className="font-mono font-bold" style={{color: 'var(--text-tertiary)'}}>{count}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{color: 'var(--text-tertiary)'}}>Top Presets</div>
                        {Object.entries(filteredLeaderboard.presets).length === 0 ? (
                          <div className="text-[10px] text-center py-2" style={{color: 'var(--text-muted)'}}>-</div>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(filteredLeaderboard.presets)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 3)
                              .map(([preset, count], i) => (
                                <div key={preset} className="flex items-center gap-1.5 text-[11px]">
                                  <span className="w-4 text-center font-bold" style={{color: i === 0 ? '#ca8a04' : 'var(--text-muted)'}}>{i + 1}</span>
                                  <span className="truncate flex-1 capitalize" style={{color: 'var(--text-secondary)'}}>{preset}</span>
                                  <span className="font-mono font-bold" style={{color: 'var(--text-tertiary)'}}>{count}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              </div>
            </div>
          </div>
        </motion.div>
        )}

        {activeTab === 'voice' && visitedTabs.has('voice') && (
          <motion.div
            key="voice"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="full-width-layout mx-auto py-8"
            style={{ paddingLeft: 'var(--page-padding)', paddingRight: 'var(--page-padding)' }}
          >
          <DeferredMount>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7">
              <Card>
                <div className="flex items-center gap-2.5 mb-6">
                  <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center border border-red-100" style={{color: 'var(--crimson-500)'}}><Mic2 size={18} /></div>
                  <h2 className="text-lg font-bold font-serif-classic leading-none" style={{color: 'var(--text-primary)'}}>Voice Synthesis Engine</h2>
                </div>
                <div className="section-header-line mt-2" />
                <div className="engine-toggle mb-6" data-help-id="help-engine-select">
                  {([
                    { id: 'camb' as Engine, label: 'Camb.ai voice cloning' },
                    { id: 'webspeech' as Engine, label: 'Browser system TTS' },
                  ]).map(e => (
                    <button key={e.id} onClick={() => setEngine(e.id)} className={`engine-toggle-btn ${engine === e.id ? 'engine-toggle-active' : ''}`}>
                      {e.label}
                    </button>
                  ))}
                </div>

                {engine === 'camb' && (
                  <div className="space-y-6">
                    {/* API Keys — Server-side only (SECURITY: keys never exposed to browser) */}
                    <div className="rounded-xl p-5 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}} data-help-id="help-api-key-mode">
                      <div className="space-y-2">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 leading-relaxed font-semibold">
                          API keys are stored securely as server environment variables. No keys are ever exposed to the browser. Set <code className="bg-emerald-100 px-1 rounded">CAMB_API_KEY_1</code>, <code className="bg-emerald-100 px-1 rounded">CAMB_API_KEY_2</code>, etc. in your deployment environment.
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-stone-500">Server keys configured:</span>
                          <span className="font-bold text-emerald-700">{serverKeyCount} key(s)</span>
                        </div>
                        <button onClick={loadVoices} disabled={fetching} className="btn-classic-secondary text-xs py-2 px-4 w-full disabled:opacity-40">
                          <RefreshCw size={12} className={fetching ? 'animate-spin' : ''} /> {fetching ? 'Loading...' : 'Reload Voices from Server'}
                        </button>
                      </div>
                    </div>

                    {favVoices.length > 0 && (
                      <div className="rounded-xl p-5 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}} data-help-id="help-fav-voices">
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{color: 'var(--crimson-500)'}}><Heart size={12} className="fill-current animate-pulse" /> Pin Favorite Voices</div>
                        <div className="flex flex-wrap gap-2">
                          {favVoices.map(v => (
                            <button key={v.id} onClick={() => setVoiceId(v.id)} className={`text-xs px-3.5 py-2 rounded-xl border cursor-pointer font-bold transition-all ${voiceId === v.id ? 'text-white shadow-sm' : ''}`} style={voiceId === v.id ? {background: 'var(--crimson-500)', borderColor: 'var(--crimson-500)'} : {background: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)'}}>
                              {v.voice_name} <span className="opacity-50 font-mono text-[9px]">({voiceNameToAlias(v.voice_name)})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] text-stone-500 font-bold uppercase tracking-wider font-semibold">Voices Directory ({filteredVoices.length})</span>
                        <button onClick={loadVoices} disabled={fetching} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-[10px] font-bold border border-stone-200 disabled:opacity-40 cursor-pointer hover:bg-stone-200 transition">
                          <RefreshCw size={11} className={fetching ? 'animate-spin' : ''} /> Refresh Directory
                        </button>
                      </div>
                      <div className="relative mb-3">
                        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                        <input value={voiceSearch} onChange={e => setVoiceSearch(e.target.value)} placeholder="Search voice database..."
                          className="w-full classic-input pl-10 text-sm font-semibold" data-voice-search />
                      </div>
                      <div className="border rounded-xl max-h-[32rem] overflow-y-auto divide-y scrollbar-thin content-auto" style={{borderColor: 'var(--border-default)', background: 'var(--bg-surface)'}} data-help-id="help-voices-directory" data-lenis-prevent>
                        {filteredVoices.length === 0 && <div className="p-10 text-center text-sm text-stone-400 font-medium italic">{voices.length === 0 ? 'Enter API key above to load voice models.' : 'No matches.'}</div>}
                        {/* Feature 10: Virtualized voice list when 50+ voices */}
                        {filteredVoices.length > 50 ? (
                          <VirtualList
                            items={filteredVoices}
                            itemHeight={170}
                            containerHeight={512}
                            renderItem={(v, _idx) => {
                              const sel = voiceId === v.id;
                              const isFav = favs.includes(v.id);
                              const currentBoost = cambVoiceBoosts[v.id] ?? 1.0;
                              const hasCustomVol = currentBoost !== 1.0;
                              const vs = cambVoiceSettings[v.id] || {};
                              const currentModel = vs.model || '';
                              const currentEnhance = vs.enhance !== undefined ? vs.enhance : true;
                              const currentRate = vs.speakingRate !== undefined ? vs.speakingRate : 0.7;
                              const hasCustomSettings = !!vs.model || vs.enhance === false || (vs.speakingRate !== undefined && vs.speakingRate !== 0.7);
                              return (
                                <div key={v.id}
                                  className={`voice-item ${sel ? 'bg-red-50/50' : ''}`}
                                  style={{height: 170}}>
                                  <div className="flex items-center justify-between px-5 py-2.5 cursor-pointer" onClick={() => { setVoiceId(v.id); if (typeof v.gender === 'number') setCambGender(v.gender); if (v.age) setCambAge(Number(v.age) || 30); }}>
                                    <div>
                                      <div className="text-sm font-bold flex items-center gap-2">
                                        {sel && <span className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(168,36,36,0.5)]" style={{background: 'var(--crimson-500)'}} />}
                                        {sel ? <VoiceMorphText text={v.voice_name} className={sel ? 'font-bold' : 'text-stone-800'} style={sel ? {color: 'var(--crimson-500)'} : {}} /> : <span className={sel ? 'font-bold' : 'text-stone-800'} style={sel ? {color: 'var(--crimson-500)'} : {}}>{v.voice_name}</span>}
                                        {hasCustomVol && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md" style={{background: currentBoost < 1.0 ? 'rgba(37,99,235,0.12)' : 'rgba(220,53,53,0.12)', color: currentBoost < 1.0 ? '#2563eb' : 'var(--crimson-500)'}}>{currentBoost.toFixed(1)}x</span>}
                                        {hasCustomSettings && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700">Custom</span>}
                                      </div>
                                      <div className="text-[10px] text-stone-400 font-mono mt-0.5">ID {v.id} • {v.gender === 1 ? 'Male' : 'Female'}{v.age ? ` • Age ${v.age}` : ''} • <span className="text-blue-400">!{voiceNameToAlias(v.voice_name)}:</span></div>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                      {v.is_published ? <Badge color="green">Public</Badge> : <Badge color="purple">Cloned</Badge>}
                                      <button onClick={e => { e.stopPropagation(); toggleFav(v.id); }} className={`p-1.5 rounded-lg hover:bg-stone-100 transition cursor-pointer ${isFav ? 'text-red-500' : 'text-stone-300 hover:text-red-400'}`}>
                                        {isFav ? <Heart size={15} className="fill-current" /> : <HeartOff size={15} />}
                                      </button>
                                    </div>
                                  </div>
                                  {/* Per-voice settings row */}
                                  <div className="px-5 pb-2 pt-0 space-y-1.5" onClick={e => e.stopPropagation()}>
                                    {/* Row 1: Model selector + Enhance toggle */}
                                    <div className="flex items-center gap-2">
                                      <select
                                        value={currentModel}
                                        onChange={e => {
                                          const val = e.target.value;
                                          setCambVoiceSettings(prev => {
                                            const next = { ...prev };
                                            if (!val) {
                                              // Only clear the model key — preserve enhance/speakingRate
                                              const remaining = { ...next[v.id] };
                                              delete remaining.model;
                                              if (Object.keys(remaining).length === 0 || (Object.keys(remaining).length === 1 && remaining.enhance === true)) {
                                                delete next[v.id];
                                              } else {
                                                next[v.id] = remaining;
                                              }
                                            } else { next[v.id] = { ...next[v.id], model: val }; }
                                            return next;
                                          });
                                        }}
                                        className="text-[10px] font-bold rounded-lg border px-2 py-1 cursor-pointer flex-1"
                                        style={{ background: 'var(--bg-inset)', borderColor: 'var(--border-default)', color: currentModel ? '#7c3aed' : 'var(--text-muted)' }}
                                        title="Select model for this voice"
                                      >
                                        <option value="">Default Model</option>
                                        <option value="mars-8.1-pro-beta">8.1 Pro (Best Quality)</option>
                                        <option value="mars-8.1-flash-beta">8.1 Flash (Fastest)</option>
                                        <option value="mars-flash">Mars Flash</option>
                                        <option value="mars-pro">Mars Pro</option>
                                      </select>
                                      <button
                                        onClick={() => {
                                          setCambVoiceSettings(prev => {
                                            const next = { ...prev };
                                            const newEnhance = !currentEnhance;
                                            if (!vs.model && newEnhance && (vs.speakingRate === undefined || vs.speakingRate === 0.7)) {
                                              delete next[v.id];
                                            } else {
                                              next[v.id] = { ...next[v.id], enhance: newEnhance };
                                            }
                                            return next;
                                          });
                                        }}
                                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer transition flex items-center gap-1 ${currentEnhance ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-50 text-stone-400 border-stone-200'}`}
                                        title={`Enhance: ${currentEnhance ? 'ON' : 'OFF'}`}
                                      >
                                        <Sparkles size={10} />
                                        {currentEnhance ? 'ON' : 'OFF'}
                                      </button>
                                    </div>
                                    {/* Row 2: Speaking Rate slider */}
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 w-7">Speed</span>
                                      <input
                                        type="range" min={0.3} max={2.0} step={0.05}
                                        value={currentRate}
                                        onChange={e => {
                                          const val = parseFloat(e.target.value);
                                          setCambVoiceSettings(prev => {
                                            const next = { ...prev };
                                            if (Math.abs(val - 0.7) < 0.03 && !vs.model && vs.enhance !== false) {
                                              delete next[v.id];
                                            } else {
                                              next[v.id] = { ...next[v.id], speakingRate: val };
                                            }
                                            return next;
                                          });
                                        }}
                                        className="flex-1 h-1 cursor-pointer accent-purple-500"
                                        title={`Speaking rate: ${currentRate.toFixed(2)}x`}
                                      />
                                      <span className="text-[10px] font-mono w-8 text-right font-bold" style={{color: Math.abs(currentRate - 0.7) > 0.03 ? '#7c3aed' : 'var(--text-muted)'}}>{currentRate.toFixed(1)}x</span>
                                    </div>
                                    {/* Row 3: Volume slider */}
                                    <div className="flex items-center gap-1.5">
                                      <Volume2 size={10} className={hasCustomVol ? (currentBoost < 1.0 ? 'text-blue-500' : 'text-red-500') : 'text-stone-300'} />
                                      <div className="relative flex-1">
                                        <input
                                          type="range" min={0.2} max={5} step={0.1}
                                          value={currentBoost}
                                          onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            setCambVoiceBoosts(prev => {
                                              const next = { ...prev };
                                              if (Math.abs(val - 1.0) < 0.05) { delete next[v.id]; } else { next[v.id] = val; }
                                              return next;
                                            });
                                          }}
                                          className="w-full h-1 cursor-pointer accent-red-600"
                                          title={`Volume: ${currentBoost.toFixed(1)}x`}
                                        />
                                        <div className="absolute top-0 w-px h-2.5 bg-stone-400" style={{ left: `${((1.0 - 0.2) / (5.0 - 0.2)) * 100}%` }} title="1.0x normal" />
                                      </div>
                                      <span className="text-[10px] font-mono w-8 text-right font-bold" style={{color: hasCustomVol ? (currentBoost < 1.0 ? '#2563eb' : 'var(--crimson-500)') : 'var(--text-muted)'}}>{currentBoost.toFixed(1)}x</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          />
                        ) : (
                          filteredVoices.map(v => {
                          const sel = voiceId === v.id;
                          const isFav = favs.includes(v.id);
                          const isPreviewing = previewingVoiceId === v.id;
                          const currentBoost = cambVoiceBoosts[v.id] ?? 1.0;
                          const hasCustomVol = currentBoost !== 1.0;
                          const vs = cambVoiceSettings[v.id] || {};
                          const currentModel = vs.model || '';
                          const currentEnhance = vs.enhance !== undefined ? vs.enhance : true;
                          const currentRate = vs.speakingRate !== undefined ? vs.speakingRate : 0.7;
                          const hasCustomSettings = !!vs.model || vs.enhance === false || (vs.speakingRate !== undefined && vs.speakingRate !== 0.7);
                          return (
                            <div key={v.id}
                              className={`voice-item ${sel ? 'bg-red-50/50' : ''}`}
                              onMouseEnter={() => startVoicePreview(v.id)}
                              onMouseLeave={cancelVoicePreview}>
                              <div className="flex items-center justify-between px-5 py-3 cursor-pointer" onClick={() => { setVoiceId(v.id); if (typeof v.gender === 'number') setCambGender(v.gender); if (v.age) setCambAge(Number(v.age) || 30); }}>
                                <div>
                                  <div className="text-sm font-bold flex items-center gap-2">
                                    {sel && <span className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(168,36,36,0.5)]" style={{background: 'var(--crimson-500)'}} />}
                                    <span className={sel ? 'font-bold' : 'text-stone-800'} style={sel ? {color: 'var(--crimson-500)'} : {}}>{v.voice_name}</span>
                                    {isPreviewing && <Volume1 size={12} className="text-red-400 animate-pulse" />}
                                    {hasCustomVol && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md" style={{background: currentBoost < 1.0 ? 'rgba(37,99,235,0.12)' : 'rgba(220,53,53,0.12)', color: currentBoost < 1.0 ? '#2563eb' : 'var(--crimson-500)'}}>{currentBoost.toFixed(1)}x</span>}
                                    {hasCustomSettings && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700">Custom</span>}
                                  </div>
                                  <div className="text-[10px] text-stone-400 font-mono mt-0.5">ID {v.id} • {v.gender === 1 ? 'Male' : 'Female'}{v.age ? ` • Age ${v.age}` : ''} • <span className="text-blue-400">!{voiceNameToAlias(v.voice_name)}:</span></div>
                                </div>
                                <div className="flex items-center gap-2.5">
                                  {v.is_published ? <Badge color="green">Public</Badge> : <Badge color="purple">Cloned</Badge>}
                                  <button onClick={e => { e.stopPropagation(); toggleFav(v.id); }} className={`p-1.5 rounded-lg hover:bg-stone-100 transition cursor-pointer ${isFav ? 'text-red-500' : 'text-stone-300 hover:text-red-400'}`}>
                                    {isFav ? <Heart size={15} className="fill-current" /> : <HeartOff size={15} />}
                                  </button>
                                </div>
                              </div>
                              {/* Per-voice settings row: Model + Enhance + Speed + Volume */}
                              <div className="px-5 pb-3 pt-0 space-y-2" onClick={e => e.stopPropagation()}>
                                {/* Row 1: Model selector + Enhance toggle */}
                                <div className="flex items-center gap-2">
                                  <select
                                    value={currentModel}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setCambVoiceSettings(prev => {
                                        const next = { ...prev };
                                        if (!val) {
                                          // If no custom settings remain, clean up the entry entirely
                                          const remaining = { ...next[v.id] };
                                          delete remaining.model;
                                          if (Object.keys(remaining).length === 0 || (Object.keys(remaining).length === 1 && remaining.enhance === true)) {
                                            delete next[v.id];
                                          } else {
                                            next[v.id] = remaining;
                                          }
                                        } else {
                                          next[v.id] = { ...next[v.id], model: val };
                                        }
                                        return next;
                                      });
                                    }}
                                    className="text-[10px] font-bold rounded-lg border px-2 py-1 cursor-pointer flex-1"
                                    style={{ background: 'var(--bg-inset)', borderColor: 'var(--border-default)', color: currentModel ? '#7c3aed' : 'var(--text-muted)' }}
                                    title="Select model for this voice"
                                  >
                                    <option value="">Default Model</option>
                                    <option value="mars-8.1-pro-beta">8.1 Pro (Best Quality)</option>
                                    <option value="mars-8.1-flash-beta">8.1 Flash (Fastest)</option>
                                    <option value="mars-flash">Mars Flash</option>
                                    <option value="mars-pro">Mars Pro</option>
                                  </select>
                                  <button
                                    onClick={() => {
                                      setCambVoiceSettings(prev => {
                                        const next = { ...prev };
                                        const newEnhance = !currentEnhance;
                                        // Clean up entry if everything is back to defaults
                                        const remaining = { ...next[v.id], enhance: newEnhance };
                                        if (!remaining.model && newEnhance && (remaining.speakingRate === undefined || remaining.speakingRate === 0.7)) {
                                          delete next[v.id];
                                        } else {
                                          next[v.id] = remaining;
                                        }
                                        return next;
                                      });
                                    }}
                                    className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer transition flex items-center gap-1 ${currentEnhance ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-50 text-stone-400 border-stone-200'}`}
                                    title={`Enhance: ${currentEnhance ? 'ON' : 'OFF'}`}
                                  >
                                    <Sparkles size={10} />
                                    {currentEnhance ? 'ON' : 'OFF'}
                                  </button>
                                </div>
                                {/* Row 2: Speaking Rate (Speed) slider */}
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400 w-7">Speed</span>
                                  <input
                                    type="range" min={0.3} max={2.0} step={0.05}
                                    value={currentRate}
                                    onChange={e => {
                                      const val = parseFloat(e.target.value);
                                      setCambVoiceSettings(prev => {
                                        const next = { ...prev };
                                        if (Math.abs(val - 0.7) < 0.03 && !vs.model && vs.enhance !== false) {
                                          delete next[v.id];
                                        } else {
                                          next[v.id] = { ...next[v.id], speakingRate: val };
                                        }
                                        return next;
                                      });
                                    }}
                                    className="flex-1 h-1 cursor-pointer accent-purple-500"
                                    title={`Speaking rate: ${currentRate.toFixed(2)}x`}
                                  />
                                  <span className="text-[10px] font-mono w-8 text-right font-bold" style={{color: Math.abs(currentRate - 0.7) > 0.03 ? '#7c3aed' : 'var(--text-muted)'}}>{currentRate.toFixed(1)}x</span>
                                </div>
                                {/* Row 3: Volume slider */}
                                <div className="flex items-center gap-1.5">
                                  <Volume2 size={10} className={hasCustomVol ? (currentBoost < 1.0 ? 'text-blue-500' : 'text-red-500') : 'text-stone-300'} />
                                  <div className="relative flex-1">
                                    <input
                                      type="range" min={0.2} max={5} step={0.1}
                                      value={currentBoost}
                                      onChange={e => {
                                        const val = parseFloat(e.target.value);
                                        setCambVoiceBoosts(prev => {
                                          const next = { ...prev };
                                          if (Math.abs(val - 1.0) < 0.05) { delete next[v.id]; } else { next[v.id] = val; }
                                          return next;
                                        });
                                      }}
                                      className="w-full h-1 cursor-pointer accent-red-600"
                                      title={`Volume: ${currentBoost.toFixed(1)}x`}
                                    />
                                    {/* 1x marker line — visual indicator where "normal" volume is */}
                                    <div className="absolute top-0 w-px h-2.5 bg-stone-400" style={{ left: `${((1.0 - 0.2) / (5.0 - 0.2)) * 100}%` }} title="1.0x normal" />
                                  </div>
                                  <span className="text-[10px] font-mono w-8 text-right font-bold" style={{color: hasCustomVol ? (currentBoost < 1.0 ? '#2563eb' : 'var(--crimson-500)') : 'var(--text-muted)'}}>{currentBoost.toFixed(1)}x</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t pt-5" style={{borderColor: 'var(--border-default)'}} data-help-id="help-gender-age-bias">
                      <div>
                        <label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-1">Gender Bias</label>
                        <select value={cambGender} onChange={e => setCambGender(Number(e.target.value))} className="w-full classic-select text-sm font-semibold">
                          <option value={1}>Male Bias</option><option value={0}>Female Bias</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-1">Age Bias</label>
                        <input type="number" min={1} max={100} value={cambAge} onChange={e => setCambAge(Number(e.target.value))}
                          className="w-full classic-input text-sm font-bold" />
                      </div>
                    </div>

                    <div className="border-t pt-5 space-y-4" style={{borderColor: 'var(--border-default)'}} data-help-id="help-cors-proxy">
                      <div className="flex items-center justify-between rounded-2xl p-4 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}}>
                        <div><span className="text-xs font-bold uppercase tracking-wider">CORS Bypass Proxy</span><p className="text-[10px] text-stone-400 mt-1">Enable to route requests through proxy server</p></div>
                        <Toggle enabled={useProxy} onClick={() => setUseProxy(!useProxy)} />
                      </div>
                      {useProxy && (
                        <SlideUp>
                          <label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Proxy Prefix URL</label>
                          <input value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} className="w-full classic-input font-mono text-xs" />
                        </SlideUp>
                      )}
                      {/* Feature 9: Auto-switch voice for languages */}
                      <div className="flex items-center justify-between rounded-2xl p-4 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}}>
                        <div><span className="text-xs font-bold uppercase tracking-wider">Auto-Switch Voice for Languages</span><p className="text-[10px] text-stone-400 mt-1">Automatically use a compatible voice when a non-English language is detected</p></div>
                        <Toggle enabled={autoLangSwitch} onClick={() => setAutoLangSwitch(!autoLangSwitch)} />
                      </div>
                    </div>
                  </div>
                )}

                {engine === 'webspeech' && (
                  <div className="space-y-6">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-xs text-amber-800 leading-relaxed font-semibold">💡 Browser voices run locally, no network needed.</div>
                    <div data-help-id="help-browser-voice">
                      <label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">System Voice Selector</label>
                      {sysVoices.length > 0 ? (
                        <select value={browserVoice} onChange={e => setBrowserVoice(e.target.value)} className="w-full classic-select text-sm font-semibold">
                          {sysVoices.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang}) — !{voiceNameToAlias(v.name)}:</option>)}
                        </select>
                      ) : (
                        <div className="bg-stone-50 border border-stone-250 rounded-lg px-4 py-3 text-sm text-stone-400 font-medium">Loading browser voices...</div>
                      )}
                    </div>
                  </div>
                )}
              </Card>

              {/* Voice Command Reference */}
              {allowChatterVoice && (
                <Card className="mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100"><MessageSquareText size={16} /></div>
                    <div>
                      <span className="font-bold text-sm uppercase tracking-wider" style={{color: 'var(--text-primary)'}}>Chat Voice Commands</span>
                      <p className="text-[9px] text-stone-400 font-semibold uppercase tracking-wider mt-0.5">Chatters can pick voices by typing the alias</p>
                    </div>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 mb-4">
                    <p className="text-xs text-blue-800 font-semibold mb-1">Command Format</p>
                    <code className="text-sm font-mono font-bold text-blue-900">{prefix || '!tts'} Voice_Name: your message here</code>
                    <p className="text-[10px] text-blue-600 mt-2">Spaces in voice names are replaced with underscores. Voice IDs also work.</p>
                  </div>
                  {favVoices.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2">Favorite Voices (quick reference for chat)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {favVoices.map(v => (
                          <code key={v.id} className="bg-stone-100 px-2 py-1 rounded text-[10px] font-mono text-stone-700 border border-stone-200">
                            {voiceNameToAlias(v.voice_name)}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="max-h-32 overflow-y-auto scrollbar-thin" data-lenis-prevent>
                    <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2">All Available Voices ({voices.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {voices.slice(0, 50).map(v => (
                        <code key={v.id} className="bg-stone-50 px-1.5 py-0.5 rounded text-[9px] font-mono text-stone-500 border border-stone-100">
                          {voiceNameToAlias(v.voice_name)}
                        </code>
                      ))}
                      {voices.length > 50 && <span className="text-[9px] text-stone-400 px-1.5 py-0.5">+{voices.length - 50} more...</span>}
                    </div>
                  </div>
                  {sysVoices.length > 0 && (
                    <div className="mt-3 max-h-24 overflow-y-auto scrollbar-thin border-t border-stone-100 pt-3" data-lenis-prevent>
                      <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2">Browser Voices ({sysVoices.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {sysVoices.slice(0, 20).map(v => (
                          <code key={v.name} className="bg-amber-50 px-1.5 py-0.5 rounded text-[9px] font-mono text-amber-600 border border-amber-100">
                            {voiceNameToAlias(v.name)}
                          </code>
                        ))}
                        {sysVoices.length > 20 && <span className="text-[9px] text-stone-400 px-1.5 py-0.5">+{sysVoices.length - 20} more...</span>}
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {/* ═══════════════════════════════════════════════════ */}
              {/* CHATTER VOICE SELECTION PANEL                    */}
              {/* Admin picks which voices chatters can see/use     */}
              {/* ═══════════════════════════════════════════════════ */}
              {allowChatterVoice && (
                <Card className="mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-700 border border-purple-100"><Users size={16} /></div>
                    <div>
                      <span className="font-bold text-sm uppercase tracking-wider" style={{color: 'var(--text-primary)'}}>Chatter Voice Selection</span>
                      <p className="text-[9px] text-stone-400 font-semibold uppercase tracking-wider mt-0.5">Pick which voices chatters can see and use</p>
                    </div>
                    <span className="ml-auto text-[10px] font-mono text-stone-400">{chatterVoices.length} selected</span>
                  </div>

                  {/* Currently selected voices — removable chips */}
                  {chatterVoices.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2">Visible to Chatters</p>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto" data-lenis-prevent>
                        {chatterVoices.map(v => (
                          <button
                            key={v.engine + '-' + v.id}
                            onClick={() => {
                              const updated = chatterVoices.filter(cv => !(cv.id === v.id && cv.engine === v.engine));
                              setChatterVoices(updated);
                              syncSettingsToServer({ chatterVoices: updated });
                            }}
                            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border font-bold transition-all cursor-pointer hover:bg-red-50 hover:border-red-200"
                            style={{ backgroundColor: v.engine === 'camb' ? 'rgba(37,99,235,0.08)' : 'rgba(217,119,6,0.08)', borderColor: v.engine === 'camb' ? 'rgba(37,99,235,0.25)' : 'rgba(217,119,6,0.25)', color: v.engine === 'camb' ? '#3b82f6' : '#f59e0b' }}
                          >
                            {v.voice_name}
                            <X size={10} />
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => {
                          // Add all currently loaded Camb.ai voices
                          const newVoices: ChatterVoice[] = voices.map(v => ({ id: v.id, voice_name: v.voice_name, gender: v.gender, engine: 'camb' as const }));
                          // Add all browser voices
                          const browserVoicesList: ChatterVoice[] = sysVoices.map(v => ({ id: Math.abs(v.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)), voice_name: v.name, gender: -1, engine: 'browser' as const }));
                          const combined = [...newVoices, ...browserVoicesList];
                          // Deduplicate
                          const seen = new Set(chatterVoices.map(cv => cv.engine + '-' + cv.id));
                          const toAdd = combined.filter(cv => !seen.has(cv.engine + '-' + cv.id));
                          const updated = [...chatterVoices, ...toAdd];
                          setChatterVoices(updated);
                          syncSettingsToServer({ chatterVoices: updated });
                        }} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-all cursor-pointer">
                          Add All Voices
                        </button>
                        <button onClick={() => { setChatterVoices([]); syncSettingsToServer({ chatterVoices: [] }); }} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-all cursor-pointer">
                          Clear All
                        </button>
                      </div>
                    </div>
                  )}

                  {chatterVoices.length === 0 && (
                    <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mb-4">
                      <p className="text-xs text-amber-800 font-semibold">No voices selected for chatters yet. When the list is empty, chatters see ALL voices. Add specific voices below to curate what chatters can see.</p>
                    </div>
                  )}

                  {/* Search and add voices from the full list */}
                  <div>
                    <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2">Add Voices for Chatters</p>
                    <div className="relative mb-3">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                      <input
                        value={chatterVoiceSearch}
                        onChange={e => setChatterVoiceSearch(e.target.value)}
                        placeholder="Search voices to add for chatters..."
                        className="w-full classic-input pl-9 text-xs font-semibold"
                      />
                    </div>
                    <div className="border rounded-xl max-h-48 overflow-y-auto divide-y scrollbar-thin" style={{borderColor: 'var(--border-default)', background: 'var(--bg-surface)'}} data-lenis-prevent>
                      {/* Camb.ai voices */}
                      {voices
                        .filter(v => v.voice_name.toLowerCase().includes(chatterVoiceSearch.toLowerCase()) || String(v.id).includes(chatterVoiceSearch))
                        .slice(0, 40)
                        .map(v => {
                          const isSelected = chatterVoices.some(cv => cv.engine === 'camb' && cv.id === v.id);
                          return (
                            <div key={'camb-' + v.id}
                              onClick={() => {
                                let updated: ChatterVoice[];
                                if (isSelected) {
                                  updated = chatterVoices.filter(cv => !(cv.engine === 'camb' && cv.id === v.id));
                                } else {
                                  updated = [...chatterVoices, { id: v.id, voice_name: v.voice_name, gender: v.gender, engine: 'camb' as const }];
                                }
                                setChatterVoices(updated);
                                syncSettingsToServer({ chatterVoices: updated });
                              }}
                              className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-all hover:bg-stone-50 text-xs ${isSelected ? 'bg-blue-50/50' : ''}`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-stone-300'}`}>
                                  {isSelected && <span className="text-white text-[8px]">✓</span>}
                                </span>
                                <span className={isSelected ? 'font-bold text-blue-800' : 'text-stone-700'}>{v.voice_name}</span>
                                <Badge color="blue">AI</Badge>
                                {v.gender === 1 && <Badge color="blue">Male</Badge>}
                                {v.gender === 0 && <Badge color="purple">Female</Badge>}
                              </div>
                              <code className="text-[9px] font-mono text-stone-400">{voiceNameToAlias(v.voice_name)}</code>
                            </div>
                          );
                        })}
                      {/* Browser voices */}
                      {sysVoices
                        .filter(v => v.name.toLowerCase().includes(chatterVoiceSearch.toLowerCase()))
                        .slice(0, 20)
                        .map(v => {
                          const voiceHash = Math.abs(v.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
                          const isSelected = chatterVoices.some(cv => cv.engine === 'browser' && cv.voice_name === v.name);
                          return (
                            <div key={'browser-' + v.name}
                              onClick={() => {
                                let updated: ChatterVoice[];
                                if (isSelected) {
                                  updated = chatterVoices.filter(cv => !(cv.engine === 'browser' && cv.voice_name === v.name));
                                } else {
                                  updated = [...chatterVoices, { id: voiceHash, voice_name: v.name, gender: -1, engine: 'browser' as const }];
                                }
                                setChatterVoices(updated);
                                syncSettingsToServer({ chatterVoices: updated });
                              }}
                              className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-all hover:bg-stone-50 text-xs ${isSelected ? 'bg-amber-50/50' : ''}`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-amber-500 border-amber-500' : 'border-stone-300'}`}>
                                  {isSelected && <span className="text-white text-[8px]">✓</span>}
                                </span>
                                <span className={isSelected ? 'font-bold text-amber-800' : 'text-stone-700'}>{v.name}</span>
                                <Badge color="amber">Browser</Badge>
                              </div>
                              <code className="text-[9px] font-mono text-stone-400">{voiceNameToAlias(v.name)}</code>
                            </div>
                          );
                        })}
                      {voices.length === 0 && sysVoices.length === 0 && (
                        <div className="p-6 text-center text-xs text-stone-400 italic">Load voices first using the "Reload Voices from Server" button above.</div>
                      )}
                    </div>
                  </div>
                </Card>
              )}

            </div>

            {/* Right: FX */}
            <div className="lg:col-span-5">
              <Card className="h-full">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center border border-red-100" style={{color: 'var(--crimson-500)'}}><Waves size={18} /></div>
                    <div>
                      <h2 className="text-lg font-bold font-serif-classic leading-none" style={{color: 'var(--text-primary)'}}>Audio Effects Rack</h2>
                      <p className="text-[9px] text-stone-400 mt-0.5">
                        {!fxEnabled ? 'Effects OFF — voice is clean' : presetName === 'custom' ? `Modified: ${lastSelectedPreset} (unsaved)` : `Preset: ${presetName}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* ON/OFF Toggle */}
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2 border border-stone-200" style={{background: 'var(--bg-inset)'}}>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">FX</span>
                      <Toggle enabled={fxEnabled} onClick={() => setFxEnabled(p => !p)} />
                    </div>
                    {/* Save to Current Preset Button — available for ALL presets including clean */}
                    {fxEnabled && (
                      <button
                        onClick={() => saveToPreset(lastSelectedPreset)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-all cursor-pointer"
                        title={`Save current settings to "${lastSelectedPreset}" preset`}
                      >
                        <Save size={12} /> Save to "{lastSelectedPreset}"
                      </button>
                    )}
                  </div>
                </div>

                {/* Presets Grid — 4 columns for the 11 distinct presets */}
                <div className="grid grid-cols-4 gap-2 mb-4" data-help-id="help-presets">
                  {Object.keys(PRESETS).map(name => {
                    const hasOverride = customPresets.some(p => p.name === name);
                    const isActive = lastSelectedPreset === name;
                    return (
                      <button key={name} onClick={() => applyPreset(name)}
                        className={`preset-btn relative px-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer border ${!fxEnabled ? 'opacity-40 pointer-events-none' : ''} ${isActive ? 'preset-active-glow' : ''}`}
                        style={isActive ? {background: 'var(--crimson-500)', color: '#fff', borderColor: 'var(--crimson-500)'} : {background: 'var(--bg-inset)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)'}}
                        disabled={!fxEnabled}
                      >
                        {name}
                        {hasOverride && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 border border-white" title="Custom override saved" />}
                      </button>
                    );
                  })}
                  {customPresets.filter(p => !PRESETS[p.name]).map(p => (
                    <div key={p.name} className="relative group">
                      <button onClick={() => { setPresetName(p.name); setLastSelectedPreset(p.name); setFx({ ...DEFAULT_FX, ...p.fx }); }}
                        className={`w-full px-1.5 py-2 rounded-lg text-[8px] font-black uppercase tracking-wider cursor-pointer border transition-all truncate ${
                          presetName === p.name ? 'bg-amber-500 text-white border-amber-500 shadow-md' : 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-300'
                        }`}>
                        ★ {p.name}
                      </button>
                      {/* Feature 9: Share button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setSharePreset({ name: p.name, fx: p.fx }); setShareModalOpen(true); }}
                        className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-4 border rounded-full text-stone-500 hover:text-purple-600 shadow-sm text-[8px] font-bold cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style={{background: 'var(--bg-surface)', borderColor: 'var(--border-default)'}}
                        title="Share preset"
                      ><Share2 size={7} /></button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setCustomPresets(prev => prev.filter(x => x.name !== p.name)); if (presetName === p.name) applyPreset('clean'); log(`Deleted preset "${p.name}"`); addToast(`Deleted preset "${p.name}"`, 'info'); }}
                        className="absolute -top-1 -right-1 w-4 h-4 border hover:border-red-300 rounded-full text-stone-500 hover:text-red-600 shadow-sm text-[8px] font-bold cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style={{background: 'var(--bg-surface)', borderColor: 'var(--border-default)'}}
                        title="Delete preset"
                      >×</button>
                    </div>
                  ))}
                </div>

                {/* Create New Preset */}
                <div className="flex gap-2 mb-5" data-help-id="help-custom-presets">
                  <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)} placeholder="New preset name..." className="flex-1 classic-input text-xs" onKeyDown={e => { if (e.key === 'Enter') addPreset(); }} />
                  <button onClick={addPreset} className="btn-classic-secondary text-xs px-4 py-2.5 flex items-center gap-1.5 shrink-0"><Plus size={13} /> Create</button>
                  {/* Feature 9: Import Preset */}
                  <button onClick={() => { setSharePreset(null); setShareModalOpen(true); }} className="btn-classic-secondary text-xs px-4 py-2.5 flex items-center gap-1.5 shrink-0"><Share2 size={13} /> Import</button>
                </div>

                {/* ═══ VOLUME — always accessible ═══ */}
                <div className="pt-4 border-t space-y-3" style={{borderColor: 'var(--border-default)'}}>

                  {/* Master Volume — prominent with +/- buttons */}
                  <div data-help-id="help-master-volume" className="rounded-xl p-4 border" style={{background: 'linear-gradient(to right, var(--dm-grad-red-from), var(--dm-grad-stone-to))', borderColor: 'var(--dm-grad-red-border)'}}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Volume2 size={14} style={{color: 'var(--crimson-500)'}} />
                        <span className="text-xs font-bold uppercase tracking-wider" style={{color: 'var(--crimson-500)'}}>Master Volume</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateFx('volume', Math.max(0, fx.volume - 0.1))}
                          className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-sm cursor-pointer transition-all" style={{background: 'var(--dm-btn-secondary-bg)', border: '1.5px solid var(--border-default)', color: 'var(--text-secondary)'}}
                          title="Volume -10%"
                        >−</button>
                        <span className="text-sm font-mono font-black w-12 text-center" style={{color: 'var(--crimson-500)'}}>{Math.round(fx.volume * 100)}%</span>
                        <button onClick={() => updateFx('volume', Math.min(2, fx.volume + 0.1))}
                          className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-sm cursor-pointer transition-all" style={{background: 'var(--dm-btn-secondary-bg)', border: '1.5px solid var(--border-default)', color: 'var(--text-secondary)'}}
                          title="Volume +10%"
                        >+</button>
                      </div>
                    </div>
                    <input type="range" min={0} max={2} step={0.05} value={fx.volume} onChange={e => updateFx('volume', parseFloat(e.target.value))} className="w-full accent-red-600" />
                    <div className="flex justify-between text-[8px] mt-1" style={{color: 'var(--text-muted)'}}><span>0%</span><span>100%</span><span>200%</span></div>
                  </div>

                </div>

                {/* ═══ EFFECT SLIDERS — disabled when FX is off ═══ */}
                <div className={`space-y-3 pt-4 border-t transition-opacity content-auto ${!fxEnabled ? 'opacity-30 pointer-events-none' : ''}`} style={{borderColor: 'var(--border-default)'}}>

                  {/* Pitch Shift */}
                  <div data-help-id="help-pitch-shift">
                    <Slider label="Pitch Shift" value={fx.pitch} min={0.25} max={2.5} step={0.05} unit="x" onChange={v => updateFx('pitch', v)} />
                  </div>

                  {/* Filters Row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div><Slider label="Low-Pass Filter" value={fx.lowPassFreq} min={0} max={16000} step={100} unit="Hz" onChange={v => updateFx('lowPassFreq', v)} /></div>
                    <div><Slider label="High-Pass Filter" value={fx.highPassFreq} min={0} max={500} step={10} unit="Hz" onChange={v => updateFx('highPassFreq', v)} /></div>
                  </div>

                  {/* Distortion + Bit Crush */}
                  <div className="grid grid-cols-2 gap-3">
                    <div data-help-id="help-distortion"><Slider label="Distortion Drive" value={fx.distortionAmount} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('distortionAmount', v)} /></div>
                    <div><Slider label="Bit Crusher" value={fx.bitCrush} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('bitCrush', v)} /></div>
                  </div>

                  {/* Megaphone Toggle */}
                  <div className="flex items-center justify-between rounded-xl p-4 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}} data-help-id="help-megaphone">
                    <div><span className="text-xs font-bold text-stone-700 uppercase tracking-wider">Megaphone Filter</span><p className="text-[10px] text-stone-500 mt-1">Telephone / PA system bandpass</p></div>
                    <Toggle enabled={fx.megaphone} onClick={() => updateFx('megaphone', !fx.megaphone)} />
                  </div>

                  {/* Robot Modulator */}
                  <div className="slider-section">
                    <div className="slider-section-title"><Zap size={12} className="text-amber-500" /> Robot Modulator</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div data-help-id="help-robot-carrier"><Slider label="Carrier Freq" value={fx.robotFrequency} min={0} max={200} step={5} unit="Hz" onChange={v => updateFx('robotFrequency', v)} /></div>
                      <div><Slider label="Mix Level" value={fx.robotMix} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('robotMix', v)} /></div>
                    </div>
                  </div>

                  {/* Wobble */}
                  <div className="grid grid-cols-2 gap-3">
                    <div data-help-id="help-wobble"><Slider label="Wobble Freq" value={fx.wobbleSpeed} min={0} max={20} step={0.5} unit="Hz" onChange={v => updateFx('wobbleSpeed', v)} /></div>
                    <div><Slider label="Wobble Depth" value={fx.wobbleDepth} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('wobbleDepth', v)} /></div>
                  </div>

                  {/* Echo / Delay */}
                  <div className="slider-section">
                    <div className="slider-section-title"><Clock size={12} className="text-blue-500" /> Echo / Delay</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div data-help-id="help-echo"><Slider label="Delay" value={fx.echoDelay} min={0} max={1} step={0.02} unit="s" onChange={v => updateFx('echoDelay', v)} /></div>
                      <div><Slider label="Feedback" value={fx.echoFeedback} min={0} max={0.85} step={0.05} unit="" onChange={v => updateFx('echoFeedback', v)} /></div>
                      <div><Slider label="Mix Level" value={fx.echoMix} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('echoMix', v)} /></div>
                    </div>
                  </div>

                  {/* Chorus — lush LFO-modulated detune, essential for underwater/alien */}
                  <div className="slider-section">
                    <div className="slider-section-title"><Waves size={12} className="text-purple-500" /> Chorus <span className="font-normal text-[9px] tracking-normal normal-case">— lush detune, underwater / alien</span></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Slider label="Chorus Rate" value={fx.chorusRate} min={0} max={5} step={0.05} unit="Hz" onChange={v => updateFx('chorusRate', v)} /></div>
                      <div><Slider label="Chorus Depth" value={fx.chorusDepth} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('chorusDepth', v)} /></div>
                    </div>
                  </div>

                  {/* Reverb — real convolution reverb, not just delay */}
                  <div className="slider-section">
                    <div className="slider-section-title"><Disc3 size={12} className="text-emerald-500" /> Reverb <span className="font-normal text-[9px] tracking-normal normal-case">— real room reverb, cave / demon</span></div>
                    <Slider label="Room Size / Wet Mix" value={fx.reverbAmount} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('reverbAmount', v)} />
                  </div>

                  {/* Tremolo — amplitude LFO, different from wobble (pitch LFO) */}
                  <div className="slider-section">
                    <div className="slider-section-title"><Radio size={12} className="text-red-400" /> Tremolo <span className="font-normal text-[9px] tracking-normal normal-case">— volume pulse, drunk / alien signal</span></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Slider label="Tremolo Speed" value={fx.tremoloSpeed} min={0} max={20} step={0.5} unit="Hz" onChange={v => updateFx('tremoloSpeed', v)} /></div>
                      <div><Slider label="Tremolo Depth" value={fx.tremoloDepth} min={0} max={1} step={0.05} unit="" onChange={v => updateFx('tremoloDepth', v)} /></div>
                    </div>
                  </div>

                </div>

                {/* Quick Volume Presets */}
                <div className="mt-4 pt-4 border-t" style={{borderColor: 'var(--border-default)'}}>
                  <div className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2">Quick Volume</div>
                  <div className="flex gap-2">
                    {[25, 50, 75, 100, 125, 150].map(pct => (
                      <button key={pct} onClick={() => updateFx('volume', pct / 100)}
                        className="vol-btn flex-1 py-2 rounded-lg text-[10px] font-black cursor-pointer border"
                        style={Math.round(fx.volume * 100) === pct
                          ? {background: '#a82424', color: '#fff', borderColor: '#a82424'}
                          : {background: '#faf9f6', color: '#78716c', borderColor: '#e7e5e4'}}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reset to Default */}
                <div className="mt-3 flex justify-end">
                  <button onClick={() => applyPreset('clean')}
                    className="flex items-center gap-1.5 text-[10px] text-stone-400 hover:text-stone-600 transition-colors cursor-pointer"
                  >
                    <RotateCcw size={11} /> Reset to Clean
                  </button>
                </div>

              </Card>
            </div>
          </div>
          </DeferredMount>
        </motion.div>
        )}

        {activeTab === 'rules' && visitedTabs.has('rules') && (
          <motion.div
            key="rules"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="full-width-layout mx-auto py-8"
            style={{ paddingLeft: 'var(--page-padding)', paddingRight: 'var(--page-padding)' }}
          >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 stagger-group">
            <div className="lg:col-span-8 space-y-6">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}><Card data-help-id="help-user-mappings">
                <div className="flex items-center gap-2 mb-3"><UserCheck size={18} style={{color: 'var(--crimson-500)'}} /><h3 className="font-bold font-serif-classic" style={{color: 'var(--text-primary)'}}>User-Specific Voice Mappings</h3></div>
                <p className="text-xs text-stone-500 mb-6 leading-relaxed">Bind specific custom voices and FX presets to target viewers (e.g. VIPs, mods, or friends).</p>
                
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 rounded-xl p-4 border mb-6" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}}>
                  <input placeholder="Username..." value={mapUser} onChange={e => setMapUser(e.target.value)} className="classic-input text-xs font-semibold" />
                  <select value={mapEngine} onChange={e => setMapEngine(e.target.value as Engine)} className="classic-select text-xs font-semibold">
                    <option value="camb">Camb.ai</option><option value="webspeech">Browser</option>
                  </select>
                  <input placeholder={mapEngine === 'camb' ? 'Voice ID' : 'Voice name'} value={mapVoice} onChange={e => setMapVoice(e.target.value)} className="classic-input text-xs font-semibold" />
                  <select value={mapPreset} onChange={e => setMapPreset(e.target.value)} className="classic-select text-xs font-semibold">
                    {Object.keys(PRESETS).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button onClick={() => {
                    if (!mapUser.trim() || !mapVoice.trim()) return;
                    setMappings(p => [...p.filter(x => x.username.toLowerCase() !== mapUser.toLowerCase()), { username: mapUser.trim(), engine: mapEngine, voice: mapVoice.trim(), preset: mapPreset }]);
                    setMapUser(''); setMapVoice(''); setMapEngine('camb'); setMapPreset('clean');
                    log(`Mapped voice for ${mapUser}`);
                  }}
                    className="btn-classic-primary text-xs flex items-center justify-center gap-1.5"><Plus size={13} /> Map User</button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin" data-lenis-prevent>
                  {mappings.map(m => (
                    <div key={m.username} className="border rounded-xl px-5 py-3 flex items-center justify-between text-xs transition-all duration-300" style={{background: 'var(--bg-surface)', borderColor: 'var(--border-default)'}}>
                      <div><span className="font-bold" style={{color: 'var(--crimson-500)'}}>{m.username}</span><span className="text-stone-400 mx-3">&rarr;</span><span className="font-semibold" style={{color: 'var(--text-secondary)'}}>{m.engine.toUpperCase()} / {m.voice}</span></div>
                      <button onClick={() => setMappings(p => p.filter(x => x.username !== m.username))} className="text-stone-400 hover:text-red-500 cursor-pointer p-1.5 hover:bg-stone-50 rounded-lg transition"><X size={15} /></button>
                    </div>
                  ))}
                  {mappings.length === 0 && <div className="text-xs text-stone-500 font-bold text-center py-6 italic">No active mappings configured.</div>}
                </div>
              </Card></motion.div>

              <Card data-help-id="help-slang-dict">
                <div className="flex items-center gap-2 mb-3"><Languages size={18} style={{color: 'var(--crimson-500)'}} /><h3 className="font-bold font-serif-classic" style={{color: 'var(--text-primary)'}}>Slang Dictionary</h3></div>
                <p className="text-xs text-stone-500 mb-6 leading-relaxed font-semibold">Auto-replace abbreviations or slang for clearer voice pronunciation.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl p-4 border mb-6" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}}>
                  <input placeholder="Replace word (e.g. lol)" value={aliasFrom} onChange={e => setAliasFrom(e.target.value)} className="classic-input text-xs font-semibold" />
                  <input placeholder="With word (e.g. laughing)" value={aliasTo} onChange={e => setAliasTo(e.target.value)} className="classic-input text-xs font-semibold" />
                  <button onClick={() => { if (!aliasFrom.trim() || !aliasTo.trim()) return; setAliases(p => [...p.filter(x => x.from.toLowerCase() !== aliasFrom.toLowerCase()), { from: aliasFrom.trim(), to: aliasTo.trim() }]); setAliasFrom(''); setAliasTo(''); }}
                    className="btn-classic-primary text-xs flex items-center justify-center gap-1.5"><Plus size={13} /> Add Word</button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin" data-lenis-prevent>
                  {aliases.map(a => (
                    <div key={a.from} className="border rounded-xl px-5 py-3 flex items-center justify-between text-xs transition-all duration-300" style={{background: 'var(--bg-surface)', borderColor: 'var(--border-default)'}}>
                      <div><code className="text-amber-700 bg-amber-50/50 px-2 py-0.5 rounded border border-amber-200/50 font-mono text-[10px]">{a.from}</code><span className="text-stone-400 mx-3">&rarr;</span><span className="text-stone-700 font-semibold">"{a.to}"</span></div>
                      <button onClick={() => setAliases(p => p.filter(x => x.from !== a.from))} className="text-stone-400 hover:text-red-500 cursor-pointer p-1.5 hover:bg-stone-50 rounded-lg transition"><X size={15} /></button>
                    </div>
                  ))}
                  {aliases.length === 0 && <div className="text-xs text-stone-500 font-bold text-center py-6 italic">No dictionary translations added.</div>}
                </div>
              </Card>
            </div>

            <div className="lg:col-span-4 space-y-6">
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.1 }}><Card>
                <div className="flex items-center gap-2 mb-6"><Shield size={16} style={{color: 'var(--crimson-500)'}} /><span className="font-bold text-sm uppercase tracking-wider" style={{color: 'var(--text-primary)'}}>Telegraph Controls</span></div>
                <div className="space-y-5">
                  <div data-help-id="help-who-can-trigger"><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Who can trigger TTS</label>
                    <select value={allowedRoles} onChange={e => setAllowedRoles(e.target.value as RoleFilter)} className="w-full classic-select text-sm font-semibold">
                      <option value="all">Everyone</option><option value="subs_vip_mods">Subs, VIPs, Mods</option><option value="mods_broadcaster">Mods & Broadcaster</option><option value="broadcaster">Broadcaster only</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between rounded-xl p-4 border" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}} data-help-id="help-require-prefix">
                    <div><span className="text-xs font-bold uppercase tracking-wider">Require prefix command</span><p className="text-[10px] text-stone-500 mt-1">e.g. !tts message</p></div>
                    <Toggle enabled={requirePrefix} onClick={() => setRequirePrefix(!requirePrefix)} />
                  </div>
                  {requirePrefix && <input value={prefix} onChange={e => { setPrefix(e.target.value); syncSettingsToServer({ prefix: e.target.value }); }} className="w-full classic-input font-mono text-sm font-bold" />}
                  <div className="flex items-center justify-between rounded-xl p-4 border" style={{background: 'linear-gradient(to right, var(--dm-grad-blue-from), var(--dm-grad-purple-to))', borderColor: 'var(--dm-grad-blue-border)'}}>
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-blue-900">Chatter Voice Selection</span>
                      <p className="text-[10px] text-stone-500 mt-1">Let chatters pick a voice: <code className="px-1.5 py-0.5 rounded text-[9px] font-mono" style={{background: 'var(--dm-btn-secondary-bg)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)'}}>{prefix || '!tts'} Voice_Name: message</code></p>
                      <p className="text-[9px] text-stone-400 mt-1">Voice names use underscores: "Brian", "Google_US_English", or voice ID "147320"</p>
                    </div>
                    <Toggle enabled={allowChatterVoice} onClick={() => { const newVal = !allowChatterVoice; setAllowChatterVoice(newVal); syncSettingsToServer({ allowChatterVoice: newVal }); }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t pt-5" style={{borderColor: 'var(--border-default)'}}>
                    <div data-help-id="help-cooldown"><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Cooldown</label>
                      <select value={userCooldown} onChange={e => setUserCooldown(Number(e.target.value))} className="w-full classic-select text-sm font-semibold">
                        <option value={0}>None</option><option value={5}>5s</option><option value={10}>10s</option><option value={30}>30s</option><option value={60}>60s</option>
                      </select>
                    </div>
                    <div data-help-id="help-max-queue"><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Max Queue</label>
                      <input type="number" min={5} max={100} value={queueSizeLimit} onChange={e => setQueueSizeLimit(Number(e.target.value))} className="w-full classic-input text-sm font-bold" />
                    </div>
                  </div>
                  <div className="border-t pt-5" style={{borderColor: 'var(--border-default)'}} data-help-id="help-max-chars">
                    <div className="flex justify-between text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2"><span>Max Message Characters</span><span className="font-mono font-bold" style={{color: 'var(--crimson-500)'}}>{maxChars}</span></div>
                    <input type="range" min={40} max={450} step={10} value={maxChars} onChange={e => setMaxChars(Number(e.target.value))} className="w-full" />
                  </div>
                  <div data-help-id="help-blacklist"><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Banned Words Blacklist (Legacy)</label>
                    <textarea value={blacklist} onChange={e => setBlacklist(e.target.value)} rows={2} placeholder="badword, spam..." className="w-full classic-input text-sm resize-none" />
                  </div>
                  <div data-help-id="help-whitelist"><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Explicit User Whitelist</label>
                    <input value={whitelist} onChange={e => setWhitelist(e.target.value)} placeholder="user1, user2" className="w-full classic-input text-sm" />
                  </div>
                </div>
              </Card></motion.div>

              {/* ═══════════════════════════════════════════════════ */}
              {/* ANTI-ABUSE SHIELD CARD                           */}
              {/* ═══════════════════════════════════════════════════ */}
              <Card>
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-700 border border-red-100"><Siren size={16} /></div>
                  <div>
                    <span className="font-bold text-sm uppercase tracking-wider" style={{color: 'var(--text-primary)'}}>Anti-Abuse Shield</span>
                    <p className="text-[9px] text-stone-400 font-semibold uppercase tracking-wider mt-0.5">Advanced Protection System</p>
                  </div>
                </div>
                <div className="space-y-5">

                  {/* Advanced Profanity Filter */}
                  <motion.div className="rounded-xl p-4 border" style={{background: 'linear-gradient(to right, var(--dm-grad-red-from), var(--dm-grad-amber-to))', borderColor: 'var(--dm-grad-red-border)'}} whileHover={{ scale: 1.005, borderColor: 'rgba(220,53,53,0.2)' }} transition={springMicro}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={14} className="text-red-600" />
                        <span className="text-xs font-bold uppercase tracking-wider text-red-800">Smart Profanity Filter</span>
                      </div>
                      <Toggle enabled={advancedFilterEnabled} onClick={() => setAdvancedFilterEnabled(!advancedFilterEnabled)} />
                    </div>
                    <p className="text-[10px] text-stone-500 mb-3 leading-relaxed">
                      Catches leetspeak bypasses (sh1t, f4g), unicode lookalikes, filler chars (f*ck, f-u-c-k), and repeated char spam. Much harder to bypass than simple word matching.
                    </p>
                    {advancedFilterEnabled && (
                      <SlideUp><div className="space-y-3">
                        <div>
                          <label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-1 font-semibold">Filter Mode</label>
                          <div className="flex gap-2">
                            <button onClick={() => setFilterMode('censor')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${filterMode === 'censor' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'text-stone-500 border'}`} style={filterMode !== 'censor' ? {background: 'var(--dm-btn-secondary-bg)', borderColor: 'var(--border-default)'} : {}}>
                              Censor (replace with ***)
                            </button>
                            <button onClick={() => setFilterMode('block')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${filterMode === 'block' ? 'bg-red-100 text-red-800 border border-red-300' : 'text-stone-500 border'}`} style={filterMode !== 'block' ? {background: 'var(--dm-btn-secondary-bg)', borderColor: 'var(--border-default)'} : {}}>
                              Block (reject entire msg)
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider font-semibold">Banned Words (Advanced)</label>
                            <span className="text-[9px] text-stone-400 font-mono">{bannedWordsString.split(',').filter(w => w.trim()).length} words</span>
                          </div>
                          <textarea 
                            value={bannedWordsString} 
                            onChange={e => setBannedWordsString(e.target.value)} 
                            rows={4} 
                            placeholder="word1, word2, n-word variants..."
                            className="w-full classic-input text-xs resize-none font-mono"
                          />
                          <p className="text-[9px] text-stone-400 mt-1">Comma-separated. Auto-detects leetspeak & unicode variants. Pre-loaded with common slurs.</p>
                        </div>
                      </div></SlideUp>
                    )}
                  </motion.div>

                  {/* User Blocklist */}
                  <div className="rounded-xl p-4 border" style={{background: 'linear-gradient(to right, var(--dm-grad-stone-from), var(--dm-grad-red-to))', borderColor: 'var(--border-default)'}}>
                    <div className="flex items-center gap-2 mb-2">
                      <UserX size={14} className="text-red-600" />
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-800">User Blocklist</span>
                    </div>
                    <p className="text-[10px] text-stone-500 mb-2">Always block these Twitch usernames, regardless of role. Comma-separated.</p>
                    <input 
                      value={blockedUsers} 
                      onChange={e => setBlockedUsers(e.target.value)} 
                      placeholder="troll1, troll2, spammer99" 
                      className="w-full classic-input text-xs font-mono" 
                    />
                  </div>

                  {/* Protection Summary */}
                  <div className="rounded-xl p-4 border border-stone-200" style={{background: 'var(--bg-inset)'}}>
                    <div className="flex items-center gap-2 mb-3">
                      <Shield size={14} className="text-stone-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-stone-600">Active Protection Layers</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Smart Filter', active: advancedFilterEnabled, activeClass: 'bg-red-50 text-red-700 border border-red-200' },
                        { label: 'User Blocklist', active: blockedUsers.trim().length > 0, activeClass: 'bg-amber-50 text-amber-700 border border-amber-200' },
                        { label: 'Spam Detection', active: true, activeClass: 'bg-purple-50 text-purple-700 border border-purple-200' },
                        { label: 'Voice Selection', active: allowChatterVoice, activeClass: 'bg-blue-50 text-blue-700 border border-blue-200' },
                        { label: 'Modulator Presets', active: true, activeClass: 'bg-orange-50 text-orange-700 border border-orange-200' },
                      ].map(item => (
                        <div key={item.label} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold ${item.active ? item.activeClass : 'bg-stone-100 text-stone-400 border border-stone-200'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <Card data-help-id="help-site-lock">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700 border border-emerald-100"><ShieldCheck size={16} /></div>
                  <div>
                    <span className="font-bold text-sm uppercase" style={{color: 'var(--text-primary)'}}>Authentication</span>
                    <p className="text-[9px] text-stone-400 font-semibold uppercase tracking-wider mt-0.5">Server-Side Security</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 flex items-center gap-3">
                    <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-emerald-800">Site is protected</span>
                      <p className="text-[10px] text-emerald-600 mt-0.5">Logged in as <strong>{adminUsername}</strong>. All API routes require authentication.</p>
                    </div>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <p className="text-xs text-blue-800 font-semibold mb-1">Chatter Access</p>
                    <p className="text-[10px] text-blue-600">Chatters can access the <a href="#/chatter" className="text-blue-700 hover:underline font-bold">Chatter View</a> without login — they can browse voices and learn how to use TTS, but have zero access to admin controls or API keys.</p>
                  </div>
                  <div className="rounded-xl p-3 border border-stone-200 text-[10px] text-stone-500 leading-relaxed" style={{background: 'var(--bg-inset)'}}>
                    <strong>Security model:</strong> Username and password are set via <code className="bg-stone-100 px-1 rounded">ADMIN_USERNAME</code> and <code className="bg-stone-100 px-1 rounded">ADMIN_PASSWORD</code> environment variables. API keys are stored as <code className="bg-stone-100 px-1 rounded">CAMB_API_KEY_1..20</code> env vars and never exposed to the browser. Sessions use httpOnly cookies with HMAC-signed tokens.
                  </div>
                </div>
              </Card>

              <Card data-help-id="help-backup">
                <div className="flex items-center gap-2 mb-4"><Upload size={16} className="text-stone-400" /><span className="font-bold text-sm uppercase" style={{color: 'var(--text-primary)'}}>Backup & Cloud Sync</span></div>
                <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200 mb-4 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-700">Cloud sync active — settings auto-saved to Turso (SQLite)</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={exportSettings} className="btn-classic-secondary text-xs py-3.5"><Download size={13} /> Export</button>
                  <label className="btn-classic-secondary text-xs py-3.5 text-center select-none">
                    <Upload size={13} /> Import
                    <input type="file" accept=".json" onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => importSettings(ev.target?.result as string); r.readAsText(f); }} className="hidden" />
                  </label>
                  <button onClick={async () => { try { const allSettings = { channel, engine, voiceId, cambGender, cambAge, browserVoice, fx, presetName, customPresets, favs, allowedRoles, requirePrefix, prefix, maxChars, blacklist, whitelist, userCooldown, queueSizeLimit, mappings, aliases, sfx, subColor, subSize, subBg, useProxy, proxyUrl, advancedFilterEnabled, bannedWordsString, filterMode, blockedUsers, soundVolumes, soundboardMasterVol, allowChatterVoice, chatterVoices, hiddenSounds, cambVoiceBoosts, cambVoiceSettings, ttsHistory: history.slice(-200).map(item => ({ ...item, timestamp: item.timestamp.toISOString() })) }; const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(allSettings) }); if (res.ok) log('Force-synced all settings + history to cloud.'); else log('Cloud sync failed.'); } catch { log('Cloud sync error.'); } }} className="btn-classic-primary text-xs py-3.5"><RefreshCw size={13} /> Sync Now</button>
                </div>
              </Card>
            </div>
          </div>
        </motion.div>
        )}

        {activeTab === 'soundboard' && visitedTabs.has('soundboard') && (
          <motion.div
            key="soundboard"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="full-width-layout mx-auto py-8"
            style={{ paddingLeft: 'var(--page-padding)', paddingRight: 'var(--page-padding)' }}
          >
          <DeferredMount>
          <div className="mb-6 stagger-children">
            <h2 className="text-2xl font-black tracking-tight" style={{color: 'var(--text-primary)'}}>Soundboard</h2>
            <p className="text-sm" style={{color: 'var(--text-tertiary)'}}>Preview sounds, upload custom SFX, and map them to chat triggers.</p>
            <div className="section-header-line mt-2" />
          </div>

          {/* Custom Sound Upload — Advanced */}
          <div 
            className="classic-card p-5 mb-6 border-2 border-dashed transition-all hover:border-blue-400"
            style={{borderColor: 'var(--dm-grad-blue-border)', background: 'var(--dm-grad-blue-from)'}}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#60a5fa'; e.currentTarget.style.background = 'rgba(59,130,246,0.12)'; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.background = ''; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = ''; e.currentTarget.style.background = ''; const f = e.dataTransfer.files[0]; if (f) uploadCustomSound(f); }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-sm">
                <Upload size={18} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold" style={{color: 'var(--text-primary)'}}>Upload Custom SFX</h3>
                <p className="text-[10px]" style={{color: 'var(--text-tertiary)'}}>Drag & drop or click to upload. MP3, WAV, OGG, WebM. Max 1MB. Stored in Turso cloud.</p>
              </div>
              {customSounds.length > 0 && (
                <span className="text-[10px] text-blue-600 font-bold bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200">{customSounds.length} uploaded</span>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <input
                value={sfxUploadName}
                onChange={e => setSfxUploadName(e.target.value)}
                placeholder="Sound name (optional, auto-filled from filename)"
                className="classic-input text-xs w-full sm:w-64"
              />
              <label className={`btn-classic-primary text-xs py-2.5 px-5 whitespace-nowrap cursor-pointer shadow-sm ${sfxUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={12} className={sfxUploading ? 'animate-pulse' : ''} />
                {sfxUploading ? 'Uploading...' : 'Choose File & Upload'}
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.webm"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadCustomSound(f); e.target.value = ''; }}
                  className="hidden"
                  disabled={sfxUploading}
                />
              </label>
            </div>
            <div className="mt-3 text-[9px] flex items-center gap-2" style={{color: 'var(--text-tertiary)'}}>
              <span>💡</span>
              <span>Use custom sounds inline: <code className="bg-blue-100 px-1 rounded font-mono">!tts Hello (flayschi_alarm) everyone</code> — the sound plays at that exact point in the message. Name uses underscores for spaces.</span>
            </div>
          </div>

          {/* Search, Master Volume, and Settings Bar */}
          <div className="classic-card p-4 mb-6 flex flex-col gap-4" data-help-id="help-sound-search">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="search-premium w-full">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color: 'var(--text-tertiary)'}} />
                <input
                  value={soundSearch}
                  onChange={e => setSoundSearch(e.target.value)}
                  placeholder="Search sounds... (e.g. bruh, oof, megalovania)"
                  className="classic-input pl-10 w-full text-sm"
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs font-semibold whitespace-nowrap" style={{color: 'var(--text-secondary)'}}>Base URL:</span>
                <input
                  value={soundBaseUrl}
                  onChange={e => setSoundBaseUrl(e.target.value)}
                  placeholder="https://cdn.tts.monster/sounds/"
                  className="classic-input text-xs font-mono w-full sm:w-64"
                />
              </div>
              <button
                onClick={resolveVisibleSounds}
                disabled={resolvingSounds || filteredSounds.length === 0}
                className="btn-classic-secondary text-xs py-2 px-3 whitespace-nowrap disabled:opacity-50"
                title="Resolve visible sounds to exact MP3 URLs and cache them"
              >
                <RefreshCw size={12} className={resolvingSounds ? 'animate-spin' : ''} />
                {resolvingSounds ? 'Resolving...' : 'Resolve visible'}
              </button>
              <div className="text-xs font-mono whitespace-nowrap" style={{color: 'var(--text-tertiary)'}}>
                {filteredSounds.length + customSounds.length} sounds
              </div>
            </div>

            {/* Master Volume Slider */}
            <div className="flex items-center gap-3 rounded-xl px-4 py-3 border" style={{background: 'linear-gradient(to right, var(--dm-grad-red-from), var(--dm-grad-amber-to))', borderColor: 'var(--dm-grad-red-border)'}}>
              <Volume2 size={18} className="text-red-500 shrink-0" />
              <span className="text-xs font-bold text-red-700 uppercase tracking-wider whitespace-nowrap">Master Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={soundboardMasterVol}
                onChange={e => setSoundboardMasterVol(parseFloat(e.target.value))}
                className="flex-1 h-2 accent-red-500 cursor-pointer"
              />
              <span className="text-sm font-mono font-bold text-red-700 w-12 text-right">{Math.round(soundboardMasterVol * 100)}%</span>
              <button
                onClick={() => setSoundboardMasterVol(1.0)}
                className="text-[9px] font-bold text-red-400 hover:text-red-600 px-2 py-1 rounded-md border whitespace-nowrap"
                style={{background: 'var(--dm-btn-secondary-bg)', borderColor: 'var(--border-default)'}}
                title="Reset to default (100%)"
              >Reset</button>
            </div>
          </div>

          {/* Custom Sounds Grid */}
          {customSounds.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Music size={14} className="text-blue-500" />
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Your Custom Sounds</span>
                <span className="text-[10px] text-blue-400 font-mono">({customSounds.length})</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {customSounds.map(cs => {
                  const csSlug = getSoundSlug(cs.name);
                  const isCsHidden = (hiddenSounds || []).includes(cs.name);
                  return (
                  <Ripple key={cs.id} color="rgba(59, 130, 246, 0.2)" className={`sound-pad group/custom flex flex-col gap-2 px-3 py-3 rounded-xl border cursor-pointer relative overflow-hidden ${isCsHidden ? 'border-orange-200' : activeSoundName === cs.name ? 'border-blue-300 ring-1 ring-blue-200' : 'hover:border-blue-300'}`} style={{background: isCsHidden ? 'var(--dm-grad-orange-from)' : activeSoundName === cs.name ? 'var(--dm-grad-blue-from)' : 'var(--dm-grad-blue-from)', borderColor: isCsHidden ? undefined : activeSoundName === cs.name ? undefined : 'var(--border-default)'}} onClick={() => playCustomSound(cs)}>
                    {isCsHidden && <div className="absolute top-1 right-1"><span className="text-[8px] font-bold uppercase tracking-wider text-orange-500 bg-orange-100 px-1.5 py-0.5 rounded-full border border-orange-200">Hidden</span></div>}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); playCustomSound(cs); }}
                        className={`play-btn w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200 ${activeSoundName === cs.name ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'}`}
                        title={activeSoundName === cs.name ? 'Pause sound' : 'Play custom sound'}
                      >
                        {activeSoundName === cs.name ? (
                          <span className="flex items-center gap-[2px]">
                            <span className="sound-eq-bar w-[3px] h-3 bg-white rounded-full" />
                            <span className="sound-eq-bar w-[3px] h-2 bg-white rounded-full" style={{animationDelay: '0.15s'}} />
                            <span className="sound-eq-bar w-[3px] h-3 bg-white rounded-full" style={{animationDelay: '0.3s'}} />
                          </span>
                        ) : (
                          <Play size={13} fill="currentColor" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold truncate leading-tight" style={{color: 'var(--text-primary)'}}>{cs.name}</div>
                        <div className="text-[10px] font-mono mt-0.5" style={{color: 'var(--text-tertiary)'}}>({csSlug})</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-1" onClick={e => e.stopPropagation()}>
                      <Volume2 size={12} className={(() => { const v = getSoundVolume(cs.name, soundVolumes, 1.0) * soundboardMasterVol; return v < 0.3 ? 'text-gray-300' : 'text-blue-500'; })()} />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={getSoundVolume(cs.name, soundVolumes, 1.0)}
                        onChange={e => {
                          const newVol = parseFloat(e.target.value);
                          setSoundVolumes(prev => ({ ...prev, [cs.name]: newVol }));
                        }}
                        className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
                        title={`Volume: ${Math.round(getSoundVolume(cs.name, soundVolumes, 1.0) * soundboardMasterVol * 100)}%`}
                      />
                      <span className="text-[10px] font-mono font-semibold text-blue-600 w-8 text-right">{Math.round(getSoundVolume(cs.name, soundVolumes, 1.0) * soundboardMasterVol * 100)}%</span>
                    </div>
                    <div className="flex items-center justify-between pl-1" onClick={e => e.stopPropagation()}>
                      <span className="text-[9px] text-blue-400 font-mono">{(cs.size / 1024).toFixed(0)}KB</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { if (isCsHidden) { setHiddenSounds(prev => prev.filter(n => n !== cs.name)); log(`Restored "${cs.name}" to chatter page`); } else { setHiddenSounds(prev => [...prev, cs.name]); log(`Hidden "${cs.name}" from chatter page`); } }}
                          className={`text-[10px] font-bold flex items-center gap-1 ${isCsHidden ? 'text-orange-500 hover:text-orange-700' : 'text-gray-400 hover:text-orange-500'}`}
                          title={isCsHidden ? 'Restore to chatter page' : 'Hide from chatter page'}
                        >
                          <EyeOff size={10} />
                        </button>
                        <button
                          onClick={() => deleteCustomSound(cs.id)}
                          className="text-[10px] font-bold text-red-400 hover:text-red-600 flex items-center gap-1"
                          title="Delete custom sound"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                  </Ripple>
                  );
                })}
              </div>
            </div>
          )}

          {/* Built-in Sound Grid */}
          {customSounds.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <Volume2 size={14} style={{color: 'var(--text-tertiary)'}} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{color: 'var(--text-secondary)'}}>Built-in Sounds</span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" data-help-id="help-sound-play">
            {filteredSounds.map((sound) => {
              const vol = getSoundVolume(sound.name, soundVolumes, 1.0);
              const effectiveVol = Math.min(1, vol * soundboardMasterVol);
              const isHidden = (hiddenSounds || []).includes(sound.name);
              return (
              <Ripple key={sound.name} color="rgba(220,53,53,0.15)" className={`sound-pad group/card flex flex-col gap-2 px-3 py-3 rounded-xl border cursor-pointer relative overflow-hidden ${isHidden ? 'border-orange-200' : activeSoundName === sound.name ? 'border-red-300 ring-1 ring-red-200' : 'hover:border-red-200'}`} style={{background: isHidden ? 'var(--dm-grad-orange-from)' : activeSoundName === sound.name ? 'var(--dm-grad-red-from)' : 'var(--bg-surface)', borderColor: isHidden ? undefined : activeSoundName === sound.name ? undefined : 'var(--border-subtle)'}} onClick={() => playSoundBite(sound)}
              >
                {isHidden && <div className="absolute top-1 right-1"><span className="text-[8px] font-bold uppercase tracking-wider text-orange-500 bg-orange-100 px-1.5 py-0.5 rounded-full border border-orange-200">Hidden</span></div>}
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); playSoundBite(sound); }}
                    className={`play-btn w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200 ${activeSoundName === sound.name ? 'bg-red-600 text-white' : 'bg-red-500 text-white'}`}
                    title={activeSoundName === sound.name ? 'Pause sound' : 'Play sound'}
                  >
                    {activeSoundName === sound.name ? (
                      <span className="flex items-center gap-[2px]">
                        <span className="sound-eq-bar w-[3px] h-3 bg-white rounded-full" />
                        <span className="sound-eq-bar w-[3px] h-2 bg-white rounded-full" style={{animationDelay: '0.15s'}} />
                        <span className="sound-eq-bar w-[3px] h-3 bg-white rounded-full" style={{animationDelay: '0.3s'}} />
                      </span>
                    ) : (
                      <Play size={13} fill="currentColor" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate leading-tight" style={{color: 'var(--text-primary)'}}>{sound.name}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{color: 'var(--text-tertiary)'}}>!{getSoundSlug(sound.name)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-1" onClick={e => e.stopPropagation()}>
                  <Volume2 size={12} className={effectiveVol < 0.3 ? 'text-gray-300' : 'text-amber-500 shrink-0'} />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vol}
                    onChange={e => {
                      const newVol = parseFloat(e.target.value);
                      setSoundVolumes(prev => ({ ...prev, [sound.name]: newVol }));
                    }}
                    className="flex-1 h-1.5 accent-amber-500 cursor-pointer"
                    title={`Volume: ${Math.round(effectiveVol * 100)}%`}
                  />
                  <span className="text-[10px] font-mono font-semibold text-amber-600 w-8 text-right">{Math.round(effectiveVol * 100)}%</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); addSoundToSfx(sound); }}
                    className="w-6 h-6 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity"
                    title="Map to chat trigger"
                  >
                    <Plus size={11} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (isHidden) { setHiddenSounds(prev => prev.filter(n => n !== sound.name)); log(`Restored "${sound.name}" to chatter page`); } else { setHiddenSounds(prev => [...prev, sound.name]); log(`Hidden "${sound.name}" from chatter page`); } }}
                    className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity ${isHidden ? 'text-orange-500 bg-orange-50' : 'text-gray-300 hover:text-orange-500 hover:bg-orange-50'}`}
                    title={isHidden ? 'Restore to chatter page' : 'Hide from chatter page'}
                  >
                    <EyeOff size={11} />
                  </button>
                </div>
              </Ripple>
              );
            })}
          </div>

          {/* Hidden Sounds — Sounds removed from chatter page, with restore option */}
          {(hiddenSounds || []).length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-3">
                <EyeOff size={14} className="text-orange-500" />
                <span className="text-xs font-bold text-orange-700 uppercase tracking-wider">Hidden from Chatters</span>
                <span className="text-[10px] text-orange-400 font-mono">({(hiddenSounds || []).length})</span>
                <button
                  onClick={() => { setHiddenSounds([]); log('Restored all hidden sounds to chatter page'); }}
                  className="ml-auto text-[9px] font-bold text-orange-500 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-2.5 py-1 rounded-md border border-orange-200 transition-all"
                >
                  Restore All
                </button>
              </div>
              <p className="text-[10px] text-orange-400 mb-3">These sounds are hidden from the chatter page. You can still play them here. Click restore to make them visible to chatters again.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {(hiddenSounds || []).map(name => {
                  // Check both built-in and custom sounds
                  const sound = SOUND_LIBRARY.find(s => s.name === name);
                  const customSound = customSounds.find(cs => cs.name === name);
                  const isCustom = !!customSound;
                  if (!sound && !customSound) return null;
                  return (
                    <Ripple key={name} color="rgba(249, 115, 22, 0.2)" className="sound-pad group/hidden flex flex-col gap-2 px-3 py-3 rounded-xl border cursor-pointer hover:border-orange-300 relative overflow-hidden" style={{background: 'var(--dm-grad-orange-from)', borderColor: 'var(--dm-grad-orange-border)'}} onClick={() => { if (customSound) playCustomSound(customSound); else if (sound) playSoundBite(sound); }}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); if (customSound) playCustomSound(customSound); else if (sound) playSoundBite(sound); }}
                          className={`w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-200 ${activeSoundName === name ? (isCustom ? 'bg-blue-600' : 'bg-orange-600') : (isCustom ? 'bg-blue-500 hover:bg-blue-600' : 'bg-orange-500 hover:bg-orange-600')}`}
                          title={activeSoundName === name ? 'Pause sound' : 'Play sound'}
                        >
                          {activeSoundName === name ? (
                            <span className="flex items-center gap-[2px]">
                              <span className="sound-eq-bar w-[3px] h-3 bg-white rounded-full" />
                              <span className="sound-eq-bar w-[3px] h-2 bg-white rounded-full" style={{animationDelay: '0.15s'}} />
                              <span className="sound-eq-bar w-[3px] h-3 bg-white rounded-full" style={{animationDelay: '0.3s'}} />
                            </span>
                          ) : (
                            <Play size={13} fill="currentColor" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold truncate leading-tight" style={{color: 'var(--text-primary)'}}>{name}</div>
                          <div className="text-[10px] text-orange-400 font-mono mt-0.5">({getSoundSlug(name)})</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pl-1" onClick={e => e.stopPropagation()}>
                        <span className="text-[9px] text-orange-400 font-mono">{isCustom ? 'Custom' : sound?.category || ''}</span>
                        <button
                          onClick={() => { setHiddenSounds(prev => prev.filter(n => n !== name)); log(`Restored "${name}" to chatter page`); }}
                          className="text-[10px] font-bold text-emerald-500 hover:text-emerald-700 flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-md border border-emerald-200 transition-all"
                          title="Restore to chatter page"
                        >
                          <RotateCcw size={10} /> Restore
                        </button>
                      </div>
                    </Ripple>
                  );
                })}
              </div>
            </div>
          )}

          {filteredSounds.length === 0 && customSounds.length === 0 && (
            <div className="text-center py-20" style={{color: 'var(--text-tertiary)'}}>
              <Volume size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-sm font-semibold">No sounds found</p>
              <p className="text-xs mt-1">Try a different search term or upload a custom sound</p>
            </div>
          )}
          </DeferredMount>
        </motion.div>
        )}

        {activeTab === 'overlay' && visitedTabs.has('overlay') && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="full-width-layout mx-auto py-8"
            style={{ paddingLeft: 'var(--page-padding)', paddingRight: 'var(--page-padding)' }}
          >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 stagger-group">
            <div className="lg:col-span-7">
              <Card>
                <div className="flex items-center gap-2.5 mb-5"><Volume2 size={20} style={{color: 'var(--crimson-500)'}} /><h2 className="text-lg font-bold font-serif-classic leading-none" style={{color: 'var(--text-primary)'}}>Soundboard & SFX Alerts</h2></div>
                <p className="text-xs text-stone-500 mb-6 leading-relaxed font-semibold">Streamers: trigger short sound clips when viewers type target alert keywords in chat.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl p-4 border mb-6" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}} data-help-id="help-sfx-alerts">
                  <input placeholder="Trigger word (e.g. !coin)" data-help-id="help-sfx-triggers" value={sfxWord} onChange={e => setSfxWord(e.target.value)} className="classic-input text-xs font-semibold" />
                  <input placeholder="Sound clip URL (mp3/wav)" value={sfxUrl} onChange={e => setSfxUrl(e.target.value)} className="classic-input text-xs font-semibold" />
                  <button onClick={() => { if (!sfxWord.trim() || !sfxUrl.trim()) return; setSfx(p => [...p.filter(x => x.word.toLowerCase() !== sfxWord.toLowerCase()), { word: sfxWord.trim(), url: sfxUrl.trim(), volume: 0.5 }]); setSfxWord(''); setSfxUrl(''); }}
                    className="btn-classic-primary text-xs flex items-center justify-center gap-1.5"><Plus size={13} /> Add SFX</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[350px] overflow-y-auto pr-1 scrollbar-thin" data-lenis-prevent>
                  {sfx.map(a => (
                    <div key={a.word} className="border rounded-xl p-4 text-xs group transition-all duration-300" style={{background: 'var(--bg-surface)', borderColor: 'var(--border-default)'}}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="min-w-0 pr-4">
                          <div className="font-bold text-amber-700">{a.word}</div>
                          <div className="text-[10px] text-stone-400 truncate font-mono mt-1">{a.url}</div>
                        </div>
                        <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => triggerSfx(a.url, a.volume)} className="btn-classic-secondary py-2 px-3 text-[10px]">Test</button>
                          <button onClick={() => setSfx(p => p.filter(x => x.word !== a.word))} className="text-stone-400 hover:text-red-500 p-2 cursor-pointer hover:bg-stone-50 rounded-lg transition"><X size={15} /></button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Volume2 size={11} className="text-stone-400 shrink-0" />
                        <input type="range" min={0} max={1} step={0.05} value={a.volume} onChange={e => setSfx(p => p.map(x => x.word === a.word ? { ...x, volume: parseFloat(e.target.value) } : x))} className="flex-1 h-1 accent-amber-500 cursor-pointer" />
                        <span className="text-[10px] font-mono text-stone-500 w-8 text-right">{Math.round(a.volume * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div className="lg:col-span-5">
              <Card>
                <div className="flex items-center gap-2.5 mb-6"><Palette size={20} style={{color: 'var(--crimson-500)'}} /><h2 className="text-lg font-bold font-serif-classic leading-none" style={{color: 'var(--text-primary)'}}>OBS Overlay Customizer</h2></div>
                <div className="space-y-5" data-help-id="help-obs-customizer">
                  <div><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Font Size</label>
                    <input type="number" min={12} max={72} value={subSize} onChange={e => setSubSize(Number(e.target.value))} className="w-full classic-input font-bold" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Text Color</label><input type="color" value={subColor} onChange={e => setSubColor(e.target.value)} className="w-full h-12 p-1 rounded-xl cursor-pointer" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)', border: '1px solid'}} /></div>
                    <div><label className="text-[10px] text-stone-500 font-bold uppercase tracking-wider block mb-2 font-semibold">Background Color</label><input type="color" value={subBg} onChange={e => setSubBg(e.target.value)} className="w-full h-12 p-1 rounded-xl cursor-pointer" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)', border: '1px solid'}} /></div>
                  </div>
                  <button onClick={() => setOverlay(true)} className="w-full btn-classic-primary shadow-md" data-help-id="help-open-overlay">
                    <Tv size={16} /> Open Subtitle overlay Screen
                  </button>
                  <div className="border rounded-xl overflow-hidden mt-6" style={{background: 'var(--bg-inset)', borderColor: 'var(--border-default)'}} data-help-id="help-design-preview">
                    <div className="bg-stone-100 px-4 py-2 text-[10px] text-stone-500 uppercase tracking-widest font-black flex items-center gap-1.5"><Eye size={12} /> Design Preview</div>
                    <div style={{ backgroundColor: subBg }} className="p-8 text-center">
                      <div className="text-red-500 text-[10px] tracking-widest font-black uppercase mb-2">TTS FROM OPERATOR</div>
                      <p style={{ fontSize: subSize, color: subColor }} className="font-bold font-serif-classic">"Previewing Subtitle Design"</p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </motion.div>
        )}
      </AnimatePresence>
      </div>
      {overlay && (
        <motion.div
          style={{ backgroundColor: '#22c55e' }}
          className="fixed inset-0 flex items-center justify-center z-[999] font-sf"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="absolute right-8 top-8 border rounded-2xl p-5 w-80 opacity-0 hover:opacity-100 transition-all duration-300 shadow-2xl" style={{background: 'rgba(255,255,255,0.95)', borderColor: 'var(--border-default)'}}>
            <h4 className="font-bold text-sm flex items-center gap-2 mb-2"><Tv size={15} /> Overlay Controls</h4>
            <p className="text-xs text-stone-500 mb-4 leading-relaxed">Click screen to allow autoplay. Chroma-key out the green background.</p>
            <div className="flex gap-3">
              <button onClick={() => setOverlay(false)} className="flex-1 py-2.5 bg-stone-100 rounded-xl text-xs font-bold border hover:bg-stone-200 cursor-pointer flex items-center justify-center gap-1.5" style={{borderColor: 'var(--border-default)'}}><Minimize2 size={13} /> Exit</button>
              <button onClick={(e) => skip(e)} className="px-5 py-2.5 bg-red-50 text-red-700 rounded-xl text-xs font-bold cursor-pointer border border-red-200 hover:bg-red-100">Skip</button>
            </div>
          </div>
          {subText ? (
            <ScaleIn style={{ backgroundColor: subBg }} className="w-full max-w-4xl rounded-3xl border p-12 text-center shadow-2xl">
              <div className="text-red-500 text-xs font-black uppercase tracking-[6px] mb-4">TTS FROM {subUser}</div>
              <p style={{ fontSize: subSize, color: subColor }} className="font-bold leading-normal break-words font-serif-classic">"{subText}"</p>
            </ScaleIn>
          ) : (
            <motion.button
              onClick={() => { try { const ctx = (window as any).__chatgbtAudioCtx || ((window as any).__chatgbtAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()); ctx.resume(); } catch {} }}
              className="text-stone-900/25 hover:text-stone-900/50 font-black text-xs uppercase tracking-[5px] px-8 py-4 rounded-2xl cursor-pointer border border-dashed border-stone-900/20 bg-white/30"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={springBouncy}
            >
              Click screen to allow overlay audio
            </motion.button>
          )}
        </motion.div>
      )}

      {/* CHATTER HISTORY LOOKUP MODAL */}
      {chatterLookupUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setChatterLookupUser(null)}>
          <div className="classic-card p-6 w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users size={16} style={{color: 'var(--crimson-400)'}} />
                <h2 className="font-bold text-lg" style={{color: 'var(--text-primary)'}}>{chatterLookupUser}</h2>
                <span className="text-xs font-mono px-2 py-0.5 rounded-full" style={{background: 'var(--bg-inset)', color: 'var(--text-tertiary)'}}>
                  {history.filter(h => h.user.toLowerCase() === chatterLookupUser.toLowerCase()).length} messages
                </span>
              </div>
              <button onClick={() => { setChatterLookupUser(null); setMessageSearchQuery(''); }} className="p-1" style={{color: 'var(--text-tertiary)'}}>
                <X size={18} />
              </button>
            </div>
            
            {/* Message search bar */}
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color: 'var(--text-muted)'}} />
              <input
                type="text"
                value={messageSearchQuery}
                onChange={e => setMessageSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="classic-input w-full pl-9 text-sm"
              />
            </div>
            
            {/* Messages list */}
            <div className="flex-1 overflow-y-auto space-y-2" data-lenis-prevent>
              {history
                .filter(h => h.user.toLowerCase() === chatterLookupUser.toLowerCase())
                .filter(h => !messageSearchQuery || h.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ').toLowerCase().includes(messageSearchQuery.toLowerCase()))
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                .map(item => (
                  <div key={item.id} className="rounded-lg p-3" style={{background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)'}}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono" style={{color: 'var(--text-tertiary)'}}>{item.timestamp.toLocaleString()}</span>
                      <Badge color={item.engine === 'camb' ? 'blue' : 'amber'}>{item.engine}</Badge>
                      {item.voiceDisplayName && <span className="text-[10px] font-mono" style={{color: 'var(--crimson-400)'}}>{item.voiceDisplayName}</span>}
                    </div>
                    <p className="text-sm" style={{color: 'var(--text-primary)'}}>"{item.chunks.filter(c => c.type === 'text').map(c => c.content).join(' ')}"</p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* HELP SYSTEM OVERLAY */}
      <HelpSystem
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        onTabChange={(tab) => setActiveTab(tab)}
      />

      {/* Feature 2: Particle Burst on Skip */}
      <ParticleBurst x={particleBurst.x} y={particleBurst.y} active={particleBurst.active} />

      {/* Feature 1: Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Feature 9: Preset Share Modal */}
      <PresetShareModal isOpen={shareModalOpen} onClose={() => setShareModalOpen(false)} preset={sharePreset} onImport={importPresetFromCode} />

    </div>
    </PageEntrance>
  );
}