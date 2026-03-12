/**
 * Moss & Moonlight — SoundManager
 * Background music: SFX/Glimmering_Spore_Trail.mp3
 * Sound effects: procedurally synthesised via Web Audio API (no extra files needed)
 */

const SoundManager = (() => {
  let ctx = null;
  let masterGain = null;
  let musicSource = null;
  let musicGain = null;
  let musicBuffer = null;
  let muted = false;

  const MUSIC_VOLUME = 0.35;
  const SFX_VOLUME   = 0.55;

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  // Only call after a user gesture — creates and resumes the AudioContext.
  function _ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  // ── Music ─────────────────────────────────────────────────────────────────────

  // Fetch the MP3 bytes without touching AudioContext (safe before user gesture).
  let _musicFetchPromise = null;
  let _musicRawBuffer    = null;

  function loadMusic() {
    if (_musicFetchPromise) return _musicFetchPromise;
    _musicFetchPromise = fetch('SFX/Glimmering_Spore_Trail.mp3')
      .then(r => r.arrayBuffer())
      .then(ab => { _musicRawBuffer = ab; })
      .catch(e => console.warn('SoundManager: could not fetch background music', e));
    return _musicFetchPromise;
  }

  async function startMusic() {
    if (musicSource) return;           // already playing
    _ensureCtx();                      // safe: called after user gesture
    // Decode now that ctx exists (decodeAudioData needs a live context)
    if (!musicBuffer && _musicRawBuffer) {
      try {
        musicBuffer = await ctx.decodeAudioData(_musicRawBuffer.slice(0));
      } catch (e) {
        console.warn('SoundManager: could not decode background music', e);
        return;
      }
    }
    if (!musicBuffer) return;
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_VOLUME;
    musicGain.connect(masterGain);

    musicSource = ctx.createBufferSource();
    musicSource.buffer = musicBuffer;
    musicSource.loop   = true;
    musicSource.connect(musicGain);
    musicSource.start(0);
  }

  function stopMusic() {
    if (!musicSource) return;
    try { musicSource.stop(); } catch (_) {}
    musicSource = null;
  }

  function fadeOutMusic(duration = 1.5) {
    if (!musicGain) return;
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, duration / 3);
    setTimeout(stopMusic, duration * 1000);
  }
  // ── Mute toggle ───────────────────────────────────────────────────────────────

  function setMuted(val) {
    muted = val;
    localStorage.setItem('mm_muted', val ? '1' : '0');
    if (masterGain && ctx) {
      masterGain.gain.setTargetAtTime(val ? 0 : 1, ctx.currentTime, 0.05);
    }
  }

  function isMuted() { return muted; }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  // ── Low-level synth helpers ───────────────────────────────────────────────────

  function _osc(type, freq, start, duration, gainPeak, gainEnd = 0, detune = 0) {
    _ensureCtx();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gainPeak * SFX_VOLUME, start + 0.01);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainEnd * SFX_VOLUME), start + duration);
    g.connect(masterGain);

    const o = ctx.createOscillator();
    o.type    = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    o.connect(g);
    o.start(start);
    o.stop(start + duration + 0.02);
  }

  function _noise(start, duration, gainPeak, gainEnd = 0, filterFreq = 4000) {
    _ensureCtx();
    const bufLen = ctx.sampleRate * duration;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filt = ctx.createBiquadFilter();
    filt.type            = 'bandpass';
    filt.frequency.value = filterFreq;
    filt.Q.value         = 1.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gainPeak * SFX_VOLUME, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainEnd * SFX_VOLUME), start + duration);

    src.connect(filt);
    filt.connect(g);
    g.connect(masterGain);
    src.start(start);
    src.stop(start + duration);
  }

  // ── Sound effects ─────────────────────────────────────────────────────────────

  /** Short upward chirp */
  function sfxJump() {
    _ensureCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(480, t + 0.12);
    g.gain.setValueAtTime(SFX_VOLUME * 0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.2);
  }

  /** Stomp + crunch when landing on enemy */
  function sfxEnemyKill() {
    _ensureCtx();
    const t = ctx.currentTime;
    // Thud
    _osc('sine', 180, t,       0.08, 0.9, 0.01);
    _osc('sine',  80, t,       0.12, 0.7, 0.01);
    // Crunch noise burst
    _noise(t, 0.07, 0.6, 0.01, 2200);
    // Short pitch drop
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(320, t + 0.02);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.14);
    g.gain.setValueAtTime(SFX_VOLUME * 0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(masterGain);
    o.start(t + 0.02); o.stop(t + 0.18);
  }

  /** Flyer fires a bullet: sharp zap */
  function sfxShoot() {
    _ensureCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.14);
    g.gain.setValueAtTime(SFX_VOLUME * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.18);
  }

  /** Bullet hitting player: short impact */
  function sfxBulletHit() {
    _ensureCtx();
    const t = ctx.currentTime;
    _noise(t, 0.06, 0.7, 0.01, 3000);
    _osc('sine', 260, t, 0.08, 0.5, 0.01);
  }

  /** Player loses a life: descending sad tones */
  function sfxLoseLife() {
    _ensureCtx();
    const t = ctx.currentTime;
    const notes = [440, 349, 294, 220];
    notes.forEach((freq, i) => {
      _osc('sine', freq, t + i * 0.10, 0.18, 0.6, 0.01);
      _osc('triangle', freq * 0.5, t + i * 0.10, 0.18, 0.2, 0.01);
    });
  }

  /** Collect a firefly: light sparkle */
  function sfxCollectFirefly() {
    _ensureCtx();
    const t = ctx.currentTime;
    [660, 880, 1100, 1320].forEach((freq, i) => {
      _osc('sine', freq, t + i * 0.04, 0.14, 0.45, 0.01);
    });
  }

  /** Collect a powerup: bright fanfare chord */
  function sfxCollectPowerup() {
    _ensureCtx();
    const t = ctx.currentTime;
    // Major triad arpeggio
    [523, 659, 784, 1047].forEach((freq, i) => {
      _osc('triangle', freq, t + i * 0.06, 0.28, 0.55, 0.01);
    });
    _noise(t, 0.06, 0.25, 0.01, 6000);
  }

  /** Extra life specifically: heart sound */
  function sfxExtraLife() {
    _ensureCtx();
    const t = ctx.currentTime;
    [523, 659, 784, 659, 1047].forEach((freq, i) => {
      _osc('sine', freq, t + i * 0.07, 0.20, 0.6, 0.01);
    });
  }

  /** Level complete: ascending arpeggio */
  function sfxLevelComplete() {
    _ensureCtx();
    const t = ctx.currentTime;
    [523, 659, 784, 1047, 1319].forEach((freq, i) => {
      _osc('triangle', freq, t + i * 0.09, 0.28, 0.65, 0.01);
      _osc('sine',     freq, t + i * 0.09, 0.28, 0.25, 0.01, 5);
    });
  }

  /** Game over: descending wail */
  function sfxGameOver() {
    _ensureCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 1.4);
    g.gain.setValueAtTime(SFX_VOLUME * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 1.6);
    // Low rumble underneath
    _osc('sine', 60, t, 1.0, 0.4, 0.01);
  }

  /** Counter ticks towards explosion */
  function sfxCounterTick(count) {
    _ensureCtx();
    const t    = ctx.currentTime;
    const freq = 180 + count * 80;
    _osc('square', freq, t, 0.06, 0.4, 0.01);
  }

  /** Counter explodes */
  function sfxCounterExplode() {
    _ensureCtx();
    const t = ctx.currentTime;
    _noise(t, 0.5, 0.9, 0.01, 800);
    _osc('sine', 90, t, 0.4, 0.7, 0.01);
    _osc('sine', 45, t + 0.05, 0.5, 0.5, 0.01);
  }

  /** Lava kills player: sizzle */
  function sfxLava() {
    _ensureCtx();
    const t = ctx.currentTime;
    _noise(t, 0.25, 0.7, 0.01, 1800);
    _osc('sine', 120, t, 0.3, 0.5, 0.01);
  }

  /** Stalagmite warning: sharp crack + deep rumble — something is about to fall */
  function sfxStalagmiteWarning() {
    _ensureCtx();
    const t = ctx.currentTime;
    // Deep stone-crack rumble (loud)
    _noise(t, 0.25, 1.1, 0.01, 260);
    _osc('sine', 80, t, 0.30, 0.9, 0.01);
    _osc('sine', 55, t + 0.02, 0.28, 0.7, 0.01);
    // Sharp initial crack transient
    _noise(t, 0.05, 1.3, 0.01, 1200);
    // Urgent high-pitched drip ticks
    _osc('triangle', 1600, t + 0.04, 0.07, 0.8, 0.01);
    _osc('triangle', 1200, t + 0.09, 0.07, 0.65, 0.01);
    _osc('triangle', 900,  t + 0.14, 0.06, 0.5, 0.01);
  }

  /** Double-jump air puff */
  function sfxDoubleJump() {
    _ensureCtx();
    const t = ctx.currentTime;
    _osc('sine', 380, t, 0.12, 0.4, 0.01);
    _noise(t, 0.08, 0.25, 0.01, 3500);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  return {
    loadMusic,
    startMusic,
    stopMusic,
    fadeOutMusic,
    toggleMute,
    setMuted,
    isMuted,

    sfxJump,
    sfxDoubleJump,
    sfxEnemyKill,
    sfxShoot,
    sfxBulletHit,
    sfxLoseLife,
    sfxCollectFirefly,
    sfxCollectPowerup,
    sfxExtraLife,
    sfxLevelComplete,
    sfxGameOver,
    sfxCounterTick,
    sfxCounterExplode,
    sfxLava,
    sfxStalagmiteWarning,
  };
})();

window.SoundManager = SoundManager;
