/* 메뉴 추천 — 냉장고 재료를 프롬프트로 빚어 대화형 AI에 넘긴다.
   ⚠️ 이 앱은 레시피를 판정하지 않는다. 레시피 사전을 박아두면 재료 6~8개가
   전부 맞아떨어져야 해서 "만들 수 있는 것 0개"가 되거나, 느슨하게 풀면
   "양파 있으니 김치찌개" 같은 헛추천이 된다. 조합 판단은 AI 쪽이 훨씬 낫고,
   그러면 앱은 오프라인·무의존이라는 원래 성질을 그대로 지킬 수 있다. */
'use strict';

const MENU_KEY = 'fridge.menu.v1';

const MENU_STYLES = [
  { id: 'korean',   label: '한식',       line: '한식 집밥 위주로' },
  { id: 'japanese', label: '일식',       line: '일식 가정식 위주로' },
  { id: 'diet',     label: '다이어트식',  line: '다이어트식 위주로 (고단백·저탄수, 한 끼 500kcal 안팎. 대략의 칼로리도 같이 적어줘)' },
  { id: 'any',      label: '아무거나',    line: '종류는 가리지 말고' },
];

const MENU_SCOPES = [
  { id: 'all',     label: '전부' },
  { id: 'soon',    label: '급한 것만' },
  { id: 'fridge',  label: '냉장고만' },
  { id: 'freezer', label: '냉동고만' },
];

const MENU_SERVES = [
  { id: '1', label: '1인분' },
  { id: '2', label: '2인분' },
  { id: '4', label: '3~4인분' },
];

/* 붙여넣고 나서 바로 쓸 수 있는 곳들. 프롬프트를 URL에 실어 보내지는 않는다 —
   재료가 30개만 돼도 한글이 퍼센트 인코딩되며 1만 바이트를 넘겨 잘린다.
   그래서 «복사 → 열기 → 붙여넣기» 세 박자로 간다. 항상 같은 방식으로 동작한다. */
const MENU_AIS = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude',  label: 'Claude',  url: 'https://claude.ai/new' },
  { id: 'gemini',  label: 'Gemini',  url: 'https://gemini.google.com/app' },
];

let menuPick = loadMenuPick();

function loadMenuPick() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(MENU_KEY)); } catch (e) { raw = null; }
  return Object.assign({ style: 'korean', scope: 'all', serves: '2', rawOnly: false }, raw || {});
}
function saveMenuPick() {
  try { localStorage.setItem(MENU_KEY, JSON.stringify(menuPick)); } catch (e) {}
}

/* ---------------- 재료 고르기 ---------------- */
/* 칸 위치(3번 선반·도어 2)는 요리와 아무 상관이 없으니 버린다.
   대신 냉장/냉동은 남긴다 — 냉동은 해동 시간이 붙기 때문이다. */
function menuRows() {
  const rows = S.items.map((it) => {
    const c = compById(it.compartmentId) || {};
    return { it, unit: c.unit || 'fridge', track: c.track || 'none', st: badgeState(it) };
  });
  if (menuPick.scope === 'soon')    return rows.filter((r) => r.st.level >= 1);
  if (menuPick.scope === 'fridge')  return rows.filter((r) => r.unit === 'fridge');
  if (menuPick.scope === 'freezer') return rows.filter((r) => r.unit === 'freezer');
  return rows;
}

/* 재료 뒤에 붙는 괄호. 급한 것만 말하고 나머지는 침묵한다 —
   「D-12」까지 적으면 AI가 읽어야 할 잡음만 늘어난다. */
function menuNote(r) {
  const bits = [];
  if (r.track === 'expiry' && r.it.expiresAt) {
    const left = diffDays(today(), r.it.expiresAt);
    if (left < 0) bits.push(`기한 ${-left}일 지남`);
    else if (left === 0) bits.push('오늘까지');
    else if (left <= S.settings.soonDays) bits.push(`${left}일 남음`);
  } else if (r.track === 'elapsed' && r.st.level >= 1) {
    bits.push(`넣은 지 ${diffDays(r.it.addedAt, today())}일`);
  }
  if (r.it.memo) bits.push(r.it.memo);
  return bits;
}

function menuBlock(rows, title) {
  if (!rows.length) return '';
  const byCat = new Map();
  rows.forEach((r) => {
    const name = catById(r.it.category).name;
    if (!byCat.has(name)) byCat.set(name, []);
    byCat.get(name).push(r);
  });
  const out = [`[${title}]`];
  CATEGORIES.forEach((c) => {          // 사전 순서 그대로 — 채소부터 기타까지
    const arr = byCat.get(c.name);
    if (!arr) return;
    out.push(`${c.name}`);
    arr.forEach((r) => {
      const note = menuNote(r);
      const mark = r.st.level >= 1 ? '⚠️ ' : '';
      out.push(`  - ${mark}${r.it.name}${note.length ? ` (${note.join(', ')})` : ''}`);
    });
  });
  return out.join('\n');
}

