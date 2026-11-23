/*
 * Мягкий синтезатор звуков на Web Audio API.
 * Работает полностью офлайн, без внешних аудиофайлов.
 */
(function (root) {
  'use strict';

  const Ctx = root.AudioContext || root.webkitAudioContext;
  let ctx = null;
  let enabled = true;

  // Пентатоника (Гц) для цифр 1–9: звучит гармонично в любой последовательности
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];

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
    const dur = o.dur || 0.12;
    const vol = o.vol || 0.06;
    const type = o.type || 'sine';

    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (o.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(o.slideTo, now + dur);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.008);
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
      tone(320, { dur: 0.035, vol: 0.018, type: 'sine', slideTo: 240 });
    },
    place(digit) {
      const f = SCALE[((digit || 1) - 1) % SCALE.length];
      tone(f, { dur: 0.14, vol: 0.055, type: 'sine' });
      tone(f * 2, { dur: 0.07, vol: 0.014, type: 'triangle' });
    },
    note() {
      tone(740, { dur: 0.05, vol: 0.028, type: 'triangle', slideTo: 820 });
    },
    erase() {
      tone(280, { dur: 0.08, vol: 0.035, type: 'sine', slideTo: 180 });
    },
    error() {
      tone(196, { dur: 0.09, vol: 0.045, type: 'triangle' });
      tone(164.81, { dur: 0.12, vol: 0.04, type: 'triangle', delay: 0.07 });
    },
    hint() {
      tone(659.25, { dur: 0.18, vol: 0.05, type: 'sine' });
      tone(987.77, { dur: 0.24, vol: 0.045, type: 'sine', delay: 0.06 });
    },
    unit() {
      tone(523.25, { dur: 0.16, vol: 0.045, type: 'sine' });
      tone(783.99, { dur: 0.24, vol: 0.05, type: 'sine', delay: 0.07 });
    },
    win() {
      const notes = [523.25, 659.25, 783.99, 987.77, 1174.66];
      notes.forEach((f, idx) => {
        tone(f, { dur: 0.38, vol: 0.05, type: 'sine', delay: idx * 0.085 });
      });
    },
  };

  root.SudokuSound = Sound;
})(window);
