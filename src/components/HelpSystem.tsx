import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, HelpCircle, Users, Radio, Sparkles, MapPin } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   CHATGBT Interactive Help System v3
   Two modes: Streamer & Chatter
   Bottom-docked card + highlight border (NO blur, NO dim overlay, NO off-screen)
   ═══════════════════════════════════════════════════════════════ */

export interface HelpItem {
  id: string;
  title: string;
  description: string;
  example?: string;
  tab?: 'dash' | 'voice' | 'rules' | 'overlay' | 'soundboard';
}

export type HelpMode = 'streamer' | 'chatter';

// ═══════════════════════════════════════════════════
// CHATTER HELP — What viewers need to know
// ═══════════════════════════════════════════════════
export const CHATTER_HELP: HelpItem[] = [
  {
    id: 'help-intro-chatter',
    title: 'Welcome, Chatter!',
    description: 'This tour will walk you through how to use TTS in a streamer\'s chat. You\'ll learn how to send messages, pick voices, add sound effects, and understand the difference between AI and browser voices. Let\'s go!',
    tab: 'dash',
  },
  {
    id: 'help-tts-command',
    title: 'How to Submit a TTS Message',
    description: 'Type !tts followed by your message in the Twitch chat to make the streamer\'s TTS read it aloud. For example: !tts Hello everyone! The streamer controls the prefix, so it might be different — but !tts is the default. If the streamer turned off the prefix requirement, any message in chat will be read aloud automatically.',
    example: '!tts Hello everyone, welcome to the stream!',
    tab: 'dash',
  },
  {
    id: 'help-inline-sfx',
    title: 'Inline Sound Effects',
    description: 'You can insert sound effects RIGHT IN your TTS message using parentheses. Put the sound name inside ( ) with underscores for spaces. The TTS will pause, play the sound effect, then continue reading. You can chain up to 20 sounds in one message. This is the most fun feature — imagine the possibilities!',
    example: '!tts Watch out (vine_boom) that was close (bruh)',
    tab: 'dash',
  },
  {
    id: 'help-sfx-triggers',
    title: 'Sound Alert Trigger Words',
    description: 'Some streamers set up special trigger words that play a sound effect instantly when typed in chat — no TTS reading needed. Common triggers include !coin, !horn, !applause. These play the sound immediately without any text-to-speech. Each streamer configures their own triggers.',
    example: '!coin — plays a coin sound instantly',
    tab: 'dash',
  },
  {
    id: 'help-camb-vs-browser',
    title: 'Camb.ai vs Browser TTS — What\'s the Difference?',
    description: 'The app has TWO voice engines. **Camb.ai** uses AI voice cloning — it sounds incredibly realistic, like an actual person speaking. It can clone specific voices and even do accents. However, it takes 5-15 seconds to generate and costs the streamer API credits. **Browser TTS** uses your computer\'s built-in speech synthesizer. It\'s instant and free, but sounds robotic and less natural. The streamer picks which engine your message uses.',
    example: 'Camb.ai = "Hey, this sounds like a real person!" | Browser = "Beep boop, I am a robot."',
    tab: 'voice',
  },
  {
    id: 'help-voice-selection',
    title: 'How Voice Selection Works for You',
    description: 'If the streamer has enabled **Chatter Voice Selection**, you can pick any available voice by adding `Voice_Name:` before your message. Use underscores for spaces in voice names (e.g., "Arthur_Morgan"). You can also use the numeric voice ID. If the feature is OFF, the streamer configures the voice — but they can still assign specific voices to usernames using User Mappings.',
    example: '!tts Arthur_Morgan: I have a plan → Uses the Arthur Morgan voice\n!tts 147320: Hello → Uses voice ID 147320\n!tts Brian: Greetings → Uses the Brian voice',
    tab: 'voice',
  },
  {
    id: 'help-fx-presets',
    title: 'Voice Effects & Presets',
    description: 'You can apply voice modulator presets to your message using the `#PresetName#` syntax at the start. Available presets: **Clean** (normal voice), **Helium** (high-pitched, squeaky), **Demon** (deep, distorted, echoing), **Robot** (metallic ring modulation), **Megaphone** (tinny radio/telephone filter), **Drunk** (wobbly pitch with echo), and **Rage** (extreme distortion). You can combine a preset with a voice selection for maximum effect! The streamer can also assign presets to specific usernames via User Mappings.',
    example: '!tts #Helium# Hello! → High-pitched chipmunk voice\n!tts #Demon# Fear me! → Deep demonic voice\n!tts #Helium# Arthur_Morgan: I have a plan → Helium effect + Arthur Morgan voice',
    tab: 'voice',
  },
  {
    id: 'help-queue-system',
    title: 'The TTS Queue',
    description: 'When multiple people send TTS messages at the same time, they go into a queue and play one at a time. The streamer can skip, reorder (move to top), or clear the queue. If the queue is full, new messages are rejected. There\'s also a per-user cooldown — you might have to wait between messages. Be patient and don\'t spam!',
    example: 'Queue: [1. UserA "Hello"] → [2. UserB "Nice stream"] → [3. UserC "GG"] — plays in order',
    tab: 'dash',
  },
  {
    id: 'help-soundboard',
    title: 'The Soundboard',
    description: 'The streamer has a soundboard with 150+ meme sounds (vine boom, bruh, oof, airhorn, etc.). These can be played by the streamer directly, or mapped to chat trigger words. When you see a sound effect play during a stream, it\'s coming from this soundboard! The streamer can also add any sound from the soundboard as a chat trigger.',
    example: 'Streamer maps !airhorn → Airhorn sound. When someone types !airhorn in chat, it plays instantly.',
    tab: 'soundboard',
  },
  {
    id: 'help-chatter-page',
    title: 'Chatter View Page',
    description: 'There\'s a special page just for chatters at `#/chatter` — share this link in your stream so viewers know how to use TTS! It shows the TTS command, voice selection syntax, available voices, sound effects, and SFX trigger words. It\'s read-only and always accessible without a password.',
    example: 'Share: https://your-site.com/#/chatter → Viewers see a clean guide with all TTS commands and sounds',
    tab: 'dash',
  },
  {
    id: 'help-tips',
    title: 'Pro Tips for Chatters',
    description: '1) Keep messages short for faster TTS (long messages take longer with Camb.ai). 2) Use inline SFX creatively — "(vine_boom)" after a dramatic pause is chef\'s kiss. 3) Don\'t spam — there\'s a cooldown and queue limit. 4) Check if the streamer has a whitelist — only certain users may be allowed. 5) If TTS isn\'t reading your messages, you might not have the right role (sub/VIP/mod). 6) The streamer can censor banned words — they\'ll be replaced with "[censored]". 7) If Chatter Voice Selection is enabled, try `!tts Voice_Name: message` to pick your own voice! 8) Use `#PresetName#` to apply voice effects like `#Helium#` or `#Demon#` — combine with a voice for maximum fun: `!tts #Helium# Arthur_Morgan: message`.',
    tab: 'dash',
  },
];

