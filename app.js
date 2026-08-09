/* 냉장고 재고 앱 — 전부 로컬, 네트워크 요청 없음 */
'use strict';

const KEY = 'fridge.v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- 날짜 ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => toStr(new Date());
const diffDays = (from, to) => Math.round((parseD(to) - parseD(from)) / 86400000);
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return toStr(d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------- 상태 ---------------- */
const DEFAULT_SETTINGS = { soonDays: 3, oldDays: 90, veryOldDays: 180, lastBackup: null, lastUnit: 'fridge' };

let S = load();

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { raw = null; }
  const s = raw && raw.version ? raw : { version: 1 };
  s.items = s.items || [];
  s.logs = s.logs || [];
  s.shopping = s.shopping || [];
  s.presets = s.presets || PRESETS.map(([name, cat, days]) => ({ name, cat, days }));
  s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
  s._stamp = s._stamp || {};        // 시트 동기화용 수정시각 (설정 항목별)
  // 칸 구조는 항상 코드 시드를 기준으로 하되, 사용자가 바꾼 이름은 유지
  const custom = {};
  (s.compartments || []).forEach((c) => { if (c.customLabel) custom[c.id] = c.customLabel; });
  s.compartments = COMPARTMENTS.map((c) => Object.assign({}, c, custom[c.id] ? { customLabel: custom[c.id] } : {}));
  return s;
}
/* opts.silent = 동기화가 서버 응답을 반영하는 중. 이때 다시 도장을 찍으면
   방금 받아온 값이 "내가 바꾼 것"으로 오인돼 되돌려 보내진다. */
function save(opts) {
  const silent = !!(opts && opts.silent);
  if (!silent && typeof Sync !== 'undefined' && Sync.configured()) Sync.stampChanges(S);
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('저장 공간이 부족해요'); }
  if (!silent && typeof Sync !== 'undefined') Sync.schedule();
}

/* sync.js가 앱 상태에 닿는 통로. sync.js는 app.js를 직접 알지 않는다.
   ⚠️ toast는 `function toast()`로 선언돼 이미 window.toast다. 여기서
   `window.toast = (m) => toast(m)`처럼 쓰면 화살표 함수가 전역 toast를 가려
   자기 자신을 호출하고 무한 재귀로 터진다. 앱의 모든 토스트가 죽고, 토스트
   뒤에 있는 save()까지 실행되지 않아 등록이 저장되지 않는다. 원본을 먼저 붙잡을 것. */
const toastFn = toast;
window.getState = () => S;
window.commitState = (opts) => save(opts);
window.toast = (m) => toastFn(m);
window.afterSync = () => {
  if (busy()) return;               // 편집 중이면 화면을 갈아끼우지 않는다
  checkBackupBanner();
  refresh();
};

const comps = () => S.compartments;
const compById = (id) => S.compartments.find((c) => c.id === id);
const compLabel = (c) => c.customLabel || c.label;
const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
const itemById = (id) => S.items.find((i) => i.id === id);

/* ---------------- 배지 상태 ---------------- */
function badgeState(item) {
  const c = compById(item.compartmentId);
  if (!c || c.track === 'none') return { cls: '', tag: '', level: 0 };
  if (c.track === 'expiry') {
    if (!item.expiresAt) return { cls: '', tag: '', level: 0 };
    const left = diffDays(today(), item.expiresAt);
    if (left < 0) return { cls: 'over', tag: `+${-left}일`, level: 2 };
    if (left === 0) return { cls: 'today', tag: '오늘', level: 2 };
    if (left <= S.settings.soonDays) return { cls: 'soon', tag: `D-${left}`, level: 1 };
    return { cls: '', tag: '', level: 0 };
  }
  const days = diffDays(item.addedAt, today());
  const tag = `${days}일째`;
  if (days >= S.settings.veryOldDays) return { cls: 'veryold', tag, level: 2 };
  if (days >= S.settings.oldDays) return { cls: 'old', tag, level: 1 };
  return { cls: '', tag, level: 0 };
}
const unitOf = (item) => (compById(item.compartmentId) || {}).unit;

/* ---------------- 화면 전환 ---------------- */
let currentView = 'home';
let currentUnit = S.settings.lastUnit || 'fridge';
let filtering = false;

function show(view) {
  currentView = view;
  ['home', 'search', 'shopping', 'stats', 'settings'].forEach((v) => {
    $('#view-' + v).hidden = v !== view;
  });
  document.querySelectorAll('#tabbar button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === view || (view === 'settings' && b.dataset.view === 'home'));
  });
  $('#tabbar').hidden = false;
  if (view === 'home') renderHome();
  if (view === 'search') { renderSearch(); setTimeout(() => $('#search-input').focus(), 60); }
  if (view === 'shopping') renderShopping();
  if (view === 'stats') renderStats();
  if (view === 'settings') renderSettings();
}
document.querySelectorAll('#tabbar button').forEach((b) => {
  b.addEventListener('click', () => show(b.dataset.view));
});
$('#btn-settings').addEventListener('click', () => show('settings'));
$('#btn-settings-back').addEventListener('click', () => show('home'));

