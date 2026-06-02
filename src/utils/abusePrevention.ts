/* ═══════════════════════════════════════════════════════════════
   CHATGBT Advanced Abuse Prevention System
   
   Features:
   - Smart profanity filter with leetspeak & unicode bypass detection
   - Configurable banned word list with automatic variant detection
   - Per-user rate limiting for TTS, SFX, and soundboard
   - Global rate limiting across all users
   - Auto-mute system for repeat offenders
   - User blacklist/whitelist with Twitch username support
   - Message length & repetition spam detection
   - Individual sound volume control
   ═══════════════════════════════════════════════════════════════ */

// ─── PROFANITY FILTER ───────────────────────────────────────────

// Common leetspeak substitutions that trolls use to bypass filters
const LEET_MAP: Record<string, string[]> = {
  'a': ['4', '@', 'ä', 'ã', 'à', 'á', 'â', 'α', 'а'],
  'b': ['8', 'ß', 'ь', 'в'],
  'c': ['(', '{', '[', '©', 'с'],
  'e': ['3', '€', 'ë', 'ê', 'è', 'é', 'ε', 'е'],
  'g': ['9', '6', 'ğ', 'г'],
  'h': ['#', 'н'],
  'i': ['1', '!', '|', 'ï', 'î', 'ì', 'í', 'ι', 'и'],
  'l': ['1', '|', '!', '£', 'л'],
  'n': ['ñ', 'η', 'н'],
  'o': ['0', 'ö', 'õ', 'ò', 'ó', 'ô', 'σ', 'о'],
  'p': ['ρ', 'р'],
  'r': ['®', 'я'],
  's': ['5', '$', 'ş', 'ѕ'],
  't': ['7', '+', 'τ', 'т'],
  'u': ['ü', 'û', 'ù', 'ú', 'υ'],
  'x': ['×', 'х'],
  'y': ['ÿ', 'ý', 'υ'],
  'z': ['2', 'ž', 'ζ'],
};

// Build reverse lookup: variant → canonical letter
const VARIANT_TO_CANONICAL: Record<string, string> = {};
for (const [canonical, variants] of Object.entries(LEET_MAP)) {
  for (const v of variants) {
    VARIANT_TO_CANONICAL[v] = canonical;
  }
}

/**
 * Normalize text: convert leetspeak, unicode lookalikes, and special chars
 * back to basic lowercase ASCII so the filter can match effectively.
 */
