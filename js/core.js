/* TripCore — 純邏輯（無 DOM），瀏覽器與 Node 測試共用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TripCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;

  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  const validLatLng = (lat, lng) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

  function uid() {
    const a = new Uint8Array(12);
    (globalThis.crypto || require('crypto').webcrypto).getRandomValues(a);
    return Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16);
  }

  /* ---------- 文字格式 ---------- */
  function fmtDist(m) {
    if (!Number.isFinite(m)) return '—';
    return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
  }
  function fmtDur(s) {
    if (!Number.isFinite(s)) return '—';
    const min = Math.max(1, Math.round(s / 60));
    if (min < 60) return min + ' 分';
    const h = Math.floor(min / 60), r = min % 60;
    return h + ' 小時' + (r ? ' ' + r + ' 分' : '');
  }

  /* ---------- Google Maps 網址解析 ---------- */
  function decodeName(s) {
    try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { s = s.replace(/\+/g, ' '); }
    return s.trim();
  }
  function pairFrom(str) {
    const m = String(str).match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    return validLatLng(lat, lng) ? { lat, lng } : null;
  }

  /**
   * 解析 Google Maps 網址或座標文字。
   * 回傳 {lat,lng,name?,url} | {short:true,url} | {nameOnly:name,url} | null
   */
  function parseGoogleMapsUrl(input) {
    if (!input) return null;
    const text = String(input).trim();
    const direct = pairFrom(text);
    if (direct) return { ...direct, url: '' };
    const urlMatch = text.match(/https?:\/\/[^\s<>"']+/);
    if (!urlMatch) return null;
    const url = urlMatch[0];
    // 分享文字常見格式：「店名\nhttps://maps.app.goo.gl/xxx」
    const before = text.slice(0, urlMatch.index).trim().split('\n').pop().trim();

    if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(url)) {
      return { short: true, url, name: before || '' };
    }
    if (!/google\.[a-z.]+\/maps|maps\.google\.|google\.[a-z.]+\/\?q=|google\.[a-z.]+\/search/i.test(url) && !/[?&](q|query|ll)=/.test(url)) {
      return null;
    }
    let name = '';
    const place = url.match(/\/maps\/place\/([^/@?]+)/);
    if (place) name = decodeName(place[1]);

    // 1) 地點本身座標 !3d<lat>!4d<lng>（最準）
    let m = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (m) {
      const lat = +m[1], lng = +m[2];
      if (validLatLng(lat, lng)) return { lat, lng, name: name || before, url };
    }
    // 2) 查詢參數
    let q = null;
    try {
      const u = new URL(url);
      for (const k of ['q', 'query', 'll', 'destination', 'center', 'daddr']) {
        const v = u.searchParams.get(k);
        if (v) {
          const p = pairFrom(v.replace(/^loc:/, ''));
          if (p) return { ...p, name: name || before, url };
          if (!q && k !== 'll' && k !== 'center') q = v;
        }
      }
    } catch (e) { /* 壞網址 */ }
    // 3) /search/lat,lng 或 /place/lat,lng
    m = url.match(/\/(?:search|place|dir\/[^/]*)\/(-?\d+\.\d+),\+?\s*(-?\d+\.\d+)/);
    if (m) {
      const p = pairFrom(m[1] + ',' + m[2]);
      if (p) return { ...p, name: name || before, url };
    }
    // 4) 視窗中心 @lat,lng（次準）
    m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) {
      const lat = +m[1], lng = +m[2];
      if (validLatLng(lat, lng)) return { lat, lng, name: name || before, url, approx: true };
    }
    const nameOnly = name || (q ? decodeName(q) : '') || before;
    return nameOnly ? { nameOnly, url } : null;
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const rows = []; let row = [], cell = '', i = 0, inQ = false;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
      i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  /* ---------- 匯入：Google Takeout / My Maps / 本工具 JSON ---------- */
  function placeFromProps(name, lat, lng, extra) {
    const ok = validLatLng(lat, lng);
    const p = { name: (name || '').trim() || (ok ? '地點 ' + lat.toFixed(4) + ',' + lng.toFixed(4) : '未命名地點'), ...extra };
    if (ok) { p.lat = lat; p.lng = lng; }
    return p;
  }

  function parseGeoJSON(obj) {
    const feats = obj.type === 'FeatureCollection' ? obj.features || [] : obj.type === 'Feature' ? [obj] : [];
    const out = [];
    for (const f of feats) {
      if (!f || typeof f !== 'object') continue;
      const pr = f.properties || {};
      const loc = pr.location || pr.Location || {};
      let lat, lng;
      if (f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        lng = +f.geometry.coordinates[0]; lat = +f.geometry.coordinates[1];
      }
      if (!validLatLng(lat, lng) && loc['Geo Coordinates']) {
        lat = +loc['Geo Coordinates'].Latitude; lng = +loc['Geo Coordinates'].Longitude;
      }
      const url = pr.google_maps_url || pr['Google Maps URL'] || '';
      if (!validLatLng(lat, lng) && url) {
        const g = parseGoogleMapsUrl(url);
        if (g && g.lat != null) { lat = g.lat; lng = g.lng; }
      }
      const name = loc.name || loc['Business Name'] || pr.Title || pr.title || pr.name || pr.Name || '';
      out.push(placeFromProps(name, lat, lng, {
        address: loc.address || loc.Address || '',
        note: pr.Comment || pr.comment || pr.description || '',
        url,
      }));
    }
    return out;
  }

  function parseTakeoutCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (names) => head.findIndex((h) => names.includes(h));
    const iT = idx(['title', '標題', '名稱', 'name']);
    const iN = idx(['note', '附註', '備註']);
    const iU = idx(['url', '網址']);
    const iC = idx(['comment', '留言', 'description']);
    const iLat = idx(['lat', 'latitude', '緯度']);
    const iLng = idx(['lng', 'lon', 'long', 'longitude', '經度']);
    if (iT < 0 && iU < 0) throw new Error('CSV 找不到 Title／URL 欄位，不像是 Google 已儲存清單');
    const out = [];
    for (const r of rows.slice(1)) {
      const url = iU >= 0 ? (r[iU] || '').trim() : '';
      let lat, lng, nm = iT >= 0 ? r[iT] : '';
      if (iLat >= 0 && iLng >= 0) { lat = parseFloat(r[iLat]); lng = parseFloat(r[iLng]); }
      if (!validLatLng(lat, lng) && url) {
        const g = parseGoogleMapsUrl(url);
        if (g && g.lat != null) { lat = g.lat; lng = g.lng; }
        if (!nm && g) nm = g.name || g.nameOnly || '';
      }
      if (!nm && !url) continue;
      const note = [iN >= 0 ? r[iN] : '', iC >= 0 ? r[iC] : ''].filter(Boolean).join(' / ');
      out.push(placeFromProps(nm, lat, lng, { note, url }));
    }
    return out;
  }

  function parseKML(text) {
    const out = [];
    const marks = String(text).match(/<Placemark[\s\S]*?<\/Placemark>/g) || [];
    const strip = (s) => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    for (const pm of marks) {
      const pt = pm.match(/<Point>[\s\S]*?<coordinates>\s*([^<]+)<\/coordinates>/);
      if (!pt) continue; // 線段/多邊形略過
      const [lng, lat] = pt[1].trim().split(',').map(Number);
      const name = strip((pm.match(/<name>([\s\S]*?)<\/name>/) || [])[1]);
      const note = strip((pm.match(/<description>([\s\S]*?)<\/description>/) || [])[1]);
      out.push(placeFromProps(name, lat, lng, { note: note.slice(0, 500) }));
    }
    return out;
  }

  /**
   * 依副檔名與內容判斷格式。回傳 {kind, places, trip?}
   * 擲出 Error（中文訊息）代表壞檔。
   */
  function parseImport(filename, text) {
    const name = (filename || '').toLowerCase();
    const t = String(text || '').replace(/^﻿/, '').trim();
    if (!t) throw new Error('檔案是空的');
    if (name.endsWith('.kml') || t.startsWith('<?xml') || t.startsWith('<kml')) {
      const places = parseKML(t);
      if (!places.length) throw new Error('KML 裡沒有找到任何地點（Point）');
      return { kind: 'kml', places };
    }
    if (name.endsWith('.json') || name.endsWith('.geojson') || t[0] === '{' || t[0] === '[') {
      let obj;
      try { obj = JSON.parse(t); } catch (e) { throw new Error('JSON 格式錯誤，檔案可能損毀或不完整'); }
      if (obj && obj.app === 'trip-map' && obj.trip) return { kind: 'trip', trip: sanitizeTrip(obj.trip), places: [] };
      if (obj && (obj.type === 'FeatureCollection' || obj.type === 'Feature')) {
        const places = parseGeoJSON(obj);
        if (!places.length) throw new Error('GeoJSON 裡沒有任何地點');
        return { kind: 'geojson', places };
      }
      throw new Error('看不懂這個 JSON：不是 Google Takeout 的 GeoJSON，也不是本工具的備份檔');
    }
    if (name.endsWith('.csv') || t.includes(',')) {
      const places = parseTakeoutCSV(t);
      if (!places.length) throw new Error('CSV 裡沒有任何地點');
      return { kind: 'csv', places };
    }
    throw new Error('不支援的檔案格式（支援 .csv / .json / .geojson / .kml）');
  }

  /* ---------- 行程資料 ---------- */
  const PALETTE = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#e67700', '#d6336c', '#0c8599', '#5c7cfa', '#74b816', '#868e96'];
  const dayColor = (d) => (d > 0 ? PALETTE[(d - 1) % PALETTE.length] : '#888');

  function newTrip(name) {
    return { id: uid(), name: name || '我的旅程', days: 3, startDate: '', dayStart: '09:00', base: null, places: [], legModes: {}, updatedAt: Date.now() };
  }

  function sanitizePlace(p) {
    if (!p || typeof p !== 'object') return null;
    const lat = +p.lat, lng = +p.lng;
    if (!validLatLng(lat, lng)) return null;
    const s = (v, n) => String(v == null ? '' : v).slice(0, n);
    return {
      id: s(p.id, 40) || uid(), name: s(p.name, 200) || '未命名地點', lat, lng,
      note: s(p.note, 2000), url: s(p.url, 2000), address: s(p.address, 500),
      day: Number.isInteger(p.day) && p.day >= 0 && p.day <= 60 ? p.day : 0,
      order: Number.isFinite(+p.order) ? +p.order : 0,
      locked: !!p.locked, stay: Number.isFinite(+p.stay) ? Math.max(0, Math.min(1440, +p.stay)) : 60,
    };
  }
  function sanitizeTrip(t) {
    if (!t || typeof t !== 'object') throw new Error('行程資料損毀');
    const out = newTrip(String(t.name || '匯入的旅程').slice(0, 100));
    if (t.id && /^[a-z0-9]{6,40}$/i.test(t.id)) out.id = t.id;
    out.days = Math.max(1, Math.min(60, parseInt(t.days, 10) || 3));
    out.startDate = /^\d{4}-\d{2}-\d{2}$/.test(t.startDate || '') ? t.startDate : '';
    out.dayStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(t.dayStart || '') ? t.dayStart : '09:00';
    if (Number.isFinite(+t.lastBackup)) out.lastBackup = +t.lastBackup;
    out.base = t.base ? sanitizePlace({ ...t.base, id: 'base', day: 0 }) : null;
    out.places = (Array.isArray(t.places) ? t.places : []).map(sanitizePlace).filter(Boolean).slice(0, 5000);
    out.legModes = {};
    if (t.legModes && typeof t.legModes === 'object') {
      for (const [k, v] of Object.entries(t.legModes)) if (MODES[v]) out.legModes[String(k).slice(0, 90)] = v;
    }
    out.updatedAt = +t.updatedAt || Date.now();
    return out;
  }

  /** 合併新地點：同名且 80m 內視為重複 */
  function mergePlaces(existing, incoming) {
    const added = [], dup = [];
    const all = existing.slice();
    for (const p of incoming) {
      if (p.lat == null) continue;
      const d = all.find((e) => haversine(e, p) < 80 && (e.name === p.name || haversine(e, p) < 15));
      if (d) { dup.push(p); continue; }
      const np = sanitizePlace({ ...p, id: uid(), day: 0 });
      if (np) { all.push(np); added.push(np); }
    }
    return { places: all, added, dup };
  }

  /* ---------- 交通方式與估算 ---------- */
  const MODES = {
    walk: { label: '步行', icon: '🚶', kmh: 4.5, detour: 1.25, osrm: 'routed-foot', gm: 'walking', g: 'WALK' },
    bike: { label: '單車', icon: '🚲', kmh: 14, detour: 1.25, osrm: 'routed-bike', gm: 'bicycling', g: 'BICYCLE' },
    drive: { label: '開車', icon: '🚗', kmh: 28, detour: 1.35, osrm: 'routed-car', gm: 'driving', g: 'DRIVE' },
    transit: { label: '大眾運輸', icon: '🚇', kmh: 24, detour: 1.3, gm: 'transit', g: 'TRANSIT', wait: 8 * 60 },
  };

  function estimateLeg(meters, mode) {
    const m = MODES[mode] || MODES.walk;
    const dist = meters * m.detour;
    let sec = (dist / 1000 / m.kmh) * 3600;
    if (mode === 'transit') {
      if (meters < 800) return { distance: meters * 1.25, duration: (meters * 1.25 / 1000 / 4.5) * 3600, estimated: true, note: '距離太近，建議步行' };
      sec += m.wait + 5 * 60; // 等車＋進出站步行
    }
    return { distance: dist, duration: sec, estimated: true };
  }

  /** 依直線距離建議交通方式 */
  function suggestMode(meters) {
    if (meters < 1200) return 'walk';
    if (meters < 40000) return 'transit';
    return 'drive';
  }

  function gmapsDirUrl(a, b, mode) {
    const m = MODES[mode] || MODES.transit;
    return 'https://www.google.com/maps/dir/?api=1&origin=' + a.lat + ',' + a.lng + '&destination=' + b.lat + ',' + b.lng + '&travelmode=' + m.gm;
  }
  /** 整天路線一次開進 Google Maps（最多 9 個中途點） */
  function gmapsDayUrl(seq, mode) {
    if (seq.length < 2) return '';
    const m = MODES[mode] || MODES.transit;
    const ll = (p) => p.lat + ',' + p.lng;
    const mid = seq.slice(1, -1).slice(0, 9).map(ll).join('|');
    return 'https://www.google.com/maps/dir/?api=1&origin=' + ll(seq[0]) + '&destination=' + ll(seq[seq.length - 1]) +
      (mid ? '&waypoints=' + encodeURIComponent(mid) : '') + '&travelmode=' + m.gm;
  }
  const hm = (min) => { min = Math.round(min); const h = Math.floor(min / 60) % 24, m = ((min % 60) + 60) % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 540; };
  /**
   * 時間表：legSecs 為每段移動秒數（有住宿時含頭尾兩段），stays 為每站停留分鐘。
   * 回傳 [{arrive, depart}]（分鐘）與 end（回到住宿或最後離開）。
   */
  function timeline(startHHMM, legSecs, stays, hasBase) {
    let t = toMin(startHHMM), li = 0;
    const out = [];
    for (let i = 0; i < stays.length; i++) {
      if (hasBase || i > 0) t += (legSecs[li++] || 0) / 60;
      const arrive = t; t += stays[i] || 0;
      out.push({ arrive, depart: t });
    }
    if (hasBase && stays.length) t += (legSecs[li] || 0) / 60;
    return { stops: out, end: t };
  }

  function gmapsPlaceUrl(p) {
    if (p.url && /^https:\/\//.test(p.url)) return p.url;
    return 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng;
  }

  /* ---------- 分天排程 ---------- */
  function centroid(pts) {
    let x = 0, y = 0, z = 0;
    for (const p of pts) {
      const la = toRad(p.lat), lo = toRad(p.lng);
      x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
    }
    const n = pts.length || 1; x /= n; y /= n; z /= n;
    return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lng: (Math.atan2(y, x) * 180) / Math.PI };
  }

  /** 決定性的平衡 k-means：回傳每點群組索引 */
  function balancedClusters(pts, k, caps) {
    const n = pts.length;
    if (k <= 1 || n <= 1) return pts.map(() => 0);
    k = Math.min(k, n);
    // farthest-first 初始化
    const c0 = centroid(pts);
    let first = 0, best = -1;
    pts.forEach((p, i) => { const d = haversine(p, c0); if (d > best) { best = d; first = i; } });
    const cents = [{ lat: pts[first].lat, lng: pts[first].lng }];
    while (cents.length < k) {
      let bi = 0, bd = -1;
      pts.forEach((p, i) => { const d = Math.min(...cents.map((c) => haversine(p, c))); if (d > bd) { bd = d; bi = i; } });
      cents.push({ lat: pts[bi].lat, lng: pts[bi].lng });
    }
    const cap = caps || Array(k).fill(Math.ceil(n / k));
    let assign = new Array(n).fill(-1);
    for (let iter = 0; iter < 25; iter++) {
      // 容量限制下的貪婪分配：先分配「最有偏好差」的點
      const order = pts.map((p, i) => {
        const ds = cents.map((c) => haversine(p, c)).sort((a, b) => a - b);
        return { i, regret: (ds[1] || 0) - ds[0] };
      }).sort((a, b) => b.regret - a.regret);
      const count = new Array(k).fill(0);
      const next = new Array(n).fill(-1);
      for (const { i } of order) {
        const ranked = cents.map((c, j) => ({ j, d: haversine(pts[i], c) })).sort((a, b) => a.d - b.d);
        const pick = ranked.find((r) => count[r.j] < cap[r.j]) || ranked[0];
        next[i] = pick.j; count[pick.j]++;
      }
      const changed = next.some((v, i) => v !== assign[i]);
      assign = next;
      for (let j = 0; j < k; j++) {
        const mem = pts.filter((_, i) => assign[i] === j);
        if (mem.length) cents[j] = centroid(mem);
      }
      if (!changed) break;
    }
    return assign;
  }

  function pathLen(seq, start, end) {
    let d = 0, prev = start;
    for (const p of seq) { if (prev) d += haversine(prev, p); prev = p; }
    if (end && prev) d += haversine(prev, end);
    return d;
  }

  /** 最近鄰＋2-opt 排序（O(1) 增量計算＋時間上限）。start/end 可為 null（開放路徑） */
  function orderStops(pts, start, end, budgetMs) {
    if (pts.length <= 1) return pts.slice();
    const n = pts.length;
    const nn = (firstIdx) => {
      const used = new Uint8Array(n); const seq = [];
      let cur = start;
      if (firstIdx != null) { cur = pts[firstIdx]; used[firstIdx] = 1; seq.push(cur); }
      while (seq.length < n) {
        let bi = -1, bd = Infinity;
        for (let i = 0; i < n; i++) if (!used[i]) { const d = haversine(cur, pts[i]); if (d < bd) { bd = d; bi = i; } }
        used[bi] = 1; cur = pts[bi]; seq.push(cur);
      }
      return seq;
    };
    let seq;
    if (start) seq = nn(null);
    else {
      const tries = n <= 60 ? n : 1;
      let best = Infinity;
      for (let i = 0; i < tries; i++) { const c = nn(i); const l = pathLen(c, null, end); if (l < best) { best = l; seq = c; } }
    }
    // 2-opt：nodes = [start?] + seq + [end?]，缺端點用 null（距離 0）
    const d = (a, b) => (a && b ? haversine(a, b) : 0);
    const nodes = [start || null].concat(seq, [end || null]);
    const deadline = Date.now() + (budgetMs || (n > 200 ? 400 : 2000));
    let improved = true;
    while (improved && Date.now() < deadline) {
      improved = false;
      for (let i = 1; i < nodes.length - 2; i++) {
        for (let j = i + 1; j < nodes.length - 1; j++) {
          const a = nodes[i - 1], b = nodes[i], c = nodes[j], e = nodes[j + 1];
          const delta = d(a, c) + d(b, e) - d(a, b) - d(c, e);
          if (delta < -1e-6) {
            for (let x = i, y = j; x < y; x++, y--) { const t = nodes[x]; nodes[x] = nodes[y]; nodes[y] = t; }
            improved = true;
          }
        }
        if (Date.now() > deadline) break;
      }
    }
    return nodes.slice(1, -1);
  }

  /**
   * 自動排程：把 trip.places 分成 trip.days 天並排出順序。
   * locked 的地點保留原本的天數。base（住宿）作為每天起終點。
   * 回傳新的 places 陣列（不修改原物件）。
   */
  function planDays(trip) {
    const days = Math.max(1, trip.days | 0);
    const places = trip.places.map((p) => ({ ...p }));
    const free = places.filter((p) => !(p.locked && p.day >= 1 && p.day <= days));
    const lockedCount = new Array(days).fill(0);
    places.forEach((p) => { if (p.locked && p.day >= 1 && p.day <= days) lockedCount[p.day - 1]++; });
    const total = places.length;
    const target = Math.ceil(total / days);
    const caps = lockedCount.map((c) => Math.max(0, target - c));
    // 容量總和不足時補足
    let deficit = free.length - caps.reduce((a, b) => a + b, 0);
    for (let j = 0; deficit > 0; j = (j + 1) % days) { caps[j]++; deficit--; }

    if (free.length) {
      const assign = balancedClusters(free, Math.min(days, free.length), caps.slice(0, Math.min(days, free.length)));
      // 把群組對應到天數：有鎖定點的天數優先配最接近的群組
      const groups = [...new Set(assign)];
      const gCent = groups.map((g) => centroid(free.filter((_, i) => assign[i] === g)));
      const dayCent = Array.from({ length: days }, (_, d) => {
        const lk = places.filter((p) => p.locked && p.day === d + 1);
        return lk.length ? centroid(lk) : null;
      });
      const map = {}; const usedDays = new Set();
      groups.forEach((g, gi) => {
        let bestD = -1, bd = Infinity;
        dayCent.forEach((c, d) => { if (c && !usedDays.has(d)) { const dd = haversine(c, gCent[gi]); if (dd < bd) { bd = dd; bestD = d; } } });
        if (bestD >= 0) { map[g] = bestD; usedDays.add(bestD); }
      });
      let nextDay = 0;
      // 未對應的群組依「與住宿距離」或經度排序後依序填入空的天
      const rest = groups.filter((g) => map[g] == null)
        .sort((a, b) => {
          const ca = gCent[groups.indexOf(a)], cb = gCent[groups.indexOf(b)];
          return trip.base ? haversine(trip.base, ca) - haversine(trip.base, cb) : ca.lng - cb.lng;
        });
      for (const g of rest) {
        while (usedDays.has(nextDay)) nextDay++;
        map[g] = nextDay; usedDays.add(nextDay);
      }
      free.forEach((p, i) => { p.day = map[assign[i]] + 1; });
    }
    // 每天排序
    for (let d = 1; d <= days; d++) {
      const pts = places.filter((p) => p.day === d);
      const seq = orderStops(pts, trip.base, trip.base);
      seq.forEach((p, i) => { p.order = i; });
    }
    return places;
  }

  function dayStops(trip, d) {
    return trip.places.filter((p) => p.day === d).sort((a, b) => a.order - b.order);
  }

  const legKey = (a, b) => a.id + '>' + b.id;

  /* ---------- 路線服務回應解析 ---------- */
  function parseOsrm(json) {
    if (!json || json.code !== 'Ok' || !json.routes || !json.routes[0]) throw new Error('路線服務沒有回傳結果');
    const r = json.routes[0];
    const coords = r.geometry && r.geometry.coordinates ? r.geometry.coordinates.map((c) => [c[1], c[0]]) : [];
    return { distance: r.distance, duration: r.duration, coords };
  }

  function decodePolyline(str) {
    let i = 0, lat = 0, lng = 0; const out = [];
    while (i < str.length) {
      for (const which of [0, 1]) {
        let shift = 0, result = 0, b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const v = result & 1 ? ~(result >> 1) : result >> 1;
        if (which === 0) lat += v; else lng += v;
      }
      out.push([lat / 1e5, lng / 1e5]);
    }
    return out;
  }

  const VEHICLE_ICON = { SUBWAY: '🚇', METRO_RAIL: '🚇', RAIL: '🚆', HEAVY_RAIL: '🚆', COMMUTER_TRAIN: '🚆', HIGH_SPEED_TRAIN: '🚄', LONG_DISTANCE_TRAIN: '🚆', BUS: '🚌', INTERCITY_BUS: '🚌', TROLLEYBUS: '🚎', TRAM: '🚊', MONORAIL: '🚝', FERRY: '⛴️', CABLE_CAR: '🚡', GONDOLA_LIFT: '🚡', FUNICULAR: '🚞' };

  function parseGoogleRoute(json) {
    const r = json && json.routes && json.routes[0];
    if (!r) throw new Error('Google 沒有找到大眾運輸路線');
    const dur = parseFloat(String(r.duration || '0').replace('s', ''));
    const steps = [];
    for (const leg of r.legs || []) {
      for (const s of leg.steps || []) {
        const td = s.transitDetails;
        if (td) {
          const line = td.transitLine || {};
          const vt = (line.vehicle && line.vehicle.type) || 'BUS';
          steps.push({
            icon: VEHICLE_ICON[vt] || '🚌',
            line: line.nameShort || line.name || '',
            color: line.color || '',
            from: td.stopDetails && td.stopDetails.departureStop ? td.stopDetails.departureStop.name : '',
            to: td.stopDetails && td.stopDetails.arrivalStop ? td.stopDetails.arrivalStop.name : '',
            stops: td.stopCount || 0,
            dep: td.localizedValues && td.localizedValues.departureTime ? td.localizedValues.departureTime.time.text : '',
          });
        } else if (s.travelMode === 'WALK') {
          const last = steps[steps.length - 1];
          const sd = parseFloat(String(s.staticDuration || '0').replace('s', ''));
          if (last && last.walk) last.sec += sd; else steps.push({ walk: true, icon: '🚶', sec: sd });
        }
      }
    }
    const coords = r.polyline && r.polyline.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : [];
    const fare = r.travelAdvisory && r.travelAdvisory.transitFare ? r.travelAdvisory.transitFare : null;
    return { distance: r.distanceMeters || 0, duration: dur, coords, steps, fare };
  }

  /* ---------- 分享連結編碼（壓縮在 app 層處理） ---------- */
  function b64urlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /** 分享用精簡格式（縮短連結） */
  function packTrip(t) {
    return {
      n: t.name, d: t.days, s: t.startDate || undefined, h: t.dayStart && t.dayStart !== '09:00' ? t.dayStart : undefined,
      b: t.base ? [t.base.name, +t.base.lat.toFixed(6), +t.base.lng.toFixed(6)] : undefined,
      p: t.places.map((p) => [p.name, +p.lat.toFixed(6), +p.lng.toFixed(6), p.day, p.order, p.note || 0, p.locked ? 1 : 0, p.stay === 60 ? 0 : p.stay, p.url && p.url.length < 300 ? p.url : 0]),
      m: packModes(t),
    };
  }
  function packModes(t) {
    const idx = { base: 'b' };
    t.places.forEach((p, i) => { idx[p.id] = i; });
    const out = {};
    for (const [k, v] of Object.entries(t.legModes || {})) {
      const [a, b] = k.split('>');
      if (idx[a] != null && idx[b] != null) out[idx[a] + '>' + idx[b]] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  function unpackTrip(o) {
    const t = newTrip(o.n);
    t.days = o.d; t.startDate = o.s || ''; t.dayStart = o.h || '09:00';
    if (o.b) t.base = { name: o.b[0], lat: o.b[1], lng: o.b[2] };
    const idMap = [];
    t.places = (o.p || []).map((a, i) => {
      const id = 'p' + i.toString(36);
      idMap.push(id);
      return { id, name: a[0], lat: a[1], lng: a[2], day: a[3], order: a[4], note: a[5] || '', locked: !!a[6], stay: a[7] || 60, url: a[8] || '' };
    });
    t.legModes = {};
    for (const [k, v] of Object.entries(o.m || {})) {
      const [a, b] = k.split('>').map((x) => (x === 'b' ? 'base' : idMap[+x]));
      if (a && b) t.legModes[a + '>' + b] = v;
    }
    return sanitizeTrip(t);
  }

  return {
    haversine, validLatLng, uid, fmtDist, fmtDur, parseGoogleMapsUrl, parseCSV, parseImport,
    parseGeoJSON, parseTakeoutCSV, parseKML, newTrip, sanitizeTrip, sanitizePlace, mergePlaces,
    MODES, estimateLeg, suggestMode, gmapsDirUrl, gmapsPlaceUrl, gmapsDayUrl, timeline, hm, toMin, centroid, balancedClusters,
    orderStops, planDays, pathLen, dayStops, legKey, parseOsrm, decodePolyline, parseGoogleRoute,
    b64urlEncode, b64urlDecode, packTrip, unpackTrip, dayColor, PALETTE,
  };
});
