/**
 * fraction.js — 조각땅 · 분수 밭 개척단
 * 분수 연산 · 문제 생성(makeProblem) · 채점(checkAnswer) · 풀이(explain)
 *
 * 순수 JavaScript. 프레임워크 없음. UI를 모른다.
 * HTML에서 script 태그(src="fraction.js")로 불러오면
 * 전역 객체 Fraction 과 전역 함수 makeProblem / checkAnswer / explain 이 생긴다.
 * 모든 계산은 정수만 쓴다. 소수는 쓰지 않는다.
 *
 * 분수 표현
 *   가분수형  {num, den}          예) 15/4 → {num:15, den:4},  3 → {num:3, den:1}
 *   대분수형  {whole, num, den}   예) 3 3/4 → {whole:3, num:3, den:4},  3 → {whole:3, num:0, den:1}
 *   피연산자  {kind:'pf'|'mf'|'n', whole, num, den}   (pf=진분수, mf=대분수, n=자연수)
 *
 * 문제 객체 (makeProblem 반환)
 *   { type, level, text:'2/3 × 4', a, b, [c], operands:[a,b,(c)],
 *     answer:{whole,num,den}   ← 기약 대분수형
 *     area:{num,den} }         ← 기약 가분수형 (지도에 색칠할 넓이)
 */