/* ---------------- 홈 ---------------- */
function unitCounts(unit) {
  let warn = 0, bad = 0;
  S.items.forEach((it) => {
    if (unitOf(it) !== unit) return;
    const st = badgeState(it);
    if (st.level === 2) bad++; else if (st.level === 1) warn++;
  });
  return { warn, bad, total: warn + bad };
}

function renderHome() {
  // 탭
  $('#tab-fridge').classList.toggle('on', currentUnit === 'fridge');
  $('#tab-freezer').classList.toggle('on', currentUnit === 'freezer');
  ['fridge', 'freezer'].forEach((u) => {
    const { warn, bad, total } = unitCounts(u);
    const el = $('#count-' + u);
    el.textContent = total ? total : '';
    el.classList.toggle('mild', bad === 0);
  });

  // 요약 줄 (두 대 합산)
  let todayN = 0, overN = 0, oldN = 0;
  S.items.forEach((it) => {
    const st = badgeState(it);
    if (st.cls === 'today') todayN++;
    else if (st.cls === 'over') overN++;
    else if (st.cls === 'old' || st.cls === 'veryold') oldN++;
  });
  const sum = $('#summary');
  const parts = [];
  if (todayN) parts.push(`오늘까지 ${todayN}개`);
  if (overN) parts.push(`기한 지난 것 ${overN}개`);
  if (oldN) parts.push(`냉동 오래된 것 ${oldN}개`);
  sum.classList.toggle('alert', (todayN + overN) > 0 && !filtering);
  sum.classList.toggle('filtering', filtering);
  if (filtering) sum.textContent = '↩︎ 전체 보기로 돌아가기';
  else if (parts.length) sum.textContent = '⚠︎ ' + parts.join(' · ');
  else sum.textContent = S.items.length ? '급한 것 없음 · 여유롭습니다' : '냉장고가 비어 있어요';

  // 칸
  const list = comps().filter((c) => c.unit === currentUnit);
  const body = list.filter((c) => c.kind !== 'door');
  const doors = list.filter((c) => c.kind === 'door');
  let html = '';
  if (doors.length) {
    /* 도어가 있는 유닛(냉장고)은 본체·도어를 좌우 2그리드로 나눈다.
       도어 칸이 세로로 길게 이어지면 스크롤을 한참 내려야 "간장 있나"를 확인할 수 있어서,
       폭이 좁아지는 걸 감수하고 한 화면에 둘 다 보이게 한다. */
    html += `<div class="split">
      <div class="col"><div class="group-label">본체</div>${body.map(compHTML).join('')}</div>
      <div class="col col-door"><div class="group-label">🚪 도어</div>${doors.map(compHTML).join('')}</div>
    </div>`;
  } else if (body.length) {
    html += `<div class="group-label">본체</div>` + body.map(compHTML).join('');
  }

  const totalHere = S.items.filter((i) => unitOf(i) === currentUnit).length;
  if (totalHere === 0 && !filtering) {
    const other = currentUnit === 'fridge' ? 'freezer' : 'fridge';
    const otherN = S.items.filter((i) => unitOf(i) === other).length;
    html += `<div class="empty">
      <b>${currentUnit === 'fridge' ? '냉장고' : '냉동고'}가 비어 있어요</b>
      ${otherN ? `${other === 'fridge' ? '냉장고' : '냉동고'}에는 ${otherN}개 있어요` : '칸의 + 를 눌러 첫 재료를 넣어보세요'}
    </div>`;
  }
  $('#unit-scroll').innerHTML = html;
}

function compHTML(c) {
  let items = S.items.filter((i) => i.compartmentId === c.id);
  if (filtering) items = items.filter((i) => badgeState(i).level > 0);
  items.sort((a, b) => {
    if (c.track === 'expiry') return (a.expiresAt || '9999').localeCompare(b.expiresAt || '9999');
    if (c.track === 'elapsed') return a.addedAt.localeCompare(b.addedAt);
    return a.name.localeCompare(b.name, 'ko');
  });
  const dim = filtering && items.length === 0;
  return `<div class="comp kind-${c.kind}${dim ? ' dim' : ''}">
    <div class="comp-head">
      <span class="comp-name">${esc(compLabel(c))}</span>
      <button class="add-btn" data-add="${c.id}" aria-label="${esc(compLabel(c))}에 넣기">+</button>
    </div>
    <div class="badges">${items.map(badgeHTML).join('')}</div>
  </div>`;
}

function badgeHTML(it) {
  const cat = catById(it.categoryId);
  const st = badgeState(it);
  return `<button class="badge ${st.cls}" data-item="${it.id}"
    style="--h:${cat.h};--s:${cat.s}%">
    ${esc(it.name)}${st.tag ? `<span class="tag">${st.tag}</span>` : ''}${it.memo ? `<span class="memo">${esc(it.memo)}</span>` : ''}
  </button>`;
}