// ═══════════════════════════════════════════════════
// STREAMER HELP — Everything the streamer needs to know
// ═══════════════════════════════════════════════════
export const STREAMER_HELP: HelpItem[] = [
  // ── DASHBOARD TAB ──
  {
    id: 'help-intro-streamer',
    title: 'Welcome, Streamer!',
    description: 'This tour covers EVERY feature in the CHATGBT Control Room. We\'ll go tab by tab — Dashboard, Voice & FX, Rules, Soundboard, and Overlay. Each spotlight will explain exactly what a feature does and give practical examples. Let\'s start with the Dashboard!',
    tab: 'dash',
  },
  {
    id: 'help-stats',
    title: 'Session Statistics',
    description: 'These four stat cards show real-time metrics for your current session. **Dispatched** counts how many TTS messages have been spoken. **Chatters** shows unique users who\'ve used TTS. **Avg Chars** is the average character count per message. **Peak Queue** is the highest number of messages waiting at once. Use "Reset Stats" to zero everything out for a fresh count.',
    example: 'Dispatched: 47 | Chatters: 12 | Avg Chars: 85 | Peak Queue: 5',
    tab: 'dash',
  },
  {
    id: 'help-twitch-connect',
    title: 'Twitch Chat Connection',
    description: 'Enter your Twitch channel name (without the #) and click "Connect to Twitch". The app connects via anonymous WebSocket — no OAuth or bot account needed. Once connected, it listens to your chat for TTS commands and SFX triggers. The connection status shows in the header as a colored pill (green = connected, amber = connecting, gray = disconnected).',
    example: 'Channel: "shroud" → Connect → App starts listening to #shroud chat',
    tab: 'dash',
  },
  {
    id: 'help-test-voice',
    title: 'Test Voice',
    description: 'Type any text here and click "Speak" to preview how it sounds with your current voice and FX settings. This uses the SAME engine and effects as real TTS messages, so you hear exactly what chatters will hear. Click the dice button to load a random test phrase. Use this to fine-tune your voice settings before going live.',
    example: 'Type "Testing 1 2 3" → Click Speak → Hear it with current Camb.ai voice + FX preset',
    tab: 'dash',
  },
  {
    id: 'help-queue',
    title: 'Dispatch Queue',
    description: 'This is where incoming TTS messages wait to be spoken. Messages play one at a time from top to bottom. The "Now Speaking" card shows the currently playing message with a visualizer. You can: **Repeat** (re-queue the last spoken message), **Skip** (stop current and move to next — also Ctrl+Space), **Clear** (remove all pending), or click **TOP** on any message to move it to the front. Delete individual messages with the trash icon.',
    example: 'Queue has 5 messages. Click "TOP" on message #3 → it becomes #1 and plays next.',
    tab: 'dash',
  },
  {
    id: 'help-console',
    title: 'Console Log',
    description: 'The console shows a live log of everything happening — connections, queued messages, skipped items, errors, API responses. It\'s your debug tool. You can export the log as a text file (download icon) or clear it (trash icon). The log auto-scrolls and keeps the last 120 entries. Green text on dark background, terminal-style.',
    example: 'Log: "[12:34:56] Queued: xQc" → "[12:34:58] Speaking: xQc via camb" → "[12:35:12] Skipped."',
    tab: 'dash',
  },
  {
    id: 'help-inline-sfx-guide',
    title: 'Inline Sound Effects Guide',
    description: 'This card explains to your chatters how to insert sound effects in their TTS messages using parentheses. Share this info in your stream! Viewers type sound names in ( ) with underscores, and the TTS will play those sounds between text segments. Up to 20 sounds per message.',
    example: '!tts Hello (vine_boom) everyone (bruh) → Says "Hello" → Vine Boom → "everyone" → Bruh',
    tab: 'dash',
  },

  // ── VOICE & FX TAB ──
  {
    id: 'help-engine-select',
    title: 'Voice Engine Selection',
    description: 'Choose between two TTS engines. **Camb.ai voice cloning** uses AI to generate hyper-realistic speech that sounds like actual humans. It supports voice cloning, custom voices, and multiple accents, but requires API credits and takes 5-15 seconds to generate. **Browser system TTS** uses your computer\'s built-in speech synthesizer — it\'s instant and free, but sounds robotic. Pick Camb.ai for quality, Browser for speed.',
    example: 'Camb.ai: "Welcome to the stream, chat!" → 10s wait → sounds like a real person\nBrowser: "Welcome to the stream, chat!" → instant → sounds like a GPS narrator',
    tab: 'voice',
  },
  {
    id: 'help-api-key-mode',
    title: 'API Key Mode — Server vs Client',
    description: 'Camb.ai requires API keys. You have two options: **Server Keys (Vercel)** — store keys as Vercel environment variables (CAMB_API_KEY_1, CAMB_API_KEY_2, etc.). This is SECURE because keys never touch the browser. **Client Keys (Manual)** — paste keys directly in the app. They\'re stored in localStorage, which is less secure but works without Vercel. For production streams, always use Server Keys. The toggle switches between modes, and "Reload Voices from Server" fetches the voice list.',
    example: 'Server mode: Set CAMB_API_KEY_1 in Vercel → App fetches voices server-side → Key never exposed\nClient mode: Paste key in browser → Stored in localStorage → Key visible in DevTools',
    tab: 'voice',
  },
  {
    id: 'help-api-key-manager',
    title: 'API Key Manager (Client Mode)',
    description: 'When using Client Keys mode, you can add multiple Camb.ai API keys here. Having multiple keys provides failover — if one key runs out of credits, the app automatically tries the next one. Each key shows its first 8 and last 4 characters. Click X to remove a key. Keys are masked as password inputs for basic protection.',
    example: 'Add 3 keys → Key 1 runs out of credits → App auto-switches to Key 2 → Uninterrupted TTS',
    tab: 'voice',
  },
  {
    id: 'help-fav-voices',
    title: 'Pinned Favorite Voices',
    description: 'Click the heart icon next to any voice to pin it as a favorite. Favorites appear in this quick-access bar at the top, so you don\'t have to search for them. Click a favorite voice button to instantly select it. This is useful if you switch between a few voices frequently during streams.',
    example: 'Favorite "Narrator" and "Cute Child" → They appear as quick-select buttons → One click to switch',
    tab: 'voice',
  },
  {
    id: 'help-voices-directory',
    title: 'Voices Directory',
    description: 'This searchable list shows all available Camb.ai voices. Each entry shows the voice name, ID, gender, and age. **Public** badge = official Camb.ai voice. **Cloned** badge = a custom voice clone. Click any voice to select it. The search bar filters by name or ID. The red dot indicates your currently selected voice. Click "Refresh Directory" to reload the voice list from the API.',
    example: 'Search "narrator" → Shows "Roger (Deep Narrator)" → Click it → Now selected as active voice',
    tab: 'voice',
  },
  {
    id: 'help-gender-age-bias',
    title: 'Gender & Age Bias',
    description: 'These settings tell Camb.ai\'s AI how to adjust the voice tone. **Gender Bias**: Male (1) or Female (0) — this shifts the voice\'s pitch and resonance toward that gender. **Age Bias**: A number from 1-100 — lower ages sound younger, higher ages sound older. This is applied during TTS generation, so it affects ALL Camb.ai messages. Some voices in the directory auto-set these values when selected.',
    example: 'Male Bias + Age 25 → Young adult male voice\nFemale Bias + Age 60 → Older female voice\nMale Bias + Age 8 → Child-like voice',
    tab: 'voice',
  },
  {
    id: 'help-cors-proxy',
    title: 'CORS Bypass Proxy',
    description: 'Some browsers block direct API requests to Camb.ai due to CORS (Cross-Origin Resource Sharing) policies. Enable this toggle to route requests through a proxy server that adds the correct headers. The default proxy URL uses your Vercel deployment\'s /api/cors-proxy endpoint. Only enable this if you\'re getting CORS errors in the console.',
    example: 'Without proxy: "CORS error: blocked by policy" → Enable proxy → Requests go through Vercel → Works!',
    tab: 'voice',
  },
  {
    id: 'help-browser-voice',
    title: 'Browser Voice Selector',
    description: 'When using the Browser TTS engine, this dropdown lists all voices available on your operating system. The list varies by browser and OS — Chrome typically has more voices than Firefox. Each entry shows the voice name and language code. These voices are generated locally by your computer, so they\'re instant but robotic. Good for quick alerts or as a free fallback.',
    example: 'Select "Microsoft David - English (United States)" → Browser TTS uses this voice for all messages',
    tab: 'voice',
  },
  {
    id: 'help-presets',
    title: 'Modulator Presets',
    description: 'Presets are pre-configured combinations of audio effects that dramatically change how TTS sounds. Click any preset to apply it instantly: **Clean** = no effects, normal voice. **Helium** = high-pitched + slight distortion, sounds like inhaling helium. **Demon** = deep pitch + heavy distortion + echo, terrifying. **Robot** = metallic ring modulation, sounds like a robot. **Megaphone** = telephone/radio filter, tinny and loud. **Drunk** = wobbly pitch + echo, slurred speech. **Rage** = extreme distortion + echo, screaming sound.',
    example: 'Clean: "Hello chat" → Normal voice\nDemon: "Hello chat" → Deep, echoing, distorted voice\nHelium: "Hello chat" → Squeaky chipmunk voice',
    tab: 'voice',
  },
  {
    id: 'help-custom-presets',
    title: 'Custom Presets',
    description: 'After tweaking the individual FX sliders to your liking, type a name and click "Save Preset" to save your custom settings. Custom presets appear as amber-colored buttons alongside the built-in ones. Click them to apply, hover and click X to delete. This lets you create and name your own signature voice effects.',
    example: 'Tune pitch to 0.7, distortion to 0.3, echo to 0.2 → Save as "Monster" → Click "Monster" anytime',
    tab: 'voice',
  },
  {
    id: 'help-pitch-shift',
    title: 'Pitch Shift',
    description: 'This slider changes the pitch (frequency) of the voice. **1.0x** = normal pitch. Values below 1.0 make the voice deeper and slower. Values above 1.0 make it higher and faster. This works by adjusting the audio playback rate, so it also affects speed slightly. Pitch is the most impactful single slider for changing how a voice sounds.',
    example: 'Try "Hello there" at pitch 0.5 → deep demon voice, pitch 2.0 → chipmunk\n0.5x → Very deep, slow "I am a giant"\n1.0x → Normal "I am normal"\n1.6x → High, fast "I am a chipmunk"\n2.0x → Maximum pitch, very squeaky',
    tab: 'voice',
  },
  {
    id: 'help-robot-carrier',
    title: 'Robot Carrier (Ring Modulation)',
    description: 'This applies ring modulation — it multiplies the audio signal with a sine wave at the specified frequency, creating a metallic, robotic sound. **0 Hz** = no effect (normal voice). Low frequencies (20-40 Hz) create a trembling, pulsing effect. Medium (50-80 Hz) gives a classic robot voice. High (100-150 Hz) produces extreme metallic screeching. Combined with the low-pass filter at 1200 Hz, it sounds like the voice is coming from inside a metal box.',
    example: 'Try "I am a robot" with robot carrier ON → metallic robotic voice\n0 Hz → Normal voice\n40 Hz → Slight robotic wobble\n80 Hz → Classic robot "I AM A ROBOT"\n150 Hz → Extreme metallic screech',
    tab: 'voice',
  },
  {
    id: 'help-distortion',
    title: 'Distortion Drive',
    description: 'Adds warm saturation/distortion using a tanh soft clipper. **0** = clean, no distortion. Low values (0.05-0.15) add subtle warmth and grit. Medium (0.2-0.5) gives a crunchy, overdriven sound. High (0.6-1.0) produces extreme, screaming distortion. Unlike cheap digital clipping, this uses musical soft clipping that sounds warm and analog even at high settings. 4x oversampling prevents harsh digital aliasing.',
    example: 'Try "You shall not pass" with distortion ON → gritty radio voice\n0 → Clean, clear voice\n0.08 → Slightly warm, like a vinyl record\n0.3 → Crunchy, overdriven guitar effect\n0.92 → "RAGE MODE" — screaming distortion',
    tab: 'voice',
  },
  {
    id: 'help-megaphone',
    title: 'Megaphone Filter (Telephone Effect)',
    description: 'Toggle this ON to apply a bandpass filter that simulates a megaphone, telephone, or radio speaker. It cuts out frequencies below 300 Hz (removes bass) and above 3000 Hz (removes treble), leaving only the midrange — exactly like how a real telephone sounds. A makeup gain of 2.5x compensates for the volume lost from filtering. Perfect for "breaking news" or walkie-talkie moments.',
    example: 'OFF → "Hello, this sounds natural and clear"\nON → "HELLO, THIS SOUNDS LIKE A TELEPHONE CALL"',
    tab: 'voice',
  },
  {
    id: 'help-wobble',
    title: 'Wobble (Drunk/Vibrato Effect)',
    description: 'Two sliders control a pitch vibrato effect that makes the voice wobble like someone who\'s had too many drinks. **Wobble Freq** controls how fast the pitch oscillates (0-15 Hz). Low = slow sway, High = rapid shaking. **Wobble Depth** controls how much the pitch shifts (0-1.0). Low = subtle shimmer, High = wild pitch swings. The effect uses a sine wave to smoothly modulate the playback rate. Best used together for the "drunk" effect.',
    example: 'Try "What is happening" with wobble ON → wobbly cartoon voice\nFreq 2 Hz + Depth 0.2 → Gentle, subtle vibrato\nFreq 5.5 Hz + Depth 0.65 → Classic drunk slurring\nFreq 12 Hz + Depth 0.9 → INSANE crazy wobble',
    tab: 'voice',
  },
  {
    id: 'help-echo',
    title: 'Echo / Delay',
    description: 'Two sliders control a feedback delay effect. **Echo Delay** (0-1 second) sets the time between the original sound and the repeat. Short delays (0.05-0.15s) create a "slapback" effect. Longer delays (0.3-1.0s) create distinct echoes. **Echo Feedback** (0-0.9) controls how much of the echo is fed back into the delay line. Low values = echo fades quickly. High values = echo repeats many times before dying out. Together they create anything from a subtle room reverb to cavernous echoes.',
    example: 'Try "Hello... hello... hello" with echo ON → stadium announcer effect\nDelay 0.1s + Feedback 0.1 → Subtle slapback, like a small room\nDelay 0.38s + Feedback 0.48 → Spooky cave echo (Demon preset)\nDelay 0.5s + Feedback 0.85 → Infinite repeating echoes',
    tab: 'voice',
  },
  {
    id: 'help-master-volume',
    title: 'Master Volume',
    description: 'Controls the overall output volume of the TTS audio. **1.0** = normal volume. Below 1.0 = quieter. Above 1.0 = louder (up to 1.5x). A built-in dynamics compressor prevents distortion at high volumes by automatically limiting peaks. This compressor has a -10dB threshold, so loud passages are tamed while quiet parts are boosted. Set this based on your stream\'s audio mix — you want TTS audible but not overwhelming.',
    example: '0.3 → Very quiet, background whisper\n1.0 → Normal volume\n1.3 → Loud and prominent (for hype moments)\n1.5 → Maximum volume, compressor kicks in',
    tab: 'voice',
  },

  // ── RULES TAB ──
  {
    id: 'help-rules-intro',
    title: 'Rules Tab — Your Moderation Toolkit',
    description: 'The Rules tab is where you control WHO can use TTS, HOW they use it, and WHAT they can say. It\'s your moderation command center. Let\'s go through every single setting.',
    tab: 'rules',
  },
  {
    id: 'help-user-mappings',
    title: 'User-Specific Voice Mappings',
    description: 'Assign a specific voice engine, voice ID, and FX preset to individual usernames. When that user sends a TTS message, it uses THEIR mapped settings instead of the defaults. This is how you give VIPs, mods, or friends unique voices. If a user has no mapping, they get the default settings. Enter a username, pick engine (Camb.ai or Browser), enter a voice ID or name, select an FX preset, then click "Map User". Existing mappings are shown below — click X to remove.',
    example: 'Map "ninja" → Camb.ai / Voice 12345 / Demon preset → Every !tts from ninja sounds demonic\nMap "pokimane" → Browser / "Zira" / Helium → Pokimane gets squeaky browser voice',
    tab: 'rules',
  },
  {
    id: 'help-slang-dict',
    title: 'Slang Dictionary (Word Aliases)',
    description: 'Auto-replace abbreviations, slang, or any words with their full pronunciation before TTS reads them. This ensures the voice engine says things correctly instead of spelling out abbreviations. Enter the word to replace and what to replace it with. Replacements are case-insensitive and match whole words only. Great for stream-specific slang, emote names, or acronyms.',
    example: 'Replace "lol" → "laughing out loud" → "!tts that was lol" reads as "that was laughing out loud"\nReplace "pog" → "poggers" → "!tts pog stream" reads as "poggers stream"',
    tab: 'rules',
  },
  {
    id: 'help-who-can-trigger',
    title: 'Who Can Trigger TTS',
    description: 'Control which Twitch users are allowed to use TTS. Four options: **Everyone** — any viewer can trigger TTS. **Subs, VIPs, Mods** — only paying subscribers, VIPs, and moderators can use TTS (great for monetization). **Mods & Broadcaster** — only your mod team and you can use TTS (for controlled streams). **Broadcaster only** — only you can trigger TTS (for testing or solo use). This works independently from the whitelist — if a whitelist is set, it takes priority.',
    example: 'Set to "Subs, VIPs, Mods" → Regular viewers are ignored, subs can use !tts',
    tab: 'rules',
  },
  {
    id: 'help-require-prefix',
    title: 'Require Prefix Command',
    description: 'Toggle this ON to require a command prefix before TTS messages. When ON, viewers must type the prefix (default: !tts) followed by their message. When OFF, EVERY chat message will be read as TTS — use with caution on busy chats! The prefix is stripped from the message before it\'s read aloud. You can change the prefix to anything you want — some streamers use !say, !speak, etc.',
    example: 'ON with prefix "!tts" → Only "!tts Hello" triggers TTS → "Hello" is read\nOFF → "Hello" in chat triggers TTS → "Hello" is read\nCustom prefix "!say" → "!say Good game" → "Good game" is read',
    tab: 'rules',
  },
  {
    id: 'help-cooldown',
    title: 'Per-User Cooldown',
    description: 'Set a minimum time between TTS messages from the SAME user. **None** = no limit (users can spam). **5s/10s/30s/60s** = that user must wait before sending another TTS message. This does NOT apply to mods or the broadcaster — they can always send messages regardless of cooldown. Essential for preventing TTS spam on popular streams.',
    example: 'Set 30s → User sends !tts at 12:00:00 → Must wait until 12:00:30 → Second !tts at 12:00:25 is ignored',
    tab: 'rules',
  },
  {
    id: 'help-max-queue',
    title: 'Max Queue Size',
    description: 'Set the maximum number of TTS messages that can wait in the queue at once. When the queue is full, new messages are rejected and logged as "Queue full: [username]". Default is 20. Lower values prevent queue buildup on busy streams. Higher values ensure no one\'s message is lost. Consider your TTS speed — if Camb.ai takes 10s per message, a queue of 20 means the last person waits 200 seconds!',
    example: 'Set to 5 → Only 5 messages can wait → 6th person gets "Queue full" message\nSet to 50 → 50 messages can pile up → Last person waits a long time',
    tab: 'rules',
  },
  {
    id: 'help-max-chars',
    title: 'Max Message Characters',
    description: 'This slider (40-450) sets the maximum number of text characters that will be read from each TTS message. Messages longer than this are truncated with "..." at the end. Only text counts — sound effects in parentheses don\'t count toward the limit. Lower values keep TTS quick and punchy. Higher values allow longer monologues. This is applied AFTER slang replacement and blacklisting.',
    example: 'Set to 100 → "!tts This is a very very very very very very very very very very very long message" → Reads only first 100 chars + "..."',
    tab: 'rules',
  },
  {
    id: 'help-blacklist',
    title: 'Banned Words Blacklist',
    description: 'Enter comma-separated words that will be censored in TTS messages. When a blacklisted word appears, it\'s replaced with "[censored]" before being read aloud. Matching is case-insensitive and matches whole words only (using word boundaries). This is your basic profanity filter. Add slurs, offensive terms, or any words you don\'t want spoken on stream.',
    example: 'Blacklist: "badword, spam, idiot" → "!tts You are an idiot" → Reads as "You are an [censored]"',
    tab: 'rules',
  },
  {
    id: 'help-whitelist',
    title: 'Explicit User Whitelist',
    description: 'When set, ONLY these specific usernames can trigger TTS — everyone else is ignored, regardless of their role. Enter comma-separated usernames (case-insensitive). This OVERRIDES the "Who Can Trigger TTS" role setting. If a whitelist is set and a user isn\'t on it, even a mod or subscriber will be blocked. Leave EMPTY to use role-based access instead. Use this for private streams or when only specific people should have TTS access.',
    example: 'Whitelist: "shroud, just9n, chad" → Only those 3 users can use TTS → Everyone else is logged as "Ignored (not whitelisted)"',
    tab: 'rules',
  },
  {
    id: 'help-chatter-voice-toggle',
    title: 'Chatter Voice Selection',
    description: 'When enabled, chatters can pick their own voice by adding `Voice_Name:` before their message. For example, `!tts Arthur_Morgan: I have a plan` will use the Arthur Morgan voice. Voice names use underscores for spaces. Chatters can also use numeric voice IDs. **Modulator presets** are always available to chatters using the `#PresetName#` syntax — e.g., `!tts #Helium# message` or `!tts #Helium# Arthur_Morgan: message`. When disabled, voice prefixes are ignored and the default/streamer-mapped voice is used, but #PresetName# still works. This is OFF by default to prevent abuse — some chatters might pick annoying voices.',
    example: 'ON: Chatter types "!tts Brian: Hello everyone" → Uses Brian voice\nOFF: Same message → "Brian:" is read as part of the text, default voice used\nPresets always work: "!tts #Demon# Hello" → Deep demonic voice effect',
    tab: 'rules',
  },
  {
    id: 'help-site-lock',
    title: 'Site Lock (Password Protection)',
    description: 'Protect the Control Room with a password so only you can access it. Set a password in the Rules tab — once locked, you\'ll need to enter it every time you visit (unlocking is session-only, so refreshing requires re-login). The **Chatter View** page at `#/chatter` is always accessible without a password, so your viewers can still learn how to use TTS. Use this if you\'re hosting the app publicly and don\'t want others changing your settings.',
    example: 'Set password "mysecret" → Next visit shows lock screen → Enter "mysecret" → Unlocked for this session\nRefresh page → Lock screen appears again → Must re-enter password',
    tab: 'rules',
  },
  {
    id: 'help-backup',
    title: 'Backup Settings (Export/Import)',
    description: 'Export all your settings (API keys, channel, voice, FX, rules, mappings, aliases, SFX, overlay, etc.) as a JSON file. Import a previously exported file to restore everything at once. This is essential for backing up your configuration before making changes, or for transferring settings between devices. A confirmation dialog appears before importing to prevent accidental overwrites.',
    example: 'Click "Export Backup" → Downloads chatgbt-backup-2024-01-15.json → On new device, click "Import Backup" → All settings restored',
    tab: 'rules',
  },

  // ── SOUNDBOARD TAB ──
  {
    id: 'help-soundboard-intro',
    title: 'Soundboard — 150+ Meme Sounds',
    description: 'The Soundboard tab contains 150+ meme and sound effect clips from the TTS Monster library. You can preview sounds, search by name or category, and map any sound to a chat trigger word. Sounds are resolved from MyInstants CDN with fallback URLs for reliability.',
    tab: 'soundboard',
  },
  {
    id: 'help-sound-search',
    title: 'Sound Search & Base URL',
    description: 'The search bar filters sounds by name or category in real-time. Type "bruh" to find the bruh sound, "vine" for vine boom, etc. The **Base URL** field sets the CDN path for sound files — the default works out of the box. Only change this if you\'re hosting sounds on your own server. The **Resolve visible** button pre-fetches working MP3 URLs for the first 80 sounds and caches them, making playback instant. The count shows how many sounds match your search.',
    example: 'Search "oof" → Shows "Oof" sound → Click play button → Hears the Roblox oof sound',
    tab: 'soundboard',
  },
  {
    id: 'help-sound-play',
    title: 'Play & Map Sounds',
    description: 'Each sound row has a red play button to preview the sound, the sound name, and a + button (visible on hover) to map it as a chat trigger. Clicking the row itself also plays the sound. The + button creates a trigger word like !sound_name and adds it to your SFX alerts. The "cached" label means the sound\'s URL has been resolved and will play instantly next time.',
    example: 'Hover over "Vine Boom" → Click + → Creates trigger "!vine_boom" → Viewers can type !vine_boom in chat',
    tab: 'soundboard',
  },

  // ── OVERLAY TAB ──
  {
    id: 'help-overlay-intro',
    title: 'Overlay Tab — SFX Alerts & OBS Integration',
    description: 'The Overlay tab has two sections: SFX Alert management (mapping trigger words to sounds) and the OBS Overlay Customizer (designing how TTS text appears on stream). Let\'s cover both in detail.',
    tab: 'overlay',
  },
  {
    id: 'help-sfx-alerts',
    title: 'SFX Alert Triggers',
    description: 'Create trigger words that instantly play a sound when typed in chat — no TTS reading, just the sound effect. Enter a trigger word (like !coin), a sound clip URL (mp3/wav), and click "Add SFX". Viewers type the trigger in chat and the sound plays immediately. Each trigger has a Test button to preview and an X to delete. The default triggers are !coin, !horn, and !applause. You can also add sounds from the Soundboard tab using the + button.',
    example: 'Add trigger "!airhorn" with URL https://example.com/airhorn.mp3 → Viewer types !airhorn → Airhorn sound plays instantly\nAdd trigger "!rimshot" → Viewer types !rimshot → Ba-dum-tss plays',
    tab: 'overlay',
  },
  {
    id: 'help-obs-customizer',
    title: 'OBS Overlay Customizer',
    description: 'Design how TTS subtitles appear on your OBS stream. Three settings control the look: **Font Size** (12-72px) — how big the text appears. **Text Color** — the color of the spoken text (use the color picker). **Background Color** — the color behind the text. The Design Preview shows a live preview of how it will look with your current settings. The green-screen overlay can be chroma-keyed out in OBS.',
    example: 'Font 48px + White text + Black background → Classic subtitle look\nFont 36px + Red text + Transparent background → Minimalist style',
    tab: 'overlay',
  },
  {
    id: 'help-open-overlay',
    title: 'Open Subtitle Overlay Screen',
    description: 'Click this button to open the full-screen overlay that you capture in OBS. It has a green background (for chroma key removal) and shows the TTS text with a "TTS FROM [username]" header when someone speaks. When no one is speaking, it shows a "Click screen to allow overlay audio" prompt. The overlay controls panel (exit and skip buttons) appears on hover in the top-right corner — it\'s invisible to viewers when you hover away.',
    example: 'In OBS: Add Window Capture → Select the overlay window → Add Chroma Key filter → Set key color to green → TTS text appears over your stream',
    tab: 'overlay',
  },
  {
    id: 'help-design-preview',
    title: 'Design Preview',
    description: 'This live preview shows exactly how your TTS subtitles will look with the current font size, text color, and background color settings. It displays "Previewing Subtitle Design" in your chosen style. Changes are reflected immediately as you adjust the settings above. Use this to fine-tune your overlay look before going live.',
    example: 'Change font to 60px → Preview text instantly grows larger\nChange text to yellow on dark blue → Preview shows the new colors',
    tab: 'overlay',
  },
  {
    id: 'help-obs-button',
    title: 'OBS Button (Header)',
    description: 'The "OBS" button in the header is a shortcut to open the full-screen overlay. It does the same thing as "Open Subtitle overlay Screen" in the Overlay tab — just quicker access. Click it anytime to switch to the overlay view. The overlay fills the entire browser window with a green background for chroma keying in OBS.',
    tab: 'overlay',
  },
  {
    id: 'help-keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    description: 'Two essential shortcuts for stream control: **Ctrl+Space** = Skip the currently playing TTS message (same as clicking Skip). **Ctrl+Shift+L** = Clear the entire queue instantly. These work anywhere on the page as long as you\'re not typing in an input field. The Ctrl+Space shortcut is shown in the header for easy reference.',
    example: 'TTS is playing a long message → Press Ctrl+Space → Instantly skips to next\nQueue has 20 messages → Press Ctrl+Shift+L → Queue cleared instantly',
    tab: 'dash',
  },
];

