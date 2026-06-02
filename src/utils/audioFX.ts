// ═══════════════════════════════════════════════════════════════
// TTS Control Room v4 — Audio Effects Engine
// Professional-grade voice transformation using Web Audio API
// NEW in v4: Chorus, Convolution Reverb, Tremolo
// ═══════════════════════════════════════════════════════════════

export interface FXSettings {
  pitch: number;              // 0.25–2.5 — playback rate (pitch + speed)
  lowPassFreq: number;        // 0–16000 Hz — low-pass filter cutoff (0 = bypass)
  highPassFreq: number;       // 0–500 Hz — high-pass filter cutoff (0 = bypass)
  distortionAmount: number;   // 0–1.0 — waveshaper drive
  robotFrequency: number;     // 0–200 Hz — ring modulator carrier (0 = bypass)
  robotMix: number;           // 0–1.0 — dry/wet mix for robot effect
  megaphone: boolean;         // telephone bandpass filter
  echoDelay: number;          // 0–1.0 seconds
  echoFeedback: number;       // 0–0.85
  echoMix: number;            // 0–1.0 — wet level for echo
  wobbleSpeed: number;        // 0–20 Hz — vibrato LFO rate
  wobbleDepth: number;        // 0–1.0 — vibrato LFO depth
  bitCrush: number;           // 0–1.0 — bit crusher depth (0 = bypass)
  chorusRate: number;         // 0–5 Hz — chorus LFO speed (0 = bypass)
  chorusDepth: number;        // 0–1.0 — chorus LFO depth / modulation amount
  reverbAmount: number;       // 0–1.0 — reverb room size + wet mix (0 = bypass)
  tremoloSpeed: number;       // 0–20 Hz — amplitude tremolo LFO (0 = bypass)
  tremoloDepth: number;       // 0–1.0 — tremolo depth
  volume: number;             // 0–2.0 — master output volume
}

export interface PlayingAudioControl {
  stop: () => void;
  onEnded: (cb: () => void) => void;
  /** The AudioContext used for this playback — useful for visualization */
  audioContext?: AudioContext;
}

// Default FX settings (clean — no effects)
export const DEFAULT_FX: FXSettings = {
  pitch: 1.0,
  lowPassFreq: 0,
  highPassFreq: 0,
  distortionAmount: 0,
  robotFrequency: 0,
  robotMix: 0.5,
  megaphone: false,
  echoDelay: 0,
  echoFeedback: 0,
  echoMix: 0.4,
  wobbleSpeed: 0,
  wobbleDepth: 0,
  bitCrush: 0,
  chorusRate: 0,
  chorusDepth: 0,
  reverbAmount: 0,
  tremoloSpeed: 0,
  tremoloDepth: 0,
  volume: 1.0,
};

// ── Distortion Curves ──

// Soft-clip (tanh): warm saturation — good for slight warmth or megaphone
export function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 44100;
  const curve = new Float32Array(n);
  const drive = 2 + amount * 48;
  for (let i = 0; i < n; ++i) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve as Float32Array<ArrayBuffer>;
}

// Hard-clip: aggressive crunch for demon/rage effects
function makeHardClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 44100;
  const curve = new Float32Array(n);
  const threshold = 1.0 - amount * 0.8;
  for (let i = 0; i < n; ++i) {
    const x = (i * 2) / n - 1;
    if (x > threshold) curve[i] = threshold;
    else if (x < -threshold) curve[i] = -threshold;
    else curve[i] = x;
  }
  return curve as Float32Array<ArrayBuffer>;
}

// ── Formant Shifting ──
// Shifts the spectral envelope to simulate vocal tract length changes.
// Auto-applied when pitch is significantly shifted.
function createFormantShiftChain(
  audioCtx: BaseAudioContext,
  shiftRatio: number
): { input: AudioNode; output: AudioNode } {
  const f1 = audioCtx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 500 * shiftRatio;
  f1.Q.value = 1.2;

  const f2 = audioCtx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 1500 * shiftRatio;
  f2.Q.value = 1.5;

  const f3 = audioCtx.createBiquadFilter();
  f3.type = 'bandpass';
  f3.frequency.value = 2500 * shiftRatio;
  f3.Q.value = 1.8;

  const f1Gain = audioCtx.createGain();
  f1Gain.gain.value = 2.0 / shiftRatio;
  const f2Gain = audioCtx.createGain();
  f2Gain.gain.value = 1.5 / shiftRatio;
  const f3Gain = audioCtx.createGain();
  f3Gain.gain.value = 0.8 / shiftRatio;

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = Math.min(8000 * shiftRatio, 18000);
  lowpass.Q.value = 0.5;

  const merger = audioCtx.createGain();
  merger.gain.value = 0.65;

  const input = audioCtx.createGain();
  input.gain.value = 1.0;

  input.connect(f1); input.connect(f2); input.connect(f3); input.connect(lowpass);
  f1.connect(f1Gain); f2.connect(f2Gain); f3.connect(f3Gain);
  f1Gain.connect(merger); f2Gain.connect(merger); f3Gain.connect(merger);
  lowpass.connect(merger);

  return { input, output: merger };
}