$('#summary').addEventListener('click', () => {
  const any = S.items.some((i) => badgeState(i).level > 0);
  if (!filtering && !any) return;
  filtering = !filtering;
  renderHome();
});
$('#tab-fridge').addEventListener('click', () => switchUnit('fridge'));
$('#tab-freezer').addEventListener('click', () => switchUnit('freezer'));
function switchUnit(u) {
  if (currentUnit === u) return;
  currentUnit = u;
  S.settings.lastUnit = u; save();
  renderHome();
  $('#unit-scroll').scrollTop = 0;
}

/* 좌우 스와이프로 탭 전환 */
(() => {
  let x0 = null, y0 = null;
  const el = $('#unit-scroll');
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 65 && Math.abs(dy) < 45) switchUnit(dx < 0 ? 'freezer' : 'fridge');
  }, { passive: true });
})();

/* ---------------- 배지 탭 / 길게 누르기 ---------------- */
let pressTimer = null, pressed = null, longFired = false;

document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.badge');
  if (!b) return;
  pressed = b.dataset.item; longFired = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longFired = true;
    if (navigator.vibrate) navigator.vibrate(8);
    openActions(pressed);
  }, 450);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
  document.addEventListener(ev, () => clearTimeout(pressTimer)));
document.addEventListener('pointermove', (e) => {
  if (pressTimer && (Math.abs(e.movementX) > 6 || Math.abs(e.movementY) > 6)) clearTimeout(pressTimer);
});

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) { openEditor({ compartmentId: add.dataset.add }); return; }
  const b = e.target.closest('.badge');
  if (b) {
    if (longFired) { longFired = false; return; }
    openEditor({ id: b.dataset.item });
  }
});

/* ---------------- 액션 시트 ---------------- */
let actTarget = null;
function openActions(itemId) {
  const it = itemById(itemId);
  if (!it) return;
  actTarget = itemId;
  const c = compById(it.compartmentId);
  $('#act-title').textContent = `${it.name} · ${c ? compLabel(c) : ''}`;
  $('#actions').hidden = false;
}
function closeActions() { $('#actions').hidden = true; actTarget = null; }
$('#act-cancel').addEventListener('click', closeActions);
$('#actions').addEventListener('click', (e) => { if (e.target.id === 'actions') closeActions(); });
$('#act-eaten').addEventListener('click', () => removeItem(actTarget, 'eaten'));
$('#act-discard').addEventListener('click', () => removeItem(actTarget, 'discarded'));
$('#act-edit').addEventListener('click', () => { const id = actTarget; closeActions(); openEditor({ id }); });

function removeItem(id, reason) {
  const it = itemById(id);
  if (!it) return closeActions();
  S.logs.push({
    id: uid(), name: it.name, categoryId: it.categoryId,
    unit: unitOf(it) || 'fridge', addedAt: it.addedAt, removedAt: today(),
    reason, daysHeld: diffDays(it.addedAt, today()),
  });
  S.items = S.items.filter((x) => x.id !== id);
  save(); closeActions();
  toast(reason === 'eaten' ? `${it.name} 다 먹음` : `${it.name} 버림`);
  if (currentView === 'home') renderHome();
  if (currentView === 'search') renderSearch();
}

/* ---------------- 재료 등록/수정 ---------------- */
let edit = { id: null, compartmentId: null, dateTouched: false };

function openEditor({ id = null, compartmentId = null } = {}) {
  const it = id ? itemById(id) : null;
  edit = { id: id, compartmentId: it ? it.compartmentId : compartmentId, dateTouched: !!it };

  // 칸 select
  const sel = $('#ed-comp');
  sel.innerHTML = ['fridge', 'freezer'].map((u) =>
    `<optgroup label="${u === 'fridge' ? '🧊 냉장고' : '❄️ 냉동고'}">` +
    comps().filter((c) => c.unit === u)
      .map((c) => `<option value="${c.id}">${esc(compLabel(c))}</option>`).join('') +
    `</optgroup>`).join('');
  sel.value = edit.compartmentId || comps()[0].id;

  // 분류 select
  $('#ed-cat').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

  $('#ed-name').value = it ? it.name : '';
  $('#ed-cat').value = it ? it.categoryId : 'etc';
  $('#ed-memo').value = it ? (it.memo || '') : '';
  $('#ed-title').textContent = it ? '재료 수정' : '재료 넣기';
  $('#ed-delete').hidden = !it;
  $('#ed-suggest').innerHTML = '';

  syncDateField(it);
  $('#editor').hidden = false;
  if (!it) setTimeout(() => $('#ed-name').focus(), 80);
}
function closeEditor() { $('#editor').hidden = true; }
$('#ed-cancel').addEventListener('click', closeEditor);

