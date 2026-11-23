/*
 * Движок судоку: детерминированная генерация бесконечного числа уровней,
 * проверка единственности решения и оценка сложности.
 * Один и тот же (сложность, номер уровня) всегда даёт одну и ту же головоломку.
 */
(function (root) {
  'use strict';

  // ---------- Таблицы ----------
  const POP = new Uint8Array(512);
  for (let i = 1; i < 512; i++) POP[i] = POP[i >> 1] + (i & 1);

  const ROW = new Uint8Array(81);
  const COL = new Uint8Array(81);
  const BOX = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
  }

  const UNITS = [];
  for (let u = 0; u < 9; u++) {
    const r = [], c = [], b = [];
    for (let k = 0; k < 9; k++) {
      r.push(u * 9 + k);
      c.push(k * 9 + u);
      b.push((((u / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + (u % 3) * 3 + (k % 3));
    }
    UNITS.push(r, c, b);
  }

  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    const p = [];
    for (let j = 0; j < 81; j++) {
      if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) p.push(j);
    }
    PEERS.push(p);
  }

  // ---------- Случайность с зерном ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFor(difficulty, level, attempt) {
    const s = 'calm-sudoku/' + difficulty + '/' + level + '/' + (attempt || 0);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildMasks(g) {
    const rows = new Uint16Array(9), cols = new Uint16Array(9), boxes = new Uint16Array(9);
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      const b = 1 << (g[i] - 1);
      if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return null;
      rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
    }
    return { rows, cols, boxes };
  }

  // ---------- Подсчёт решений (до limit) ----------
  function countSolutions(grid, limit) {
    limit = limit || 2;
    const g = Array.from(grid);
    const m = buildMasks(g);
    if (!m) return 0;
    const { rows, cols, boxes } = m;
    let count = 0;

    (function rec() {
      let best = -1, bm = 0, bc = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const mask = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & 511;
        const c = POP[mask];
        if (c < bc) { bc = c; bm = mask; best = i; if (c <= 1) break; }
      }
      if (best < 0) { count++; return count >= limit; }
      if (bc === 0) return false;
      const r = ROW[best], c = COL[best], b = BOX[best];
      let mask = bm;
      while (mask) {
        const bit = mask & -mask; mask ^= bit;
        rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; g[best] = 1;
        if (rec()) return true;
        rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit;
      }
      g[best] = 0;
      return false;
    })();

    return count;
  }

  // ---------- Случайное полное решение ----------
  function randomSolution(rng) {
    const g = new Array(81).fill(0);
    const rows = new Uint16Array(9), cols = new Uint16Array(9), boxes = new Uint16Array(9);

    (function rec() {
      let best = -1, bm = 0, bc = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const mask = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & 511;
        const c = POP[mask];
        if (c < bc) { bc = c; bm = mask; best = i; if (c <= 1) break; }
      }
      if (best < 0) return true;
      if (bc === 0) return false;
      const digits = [];
      for (let d = 1; d <= 9; d++) if (bm & (1 << (d - 1))) digits.push(d);
      shuffle(digits, rng);
      const r = ROW[best], c = COL[best], b = BOX[best];
      for (const d of digits) {
        const bit = 1 << (d - 1);
        rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; g[best] = d;
        if (rec()) return true;
        rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit;
      }
      g[best] = 0;
      return false;
    })();

    return g;
  }

  // ---------- Решаемость «одиночками» (лёгкая логика) ----------
  function solvableBySingles(puzzle) {
    const g = Array.from(puzzle);
    const m = buildMasks(g);
    if (!m) return false;
    const { rows, cols, boxes } = m;
    let remaining = 0;
    for (let i = 0; i < 81; i++) if (!g[i]) remaining++;

    const place = (i, d) => {
      const bit = 1 << (d - 1);
      g[i] = d; rows[ROW[i]] |= bit; cols[COL[i]] |= bit; boxes[BOX[i]] |= bit;
      remaining--;
    };
    const cand = (i) => ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & 511;

    while (remaining > 0) {
      let progress = false;

      // Голые одиночки
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const c = cand(i);
        if (c === 0) return false;
        if (POP[c] === 1) { place(i, 32 - Math.clz32(c)); progress = true; }
      }

      // Скрытые одиночки
      if (!progress) {
        for (const unit of UNITS) {
          let placed = 0;
          for (const i of unit) if (g[i]) placed |= 1 << (g[i] - 1);
          for (let d = 1; d <= 9; d++) {
            const bit = 1 << (d - 1);
            if (placed & bit) continue;
            let spot = -1, n = 0;
            for (const i of unit) {
              if (!g[i] && (cand(i) & bit)) { spot = i; n++; if (n > 1) break; }
            }
            if (n === 0) return false;
            if (n === 1) { place(spot, d); placed |= bit; progress = true; }
          }
        }
      }

      if (!progress) return false;
    }
    return true;
  }

  // ---------- Генерация ----------
  // target — к какому числу подсказок стремимся; singles — требовать решаемость простой логикой;
  // hard — стремиться к головоломкам, которые простой логикой не решаются.
  const CONFIG = {
    1: { target: 40, singles: true,  attempts: 1 },
    2: { target: 32, singles: true,  attempts: 1 },
    3: { target: 28, singles: false, attempts: 1 },
    4: { target: 25, singles: false, attempts: 3, hard: true },
    5: { target: 0,  singles: false, attempts: 5, hard: true, minimal: true },
  };

  function carve(difficulty, level, attempt) {
    const conf = CONFIG[difficulty];
    const rng = mulberry32(seedFor(difficulty, level, attempt));
    const solution = randomSolution(rng);
    const puzzle = solution.slice();
    let clues = 81;

    // Симметричное удаление парами — выглядит аккуратнее
    const order = [];
    for (let i = 0; i <= 40; i++) order.push(i);
    shuffle(order, rng);

    for (const i of order) {
      if (clues <= conf.target) break;
      const j = 80 - i;
      const vi = puzzle[i], vj = puzzle[j];
      puzzle[i] = 0; puzzle[j] = 0;
      let ok = countSolutions(puzzle, 2) === 1;
      if (ok && conf.singles) ok = solvableBySingles(puzzle);
      if (ok) clues -= (i === j ? 1 : 2);
      else { puzzle[i] = vi; puzzle[j] = vj; }
    }

    if (conf.minimal) {
      const singles = shuffle(Array.from({ length: 81 }, (_, k) => k), rng);
      for (const i of singles) {
        if (!puzzle[i]) continue;
        const v = puzzle[i];
        puzzle[i] = 0;
        if (countSolutions(puzzle, 2) === 1) clues--;
        else puzzle[i] = v;
      }
    }

    return { puzzle, solution, clues };
  }

  function generate(difficulty, level) {
    const d = Math.min(5, Math.max(1, difficulty | 0));
    const l = Math.max(1, level | 0);
    const conf = CONFIG[d];
    let best = null;
    for (let a = 0; a < conf.attempts; a++) {
      const res = carve(d, l, a);
      if (!conf.hard) return res;
      res.hard = !solvableBySingles(res.puzzle);
      const score = (res.hard ? 1000 : 0) - res.clues;
      if (!best || score > best.score) { best = res; best.score = score; }
      if (res.hard) break;
    }
    return best;
  }

  root.SudokuEngine = {
    ROW, COL, BOX, UNITS, PEERS, POP,
    generate, countSolutions, solvableBySingles,
  };
})(window);
