/**
 * bgm.js — 배경음악 (타이틀 화면 · 오프닝 · 문제 풀 때)
 * - Web Audio로 실시간 합성하는 곡 (파일 없음, 끊김 없이 무한 반복)
 *   116bpm · C장조 · 화음 C → G → Am → F · 통통 튀는 아르페지오 · 가벼운 킥/셰이커 · 펜타토닉 멜로디
 *   4마디마다 아르페지오 패턴이 바뀌고, 8마디째 끝에는 멜로디가 위로 달려 올라간다
 * - 나중에 만든 음악 파일을 쓰려면 BGM_FILE에 경로를 적는다 (예: 'assets/bgm/lively.mp3')
 * - 흐르는 곳: 타이틀 화면이 보일 때, 오프닝(영상·이야기 카드), 문제 패널이 열려 있을 때. 지도만 볼 때는 조용히
 * - 소리 켜기/끄기(localStorage 'jogakttang_sound')를 따르고, 브라우저 정책상 첫 사용자 조작 뒤에만 소리가 난다
 */
(function () {
  'use strict';

  const BGM_FILE = '';               // 음악 파일 경로. 비워 두면 합성 곡
  const SOUND_KEY = 'jogakttang_sound';
  const VOLUME = 0.24;               // 효과음보다 작게
  const FADE_IN = 1.2, FADE_OUT = 1.6;

  const panel = document.getElementById('problemPanel');
  const title = document.getElementById('titleScreen');
  const opening = document.getElementById('opening');
  if (!panel) return;

  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch (e) { return true; }
  }

  /* ===================== 파일 재생 ===================== */
  let fileAudio = null, fileRamp = null;
  function rampFile(target, sec, done) {
    clearInterval(fileRamp);
    const from = fileAudio.volume, steps = Math.max(1, Math.round(sec * 20));
    let i = 0;
    fileRamp = setInterval(function () {
      i++;
      fileAudio.volume = from + (target - from) * (i / steps);
      if (i >= steps) { clearInterval(fileRamp); if (done) done(); }
    }, 50);
  }
  function fileStart() {
    if (!fileAudio) { fileAudio = new Audio(BGM_FILE); fileAudio.loop = true; fileAudio.volume = 0; }
    const p = fileAudio.play();
    if (p && p.catch) p.catch(function () { /* 자동 재생 막힘 */ });
    rampFile(VOLUME, FADE_IN);
  }
  function fileStop() {
    if (!fileAudio) return;
    rampFile(0, FADE_OUT, function () { fileAudio.pause(); });
  }

  /* ===================== 합성 곡 ===================== */
  const TEMPO = 116, BEAT = 60 / TEMPO, EIGHTH = BEAT / 2;
  const STEPS_PER_BAR = 8;                              // 8분음표 8개 = 한 마디
  // 화음 (MIDI): C E G / G B D / A C E / F A C — 한 마디씩. 두 바퀴째는 끝을 G로 바꿔 긴장감
  const PROG_A = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]];
  const PROG_B = [[60, 64, 67], [59, 62, 67], [57, 60, 65], [59, 62, 67]];
  const SCALE = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93];  // C 펜타토닉 (C5~A6)
  // 아르페지오 패턴 (화음 음 번호, 3 = 밑음 한 옥타브 위, 4 = 두 번째 음 한 옥타브 위)
  const ARP_A = [0, 1, 2, 3, 2, 1, 2, 4];
  const ARP_B = [0, 2, 1, 3, 0, 2, 4, 3];
  // 멜로디 리듬 (2마디 = 16개 8분음표), 1이면 연주
  const RHYTHM = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0];

  let ctx = null, master = null, padBus = null, melBus = null, arpBus = null, drumBus = null, delayNode = null, reverb = null;
  let timer = null, nextTime = 0, step = 0, melIdx = 3, lastBar = -1, running = false, noiseBuf = null;

  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function impulse(seconds, decay) {
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function noise(seconds) {
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function setup() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    master.connect(lp); lp.connect(ctx.destination);

    reverb = ctx.createConvolver(); reverb.buffer = impulse(1.8, 3.5);
    const revGain = ctx.createGain(); revGain.gain.value = .3;
    reverb.connect(revGain); revGain.connect(master);
    delayNode = ctx.createDelay(2); delayNode.delayTime.value = BEAT * .75;
    const fb = ctx.createGain(); fb.gain.value = .22;
    const delayWet = ctx.createGain(); delayWet.gain.value = .16;
    delayNode.connect(fb); fb.connect(delayNode); delayNode.connect(delayWet); delayWet.connect(master);

    padBus = ctx.createGain();
    const padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 1800;
    padBus.connect(padLp); padLp.connect(master); padLp.connect(reverb);

    arpBus = ctx.createGain(); arpBus.connect(master); arpBus.connect(reverb); arpBus.connect(delayNode);
    melBus = ctx.createGain(); melBus.connect(master); melBus.connect(reverb); melBus.connect(delayNode);
    drumBus = ctx.createGain(); drumBus.gain.value = .9; drumBus.connect(master);
    noiseBuf = noise(1);
    return true;
  }

  /** 패드: 한 마디 동안 살짝 어긋난 삼각파, 빠르게 올라오고 마디 끝에 사라짐 */
  function playPad(chord, t, dur) {
    chord.forEach(function (midi, k) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(k === 0 ? .05 : .04, t + .25);
      g.gain.setValueAtTime(k === 0 ? .05 : .04, t + dur - .4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      g.connect(padBus);
      [-6, 6].forEach(function (cents) {
        const o = ctx.createOscillator();
        o.type = 'triangle'; o.frequency.value = hz(midi); o.detune.value = cents;
        o.connect(g); o.start(t); o.stop(t + dur + .05);
      });
    });
  }

  /** 베이스: 짧고 둥근 소리 */
  function playBass(midi, t, len, vel) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + .015);
    g.gain.exponentialRampToValueAtTime(.001, t + len);
    g.connect(master);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(midi);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = hz(midi);
    const g2 = ctx.createGain(); g2.gain.value = .35;
    o.connect(g); o2.connect(g2); g2.connect(g);
    o.start(t); o.stop(t + len + .05); o2.start(t); o2.stop(t + len + .05);
  }

  /** 아르페지오: 마림바처럼 톡톡 튀는 짧은 소리 */
  function playPluck(midi, t, vel) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + .006);
    g.gain.exponentialRampToValueAtTime(.001, t + .38);
    g.connect(arpBus);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(midi);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = hz(midi) * 4;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(.25, t); g2.gain.exponentialRampToValueAtTime(.01, t + .12);
    o.connect(g); o2.connect(g2); g2.connect(g);
    o.start(t); o.stop(t + .45); o2.start(t); o2.stop(t + .45);
  }

  /** 멜로디: 피리 같은 소리에 살짝 비브라토 */
  function playLead(midi, t, len, vel) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + .03);
    g.gain.setValueAtTime(vel, t + len * .6);
    g.gain.exponentialRampToValueAtTime(.001, t + len + .25);
    g.connect(melBus);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(midi);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = hz(midi) * 2;
    const g2 = ctx.createGain(); g2.gain.value = .18;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vibG = ctx.createGain(); vibG.gain.value = 4;
    vib.connect(vibG); vibG.connect(o.detune);
    o.connect(g); o2.connect(g2); g2.connect(g);
    o.start(t); o.stop(t + len + .3); o2.start(t); o2.stop(t + len + .3); vib.start(t); vib.stop(t + len + .3);
  }

  /* 타악: 부드러운 킥, 셰이커, 살짝 두드리는 림 */
  function playKick(t, vel) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .16);
    g.connect(drumBus);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + .12);
    o.connect(g); o.start(t); o.stop(t + .2);
  }
  function playShaker(t, vel) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .05);
    s.connect(f); f.connect(g); g.connect(drumBus);
    s.start(t); s.stop(t + .07);
  }
  function playRim(t, vel) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .04);
    s.connect(f); f.connect(g); g.connect(drumBus);
    s.start(t); s.stop(t + .06);
  }

  function inChord(midi, chord) {
    return chord.some(function (c) { return (c - midi) % 12 === 0; });
  }

  /** 8분음표 하나를 예약한다 */
  function scheduleStep(s, t) {
    const bar = Math.floor(s / STEPS_PER_BAR), pos = s % STEPS_PER_BAR;
    const round = Math.floor(bar / 4) % 2;                      // 4마디씩 A, B
    const prog = round === 0 ? PROG_A : PROG_B;
    const chord = prog[bar % 4];
    const arp = Math.floor(bar / 4) % 2 === 0 ? ARP_A : ARP_B;
    const barIn8 = bar % 8;                                     // 8마디 단위 흐름
    const tail = barIn8 === 7 && pos >= 4;                      // 8마디째 마지막 두 박: 멜로디 런

    if (bar !== lastBar) {
      lastBar = bar;
      playPad(chord, t, BEAT * 4 + .05);
    }

    // 베이스: 1박 밑음, 2박 뒤 밑음(짧게), 3박 5도, 4박 뒤 밑음
    const root = chord[0] - 24, fifth = chord[2] - 24;
    if (pos === 0) playBass(root, t, .42, .22);
    else if (pos === 3) playBass(root, t, .22, .14);
    else if (pos === 4) playBass(fifth, t, .42, .18);
    else if (pos === 7) playBass(root + 12, t, .2, .12);

    // 타악
    if (pos === 0 || pos === 4) playKick(t, .5);
    if (pos === 6 && bar % 2 === 1) playKick(t, .3);
    playShaker(t, pos % 2 === 1 ? .16 : .08);
    if (pos === 2 || pos === 6) playRim(t, .12);

    // 아르페지오 (8분음표마다), 8마디째 런 구간은 쉼
    if (!tail) {
      const k = arp[pos];
      const midi = k < 3 ? chord[k] : chord[k - 3] + 12;
      playPluck(midi, t, pos === 0 ? .15 : .11);
    }

    // 멜로디
    if (tail) {
      // 위로 달려 올라가는 4음
      const runIdx = Math.min(SCALE.length - 1, 2 + (pos - 4) * 2);
      playLead(SCALE[runIdx], t, EIGHTH * .9, .1);
      melIdx = runIdx;
      return;
    }
    if (barIn8 === 0 && pos < 2 && round === 1) return;            // B 바퀴 첫 마디 시작은 잠깐 숨 고르기
    const r = RHYTHM[s % 16];
    if (r) {
      let idx = melIdx + Math.round((Math.random() - .45) * 4);   // -2 ~ +2, 살짝 위로 가려는 경향
      if (idx > SCALE.length - 2 && Math.random() < .6) idx -= 4; // 너무 높아지면 내려온다
      idx = Math.max(0, Math.min(SCALE.length - 1, idx));
      if (pos % 2 === 0) {                                         // 정박에는 화음 음으로
        for (let d = 0; d <= 2; d++) {
          if (idx + d < SCALE.length && inChord(SCALE[idx + d], chord)) { idx += d; break; }
          if (idx - d >= 0 && inChord(SCALE[idx - d], chord)) { idx -= d; break; }
        }
      }
      melIdx = idx;
      const nextRest = RHYTHM[(s + 1) % 16] === 0;
      playLead(SCALE[idx], t, nextRest ? EIGHTH * 1.7 : EIGHTH * .85, pos === 0 ? .13 : .1);
    }
  }

  function tick() {
    while (nextTime < ctx.currentTime + .5) {
      scheduleStep(step, nextTime);
      step++;
      nextTime += EIGHTH;
    }
  }

  function synthStart() {
    if (!ctx && !setup()) return;
    if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(function () { /* 조작 전 */ }); }
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(VOLUME, now + FADE_IN);
    if (!running) {
      running = true;
      nextTime = now + .1; lastBar = -1;
      tick();
      timer = setInterval(tick, 120);
    }
  }
  function synthStop() {
    if (!ctx || !running) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + FADE_OUT);
    clearInterval(timer);
    running = false;
    setTimeout(function () { if (!running && ctx) ctx.suspend(); }, FADE_OUT * 1000 + 100);
  }

  /* ===================== 어디서 흐를지 ===================== */
  let userActed = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  let want = false, on = false;

  function start() { if (on) return; on = true; if (BGM_FILE) fileStart(); else synthStart(); }
  function stop() { if (!on) return; on = false; if (BGM_FILE) fileStop(); else synthStop(); }

  function visible(el) { return !!el && !el.hidden && !el.classList.contains('is-gone'); }
  function sceneWantsMusic() {
    if (visible(opening)) return false;                                         // 오프닝: 영상 음악 + 큐만
    if (visible(title) && title.classList.contains('is-ready')) return true;   // 타이틀 (로딩 끝난 뒤)
    return (panel.dataset.phase || 'idle') !== 'idle';                          // 문제 풀 때
  }

  /* ===================== 오프닝 큐 (배경음악과 별개로 짧게) ===================== */
  let cueBus = null, cueNodes = [];
  function cueSetup() {
    if (!ctx && !setup()) return false;
    if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(function () { /* 조작 전 */ }); }
    if (!cueBus) { cueBus = ctx.createGain(); cueBus.gain.value = .5; cueBus.connect(ctx.destination); cueBus.connect(reverb); }
    return true;
  }
  function cueStop() {
    if (!cueBus) return;
    const now = ctx.currentTime;
    cueBus.gain.cancelScheduledValues(now);
    cueBus.gain.setValueAtTime(cueBus.gain.value, now);
    cueBus.gain.linearRampToValueAtTime(0, now + .4);
    const nodes = cueNodes; cueNodes = [];
    setTimeout(function () {
      nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* 이미 끝남 */ } });
      if (cueBus) cueBus.gain.setValueAtTime(.5, ctx.currentTime);
    }, 450);
  }
  function keep(node) { cueNodes.push(node); return node; }

  /** 도깨비 등장: 낮은 북 울림, 팽팽한 단조 화음(Am → E), 떨리는 현, 위로 치솟는 바람 소리. 약 3.4초 */
  function cueDramatic() {
    const t0 = ctx.currentTime + .05;
    // 북: 사인파가 뚝 떨어지며 울린다
    [0, .55, 1.1, 1.65, 2.2, 2.5, 2.75, 3.0].forEach(function (d, i) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(i >= 5 ? .55 : .7, t0 + d);
      g.gain.exponentialRampToValueAtTime(.001, t0 + d + .45);
      g.connect(cueBus);
      const o = keep(ctx.createOscillator()); o.type = 'sine';
      o.frequency.setValueAtTime(95, t0 + d); o.frequency.exponentialRampToValueAtTime(38, t0 + d + .3);
      o.connect(g); o.start(t0 + d); o.stop(t0 + d + .5);
    });
    // 팽팽한 화음: Am(A2 C3 E3) 1.7초 → E(E2 G#2 B2) 1.7초, 톱니파를 낮게 걸러서
    [[45, 48, 52, 0], [40, 44, 47, 1.7]].forEach(function (ch) {
      const at = t0 + ch[3], dur = 1.75;
      ch.slice(0, 3).forEach(function (midi) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, at); f.frequency.linearRampToValueAtTime(1100, at + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(.09, at + .35);
        g.gain.setValueAtTime(.09, at + dur - .25); g.gain.linearRampToValueAtTime(0, at + dur);
        f.connect(g); g.connect(cueBus);
        [-7, 7].forEach(function (c) {
          const o = keep(ctx.createOscillator()); o.type = 'sawtooth'; o.frequency.value = hz(midi); o.detune.value = c;
          o.connect(f); o.start(at); o.stop(at + dur + .05);
        });
      });
    });
    // 떨리는 현: 16분음표로 되풀이되는 짧은 음, 점점 커진다 (A4 → E5)
    const SIX = BEAT / 4;
    for (let i = 0; i < 22; i++) {
      const at = t0 + .3 + i * SIX, midi = i < 11 ? 69 : 76, vel = .04 + i * .006;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vel, at + .01); g.gain.exponentialRampToValueAtTime(.001, at + SIX * .95);
      g.connect(cueBus);
      const o = keep(ctx.createOscillator()); o.type = 'triangle'; o.frequency.value = hz(midi);
      o.connect(g); o.start(at); o.stop(at + SIX);
    }
    // 치솟는 바람: 잡음을 좁게 걸러 높이 올린다
    const s = keep(ctx.createBufferSource()); s.buffer = noiseBuf; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(180, t0); bp.frequency.exponentialRampToValueAtTime(3800, t0 + 3.2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(.12, t0 + 2.8); ng.gain.linearRampToValueAtTime(0, t0 + 3.4);
    s.connect(bp); bp.connect(ng); ng.connect(cueBus);
    s.start(t0); s.stop(t0 + 3.5);
  }

  /** 개척단 등장: 밝게 풀리는 C장조 화음, 종소리 아르페지오, 살짝 부푸는 패드. 약 2.5초 */
  function cueBright() {
    const t0 = ctx.currentTime + .05;
    [60, 64, 67, 72, 76, 79, 84].forEach(function (midi, i) {
      const at = t0 + i * .07;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(.16, at + .01); g.gain.exponentialRampToValueAtTime(.001, at + 1.6);
      g.connect(cueBus);
      const o = keep(ctx.createOscillator()); o.type = 'sine'; o.frequency.value = hz(midi);
      const o2 = keep(ctx.createOscillator()); o2.type = 'sine'; o2.frequency.value = hz(midi) * 3;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(.2, at); g2.gain.exponentialRampToValueAtTime(.01, at + .3);
      o.connect(g); o2.connect(g2); g2.connect(g);
      o.start(at); o.stop(at + 1.7); o2.start(at); o2.stop(at + 1.7);
    });
    [48, 55, 64, 67].forEach(function (midi) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.07, t0 + .5); g.gain.setValueAtTime(.07, t0 + 1.6); g.gain.linearRampToValueAtTime(0, t0 + 2.5);
      g.connect(cueBus);
      [-5, 5].forEach(function (c) {
        const o = keep(ctx.createOscillator()); o.type = 'triangle'; o.frequency.value = hz(midi); o.detune.value = c;
        o.connect(g); o.start(t0); o.stop(t0 + 2.6);
      });
    });
    // 반짝임: 짧은 잡음 한 번
    const s = keep(ctx.createBufferSource()); s.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(.1, t0); ng.gain.exponentialRampToValueAtTime(.001, t0 + .5);
    s.connect(hp); hp.connect(ng); ng.connect(cueBus); s.start(t0); s.stop(t0 + .5);
  }

  function cue(name) {
    if (name === 'stop') { cueStop(); return; }
    if (!soundOn() || !userActed || BGM_FILE) return;     // 파일 음악을 쓸 때는 큐도 쉰다
    if (!cueSetup()) return;
    cueBus.gain.cancelScheduledValues(ctx.currentTime);
    cueBus.gain.setValueAtTime(.5, ctx.currentTime);
    if (name === 'dramatic') cueDramatic();
    else if (name === 'bright') cueBright();
  }
  function evaluate() {
    want = sceneWantsMusic() && soundOn() && !document.hidden && userActed;
    if (want) start(); else stop();
  }

  const obs = new MutationObserver(evaluate);
  obs.observe(panel, { attributes: true, attributeFilter: ['data-phase'] });
  if (title) obs.observe(title, { attributes: true, attributeFilter: ['hidden', 'class'] });
  if (opening) obs.observe(opening, { attributes: true, attributeFilter: ['hidden', 'class'] });
  document.addEventListener('visibilitychange', evaluate);
  ['btnSoundTop', 'btnSound'].forEach(function (id) {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('click', function () { setTimeout(evaluate, 0); });
    b.addEventListener('sync', function () { setTimeout(evaluate, 0); });   // 설정 창에서 바꿨을 때
  });
  // 브라우저는 사용자 조작 뒤에만 소리를 낸다: 화면 어디든 처음 건드리면 그때부터
  function acted() {
    userActed = true;
    if (ctx && ctx.state === 'suspended' && on) ctx.resume();
    evaluate();
  }
  document.addEventListener('pointerdown', acted, { capture: true });
  document.addEventListener('keydown', acted, { capture: true });

  window.JogakBGM = {
    cue: cue,
    state: function () { return { on: on, want: want, ctx: ctx ? ctx.state : null, gain: master ? master.gain.value : null, step: step, tempo: TEMPO, cueNodes: cueNodes.length }; },
  };
  evaluate();
})();