function syncDateField(it) {
  const c = compById($('#ed-comp').value);
  const field = $('#ed-date-field');
  const quick = $('#ed-quick');
  if (!c || c.track === 'none') {
    field.hidden = true; quick.hidden = true;
    $('#ed-hint').textContent = '도어 칸은 날짜를 받지 않습니다. 간장·소스처럼 오래 두는 것들이라 이름만 기억하면 됩니다.';
    return;
  }
  field.hidden = false; quick.hidden = false;
  if (c.track === 'expiry') {
    $('#ed-date-label').textContent = '언제까지';
    $('#ed-date').value = it ? (it.expiresAt || addDays(today(), 7)) : ($('#ed-date').value || addDays(today(), 7));
    quick.innerHTML = [3, 5, 7, 14, 30].map((n) => `<button type="button" data-days="${n}">+${n}일</button>`).join('');
    $('#ed-hint').textContent = '재료 이름을 고르면 통상 보관일로 날짜가 미리 채워집니다. 맞으면 그대로 저장하세요.';
  } else {
    $('#ed-date-label').textContent = '넣은 날';
    $('#ed-date').value = it ? it.addedAt : today();
    quick.innerHTML = [0, -1, -7, -30].map((n) =>
      `<button type="button" data-days="${n}">${n === 0 ? '오늘' : n === -1 ? '어제' : n === -7 ? '1주 전' : '1달 전'}</button>`).join('');
    $('#ed-hint').textContent = '냉동은 기한 대신 며칠째 들어 있는지를 표시합니다.';
  }
}
$('#ed-comp').addEventListener('change', () => { edit.dateTouched = false; syncDateField(edit.id ? itemById(edit.id) : null); });
$('#ed-date').addEventListener('input', () => { edit.dateTouched = true; });
$('#ed-quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]');
  if (!b) return;
  const n = Number(b.dataset.days);
  const c = compById($('#ed-comp').value);
  $('#ed-date').value = c.track === 'expiry' ? addDays(today(), n) : addDays(today(), n);
  edit.dateTouched = true;
  $('#ed-quick').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
});

/* 자동완성 */
$('#ed-name').addEventListener('input', () => {
  const q = $('#ed-name').value.trim();
  const box = $('#ed-suggest');
  if (!q) { box.innerHTML = ''; return; }
  const hits = S.presets
    .filter((p) => p.name.includes(q))
    .sort((a, b) => a.name.indexOf(q) - b.name.indexOf(q) || a.name.length - b.name.length)
    .slice(0, 8);
  box.innerHTML = hits.map((p) => `<button type="button" data-pick="${esc(p.name)}">${esc(p.name)}</button>`).join('');
  const exact = S.presets.find((p) => p.name === q);
  if (exact) applyPreset(exact);
});
$('#ed-suggest').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  const p = S.presets.find((x) => x.name === b.dataset.pick);
  $('#ed-name').value = p.name;
  applyPreset(p);
  $('#ed-suggest').innerHTML = '';
});
function applyPreset(p) {
  $('#ed-cat').value = p.cat;
  const c = compById($('#ed-comp').value);
  if (c && c.track === 'expiry' && !edit.dateTouched) $('#ed-date').value = addDays(today(), p.days || 7);
}

$('#ed-save').addEventListener('click', () => {
  const name = $('#ed-name').value.trim();
  if (!name) { toast('재료 이름을 적어주세요'); $('#ed-name').focus(); return; }
  const compId = $('#ed-comp').value;
  const c = compById(compId);
  const cat = $('#ed-cat').value;
  const memo = $('#ed-memo').value.trim();
  const dateVal = $('#ed-date').value;

  const base = {
    name, categoryId: cat, compartmentId: compId, memo,
    addedAt: c.track === 'elapsed' ? (dateVal || today()) : today(),
    expiresAt: c.track === 'expiry' ? (dateVal || addDays(today(), 7)) : null,
  };

  if (edit.id) {
    const it = itemById(edit.id);
    if (it) Object.assign(it, base, { addedAt: c.track === 'elapsed' ? (dateVal || it.addedAt) : it.addedAt });
    closeEditor();
    toast('수정했어요');
  } else {
    S.items.push(Object.assign({ id: uid() }, base));
    // 사전에 없던 이름이면 추가 → 다음부터 자동완성
    if (!S.presets.some((p) => p.name === name)) {
      const days = c.track === 'expiry' && dateVal ? Math.max(1, diffDays(today(), dateVal)) : 7;
      S.presets.push({ name, cat, days });
    }
    toast(`${name} 넣음`);
    // 연속 등록: 폼만 비우고 같은 칸 유지
    $('#ed-name').value = ''; $('#ed-memo').value = ''; $('#ed-suggest').innerHTML = '';
    edit.dateTouched = false;
    syncDateField(null);
    $('#ed-name').focus();
  }
  save();
  if (currentView === 'home') renderHome();
});

$('#ed-delete').addEventListener('click', () => {
  const it = itemById(edit.id);
  if (!it) return;
  closeEditor();
  openActions(it.id);
});

/* ---------------- 검색 ---------------- */
let pendingHighlight = null;
$('#search-input').addEventListener('input', renderSearch);