// ── Bit Crusher ──
// Reduces sample resolution for lo-fi / retro effect
function createBitCrusher(
  audioCtx: BaseAudioContext,
  depth: number // 0–1: 0 = 16-bit (subtle), 1 = 2-bit (extreme lo-fi)
): { input: AudioNode; output: AudioNode } {
  const bits = Math.max(2, Math.round(16 - depth * 14));
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  const step = Math.pow(0.5, bits - 1);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
      output[i] = Math.round(input[i] / step) * step;
    }
  };

  return { input: processor, output: processor };
}

// ── Multi-tap Echo ──
function createMultiTapDelay(
  audioCtx: BaseAudioContext,
  baseDelay: number,
  feedback: number,
  wetMix: number
): { input: AudioNode; output: AudioNode } {
  const taps = [
    { time: baseDelay, gain: wetMix },
    { time: baseDelay * 1.35, gain: wetMix * 0.7 },
    { time: baseDelay * 1.72, gain: wetMix * 0.45 },
  ];

  const input = audioCtx.createGain();
  input.gain.value = 1.0;
  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 1.0;
  const output = audioCtx.createGain();
  output.gain.value = 1.0;

  input.connect(dryGain);
  dryGain.connect(output);

  for (const tap of taps) {
    const delay = audioCtx.createDelay(5.0);
    delay.delayTime.value = tap.time;
    const fbGain = audioCtx.createGain();
    fbGain.gain.value = Math.min(feedback, 0.85);
    const wetGain = audioCtx.createGain();
    wetGain.gain.value = tap.gain;

    input.connect(delay);
    delay.connect(fbGain);
    fbGain.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(output);
  }

  return { input, output };
}

// ── Chorus ──
// Two detuned voices of LFO-modulated delay lines creates the lush
// chorus effect crucial for underwater, alien, and rich spatial sounds.
function createChorus(
  audioCtx: BaseAudioContext,
  rate: number,   // LFO Hz (0.1–5)
  depth: number,  // modulation depth (0–1)
  mix: number,    // wet level (0–1)
  nodesToStop: { stop?: () => void }[]
): { input: AudioNode; output: AudioNode } {
  const baseDelay = 0.018; // 18ms base delay

  const input = audioCtx.createGain();
  input.gain.value = 1.0;
  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 1.0;
  const output = audioCtx.createGain();
  output.gain.value = 1.0;

  input.connect(dryGain);
  dryGain.connect(output);

  // Two slightly detuned voices — the pair creates width and lushness
  const offsets = [0, 0.007]; // voice 2 is offset 7ms from voice 1
  const lfoTypes: OscillatorType[] = ['sine', 'triangle'];

  for (let i = 0; i < 2; i++) {
    const delay = audioCtx.createDelay(0.1);
    delay.delayTime.value = baseDelay + offsets[i];

    const lfo = audioCtx.createOscillator();
    lfo.type = lfoTypes[i];
    lfo.frequency.value = rate * (1 + i * 0.13); // slight detune between LFOs

    const lfoGain = audioCtx.createGain();
    // depth 0–1 → modulation range 0–11ms peak
    lfoGain.gain.value = depth * 0.011;

    const voiceGain = audioCtx.createGain();
    voiceGain.gain.value = mix * 0.5; // split evenly across 2 voices

    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    input.connect(delay);
    delay.connect(voiceGain);
    voiceGain.connect(output);

    lfo.start(0);
    nodesToStop.push(lfo);
  }

  return { input, output };
}

