/**
 * settings.js — 설정 창 (기획서 5-8) 열고 닫기
 * 안의 컨트롤(유형 #typeSelect, 난이도 #levelGroup, 색칠 속도 #speedGroup, 처음부터 #btnReset)은 app.js가 그대로 다룬다.
 * 소리 켜기/끄기는 fx.js·title.js와 같은 localStorage 'jogakttang_sound'.
 */
(function () {
  'use strict';

  const SOUND_KEY = 'jogakttang_sound';
  const $ = function (id) { return document.getElementById(id); };
  const box = $('settings'), btnOpen = $('btnSettings'), btnOk = $('btnSettingsOk'), soundGroup = $('soundGroup');
  if (!box || !btnOpen || !btnOk) return;

  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch (e) { return true; }
  }
  function renderSound() {
    if (!soundGroup) return;
    soundGroup.querySelectorAll('.level-btn').forEach(function (b) {
      b.classList.toggle('active', (b.dataset.sound === '1') === soundOn());
    });
  }
  if (soundGroup) {
    soundGroup.addEventListener('click', function (e) {
      const b = e.target.closest('.level-btn');
      if (!b) return;
      try { localStorage.setItem(SOUND_KEY, b.dataset.sound === '1' ? '1' : '0'); } catch (err) { /* 저장 불가 */ }
      renderSound();
      // 상단 바·타이틀의 바늘 아이콘도 같이 맞춘다 (fx.js가 아이콘 클릭을 듣고 있으므로 클릭 대신 직접 표시)
      ['btnSoundTop', 'btnSound'].forEach(function (id) {
        const t = $(id);
        if (!t) return;
        t.setAttribute('aria-pressed', soundOn() ? 'true' : 'false');
        t.setAttribute('aria-label', soundOn() ? '소리 켜짐' : '소리 꺼짐');
        t.classList.toggle('off', !soundOn());
        t.dispatchEvent(new Event('sync'));
      });
    });
  }
  ['btnSoundTop', 'btnSound'].forEach(function (id) {
    const t = $(id);
    if (t) t.addEventListener('click', function () { setTimeout(renderSound, 0); });
  });

  let opener = null;
  function open() {
    opener = document.activeElement;
    renderSound();
    box.hidden = false;
    btnOk.focus();
  }
  function close() {
    box.hidden = true;
    if (opener && opener.focus) opener.focus();
  }
  btnOpen.addEventListener('click', open);
  btnOk.addEventListener('click', close);
  box.addEventListener('click', function (e) { if (e.target === box) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !box.hidden) { close(); e.preventDefault(); }
  });
  renderSound();
})();