(function (root) {
  'use strict';

  /* ===================== 1. 기본 연산 (정수만) ===================== */

  /** 최대공약수 */
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  /** 약분: {num,den} → 기약분수 {num,den} (den > 0) */
  function reduce(f) {
    if (!f || !Number.isInteger(f.num) || !Number.isInteger(f.den) || f.den === 0) {
      throw new Error('reduce: 잘못된 분수 ' + JSON.stringify(f));
    }
    let num = f.num, den = f.den;
    if (den < 0) { num = -num; den = -den; }
    const g = gcd(num, den) || 1;
    return { num: num / g, den: den / g };
  }

  /** 대분수형 → 가분수형 (약분하지 않음) */
  function toImproper(m) {
    const whole = m.whole || 0, num = m.num || 0, den = m.den || 1;
    return { num: whole * den + num, den: den };
  }

  /** 가분수형 → 기약 대분수형. 자연수면 num=0, den=1 */
  function toMixed(f) {
    const r = reduce(f);
    return { whole: Math.floor(r.num / r.den), num: r.num % r.den, den: r.den };
  }

  /** 분수 곱셈: mulFrac(f1, f2, ...) → 기약 가분수형 */
  function mulFrac() {
    let num = 1, den = 1;
    for (let i = 0; i < arguments.length; i++) {
      num *= arguments[i].num;
      den *= arguments[i].den;
    }
    return reduce({ num: num, den: den });
  }

  /** 두 가분수형의 값이 같은가 (교차곱, 정수 비교) */
  function equals(a, b) {
    return a.num * b.den === b.num * a.den;
  }

  /** 대분수형 → 문자열: '1 1/4', '2/3', '3' */
  function fracText(m) {
    const whole = m.whole || 0, num = m.num || 0, den = m.den || 1;
    if (num === 0) return String(whole);
    if (whole === 0) return num + '/' + den;
    return whole + ' ' + num + '/' + den;
  }

  /** 가분수형 → 문자열: '15/4', 분모 1이면 '3' */
  function impText(f) {
    return f.den === 1 ? String(f.num) : f.num + '/' + f.den;
  }

  function exprText(fracs) {
    return fracs.map(impText).join(' × ');
  }

  /**
   * 약분(맞줄임): 분자 하나와 분모 하나의 공약수로 나눈다.
   * 반환 { fracs: 약분된 사본, steps: [{a, b, g}] }  a÷g, b÷g
   */
  function cancel(fracs) {
    const out = fracs.map(function (f) { return { num: f.num, den: f.den }; });
    const steps = [];
    for (let i = 0; i < out.length; i++) {
      for (let j = 0; j < out.length; j++) {
        const g = gcd(out[i].num, out[j].den);
        if (g > 1) {
          steps.push({ a: out[i].num, b: out[j].den, g: g });
          out[i].num /= g;
          out[j].den /= g;
        }
      }
    }
    return { fracs: out, steps: steps };
  }

  /* ===================== 2. 문제 생성 ===================== */

  /**
   * 난이도 설정 (기획서 8-1, 교과서 34~45쪽 기준)
   *   level 1: 교과서 각 차시의 도입 문제 수준. 약분이 없거나, 약분해도 답이 자연수로 딱 떨어지는 문제
   *            (예: 1/4×3, 6×1/3=2, 1 1/2×1 1/3=2)
   *   level 2: 교과서 "계산해 보세요" 수준. 약분은 있을 수도 없을 수도
   *            (예: 5/6×7, 2 1/3×5, 9×5/6, 3/8×5/9)
   *   level 3: 약분이 꼭 필요한 문제. 세 분수는 두 번 약분
   *            (예: 7/12×8, 12×1/4, 9/10×5/6, 3 1/2×1 4/5, 7/9×3/16×4/21)
   */
  const LEVELS = {
    1: { den: [2, 5],  nat: [2, 5],  whole: [1, 2], cancel: 'none' },
    2: { den: [2, 9],  nat: [2, 9],  whole: [1, 3], cancel: 'any'  },
    3: { den: [2, 12], nat: [2, 8],  whole: [1, 3], cancel: 'need' }, // 자연수는 답이 너무 커지지 않게 8까지
  };

  /**
   * 세 분수의 곱셈 모양 (교과서 45쪽: 2×5/9×3/4, 3/5×5×2 1/6 처럼 자연수·대분수가 섞인다)
   * level 1은 진분수 3개, level 2부터 자연수 하나, level 3부터 대분수 하나까지. 순서는 섞는다.
   */
  const TRIPLE_SHAPES = {
    1: [['pf', 'pf', 'pf']],
    2: [['pf', 'pf', 'pf'], ['n', 'pf', 'pf']],
    3: [['pf', 'pf', 'pf'], ['n', 'pf', 'pf'], ['mf', 'pf', 'pf'], ['n', 'pf', 'mf']],
  };

  /** 유형별 피연산자 모양 (기획서 7) */
  const TYPES = {
    pf_x_n:  ['pf', 'n'],
    mf_x_n:  ['mf', 'n'],
    n_x_pf:  ['n', 'pf'],
    n_x_mf:  ['n', 'mf'],
    pf_x_pf: ['pf', 'pf'],
    mf_x_mf: ['mf', 'mf'],
    triple:  ['pf', 'pf', 'pf'],
  };

  const TYPE_NAMES = {
    pf_x_n:  '(진분수)×(자연수)',
    mf_x_n:  '(대분수)×(자연수)',
    n_x_pf:  '(자연수)×(진분수)',
    n_x_mf:  '(자연수)×(대분수)',
    pf_x_pf: '(진분수)×(진분수)',
    mf_x_mf: '(대분수)×(대분수)',
    triple:  '세 분수의 곱셈',
  };

  function rand(lo, hi) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  function pick(arr) { return arr[rand(0, arr.length - 1)]; }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(0, i); const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** 기약 진분수 */
  function genProper(cfg) {
    for (;;) {
      const den = rand(cfg.den[0], cfg.den[1]);
      const num = rand(1, den - 1);
      if (gcd(num, den) === 1) return { kind: 'pf', whole: 0, num: num, den: den };
    }
  }

  /** 대분수 (분수 부분은 기약 진분수) */
  function genMixed(cfg) {
    const p = genProper(cfg);
    return { kind: 'mf', whole: rand(cfg.whole[0], cfg.whole[1]), num: p.num, den: p.den };
  }

  /** 자연수 */
  function genNat(cfg) {
    return { kind: 'n', whole: rand(cfg.nat[0], cfg.nat[1]), num: 0, den: 1 };
  }

  const GEN = { pf: genProper, mf: genMixed, n: genNat };

  /** 직전에 만든 문제 텍스트 (같은 문제 연속 방지) */
  let lastText = null;

  /**
   * makeProblem(type, level) → 문제 객체
   * type: 'pf_x_n' | 'mf_x_n' | 'n_x_pf' | 'n_x_mf' | 'pf_x_pf' | 'mf_x_mf' | 'triple'
   * level: 1 ~ 3
   */
  function makeProblem(type, level) {
    const shape = TYPES[type];
    if (!shape) throw new Error('makeProblem: 알 수 없는 유형 ' + type);
    level = Math.min(3, Math.max(1, Math.round(Number(level)) || 1));
    const cfg = LEVELS[level];
    const need = cfg.cancel === 'need' ? (type === 'triple' ? 2 : 1) : 0;

    let ops, text;
    for (let tries = 0; ; tries++) {
      const kinds = type === 'triple' ? shuffle(pick(TRIPLE_SHAPES[level])) : shape;
      ops = kinds.map(function (k) { return GEN[k](cfg); });

      const imps = ops.map(toImproper);
      const nCancel = cancel(imps).steps.length;
      const isNatural = mulFrac.apply(null, imps).den === 1;
      if (tries < 150) { // 150번 안에 못 찾으면 약분 조건은 포기
        // level 1: 약분이 없거나, 약분해도 답이 자연수 (6×1/3=2, 1 1/2×1 1/3=2)
        if (cfg.cancel === 'none' && nCancel > 0 && !isNatural) continue;
        if (cfg.cancel === 'need' && nCancel < need) continue;
      }
      text = ops.map(fracText).join(' × ');
      if (text === lastText && tries < 200) continue; // 같은 문제 연속 금지
      break;
    }
    lastText = text;

    const area = mulFrac.apply(null, ops.map(toImproper));
    const answer = toMixed(area);
    const p = { type: type, level: level, text: text, a: ops[0], b: ops[1], operands: ops, answer: answer, area: area };
    if (ops.length > 2) p.c = ops[2];
    return p;
  }

  /* ===================== 3. 채점 ===================== */

  const RESULT = { CORRECT: '정답', WRONG: '오답', INVALID: '입력 확인' };

  function isBlank(v) {
    return v === null || v === undefined || String(v).trim() === '';
  }

  /**
   * 입력 {whole, num, den} → 가분수형 {num, den}, 잘못된 입력이면 null
   * 규칙 (기획서 6-5)
   *   - 비워 둔 칸은 0으로 본다
   *   - 분자·분모가 둘 다 비어 있으면 자연수 칸만으로 판정
   *   - 분모가 0 또는 비어 있는데 분자가 있으면 잘못된 입력
   *   - 세 칸 모두 비어 있거나, 음수·소수·숫자 아님이면 잘못된 입력
   */
  function parseInput(input) {
    if (!input || typeof input !== 'object') return null;
    const bw = isBlank(input.whole), bn = isBlank(input.num), bd = isBlank(input.den);
    if (bw && bn && bd) return null;

    const toInt = function (v) {
      if (isBlank(v)) return 0;
      const s = String(v).trim();
      return /^\d+$/.test(s) ? Number(s) : NaN;
    };
    const whole = toInt(input.whole), num = toInt(input.num), den = toInt(input.den);
    if (Number.isNaN(whole) || Number.isNaN(num) || Number.isNaN(den)) return null;

    if (bn && bd) return { num: whole, den: 1 };
    if (den === 0) return null;
    return { num: whole * den + num, den: den };
  }

  /**
   * checkAnswer(problem, input) → '정답' | '오답' | '입력 확인'
   * 기약분수·약분 안 한 분수·가분수·대분수 어느 꼴이든 값이 같으면 정답
   */
  function checkAnswer(problem, input) {
    const v = parseInput(input);
    if (!v) return RESULT.INVALID;
    const target = problem.area || toImproper(problem.answer);
    return equals(v, target) ? RESULT.CORRECT : RESULT.WRONG;
  }

  /* ===================== 4. 풀이 ===================== */

  // 숫자 뒤 조사 (마지막 자리 소리 기준)
  function josa(n, withBatchim, without) {
    const d = n % 10;
    const batchim = (d === 0 || d === 1 || d === 3 || d === 6 || d === 7 || d === 8);
    return batchim ? withBatchim : without;
  }
  function josaRo(n) {
    const d = n % 10;
    if (d === 1 || d === 7 || d === 8) return '로';   // ㄹ 받침
    if (d === 0 || d === 3 || d === 6) return '으로';
    return '로';
  }

  /**
   * explain(problem) → 풀이 문자열 배열
   * (대분수 → 가분수) → 약분 → 곱셈 → 대분수 변환
   */
  function explain(p) {
    const ops = p.operands || [p.a, p.b, p.c].filter(Boolean);
    const lines = [];
    const imps = ops.map(toImproper);

    // 0. 대분수가 있으면 가분수로
    const mixed = ops.filter(function (o) { return (o.whole || 0) > 0 && (o.num || 0) > 0; });
    if (mixed.length) {
      lines.push('대분수를 가분수로: ' + mixed.map(function (o) {
        return fracText(o) + ' = ' + impText(toImproper(o));
      }).join(', '));
    }

    // 1. 약분
    const c = cancel(imps);
    if (c.steps.length) {
      const how = c.steps.map(function (s) {
        return s.a + josa(s.a, '과', '와') + ' ' + s.b + josa(s.b, '을', '를') + ' ' + s.g + josaRo(s.g) + ' 나눔';
      }).join(', ');
      lines.push('약분: ' + exprText(imps) + ' → ' + exprText(c.fracs) + ' (' + how + ')');
    } else {
      lines.push('약분: 약분할 것이 없어요. 바로 곱해요.');
    }

    // 2. 곱셈
    const nums = c.fracs.map(function (f) { return f.num; });
    const dens = c.fracs.map(function (f) { return f.den; });
    const num = nums.reduce(function (x, y) { return x * y; }, 1);
    const den = dens.reduce(function (x, y) { return x * y; }, 1);
    lines.push('곱셈: 분자끼리 ' + nums.join('×') + ' = ' + num +
               ', 분모끼리 ' + dens.join('×') + ' = ' + den +
               ' → ' + impText({ num: num, den: den }));

    // 3. 대분수 변환
    const m = toMixed({ num: num, den: den });
    if (m.whole > 0 && m.num > 0) {
      lines.push('대분수로: ' + num + '/' + den + ' = ' + fracText(m) +
                 ' (' + num + ' ÷ ' + den + ' = ' + m.whole + ' 나머지 ' + m.num + ')');
    } else {
      lines.push('답: ' + fracText(m));
    }
    return lines;
  }

  /* ===================== 5. 표시 도우미 (교과서식 세로 분수 HTML) ===================== */
  /*
   * DOM은 건드리지 않고 HTML 문자열만 만든다. 화면 쪽 CSS 예시:
   *   .math { font-family: "Times New Roman", serif; white-space: nowrap; }
   *   .math .frac { display: inline-flex; flex-direction: column; align-items: center;
   *                 vertical-align: middle; line-height: 1.15; font-size: .85em; margin: 0 2px; }
   *   .math .frac .num { padding: 0 4px; border-bottom: 1.5px solid currentColor; }
   *   .math .frac .den { padding: 0 4px; }
   *   .math .op { margin: 0 .35em; }
   */

  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 대분수형 {whole,num,den} → 세로 분수 HTML */
  function fracHTML(m) {
    const whole = m.whole || 0, num = m.num || 0, den = m.den || 1;
    if (num === 0) return '<span class="whole">' + whole + '</span>';
    const frac = '<span class="frac"><span class="num">' + num + '</span><span class="den">' + den + '</span></span>';
    return whole === 0 ? frac : '<span class="whole">' + whole + '</span>' + frac;
  }

  /** 가분수형 {num,den} → 세로 분수 HTML (약분·대분수 변환 없이 그대로) */
  function impHTML(f) {
    return f.den === 1 ? '<span class="whole">' + f.num + '</span>'
      : '<span class="frac"><span class="num">' + f.num + '</span><span class="den">' + f.den + '</span></span>';
  }

  /**
   * '1 1/4 × 3', '약분: 7/12 × 8 → 7/3 × 2' 같은 평문을 세로 분수 HTML로.
   * 문제 text와 explain() 결과를 화면에 보일 때 쓴다. 결과는 <span class="math">…</span>
   */
  function mathHTML(text) {
    const html = escapeHTML(text)
      .replace(/(?:(\d+) )?(\d+)\/(\d+)/g, function (_, w, n, d) {
        return fracHTML({ whole: w ? Number(w) : 0, num: Number(n), den: Number(d) });
      })
      .replace(/×/g, '<span class="op">×</span>');
    return '<span class="math">' + html + '</span>';
  }

  /* ===================== 내보내기 ===================== */

  const Fraction = {
    gcd: gcd, reduce: reduce, toImproper: toImproper, toMixed: toMixed, mulFrac: mulFrac,
    equals: equals, fracText: fracText, impText: impText, cancel: cancel,
    makeProblem: makeProblem, checkAnswer: checkAnswer, explain: explain, parseInput: parseInput,
    fracHTML: fracHTML, impHTML: impHTML, mathHTML: mathHTML, escapeHTML: escapeHTML,
    RESULT: RESULT, LEVELS: LEVELS, TYPES: TYPES, TYPE_NAMES: TYPE_NAMES, TRIPLE_SHAPES: TRIPLE_SHAPES,
    resetLast: function () { lastText = null; },
  };

  root.Fraction = Fraction;
  root.makeProblem = makeProblem;
  root.checkAnswer = checkAnswer;
  root.explain = explain;
  if (typeof module !== 'undefined' && module.exports) module.exports = Fraction;
})(typeof window !== 'undefined' ? window : globalThis);