// ── Convolution Reverb ──
// Synthesizes a realistic room impulse response using exponentially
// decaying noise. Far superior to delay-based fakes — produces genuine
// diffuse reverb tails that make cave and underwater truly spatial.
function createReverb(
  audioCtx: BaseAudioContext,
  roomSize: number, // 0–1: controls room size (IR length) and character
  wet: number       // 0–1: wet mix level
): { input: AudioNode; output: AudioNode } {
  const sampleRate = audioCtx.sampleRate;
  const duration = 0.35 + roomSize * 2.8; // 0.35s (tiny room) → 3.15s (cathedral)
  const length = Math.floor(sampleRate * duration);
  const decayRate = 2.5 + (1 - roomSize) * 5.5; // larger room = slower decay

  // Stereo IR with slightly different L/R for natural width
  const irBuffer = audioCtx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = irBuffer.getChannelData(ch);
    const preDelayMs = ch === 0 ? 8 : 11; // slight L/R offset for width
    const preDelay = Math.floor(sampleRate * preDelayMs / 1000);

    for (let i = 0; i < length; i++) {
      if (i < preDelay) { data[i] = 0; continue; }
      const t = (i - preDelay) / sampleRate;
      // Early reflections have more energy (1.6x) for the first 80ms
      const earlyBoost = t < 0.08 ? 1.6 : 1.0;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-decayRate * t) * earlyBoost;
    }
    // Normalize so level doesn't spike
    let max = 0;
    for (let i = 0; i < length; i++) max = Math.max(max, Math.abs(data[i]));
    if (max > 0) for (let i = 0; i < length; i++) data[i] /= max;
  }

  const convolver = audioCtx.createConvolver();
  convolver.buffer = irBuffer;

  // High-frequency damping on reverb tail (simulates air absorption)
  const revLP = audioCtx.createBiquadFilter();
  revLP.type = 'lowpass';
  // Smaller rooms are brighter; cathedral-sized rooms are darker
  revLP.frequency.value = 2000 + (1 - roomSize) * 9000;
  revLP.Q.value = 0.5;

  const input = audioCtx.createGain();
  input.gain.value = 1.0;
  const output = audioCtx.createGain();
  output.gain.value = 1.0;
  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 1.0;
  const wetGain = audioCtx.createGain();
  wetGain.gain.value = wet;

  input.connect(dryGain);
  input.connect(convolver);
  convolver.connect(revLP);
  revLP.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  return { input, output };
}

// ── Tremolo ──
// Amplitude modulation — the LFO controls volume level rather than pitch.
// This creates the pulsing quality of alien signals and adds the unsteady
// amplitude variation that makes drunk believable.
function createTremolo(
  audioCtx: BaseAudioContext,
  speed: number,  // Hz
  depth: number,  // 0–1
  nodesToStop: { stop?: () => void }[]
): { input: AudioNode; output: AudioNode } {
  const input = audioCtx.createGain();
  input.gain.value = 1.0;

  // Base gain sits at (1 - depth/2) so average level stays near 1.0
  const tremoloGain = audioCtx.createGain();
  tremoloGain.gain.value = 1.0 - depth * 0.5;

  const lfo = audioCtx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = speed;

  const lfoAmp = audioCtx.createGain();
  lfoAmp.gain.value = depth * 0.5; // ± depth/2 around base

  lfo.connect(lfoAmp);
  lfoAmp.connect(tremoloGain.gain);
  input.connect(tremoloGain);

  lfo.start(0);
  nodesToStop.push(lfo);

  return { input, output: tremoloGain };
}

