/*
 * Судоку — логика интерфейса.
 * Полностью офлайн, прогресс хранится в localStorage.
 */
(function () {
  'use strict';

  const E = window.SudokuEngine;
  const S = window.SudokuSound;
  const $ = (s) => document.querySelector(s);
  const KEY = 'calm-sudoku:v1';
  const MAX_SAVED_GAMES = 30;

  // Цель по времени (сек) и награда за решение без подсказок
  const LEVELS = {
    1: { name: 'Лёгкий',    target: 5 * 60,  reward: 1 },
    2: { name: 'Простой',   target: 8 * 60,  reward: 1 },
    3: { name: 'Средний',   target: 12 * 60, reward: 1 },
    4: { name: 'Сложный',   target: 18 * 60, reward: 2 },
    5: { name: 'Мастер',    target: 25 * 60, reward: 3 },
  };

  // ---------- Хранилище ----------
  function freshStore() {
    const progress = {};
    for (let d = 1; d <= 5; d++) progress[d] = { current: 1, completed: [], best: null, solved: 0, totalTime: 0 };
    return {
      v: 1,
      hints: 3,
      earnedTotal: 0,
      streak: 0,
      bestStreak: 0,
      difficulty: 1,
      theme: 'auto',
      sound: true,
      autoFill: true,
      highlightSame: true,
      highlightPeers: true,
      progress,
      games: {},
    };
  }

  function loadStore() {
    const base = freshStore();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const s = JSON.parse(raw);
      const merged = Object.assign(base, s);
      merged.progress = Object.assign(freshStore().progress, s.progress || {});
      for (let d = 1; d <= 5; d++) {
        merged.progress[d] = Object.assign({ current: 1, completed: [], best: null, solved: 0, totalTime: 0 }, merged.progress[d]);
      }
      merged.games = merged.games || {};
      return merged;
    } catch (e) {
      return base;
    }
  }

  let store = loadStore();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* хранилище недоступно */ }
  }

  // ---------- Утилиты ----------
  function fmt(totalSec) {
    totalSec = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const ss = String(s).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  const hintWord = (n) => plural(n, 'подсказка', 'подсказки', 'подсказок');

  const isCompleted = (d, l) => store.progress[d].completed.indexOf(l) !== -1;
  const gameKey = (d, l) => d + ':' + l;
  const isPeer = (a, b) => E.ROW[a] === E.ROW[b] || E.COL[a] === E.COL[b] || E.BOX[a] === E.BOX[b];

  // ---------- Состояние ----------
  let G = null;            // текущая партия
  let viewD = store.difficulty;
  let viewL = store.progress[viewD].current;
  let selected = -1;
  let notesMode = false;
  let paused = false;
  let loading = false;
  let loadToken = 0;
  let autoFilling = false;
  let autoFillToken = 0;
  let hintArmedUntil = 0;
  const pulse = new Set();
  const fresh = new Set();

  // ---------- DOM ----------
  const boardEl = $('#board');
  const boardWrap = $('#boardWrap');
  const padEl = $('#pad');
  const cells = [];
  const keys = [];

  function buildBoard() {
    const boxes = [];
    for (let b = 0; b < 9; b++) {
      const box = document.createElement('div');
      box.className = 'box';
      boxes.push(box);
      boardEl.appendChild(box);
    }
    for (let k = 0; k < 81; k++) {
      // порядок внутри блока
      const b = Math.floor(k / 9), p = k % 9;
      const r = Math.floor(b / 3) * 3 + Math.floor(p / 3);
      const c = (b % 3) * 3 + (p % 3);
      const i = r * 9 + c;
      const el = document.createElement('div');
      el.className = 'cell';
      el.setAttribute('role', 'gridcell');
      el.dataset.i = i;
      const v = document.createElement('span');
      v.className = 'v';
      const notes = document.createElement('div');
      notes.className = 'notes';
      const ns = [];
      for (let n = 0; n < 9; n++) {
        const s = document.createElement('span');
        notes.appendChild(s);
        ns.push(s);
      }
      el.appendChild(v);
      el.appendChild(notes);
      el._v = v;
      el._n = ns;
      cells[i] = el;
      boxes[b].appendChild(el);
    }
  }

  function buildPad() {
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.dataset.d = d;
      b.setAttribute('aria-label', 'Цифра ' + d);
      b.innerHTML = '<span class="d">' + d + '</span><span class="rem"></span>';
      padEl.appendChild(b);
      keys.push(b);
    }
  }

  function buildDiff() {
    const wrap = $('#diffBars');
    for (let d = 1; d <= 5; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'diff-bar';
      b.dataset.d = d;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Сложность ' + d + ' — ' + LEVELS[d].name);
      let meter = '<span class="meter">';
      for (let k = 1; k <= 5; k++) meter += '<b class="' + (k <= d ? 'on' : '') + '" style="height:' + (4 + k * 2) + 'px"></b>';
      meter += '</span>';
      b.innerHTML = meter + '<span class="num">' + d + '</span>';
      wrap.appendChild(b);
    }
  }

  function buildTargets() {
    const t = $('#targetsTable');
    let html = '';
    for (let d = 1; d <= 5; d++) {
      const L = LEVELS[d];
      html += '<div><span class="n">' + d + '</span><span>' + L.name + '</span><span class="t">до ' + fmt(L.target) +
        '</span><span class="r">+' + L.reward + '</span></div>';
    }
    t.innerHTML = html;
  }

  // ---------- Загрузка уровня ----------
  function loadLevel(d, l) {
    if (G && !G.solved) persistGame();
    d = Math.min(5, Math.max(1, d));
    l = Math.max(1, l);
    viewD = d; viewL = l;
    store.difficulty = d;
    store.progress[d].current = l;
    save();

    G = null;
    selected = -1;
    paused = false;
    loading = true;
    autoFilling = false;
    autoFillToken++;
    hintArmedUntil = 0;
    boardWrap.classList.remove('is-appear');
    boardWrap.classList.add('is-loading');
    render();

    const token = ++loadToken;
    setTimeout(() => {
      if (token !== loadToken) return;
      const saved = store.games[gameKey(d, l)];
      let puzzle, solution, values, notes, hinted, elapsed = 0, used = 0, mistakes = 0;
      if (saved && saved.p && saved.p.length === 81 && saved.s && saved.v) {
        puzzle = Array.from(saved.p, Number);
        solution = Array.from(saved.s, Number);
        values = Array.from(saved.v, Number);
        notes = saved.n || new Array(81).fill(0);
        hinted = saved.h || [];
        elapsed = saved.t || 0;
        used = saved.u || 0;
        mistakes = saved.m || 0;
      } else {
        const res = E.generate(d, l);
        puzzle = res.puzzle;
        solution = res.solution;
        values = puzzle.slice();
        notes = new Array(81).fill(0);
        hinted = [];
      }
      G = {
        d, l, puzzle, solution, values,
        notes: Uint16Array.from(notes),
        given: puzzle.map((v) => v > 0),
        hinted: new Set(hinted),
        elapsed,
        hintsUsed: used,
        mistakes,
        history: [],
        solved: false,
        lost: false,
        replay: isCompleted(d, l),
      };
      loading = false;
      boardWrap.classList.remove('is-loading');
      void boardWrap.offsetWidth;
      boardWrap.classList.add('is-appear');
      render();
    }, 60);
  }

  function persistGame() {
    if (!G || G.solved) return;
    const touched = G.values.some((v, i) => v !== G.puzzle[i]) || G.notes.some((n) => n) || G.elapsed > 3000;
    const key = gameKey(G.d, G.l);
    if (!touched) { delete store.games[key]; save(); return; }
    store.games[key] = {
      p: G.puzzle.join(''),
      s: G.solution.join(''),
      v: G.values.join(''),
      n: Array.from(G.notes),
      h: Array.from(G.hinted),
      t: Math.round(G.elapsed),
      u: G.hintsUsed,
      m: G.mistakes || 0,
      at: Date.now(),
    };
    const ks = Object.keys(store.games);
    if (ks.length > MAX_SAVED_GAMES) {
      ks.sort((a, b) => (store.games[a].at || 0) - (store.games[b].at || 0));
      ks.slice(0, ks.length - MAX_SAVED_GAMES).forEach((k) => delete store.games[k]);
    }
    save();
  }

  // ---------- Отрисовка ----------
  function computeConflicts() {
    const bad = new Uint8Array(81);
    for (const unit of E.UNITS) {
      const seen = new Array(10).fill(-1);
      for (const i of unit) {
        const v = G.values[i];
        if (!v) continue;
        if (seen[v] >= 0) { bad[i] = 1; bad[seen[v]] = 1; }
        else seen[v] = i;
      }
    }
    return bad;
  }

  function renderBoard() {
    const conflicts = G ? computeConflicts() : null;
    const selV = G && selected >= 0 ? G.values[selected] : 0;

    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      if (!G) {
        if (el.className !== 'cell') el.className = 'cell';
        if (el._v.textContent) el._v.textContent = '';
        for (const s of el._n) if (s.textContent) { s.textContent = ''; s.className = ''; }
        continue;
      }
      const v = G.values[i];
      let c = 'cell';
      if (G.given[i]) c += ' is-given';
      else if (G.hinted.has(i)) c += ' is-hinted';
      else if (v) c += ' is-user';

      if (!G.solved) {
        if (i === selected) c += ' is-selected';
        else if (selected >= 0 && store.highlightPeers) {
          const sameR = E.ROW[i] === E.ROW[selected];
          const sameC = E.COL[i] === E.COL[selected];
          const sameB = E.BOX[i] === E.BOX[selected];
          if (sameR) c += ' is-row';
          if (sameC) c += ' is-col';
          if (sameR || sameC) c += ' is-line';
          else if (sameB) c += ' is-box';
        }
        if (store.highlightSame && selV && v === selV && i !== selected) c += ' is-same';
        if (v && conflicts[i]) c += ' is-conflict';
      } else c += ' is-solved';

      if (pulse.has(i)) c += ' is-pulse';
      if (fresh.has(i)) c += ' is-new';
      if (el.className !== c) el.className = c;

      const txt = v ? String(v) : '';
      if (el._v.textContent !== txt) el._v.textContent = txt;

      const nm = v ? 0 : G.notes[i];
      for (let k = 0; k < 9; k++) {
        const on = nm & (1 << k);
        const s = el._n[k];
        const t = on ? String(k + 1) : '';
        if (s.textContent !== t) s.textContent = t;
        const hl = on && store.highlightSame && selV === k + 1 ? 'hl' : '';
        if (s.className !== hl) s.className = hl;
      }
    }
  }

  function renderPad() {
    const counts = new Array(10).fill(0);
    if (G) for (const v of G.values) counts[v]++;
    const selV = G && selected >= 0 ? G.values[selected] : 0;
    padEl.classList.toggle('is-notes', notesMode);
    keys.forEach((b, idx) => {
      const d = idx + 1;
      const rem = 9 - counts[d];
      b.classList.toggle('is-done', !!G && rem <= 0);
      b.classList.toggle('is-active', !!selV && selV === d && store.highlightSame);
      const t = G && rem > 0 ? String(rem) : '';
      const r = b.lastChild;
      if (r.textContent !== t) r.textContent = t;
    });
  }

  function renderChrome() {
    const L = LEVELS[viewD];
    $('#diffName').textContent = L.name;
    document.querySelectorAll('.diff-bar').forEach((b) => {
      const on = Number(b.dataset.d) === viewD;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('#levelNum').textContent = viewL;
    $('#levelNum').parentElement.classList.toggle('is-done', isCompleted(viewD, viewL));
    $('#prevLvl').disabled = viewL <= 1;
    $('#bankCount').textContent = store.hints;

    const m = G ? (G.mistakes || 0) : 0;
    const mEl = $('#mistakes');
    mEl.setAttribute('aria-label', 'Ошибки: ' + m + ' из 3');
    Array.from(mEl.children).forEach((dot, idx) => dot.classList.toggle('on', idx < m));

    const timerBtn = $('#timerBtn');
    timerBtn.classList.toggle('is-paused', paused);
    timerBtn.title = paused ? 'Продолжить (P)' : 'Пауза (P)';
    $('#timer').textContent = fmt(G ? G.elapsed / 1000 : 0);
    boardWrap.classList.toggle('is-paused', paused && !!G && !G.solved);
  }

  function renderTools() {
    const notesBtn = $('#notesBtn');
    notesBtn.classList.toggle('is-on', notesMode);
    notesBtn.setAttribute('aria-pressed', notesMode ? 'true' : 'false');
    $('#notesBadge').textContent = notesMode ? 'вкл' : 'выкл';

    const hintBtn = $('#hintBtn');
    $('#hintBadge').textContent = store.hints;
    hintBtn.classList.toggle('is-empty', store.hints <= 0);
    hintBtn.classList.toggle('is-armed', hintArmedUntil > Date.now());

    const playing = !!G && !G.solved && !loading && !autoFilling;
    $('#eraseBtn').disabled = !playing;
    hintBtn.disabled = !playing;
    notesBtn.disabled = !playing;
  }

  function rewardOpen() {
    return G && !G.solved && !G.replay && G.hintsUsed === 0 && G.elapsed / 1000 <= LEVELS[G.d].target;
  }

  function renderGoal() {
    const goal = $('#goal');
    const text = $('#goalText');
    const reward = $('#goalReward');
    const fill = $('#goalFill');
    const L = LEVELS[viewD];
    const rw = '+' + L.reward + ' ' + hintWord(L.reward);

    if (!G) {
      fill.style.transform = 'scaleX(0)';
      text.textContent = 'Готовим поле…';
      reward.textContent = '';
      goal.classList.remove('is-off');
      return;
    }

    const secs = G.elapsed / 1000;
    fill.style.transform = 'scaleX(' + Math.min(1, secs / L.target).toFixed(4) + ')';
    reward.textContent = rw;
    let off = false;

    if (G.solved) {
      text.textContent = 'Решено';
      off = true;
    } else if (G.replay) {
      text.textContent = 'Повторный уровень';
      off = true;
    } else if (G.hintsUsed > 0) {
      text.textContent = 'Без награды (подсказка)';
      off = true;
    } else if (secs <= L.target) {
      text.innerHTML = 'Цель <b>' + fmt(L.target) + '</b> · осталось ' + fmt(L.target - secs);
    } else {
      text.textContent = 'Время для награды вышло';
      off = true;
    }
    goal.classList.toggle('is-off', off);
  }

  function render() {
    renderChrome();
    renderBoard();
    renderPad();
    renderTools();
    renderGoal();
  }

  // ---------- Действия ----------
  function canEdit() {
    return G && !G.solved && !paused && !loading && !autoFilling;
  }

  function mutate(fn) {
    const snap = new Map();
    const rec = (i) => { if (!snap.has(i)) snap.set(i, { i, v: G.values[i], n: G.notes[i] }); };
    fn(rec);
    const changes = [];
    snap.forEach((c) => { if (c.v !== G.values[c.i] || c.n !== G.notes[c.i]) changes.push(c); });
    if (changes.length) {
      G.history.push(changes);
      if (G.history.length > 500) G.history.shift();
    }
    return changes.length > 0;
  }

  function nudge(i) {
    const el = cells[i];
    el.classList.remove('is-nudge');
    void el.offsetWidth;
    el.classList.add('is-nudge');
    S.error();
    setTimeout(() => el.classList.remove('is-nudge'), 400);
  }

  function markFresh(i) {
    fresh.add(i);
    setTimeout(() => { fresh.delete(i); renderBoard(); }, 320);
  }

  function addPulse(i, delay) {
    cells[i].style.setProperty('--d', delay + 'ms');
    pulse.add(i);
    setTimeout(() => { pulse.delete(i); renderBoard(); }, delay + 900);
  }

  function celebrateUnits(i) {
    const r0 = E.ROW[i], c0 = E.COL[i];
    let hit = false;
    for (const unit of E.UNITS) {
      if (unit.indexOf(i) === -1) continue;
      if (unit.every((j) => G.values[j] === G.solution[j])) {
        hit = true;
        for (const j of unit) addPulse(j, (Math.abs(E.ROW[j] - r0) + Math.abs(E.COL[j] - c0)) * 45);
      }
    }
    if (hit) S.unit();
    return hit;
  }

  function input(d) {
    if (!canEdit()) return;
    if (selected < 0) { toast('Сначала выберите клетку'); return; }
    const i = selected;
    if (G.given[i] || G.hinted.has(i)) { nudge(i); return; }

    if (notesMode) {
      if (G.values[i]) { nudge(i); return; }
      mutate((rec) => { rec(i); G.notes[i] ^= 1 << (d - 1); });
      S.note();
    } else if (G.values[i] === d) {
      mutate((rec) => { rec(i); G.values[i] = 0; });
      S.erase();
    } else if (d !== G.solution[i]) {
      G.mistakes = (G.mistakes || 0) + 1;
      nudge(i);
      if (G.mistakes >= 3) {
        lose();
      } else {
        persistGame();
        renderChrome();
        const left = 3 - G.mistakes;
        toast('Ошибка · ' + plural(left, 'осталась', 'осталось', 'осталось') + ' ' + left + ' ' + plural(left, 'попытка', 'попытки', 'попыток'));
      }
      return;
    } else {
      const bit = 1 << (d - 1);
      mutate((rec) => {
        rec(i);
        G.values[i] = d;
        G.notes[i] = 0;
        for (const j of E.PEERS[i]) {
          if (!G.values[j] && (G.notes[j] & bit)) { rec(j); G.notes[j] &= ~bit; }
        }
      });
      markFresh(i);
      if (!celebrateUnits(i)) S.place(d);
    }
    afterChange();
  }

  function erase() {
    if (!canEdit() || selected < 0) return;
    const i = selected;
    if (G.given[i] || G.hinted.has(i)) { nudge(i); return; }
    const changed = mutate((rec) => {
      rec(i);
      if (G.values[i]) G.values[i] = 0;
      else G.notes[i] = 0;
    });
    if (changed) S.erase();
    afterChange();
  }

  function undo() {
    if (!canEdit() || !G.history.length) return;
    const changes = G.history.pop();
    for (const c of changes) {
      G.values[c.i] = c.v;
      G.notes[c.i] = c.n;
    }
    selected = changes[0].i;
    S.erase();
    afterChange();
  }

  function toggleNotes() {
    if (!G || G.solved || autoFilling) return;
    notesMode = !notesMode;
    S.select();
    render();
  }

  function candidates(i) {
    let used = 0;
    for (const j of E.PEERS[i]) if (G.values[j]) used |= 1 << (G.values[j] - 1);
    return ~used & 511;
  }

  function onHint() {
    if (!canEdit()) return;
    if (store.hints <= 0) {
      bumpBank();
      S.error();
      toast('Подсказок пока нет. Решите новый уровень без подсказок быстрее цели — и они появятся.');
      return;
    }
    const now = Date.now();
    if (rewardOpen() && hintArmedUntil < now) {
      hintArmedUntil = now + 3000;
      toast('Нажмите ещё раз, чтобы открыть клетку. Награда за эту партию станет недоступна.');
      renderTools();
      setTimeout(renderTools, 3050);
      return;
    }
    hintArmedUntil = 0;
    applyHint();
  }

  function applyHint() {
    let target = -1;
    if (selected >= 0 && !G.given[selected] && !G.hinted.has(selected) && G.values[selected] !== G.solution[selected]) {
      target = selected;
    }
    if (target < 0) {
      // Самая «очевидная» пустая клетка — с наименьшим числом кандидатов
      let best = 10;
      for (let i = 0; i < 81; i++) {
        if (G.values[i]) continue;
        const c = E.POP[candidates(i)];
        if (c < best) { best = c; target = i; }
      }
    }
    if (target < 0) {
      for (let i = 0; i < 81; i++) {
        if (!G.given[i] && G.values[i] !== G.solution[i]) { target = i; break; }
      }
    }
    if (target < 0) return;

    const d = G.solution[target];
    const bit = 1 << (d - 1);
    G.values[target] = d;
    G.notes[target] = 0;
    for (const j of E.PEERS[target]) if (!G.values[j]) G.notes[j] &= ~bit;
    G.hinted.add(target);
    G.history = G.history.map((ch) => ch.filter((c) => c.i !== target)).filter((ch) => ch.length);

    store.hints--;
    G.hintsUsed++;
    save();
    selected = target;
    markFresh(target);
    S.hint();
    celebrateUnits(target);
    afterChange();
  }

  // ---------- Автозаполнение очевидных клеток ----------
  function canAutoFill() {
    if (!store.autoFill || !G || G.solved || paused || autoFilling) return false;
    let empty = 0;
    let allNaked = true;
    for (let i = 0; i < 81; i++) {
      const v = G.values[i];
      if (!v) {
        empty++;
        if (E.POP[candidates(i)] !== 1) allNaked = false;
      } else if (v !== G.solution[i]) {
        return false; // есть ошибка — не автозаполняем
      }
    }
    if (empty === 0) return false;
    if (allNaked && empty <= 20) return true;
    return empty <= 12 && E.solvableBySingles(G.values);
  }

  function runAutoFill() {
    autoFilling = true;
    const token = ++autoFillToken;
    selected = -1;
    render();
    toast('Всё очевидно — завершаем…');

    function step() {
      if (token !== autoFillToken || !G || G.solved) {
        autoFilling = false;
        return;
      }
      // Ищем клетку с наименьшим числом кандидатов (1 — голая одиночка)
      let target = -1, best = 10;
      for (let i = 0; i < 81; i++) {
        if (G.values[i]) continue;
        const c = E.POP[candidates(i)];
        if (c < best) { best = c; target = i; if (c <= 1) break; }
      }
      if (target < 0) {
        autoFilling = false;
        win();
        return;
      }
      const d = G.solution[target];
      const bit = 1 << (d - 1);
      G.values[target] = d;
      G.notes[target] = 0;
      for (const j of E.PEERS[target]) if (!G.values[j]) G.notes[j] &= ~bit;
      markFresh(target);
      S.place(d);
      renderBoard();
      renderPad();
      setTimeout(step, 55);
    }

    setTimeout(step, 180);
  }

  function afterChange() {
    persistGame();
    render();
    if (checkComplete()) return;
    if (canAutoFill()) runAutoFill();
  }

  function checkComplete() {
    if (!G || G.solved) return false;
    for (let i = 0; i < 81; i++) if (!G.values[i]) return false;
    win();
    return true;
  }

  function lose() {
    const L = LEVELS[G.d];
    const secs = Math.round(G.elapsed / 1000);
    G.solved = true;
    G.lost = true;
    autoFilling = false;
    selected = -1;
    notesMode = false;
    store.streak = 0;
    delete store.games[gameKey(G.d, G.l)];
    save();
    render();

    $('#winEyebrow').textContent = 'Уровень ' + G.l + ' · ' + L.name;
    $('#winTitle').textContent = 'Игра проиграна';
    $('#winTime').textContent = fmt(secs);
    $('#winTime').classList.add('is-lost');
    const box = $('#winReward');
    box.classList.remove('is-earned');
    box.textContent = 'Допущено 3 ошибки. Попробуйте пройти этот уровень заново.';
    $('#winBest').innerHTML = '';
    $('#winNext').textContent = 'Начать заново';
    openSheet('winSheet');
  }

  function win() {
    const L = LEVELS[G.d];
    const secs = Math.round(G.elapsed / 1000);
    G.solved = true;
    autoFilling = false;
    selected = -1;
    notesMode = false;

    const eligible = !G.replay && G.hintsUsed === 0;
    const earned = eligible && secs <= L.target ? L.reward : 0;
    const p = store.progress[G.d];
    if (!isCompleted(G.d, G.l)) p.completed.push(G.l);
    p.solved++;
    p.totalTime = (p.totalTime || 0) + secs;
    if (G.hintsUsed === 0) {
      store.streak = (store.streak || 0) + 1;
      if (store.streak > (store.bestStreak || 0)) store.bestStreak = store.streak;
    } else {
      store.streak = 0;
    }
    let newBest = false;
    if (G.hintsUsed === 0 && (p.best == null || secs < p.best)) { newBest = p.best != null; p.best = secs; }
    store.hints += earned;
    store.earnedTotal += earned;
    p.current = G.l + 1;
    delete store.games[gameKey(G.d, G.l)];
    save();

    S.win();
    for (let i = 0; i < 81; i++) addPulse(i, (E.ROW[i] + E.COL[i]) * 40);
    render();

    setTimeout(() => showWin({ secs, earned, L, newBest, best: p.best }), 1000);
  }

  function showWin(r) {
    $('#winEyebrow').textContent = 'Уровень ' + G.l + ' · ' + r.L.name;
    $('#winTitle').textContent = r.earned ? 'Отлично' : 'Решено';
    $('#winTime').textContent = fmt(r.secs);
    $('#winTime').classList.remove('is-lost');
    $('#winNext').textContent = 'Следующий уровень';
    const box = $('#winReward');
    box.classList.toggle('is-earned', r.earned > 0);
    if (r.earned) {
      box.innerHTML = '<strong><svg class="ic"><use href="#i-bulb"/></svg>+' + r.earned + ' ' + hintWord(r.earned) +
        '</strong>Вы уложились в ' + fmt(r.L.target) + ' без подсказок. Теперь в запасе: ' + store.hints + '.';
      bankGain();
    } else if (G.replay) {
      box.textContent = 'Этот уровень уже был пройден раньше, поэтому награда не начисляется.';
    } else if (G.hintsUsed) {
      box.textContent = 'В этой партии использовалась подсказка. Решите следующий уровень сами — и получите награду.';
    } else {
      box.textContent = 'Цель для награды была ' + fmt(r.L.target) + '. В следующий раз обязательно получится.';
    }
    $('#winBest').innerHTML = r.best != null
      ? 'Лучшее время: ' + fmt(r.best) + (r.newBest ? '<span class="tag">рекорд</span>' : '')
      : '';
    openSheet('winSheet');
    renderChrome();
  }

  // ---------- Выбор и навигация ----------
  function select(i) {
    if (!G || G.solved || paused || autoFilling) return;
    if (selected !== i) S.select();
    selected = i;
    renderBoard();
    renderPad();
  }

  function move(dr, dc) {
    if (!G || G.solved || paused) return;
    if (selected < 0) { select(40); return; }
    const r = (E.ROW[selected] + dr + 9) % 9;
    const c = (E.COL[selected] + dc + 9) % 9;
    select(r * 9 + c);
  }

  function setPaused(p) {
    if (!G || G.solved) return;
    paused = p;
    if (p) persistGame();
    render();
  }

  // ---------- Шторки и тост ----------
  let openId = null;
  function openSheet(id) {
    if (openId) closeSheet();
    const s = document.getElementById(id);
    s.classList.add('is-open');
    s.setAttribute('aria-hidden', 'false');
    openId = id;
    const focusable = s.querySelector('.btn.primary') || s.querySelector('button');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 50);
  }
  function closeSheet() {
    if (!openId) return;
    const s = document.getElementById(openId);
    s.classList.remove('is-open');
    s.setAttribute('aria-hidden', 'true');
    openId = null;
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-show'), 2800);
  }

  function bumpBank() {
    const b = $('#bankBtn');
    b.classList.remove('is-bump', 'is-gain');
    void b.offsetWidth;
    b.classList.add('is-bump');
  }
  function bankGain() {
    const b = $('#bankBtn');
    b.classList.remove('is-bump', 'is-gain');
    void b.offsetWidth;
    b.classList.add('is-gain');
  }

  // ---------- Тема и настройки ----------
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = store.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : store.theme;
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#131514' : '#F2EFE9');
    document.querySelectorAll('#themeSeg button').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.themeVal === store.theme);
    });
  }
  if (mq.addEventListener) mq.addEventListener('change', applyTheme);

  function syncSettings() {
    $('#optSound').checked = store.sound !== false;
    $('#optAutoFill').checked = store.autoFill !== false;
    $('#optSame').checked = !!store.highlightSame;
    $('#optPeers').checked = !!store.highlightPeers;
    S.setEnabled(store.sound !== false);
    applyTheme();
  }

  let resetArmedUntil = 0;
  function renderStatsSheet() {
    let totalSolved = 0;
    let rowsHtml = '<div class="stats-row is-head"><span></span><span>Сложность</span><span class="v">Решено</span><span class="v">Лучшее</span><span class="v">Среднее</span></div>';
    for (let d = 1; d <= 5; d++) {
      const p = store.progress[d];
      totalSolved += p.solved || 0;
      const best = p.best != null ? fmt(p.best) : '—';
      const avg = p.solved && p.totalTime ? fmt(Math.round(p.totalTime / p.solved)) : '—';
      rowsHtml += '<div class="stats-row"><span class="n">' + d + '</span><span>' + LEVELS[d].name +
        '</span><span class="v">' + (p.solved || 0) + '</span><span class="v">' + best + '</span><span class="v">' + avg + '</span></div>';
    }
    const streakStr = (store.streak || 0) + (store.bestStreak ? ' / ' + store.bestStreak : '');
    $('#statsSummary').innerHTML =
      '<div class="stat-card"><strong>' + totalSolved + '</strong><span>Решено</span></div>' +
      '<div class="stat-card"><strong>' + (store.earnedTotal || 0) + '</strong><span>Заработано</span></div>' +
      '<div class="stat-card"><strong>' + streakStr + '</strong><span>Серия / макс</span></div>';
    $('#statsTable').innerHTML = rowsHtml;
    resetArmedUntil = 0;
    $('#resetStatsBtn').textContent = 'Сбросить статистику';
  }

  // ---------- События ----------
  function bind() {
    boardEl.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.cell');
      if (!c) return;
      e.preventDefault();
      select(Number(c.dataset.i));
    });
    boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

    padEl.addEventListener('click', (e) => {
      const k = e.target.closest('.key');
      if (k) input(Number(k.dataset.d));
    });

    $('#diffBars').addEventListener('click', (e) => {
      const b = e.target.closest('.diff-bar');
      if (!b) return;
      const d = Number(b.dataset.d);
      if (d === viewD && G) return;
      loadLevel(d, store.progress[d].current);
    });

    $('#prevLvl').addEventListener('click', () => { if (viewL > 1) loadLevel(viewD, viewL - 1); });
    $('#nextLvl').addEventListener('click', () => loadLevel(viewD, viewL + 1));

    $('#timerBtn').addEventListener('click', () => setPaused(!paused));
    $('#resumeBtn').addEventListener('click', () => setPaused(false));

    $('#eraseBtn').addEventListener('click', erase);
    $('#notesBtn').addEventListener('click', toggleNotes);
    $('#hintBtn').addEventListener('click', onHint);

    $('#bankBtn').addEventListener('click', () => openSheet('helpSheet'));
    $('#statsBtn').addEventListener('click', () => { renderStatsSheet(); openSheet('statsSheet'); });
    $('#helpBtn').addEventListener('click', () => openSheet('helpSheet'));
    $('#settingsBtn').addEventListener('click', () => { syncSettings(); openSheet('settingsSheet'); });

    document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));

    $('#winNext').addEventListener('click', () => {
      const lost = G && G.lost;
      closeSheet();
      loadLevel(viewD, lost ? viewL : viewL + 1);
    });

    $('#themeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      store.theme = b.dataset.themeVal;
      save();
      applyTheme();
    });
    $('#optSound').addEventListener('change', (e) => {
      store.sound = e.target.checked;
      S.setEnabled(store.sound);
      save();
      if (store.sound) S.select();
    });
    $('#optAutoFill').addEventListener('change', (e) => {
      store.autoFill = e.target.checked;
      save();
      if (store.autoFill && canAutoFill()) runAutoFill();
    });
    $('#optSame').addEventListener('change', (e) => { store.highlightSame = e.target.checked; save(); render(); });
    $('#optPeers').addEventListener('change', (e) => { store.highlightPeers = e.target.checked; save(); render(); });

    $('#resetStatsBtn').addEventListener('click', () => {
      const now = Date.now();
      if (resetArmedUntil < now) {
        resetArmedUntil = now + 3500;
        $('#resetStatsBtn').textContent = 'Нажмите ещё раз для сброса';
        setTimeout(() => {
          if (openId === 'statsSheet' && resetArmedUntil <= Date.now()) {
            $('#resetStatsBtn').textContent = 'Сбросить статистику';
          }
        }, 3600);
        return;
      }
      store.earnedTotal = 0;
      store.streak = 0;
      store.bestStreak = 0;
      for (let d = 1; d <= 5; d++) {
        store.progress[d].solved = 0;
        store.progress[d].best = null;
        store.progress[d].totalTime = 0;
        store.progress[d].completed = [];
      }
      save();
      renderStatsSheet();
      renderChrome();
      toast('Статистика сброшена');
    });

    $('#clearBoardBtn').addEventListener('click', () => {
      if (!canEdit()) { closeSheet(); return; }
      mutate((rec) => {
        for (let i = 0; i < 81; i++) {
          if (G.given[i] || G.hinted.has(i)) continue;
          if (G.values[i] || G.notes[i]) { rec(i); G.values[i] = 0; G.notes[i] = 0; }
        }
      });
      closeSheet();
      toast('Поле очищено');
      afterChange();
    });

    document.addEventListener('keydown', onKey);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && G && !G.solved && !paused) {
        paused = true;
        persistGame();
        render();
      }
    });
    window.addEventListener('pagehide', persistGame);
    window.addEventListener('beforeunload', persistGame);
  }

  function onKey(e) {
    if (openId) {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
      else if (e.key === 'Enter' && openId === 'winSheet') { e.preventDefault(); $('#winNext').click(); }
      return;
    }
    if (e.metaKey && e.code !== 'KeyZ') return;
    if (e.ctrlKey && e.code !== 'KeyZ') return;

    const code = e.code;
    let digit = 0;
    const m = /^(Digit|Numpad)([1-9])$/.exec(code);
    if (m) digit = Number(m[2]);

    if (digit) {
      e.preventDefault();
      if (e.shiftKey || e.altKey) {
        const prev = notesMode;
        notesMode = !prev;
        input(digit);
        notesMode = prev;
        render();
      } else input(digit);
      return;
    }

    switch (code) {
      case 'ArrowUp': case 'KeyW': e.preventDefault(); move(-1, 0); break;
      case 'ArrowDown': case 'KeyS': e.preventDefault(); move(1, 0); break;
      case 'ArrowLeft': case 'KeyA': e.preventDefault(); move(0, -1); break;
      case 'ArrowRight': case 'KeyD': e.preventDefault(); move(0, 1); break;
      case 'Backspace': case 'Delete': case 'Digit0': case 'Numpad0':
        e.preventDefault(); erase(); break;
      case 'KeyN': e.preventDefault(); toggleNotes(); break;
      case 'KeyH': e.preventDefault(); onHint(); break;
      case 'KeyP': case 'Space': e.preventDefault(); setPaused(!paused); break;
      case 'KeyM':
        e.preventDefault();
        store.sound = store.sound === false;
        S.setEnabled(store.sound);
        save();
        if (store.sound) S.select();
        toast(store.sound ? 'Звук включён' : 'Звук выключен');
        break;
      case 'Escape':
        if (paused) setPaused(false);
        else { selected = -1; renderBoard(); renderPad(); }
        break;
      default: break;
    }
  }

  // ---------- Таймер ----------
  let last = performance.now();
  let lastSave = 0;
  function tick() {
    const now = performance.now();
    const dt = Math.min(1000, now - last);
    last = now;
    if (G && !G.solved && !paused && !loading && !document.hidden && !openId) {
      G.elapsed += dt;
      $('#timer').textContent = fmt(G.elapsed / 1000);
      renderGoal();
      if (now - lastSave > 5000) { persistGame(); lastSave = now; }
    }
  }

  // ---------- Старт ----------
  buildBoard();
  buildPad();
  buildDiff();
  buildTargets();
  syncSettings();
  bind();
  loadLevel(viewD, viewL);
  setInterval(tick, 250);
})();
