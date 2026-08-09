/* 시트 동기화 — 시트가 정본, localStorage는 캐시.
 *
 * 오프라인에서도 앱은 그대로 돌아간다. 온라인이 되면 밀린 변경을 밀어올리고
 * 시트 쪽 변경을 받아온다. 같은 레코드가 양쪽에서 바뀌었으면 updatedAt이
 * 늦은 쪽이 이긴다(손으로 시트를 고치면 Apps Script가 updatedAt을 찍는다).
 *
 * 저장하는 것 3개:
 *   fridge.sync.v1    설정 (URL, 마지막 성공 시각, 마지막 에러)
 *   fridge.shadow.v1  마지막으로 서버와 맞춘 상태 — 무엇이 바뀌었는지 판별하는 기준
 *   fridge.tomb.v1    지운 것의 묘비 (id → 지운 시각). 없으면 지운 게 되살아난다.
 */

'use strict';

const Sync = (() => {
  const CFG_KEY = 'fridge.sync.v1';
  const SHADOW_KEY = 'fridge.shadow.v1';
  const TOMB_KEY = 'fridge.tomb.v1';

  /* Code.gs SPEC과 맞아야 한다 */
  const KINDS = {
    items: { key: 'id', fields: ['id', 'name', 'categoryId', 'compartmentId', 'memo', 'addedAt', 'expiresAt'] },
    logs: { key: 'id', fields: ['id', 'name', 'categoryId', 'unit', 'addedAt', 'removedAt', 'reason', 'daysHeld'] },
    shopping: { key: 'id', fields: ['id', 'text', 'checked', 'createdAt'] },
    presets: { key: 'name', fields: ['name', 'cat', 'days'] },
    settings: { key: 'key', fields: ['key', 'value'] },
  };

  /* 기기별 UI 상태라 시트에 올리지 않는다 */
  const LOCAL_ONLY_SETTINGS = ['lastUnit'];

  /* 수정시각은 문자열로 비교하므로 같은 값이 두 번 나오면 "동시"가 되고,
     병합이 한쪽을 조용히 버린다(넣자마자 지운 재료의 삭제가 사라지는 등).
     같은 밀리초에 두 번 찍히면 1ms 밀어 항상 증가하게 만든다. */
  let lastStamp = '';
  const nowIso = () => {
    let s = new Date().toISOString();
    if (s <= lastStamp) s = new Date(new Date(lastStamp).getTime() + 1).toISOString();
    lastStamp = s;
    return s;
  };
  const readJSON = (k, dflt) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; }
    catch (e) { return dflt; }
  };
  const writeJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 용량 초과는 앱 쪽에서 안내 */ }
  };

  let cfg = Object.assign({ url: '', lastOkAt: null, lastErr: null, auto: true }, readJSON(CFG_KEY, {}));
  let shadow = readJSON(SHADOW_KEY, {});
  let tomb = readJSON(TOMB_KEY, {});
  let state = cfg.url ? 'idle' : 'off';
  let running = false;
  let pushTimer = null;
  let listeners = [];
  let applying = false;

  const saveCfg = () => writeJSON(CFG_KEY, cfg);
  const emit = () => listeners.forEach((f) => { try { f(status()); } catch (e) {} });

  function setState(s, err) {
    state = s;
    if (err !== undefined) cfg.lastErr = err;
    emit();
  }

  /* ───────── 레코드 정규화 ───────── */

  /* settings 객체 ↔ {key,value} 행 */
  function settingsToRecs(S) {
    const out = [];
    Object.keys(S.settings || {}).forEach((k) => {
      if (LOCAL_ONLY_SETTINGS.indexOf(k) >= 0) return;
      const v = S.settings[k];
      out.push({ key: k, value: v == null ? '' : String(v), updatedAt: (S._stamp && S._stamp.settings && S._stamp.settings[k]) || '' });
    });
    return out;
  }

  function localRecs(S, kind) {
    if (kind === 'settings') return settingsToRecs(S);
    if (kind === 'presets') return (S.presets || []).map((p) => Object.assign({}, p));
    return (S[kind] || []).map((r) => Object.assign({}, r));
  }

  /* updatedAt을 뺀 내용만 비교해야 저장할 때마다 도장이 새로 찍히지 않는다 */
  function contentOf(kind, rec) {
    const f = KINDS[kind].fields;
    const o = {};
    for (let i = 0; i < f.length; i++) {
      const v = rec[f[i]];
      o[f[i]] = v == null ? '' : (typeof v === 'boolean' ? v : String(v));
    }
    return JSON.stringify(o);
  }

  const mapBy = (kind, arr) => {
    const k = KINDS[kind].key;
    const m = {};
    (arr || []).forEach((r) => { if (r && r[k] != null && r[k] !== '') m[String(r[k])] = r; });
    return m;
  };

  /* ───────── 변경 판별 + 도장 ───────── */

  /* save() 직전에 호출. 섀도와 달라진 레코드에 updatedAt을 찍고, 사라진 건 묘비를 세운다.
     S를 제자리에서 고치므로 호출자는 그 뒤에 저장하면 된다. */
  function stampChanges(S) {
    if (applying) return 0;
    const stamp = nowIso();
    let n = 0;
    S._stamp = S._stamp || {};
    S._stamp.settings = S._stamp.settings || {};

    Object.keys(KINDS).forEach((kind) => {
      const keyName = KINDS[kind].key;
      const cur = localRecs(S, kind);
      const curMap = mapBy(kind, cur);
      const shMap = shadow[kind] || {};

      // 바뀐 것 · 새로 생긴 것
      cur.forEach((rec) => {
        const key = String(rec[keyName]);
        const old = shMap[key];
        if (old && contentOf(kind, old) === contentOf(kind, rec)) return;
        if (kind === 'settings') {
          S._stamp.settings[rec.key] = stamp;
        } else if (kind === 'presets') {
          const t = (S.presets || []).find((p) => p.name === rec.name);
          if (t) t.updatedAt = stamp;
        } else {
          const t = (S[kind] || []).find((r) => String(r[keyName]) === key);
          if (t) t.updatedAt = stamp;
        }
        n++;
      });

      // 사라진 것 → 묘비
      Object.keys(shMap).forEach((key) => {
        if (curMap[key]) return;
        tomb[kind] = tomb[kind] || {};
        if (!tomb[kind][key]) { tomb[kind][key] = stamp; n++; }
      });
    });

    if (n) writeJSON(TOMB_KEY, tomb);
    return n;
  }

  /* 서버에 보낼 것만 골라낸다 */
  function buildChanges(S) {
    const changes = {};
    let count = 0;

    Object.keys(KINDS).forEach((kind) => {
      const keyName = KINDS[kind].key;
      const shMap = shadow[kind] || {};
      const out = [];

      localRecs(S, kind).forEach((rec) => {
        const key = String(rec[keyName]);
        const old = shMap[key];
        if (old && contentOf(kind, old) === contentOf(kind, rec)) return;
        const send = {};
        KINDS[kind].fields.forEach((f) => { send[f] = rec[f] == null ? '' : rec[f]; });
        send.updatedAt = rec.updatedAt
          || (kind === 'settings' && S._stamp && S._stamp.settings && S._stamp.settings[rec.key])
          || nowIso();
        send.deleted = false;
        out.push(send);
      });

      Object.keys(tomb[kind] || {}).forEach((key) => {
        const send = {};
        KINDS[kind].fields.forEach((f) => { send[f] = ''; });
        send[keyName] = key;
        send.updatedAt = tomb[kind][key];
        send.deleted = true;
        out.push(send);
      });

      if (out.length) { changes[kind] = out; count += out.length; }
    });

    return { changes, count };
  }

  function dirtyCount(S) {
    if (!S) return 0;
    return buildChanges(S).count;
  }

  /* ───────── 서버 응답을 로컬에 반영 ───────── */

  function applySnapshot(S, snap) {
    let changed = 0;

    Object.keys(KINDS).forEach((kind) => {
      const keyName = KINDS[kind].key;
      const srv = mapBy(kind, snap[kind]);
      const tk = tomb[kind] || {};

      if (kind === 'settings') {
        Object.keys(srv).forEach((key) => {
          const rec = srv[key];
          if (rec.deleted) return;
          const mine = (S._stamp && S._stamp.settings && S._stamp.settings[key]) || '';
          if (mine && mine > String(rec.updatedAt || '')) return;
          const cur = S.settings[key];
          let v = rec.value;
          if (typeof cur === 'number') { const n = Number(v); if (!isNaN(n)) v = n; else return; }
          if (cur === null || typeof cur === 'string') { v = v === '' ? null : String(v); }
          if (String(cur) !== String(v)) { S.settings[key] = v; changed++; }
          if (S._stamp && S._stamp.settings) delete S._stamp.settings[key];
        });
        return;
      }

      const list = kind === 'presets' ? (S.presets = S.presets || []) : (S[kind] = S[kind] || []);
      const idx = {};
      list.forEach((r, i) => { idx[String(r[keyName])] = i; });

      Object.keys(srv).forEach((key) => {
        const rec = srv[key];
        const at = String(rec.updatedAt || '');
        const here = idx[key] === undefined ? null : list[idx[key]];

        if (rec.deleted) {
          // 서버가 지웠다. 로컬이 더 최신이면(다시 넣은 경우) 로컬을 남긴다.
          if (here && String(here.updatedAt || '') > at) return;
          if (here) { list.splice(idx[key], 1); list.forEach((r, i) => { idx[String(r[keyName])] = i; }); changed++; }
          if (tk[key] && tk[key] <= at) delete tk[key];
          return;
        }

        // 로컬에서 지운 게 서버보다 나중이면 되살리지 않는다
        if (tk[key] && tk[key] > at) return;

        const clean = {};
        KINDS[kind].fields.forEach((f) => { clean[f] = rec[f]; });
        clean.updatedAt = at;

        if (!here) {
          list.push(clean); idx[key] = list.length - 1; changed++;
        } else if (at >= String(here.updatedAt || '')) {
          /* 같은 시각이면 시트를 따른다. 서버도 같은 규칙(시트 우선)이라
             양쪽이 같은 결론에 도달한다. 한쪽만 "내 값 유지"로 두면
             둘 다 자기 값을 지키면서 밀린 변경 0건으로 보고돼, 어긋난 줄
             모르는 채 영구 불일치가 된다. */
          if (contentOf(kind, here) !== contentOf(kind, clean)) changed++;
          Object.assign(here, clean);
        }
      });

      tomb[kind] = tk;
    });

    return changed;
  }

  function setShadow(snap) {
    const next = {};
    Object.keys(KINDS).forEach((kind) => {
      const m = {};
      (snap[kind] || []).forEach((rec) => {
        if (rec.deleted) return;
        const key = String(rec[KINDS[kind].key]);
        if (!key) return;
        const o = {};
        KINDS[kind].fields.forEach((f) => { o[f] = rec[f]; });
        o.updatedAt = rec.updatedAt;
        m[key] = o;
      });
      next[kind] = m;
    });
    shadow = next;
    writeJSON(SHADOW_KEY, shadow);
  }

  function pruneTombs(snap) {
    Object.keys(KINDS).forEach((kind) => {
      const srv = mapBy(kind, snap[kind]);
      const tk = tomb[kind] || {};
      Object.keys(tk).forEach((key) => {
        const rec = srv[key];
        if (rec && rec.deleted) delete tk[key];       // 서버도 지웠음 → 묘비 역할 끝
        else if (!rec) delete tk[key];                // 서버에 아예 없음 → 더 볼 일 없음
      });
      tomb[kind] = tk;
    });
    writeJSON(TOMB_KEY, tomb);
  }

  /* ───────── 통신 ───────── */

  async function call(url, body) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
      const opt = body
        ? {
            method: 'POST',
            // application/json이면 preflight가 생기고 Apps Script가 답하지 못한다
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(body),
            signal: ctl.signal,
            redirect: 'follow',
          }
        : { method: 'GET', signal: ctl.signal, redirect: 'follow' };
      const res = await fetch(url, opt);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch (e) { throw new Error('응답을 읽지 못했어요. 배포 설정에서 접근 권한이 "링크가 있는 모든 사용자"인지 확인해 주세요.'); }
      if (!json.ok) throw new Error(json.error === 'token' ? '토큰이 맞지 않아요' : (json.error || '서버 오류'));
      return json;
    } finally {
      clearTimeout(to);
    }
  }

  /* 한 번 동기화: 변경 밀어올리기 + 시트 받아오기.
     opts.silent 이면 실패해도 토스트를 띄우지 않는다(자동 동기화용). */
  async function run(opts) {
    opts = opts || {};
    if (!cfg.url) { setState('off'); return { ok: false, reason: 'off' }; }
    if (running) return { ok: false, reason: 'running' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState('offline');
      return { ok: false, reason: 'offline' };
    }

    running = true;
    setState('syncing');
    try {
      const S = window.getState();

      /* 처음 연결하는 기기는 밀어올리기 전에 먼저 받아온다.
         이걸 건너뛰면 이 기기의 "기본값"이 로컬 변경으로 오인돼 시트를 덮어쓴다:
           · 설정 — 기본 90일이 시트에 저장된 120일을 되돌린다
           · 사전 — 시트에서 지운 재료가 기본 사전 130개에 밀려 되살아난다
         재료·기록은 목록이 비어 있어 올릴 게 없으므로 원래 안전하다. */
      if (!cfg.lastOkAt && !opts.pushFirst) {
        const first = await call(cfg.url, { changes: {}, clientTime: nowIso() });
        applying = true;
        applySnapshot(S, first);
        pruneTombs(first);
        setShadow(first);
        window.commitState({ silent: true });
        applying = false;
      }

      stampChanges(S);
      const { changes, count } = buildChanges(S);

      const snap = await call(cfg.url, { changes, clientTime: nowIso() });

      applying = true;
      const applied = applySnapshot(S, snap);
      pruneTombs(snap);
      setShadow(snap);
      window.commitState({ silent: true });
      applying = false;

      cfg.lastOkAt = nowIso();
      cfg.lastErr = null;
      saveCfg();
      setState('idle');

      if (applied || count) window.afterSync(applied);
      return { ok: true, pushed: count, pulled: applied };
    } catch (err) {
      applying = false;
      let msg = err && err.message ? err.message : String(err);
      if (err && err.name === 'AbortError') msg = '시트가 응답하지 않아요 (25초 초과)';
      else if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = '시트에 닿지 못했어요 (인터넷 또는 주소 확인)';
      setState('error', msg);
      saveCfg();
      if (!opts.silent) window.toast('동기화 실패: ' + msg);
      return { ok: false, error: msg };
    } finally {
      running = false;
    }
  }

  /* 저장 후 잠깐 모아서 한 번에 올린다 (연속 등록 때 요청이 쏟아지지 않게) */
  function schedule() {
    if (!cfg.url || !cfg.auto) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; run({ silent: true }); }, 3000);
  }

  function status() {
    let dirty = 0;
    try { dirty = cfg.url ? dirtyCount(window.getState()) : 0; } catch (e) { dirty = 0; }
    return { state, url: cfg.url, auto: cfg.auto, lastOkAt: cfg.lastOkAt, lastErr: cfg.lastErr, dirty };
  }

  /* 이 주소로 재고 전체가 POST되므로 형식만 보고 받아들이면 안 된다.
     UI에서도 검사하지만, 여기서 한 번 더 막는다. */
  const URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?.*)?$/;

  function setUrl(url) {
    const u = String(url || '').trim();
    if (u && !URL_OK.test(u)) { setState(state, '주소 형식이 맞지 않아요'); return false; }
    cfg.url = u;
    cfg.lastErr = null;
    saveCfg();
    if (!u) { shadow = {}; tomb = {}; writeJSON(SHADOW_KEY, shadow); writeJSON(TOMB_KEY, tomb); setState('off'); }
    else setState('idle');
    return true;
  }

  function setAuto(v) { cfg.auto = !!v; saveCfg(); emit(); }

  /* 이 기기 내용을 전부 시트로 올린다. 사용자가 명시적으로 누르는 버튼이라
     "먼저 받아오기"를 건너뛴다(pushFirst) — 그게 이 버튼의 목적이다. */
  function forcePushAll() {
    shadow = {};
    tomb = {};
    writeJSON(SHADOW_KEY, shadow);
    writeJSON(TOMB_KEY, tomb);
    return run({ pushFirst: true });
  }

  function reset() {
    shadow = {}; tomb = {};
    writeJSON(SHADOW_KEY, shadow);
    writeJSON(TOMB_KEY, tomb);
  }

  return {
    run, schedule, status, setUrl, setAuto, forcePushAll, reset,
    stampChanges, dirtyCount,
    onStatus: (f) => { listeners.push(f); },
    isApplying: () => applying,
    configured: () => !!cfg.url,
  };
})();