function renderSearch() {
  const q = $('#search-input').value.trim();
  const box = $('#search-results');
  if (!q) {
    box.innerHTML = `<div class="empty">재료 이름을 입력하면<br>어느 칸에 있는지 알려드려요</div>`;
    return;
  }
  const hits = S.items.filter((i) => i.name.includes(q));
  if (!hits.length) {
    box.innerHTML = `<div class="empty">
      <b>냉장고에 “${esc(q)}” 없어요</b>
      <button class="pill" id="to-shopping">🛒 살 것에 “${esc(q)}” 추가</button>
    </div>`;
    $('#to-shopping').addEventListener('click', () => {
      S.shopping.unshift({ id: uid(), text: q, checked: false, createdAt: today() });
      save(); toast(`살 것에 ${q} 추가`); show('shopping');
    });
    return;
  }
  hits.sort((a, b) => badgeState(b).level - badgeState(a).level);
  box.innerHTML = hits.map((it) => {
    const c = compById(it.compartmentId);
    const st = badgeState(it);
    const cat = catById(it.categoryId);
    return `<div class="row">
      <span class="badge ${st.cls}" data-item="${it.id}" style="--h:${cat.h};--s:${cat.s}%">
        ${esc(it.name)}${st.tag ? `<span class="tag">${st.tag}</span>` : ''}
      </span>
      <div class="grow"><div class="where">${c ? (c.unit === 'fridge' ? '🧊 냉장고' : '❄️ 냉동고') + ' · ' + esc(compLabel(c)) : ''}</div></div>
      <button class="text-btn" data-goto="${it.id}">보기 ›</button>
    </div>`;
  }).join('');
}
$('#search-results').addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (!g) return;
  const it = itemById(g.dataset.goto);
  if (!it) return;
  const c = compById(it.compartmentId);
  filtering = false;
  currentUnit = c.unit;
  S.settings.lastUnit = c.unit; save();
  pendingHighlight = it.id;
  show('home');
  requestAnimationFrame(() => {
    const el = document.querySelector(`#unit-scroll .badge[data-item="${it.id}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('hit');
      setTimeout(() => el.classList.remove('hit'), 2200);
    }
    pendingHighlight = null;
  });
});

/* ---------------- 살 것 ---------------- */
$('#shopping-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#shopping-input').value.trim();
  if (!v) return;
  S.shopping.unshift({ id: uid(), text: v, checked: false, createdAt: today() });
  $('#shopping-input').value = '';
  save(); renderShopping();
});
$('#btn-clear-bought').addEventListener('click', () => {
  const n = S.shopping.filter((s) => s.checked).length;
  if (!n) return toast('비울 항목이 없어요');
  S.shopping = S.shopping.filter((s) => !s.checked);
  save(); renderShopping(); toast(`${n}개 비웠어요`);
});
function renderShopping() {
  const box = $('#shopping-list');
  if (!S.shopping.length) {
    box.innerHTML = `<div class="empty">살 것을 적어두세요<br><small>냉장고 재고와는 따로 관리되는 자유 메모예요</small></div>`;
    return;
  }
  const open = S.shopping.filter((s) => !s.checked);
  const done = S.shopping.filter((s) => s.checked);
  box.innerHTML = [...open, ...done].map((s) => `
    <div class="row ${s.checked ? 'done' : ''}">
      <button class="text-btn" data-toggle="${s.id}" style="font-size:19px;min-width:30px">${s.checked ? '☑︎' : '☐'}</button>
      <div class="grow"><div class="name">${esc(s.text)}</div></div>
      <button class="text-btn" data-del="${s.id}" style="color:var(--fg-3)">✕</button>
    </div>`).join('');
}
$('#shopping-list').addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]'), d = e.target.closest('[data-del]');
  if (t) { const s = S.shopping.find((x) => x.id === t.dataset.toggle); s.checked = !s.checked; save(); renderShopping(); }
  if (d) { S.shopping = S.shopping.filter((x) => x.id !== d.dataset.del); save(); renderShopping(); }
});

/* ---------------- 통계 ---------------- */
let statMonth = today().slice(0, 7);
$('#stat-prev').addEventListener('click', () => { statMonth = shiftMonth(statMonth, -1); renderStats(); });
$('#stat-next').addEventListener('click', () => { statMonth = shiftMonth(statMonth, 1); renderStats(); });
function shiftMonth(m, n) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function renderStats() {
  $('#stat-month').textContent = statMonth.replace('-', '. ') + '.';
  const logs = S.logs.filter((l) => l.removedAt.startsWith(statMonth));
  const dis = logs.filter((l) => l.reason === 'discarded');
  const eat = logs.filter((l) => l.reason === 'eaten');
  let html = `
    <div class="stat-big ${dis.length ? 'bad' : ''}"><div class="n">${dis.length}개</div><div class="k">이번 달 버린 재료</div></div>
    <div class="stat-big"><div class="n">${eat.length}개</div><div class="k">다 먹은 재료</div></div>`;

  if (dis.length) {
    html += `<div class="stat-sec">무엇을 버렸나</div>` + dis
      .sort((a, b) => b.removedAt.localeCompare(a.removedAt))
      .map((l) => `<div class="stat-line"><span>${esc(l.name)}</span><span>${l.daysHeld}일 두고 · ${l.removedAt.slice(5).replace('-', '/')}</span></div>`).join('');
  }

  const freq = {};
  logs.forEach((l) => { freq[l.name] = (freq[l.name] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length) {
    html += `<div class="stat-sec">자주 오간 재료</div>` +
      top.map(([n, c]) => `<div class="stat-line"><span>${esc(n)}</span><span>${c}회</span></div>`).join('');
  }

  const byCat = {};
  logs.forEach((l) => { (byCat[l.categoryId] = byCat[l.categoryId] || []).push(l.daysHeld); });
  const cats = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length);
  if (cats.length) {
    html += `<div class="stat-sec">평균 보관일</div>` + cats.map(([id, arr]) => {
      const avg = Math.round(arr.reduce((s, n) => s + n, 0) / arr.length);
      return `<div class="stat-line"><span>${catById(id).name}</span><span>평균 ${avg}일 · ${arr.length}건</span></div>`;
    }).join('');
  }

  if (!logs.length) html += `<div class="empty">이 달은 아직 기록이 없어요<br><small>재료를 지울 때 “다 먹음 / 버림”을 고르면 여기 쌓입니다</small></div>`;
  else if (S.logs.length < 20) html += `<div class="note">기록이 아직 적어서 평균값은 참고만 하세요. 두어 달 쌓이면 패턴이 보입니다.</div>`;

  $('#stats-body').innerHTML = html;
}

/* ---------------- 설정 ---------------- */
function fmtAgo(iso) {
  if (!iso) return '없음';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '없음';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}

function syncStatusLine() {
  const st = Sync.status();
  if (!st.url) return '연결 안 됨 · 지금은 이 기기에만 저장됩니다';
  const label = { idle: '연결됨', syncing: '맞추는 중…', error: '실패', offline: '오프라인 · 온라인 되면 자동 재시도', off: '연결 안 됨' }[st.state] || st.state;
  const bits = [label];
  if (st.lastOkAt) bits.push(`마지막 ${fmtAgo(st.lastOkAt)}`);
  if (st.dirty) bits.push(`밀린 변경 ${st.dirty}건`);
  if (st.state === 'error' && st.lastErr) bits.push(st.lastErr);
  return bits.join(' · ');
}

function renderSettings() {
  const lb = S.settings.lastBackup;
  const ago = lb ? diffDays(lb, today()) : null;
  const st = Sync.status();
  $('#settings-body').innerHTML = `
    <div class="set-group">
      <h2>구글 시트 연결</h2>
      <div class="set-item col">
        <div>동기화 주소<small id="s-sync-status">${esc(syncStatusLine())}</small></div>
        <input type="url" id="s-sync-url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"
               placeholder="https://script.google.com/macros/s/…/exec" value="${esc(st.url || '')}">
      </div>
      <div class="set-item"><div>지금 맞추기<small>변경을 올리고 시트를 받아옵니다</small></div><button class="pill" id="s-sync-now"${st.url ? '' : ' disabled'}>동기화</button></div>
      <div class="set-item"><div>자동 동기화<small>바꿀 때마다 알아서 (권장)</small></div><input type="checkbox" id="s-sync-auto"${st.auto ? ' checked' : ''}></div>
      <div class="set-item"><div>이 기기 내용으로 시트 채우기<small>처음 연결할 때 1회. 시트가 더 최신이면 시트가 이깁니다</small></div><button class="pill ghost" id="s-sync-seed"${st.url ? '' : ' disabled'}>올리기</button></div>
      <p class="note">${st.url
        ? '시트가 정본입니다. 시트에서 손으로 고쳐도 앱에 반영되고, 오프라인에서 바꾼 것은 온라인이 되면 올라갑니다. 같은 줄을 양쪽에서 고치면 나중에 고친 쪽이 이깁니다.'
        : '연결하면 재고가 구글 시트에 쌓이고, 시트에서 직접 보고 고칠 수 있습니다. 설치 방법은 프로젝트 폴더의 <code>sheets/README.md</code>에 있습니다.'}</p>
    </div>

    <div class="set-group">
      <h2>파일 백업</h2>
      <div class="set-item"><div>데이터 내보내기<small>${lb ? `마지막 백업 ${ago}일 전 (${lb})` : '아직 백업한 적 없어요'}</small></div><button class="pill${st.url ? ' ghost' : ''}" id="s-export">내보내기</button></div>
      <div class="set-item"><div>데이터 불러오기<small>지금 데이터를 덮어씁니다</small></div><button class="pill ghost" id="s-import">불러오기</button></div>
      <p class="note">${st.url
        ? '시트에 연결돼 있으면 시트가 백업 역할을 합니다. 이 파일 내보내기는 시트까지 날아가는 경우를 대비한 이중 백업입니다.'
        : '지금은 데이터가 이 기기 안에만 있습니다. 사파리 데이터를 지우면 전부 사라지니 가끔 내보내서 「파일」이나 iCloud에 두세요.'}</p>
    </div>

    <div class="set-group">
      <h2>표시 기준</h2>
      <div class="set-item"><div>냉장 임박 표시<small>기한이 며칠 남으면 주황색으로</small></div><input type="number" id="s-soon" min="1" max="14" value="${S.settings.soonDays}"></div>
      <div class="set-item"><div>냉동 오래됨<small>며칠째부터 주황색으로</small></div><input type="number" id="s-old" min="7" max="720" value="${S.settings.oldDays}"></div>
      <div class="set-item"><div>냉동 너무 오래됨<small>며칠째부터 빨간색으로</small></div><input type="number" id="s-veryold" min="14" max="900" value="${S.settings.veryOldDays}"></div>
    </div>

    <div class="set-group">
      <h2>칸 이름</h2>
      ${['fridge', 'freezer'].map((u) => comps().filter((c) => c.unit === u).map((c) => `
        <div class="set-item">
          <div style="flex:0 0 76px;font-size:12px;color:var(--fg-3)">${u === 'fridge' ? '🧊' : '❄️'} ${c.kind === 'door' ? '도어' : c.kind === 'drawer' ? '서랍' : '선반'}</div>
          <input type="text" data-label="${c.id}" value="${esc(compLabel(c))}">
        </div>`).join('')).join('')}
    </div>

    <div class="set-group">
      <h2>정리</h2>
      <div class="set-item"><div>재료 사전<small>자동완성에 뜨는 재료 ${S.presets.length}개</small></div><button class="pill ghost" id="s-reset-presets">기본값으로</button></div>
      <div class="set-item"><div>살 것 · 산 것 비우기<small>체크된 항목 삭제</small></div><button class="pill ghost" id="s-clear-bought">비우기</button></div>
      <div class="set-item"><div style="color:var(--danger)">전부 지우기<small>재료·기록·살 것 전부 삭제</small></div><button class="pill ghost" id="s-wipe" style="color:var(--danger)">초기화</button></div>
    </div>

    <p class="note">재료 ${S.items.length}개 · 기록 ${S.logs.length}건 · 살 것 ${S.shopping.length}개</p>`;

  $('#s-export').addEventListener('click', exportJSON);
  $('#s-import').addEventListener('click', importJSON);

  $('#s-sync-url').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (!Sync.setUrl(v)) {
      toast('script.google.com 의 .../exec 주소여야 해요');
      return;
    }
    renderSettings();
    if (v) toast('연결했어요 · 동기화를 눌러 확인해 보세요');
  });
  $('#s-sync-now').addEventListener('click', async () => {
    const b = $('#s-sync-now'); b.disabled = true; b.textContent = '…';
    const r = await Sync.run({});
    if (r.ok) toast(`올림 ${r.pushed}건 · 받음 ${r.pulled}건`);
    renderSettings();
  });
  $('#s-sync-auto').addEventListener('change', (e) => { Sync.setAuto(e.target.checked); });
  $('#s-sync-seed').addEventListener('click', async () => {
    if (!confirm('이 기기의 재료·기록·살 것을 전부 시트로 올립니다. 시트에 더 최신인 줄이 있으면 그 줄은 시트 값이 남습니다. 계속할까요?')) return;
    const b = $('#s-sync-seed'); b.disabled = true; b.textContent = '…';
    const r = await Sync.forcePushAll();
    if (r.ok) toast(`시트에 ${r.pushed}건 올렸어요`);
    renderSettings();
  });
  ['soon', 'old', 'veryold'].forEach((k) => {
    const key = k === 'soon' ? 'soonDays' : k === 'old' ? 'oldDays' : 'veryOldDays';
    $('#s-' + k).addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) { S.settings[key] = v; save(); toast('기준을 바꿨어요'); }
    });
  });
  $('#settings-body').querySelectorAll('[data-label]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const c = compById(inp.dataset.label);
      const v = inp.value.trim();
      c.customLabel = v && v !== c.label ? v : undefined;
      save();
    });
  });
  $('#s-reset-presets').addEventListener('click', () => {
    if (!confirm('재료 사전을 기본값으로 되돌릴까요? 직접 추가한 재료 이름이 사라집니다.')) return;
    S.presets = PRESETS.map(([name, cat, days]) => ({ name, cat, days }));
    save(); renderSettings(); toast('사전을 되돌렸어요');
  });
  $('#s-clear-bought').addEventListener('click', () => {
    S.shopping = S.shopping.filter((s) => !s.checked); save(); renderSettings(); toast('비웠어요');
  });
  $('#s-wipe').addEventListener('click', () => {
    if (!confirm('재료·기록·살 것을 전부 지웁니다. 되돌릴 수 없어요. 계속할까요?')) return;
    if (!confirm('정말 지울까요? 먼저 내보내기로 백업하는 걸 권합니다.')) return;
    S.items = []; S.logs = []; S.shopping = [];
    save(); renderSettings(); toast('전부 지웠어요');
  });
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `냉장고-백업-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  S.settings.lastBackup = today(); save();
  checkBackupBanner(); renderSettings();
  toast('백업 파일을 내보냈어요');
}
function importJSON() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || !Array.isArray(data.items)) throw new Error('형식이 달라요');
        if (!confirm(`재료 ${data.items.length}개를 불러옵니다. 지금 데이터는 사라져요. 계속할까요?`)) return;
        localStorage.setItem(KEY, JSON.stringify(data));
        S = load(); save();
        renderSettings(); toast('불러왔어요');
      } catch (err) { alert('파일을 읽지 못했어요: ' + err.message); }
    };
    r.readAsText(f);
  });
  inp.click();
}