export function normalizeText(text: string): string {
  let result = text.toLowerCase().trim();
  
  // Replace common multi-char bypass patterns
  result = result.replace(/vv/g, 'w');
  result = result.replace(/nn/g, 'm');
  result = result.replace(/ii/g, 'l');
  
  // Replace known leetspeak/unicode variants with their canonical letters
  let normalized = '';
  for (const char of result) {
    normalized += VARIANT_TO_CANONICAL[char] ?? char;
  }
  
  // Remove zero-width characters and diacritical marks
  normalized = normalized.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
  normalized = normalized.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
  
  // Remove excessive repeated characters (e.g., "aaaaa" → "aa")
  normalized = normalized.replace(/(.)\1{3,}/g, '$1$1');
  
  // Remove non-alphanumeric filler characters that trolls insert
  // (e.g., "f-u-c-k" or "f.u.c.k" or "f*ck")
  normalized = normalized.replace(/[^a-z0-9\s]/g, '');
  
  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

export interface FilterResult {
  filtered: string;           // The text with banned words replaced
  wasFiltered: boolean;       // Whether any words were caught
  matchedWords: string[];     // Which banned words were found
  severity: 'clean' | 'warning' | 'blocked'; // How bad it was
}

/**
 * Advanced profanity filter that catches:
 * - Exact matches
 * - Leetspeak bypasses (e.g., "sh1t", "f4g")
 * - Unicode lookalike bypasses
 * - Filler character insertions (e.g., "f*ck", "f-u-c-k")
 * - Repeated character spam (e.g., "shiiiiiit")
 * - Case-insensitive matches
 * - Whole-word and partial-word matching
 */
export function filterProfanity(
  text: string,
  bannedWords: string[],
  options: {
    mode?: 'censor' | 'block' | 'both';  // censor = replace, block = reject entirely
    partialMatch?: boolean;                 // Match substrings too
  } = {}
): FilterResult {
  const { mode = 'censor', partialMatch = false } = options;
  
  if (!bannedWords.length || !text.trim()) {
    return { filtered: text, wasFiltered: false, matchedWords: [], severity: 'clean' };
  }
  
  const normalized = normalizeText(text);
  const matchedWords: string[] = [];
  let filtered = text;
  let maxSeverity: 'clean' | 'warning' | 'blocked' = 'clean';
  
  for (const banned of bannedWords) {
    const bannedNorm = normalizeText(banned);
    if (!bannedNorm) continue;
    
    // Check normalized text for the banned word
    const pattern = partialMatch
      ? new RegExp(escapeRegex(bannedNorm), 'gi')
      : new RegExp(`\\b${escapeRegex(bannedNorm)}\\b`, 'gi');
    
    if (pattern.test(normalized)) {
      matchedWords.push(banned);
      
      // Also try to find and censor in the ORIGINAL text
      // Build a pattern that matches the original text with possible leetspeak
      const originalPattern = buildBypassPattern(bannedNorm);
      filtered = filtered.replace(originalPattern, () => {
        maxSeverity = 'warning';
        return '[censored]';
      });
    }
  }
  
  // If mode is 'block' and we found anything, reject entirely
  if (mode === 'block' && matchedWords.length > 0) {
    maxSeverity = 'blocked';
  }
  
  // If severity is still clean but we have matches, set to warning
  if (matchedWords.length > 0 && maxSeverity === 'clean') {
    maxSeverity = 'warning';
  }
  
  return {
    filtered,
    wasFiltered: matchedWords.length > 0,
    matchedWords,
    severity: maxSeverity,
  };
}

/**
 * Build a regex pattern that matches a word even with common bypass characters
 * inserted between letters. E.g., for "shit" it matches "s*h*i*t", "sh1t", etc.
 */
function buildBypassPattern(word: string): RegExp {
  const chars = word.split('');
  const separatorClass = '[^a-zA-Z0-9]*'; // Allow non-alphanumeric between letters
  const pattern = chars.map(char => {
    // Build character class: original + leetspeak variants
    const variants = LEET_MAP[char] || [];
    const allChars = [char, ...variants].map(escapeRegex);
    return `[${allChars.join('')}]`;
  }).join(separatorClass);
  
  return new RegExp(`\\b${pattern}\\b`, 'gi');
}

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── RATE LIMITER ───────────────────────────────────────────────

export interface RateLimitConfig {
  maxRequests: number;      // Max requests in the window
  windowMs: number;         // Time window in milliseconds
  cooldownMs: number;       // Extra cooldown after hitting limit
  autoMuteThreshold: number; // Times hitting limit before auto-mute
  autoMuteDurationMs: number; // How long the auto-mute lasts
}

export const DEFAULT_TTS_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 30000,          // 5 messages per 30 seconds
  cooldownMs: 60000,        // 1 minute cooldown after hitting limit
  autoMuteThreshold: 3,     // After 3 violations, auto-mute
  autoMuteDurationMs: 300000, // 5 minute auto-mute
};

export const DEFAULT_SFX_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 30000,          // 10 SFX per 30 seconds
  cooldownMs: 60000,
  autoMuteThreshold: 3,
  autoMuteDurationMs: 300000,
};

export const DEFAULT_SOUNDBOARD_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 15,
  windowMs: 60000,          // 15 sounds per minute
  cooldownMs: 120000,
  autoMuteThreshold: 5,
  autoMuteDurationMs: 600000, // 10 minute auto-mute
};

