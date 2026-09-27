/**
 * fx.js — 문제 패널 연출 전용 (게임 로직은 app.js)
 * - 효과음: 정답 correct.mp3 / 오답 wrong.mp3 / 꿰맴 capture.mp3(map.js가 부름) / 도깨비 퇴치 boss.mp3
 *   첫 사용자 클릭 이후에만 재생. 켜기/끄기는 localStorage 'jogakttang_sound' (타이틀 화면과 같은 키)
 * - 도깨비 전투 상자: app.js가 패널에 적어 두는 data-phase / data-boss-hp / data-boss-region을 읽어 그린다
 */
(function () {
  'use strict';

  const SOUND_KEY = 'jogakttang_sound';
  const FILES = {
    correct: 'assets/sfx/correct.mp3',
    wrong: 'assets/sfx/wrong.mp3',
    capture: 'assets/sfx/capture.mp3',
    boss: 'assets/sfx/boss.mp3',
  };
  const VOLUME = { correct: .5, wrong: .5, capture: .6, boss: .7 };
  const TAIL = { capture: 3 };       // 파일 뒤쪽 몇 초만 재생 (capture.mp3는 7.7초라 길다)
  const FADE_IN_MS = 150;            // 중간부터 시작할 때 툭 끊겨 들리지 않게
  const BOSS_HP = 5;

  const $ = function (id) { return document.getElementById(id); };
  const panel = $('problemPanel');
  const box = $('bossBox'), bossImg = $('bossImg'), bossName = $('bossName'), bossHp = $('bossHp'), bossSay = $('bossSay');
  const btnTop = $('btnSoundTop'), btnTitle = $('btnSound');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 소리 ---------- */
  let userActed = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  document.addEventListener('pointerdown', function () { userActed = true; }, { once: true, capture: true });
  document.addEventListener('keydown', function () { userActed = true; }, { once: true, capture: true });

  const audio = {};
  function get(name) {
    if (!audio[name]) {
      const a = new Audio(FILES[name]);
      a.preload = 'auto';
      audio[name] = a;
    }
    return audio[name];
  }
  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch (e) { return true; }
  }
  const fades = {};
  function fadeIn(a, name, target) {
    clearInterval(fades[name]);
    const steps = Math.max(1, Math.round(FADE_IN_MS / 25));
    let i = 0;
    a.volume = 0;
    fades[name] = setInterval(function () {
      i++;
      a.volume = Math.min(target, target * i / steps);
      if (i >= steps) clearInterval(fades[name]);
    }, 25);
  }
  function play(name) {
    if (!FILES[name] || !soundOn() || !userActed) return;
    try {
      const a = get(name);
      const tail = TAIL[name];
      function go() {
        const from = tail && isFinite(a.duration) && a.duration > tail ? a.duration - tail : 0;
        a.currentTime = from;
        if (from > 0) fadeIn(a, name, VOLUME[name]); else { clearInterval(fades[name]); a.volume = VOLUME[name]; }
        const p = a.play();
        if (p && p.catch) p.catch(function () { /* 자동 재생 막힘 */ });
      }
      if (tail && !isFinite(a.duration)) {        // 길이를 아직 모르면 알게 된 뒤에
        a.addEventListener('loadedmetadata', go, { once: true });
        a.load();
      } else go();
    } catch (e) { /* 소리 없이 진행 */ }
  }
  window.JogakSound = { play: play, isOn: soundOn, _get: get };

  function renderSoundButtons() {
    const on = soundOn();
    [btnTop, btnTitle].forEach(function (b) {
      if (!b) return;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? '소리 켜짐' : '소리 꺼짐');
      b.classList.toggle('off', !on);
    });
  }
  if (btnTop) {
    btnTop.addEventListener('click', function () {
      try { localStorage.setItem(SOUND_KEY, soundOn() ? '0' : '1'); } catch (e) { /* 저장 불가 */ }
      renderSoundButtons();
      if (soundOn()) play('correct');          // 켤 때 한 번 들려줌
    });
  }
  if (btnTitle) btnTitle.addEventListener('click', function () { setTimeout(renderSoundButtons, 0); });
  if (btnTop) btnTop.addEventListener('sync', renderSoundButtons);   // 설정 창에서 바꿨을 때
  renderSoundButtons();

  /* ---------- 도깨비 전투 상자 ---------- */
  const SAY = {
    idle: '"분수를 곱하면 항상 커진다구!"',
    hit: '"으악, 작아졌잖아…!"',
    heal: '"거 봐, 내 말이 맞지?"',
    down: '"내가… 틀렸다니…!"',
  };
  let pulseTimer = null;
  function pulse(cls, ms) {
    box.classList.remove('pushed', 'step');
    void box.offsetWidth;                      // 같은 연출을 연달아 다시 재생
    box.classList.add(cls);
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(function () { box.classList.remove(cls); }, ms);
  }

  function renderBoss(hp, region) {
    box.hidden = false;
    const src = 'assets/goblin_' + region + '.webp';
    if (bossImg.getAttribute('src') !== src) bossImg.src = src;
    bossName.textContent = region + '지역 밭도깨비';
    box.style.setProperty('--hp', hp);
    let s = '';
    for (let i = 0; i < BOSS_HP; i++) s += '<span class="hp-cell' + (i < hp ? ' on' : '') + '"></span>';
    bossHp.innerHTML = s;
    bossHp.setAttribute('aria-label', '도깨비 HP ' + hp + ' / ' + BOSS_HP);
  }

  let prevPhase = panel.dataset.phase || 'idle';
  let prevBoss = panel.dataset.bossHp;

  function update() {
    const phase = panel.dataset.phase || 'idle';
    const hpStr = panel.dataset.bossHp;
    const region = panel.dataset.bossRegion;
    const inBoss = hpStr !== undefined;
    const hp = inBoss ? Number(hpStr) : null;

    // 효과음: 단계가 바뀔 때만
    if (phase !== prevPhase) {
      if ((phase === 'correct' || phase === 'convert') && prevPhase !== 'convert') play('correct');
      else if (phase === 'wrong') play('wrong');
    }

    // 도깨비 상자
    if (!inBoss) {
      if (prevBoss !== undefined) { box.hidden = true; box.classList.remove('pushed', 'step', 'vanish'); bossSay.textContent = SAY.idle; }
    } else {
      const wasIn = prevBoss !== undefined;
      renderBoss(hp, region);
      if (phase !== prevPhase && wasIn) {
        if (phase === 'correct' || phase === 'convert') {
          if (hp === 0) { box.classList.add('vanish'); bossSay.textContent = SAY.down; play('boss'); }
          else if (prevPhase !== 'convert') { pulse('pushed', 600); bossSay.textContent = SAY.hit; }
        } else if (phase === 'wrong') { pulse('step', 600); bossSay.textContent = SAY.heal; }
        else if (phase === 'input') { bossSay.textContent = SAY.idle; }
      }
      if (!wasIn) { box.classList.remove('pushed', 'step', 'vanish'); bossSay.textContent = hp === 0 ? SAY.down : SAY.idle; }
      if (reduced) box.classList.remove('pushed', 'step');
    }

    prevPhase = phase;
    prevBoss = hpStr;
  }

  new MutationObserver(update).observe(panel, { attributes: true, attributeFilter: ['data-phase', 'data-boss-hp', 'data-boss-region'] });
  update();
})();