/* ---------------- 상단 경고 배너 ----------------
   시트에 연결돼 있으면 "동기화가 며칠째 실패 중"을 알린다 (시트가 백업 역할).
   연결 전이면 예전 규칙대로 "파일 백업한 지 30일" 을 알린다. */
let bannerAction = 'export';
function checkBackupBanner() {
  const b = $('#backup-banner');
  let msg = null;

  if (Sync.configured()) {
    const st = Sync.status();
    const days = st.lastOkAt ? Math.floor((Date.now() - new Date(st.lastOkAt).getTime()) / 86400000) : null;
    if (st.state === 'error' && st.dirty) {
      msg = `시트 동기화 실패 · 안 올라간 변경 ${st.dirty}건 · 눌러서 확인`;
      bannerAction = 'sync';
    } else if (days !== null && days > 3 && st.dirty) {
      msg = `${days}일째 시트와 맞추지 못했어요 · 눌러서 동기화`;
      bannerAction = 'sync';
    } else if (!st.lastOkAt && S.items.length > 0) {
      msg = '아직 시트와 한 번도 맞추지 않았어요 · 눌러서 동기화';
      bannerAction = 'sync';
    }
  } else {
    const lb = S.settings.lastBackup;
    if (S.items.length > 0 && (!lb || diffDays(lb, today()) > 30)) {
      msg = lb ? `백업한 지 ${diffDays(lb, today())}일 됐어요 · 눌러서 내보내기` : '아직 백업한 적 없어요 · 눌러서 내보내기';
      bannerAction = 'export';
    }
  }

  b.hidden = !msg;
  if (msg) b.textContent = msg;
  // 배너가 헤더를 덮지 않도록 상단 여백을 배너 높이만큼 밀어준다
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty(
      '--top-pad', msg ? `${b.offsetHeight + 10}px` : 'calc(env(safe-area-inset-top, 0px) + 10px)');
  });
}
$('#backup-banner').addEventListener('click', () => {
  if (bannerAction === 'sync') { show('settings'); Sync.run({}).then(() => { checkBackupBanner(); renderSettings(); }); }
  else { show('settings'); setTimeout(exportJSON, 200); }
});