function buildMenuText() {
  const rows = menuRows();
  if (!rows.length) return '';
  const fridge  = rows.filter((r) => r.unit === 'fridge');
  const freezer = rows.filter((r) => r.unit === 'freezer');
  const d = new Date();
  const stamp = `${d.getMonth() + 1}월 ${d.getDate()}일 기준`;
  const inv = [menuBlock(fridge, `냉장고 · ${stamp}`), menuBlock(freezer, '냉동고')].filter(Boolean).join('\n\n');
  if (menuPick.rawOnly) return inv;

  const style  = MENU_STYLES.find((s) => s.id === menuPick.style) || MENU_STYLES[0];
  const serves = MENU_SERVES.find((s) => s.id === menuPick.serves) || MENU_SERVES[1];
  const urgent = rows.filter((r) => r.st.level >= 1).length;

  const ask = [
    '우리 집 냉장고에 아래 재료가 있어. 이걸로 오늘 해먹을 메뉴를 추천해줘.',
    '',
    '조건',
    `- ${style.line} 3~5가지`,
    `- ${serves.label} 기준`,
  ];
  if (urgent) ask.push('- ⚠️ 표시는 빨리 먹어야 하는 재료야. 이걸 쓰는 메뉴를 앞에 놔줘');
  ask.push(
    '- 메뉴마다: 이름 / 들어가는 재료(없는 건 «사야 함»으로 표시) / 조리 순서 5줄 이내 / 예상 시간',
    '- 없는 재료가 3개 넘게 필요한 메뉴는 빼줘. 소금·설탕·식용유 같은 기본 양념은 있다고 치고',
    '- 냉동고 재료를 쓸 거면 해동 시간도 같이 알려줘',
    '- 맨 마지막에 「이것만 사면 선택지가 확 늘어난다」 재료 2~3개',
    '',
  );
  return ask.join('\n') + '\n' + inv;   // 조건과 재료 사이 빈 줄 한 칸
}

/* ---------------- 클립보드 ---------------- */
/* iOS 사파리는 «사용자가 누른 그 순간» 안에서만 복사를 허락한다.
   await 뒤로 한 틱이라도 미루면 조용히 거부되므로 핸들러에서 곧바로 부른다. */
function menuCopy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => menuLegacyCopy(text));
      return true;
    }
  } catch (e) { /* 아래 옛 방식으로 */ }
  return menuLegacyCopy(text);
}
function menuLegacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);   // iOS는 select()만으로는 범위를 안 잡는다
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/* ---------------- 화면 ---------------- */
function chips(list, cur, attr) {
  return list.map((o) =>
    `<button type="button" data-${attr}="${o.id}"${o.id === cur ? ' class="on"' : ''}>${esc(o.label)}</button>`
  ).join('');
}

function renderMenu() {
  const rows = menuRows();
  const urgent = rows.filter((r) => r.st.level >= 1).length;
  const text = buildMenuText();
  const total = S.items.length;

  const head = !total
    ? '<div class="empty"><b>냉장고가 비어 있어요</b>재료를 먼저 넣어주세요</div>'
    : !rows.length
      ? `<div class="empty"><b>고른 조건에 재료가 없어요</b>${menuPick.scope === 'soon' ? '급한 재료가 하나도 없네요 — 좋은 일이에요' : '다른 범위를 골라보세요'}</div>`
      : '';

  $('#menu-body').innerHTML = `
    <div class="menu-picks">
      <div class="pick-row"><span>어떤 요리</span><div class="quick-days" id="mk-style">${chips(MENU_STYLES, menuPick.style, 'style')}</div></div>
      <div class="pick-row"><span>어디 것으로</span><div class="quick-days" id="mk-scope">${chips(MENU_SCOPES, menuPick.scope, 'scope')}</div></div>
      <div class="pick-row"><span>몇 인분</span><div class="quick-days" id="mk-serves">${chips(MENU_SERVES, menuPick.serves, 'serves')}</div></div>
    </div>

    ${head}

    ${rows.length ? `
      <div class="menu-count">재료 ${rows.length}개${urgent ? ` · 급한 것 ${urgent}개` : ''}</div>

      <button class="pill big" id="mk-copy">📋 복사하기</button>

      <div class="menu-ais">
        <span>복사하고 바로 열기</span>
        <div class="quick-days">
          ${MENU_AIS.map((a) => `<button type="button" data-ai="${a.id}">${esc(a.label)}</button>`).join('')}
        </div>
      </div>
      <p class="hint">열린 화면 입력칸을 길게 눌러 <b>붙여넣기</b> 하면 됩니다. 붙여넣기가 안 되면 아래 글상자에서 직접 복사하세요.</p>

      <label class="menu-raw-toggle">
        <input type="checkbox" id="mk-raw"${menuPick.rawOnly ? ' checked' : ''}>
        <span>부탁하는 말 빼고 <b>재료만</b> 복사</span>
      </label>

      <!-- 기본은 접어둔다. 펼쳐두면 이 글상자가 손가락 스크롤을 가둬 화면이 안 내려간다 -->
      <details class="more" id="mk-preview">
        <summary>보낼 내용 보기 (${text.length}자)</summary>
        <textarea class="menu-text" readonly rows="14">${esc(text)}</textarea>
      </details>
    ` : ''}`;

  ['style', 'scope', 'serves'].forEach((k) => {
    const box = $('#mk-' + k);
    if (!box) return;
    box.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { menuPick[k] = b.dataset[k]; saveMenuPick(); renderMenu(); });
    });
  });

  const raw = $('#mk-raw');
  if (raw) raw.addEventListener('change', (e) => { menuPick.rawOnly = e.target.checked; saveMenuPick(); renderMenu(); });

  const copyBtn = $('#mk-copy');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    toast(menuCopy(buildMenuText()) ? '복사했어요 · 붙여넣기 하세요' : '복사가 막혔어요 · 아래 글상자에서 직접 복사해 주세요');
  });

  document.querySelectorAll('#menu-body [data-ai]').forEach((b) => {
    b.addEventListener('click', () => {
      const ai = MENU_AIS.find((a) => a.id === b.dataset.ai);
      menuCopy(buildMenuText());          // 창을 열기 전에 복사부터 — 제스처가 살아 있을 때
      toast('복사했어요 · 붙여넣기 하세요');
      window.open(ai.url, '_blank', 'noopener');
    });
  });
}