// ═══════════════════════════════════════════════════════════════
// Main Effects Chain
// ═══════════════════════════════════════════════════════════════
export async function playAudioWithFX(
  audioBlobOrUrl: Blob | string,
  fxSettings: FXSettings,
  volumeBoost: number = 1.0  // Per-voice volume multiplier (0.2 = very quiet, 1.0 = normal, 5.0 = 5x louder)
): Promise<PlayingAudioControl> {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

  // Decode audio
  let arrayBuffer: ArrayBuffer;
  if (typeof audioBlobOrUrl === 'string') {
    const response = await fetch(audioBlobOrUrl);
    if (!response.ok) throw new Error(`Failed to fetch audio from ${audioBlobOrUrl}`);
    arrayBuffer = await response.arrayBuffer();
  } else {
    arrayBuffer = await audioBlobOrUrl.arrayBuffer();
  }

  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const source = audioCtx.createBufferSource();
  // NOTE: Do NOT set source.buffer here — it is assigned once below after the
  // silence-padded buffer is built. AudioBufferSourceNode throws
  // "Cannot set buffer to non-null after it has been already been set to a non-null buffer"
  // if .buffer is assigned more than once.
  source.playbackRate.value = fxSettings.pitch;

  let lastNode: AudioNode = source;
  const nodesToStop: { stop?: () => void }[] = [];

  // ═══ Stage 0: Formant Shift ═══
  // Auto-applies when pitch deviates significantly from 1.0
  const pitchShift = fxSettings.pitch;
  if (pitchShift > 1.15) {
    const formantRatio = Math.pow(pitchShift, 0.55);
    const chain = createFormantShiftChain(audioCtx, formantRatio);
    lastNode.connect(chain.input);
    lastNode = chain.output;
  } else if (pitchShift < 0.85) {
    const formantRatio = Math.pow(pitchShift, 0.45);
    const chain = createFormantShiftChain(audioCtx, formantRatio);
    lastNode.connect(chain.input);
    lastNode = chain.output;
  }

  // ═══ Stage 1: High-Pass Filter ═══
  if (fxSettings.highPassFreq > 10) {
    const hpf = audioCtx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = fxSettings.highPassFreq;
    hpf.Q.value = 0.7;
    lastNode.connect(hpf);
    lastNode = hpf;
  }

  // ═══ Stage 2: Low-Pass Filter ═══
  if (fxSettings.lowPassFreq > 100 && fxSettings.lowPassFreq < 15900) {
    const lpf = audioCtx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = fxSettings.lowPassFreq;
    lpf.Q.value = 1.0;
    lastNode.connect(lpf);
    lastNode = lpf;
  }

  // ═══ Stage 3: Distortion ═══
  if (fxSettings.distortionAmount > 0.01) {
    const useHard = fxSettings.distortionAmount > 0.6;
    const distortionNode = audioCtx.createWaveShaper();
    distortionNode.curve = useHard
      ? makeHardClipCurve(fxSettings.distortionAmount)
      : makeDistortionCurve(fxSettings.distortionAmount);
    distortionNode.oversample = '4x';

    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 1 - fxSettings.distortionAmount * 0.4;
    const wetGain = audioCtx.createGain();
    wetGain.gain.value = fxSettings.distortionAmount * 0.7;
    const mixNode = audioCtx.createGain();
    mixNode.gain.value = 1.0;

    lastNode.connect(dryGain);
    lastNode.connect(distortionNode);
    distortionNode.connect(wetGain);
    dryGain.connect(mixNode);
    wetGain.connect(mixNode);
    lastNode = mixNode;
  }

  // ═══ Stage 4: Bit Crusher ═══
  if (fxSettings.bitCrush > 0.05) {
    const crushChain = createBitCrusher(audioCtx, fxSettings.bitCrush);
    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 1 - fxSettings.bitCrush * 0.6;
    const wetGain = audioCtx.createGain();
    wetGain.gain.value = fxSettings.bitCrush * 0.8;
    const mixNode = audioCtx.createGain();
    mixNode.gain.value = 1.0;

    lastNode.connect(dryGain);
    lastNode.connect(crushChain.input);
    crushChain.output.connect(wetGain);
    dryGain.connect(mixNode);
    wetGain.connect(mixNode);
    lastNode = mixNode;
  }

  // ═══ Stage 5: Ring Modulator (Robot / Alien) ═══
  if (fxSettings.robotFrequency > 0) {
    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 1 - fxSettings.robotMix;

    const ringGain = audioCtx.createGain();
    ringGain.gain.value = 0;

    const carrier = audioCtx.createOscillator();
    carrier.frequency.value = fxSettings.robotFrequency;
    carrier.type = 'sine';

    const carrierGain = audioCtx.createGain();
    carrierGain.gain.value = fxSettings.robotMix * 0.8;

    carrier.connect(carrierGain);
    carrierGain.connect(ringGain.gain);

    lastNode.connect(dryGain);
    lastNode.connect(ringGain);
    carrier.start(0);
    nodesToStop.push(carrier);

    const lpf = audioCtx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 2000;
    lpf.Q.value = 3.0;

    const hpf = audioCtx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 120;
    hpf.Q.value = 0.7;

    ringGain.connect(lpf);
    lpf.connect(hpf);

    const mixNode = audioCtx.createGain();
    mixNode.gain.value = 1.0;
    dryGain.connect(mixNode);
    hpf.connect(mixNode);
    lastNode = mixNode;
  }

  // ═══ Stage 6: Megaphone / Telephone Filter ═══
  if (fxSettings.megaphone) {
    const hpf = audioCtx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 450;
    hpf.Q.value = 1.0;

    const lpf = audioCtx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 3200;
    lpf.Q.value = 1.0;

    const presence = audioCtx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1800;
    presence.Q.value = 2.5;
    presence.gain.value = 8;

    const edge = audioCtx.createBiquadFilter();
    edge.type = 'peaking';
    edge.frequency.value = 2800;
    edge.Q.value = 3;
    edge.gain.value = 4;

    const makeupGain = audioCtx.createGain();
    makeupGain.gain.value = 2.5;

    lastNode.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(presence);
    presence.connect(edge);
    edge.connect(makeupGain);
    lastNode = makeupGain;
  }

  // ═══ Stage 7: Chorus ═══
  // Must come after tone-shaping but before spatial effects.
  // Chorus is the #1 ingredient that makes underwater sound underwater,
  // and gives alien that lush modulated quality distinct from robot.
  if (fxSettings.chorusDepth > 0.01 && fxSettings.chorusRate > 0.01) {
    const chorus = createChorus(
      audioCtx,
      fxSettings.chorusRate,
      fxSettings.chorusDepth,
      0.65, // fixed wet level — chorusDepth controls modulation amount
      nodesToStop
    );
    lastNode.connect(chorus.input);
    lastNode = chorus.output;
  }

  // ═══ Stage 8: Vibrato (Wobble — LFO on playback rate) ═══
  if (fxSettings.wobbleSpeed > 0 && fxSettings.wobbleDepth > 0) {
    const vibrato = audioCtx.createOscillator();
    vibrato.frequency.value = fxSettings.wobbleSpeed;
    vibrato.type = 'sine';
    const vibratoGain = audioCtx.createGain();
    vibratoGain.gain.value = fxSettings.wobbleDepth * 0.12;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(source.playbackRate);
    vibrato.start(0);
    nodesToStop.push(vibrato);
  }

  // ═══ Stage 9: Tremolo (Amplitude LFO) ═══
  // Different from wobble — this modulates volume not pitch.
  // Creates the pulsing quality needed for alien and drunk.
  if (fxSettings.tremoloSpeed > 0 && fxSettings.tremoloDepth > 0.01) {
    const tremolo = createTremolo(
      audioCtx,
      fxSettings.tremoloSpeed,
      fxSettings.tremoloDepth,
      nodesToStop
    );
    lastNode.connect(tremolo.input);
    lastNode = tremolo.output;
  }

  // ═══ Stage 10: Echo / Delay (Multi-tap) ═══
  if (fxSettings.echoDelay > 0.01 || fxSettings.echoFeedback > 0.01) {
    const delayChain = createMultiTapDelay(
      audioCtx,
      Math.max(fxSettings.echoDelay, 0.03),
      fxSettings.echoFeedback,
      fxSettings.echoMix
    );
    lastNode.connect(delayChain.input);
    lastNode = delayChain.output;
  }

  // ═══ Stage 11: Convolution Reverb ═══
  // Real reverb — not delay-based. Creates genuine acoustic spaces.
  // Essential for making cave sound like a cave and demon sound massive.
  if (fxSettings.reverbAmount > 0.01) {
    const wetMix = fxSettings.reverbAmount * 0.65; // max 65% wet
    const reverb = createReverb(audioCtx, fxSettings.reverbAmount, wetMix);
    lastNode.connect(reverb.input);
    lastNode = reverb.output;
  }

  // ═══ Stage 12: Master Volume + Per-Voice Boost ═══
  // The volumeBoost parameter multiplies the gain directly on the GainNode.
  // Supports both boost (1.0–5.0) and reduction (0.2–0.9):
  //   0.2 = very quiet (20% volume), 0.5 = half volume, 1.0 = normal, 5.0 = 5x louder
  // The compressor chain after this stage prevents clipping while preserving
  // the perceived loudness increase.
  const effectiveBoost = Math.max(0.05, Math.min(volumeBoost, 5.0)); // Clamp 0.05–5.0
  const volumeGain = audioCtx.createGain();
  volumeGain.gain.value = fxSettings.volume * effectiveBoost;
  lastNode.connect(volumeGain);
  lastNode = volumeGain;

  // ═══ Stage 13: 2-Bus Compressor Chain ═══
  // Gentle leveling + hard limiter to catch peaks from heavy effects.
  // Previous settings were way too aggressive (-20dB threshold / 4:1 ratio) which
  // crushed the output volume by ~15dB even for clean voice. New settings only
  // tame the loudest peaks and leave normal speech untouched.
  const comp1 = audioCtx.createDynamicsCompressor();
  comp1.threshold.value = -8;   // Only compress peaks above -8dB (was -20dB)
  comp1.knee.value = 6;         // Softer knee for more natural compression
  comp1.ratio.value = 2.5;      // Gentle 2.5:1 ratio (was 4:1 — way too aggressive)
  comp1.attack.value = 0.01;
  comp1.release.value = 0.15;

  const comp2 = audioCtx.createDynamicsCompressor();
  comp2.threshold.value = -3;   // Hard limiter only catches the very loudest peaks (was -6dB)
  comp2.knee.value = 1;
  comp2.ratio.value = 12;       // Strong but only kicks in near clipping (was 20:1)
  comp2.attack.value = 0.001;
  comp2.release.value = 0.05;

  // Make-up gain: compensate for volume lost to compression so output
  // stays at perceived unity level. ~4dB boost recovers the gentle
  // compression from comp1 while keeping peaks under control.
  const makeupGain = audioCtx.createGain();
  makeupGain.gain.value = 1.55; // +4dB make-up gain

  lastNode.connect(comp1);
  comp1.connect(comp2);
  comp2.connect(makeupGain);
  makeupGain.connect(audioCtx.destination);

  // BUG FIX: Ensure AudioContext is running before starting playback.
  // Chrome suspends AudioContext on page load until user interaction.
  // If we start() the source while suspended, the first ~200ms of audio gets clipped.
  // We MUST await the resume() and verify state before scheduling playback.
  const ensurePlaying = async () => {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Wait for the resume to fully propagate through the audio pipeline.
    // A single microtask (setTimeout 0) is NOT enough — Chrome needs at least
    // one animation frame to fully activate the AudioContext hardware.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  // FIX: Prepend silence to the decoded audio buffer to prevent first-word clipping.
  // The root cause is multi-layered:
  //   1. FLAC encoders add encoder delay (priming samples) — these are silent
  //      samples at the start of the decoded stream that the Web Audio API includes.
  //   2. Chrome's AudioContext can take ~50-200ms to fully activate after resume(),
  //      causing the beginning of the audio to be silently dropped.
  //   3. The Web Audio graph (compressors, filters, etc.) needs a few ms to "warm up"
  //      and start processing audio at full gain — early samples are quieter.
  // Instead of using source.start(offset) which SKIPS audio (cutting words),
  // we prepend 300ms of silence so any startup latency only eats into the silence.
  // The audio content starts cleanly after the hardware is fully active.
  const SILENCE_PREPEND_SECONDS = 0.3; // 300ms silence guard
  const originalLength = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const silenceSamples = Math.floor(sampleRate * SILENCE_PREPEND_SECONDS);
  const newLength = originalLength + silenceSamples;

  const paddedBuffer = audioCtx.createBuffer(numChannels, newLength, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const destData = paddedBuffer.getChannelData(ch);
    // First portion stays zero (silence)
    destData.set(sourceData, silenceSamples); // Copy original after the silence gap
  }
  source.buffer = paddedBuffer;

  await ensurePlaying();
  source.start(audioCtx.currentTime);

  let endedCallback: (() => void) | null = null;
  let endedFired = false;

  const fireEnded = () => {
    if (endedFired) return;
    endedFired = true;
    nodesToStop.forEach((n) => { try { n.stop?.(); } catch {} });
    // Delay closing the AudioContext so visualizers can finish their last frame
    setTimeout(() => { try { audioCtx.close(); } catch {} }, 300);
    if (endedCallback) endedCallback();
  };

  source.onended = fireEnded;

  return {
    stop: () => {
      try { source.stop(); } catch {}
      fireEnded();
    },
    onEnded: (cb: () => void) => {
      if (endedFired) { cb(); return; }
      endedCallback = cb;
    },
    audioContext: audioCtx,
  };
}