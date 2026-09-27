/**
 * map.js — 지도 화면 꾸미기 전용 (게임 로직은 app.js, 여기서는 연출만)
 * - 칸이 '우리 조각'이 되는 순간: 둘레를 따라 실이 한 바퀴 그려지고, 바랜 천이 꿰맨 천으로 바뀌며 반짝이 6개
 * - 밭도깨비 칸: 풀린 실처럼 흐트러진 점선 테두리
 * app.js는 render()마다 칸의 className을 통째로 다시 쓰므로, 여기서는 class 대신 자식 요소만 붙인다.
 */
(function () {
  'use strict';

  const grid = document.getElementById('grid');
  if (!grid) return;
  const cells = Array.prototype.slice.call(grid.querySelectorAll('.cell'));
  if (!cells.length) return;

  const BOSS_CELLS = [0, 3, 6];      // app.js와 같은 자리 (맨 윗줄 1열·4열·7열)
  const SEW_MS = 400;                // 실이 한 바퀴 도는 시간
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isOurs(cell) { return cell.classList.contains('ours'); }

  /* ---------- 키보드: 고를 수 있는 칸을 Tab으로 옮겨 다니고 Enter/Space로 고른다 ---------- */
  const COLS = 8;
  function cellLabel(d) {
    const i = Number(d.dataset.index);
    const where = (Math.floor(i / COLS) + 1) + '행 ' + (i % COLS + 1) + '열';
    return where + (d.classList.contains('boss') ? ' 밭도깨비' : d.classList.contains('filling') ? ' 꿰매는 중인 조각' : ' 풀린 조각');
  }
  function syncFocusable(d) {
    if (d.classList.contains('clickable')) {
      if (d.getAttribute('tabindex') !== '0') { d.setAttribute('tabindex', '0'); d.setAttribute('role', 'button'); }
      d.setAttribute('aria-label', cellLabel(d));
    } else if (d.hasAttribute('tabindex')) {
      d.removeAttribute('tabindex'); d.removeAttribute('role'); d.removeAttribute('aria-label');
    }
  }
  cells.forEach(syncFocusable);
  grid.addEventListener('keydown', function (e) {
    const d = e.target.closest && e.target.closest('.cell');
    if (!d || !d.classList.contains('clickable')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();          // app.js의 Enter(확인)까지 가지 않게
      d.click();
    }
  });

  /* ---------- 도깨비 칸: 풀린 실 테두리 ---------- */
  BOSS_CELLS.forEach(function (i) {
    const d = cells[i];
    if (!d) return;
    d.insertAdjacentHTML('beforeend',
      '<svg class="boss-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'
      + '<rect x="3" y="3" width="94" height="94" rx="3" pathLength="100"/>'
      + '<path class="loose" d="M 3 30 C -4 36, 8 44, 1 52"/>'
      + '<path class="loose" d="M 70 97 C 74 104, 84 100, 90 106"/>'
      + '</svg>');
  });

  /* ---------- 꿰매기 연출 ---------- */
  const SPARKS = [
    { x: 8, y: 10, dx: -18, dy: -16 }, { x: 50, y: 4, dx: 0, dy: -22 }, { x: 92, y: 12, dx: 18, dy: -14 },
    { x: 94, y: 88, dx: 18, dy: 14 }, { x: 50, y: 96, dx: 0, dy: 22 }, { x: 6, y: 90, dx: -18, dy: 16 },
  ];

  /** 새로 칠해지는 조각 애니메이션이 끝나는 시각(ms). app.js가 rect에 animation-delay로 적어 둔다 */
  function paintEndMs(d) {
    let max = -1;
    d.querySelectorAll('rect.sh.anim').forEach(function (r) {
      const v = parseInt(r.style.animationDelay, 10);
      if (!isNaN(v) && v > max) max = v;
    });
    return max < 0 ? 0 : max + 140;
  }

  function sew(d) {
    // 바랜 천을 잠시 덮어 두었다가 실이 다 돌면 걷는다 → 그 순간 꿰맨 천이 드러난다
    const veil = document.createElement('div');
    veil.className = 'tile-veil';
    d.appendChild(veil);

    const wait = reduced ? 0 : paintEndMs(d);
    const isBoss = BOSS_CELLS.indexOf(Number(d.dataset.index)) >= 0;   // 도깨비 칸은 fx.js가 boss.mp3를 낸다
    setTimeout(function () {
      if (!isBoss && window.JogakSound) window.JogakSound.play('capture');
      if (reduced) { veil.remove(); return; }
      d.insertAdjacentHTML('beforeend',
        '<svg class="sew" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'
        + '<rect x="2" y="2" width="96" height="96" pathLength="100"/></svg>'
        + SPARKS.map(function (s) {
          return '<span class="spark" style="left:' + s.x + '%;top:' + s.y + '%;--dx:' + s.dx + 'px;--dy:' + s.dy + 'px"></span>';
        }).join(''));
      veil.classList.add('lift');
      setTimeout(function () {
        veil.remove();
        d.querySelectorAll('.sew, .spark').forEach(function (n) { n.remove(); });
      }, SEW_MS + 900);
    }, wait);
  }

  // 처음 상태를 기억해 두고, 이후 '우리 조각'으로 바뀐 칸만 연출한다
  const was = cells.map(isOurs);
  const observer = new MutationObserver(function (records) {
    records.forEach(function (rec) {
      const d = rec.target;
      const i = Number(d.dataset.index);
      const now = isOurs(d);
      if (now && !was[i]) sew(d);
      was[i] = now;
      syncFocusable(d);
    });
  });
  cells.forEach(function (d) { observer.observe(d, { attributes: true, attributeFilter: ['class'] }); });
})();
