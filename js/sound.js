/*
 * Мягкий нейтральный синтезатор звуков на Web Audio API.
 * Работает полностью офлайн, без внешних аудиофайлов.
 */
(function (root) {
  'use strict';

  const Ctx = root.AudioContext || root.webkitAudioContext;
  let ctx = null;
  let enabled = true;

  // Спокойный мягкий диапазон (Гц) без резких высоких частот
  const SCALE = [261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.0, 440.0];

  function ensureCtx() {
    if (!enabled || !Ctx) return null;
    if (!ctx) {
      try { ctx = new Ctx(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, opts) {
    const c = ensureCtx();
    if (!c) return;
    const o = opts || {};
    const now = c.currentTime + (o.delay || 0);
    const dur = o.dur || 0.09;
    const vol = o.vol || 0.032;
    const type = o.type || 'sine';

    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (o.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(o.slideTo, now + dur);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  const Sound = {
    setEnabled(val) {
      enabled = !!val;
    },
    isEnabled() {
      return enabled;
    },
    select() {
      tone(210, { dur: 0.026, vol: 0.014, type: 'sine', slideTo: 165 });
    },
    place(digit) {
      const f = SCALE[((digit || 1) - 1) % SCALE.length];
      tone(f, { dur: 0.085, vol: 0.032, type: 'sine', slideTo: f * 0.992 });
    },
    note() {
      tone(420, { dur: 0.034, vol: 0.016, type: 'sine', slideTo: 450 });
    },
    erase() {
      tone(195, { dur: 0.06, vol: 0.022, type: 'sine', slideTo: 140 });
    },
    error() {
      tone(155, { dur: 0.07, vol: 0.028, type: 'sine' });
      tone(132, { dur: 0.09, vol: 0.025, type: 'sine', delay: 0.06 });
    },
    hint() {
      tone(392.0, { dur: 0.14, vol: 0.03, type: 'sine' });
      tone(523.25, { dur: 0.2, vol: 0.032, type: 'sine', delay: 0.07 });
    },
    unit() {
      tone(392.0, { dur: 0.13, vol: 0.026, type: 'sine' });
      tone(493.88, { dur: 0.2, vol: 0.028, type: 'sine', delay: 0.065 });
    },
    win() {
      // Тёплая победная фанфара с финальным аккордом
      const seq = [
        { f: 392.0,  d: 0.00, dur: 0.16, vol: 0.034 }, // G4
        { f: 523.25, d: 0.09, dur: 0.16, vol: 0.036 }, // C5
        { f: 659.25, d: 0.18, dur: 0.18, vol: 0.036 }, // E5
        { f: 783.99, d: 0.28, dur: 0.55, vol: 0.040 }, // G5
        { f: 523.25, d: 0.28, dur: 0.55, vol: 0.024 }, // C5 (аккорд)
        { f: 659.25, d: 0.28, dur: 0.55, vol: 0.024 }, // E5 (аккорд)
      ];
      seq.forEach((n) => tone(n.f, { delay: n.d, dur: n.dur, vol: n.vol, type: 'sine' }));
    },
  };

  root.SudokuSound = Sound;
})(window);