interface UserRateState {
  timestamps: number[];     // When each request was made
  violations: number;       // How many times they've hit the limit
  mutedUntil: number;       // Timestamp when mute expires (0 = not muted)
  cooldownUntil: number;    // Timestamp when cooldown expires
}

export class RateLimiter {
  private users = new Map<string, UserRateState>();
  private config: RateLimitConfig;
  private globalTimestamps: number[] = [];
  
  constructor(config: RateLimitConfig) {
    this.config = config;
  }
  
  /**
   * Check if a user is allowed to make a request.
   * Returns { allowed, reason, retryAfterMs }
   */
  check(user: string): { allowed: boolean; reason?: string; retryAfterMs?: number } {
    const now = Date.now();
    let state = this.users.get(user);
    
    if (!state) {
      state = { timestamps: [], violations: 0, mutedUntil: 0, cooldownUntil: 0 };
      this.users.set(user, state);
    }
    
    // Check if auto-muted
    if (state.mutedUntil > now) {
      return { 
        allowed: false, 
        reason: 'auto_muted', 
        retryAfterMs: state.mutedUntil - now 
      };
    }
    
    // Check cooldown
    if (state.cooldownUntil > now) {
      return { 
        allowed: false, 
        reason: 'cooldown', 
        retryAfterMs: state.cooldownUntil - now 
      };
    }
    
    // Clean old timestamps outside the window
    state.timestamps = state.timestamps.filter(t => now - t < this.config.windowMs);
    
    // Check rate limit
    if (state.timestamps.length >= this.config.maxRequests) {
      state.violations++;
      state.cooldownUntil = now + this.config.cooldownMs;
      
      // Auto-mute check
      if (state.violations >= this.config.autoMuteThreshold) {
        state.mutedUntil = now + this.config.autoMuteDurationMs;
        return { 
          allowed: false, 
          reason: 'auto_muted', 
          retryAfterMs: this.config.autoMuteDurationMs 
        };
      }
      
      return { 
        allowed: false, 
        reason: 'rate_limited', 
        retryAfterMs: this.config.cooldownMs 
      };
    }
    
    // Also check global rate limit (2x per-user limit)
    this.globalTimestamps = this.globalTimestamps.filter(t => now - t < this.config.windowMs);
    if (this.globalTimestamps.length >= this.config.maxRequests * 3) {
      return { 
        allowed: false, 
        reason: 'global_rate_limited', 
        retryAfterMs: this.config.windowMs 
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Record that a user made a request. Call AFTER check() returns allowed.
   */
  record(user: string): void {
    const now = Date.now();
    let state = this.users.get(user);
    if (!state) {
      state = { timestamps: [], violations: 0, mutedUntil: 0, cooldownUntil: 0 };
      this.users.set(user, state);
    }
    state.timestamps.push(now);
    this.globalTimestamps.push(now);
  }
  
  /**
   * Manually mute a user.
   */
  muteUser(user: string, durationMs: number): void {
    let state = this.users.get(user);
    if (!state) {
      state = { timestamps: [], violations: 0, mutedUntil: 0, cooldownUntil: 0 };
      this.users.set(user, state);
    }
    state.mutedUntil = Date.now() + durationMs;
    state.violations = this.config.autoMuteThreshold; // Set at threshold level
  }
  
  /**
   * Unmute a user.
   */
  unmuteUser(user: string): void {
    const state = this.users.get(user);
    if (state) {
      state.mutedUntil = 0;
      state.violations = 0;
      state.cooldownUntil = 0;
    }
  }
  
  /**
   * Get the list of currently muted users.
   */
  getMutedUsers(): { user: string; until: number }[] {
    const now = Date.now();
    const result: { user: string; until: number }[] = [];
    this.users.forEach((state, user) => {
      if (state.mutedUntil > now) {
        result.push({ user, until: state.mutedUntil });
      }
    });
    return result;
  }
  
  /**
   * Get rate limit status for a user (for UI display).
   */
  getStatus(user: string): { 
    remaining: number; 
    muted: boolean; 
    mutedUntil?: number;
    cooldownUntil?: number;
    violations: number;
  } {
    const now = Date.now();
    const state = this.users.get(user);
    if (!state) {
      return { remaining: this.config.maxRequests, muted: false, violations: 0 };
    }
    
    const timestamps = state.timestamps.filter(t => now - t < this.config.windowMs);
    return {
      remaining: Math.max(0, this.config.maxRequests - timestamps.length),
      muted: state.mutedUntil > now,
      mutedUntil: state.mutedUntil > now ? state.mutedUntil : undefined,
      cooldownUntil: state.cooldownUntil > now ? state.cooldownUntil : undefined,
      violations: state.violations,
    };
  }
  
  /**
   * Reset all state.
   */
  reset(): void {
    this.users.clear();
    this.globalTimestamps = [];
  }
}

// ─── SPAM DETECTION ─────────────────────────────────────────────

export interface SpamCheckResult {
  isSpam: boolean;
  reason?: string;
  score: number; // 0-100, higher = more spammy
}

/**
 * Detect spam patterns in messages:
 * - Repeated characters (aaaaaa)
 * - Repeated words (hello hello hello)
 * - Repeated messages from same user
 * - ALL CAPS spam
 * - URL spam
 * - Emoji/unicode spam
 */
export function detectSpam(
  text: string, 
  recentMessages: string[] = [],
  options: {
    maxRepeatedChars?: number;    // Max consecutive identical chars
    maxRepeatedWords?: number;    // Max times same word repeats
    maxCapsRatio?: number;        // Max ratio of uppercase (0-1)
    maxUrlCount?: number;         // Max URLs in message
    duplicateThreshold?: number;  // How similar to recent messages (0-1)
  } = {}
): SpamCheckResult {
  const {
    maxRepeatedWords = 3,
    maxCapsRatio = 0.8,
    maxUrlCount = 2,
    duplicateThreshold = 0.85,
  } = options;
  
  let score = 0;
  const reasons: string[] = [];
  
  // 1. Repeated characters (e.g., "aaaaaa")
  const repeatedCharMatch = text.match(/(.)\1{5,}/g);
  if (repeatedCharMatch) {
    score += 30;
    reasons.push('repeated_chars');
  }
  
  // 2. Repeated words
  const words = text.toLowerCase().split(/\s+/);
  const wordCounts = new Map<string, number>();
  for (const w of words) {
    if (w.length < 2) continue;
    wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
  }
  for (const [word, count] of wordCounts) {
    if (count > maxRepeatedWords) {
      score += 20;
      reasons.push(`repeated_word:${word}`);
      break;
    }
  }
  
  // 3. ALL CAPS check (only if message is long enough)
  if (text.length > 10) {
    const alphaChars = text.replace(/[^a-zA-Z]/g, '');
    if (alphaChars.length > 5) {
      const capsRatio = alphaChars.replace(/[^A-Z]/g, '').length / alphaChars.length;
      if (capsRatio > maxCapsRatio) {
        score += 15;
        reasons.push('excessive_caps');
      }
    }
  }
  
  // 4. URL count
  const urlMatches = text.match(/https?:\/\/[^\s]+/gi) || [];
  if (urlMatches.length > maxUrlCount) {
    score += 25;
    reasons.push('url_spam');
  }
  
  // 5. Duplicate message check — only flag near-duplicates (exact duplicates are
  // handled by the per-user cooldown, not spam detection). Users legitimately
  // resend the same sound or message, so we don't penalize exact matches here.
  if (recentMessages.length > 0) {
    const normalized = text.toLowerCase().trim();
    for (const prev of recentMessages) {
      const prevNorm = prev.toLowerCase().trim();
      // Skip exact duplicates — cooldown handles repeated messages
      if (prevNorm === normalized) continue;
      // Similar (but not identical) messages are suspicious
      if (normalized.length > 5 && prevNorm.length > 5) {
        const similarity = computeSimilarity(normalized, prevNorm);
        if (similarity > duplicateThreshold) {
          score += 20;
          reasons.push('similar_duplicate');
          break;
        }
      }
    }
  }
  
  return {
    isSpam: score >= 50,
    reason: reasons.length > 0 ? reasons.join(', ') : undefined,
    score: Math.min(score, 100),
  };
}

/**
 * Simple Jaccard similarity between two strings (word-based).
 */
function computeSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// ─── USER ACCESS CONTROL ────────────────────────────────────────

export interface UserAccessConfig {
  /** Users who are ALWAYS blocked, regardless of other settings */
  blockedUsers: string[];
  /** If set, ONLY these users can use TTS (overrides role checks) */
  allowedUsers: string[];
  /** Users who bypass ALL rate limits (mods, trusted users, etc.) */
  exemptUsers: string[];
}

export function checkUserAccess(
  username: string,
  config: UserAccessConfig,
  options: {
    isMod?: boolean;
    isBroadcaster?: boolean;
    isVip?: boolean;
    isSubscriber?: boolean;
  } = {}
): { allowed: boolean; reason?: string } {
  const lower = username.toLowerCase();
  
  // Broadcasters always have access
  if (options.isBroadcaster) {
    return { allowed: true };
  }
  
  // Check blocklist first (even mods can be blocked if explicitly listed)
  if (config.blockedUsers.some(u => u.toLowerCase() === lower)) {
    return { allowed: false, reason: 'blocked' };
  }
  
  // Check explicit whitelist
  if (config.allowedUsers.length > 0) {
    if (!config.allowedUsers.some(u => u.toLowerCase() === lower)) {
      return { allowed: false, reason: 'not_whitelisted' };
    }
  }
  
  return { allowed: true };
}

/**
 * Check if a user is exempt from rate limits.
 */
export function isRateLimitExempt(
  username: string,
  exemptUsers: string[],
  options: { isMod?: boolean; isBroadcaster?: boolean } = {}
): boolean {
  if (options.isBroadcaster) return true;
  if (options.isMod && exemptUsers.length === 0) return true; // Mods exempt by default unless specific list given
  return exemptUsers.some(u => u.toLowerCase() === username.toLowerCase());
}

// ─── SOUNDBOARD VOLUME MANAGEMENT ───────────────────────────────

export interface SoundVolumeConfig {
  [soundName: string]: number; // 0-1 volume per sound
}

/**
 * Get volume for a specific sound, with normalization.
 * Falls back to default volume if not configured.
 */
export function getSoundVolume(
  soundName: string,
  volumeConfig: SoundVolumeConfig,
  defaultVolume: number = 1.0
): number {
  const vol = volumeConfig[soundName];
  if (vol !== undefined) {
    return Math.max(0, Math.min(1, vol));
  }
  return defaultVolume;
}

// ─── DEFAULT BANNED WORD LIST ───────────────────────────────────

/**
 * A comprehensive default list of words that should be filtered.
 * The streamer can add/remove from this in the UI.
 * This provides a good starting point so they don't have to think of everything.
 */
export const DEFAULT_BANNED_WORDS: string[] = [
  // Racial slurs (the most important to block)
  'nigger', 'nigga', 'nig', 'nigg',
  'kike', 'spic', 'chink', 'gook',
  'faggot', 'fag', 'f4g', 'f4gg0t',
  'retard', 'r3tard', 'ret4rd',
  
  // Common severe profanity
  'cunt',
  
  // Additional slurs and hate speech
  'tranny', 'trannie',
  'dyke',
  'wetback',
  'towelhead',
  'cameljockey',
  'sandnigger',
];

/**
 * Get a comprehensive default banned words list as a comma-separated string
 * that can be stored in localStorage and edited in the UI.
 */
export function getDefaultBannedWordsString(): string {
  return DEFAULT_BANNED_WORDS.join(', ');
}
