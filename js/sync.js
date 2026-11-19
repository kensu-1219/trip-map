/* 選用：Firebase Firestore 即時同步。沒有設定就完全不載入。 */
(function () {
  'use strict';
  let db = null, auth = null, ready = null, unsub = {}, cfgKey = '';

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('載入 ' + src + ' 失敗'));
      document.head.appendChild(s);
    });
  }

  /** 接受 JSON 或 Firebase 主控台給的 JS 片段 */
  function parseConfig(text) {
    if (!text) return null;
    if (typeof text === 'object') return text.apiKey && text.projectId ? text : null;
    let t = String(text).trim();
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    t = m[0]
      .replace(/\/\/.*$/gm, '')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*}/g, '}');
    try {
      const o = JSON.parse(t);
      return o.apiKey && o.projectId ? o : null;
    } catch (e) { return null; }
  }

  function init(cfg) {
    const k = JSON.stringify(cfg);
    if (ready && k === cfgKey) return ready;
    cfgKey = k;
    ready = (async () => {
      if (!window.firebase) {
        await loadScript('vendor/firebase/firebase-app-compat.js');
        await loadScript('vendor/firebase/firebase-auth-compat.js');
        await loadScript('vendor/firebase/firebase-firestore-compat.js');
      }
      const name = 'trip-' + (cfg.projectId || 'x');
      const app = firebase.apps.find((a) => a.name === name) || firebase.initializeApp(cfg, name);
      auth = app.auth();
      if (!auth.currentUser) await auth.signInAnonymously();
      db = app.firestore();
      try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 已啟用或不支援 */ }
      return true;
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  async function push(trip) {
    if (!db) throw new Error('同步尚未連線');
    await db.collection('trips').doc(trip.id).set({
      data: JSON.stringify(trip), updatedAt: trip.updatedAt, by: auth.currentUser ? auth.currentUser.uid : '',
    });
  }

  function watch(tripId, onRemote, onError) {
    if (!db) return;
    if (unsub[tripId]) unsub[tripId]();
    unsub[tripId] = db.collection('trips').doc(tripId).onSnapshot((snap) => {
      if (snap.metadata.hasPendingWrites) return;
      const d = snap.data();
      if (!d) return;
      try { onRemote(JSON.parse(d.data), d.updatedAt); } catch (e) { onError && onError(e); }
    }, (err) => onError && onError(err));
  }

  async function fetchOnce(tripId) {
    if (!db) throw new Error('同步尚未連線');
    const snap = await db.collection('trips').doc(tripId).get();
    if (!snap.exists) throw new Error('找不到這個共用行程（可能已刪除或 Firebase 設定不同）');
    return JSON.parse(snap.data().data);
  }

  function stop(tripId) { if (unsub[tripId]) { unsub[tripId](); delete unsub[tripId]; } }

  window.TripSync = { parseConfig, init, push, watch, fetchOnce, stop, get connected() { return !!db; } };
})();
