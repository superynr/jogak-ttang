/**
 * app.js — 조각땅 · 분수 밭 개척단
 * 지도(6×8 격자) + 문제 패널 + 넓이 모델(SVG). 게임 상태는 state 하나, 바뀔 때마다 localStorage 저장.
 * 문제 생성·채점·풀이는 fraction.js(전역 Fraction)를 그대로 쓴다.
 */
(function () {
  'use strict';

  const F = window.Fraction;

  /* ===================== 상수 (기획서 6장) ===================== */
  const SAVE_KEY = 'jogakttang_save_v1';
  const ROWS = 6, COLS = 8;
  const HOME = 5 * COLS + 0;                 // 왼쪽 아래 = 본진
  const TARGET = ROWS * COLS - 1;            // 되찾을 칸 47
  const BOSS_CELLS = { 0: 1, 3: 2, 6: 3 };   // 칸 번호 → 지역 (맨 윗줄 1열·4열·7열)
  const BOSS_HP = 5;
  const SPREAD_MAX = 3;                      // 번짐: 처음 칸 포함 최대 3칸
  const REVIEW_RATE = 1 / 3;                 // 새 문제 3개 중 1개꼴로 복습

  const REGION_TYPES = {
    1: ['pf_x_n', 'mf_x_n', 'n_x_pf', 'n_x_mf'],
    2: ['pf_x_n', 'mf_x_n', 'n_x_pf', 'n_x_mf', 'pf_x_pf'],
    3: ['pf_x_n', 'mf_x_n', 'n_x_pf', 'n_x_mf', 'pf_x_pf', 'mf_x_mf', 'triple'],
  };
  const BOSS_TYPE = { 1: 'mf_x_n', 2: 'pf_x_pf', 3: 'mf_x_mf' };
  const TYPE_ORDER = ['pf_x_n', 'mf_x_n', 'n_x_pf', 'n_x_mf', 'pf_x_pf', 'mf_x_mf', 'triple'];

  const FIELDS = ['whole', 'num', 'den'];
  const MAX_DIGITS = 3;
  const ANIM_BASE_MS = 600;                  // 넓이 모델 색칠 애니메이션 (패널 1번, 지도 칸마다 1번). 설정 '빠르게'면 절반
  const FLASH_MS = 500;                      // 정답 초록 배경

  /* ===================== 상태 ===================== */
  function regionOf(col) { return col < 2 ? 1 : col < 5 ? 2 : 3; }
  function rowOf(i) { return Math.floor(i / COLS); }
  function colOf(i) { return i % COLS; }

  function newGrid() {
    const grid = [];
    for (let i = 0; i < ROWS * COLS; i++) {
      const isBoss = BOSS_CELLS[i] !== undefined;
      grid.push({
        state: i === HOME ? 'home' : isBoss ? 'boss' : 'empty',   // empty | filling | ours | boss | home
        fillNum: i === HOME ? 1 : 0,      // 채워진 정도 = fillNum / fillDen (분수 그대로, 소수 금지)
        fillDen: 1,
        model: null,                      // 칸 안 넓이 모델 격자 {rows, cols}
        region: regionOf(colOf(i)),
        isBoss: isBoss,
      });
    }
    return grid;
  }

  function emptyInput() { return { whole: '', num: '', den: '' }; }

  function newState() {
    const now = Date.now();
    return {
      version: 1,
      startedAt: now,
      updatedAt: now,
      grid: newGrid(),
      boss: { 1: BOSS_HP, 2: BOSS_HP, 3: BOSS_HP },
      progress: newProgress(),                      // 지역별 현재 level과 연속 정답·오답 수 (기획서 8-1)
      finishedAt: null,                             // 47칸을 다 되찾은 시각
      stats: { solved: 0, correct: 0, byType: {} },
      review: [],                                   // 복습 보따리 (문제 객체)
      settings: { sound: true, animSpeed: 'normal', level: null, type: null, enabledTypes: TYPE_ORDER.slice() },
      flags: { openingSeen: false, howToSeen: false },
      // 화면 상태 (같이 저장하면 새로고침해도 풀던 문제가 남는다)
      ui: {
        selected: null,          // 고른 칸 번호
        problem: null,
        input: emptyInput(),
        focus: 'whole',
        phase: 'idle',           // idle | input | invalid | convert | correct | wrong
        lines: [],
        message: '',
        resultOpen: false,       // 결과 화면 열림
        convert: null,           // 가분수로 맞힌 뒤 대분수 고치기 단계: { target, note, invalid }
        canContinue: false,      // 정답 그림을 다 보여 준 뒤 '계속' 버튼 열림
      },
    };
  }

  function newProgress() {
    return {
      1: { level: 1, streakC: 0, streakW: 0 },
      2: { level: 2, streakC: 0, streakW: 0 },
      3: { level: 3, streakC: 0, streakW: 0 },
    };
  }

  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s || s.version !== 1 || !Array.isArray(s.grid) || s.grid.length !== ROWS * COLS) return null;
      if (!s.ui) s.ui = newState().ui;
      if (s.ui.phase === 'correct' || s.ui.phase === 'convert') { s.ui.phase = 'idle'; s.ui.selected = null; s.ui.problem = null; s.ui.convert = null; }
      s.ui.canContinue = false;
      if (s.ui.selected !== null && !s.ui.problem) { s.ui.selected = null; s.ui.phase = 'idle'; }
      s.grid.forEach(function (c) { if (c.model === undefined) c.model = null; });
      if (!s.progress) s.progress = newProgress();
      if (s.finishedAt === undefined) s.finishedAt = null;
      if (s.ui.resultOpen === undefined) s.ui.resultOpen = false;
      return s;
    } catch (e) { return null; }
  }

  let state = load() || newState();
  let flash = false;                 // 정답 초록 배경 (저장하지 않음)
  const pendingAnim = {};            // 칸 번호 → {from, offset}: 다음 그리기 때 새로 칠해진 조각을 애니메이션

  function commit() { save(); render(); }

  /** 색칠 애니메이션 한 단계 시간. 설정(기획서 5-8) '빠르게'면 절반 */
  function animMs() { return state.settings.animSpeed === 'fast' ? ANIM_BASE_MS / 2 : ANIM_BASE_MS; }

  /* ===================== 지도 규칙 ===================== */
  function neighbors(i) {
    const r = rowOf(i), c = colOf(i), out = [];
    if (r > 0) out.push(i - COLS);          // 위
    if (c < COLS - 1) out.push(i + 1);      // 오른쪽
    if (r < ROWS - 1) out.push(i + COLS);   // 아래
    if (c > 0) out.push(i - 1);             // 왼쪽
    return out;
  }
  function isOurs(cell) { return cell.state === 'ours' || cell.state === 'home'; }
  function isOpenLand(cell) { return cell.state === 'empty' || cell.state === 'filling'; }

  /** 그 지역의 일반 칸이 전부 우리 땅인가 (도깨비 칸 열림 조건) */
  function regionCleared(region) {
    return state.grid.every(function (cell) {
      return cell.region !== region || cell.isBoss || isOurs(cell);
    });
  }

  function canClick(i) {
    const cell = state.grid[i];
    if (cell.state === 'boss') return regionCleared(cell.region);
    if (!isOpenLand(cell)) return false;
    return neighbors(i).some(function (n) { return isOurs(state.grid[n]); });
  }

  function landCount() {
    return state.grid.filter(function (c) { return c.state === 'ours'; }).length;
  }

  /* 분수 도우미 (정수 연산만) */
  function addFrac(a, b) { return F.reduce({ num: a.num * b.den + b.num * a.den, den: a.den * b.den }); }
  function subOne(a) { return F.reduce({ num: a.num - a.den, den: a.den }); }
  function geOne(a) { return a.num >= a.den; }
  function fillOf(cell) { return { num: cell.fillNum, den: cell.fillDen }; }
  function ceilFrac(f) { return Math.ceil(f.num / f.den); }

  /** 분모 n을 정사각형에 가까운 rows×cols 격자로 (예: 12 → 3×4, 7 → 1×7) */
  function nearSquare(n) {
    for (let c = Math.ceil(Math.sqrt(n)); c <= n; c++) {
      if (n % c === 0) return { rows: n / c, cols: c };
    }
    return { rows: 1, cols: n };
  }

  /** 칸의 격자와 칠해진 조각 수. model 격자가 fill 분모로 나눠떨어지지 않으면 격자를 새로 만든다 */
  function cellModel(cell) {
    let m = cell.model;
    if (!m || (m.rows * m.cols) % cell.fillDen !== 0) m = nearSquare(cell.fillDen);
    const total = m.rows * m.cols;
    return { rows: m.rows, cols: m.cols, blockW: m.blockW || 0, shaded: cell.fillNum * (total / cell.fillDen) };
  }

  /**
   * 번질 칸 고르기 (기획서 6-4): 같은 지역의 빈 땅·채워지는 중 칸만.
   * 우선순위: 채워지는 중 → 위 → 오른쪽 → (아래 → 왼쪽)
   */
  function pickSpread(from) {
    const region = state.grid[from].region;
    const cands = neighbors(from).filter(function (n) {
      const c = state.grid[n];
      return c.region === region && isOpenLand(c);
    });
    if (!cands.length) return null;
    const filling = cands.find(function (n) { return state.grid[n].state === 'filling'; });
    return filling !== undefined ? filling : cands[0];   // neighbors()가 위→오른쪽→아래→왼쪽 순
  }

  /**
   * 정답 넓이를 칸에 색칠. 1을 넘으면 옆 칸으로 번짐(최대 SPREAD_MAX칸), 남는 넓이는 버림.
   * hint: 처음 칸이 비어 있을 때 쓸 격자 (분수×분수면 교과서 격자 그대로)
   * 반환 { taken: [점령한 칸], partial: 채워지는 중이 된 칸|null, wasted: 버린 넓이|null, steps }
   */
  function applyArea(start, area, hint) {
    const result = { taken: [], partial: null, wasted: null, steps: 0 };
    let idx = start, rem = F.reduce(area);
    while (idx !== null && result.steps < SPREAD_MAX && rem.num > 0) {
      const cell = state.grid[idx];
      const before = fillOf(cell);
      const total = addFrac(before, rem);
      result.steps++;

      let after;
      if (geOne(total)) {
        after = { num: 1, den: 1 };
        cell.state = 'ours';
        result.taken.push(idx);
        rem = subOne(total);
      } else {
        after = total;
        cell.state = 'filling';
        result.partial = idx;
        rem = { num: 0, den: 1 };
      }
      cell.fillNum = after.num; cell.fillDen = after.den;

      // 격자: 처음 칠하는 칸이면 새 격자, 이미 격자가 있는데 안 나눠떨어지면 새 격자
      if (before.num === 0) cell.model = (result.steps === 1 && hint) ? hint : nearSquare(after.den);
      else if (!cell.model || (cell.model.rows * cell.model.cols) % after.den !== 0) cell.model = nearSquare(after.den);

      // 애니메이션: 이미 칠해져 있던 조각 수(from)부터 새로 칠한다. 패널 그림(animMs()) 뒤에 차례로
      const tot = cell.model.rows * cell.model.cols;
      const from = tot % before.den === 0 ? before.num * (tot / before.den) : 0;
      pendingAnim[idx] = { from: from, offset: animMs() * result.steps };

      idx = rem.num > 0 && cell.state === 'ours' ? pickSpread(idx) : null;
    }
    if (rem.num > 0) result.wasted = rem;
    return result;
  }

  /* ===================== 넓이 모델 그리기 (SVG 문자열) ===================== */
  const U = 60;   // 패널 그림의 단위 정사각형 한 변

  function num(v) { return Math.round(v * 100) / 100; }
  function rect(x, y, w, h, cls, delay) {
    return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" class="' + cls + '"'
      + (delay !== undefined ? ' style="animation-delay:' + Math.round(delay) + 'ms"' : '') + '/>';
  }
  function line(x1, y1, x2, y2, cls) {
    return '<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '" class="' + cls + '"/>';
  }

  /** 칠할 조각 목록 → 순서대로 delay를 붙인 rect 문자열. from 이전 조각은 애니메이션 없이 바로 */
  function shadeRects(shades, from, offset, dur) {
    const n = shades.length - from;
    return shades.map(function (s, i) {
      if (i < from) return rect(s.x, s.y, s.w, s.h, 'sh');
      return rect(s.x, s.y, s.w, s.h, 'sh anim', offset + (n > 1 ? (i - from) / (n - 1) * dur * 0.85 : 0));
    }).join('');
  }

  /**
   * 칸 안 조각을 칠하는 순서. 기본은 왼쪽 아래부터 한 줄씩.
   * blockW가 있으면(분수×분수 교과서 격자) 왼쪽 blockW열을 먼저 아래부터 채워서 겹침 부분이 덩어리로 보이게 한다.
   */
  function cellOrder(m) {
    const order = [];
    if (m.blockW > 0 && m.blockW < m.cols) {
      for (let r = m.rows - 1; r >= 0; r--) for (let c = 0; c < m.blockW; c++) order.push([r, c]);
      for (let r = m.rows - 1; r >= 0; r--) for (let c = m.blockW; c < m.cols; c++) order.push([r, c]);
    } else {
      for (let r = m.rows - 1; r >= 0; r--) for (let c = 0; c < m.cols; c++) order.push([r, c]);
    }
    return order;
  }

  /**
   * 지도 칸 안의 넓이 모델: rows×cols 격자에 shaded개 조각.
   * 조각이 아주 많으면(분모가 큼) 격자선 없이 비율 막대 하나로.
   */
  function cellSVG(m, anim) {
    const from = anim ? anim.from : m.shaded, offset = anim ? anim.offset : 0;
    let s = '<svg class="area model-svg" viewBox="0 0 100 100" preserveAspectRatio="none">';
    if (m.rows * m.cols > 400) {
      const w = 100 * m.shaded / (m.rows * m.cols);
      s += rect(0, 0, w, 100, from < m.shaded ? 'sh anim' : 'sh', offset);
      return s + '</svg>';
    }
    const cw = 100 / m.cols, ch = 100 / m.rows;
    const order = cellOrder(m);
    const shades = [];
    for (let i = 0; i < m.shaded; i++) {
      shades.push({ x: order[i][1] * cw, y: order[i][0] * ch, w: cw, h: ch });
    }
    s += shadeRects(shades, from, offset, animMs());
    for (let c = 1; c < m.cols; c++) s += line(c * cw, 0, c * cw, 100, 'sub');
    for (let r = 1; r < m.rows; r++) s += line(0, r * ch, 100, r * ch, 'sub');
    return s + '</svg>';
  }

  /**
   * 직사각형 넓이 모델 (분수×분수, 대분수×대분수, 세 분수):
   * 가로 W, 세로 H (가분수형). 단위 정사각형을 깔고, 가로는 W의 분모로, 세로는 H의 분모로 등분.
   * 칠하는 부분 = 가로 W.num 조각 × 세로 H.num 조각. tint면 교과서처럼 가로 부분·세로 부분을 연하게 먼저 표시.
   */
  function rectModelSVG(H, W, tint) {
    const nW = ceilFrac(W), nH = ceilFrac(H);
    const width = nW * U, height = nH * U;
    const cw = U / W.den, ch = U / H.den;
    let s = '<svg class="model-svg" viewBox="-2 -2 ' + (width + 4) + ' ' + (height + 4) + '">';
    s += rect(0, 0, width, height, 'unit-bg');
    if (tint) {
      s += rect(0, 0, W.num * cw, height, 'tint-col');
      s += rect(0, height - H.num * ch, width, H.num * ch, 'tint-row');
    }
    const shades = [];
    if (H.num * W.num > 600) {
      for (let r = 0; r < H.num; r++) shades.push({ x: 0, y: height - (r + 1) * ch, w: W.num * cw, h: ch });
    } else {
      for (let r = 0; r < H.num; r++) for (let c = 0; c < W.num; c++) {
        shades.push({ x: c * cw, y: height - (r + 1) * ch, w: cw, h: ch });
      }
    }
    s += shadeRects(shades, 0, 0, animMs());
    for (let k = 1; k < nW * W.den; k++) s += line(k * cw, 0, k * cw, height, k % W.den ? 'sub' : 'unit');
    for (let k = 1; k < nH * H.den; k++) s += line(0, k * ch, width, k * ch, k % H.den ? 'sub' : 'unit');
    s += rect(0, 0, width, height, 'frame');
    return s + '</svg>';
  }

  /**
   * 칸 나열 넓이 모델 (분수×자연수, 자연수×분수, 대분수×자연수, 자연수×대분수):
   * groups = [[칸, 칸, ...], ...]. 칸 = {rows, cols, shaded}: rows로 나누면 아래부터, cols로 나누면 왼쪽부터 칠한다.
   * 한 줄에 칸 8개까지, 넘치면 다음 줄.
   */
  function squaresModelSVG(groups) {
    const GAP = 6, GGAP = 22, LINE_MAX = 8 * (U + GAP);
    const shades = [], lines = [], frames = [];
    let x = 0, y = 0, lineHas = false, maxW = 0;
    groups.forEach(function (g) {
      const gw = g.length * (U + GAP) - GAP;
      if (lineHas && x + GGAP + gw > LINE_MAX) { x = 0; y += U + 2 * GAP + 6; lineHas = false; }
      else if (lineHas) x += GGAP;
      g.forEach(function (q) {
        if (q.rows > 1) {
          const h = U / q.rows;
          for (let i = 0; i < q.shaded; i++) shades.push({ x: x, y: y + U - (i + 1) * h, w: U, h: h });
          for (let k = 1; k < q.rows; k++) lines.push(line(x, y + k * h, x + U, y + k * h, 'sub'));
        } else {
          const w = U / q.cols;
          for (let i = 0; i < q.shaded; i++) shades.push({ x: x + i * w, y: y, w: w, h: U });
          for (let k = 1; k < q.cols; k++) lines.push(line(x + k * w, y, x + k * w, y + U, 'sub'));
        }
        frames.push(rect(x, y, U, U, 'frame'));
        x += U + GAP;
      });
      x -= GAP;
      maxW = Math.max(maxW, x);
      lineHas = true;
    });
    const width = maxW, height = y + U;
    return '<svg class="model-svg" viewBox="-2 -2 ' + (width + 4) + ' ' + (height + 4) + '">'
      + shadeRects(shades, 0, 0, animMs()) + lines.join('') + frames.join('') + '</svg>';
  }

  function text(x, y, str, cls) {
    return '<text x="' + num(x) + '" y="' + num(y) + '" class="' + cls + '">' + F.escapeHTML(str) + '</text>';
  }
  function fracStr(f) { return F.fracText(f); }

  /**
   * 띠 모델 (교과서 34~36쪽, 분수×자연수·대분수×자연수):
   * a를 나타낸 띠(수직선)를 n개 위아래로 쌓고, 아래에 합친 띠 하나를 그린다.
   * 자연수 부분은 진한 초록(sh-w), 분수 부분은 연한 초록(sh-f). 합친 띠가 8칸을 넘으면 생략(식으로만).
   */
  function stripModelSVG(a, n) {
    const w = a.whole || 0, p = a.num, q = a.den;
    const SH = 20, ROW = 38, LBL = 12;
    const copyLen = w + (p > 0 ? 1 : 0);
    const shades = [], marks = [];

    function strip(x0, y, len, darkUnits, lightPieces) {
      for (let k = 0; k < darkUnits; k++) shades.push({ x: x0 + k * U, y: y, w: U, h: SH, cls: 'sh-w' });
      for (let j = 0; j < lightPieces; j++) shades.push({ x: x0 + darkUnits * U + j * U / q, y: y, w: U / q, h: SH, cls: 'sh-f' });
      for (let k = 0; k <= len; k++) {
        marks.push(line(x0 + k * U, y, x0 + k * U, y + SH, 'unit'));
        marks.push(text(x0 + k * U, y + SH + LBL, String(k), 'tick'));
        if (k < len) for (let j = 1; j < q; j++) marks.push(line(x0 + k * U + j * U / q, y + SH * 0.35, x0 + k * U + j * U / q, y + SH, 'sub'));
      }
      marks.push(line(x0, y + SH, x0 + len * U, y + SH, 'unit'));
      marks.push(text(x0 - 10, y + SH * 0.7, fracStr(a), 'tick'));
    }

    let y = 4;
    for (let i = 0; i < n; i++) { strip(30, y, copyLen, w, p); y += ROW; }

    const totalNum = n * (w * q + p), totalLen = Math.ceil(totalNum / q);
    let width = 30 + copyLen * U + 10;
    if (totalLen <= 8) {
      marks.push(text(30 + copyLen * U / 2, y + 6, '↓', 'arrow'));
      y += 16;
      const darkUnits = n * w, lightPieces = n * p;
      for (let k = 0; k < darkUnits; k++) shades.push({ x: 30 + k * U, y: y, w: U, h: SH, cls: 'sh-w' });
      for (let j = 0; j < lightPieces; j++) shades.push({ x: 30 + darkUnits * U + j * U / q, y: y, w: U / q, h: SH, cls: 'sh-f' });
      for (let k = 0; k <= totalLen; k++) {
        marks.push(line(30 + k * U, y, 30 + k * U, y + SH, 'unit'));
        marks.push(text(30 + k * U, y + SH + LBL, String(k), 'tick'));
        if (k < totalLen) for (let j = 1; j < q; j++) marks.push(line(30 + k * U + j * U / q, y + SH * 0.35, 30 + k * U + j * U / q, y + SH, 'sub'));
      }
      marks.push(line(30, y + SH, 30 + totalLen * U, y + SH, 'unit'));
      marks.push(text(20, y + SH * 0.7, '합', 'tick'));
      y += ROW;
      width = Math.max(width, 30 + totalLen * U + 10);
    }
    const rects = shades.map(function (s, i) {
      return rect(s.x, s.y, s.w, s.h, 'sh ' + s.cls + ' anim', shades.length > 1 ? i / (shades.length - 1) * animMs() * 0.85 : 0);
    }).join('');
    return '<svg class="model-svg" viewBox="0 0 ' + width + ' ' + (y + 2) + '">' + rects + marks.join('') + '</svg>';
  }

  /**
   * 자연수×대분수 (교과서 40쪽): 가로 n, 세로 w p/q인 직사각형 하나.
   * 아래 n×w 부분은 진한 초록, 위 n×p/q 부분은 연한 초록. 오른쪽에 'n×w', 'n×p/q' 표시.
   */
  function rectMixedSVG(n, b) {
    const w = b.whole, p = b.num, q = b.den;
    const width = n * U, height = (w + 1) * U, ch = U / q;
    const shades = [];
    for (let r = 0; r < w; r++) for (let c = 0; c < n; c++) shades.push({ x: c * U, y: height - (r + 1) * U, w: U, h: U, cls: 'sh-w' });
    for (let j = 0; j < p; j++) for (let c = 0; c < n; c++) shades.push({ x: c * U, y: height - w * U - (j + 1) * ch, w: U, h: ch, cls: 'sh-f' });
    let s = '<svg class="model-svg" viewBox="-14 -2 ' + (width + 90) + ' ' + (height + 16) + '">';
    s += rect(0, 0, width, height, 'unit-bg');
    s += shades.map(function (sh, i) {
      return rect(sh.x, sh.y, sh.w, sh.h, 'sh ' + sh.cls + ' anim', shades.length > 1 ? i / (shades.length - 1) * animMs() * 0.85 : 0);
    }).join('');
    for (let j = 1; j < q; j++) s += line(0, j * ch, width, j * ch, 'sub');            // 맨 위 칸의 q등분
    for (let k = 1; k < n; k++) s += line(k * U, 0, k * U, height, 'unit');
    for (let k = 1; k <= w; k++) s += line(0, k * U, width, k * U, 'unit');
    s += rect(0, 0, width, height, 'frame');
    for (let k = 0; k <= n; k++) s += text(k * U, height + 12, String(k), 'tick');
    for (let k = 0; k <= w + 1; k++) s += text(-6, height - k * U + 4, String(k), 'tick');
    s += text(width + 6, height - w * U / 2 + 4, n + '×' + w, 'side');
    s += text(width + 6, height - w * U - p * ch / 2 + 4, n + '×' + p + '/' + q, 'side');
    return s + '</svg>';
  }

  /**
   * 진분수×진분수 (교과서 42~43쪽) 두 단계:
   * 왼쪽: a만큼 세로줄로 칠한 정사각형 → 오른쪽: 가로줄로 b의 분모 등분해 'a의 b'만큼 겹쳐 칠하기.
   * 앞의 수 a가 가로 등분(세로줄), 뒤의 수 b가 세로 등분(가로줄).
   */
  function twoStageSVG(a, b) {
    const cw = U / a.den, ch = U / b.den, X2 = U + 46;
    let s = '<svg class="model-svg" viewBox="-2 -18 ' + (X2 + U + 4) + ' ' + (U + 34) + '">';
    // 왼쪽: a
    s += rect(0, 0, U, U, 'unit-bg') + rect(0, 0, a.num * cw, U, 'tint-col');
    for (let k = 1; k < a.den; k++) s += line(k * cw, 0, k * cw, U, 'sub');
    s += rect(0, 0, U, U, 'frame');
    s += text(U / 2, -6, fracStr(a), 'tick');
    // 화살표
    s += text(U + 23, U / 2 + 6, '→', 'arrow');
    // 오른쪽: a의 b
    s += rect(X2, 0, U, U, 'unit-bg') + rect(X2, 0, a.num * cw, U, 'tint-col');
    const shades = [];
    for (let r = 0; r < b.num; r++) for (let c = 0; c < a.num; c++) {
      shades.push({ x: X2 + c * cw, y: U - (r + 1) * ch, w: cw, h: ch });
    }
    s += shadeRects(shades, 0, 0, animMs());
    for (let k = 1; k < a.den; k++) s += line(X2 + k * cw, 0, X2 + k * cw, U, 'sub');
    for (let k = 1; k < b.den; k++) s += line(X2, k * ch, X2 + U, k * ch, 'sub');
    s += rect(X2, 0, U, U, 'frame');
    s += text(X2 + U / 2, -6, fracStr(a) + ' × ' + fracStr(b), 'tick');
    s += text(X2 + U / 2, U + 13, fracStr(a) + '의 ' + fracStr(b), 'tick');
    return s + '</svg>';
  }

  /** 문제 → 패널에 보일 넓이 모델 {svg, caption} (교과서 34~45쪽 그림을 따른다) */
  function problemModel(p) {
    const a = p.a, b = p.b, T = F.fracText;
    const rep = function (q, n) { const arr = []; for (let i = 0; i < n; i++) arr.push(q); return arr; };
    const ans = T(p.answer);
    const tail = function (raw) { return raw === ans ? '' : ' = ' + ans; };
    switch (p.type) {
      case 'pf_x_pf': {
        const raw = (a.num * b.num) + '/' + (a.den * b.den);
        return {
          svg: twoStageSVG(a, b),
          caption: T(a) + '의 ' + T(b) + ': 전체를 (' + a.den + '×' + b.den + ')칸으로 나눈 것 중 '
            + (a.num * b.num) + '칸 = ' + raw + tail(raw),
        };
      }
      case 'pf_x_n': {
        const n = b.whole, raw = (a.num * n) + '/' + a.den;
        return {
          svg: stripModelSVG(a, n),
          caption: T(a) + ' × ' + n + ' = ' + rep(T(a), n <= 5 ? n : 3).join(' + ') + (n > 5 ? ' + …' : '')
            + ' = ' + a.num + '×' + n + '/' + a.den + ' = ' + raw + tail(raw),
        };
      }
      case 'n_x_pf':
        return {
          svg: squaresModelSVG([rep({ rows: 1, cols: b.den, shaded: b.num }, a.whole)]),
          caption: a.whole + '의 ' + T(b) + ': 1을 ' + b.den + '등분해 칸마다 ' + b.num + '조각씩 ' + a.whole + '번 = '
            + (a.whole * b.num) + '/' + b.den + tail((a.whole * b.num) + '/' + b.den),
        };
      case 'mf_x_n': {
        const n = b.whole, w = a.whole, raw = (n * w) + ' ' + (a.num * n) + '/' + a.den;
        return {
          svg: stripModelSVG(a, n),
          caption: T(a) + ' × ' + n + ' = ' + w + '×' + n + ' + ' + a.num + '/' + a.den + '×' + n
            + ' = ' + (n * w) + ' + ' + (a.num * n) + '/' + a.den + ' = ' + ans,
        };
      }
      case 'n_x_mf': {
        const n = a.whole, w = b.whole;
        return {
          svg: rectMixedSVG(n, b),
          caption: n + ' × ' + T(b) + ' = ' + n + '×' + w + ' + ' + n + '×' + b.num + '/' + b.den
            + ' = ' + (n * w) + ' + ' + (n * b.num) + '/' + b.den + ' = ' + ans,
        };
      }
      case 'mf_x_mf': {
        const A = F.toImproper(a), B = F.toImproper(b);
        return {
          svg: rectModelSVG(A, B, false),
          caption: '가분수로 ' + T(a) + ' = ' + F.impText(A) + ', ' + T(b) + ' = ' + F.impText(B)
            + ' → 가로 ' + F.impText(B) + ', 세로 ' + F.impText(A) + '인 직사각형 = ' + T(p.answer),
        };
      }
      case 'triple': {
        const P = F.mulFrac(F.toImproper(a), F.toImproper(b)), C = F.toImproper(p.c);
        return {
          svg: rectModelSVG(P, C, false),
          caption: '앞 두 수 먼저: ' + T(a) + ' × ' + T(b) + ' = ' + F.impText(P)
            + ' → 가로 ' + F.impText(C) + ', 세로 ' + F.impText(P) + '인 직사각형 = ' + T(p.answer),
        };
      }
    }
    return { svg: '', caption: '' };
  }

  /** 처음 칠하는 지도 칸의 격자: 분수×분수면 교과서 격자(가로 a의 분모 등분 × 세로 b의 분모 등분), 왼쪽 a.num열이 겹침 덩어리 */
  function modelHint(p) {
    if (p.type === 'pf_x_pf') return { rows: p.b.den, cols: p.a.den, blockW: p.a.num };
    return null;
  }

  /* ===================== 문제 ===================== */
  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function levelFor(cell) {
    if (cell.isBoss) return cell.region;                       // 도깨비: 지역 기본 level 고정
    if (state.settings.level) return state.settings.level;     // 개발용 고정값이면 자동 조절 끔
    return state.progress[cell.region].level;                  // 지역 기본값에서 ±1 자동 조절된 값
  }

  /**
   * 난이도 자동 조절 (기획서 8-1): 같은 지역에서 연속 3정답 → +1, 연속 2오답 → −1.
   * 범위는 지역 기본값 ±1, 전체 1~3. 개발용 고정 중이거나 도깨비 전투면 건너뜀.
   */
  function adjustLevel(cell, correct) {
    if (cell.isBoss || state.settings.level) return;
    const base = cell.region, pr = state.progress[cell.region];
    const lo = Math.max(1, base - 1), hi = Math.min(3, base + 1);
    if (correct) {
      pr.streakC++; pr.streakW = 0;
      if (pr.streakC >= 3) { pr.level = Math.min(hi, pr.level + 1); pr.streakC = 0; }
    } else {
      pr.streakW++; pr.streakC = 0;
      if (pr.streakW >= 2) { pr.level = Math.max(lo, pr.level - 1); pr.streakW = 0; }
    }
  }

  function typeFor(cell) {
    if (cell.isBoss) return BOSS_TYPE[cell.region];
    const allowed = REGION_TYPES[cell.region];
    const forced = state.settings.type;
    return forced && allowed.indexOf(forced) >= 0 ? forced : pickRandom(allowed);
  }

  /** 복습 보따리에서 이 칸에 낼 수 있는 문제 하나 (없으면 null) */
  function pickReview(cell) {
    if (cell.isBoss || !state.review.length || Math.random() >= REVIEW_RATE) return null;
    const allowed = REGION_TYPES[cell.region];
    const cands = state.review.filter(function (p) {
      return allowed.indexOf(p.type) >= 0 && (!state.settings.type || p.type === state.settings.type);
    });
    return cands.length ? pickRandom(cands) : null;
  }

  function newProblem() {
    const cell = state.grid[state.ui.selected];
    const rev = pickReview(cell);
    let p;
    if (rev) {
      p = JSON.parse(JSON.stringify(rev));
      p.fromReview = true;
    } else {
      p = F.makeProblem(typeFor(cell), levelFor(cell));
    }
    state.ui.problem = p;
    state.ui.input = emptyInput();
    state.ui.focus = 'whole';
    state.ui.phase = 'input';
    state.ui.lines = [];
    commit();
  }

  function selectCell(i) {
    if (!canClick(i)) return;
    if (state.ui.phase === 'convert') return;                          // 대분수 고치기는 끝내고
    if (state.ui.phase === 'correct') {                                // 정답 화면에서 다른 칸 클릭 = 계속하고 그 칸으로
      if (!state.ui.canContinue) return;
      afterCorrect();
    }
    if (state.ui.selected === i) return;
    state.ui.selected = i;
    state.ui.message = '';
    newProblem();
  }

  function closePanel() {
    if (state.ui.phase === 'correct') { afterCorrect(); return; }   // 정답 화면에서 닫기 = 계속
    if (state.ui.phase === 'convert') return;                       // 대분수 고치기 중에는 확인부터
    state.ui.selected = null;
    state.ui.problem = null;
    state.ui.phase = 'idle';
    state.ui.lines = [];
    state.ui.convert = null;
    commit();
  }

  /* ===================== 입력 ===================== */
  function inputOpen() {
    return state.ui.phase === 'input' || state.ui.phase === 'invalid' || state.ui.phase === 'convert';
  }

  function typeDigit(d) {
    if (!inputOpen()) return;
    const cur = state.ui.input[state.ui.focus];
    if (cur.length >= MAX_DIGITS) return;
    state.ui.input[state.ui.focus] = cur === '0' ? d : cur + d;   // 앞자리 0은 덮어씀
    if (state.ui.phase === 'invalid') state.ui.phase = 'input';
    if (state.ui.convert) state.ui.convert.invalid = false;
    commit();
  }

  function backspace() {
    if (!inputOpen()) return;
    const cur = state.ui.input[state.ui.focus];
    if (cur.length) state.ui.input[state.ui.focus] = cur.slice(0, -1);
    else moveFocus(-1);   // 빈 칸에서 지우기 → 앞 칸으로
    if (state.ui.phase === 'invalid') state.ui.phase = 'input';
    if (state.ui.convert) state.ui.convert.invalid = false;
    commit();
  }

  function moveFocus(delta) {
    if (!inputOpen()) return;
    const i = FIELDS.indexOf(state.ui.focus);
    state.ui.focus = FIELDS[Math.min(FIELDS.length - 1, Math.max(0, i + delta))];
    commit();
  }

  function setFocus(field) {
    if (!inputOpen()) return;
    state.ui.focus = field;
    commit();
  }

  /* ===================== 채점 ===================== */
  function bumpStats(type, correct) {
    const s = state.stats;
    s.solved++; if (correct) s.correct++;
    if (!s.byType[type]) s.byType[type] = { solved: 0, correct: 0 };
    s.byType[type].solved++; if (correct) s.byType[type].correct++;
  }

  function removeFromReview(p) {
    state.review = state.review.filter(function (r) { return r.text !== p.text; });
  }

  function addToReview(p) {
    if (state.review.some(function (r) { return r.text === p.text; })) return;
    const copy = JSON.parse(JSON.stringify(p)); delete copy.fromReview;
    state.review.push(copy);
  }

  /**
   * 가분수로 맞혔는가: 자연수 칸을 비우고(또는 0) 분자 ≥ 분모로 썼고, 답이 1 이상일 때.
   * (값이 같으면 정답이라는 규칙은 그대로 두고, 대분수로 고치는 단계를 한 번 더 거치게 한다)
   */
  function wroteImproper(p, input) {
    const w = String(input.whole || '').trim(), n = Number(input.num), d = Number(input.den);
    const wholeBlank = w === '' || Number(w) === 0;
    return wholeBlank && d > 0 && n >= d && p.answer.whole > 0;
  }

  function confirm() {
    if (!inputOpen()) return;
    if (state.ui.phase === 'convert') { confirmConvert(); return; }
    const p = state.ui.problem;
    const idx = state.ui.selected;
    const cell = state.grid[idx];
    const result = F.checkAnswer(p, state.ui.input);

    if (result === F.RESULT.INVALID) { state.ui.phase = 'invalid'; commit(); return; }

    const ok = result === F.RESULT.CORRECT;
    bumpStats(p.type, ok);
    adjustLevel(cell, ok);

    if (ok) {
      if (p.fromReview) removeFromReview(p);
      state.ui.lines = [];
      state.ui.convert = null;
      state.ui.canContinue = false;
      let steps = 0;
      if (cell.isBoss) {
        state.boss[cell.region] = Math.max(0, state.boss[cell.region] - 1);
        if (state.boss[cell.region] === 0) {
          cell.state = 'ours'; cell.fillNum = 1; cell.fillDen = 1; cell.model = { rows: 1, cols: 1 };
          pendingAnim[idx] = { from: 0, offset: animMs() };
          steps = 1;
          state.ui.message = cell.region + '지역 밭도깨비를 물리쳤어요!';
        } else {
          state.ui.message = '도깨비 HP ' + state.boss[cell.region] + ' / ' + BOSS_HP;
        }
      } else {
        // 넓이를 바로 지도에 반영 (새로고침해도 색칠이 남게). 그림은 패널 → 지도 순으로 애니메이션
        const r = applyArea(idx, p.area, modelHint(p));
        steps = r.steps;
        const parts = [];
        if (r.taken.length) parts.push('조각 ' + r.taken.length + '개를 꿰맸어요');
        if (r.partial !== null) parts.push(cellName(r.partial) + ' 조각을 ' + F.impText(fillOf(state.grid[r.partial])) + '만큼 꿰맸어요');
        if (r.wasted) parts.push('넓이가 넘쳤어요 (' + F.impText(r.wasted) + '은 버려요)');
        state.ui.message = '정답 ' + F.fracText(p.answer) + ' → ' + parts.join(', ');
      }
      flash = true;
      setTimeout(function () { flash = false; render(); }, FLASH_MS);

      if (wroteImproper(p, state.ui.input)) {
        // 가분수로 맞힘 → 대분수로 고쳐 보는 단계. 지도 색칠은 이미 반영됨(저장 안전)
        const imp = F.parseInput(state.ui.input);
        state.ui.phase = 'convert';
        state.ui.convert = { written: F.impText(imp), invalid: false, note: '' };
        state.ui.input = emptyInput();
        state.ui.focus = 'whole';
        commit();
      } else {
        enterCorrect();
      }
    } else {
      state.ui.phase = 'wrong';
      state.ui.lines = F.explain(p);
      addToReview(p);
      if (cell.isBoss) state.boss[cell.region] = Math.min(BOSS_HP, state.boss[cell.region] + 1);   // HP 1칸 회복
      commit();
    }
  }

  /** 정답 화면: 넓이 모델 그림을 보여 주고, 그림이 끝나면 '계속' 버튼을 연다 (누를 때까지 기다림) */
  function enterCorrect() {
    state.ui.phase = 'correct';
    state.ui.canContinue = false;
    commit();
    setTimeout(function () {
      if (state.ui.phase !== 'correct') return;
      state.ui.canContinue = true;
      render();
    }, animMs() + 200);
  }

  /** 대분수 고치기 단계의 확인: 자연수 부분을 쓰고 분자 < 분모이며 값이 같으면 성공. 틀려도 감점 없이 방법만 보여 준다 */
  function confirmConvert() {
    const p = state.ui.problem, cv = state.ui.convert, input = state.ui.input;
    const v = F.parseInput(input);
    const w = String(input.whole || '').trim();
    if (!v || w === '' || Number(w) === 0) { cv.invalid = true; commit(); return; }   // 자연수 칸을 채울 때까지 기다림
    const n = Number(input.num || 0), d = Number(input.den || 1);
    const isMixed = n < d;
    const how = cv.written + ' = ' + F.fracText(p.answer) + ' (' + p.area.num + ' ÷ ' + p.area.den + ' = ' + p.answer.whole
      + (p.answer.num ? ' 나머지 ' + p.answer.num : '') + ')';
    const what = p.answer.num === 0 ? '자연수' : '대분수';
    if (isMixed && F.equals(v, p.area)) cv.note = what + '로 잘 고쳤어요: ' + how;
    else cv.note = what + '로 고치는 방법: ' + how;
    cv.ok = isMixed && F.equals(v, p.area);
    enterCorrect();
  }

  /** '계속': 도깨비 전투 중이면 다음 문제, 아니면 패널 닫기 */
  function afterCorrect() {
    if (state.ui.phase !== 'correct') return;
    state.ui.canContinue = false;
    const idx = state.ui.selected;
    const cell = idx !== null ? state.grid[idx] : null;
    state.ui.convert = null;
    if (cell && cell.isBoss && cell.state === 'boss') { newProblem(); return; }
    state.ui.selected = null;
    state.ui.problem = null;
    state.ui.phase = 'idle';
    if (landCount() >= TARGET && !state.finishedAt) {
      state.finishedAt = Date.now();
      state.ui.message = '왕국 복구! 조각 47개를 모두 꿰맸어요.';
      state.ui.resultOpen = true;
    }
    commit();
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + '시간 ' : '') + m + '분 ' + sec + '초';
  }

  function resetGame() {
    if (!window.confirm('처음부터 다시 시작할까요? 지금까지의 밭과 기록이 모두 지워져요.')) return;
    state = newState();
    F.resetLast();
    commit();
    const settings = document.getElementById('settings');
    if (settings) settings.hidden = true;                                    // 설정 창 닫기
    if (window.JogakTitle && window.JogakTitle.show) window.JogakTitle.show(); // 타이틀 화면으로 (오프닝도 다시 볼 수 있게)
  }

  /* ===================== 그리기 ===================== */
  const $ = function (id) { return document.getElementById(id); };
  const el = {
    layout: $('layout'), grid: $('grid'), mapMsg: $('mapMsg'),
    statLand: $('statLand'), statSolved: $('statSolved'), statRate: $('statRate'), statReview: $('statReview'),
    typeSelect: $('typeSelect'), levelGroup: $('levelGroup'), speedGroup: $('speedGroup'), btnReset: $('btnReset'),
    panel: $('problemPanel'), panelTitle: $('panelTitle'), btnClose: $('btnClose'),
    placeholder: $('panelPlaceholder'), panelMsg: $('panelMsg'), panelBody: $('panelBody'),
    problemMeta: $('problemMeta'), problemText: $('problemText'),
    boxes: { whole: $('boxWhole'), num: $('boxNum'), den: $('boxDen') },
    feedback: $('feedback'), feedbackTitle: $('feedbackTitle'), feedbackLines: $('feedbackLines'),
    modelBox: $('modelBox'), modelSvg: $('modelSvg'), modelCaption: $('modelCaption'),
    btnNext: $('btnNext'), btnContinue: $('btnContinue'), keypad: $('keypad'),
    regionLabels: { 1: $('regionLabel1'), 2: $('regionLabel2'), 3: $('regionLabel3') },
    btnResult: $('btnResult'), resultScreen: $('resultScreen'),
    resultTime: $('resultTime'), resultSolved: $('resultSolved'), resultRate: $('resultRate'),
    resultBars: $('resultBars'), btnReplay: $('btnReplay'), btnResultClose: $('btnResultClose'),
  };

  function cellName(i) { return (rowOf(i) + 1) + '행 ' + (colOf(i) + 1) + '열'; }

  // 격자 칸 48개는 한 번만 만들고, render()에서 class·글자만 바꾼다.
  // 칸 안의 SVG는 내용(상태·fill·격자)이 바뀔 때만 다시 만든다 → 애니메이션이 중간에 끊기지 않는다.
  const cellEls = [], cellSig = [];
  (function buildGrid() {
    for (let i = 0; i < ROWS * COLS; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.dataset.index = i;
      d.innerHTML = '<div class="area-wrap"></div><span class="label"></span><span class="pct"></span>';
      el.grid.appendChild(d);
      cellEls.push(d);
      cellSig.push('');
    }
  })();

  function renderGrid() {
    const sel = state.ui.selected;
    state.grid.forEach(function (cell, i) {
      const d = cellEls[i];
      const clickable = canClick(i);
      d.className = 'cell ' + cell.state
        + (clickable ? ' clickable' : '')
        + (!clickable && !isOurs(cell) ? ' dim' : '')
        + (sel === i ? ' selected' : '')
        + (colOf(i) === 1 || colOf(i) === 4 ? ' rdiv' : '');

      let label = '', pct = '';
      if (cell.state === 'home') label = '본진';
      else if (cell.state === 'boss') label = '도깨비' + (clickable ? ' ' + state.boss[cell.region] + '/' + BOSS_HP : '');
      else if (cell.state === 'filling') pct = Math.round(100 * cell.fillNum / cell.fillDen) + '%';   // 표시할 때만 %
      d.querySelector('.label').textContent = label;
      d.querySelector('.pct').textContent = pct;

      const hasArea = cell.state === 'filling' || cell.state === 'ours';
      const m = hasArea ? cellModel(cell) : null;
      const sig = hasArea ? cell.state + '|' + cell.fillNum + '/' + cell.fillDen + '|' + m.rows + 'x' + m.cols : '';
      if (sig !== cellSig[i]) {
        cellSig[i] = sig;
        const anim = pendingAnim[i]; delete pendingAnim[i];
        d.querySelector('.area-wrap').innerHTML = hasArea ? cellSVG(m, anim) : '';
      }
    });
  }

  function renderTopbar() {
    const s = state.stats;
    el.statLand.textContent = landCount();
    el.statSolved.textContent = s.solved;
    el.statRate.textContent = s.solved ? Math.round(100 * s.correct / s.solved) + '%' : '-';
    el.statReview.textContent = state.review.length;
    el.typeSelect.value = state.settings.type || '';
    el.levelGroup.querySelectorAll('.level-btn').forEach(function (b) {
      b.classList.toggle('active', (b.dataset.level || null) === (state.settings.level ? String(state.settings.level) : null));
    });
    el.speedGroup.querySelectorAll('.level-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.speed === (state.settings.animSpeed === 'fast' ? 'fast' : 'normal'));
    });
    [1, 2, 3].forEach(function (r) {
      const lv = state.settings.level ? state.settings.level + ' (고정)' : state.progress[r].level;
      el.regionLabels[r].textContent = r + '지역 · level ' + lv;
    });
    el.btnResult.hidden = !state.finishedAt;
  }

  function renderResult() {
    const open = !!state.finishedAt && state.ui.resultOpen;
    el.resultScreen.hidden = !open;
    if (!open) return;
    const s = state.stats;
    el.resultTime.textContent = formatDuration(state.finishedAt - state.startedAt);
    el.resultSolved.textContent = s.solved;
    el.resultRate.textContent = s.solved ? Math.round(100 * s.correct / s.solved) + '%' : '-';
    el.resultBars.innerHTML = TYPE_ORDER.map(function (t) {
      const b = s.byType[t] || { solved: 0, correct: 0 };
      const rate = b.solved ? Math.round(100 * b.correct / b.solved) : 0;
      return '<div class="result-bar' + (b.solved ? '' : ' none') + '">'
        + '<span class="name">' + F.escapeHTML(F.TYPE_NAMES[t]) + '</span>'
        + '<div class="track"><div class="fill" style="width:' + rate + '%"></div></div>'
        + '<span class="val">' + (b.solved ? b.correct + '/' + b.solved + ' (' + rate + '%)' : '안 나옴') + '</span>'
        + '</div>';
    }).join('');
  }

  let modelSig = '';
  function renderModel(p, show) {
    el.modelBox.hidden = !show;
    const sig = show ? p.text + '|' + p.type : '';
    if (sig === modelSig) return;          // 같은 문제면 다시 그리지 않는다 (애니메이션 유지)
    modelSig = sig;
    if (!show) { el.modelSvg.innerHTML = ''; el.modelCaption.innerHTML = ''; return; }
    const m = problemModel(p);
    el.modelSvg.innerHTML = m.svg;
    el.modelCaption.innerHTML = F.mathHTML(m.caption);
  }

  function renderPanel() {
    const ui = state.ui;
    const p = ui.problem;
    const has = ui.selected !== null && p;
    el.layout.classList.toggle('has-selected', !!has);
    el.placeholder.hidden = !!has;
    el.panelBody.hidden = !has;
    el.btnClose.hidden = !has;
    el.panelMsg.textContent = ui.message;
    el.mapMsg.textContent = ui.message;

    document.body.classList.toggle('correct', ui.phase === 'correct' && flash);
    document.body.classList.toggle('wrong', ui.phase === 'wrong');

    // 연출용 상태 표시 (fx.js가 읽는다): 단계, 도깨비 전투면 HP와 지역
    el.panel.dataset.phase = ui.phase;
    if (!has) {
      delete el.panel.dataset.bossHp; delete el.panel.dataset.bossRegion;
      el.panelTitle.textContent = '칸을 골라 주세요'; renderModel(null, false); return;
    }

    const cell = state.grid[ui.selected];
    if (cell.isBoss) { el.panel.dataset.bossHp = state.boss[cell.region]; el.panel.dataset.bossRegion = cell.region; }
    else { delete el.panel.dataset.bossHp; delete el.panel.dataset.bossRegion; }
    el.panelTitle.textContent = cellName(ui.selected) + ' · ' + cell.region + '지역'
      + (cell.isBoss ? ' · 밭도깨비 HP ' + state.boss[cell.region] + '/' + BOSS_HP : '');
    el.problemMeta.textContent = F.TYPE_NAMES[p.type] + ' · level ' + p.level + (p.fromReview ? ' · 복습' : '');
    el.problemText.innerHTML = F.mathHTML(p.text);

    const locked = ui.phase === 'correct' || ui.phase === 'wrong';
    FIELDS.forEach(function (f) {
      el.boxes[f].textContent = ui.input[f];
      el.boxes[f].classList.toggle('active', !locked && ui.focus === f);
    });

    el.feedback.classList.remove('ok', 'bad', 'info');
    el.feedbackLines.innerHTML = '';
    el.btnNext.hidden = true;
    el.btnContinue.hidden = true;
    if (ui.phase === 'convert') {
      el.feedback.hidden = false; el.feedback.classList.add('ok');
      const natural = p.answer.num === 0;
      el.feedbackTitle.innerHTML = '정답! ' + F.mathHTML(ui.convert.written) + (natural ? '을 자연수로 고쳐 볼까요?' : '을 대분수로 고쳐 볼까요?');
      el.feedbackLines.innerHTML = '<div class="line">' + (natural
        ? '분자를 분모로 나누면 딱 떨어져요. 자연수 칸에만 넣고 확인을 누르세요.'
        : '자연수 칸에 자연수 부분을, 분자·분모 칸에 남은 진분수를 넣고 확인을 누르세요.') + '</div>'
        + (ui.convert.invalid ? '<div class="line warn">입력을 확인해요. 자연수 칸을 채워야 해요.</div>' : '');
    } else if (ui.phase === 'correct') {
      el.feedback.hidden = false; el.feedback.classList.add('ok');
      el.feedbackTitle.innerHTML = '정답! ' + F.mathHTML(F.fracText(p.answer));
      if (ui.convert && ui.convert.note) {
        el.feedbackLines.innerHTML = '<div class="line' + (ui.convert.ok ? '' : ' warn') + '">' + F.mathHTML(ui.convert.note) + '</div>';
      }
      el.btnContinue.hidden = !ui.canContinue;
    } else if (ui.phase === 'wrong') {
      el.feedback.hidden = false; el.feedback.classList.add('bad');
      el.feedbackTitle.innerHTML = '틀렸어요. 답은 ' + F.mathHTML(F.fracText(p.answer));
      el.feedbackLines.innerHTML = ui.lines.map(function (line) {
        return '<div class="line">' + F.mathHTML(line) + '</div>';
      }).join('');
      el.btnNext.hidden = false;
    } else if (ui.phase === 'invalid') {
      el.feedback.hidden = false; el.feedback.classList.add('info');
      el.feedbackTitle.textContent = '입력을 확인해요. 분자를 넣었으면 분모도 넣어야 해요.';
    } else {
      el.feedback.hidden = true;
    }
    renderModel(p, locked);                   // 정답·오답 때 넓이 모델 그림

    el.keypad.classList.toggle('disabled', locked);
    el.keypad.hidden = locked;                // 그림·풀이가 키패드 자리를 쓴다
  }

  function render() {
    renderTopbar();
    renderGrid();
    renderPanel();
    renderResult();
  }

  /* ===================== 이벤트 ===================== */
  el.grid.addEventListener('click', function (e) {
    const d = e.target.closest('.cell');
    if (d) selectCell(Number(d.dataset.index));
  });

  el.btnClose.addEventListener('click', closePanel);
  el.btnReset.addEventListener('click', resetGame);
  el.btnReplay.addEventListener('click', resetGame);

  /* ===================== 복습 보따리 목록 (상단 바 숫자를 누르면) ===================== */
  (function () {
    const box = $('review'), list = $('reviewList'), empty = $('reviewEmpty'),
      btnOpen = $('btnReview'), btnOk = $('btnReviewOk');
    if (!box || !list || !empty || !btnOpen || !btnOk) return;
    let opener = null;

    function renderList() {
      list.innerHTML = '';
      empty.hidden = state.review.length > 0;
      state.review.forEach(function (p) {
        const li = document.createElement('li');
        li.className = 'review-item';
        const q = document.createElement('div');
        q.className = 'review-q'; q.textContent = p.text + ' = ?';
        const meta = document.createElement('div');
        meta.className = 'review-meta'; meta.textContent = F.TYPE_NAMES[p.type] + ' · level ' + p.level;
        const ans = document.createElement('div');
        ans.className = 'review-ans'; ans.hidden = true; ans.textContent = '정답: ' + F.fracText(p.answer);
        const peek = document.createElement('button');
        peek.type = 'button'; peek.className = 'btn-reset review-peek'; peek.textContent = '정답 보기';
        peek.addEventListener('click', function () {
          ans.hidden = !ans.hidden;
          peek.textContent = ans.hidden ? '정답 보기' : '정답 숨기기';
        });
        li.append(q, meta, peek, ans);
        list.appendChild(li);
      });
    }
    function open() { opener = document.activeElement; renderList(); box.hidden = false; btnOk.focus(); }
    function close() { box.hidden = true; if (opener && opener.focus) opener.focus(); }

    btnOpen.addEventListener('click', open);
    btnOk.addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !box.hidden) { close(); e.preventDefault(); }
    });
  })();
  el.btnResult.addEventListener('click', function () { state.ui.resultOpen = true; commit(); });
  el.btnResultClose.addEventListener('click', function () { state.ui.resultOpen = false; commit(); });
  el.btnNext.addEventListener('click', function () { if (state.ui.phase === 'wrong') newProblem(); });
  el.btnContinue.addEventListener('click', function () { if (state.ui.canContinue) afterCorrect(); });

  el.keypad.addEventListener('click', function (e) {
    const btn = e.target.closest('.key');
    if (!btn) return;
    const key = btn.dataset.key;
    if (/^\d$/.test(key)) typeDigit(key);
    else if (key === 'clear') backspace();
    else if (key === 'left') moveFocus(-1);
    else if (key === 'right') moveFocus(1);
    else if (key === 'ok') confirm();
  });

  FIELDS.forEach(function (f) {
    el.boxes[f].addEventListener('click', function () { setFocus(f); });
  });

  // 개발용: 유형·난이도 고정. 문제를 풀던 중이면 그 칸의 문제를 다시 낸다
  function settingsChanged() {
    if (state.ui.selected !== null && inputOpen()) newProblem(); else commit();
  }
  el.typeSelect.addEventListener('change', function () {
    state.settings.type = el.typeSelect.value || null;
    settingsChanged();
  });
  el.levelGroup.addEventListener('click', function (e) {
    const btn = e.target.closest('.level-btn');
    if (!btn) return;
    state.settings.level = btn.dataset.level ? Number(btn.dataset.level) : null;
    settingsChanged();
  });
  // 설정: 색칠 애니메이션 속도 (빠르게/보통)
  el.speedGroup.addEventListener('click', function (e) {
    const btn = e.target.closest('.level-btn');
    if (!btn) return;
    state.settings.animSpeed = btn.dataset.speed === 'fast' ? 'fast' : 'normal';
    commit();
  });

  // 키보드: 숫자, Backspace, ←/→, '/'(분모로), 스페이스(분자로), Enter(확인 · 오답 뒤에는 다음 문제), Esc(닫기)
  document.addEventListener('keydown', function (e) {
    if (e.target === el.typeSelect) return;
    if (state.ui.selected === null) return;
    const k = e.key;
    if (/^\d$/.test(k)) { typeDigit(k); e.preventDefault(); }
    else if (k === 'Backspace') { backspace(); e.preventDefault(); }
    else if (k === 'ArrowLeft') { moveFocus(-1); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'Tab') { moveFocus(1); e.preventDefault(); }
    else if (k === '/') { setFocus('den'); e.preventDefault(); }
    else if (k === ' ') { setFocus('num'); e.preventDefault(); }
    else if (k === 'Enter') {
      if (state.ui.phase === 'wrong') newProblem();
      else if (state.ui.phase === 'correct') { if (state.ui.canContinue) afterCorrect(); }
      else confirm();
      e.preventDefault();
    }
    else if (k === 'Escape') { closePanel(); }
  });

  /* ===================== 시작 ===================== */
  (function buildTypeSelect() {
    const auto = document.createElement('option');
    auto.value = ''; auto.textContent = '자동 (지역별)';
    el.typeSelect.appendChild(auto);
    TYPE_ORDER.forEach(function (t) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = F.TYPE_NAMES[t];
      el.typeSelect.appendChild(opt);
    });
  })();

  render();
})();