/* ---------------- 토스트 ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1900);
}

/* ---------------- 시작 ---------------- */
function refresh() {
  if (currentView === 'home') renderHome();
  else if (currentView === 'search') renderSearch();
  else if (currentView === 'shopping') renderShopping();
  else if (currentView === 'stats') renderStats();
  else if (currentView === 'settings') renderSettings();
}
/* 편집 중이면 화면을 갈아끼우지 않는다 (입력 중인 값이 날아가므로) */
const busy = () => !$('#editor').hidden || !$('#actions').hidden;

show('home');
checkBackupBanner();

/* 다른 탭·창이 저장하면 이쪽 메모리 상태를 새로 읽는다.
   이걸 안 하면 오래된 상태가 나중에 저장되면서 방금 지운 재료가 되살아난다. */
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || busy()) return;
  S = load();
  checkBackupBanner();
  refresh();
});

// 날짜가 바뀌면(자정 넘김·앱 재활성화) 다시 계산
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); if (currentView === 'home') renderHome(); } }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || busy()) return;
  S = load();                       // 백그라운드에 있는 동안 바뀌었을 수 있다
  if (today() !== lastDay) lastDay = today();
  checkBackupBanner();
  refresh();
});

/* ---------------- 시트 동기화 트리거 ----------------
   기기가 하나뿐이어도 시트에서 손으로 고칠 수 있으니 열 때마다 받아온다. */
Sync.onStatus((st) => {
  const line = $('#s-sync-status');
  if (line) line.textContent = syncStatusLine();
  const dot = $('#sync-dot');
  if (dot) {
    dot.hidden = !st.url;
    dot.className = 'sync-dot ' + st.state + (st.dirty ? ' dirty' : '');
    dot.title = syncStatusLine();
  }
});

if (Sync.configured()) {
  Sync.run({ silent: true });                       // 시작할 때 한 번
  window.addEventListener('online', () => Sync.run({ silent: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !busy()) Sync.run({ silent: true });
  });
  // 밀린 변경이 남아 있으면 5분마다 조용히 재시도
  setInterval(() => {
    const st = Sync.status();
    if (st.dirty && st.state !== 'syncing') Sync.run({ silent: true });
  }, 300000);
}
$('#sync-dot').addEventListener('click', async () => {
  if (!Sync.configured()) { show('settings'); return; }
  const r = await Sync.run({});
  if (r.ok) toast(r.pushed || r.pulled ? `올림 ${r.pushed}건 · 받음 ${r.pulled}건` : '이미 맞아 있어요');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