// ═══════════════════════════════════════════════════
// HELP MODE SELECTOR MODAL
// ═══════════════════════════════════════════════════
function HelpModeSelector({ onSelect, onClose }: { onSelect: (mode: HelpMode) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4" style={{ animation: 'helpSlideUp 0.3s ease-out' }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-700">
              <HelpCircle size={22} />
            </div>
            <h2 className="text-xl font-bold text-gray-900">How can we help you?</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100 transition cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Choose your role to get a guided tour of the features that matter to you. We'll highlight each feature and explain everything with examples.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button onClick={() => onSelect('chatter')}
            className="group p-6 rounded-xl border-2 border-gray-100 hover:border-amber-300 hover:bg-amber-50/50 transition-all text-left cursor-pointer">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 mb-4 group-hover:scale-110 transition-transform">
              <Users size={24} />
            </div>
            <h3 className="font-bold text-gray-900 mb-1">Chatter Help</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Learn how to submit TTS, use sound effects, and understand voice options as a viewer.</p>
          </button>
          <button onClick={() => onSelect('streamer')}
            className="group p-6 rounded-xl border-2 border-gray-100 hover:border-red-300 hover:bg-red-50/50 transition-all text-left cursor-pointer">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-600 mb-4 group-hover:scale-110 transition-transform">
              <Radio size={24} />
            </div>
            <h3 className="font-bold text-gray-900 mb-1">Streamer Help</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Master every setting — voice engines, FX, rules, moderation, overlay, and soundboard.</p>
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// HIGHLIGHT BORDER — pulsing glow around the target element
// NO BLUR, NO OVERLAY, NO DIM. Just a colored border.
// pointerEvents: none so it doesn't block clicks
// Aggressively polls for the element (tab may not have rendered yet)
// Scrolls element to vertical center of visible area (above docked card)
// ═══════════════════════════════════════════════════
function HighlightBorder({ targetId, mode }: { targetId: string; mode: HelpMode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const lastScrollRef = useRef(false);

  const updateRect = useCallback(() => {
    const el = document.querySelector(`[data-help-id="${targetId}"]`) as HTMLElement;
    if (el) {
      // Check if element is actually visible (has dimensions)
      const newRect = el.getBoundingClientRect();
      if (newRect.width > 0 && newRect.height > 0) {
        setRect(newRect);
      }
      // Only auto-scroll once per target change, not on every resize/scroll event
      if (!lastScrollRef.current) {
        lastScrollRef.current = true;
        // Account for bottom docked card (~220px). Scroll so element is centered
        // in the visible area ABOVE the docked card.
        const dockHeight = 220;
        const viewCenter = (window.innerHeight - dockHeight) / 2;
        const elemCenter = newRect.top + newRect.height / 2;
        const scrollNeeded = elemCenter - viewCenter;
        if (Math.abs(scrollNeeded) > 30) {
          window.scrollBy({ top: scrollNeeded, behavior: 'smooth' });
        }
      }
    } else {
      setRect(null);
    }
  }, [targetId]);

  useEffect(() => {
    lastScrollRef.current = false;
    setRect(null);
    // Aggressive polling: the target element might not be in the DOM yet
    // because the tab hasn't finished switching/rendering.
    const t1 = setTimeout(updateRect, 100);
    const t2 = setTimeout(updateRect, 300);
    const t3 = setTimeout(updateRect, 600);
    const t4 = setTimeout(updateRect, 1000);
    const t5 = setTimeout(updateRect, 1500);
    const t6 = setTimeout(updateRect, 2000);
    window.addEventListener('resize', updateRect);
    const interval = setInterval(updateRect, 500);
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      clearTimeout(t4); clearTimeout(t5); clearTimeout(t6);
      window.removeEventListener('resize', updateRect);
      clearInterval(interval);
    };
  }, [updateRect]);

  if (!rect) return null;

  const isChatter = mode === 'chatter';
  const borderColor = isChatter ? '#f59e0b' : '#ef4444';
  const glowColor = isChatter ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)';

  return (
    <div style={{
      position: 'fixed',
      top: rect.top - 5,
      left: rect.left - 5,
      width: rect.width + 10,
      height: rect.height + 10,
      borderRadius: 12,
      border: `3px solid ${borderColor}`,
      boxShadow: `0 0 12px ${glowColor}, 0 0 24px ${glowColor}, inset 0 0 8px ${glowColor}`,
      zIndex: 9998,
      pointerEvents: 'none',
      transition: 'all 0.3s ease',
      animation: 'helpPulse 2s ease-in-out infinite',
    }} />
  );
}

// ═══════════════════════════════════════════════════
// BOTTOM DOCKED CARD — always visible, always clickable
// No overlay, no blur, no dim. Just a card at the bottom.
// ═══════════════════════════════════════════════════
function HelpDockedCard({
  item,
  stepIndex,
  totalSteps,
  onPrev,
  onNext,
  onClose,
  mode,
}: {
  item: HelpItem;
  stepIndex: number;
  totalSteps: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  mode: HelpMode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const isChatter = mode === 'chatter';
  const modeLabel = isChatter ? 'Chatter' : 'Streamer';
  const accent = isChatter ? '#f59e0b' : '#ef4444';
  const accentBg = isChatter ? 'bg-amber-50' : 'bg-red-50';
  const accentBorder = isChatter ? 'border-amber-100' : 'border-red-100';
  const accentText = isChatter ? 'text-amber-600' : 'text-red-600';
  const accentBtn = isChatter ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-700';

  // Scroll content to top when step changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [stepIndex]);

  const isIntro = item.id.includes('intro');
  // Use state so we can re-check after tab renders
  const [hasTarget, setHasTarget] = useState(false);

  useEffect(() => {
    let found = false;
    const check = () => {
      const el = document.querySelector(`[data-help-id="${item.id}"]`);
      if (el) {
        found = true;
        setHasTarget(true);
      } else if (!found) {
        setHasTarget(false);
      }
    };
    check();
    const t1 = setTimeout(check, 200);
    const t2 = setTimeout(check, 600);
    const t3 = setTimeout(check, 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [item.id]);

  // Tab label for context
  const tabLabels: Record<string, string> = {
    dash: 'Dashboard',
    voice: 'Voice & FX',
    rules: 'Rules',
    overlay: 'Overlay',
    soundboard: 'Soundboard',
  };
  const currentTab = item.tab ? tabLabels[item.tab] || item.tab : '';

  return (
    <>
      {/* Highlight the target element with a pulsing border — NO overlay, NO blur */}
      {!isIntro && hasTarget && (
        <HighlightBorder targetId={item.id} mode={mode} />
      )}

      {/* Bottom docked card — always visible, never off-screen */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10001,
          animation: 'helpSlideUp 0.3s ease-out',
        }}
        className="flex flex-col bg-white border-t border-gray-200"
      >
        {/* Add padding to the page so content doesn't get hidden behind the docked card */}
        <style>{`body { padding-bottom: 0 !important; }`}</style>

        {/* Header bar */}
        <div className={`px-5 py-2.5 flex items-center justify-between ${accentBg} border-b ${accentBorder} flex-shrink-0`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${accentText}`}>
              <HelpCircle size={14} />
            </div>
            <span className={`text-[10px] font-black uppercase tracking-widest ${accentText}`}>{modeLabel} Guide</span>
            <span className="text-[10px] text-gray-400 font-mono">{stepIndex + 1}/{totalSteps}</span>
            {currentTab && (
              <span className="text-[10px] font-semibold text-gray-400 bg-white/60 px-2 py-0.5 rounded-full">
                {currentTab}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isIntro && hasTarget && (
              <span className="text-[10px] text-gray-400 hidden sm:inline-flex items-center gap-1">
                <MapPin size={10} style={{ color: accent }} />
                Look for the <span style={{ color: accent }} className="font-bold">highlighted box</span> above
              </span>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-white/60 transition cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content area — scrollable if too tall, max 40vh */}
        <div ref={contentRef} className="overflow-y-auto px-5 py-4" style={{ maxHeight: '40vh' }}>
          <h3 className="text-[15px] font-bold text-gray-900 mb-2 leading-snug">{item.title}</h3>
          <p className="text-[13px] text-gray-600 leading-relaxed whitespace-pre-line">{item.description}</p>

          {item.example && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Example</span>
              </div>
              <p className="text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-line">{item.example}</p>
            </div>
          )}
        </div>

        {/* Navigation footer — ALWAYS visible, ALWAYS clickable */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
          <button
            onClick={onPrev}
            disabled={stepIndex === 0}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition px-3 py-2 rounded-lg hover:bg-gray-100"
          >
            <ChevronLeft size={14} /> Back
          </button>

          {/* Progress bar */}
          <div className="flex-1 mx-3 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${((stepIndex + 1) / totalSteps) * 100}%`,
                backgroundColor: accent,
              }}
            />
          </div>

          <button
            onClick={onNext}
            className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition text-white ${stepIndex === totalSteps - 1
              ? 'bg-gray-400 hover:bg-gray-500'
              : accentBtn
            }`}
          >
            {stepIndex === totalSteps - 1 ? 'Finish' : 'Next'} <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════
// MAIN EXPORT: HelpSystem
// ═══════════════════════════════════════════════════
export default function HelpSystem({
  isOpen,
  onClose,
  onTabChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  onTabChange: (tab: 'dash' | 'voice' | 'rules' | 'overlay' | 'soundboard') => void;
}) {
  const [mode, setMode] = useState<HelpMode | null>(null);
  const [step, setStep] = useState(0);
  const [showSelector, setShowSelector] = useState(false);

  const helpItems = mode === 'chatter' ? CHATTER_HELP : STREAMER_HELP;

  // Reset when opened/closed
  useEffect(() => {
    if (isOpen) {
      setShowSelector(true);
      setMode(null);
      setStep(0);
    } else {
      setMode(null);
      setStep(0);
      setShowSelector(false);
    }
  }, [isOpen]);

  // When mode is selected, start the tour
  const handleModeSelect = (m: HelpMode) => {
    setMode(m);
    setShowSelector(false);
    setStep(0);
  };

  // Switch tab when step changes
  useEffect(() => {
    if (!mode || !helpItems.length) return;
    const item = helpItems[step];
    if (item?.tab) {
      onTabChange(item.tab);
    }
  }, [step, mode]);

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleNext = () => {
    if (step < helpItems.length - 1) {
      setStep(step + 1);
    } else {
      onClose();
    }
  };

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  // Show mode selector
  if (showSelector && !mode) {
    return <HelpModeSelector onSelect={handleModeSelect} onClose={handleClose} />;
  }

  // Show bottom docked card tour
  if (mode && helpItems.length > 0) {
    const currentItem = helpItems[step];
    return (
      <HelpDockedCard
        item={currentItem}
        stepIndex={step}
        totalSteps={helpItems.length}
        onPrev={handlePrev}
        onNext={handleNext}
        onClose={handleClose}
        mode={mode}
      />
    );
  }

  return null;
}
