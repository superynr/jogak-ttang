/**
 * title.js — 타이틀 화면 전용 (게임 로직은 app.js, 여기서는 화면 보이기/숨기기만)
 * - 그림(title.webp)과 폰트가 다 준비되면 등장 애니메이션 시작
 * - 저장 기록이 있으면 '이어하기' 버튼과 진행 상황 표시
 * - 소리 켜기/끄기는 localStorage 'jogakttang_sound'
 * - '개척 시작'은 기록이 있을 때 app.js의 '처음부터' 버튼(확인창 포함)을 그대로 누른다
 */
(function () {
  'use strict';

  const SAVE_KEY = 'jogakttang_save_v1';
  const SOUND_KEY = 'jogakttang_sound';
  const OPENING_KEY = 'jogakttang_opening_seen';
  const VIDEO_SRC = 'assets/video/opening.webm';
  const VIDEO_WAIT_MS = 4000;        // 이 시간 안에 영상이 안 돌면 이야기 카드로
  // 타이틀 로딩 중에 미리 받아 두는 그림 (지도·타일·도깨비·이야기 카드). 나중에 회색 상자가 보이지 않게
  const PRELOAD = [
    'assets/map_bg.webp', 'assets/tile_empty.webp', 'assets/tile_ours.webp',
    'assets/goblin_1.webp', 'assets/goblin_2.webp', 'assets/goblin_3.webp',
    'assets/grandma.webp', 'assets/hero.webp', 'assets/boss_moon.webp',
  ];
  const preloaded = [];              // 참조를 붙들어 두어 브라우저가 버리지 않게
  const TARGET = 47;
  const NEEDLE_AT_MS = 800;          // 바늘이 지나가는 시각 (등장 애니메이션 기준)
  const LOAD_TIMEOUT_MS = 8000;      // 그림·폰트가 너무 늦으면 그냥 시작

  const $ = function (id) { return document.getElementById(id); };
  const title = $('titleScreen');
  if (!title) return;
  // 필요한 요소가 하나라도 없으면(옛 HTML이 캐시된 경우 등) 타이틀을 걷고 조용히 물러난다
  const REQUIRED = ['titleLoading', 'titleBgImg', 'btnStart', 'btnResume', 'resumeInfo', 'btnHowTo', 'btnHowToOk', 'howto',
    'btnSound', 'opening', 'openingVideo', 'openingStill', 'subLine', 'btnOpeningSkip'];
  if (REQUIRED.some(function (id) { return !$(id); })) { title.hidden = true; return; }

  const el = {
    loading: $('titleLoading'), bgImg: $('titleBgImg'),
    btnStart: $('btnStart'), btnResume: $('btnResume'), resumeInfo: $('resumeInfo'),
    btnHowTo: $('btnHowTo'), btnHowToOk: $('btnHowToOk'), howto: $('howto'),
    btnSound: $('btnSound'),
    opening: $('opening'), video: $('openingVideo'), still: $('openingStill'), subLine: $('subLine'),
    btnOpeningSkip: $('btnOpeningSkip'),
    behind: [document.querySelector('.topbar'), $('layout'), $('resultScreen')].filter(Boolean),
  };

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 저장 기록 ---------- */
  function readSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      return s && Array.isArray(s.grid) ? s : null;
    } catch (e) { return null; }
  }
  function progressOf(s) {
    const ours = s.grid.filter(function (c) { return c.state === 'ours'; }).length;
    const solved = s.stats && s.stats.solved ? s.stats.solved : 0;
    return { ours: ours, solved: solved };
  }
  function hasProgress(s) {
    if (!s) return false;
    const p = progressOf(s);
    return p.ours > 0 || p.solved > 0;
  }

  function renderResume() {
    const s = readSave();
    const show = hasProgress(s);
    el.btnResume.hidden = !show;
    if (show) el.resumeInfo.textContent = '꿰맨 조각 ' + progressOf(s).ours + '/' + TARGET;
  }

  /* ---------- 소리 설정 ---------- */
  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch (e) { return true; }
  }
  function renderSound() {
    const on = soundOn();
    el.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.btnSound.setAttribute('aria-label', on ? '소리 켜짐' : '소리 꺼짐');
    el.btnSound.classList.toggle('off', !on);
  }
  el.btnSound.addEventListener('click', function () {
    try { localStorage.setItem(SOUND_KEY, soundOn() ? '0' : '1'); } catch (e) { /* 저장 불가 */ }
    renderSound();
  });

  // 브라우저는 사용자 클릭이 있어야 소리를 낸다
  let userActed = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  document.addEventListener('pointerdown', function () { userActed = true; }, { once: true });
  document.addEventListener('keydown', function () { userActed = true; }, { once: true });

  function playStitchSound() {
    if (!soundOn() || !userActed) return;
    try {
      const a = new Audio('assets/sfx/correct.mp3');
      a.volume = 0.12;
      a.play().catch(function () { /* 자동 재생 막힘 */ });
    } catch (e) { /* 소리 없이 진행 */ }
  }

  /* ---------- 타이틀 뒤 화면은 잠시 조작 불가 ---------- */
  function setBehindInert(on) {
    el.behind.forEach(function (node) {
      if (on) node.setAttribute('inert', ''); else node.removeAttribute('inert');
    });
  }

  /* ---------- 로딩: 그림 + 폰트 ---------- */
  function whenImageLoaded(img) {
    return new Promise(function (resolve) {
      if (img.complete) { resolve(); return; }
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }
  function preloadImages() {
    return Promise.all(PRELOAD.map(function (src) {
      const img = new Image();
      img.src = src;
      preloaded.push(img);
      return whenImageLoaded(img);
    }));
  }
  function whenFontsLoaded() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('160px "Black Han Sans"'),
      document.fonts.load('40px "Jua"'),
      document.fonts.load('700 44px "Gaegu"'),        // 오프닝 마지막 자막 강조용
    ]).catch(function () { /* 폰트 없이 진행 */ });
  }
  function timeout(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  let started = false;
  function ready() {
    if (started) return;
    started = true;
    el.loading.hidden = true;
    title.classList.add('is-ready');
    if (!reduced) setTimeout(playStitchSound, NEEDLE_AT_MS);
    if (!openingSeen()) primeVideo();              // 오프닝을 아직 안 봤으면 영상을 미리 준비
  }

  /* ---------- 화면 전환 ---------- */
  function closeTitle() {
    title.classList.add('is-gone');
    setBehindInert(false);
    setTimeout(function () { title.hidden = true; }, 600);
  }

  /* ---------- 오프닝: 영상 + 장면에 맞춘 자막 (한 번만) ----------
   * 영상(8초) 실제 장면: 0~2.5초 낮의 조각보 왕국 → 2.6초 보름달, 도깨비 등장 → 4.1초 도깨비가 실을 당김
   *   → 4.3초 실이 터지며 조각이 흩어짐 → 5.4초 개척단(주인공과 친구들) → 8초 끝.
   * 자막 시각은 영상의 재생 시각(currentTime)을 따르므로, 영상이 늦게 시작하거나 중간에 버퍼링해도 어긋나지 않는다.
   * 영상이 끝나도 마지막 장면(개척단)을 멈춘 채 자막 4줄을 이어서 보여 준다. 영상이 없으면 타이틀 그림 위에 같은 자막.
   * 우리 배경음악은 오프닝 동안 쉬고(영상에 음악이 있음), 도깨비 등장과 개척단 등장 때만 짧은 큐를 얹는다. */
  const SUBS = [
    { at: 0.3,  end: 2.5,  text: '이 나라의 땅은 땅할머니가 짠 커다란 조각보였어요.' },
    { at: 2.7,  end: 4.9,  text: '나누기를 싫어하는 밭도깨비가 보름달 밤마다 실을 풀어 놓아요.' },
    { at: 5.0,  end: 8.4,  text: '바늘땀 주문은 \'얼마만큼\'을 정확히 말해야 걸려요. 가로 2/3, 세로 3/4이면 1/2!' },
    { at: 8.6,  end: 11.4, text: '개척단이 되어 조각을 다시 꿰매 주세요.', emph: true },   // 손글씨체로 강조
  ];
  const CUES = [
    { at: 2.6, name: 'dramatic' },   // 보름달·도깨비 등장
    { at: 5.4, name: 'bright' },     // 개척단 등장
  ];
  const OPENING_LEN = 12.0;          // 마지막 자막이 사라진 뒤 지도로

  let videoTimer = null, openingDone = null, seqRaf = 0, seqRunning = false;
  let subShown = -1, cueFired = 0;
  // 자막 시계: 영상이 도는 동안은 영상의 currentTime, 영상이 끝난 뒤(또는 정지 화면일 때)는 벽시계로 이어 간다
  let useVideoClock = false, clockBase = 0, clockAt = 0;
  function seqTime() {
    const v = el.video;
    if (useVideoClock && !v.ended && !v.error) {
      clockBase = v.currentTime; clockAt = performance.now();
      return clockBase;
    }
    return clockBase + (performance.now() - clockAt) / 1000;
  }

  function openingSeen() {
    try { return localStorage.getItem(OPENING_KEY) === '1'; } catch (e) { return false; }
  }
  function markOpeningSeen() {
    try { localStorage.setItem(OPENING_KEY, '1'); } catch (e) { /* 저장 불가 */ }
  }

  function startOpening(done) {
    openingDone = done;
    el.opening.hidden = false;
    el.opening.classList.remove('is-still');
    el.still.hidden = true;
    el.subLine.textContent = '';
    el.subLine.classList.remove('show');
    el.btnOpeningSkip.onclick = finishOpening;
    startVideo();
  }

  /**
   * 영상 미리 준비: 파일을 받고, 끝 근처로 한 번 탐색했다가 처음으로 되돌린다.
   * (이 파일은 그냥 재생하면 3.5초쯤에서 디코더가 멈추는데, 이렇게 한 번 훑어 두면 끝까지 정상 재생된다)
   * 타이틀이 준비될 때 미리 해 두어 '개척 시작'을 누르면 바로 나온다.
   */
  let priming = null;
  function primeVideo() {
    if (priming) return priming;
    const v = el.video;
    priming = new Promise(function (resolve) {
      let done = false;
      function finish(ok) { if (done) return; done = true; v.onerror = v.onloadedmetadata = v.onseeked = null; resolve(ok); }
      function seek(t, cb) {
        let fired = false;
        v.onseeked = function () { if (!fired) { fired = true; cb(); } };
        setTimeout(function () { if (!fired) { fired = true; cb(); } }, 1500);
        v.currentTime = t;
      }
      v.onerror = function () { finish(false); };
      v.onloadedmetadata = function () {
        seek(Math.max(0, v.duration - 0.1), function () { seek(0, function () { finish(true); }); });
      };
      v.preload = 'auto';
      v.src = VIDEO_SRC;
      v.load();
      setTimeout(function () { finish(false); }, VIDEO_WAIT_MS);
    });
    return priming;
  }

  function startVideo() {
    const v = el.video;
    let decided = false;
    function useStill() {                           // 파일이 없거나 못 돌림 → 타이틀 그림 위에 자막만
      if (decided) return;
      decided = true;
      clearTimeout(videoTimer);
      v.onplaying = v.onerror = null;
      try { v.pause(); } catch (e) { /* 무시 */ }
      v.removeAttribute('src'); v.load();
      priming = null;
      el.opening.classList.add('is-still');
      el.still.hidden = false;
      runSequence(false);
    }
    videoTimer = setTimeout(useStill, VIDEO_WAIT_MS);
    primeVideo().then(function (ok) {
      if (decided) return;
      if (!ok) { useStill(); return; }
      v.onerror = useStill;
      v.onplaying = function () {
        if (decided) return;
        decided = true;
        clearTimeout(videoTimer);
        runSequence(true);
      };
      v.muted = !soundOn();                          // 영상에 든 음악은 소리 설정을 따른다
      v.volume = 0.9;
      const p = v.play();
      if (p && p.catch) p.catch(function () {
        v.muted = true;                              // 소리 때문에 막혔으면 무음으로 한 번 더
        const q = v.play();
        if (q && q.catch) q.catch(useStill);
      });
    });
  }

  /** 자막·큐를 시계에 맞춰 보여 준다 (withVideo: 영상 재생 시각을 기준으로 삼을지) */
  function runSequence(withVideo) {
    useVideoClock = !!withVideo;
    clockBase = 0; clockAt = performance.now();
    seqRunning = true;
    subShown = -1; cueFired = 0;
    if (reduced) {                                   // 움직임 줄이기: 자막을 4줄 한꺼번에
      el.subLine.innerHTML = SUBS.map(function (s) { return '<span class="sub-all' + (s.emph ? ' emph' : '') + '">' + s.text + '</span>'; }).join('');
      el.subLine.classList.add('show');
    }
    function frame() {
      if (!seqRunning) return;
      const t = seqTime();
      if (!reduced) {
        let cur = -1;
        for (let i = 0; i < SUBS.length; i++) if (t >= SUBS[i].at && t < SUBS[i].end) cur = i;
        if (cur !== subShown) {
          subShown = cur;
          if (cur < 0) el.subLine.classList.remove('show');
          else {
            el.subLine.textContent = SUBS[cur].text;
            el.subLine.classList.toggle('emph', !!SUBS[cur].emph);
            el.subLine.classList.add('show');
          }
        }
      }
      while (cueFired < CUES.length && t >= CUES[cueFired].at) {
        if (window.JogakBGM && window.JogakBGM.cue) window.JogakBGM.cue(CUES[cueFired].name);
        cueFired++;
      }
      if (t >= OPENING_LEN) { finishOpening(); return; }
      seqRaf = requestAnimationFrame(frame);
    }
    seqRaf = requestAnimationFrame(frame);
  }

  function finishOpening() {
    if (!seqRunning && el.opening.hidden) return;
    seqRunning = false;
    cancelAnimationFrame(seqRaf);
    clearTimeout(videoTimer);
    if (window.JogakBGM && window.JogakBGM.cue) window.JogakBGM.cue('stop');
    markOpeningSeen();
    el.opening.classList.add('is-gone');
    setBehindInert(false);
    setTimeout(function () {
      try { el.video.pause(); } catch (e) { /* 무시 */ }
      el.video.removeAttribute('src'); el.video.load();
      priming = null;
      el.opening.hidden = true;
      el.opening.classList.remove('is-gone', 'is-still');
      el.subLine.textContent = '';
      el.subLine.classList.remove('show', 'emph');
    }, 500);
    if (openingDone) openingDone();
  }

  document.addEventListener('keydown', function (e) {
    if (el.opening.hidden) return;
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { finishOpening(); e.preventDefault(); }
  });

  /** 새 게임 시작: 오프닝을 아직 안 봤으면 영상·이야기부터, 봤으면 바로 지도 */
  function beginNewGame() {
    title.classList.add('is-gone');
    setTimeout(function () { title.hidden = true; }, 600);
    if (openingSeen()) { setBehindInert(false); return; }
    startOpening(null);                             // 끝나면 finishOpening이 inert를 푼다
  }

  el.btnStart.addEventListener('click', function () {
    const s = readSave();
    if (hasProgress(s)) {
      // 기록이 있으면 app.js의 '처음부터'를 그대로 누른다 (확인창은 app.js가 띄움)
      const before = s.startedAt;
      const reset = $('btnReset');
      if (reset) reset.click();
      const after = readSave();
      if (after && after.startedAt === before) { renderResume(); return; }   // 취소함 → 타이틀에 남음
    }
    beginNewGame();
  });
  el.btnResume.addEventListener('click', closeTitle);

  /* ---------- 게임 방법 ---------- */
  let howtoOpener = null;
  function openHowTo() {
    howtoOpener = document.activeElement;
    el.howto.hidden = false;
    el.btnHowToOk.focus();
  }
  function closeHowTo() {
    el.howto.hidden = true;
    if (howtoOpener && howtoOpener.focus) howtoOpener.focus();
  }
  el.btnHowTo.addEventListener('click', openHowTo);
  el.btnHowToOk.addEventListener('click', closeHowTo);
  el.howto.addEventListener('click', function (e) { if (e.target === el.howto) closeHowTo(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.howto.hidden) { closeHowTo(); e.preventDefault(); }
  });

  /* ---------- 시작 ---------- */
  setBehindInert(true);
  renderResume();
  renderSound();
  Promise.race([
    Promise.all([whenImageLoaded(el.bgImg), whenFontsLoaded(), preloadImages()]),
    timeout(LOAD_TIMEOUT_MS),
  ]).then(ready);
})();
