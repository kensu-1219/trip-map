/* 旅遊地圖 — 介面 */
(function () {
  'use strict';
  const C = window.TripCore, SV = window.TripServices, SY = window.TripSync, LS = SV.LS;
  const I = (n, c) => window.TripIcons.ic(n, c);
  const MODE_IC = { walk: 'walk', bike: 'bike', drive: 'car', transit: 'transit' };
  const catIc = (c) => I('c_' + (C.CATS[c] ? c : 'other'));
  const dc = (d) => { const pal = (THEME_PAL[activeTheme()] || C.PALETTE); return d > 0 ? pal[(d - 1) % pal.length] : 'var(--muted)'; };
  const stepIc = (e) => I(/🚌|🚎/.test(e) ? 'bus' : /⛴/.test(e) ? 'ferry' : 'transit');
  const VERSION = '1.11.2';
  const STORE_KEY = 'tripmap.v1';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WEEK = '日一二三四五六';

  /* ================= 資料 ================= */
  const S = {
    data: null,
    ui: { tab: 'plan', dayFilter: 0, pick: null, measure: { a: '', b: '' }, search: '', results: null, addMsg: '', geo: null, me: null },
    legs: {}, requested: new Set(),
  };

  function loadData() {
    const d = LS.get(STORE_KEY, null);
    let data = { trips: [], current: '', settings: { gkey: '', fbConfig: null, tiles: 'auto' }, flags: {} };
    if (d && Array.isArray(d.trips)) {
      data.settings = Object.assign(data.settings, d.settings || {});
      data.trips = d.trips.map((t) => { try { const s = C.sanitizeTrip(t); s.synced = !!t.synced; return s; } catch (e) { return null; } }).filter(Boolean);
      data.current = d.current;
      data.flags = d.flags || {};
    }
    if (!data.trips.length) data.trips.push(C.newTrip('我的第一趟旅程'));
    if (!data.trips.find((t) => t.id === data.current)) data.current = data.trips[0].id;
    S.data = data;
  }
  let saveT = null;
  function save(opts) {
    const t = trip();
    if (!opts || !opts.silent) t.updatedAt = Date.now();
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!LS.set(STORE_KEY, S.data)) toast('手機儲存空間不足，資料可能沒有存到。請匯出備份。', 6000);
    }, 200);
    if (t.synced && (!opts || !opts.fromRemote)) schedulePush(t);
  }
  const trip = () => S.data.trips.find((t) => t.id === S.data.current);
  const settings = () => S.data.settings;
  const hotels = (t) => { const out = t.base ? [t.base] : []; Object.values(t.dayBase || {}).forEach((h) => { if (h && !out.some((x) => x.name === h.name && C.haversine(x, h) < 50)) out.push(h); }); return out; };
  const allPoints = (t) => hotels(t).concat(t.places);
  const findPoint = (t, id) => (id === 'base' ? t.base : /^base-\d+$/.test(id || '') ? (t.dayBase || {})[id.slice(5)] : id === 'me' ? S.ui.me : t.places.find((p) => p.id === id));

  /* ================= 地圖 ================= */
  let map, markerLayer, routeLayer, tileLayer, meLayer, nearbyLayer;
  const TILES = {
    osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', max: 19 },
    carto: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attr: '&copy; OpenStreetMap &copy; CARTO', max: 20 },
    dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: '&copy; OpenStreetMap &copy; CARTO', max: 20 },
  };
  const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function initMap() {
    map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView([25.04, 121.56], 4);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    setTiles();
    routeLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    meLayer = L.layerGroup().addTo(map);
    nearbyLayer = L.layerGroup().addTo(map);
    map.on('click', onMapClick);
    const lbl = () => document.getElementById('map').classList.toggle('show-labels', map.getZoom() >= 15);
    map.on('zoomend', lbl); lbl();
    map.on('zoomend', drawRoutes);
  }
  function setTiles() {
    let k = settings().tiles;
    if (k === 'auto' || !TILES[k]) k = isDarkTheme() ? 'dark' : 'osm';
    const t = TILES[k];
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(t.url, { attribution: t.attr, maxZoom: t.max, subdomains: 'abcd', crossOrigin: true }).addTo(map);
  }

  function pinIcon(color, label, cls, html) {
    return L.divIcon({ className: 'pin-wrap', html: '<div class="pin ' + (cls || '') + '" style="--c:' + color + '"><span>' + (html || esc(label)) + '</span></div>',
      iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40] });
  }

  /** 沒有實際路線時畫一條微彎的弧線（看起來是「示意」而不是道路） */
  function arcCoords(a, b) {
    const lat0 = (a.lat + b.lat) / 2, k = Math.cos(lat0 * Math.PI / 180);
    const ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
    const bend = 0.18; // 弧度：線段長度的 18%
    const cx = mx - dy * bend, cy = my + dx * bend;
    const out = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24, v = 1 - u;
      const x = v * v * ax + 2 * v * u * cx + u * u * bx, y = v * v * ay + 2 * v * u * cy + u * u * by;
      out.push([y, x / k]);
    }
    return out;
  }
  /** 在線段中點放一個小箭頭表示方向 */
  function addArrow(coords, col) {
    if (coords.length < 2) return;
    const pts = coords.map((c) => map.latLngToLayerPoint(c));
    let total = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); seg.push(d); total += d; }
    if (total < 46) return; // 太短不放
    let acc = 0, i = 0;
    while (i < seg.length && acc + seg[i] < total / 2) acc += seg[i++];
    i = Math.min(i, seg.length - 1);
    const p0 = pts[i], p1 = pts[i + 1], t = seg[i] ? (total / 2 - acc) / seg[i] : 0;
    const mid = L.point(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t);
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
    L.marker(map.layerPointToLatLng(mid), { interactive: false, keyboard: false, zIndexOffset: -500,
      icon: L.divIcon({ className: 'route-arrow', iconSize: [14, 14], iconAnchor: [7, 7],
        html: '<svg viewBox="0 0 14 14" style="transform:rotate(' + ang.toFixed(1) + 'deg)"><path d="M3 2.5L10 7L3 11.5" fill="none" stroke="' + col + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' }) }).addTo(routeLayer);
  }

  const markers = {};
  function renderMap(fit) {
    const t = trip();
    markerLayer.clearLayers();
    for (const k in markers) delete markers[k];
    const f = S.ui.dayFilter;
    const visible = t.places.filter((p) => !f || p.day === f);
    const dim = (p) => f && p.day !== f;
    for (const p of t.places) {
      if (dim(p) && t.places.length > 300) continue;
      const num = p.day ? String(p.order + 1) : '';
      const cls = (dim(p) ? 'dim ' : '') + (p.done ? 'done' : '');
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(C.CAT_COLOR[p.cat] || C.CAT_COLOR.other, '', cls, catIc(p.cat)), title: p.name, zIndexOffset: dim(p) ? -100 : 0 });
      m.bindPopup(() => popupHtml(p), { maxWidth: 260 });
      if (!dim(p) && t.places.length <= 300) m.bindTooltip((num ? '<b style="--lc:' + dc(p.day) + '">' + num + '</b>' : '') + esc(p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name), { permanent: true, direction: 'right', offset: [16, -18], className: 'plabel' });
      m.on('click', () => syncListTo(p.id));
      markers[p.id] = m;
      m.addTo(markerLayer);
    }
    if (hlId && markers[hlId]) highlightMarker(hlId, false);
    for (const h of hotels(t)) {
      L.marker([h.lat, h.lng], { icon: pinIcon('#2f2c25', '', 'base', I('hotel')), title: h.name, zIndexOffset: 500 })
        .bindPopup(() => popupHtml(h)).addTo(markerLayer);
    }
    drawRoutes();
    if (fit) fitTo(visible.length ? visible.concat(f ? [C.dayEnds(t, f).start, C.dayEnds(t, f).end].filter(Boolean) : hotels(t)) : allPoints(t));
  }
  /* ---------- 地圖 ⇄ 清單連動 ---------- */
  let hlId = '';
  function highlightMarker(id, pan) {
    if (hlId && markers[hlId] && hlId !== id) {
      const el = markers[hlId].getElement(); if (el) el.classList.remove('hl');
      markers[hlId].setZIndexOffset(0);
    }
    hlId = id;
    const m = markers[id]; if (!m) return;
    const el = m.getElement(); if (el) el.classList.add('hl');
    m.setZIndexOffset(1000);
    if (pan) {
      // 標記不在「地圖可見區」（扣掉底部面板）時才移動
      const pt = map.latLngToContainerPoint(m.getLatLng()), size = map.getSize(), pad = 40;
      const bottom = size.y - sheetPad();
      if (pt.x < pad || pt.x > size.x - pad || pt.y < pad || pt.y > bottom - pad) {
        map.panBy(pt.subtract(L.point(size.x / 2, bottom / 2)), { animate: true, duration: 0.35 });
      }
    }
  }
  /** 點地圖標記 → 清單捲到那張卡片 */
  function syncListTo(id) {
    if (S.ui.tab !== 'plan' && S.ui.tab !== 'places') return;
    if (isMobile() && $('#panel').classList.contains('mini')) return;
    const row = $('#tabBody .stop[data-id="' + id + '"]');
    if (!row) return;
    S.ui.syncLock = Date.now();
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    highlightMarker(id, false);
  }
  function bindListSync() {
    const body = $('#tabBody');
    let tm = null;
    body.addEventListener('scroll', () => {
      if (S.ui.tab !== 'plan' && S.ui.tab !== 'places') return;
      if (S.ui.syncLock && Date.now() - S.ui.syncLock < 900) return; // 剛剛是程式捲動
      clearTimeout(tm);
      tm = setTimeout(() => {
        const top = body.getBoundingClientRect().top + 8;
        const rows = body.querySelectorAll('.stop[data-id]');
        let pick = null;
        for (const r of rows) { const b = r.getBoundingClientRect(); if (b.bottom > top + 12) { pick = r; break; } }
        body.querySelectorAll('.stop.active').forEach((r) => r.classList.remove('active'));
        if (!pick) return;
        pick.classList.add('active');
        highlightMarker(pick.dataset.id, true);
      }, 140);
    }, { passive: true });
  }

  /** 只重畫路線（縮放、路線結果回來時用；不會關掉打開中的地點視窗） */
  function drawRoutes() {
    const t = trip(), f = S.ui.dayFilter;
    routeLayer.clearLayers();
    const days = f ? [f] : range(t.days);
    if (t.places.length <= 400) {
      const halo = cssVar('--paper') || '#f4efdf';
      for (const d of days) {
        const col = dc(d);
        for (const [a, b] of dayLegs(t, d)) {
          const leg = legInfo(t, a, b);
          const real = !leg.res.estimated && leg.res.coords && leg.res.coords.length > 2;
          const coords = real ? leg.res.coords : arcCoords(a, b);
          const w = f ? 4.5 : 3.5;
          if (real) {
            L.polyline(coords, { color: halo, weight: w + 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false, smoothFactor: 1.5 }).addTo(routeLayer);
            L.polyline(coords, { color: col, weight: w, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false, smoothFactor: 1.5 }).addTo(routeLayer);
          } else {
            L.polyline(coords, { color: halo, weight: w + 3.5, opacity: 0.9, lineCap: 'round', dashArray: '0.1 ' + (w + 7), interactive: false }).addTo(routeLayer);
            L.polyline(coords, { color: col, weight: w + 1, opacity: 1, lineCap: 'round', dashArray: '0.1 ' + (w + 7), interactive: false }).addTo(routeLayer);
          }
          addArrow(coords, col);
        }
      }
    }
    // 量距離
    const ma = findPointAny(t, S.ui.measure.a), mb = findPointAny(t, S.ui.measure.b);
    if (S.ui.tab === 'measure' && ma && mb) {
      L.polyline(arcCoords(ma, mb), { color: cssVar('--accent'), weight: 3, dashArray: '0.1 8', lineCap: 'round' }).addTo(routeLayer);
    }
  }
  function sheetPad() {
    if (window.innerWidth >= 900) return 0;
    const p = $('#panel');
    return p.classList.contains('full') ? 0 : p.getBoundingClientRect().height || 0;
  }
  function fitTo(pts) {
    if (!pts.length) return;
    const bottom = sheetPad();
    const opt = { paddingTopLeft: [40, 40], paddingBottomRight: [56, bottom + 30], maxZoom: 16 };
    if (pts.length === 1) pts = [pts[0], pts[0]];
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), opt);
  }

  function popupHtml(p) {
    const isBase = /^base/.test(p.id);
    const u = photoOf(p);
    if (!u && !isBase) ensurePhotos([p]);
    return '<div class="pop">' + (u ? '<div class="pop-photo" style="background-image:' + cssUrl(u) + '">' +
      (p.photo.src === 'wiki' && p.photo.link ? '<a class="credit" href="' + esc(p.photo.link) + '" target="_blank" rel="noopener">圖片：Wikipedia</a>' : '<span class="credit">圖片：Google</span>') + '</div>' : '') +
      '<b>' + esc(p.name) + '</b>' +
      (isBase ? '<div class="muted">住宿（每天起終點）</div>' : '<div class="muted">' + (p.day ? 'Day ' + p.day + ' · 第 ' + (p.order + 1) + ' 站' : '尚未排入行程') + '</div>') +
      (isBase ? '' : '<div class="muted">' + catIc(p.cat) + ' ' + C.CATS[p.cat].label + (p.hours ? ' · ' + I('clock') + ' ' + esc(p.hours) : '') + '</div>' +
        (!p.hours && p.hoursWeek ? '<div class="muted small">' + I('clock') + ' ' + esc(C.weekSummary(p.hoursWeek)) + '</div>' : '')) +
      (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
      '<div class="pop-btns">' +
      (isBase ? '' : '<button class="btn sm" data-act="toggleDone" data-id="' + p.id + '">' + I(p.done ? 'done' : 'undone') + (p.done ? ' 已去過' : ' 打卡') + '</button>') +
      placeA(p, 'btn sm', I('ext') + ' 開啟地圖') +
      '<button class="btn sm" data-act="measureFrom" data-id="' + p.id + '">從這裡量</button>' +
      '<button class="btn sm" data-act="measureTo" data-id="' + p.id + '">量到這裡</button>' +
      '<button class="btn sm" data-act="nearbyFrom" data-id="' + p.id + '">' + I('search') + ' 附近</button>' +
      (isBase ? '' : '<button class="btn sm" data-act="edit" data-id="' + p.id + '">編輯</button>') +
      '</div></div>';
  }

  function onMapClick(e) {
    const pick = S.ui.pick;
    if (!pick) return;
    const pt = { lat: e.latlng.lat, lng: ((e.latlng.lng + 540) % 360) - 180 };
    setPick(null);
    if (pick === 'add') {
      askText('新增地點', '名稱', '地圖上的點', (name) => { addPlaces([{ name, ...pt }]); });
    } else if (/^base/.test(pick)) {
      const d = +(pick.split(':')[1] || 0);
      askText(d ? 'Day ' + d + ' 晚上的住宿' : '設定住宿', '住宿名稱', '飯店', (name) => { setHotel(trip(), d, { name, ...pt }); save(); renderAll(); });
    } else if (pick === 'a' || pick === 'b') {
      const id = 'mp' + pick;
      S.ui.mpoints = S.ui.mpoints || {};
      S.ui.mpoints[id] = { id, name: '地圖上的點', ...pt };
      S.ui.measure[pick] = id;
      switchTab('measure');
    }
  }
  const origFind = findPoint;
  function findPointAny(t, id) { return (S.ui.mpoints && S.ui.mpoints[id]) || origFind(t, id); }

  function setPick(mode) {
    S.ui.pick = mode;
    const h = $('#pickHint');
    const text = { add: '點地圖新增地點', base: '點地圖設定住宿位置', a: '點地圖選起點', b: '點地圖選終點' }[mode] || (/^base:/.test(mode || '') ? '點地圖設定 Day ' + mode.split(':')[1] + ' 晚上的住宿' : '');
    h.hidden = !mode;
    h.innerHTML = mode ? I('pin') + ' ' + text + ' <button class="btn sm" data-act="cancelPick">取消</button>' : '';
    document.body.classList.toggle('picking', !!mode);
    if (mode && isMobile()) setSheet('mini');
  }

  /* ================= 行程計算 ================= */
  const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
  function dayLegs(t, d) {
    const stops = C.dayStops(t, d);
    const e = C.dayEnds(t, d);
    const seq = e.start && e.end && stops.length ? [e.start].concat(stops, [e.end]) : stops;
    const out = [];
    for (let i = 0; i < seq.length - 1; i++) out.push([seq[i], seq[i + 1]]);
    return out;
  }
  function legInfo(t, a, b) {
    const key = C.legKey(a, b);
    const dist = C.haversine(a, b);
    const mode = t.legModes[key] || C.suggestMode(dist);
    const sk = mode + '|' + a.lat + ',' + a.lng + '|' + b.lat + ',' + b.lng;
    let res = S.legs[sk];
    if (!res) {
      res = SV.peekLeg(a, b, mode);
      if (res.estimated && !S.requested.has(sk) && t.places.length <= 400) {
        S.requested.add(sk);
        SV.getLeg(a, b, mode, settings()).then((r) => { S.legs[sk] = r; scheduleRender(); });
      } else if (!res.estimated) S.legs[sk] = res;
    }
    return { key, mode, res, dist, auto: !t.legModes[key] };
  }
  let rT = null;
  function scheduleRender() { clearTimeout(rT); rT = setTimeout(() => { renderPanel(true); drawRoutes(); }, 120); }

  function dayDate(t, d) {
    if (!t.startDate) return '';
    const dt = new Date(t.startDate + 'T00:00:00');
    dt.setDate(dt.getDate() + d - 1);
    return (dt.getMonth() + 1) + '/' + dt.getDate() + '（' + WEEK[dt.getDay()] + '）';
  }

  /* ================= 面板 ================= */
  function switchTab(tab) {
    S.ui.tab = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (isMobile() && ($('#panel').classList.contains('peek') || $('#panel').classList.contains('mini'))) setSheet('half');
    renderPanel(); renderMap(false);
  }

  function renderPanel(keepScroll) {
    const body = $('#tabBody');
    const st = body.scrollTop;
    const fn = { plan: renderPlan, places: renderPlaces, add: renderAdd, measure: renderMeasure, list: renderList }[S.ui.tab];
    body.innerHTML = fn();
    if (S.ui.tab === 'plan' || S.ui.tab === 'places') {
      const t = trip(); const f = S.ui.dayFilter;
      ensurePhotos((f ? t.places.filter((p) => p.day === f) : t.places).slice(0, 120));
    }
    if (keepScroll) body.scrollTop = st;
    if (S.ui.tab === 'places') { const i = $('#placeSearch'); if (i && S.ui.focusSearch) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  // 區段標題：經典主題顯示「// English · 中文」，清爽主題只顯示中文
  const sec = (t) => { const i = t.indexOf(' · '); return '<div class="sec">' + (i > 0 ? '<span class="en">' + t.slice(0, i) + ' · </span>' + t.slice(i + 3) : t) + '</div>'; };
  const dayLabel = (d) => '<span class="en">DAY ' + String(d).padStart(2, '0') + '</span><span class="zh">第 ' + d + ' 天</span>';
  function renderPlan() {
    const t = trip();
    const f = S.ui.dayFilter;
    let h = sec('// Itinerary · 行程設定') + '<div class="row wrap gap">' +
      '<label class="field">天數 <span class="stepper"><button data-act="days" data-d="-1">−</button><b>' + t.days + '</b><button data-act="days" data-d="1">＋</button></span></label>' +
      '<label class="field">出發日 <input type="date" id="startDate" value="' + esc(t.startDate) + '"></label>' +
      '<label class="field">每天 <input type="time" id="dayStart" value="' + esc(t.dayStart || '09:00') + '" step="900"> 出門</label>' +
      '</div>' + installBanner() +
      '<div class="row gap base-row">' + I('hotel') + ' <span class="grow">' + (t.base ? '<b>' + esc(t.base.name) + '</b> <span class="muted">' + (C.multiHotel(t) ? '預設住宿（部分天數另有設定）' : '每天從這裡出發、回來') + '</span>' : '<span class="muted">未設定住宿（設定後每天會從住宿出發）</span>') + '</span><button class="btn sm" data-act="setBase">' + (t.base ? '更換' : '設定') + '</button></div>' +
      '<button class="btn primary block" data-act="autoplan"' + (t.places.length ? '' : ' disabled') + '>' + I('auto') + ' 自動排行程 <span style="opacity:.7;font-weight:400">· 依遠近分 ' + t.days + ' 天</span></button>';
    if (!t.places.length) return h + welcomeHtml();
    h += todayCard(t);
    h += sec('// Route · 每日路線') + '<div class="row gap route-bar"><div class="chips grow">' + '<button class="chip' + (f ? '' : ' on') + '" data-act="filter" data-d="0"><span class="en">ALL</span><span class="zh">全部</span></button>' +
      range(t.days).map((d) => '<button class="chip' + (f === d ? ' on' : '') + '" data-act="filter" data-d="' + d + '" style="--c:' + dc(d) + '"><span class="en">D' + String(d).padStart(2, '0') + '</span><span class="zh">第 ' + d + ' 天</span></button>').join('') + '</div>' +
      '<button class="btn sm' + (S.ui.reorder ? ' primary' : '') + '" data-act="reorder">' + I('swap') + (S.ui.reorder ? ' 完成' : ' 調整順序') + '</button></div>';
    const pcost = t.places.reduce((a, p) => a + (p.cost || 0), 0), bcost = (t.bookings || []).reduce((a, b) => a + (b.cost || 0), 0);
    if (pcost + bcost) h += '<div class="muted small">' + I('money') + ' 預估總花費 ' + (t.currency ? esc(t.currency) + ' ' : '') + fmtMoney(pcost + bcost) + (bcost ? '（含預訂 ' + fmtMoney(bcost) + '）' : '') + '</div>';
    const days = f ? [f] : range(t.days);
    const big = t.places.length > 120 && !f;
    S.ui.open = S.ui.open || {};
    for (const d of days) {
      if (big && !S.ui.open[t.id + ':' + d]) {
        const n = C.dayStops(t, d).length;
        h += '<div class="day collapsed" style="--c:' + dc(d) + '"><div class="day-h"><b>' + dayLabel(d) + '</b> <span>' + dayDate(t, d) + '</span><span class="day-tools"><button class="btn sm" data-act="openDay" data-d="' + d + '">' + I('expand') + ' 展開 ' + n + ' 站</button></span></div></div>';
      } else h += dayBlock(t, d);
    }
    const un = t.places.filter((p) => !p.day || p.day > t.days);
    if (un.length && !f) {
      h += '<div class="day"><div class="day-h" style="--c:#888"><b>未排入（' + un.length + '）</b><span class="muted">按「自動排行程」或在地點上選天數</span></div>' +
        un.map((p) => stopRow(t, p, true)).join('') + '</div>';
    }
    return h;
  }

  function dayBlock(t, d) {
    const stops = C.dayStops(t, d);
    const legs = dayLegs(t, d);
    let move = 0, dist = 0, est = false;
    const infos = legs.map(([a, b]) => { const li = legInfo(t, a, b); move += li.res.duration; dist += li.res.distance; est = est || li.res.estimated; return li; });
    const stay = stops.reduce((s, p) => s + (p.stay || 0) * 60, 0);
    const ends = C.dayEnds(t, d), hasB = !!(ends.start && ends.end);
    const tl = C.timeline(t.dayStart, infos.map((x) => x.res.duration), stops.map((p) => p.stay || 0), hasB);
    const seq = hasB && stops.length ? [ends.start].concat(stops, [ends.end]) : stops;
    const mainMode = mostCommonMode(infos);
    let h = '<div class="day" data-day="' + d + '"><div class="day-h" style="--c:' + dc(d) + '"><b>' + dayLabel(d) + '</b> <span>' + dayDate(t, d) + '</span>' +
      (seq.length >= 2 ? '<span class="day-tools"><a class="btn sm ghost" target="_blank" rel="noopener" href="' + esc(C.gmapsDayUrl(seq, mainMode)) + '" title="整天路線在 Google 地圖開啟（Apple 地圖不支援多個中途點）">' + I('nav') + ' 整天導航</a></span>' : '') +
      weatherChip(t, d) +
      '<span class="muted">' + stops.length + ' 站' + (stops.length ? ' · ' + C.hm(C.toMin(t.dayStart)) + '–' + C.hm(tl.end) + ' · 移動 ' + (est ? '約 ' : '') + C.fmtDur(move) + ' · ' + C.fmtDist(dist) + ' · 停留 ' + C.fmtDur(stay) : '') +
      (dayCost(stops) ? ' · 花費 ' + (t.currency ? esc(t.currency) + ' ' : '') + fmtMoney(dayCost(stops)) : '') + '</span>' + dayBookings(t, d) + '</div>';
    if (!stops.length) return h + '<div class="empty sm">這天沒有安排</div></div>';
    let li = 0;
    if (hasB) h += baseRow(ends.start, C.hm(C.toMin(t.dayStart)) + ' 出發', d > 1 && ends.start !== ends.end ? '退房' : '') + legRow(t, infos[li++]);
    stops.forEach((p, i) => {
      h += stopRow(t, p, false, i, stops.length, tl.stops[i]);
      if (i < stops.length - 1 || hasB) h += legRow(t, infos[li++]);
    });
    if (hasB) h += baseRow(ends.end, C.hm(tl.end) + (ends.start !== ends.end ? ' 入住' : ' 回到住宿'), '', d);
    return h + '</div>';
  }
  const dayCost = (stops) => stops.reduce((a, p) => a + (p.cost || 0), 0);
  function mostCommonMode(infos) {
    const c = {}; infos.forEach((i) => { c[i.mode] = (c[i.mode] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || 'transit';
  }
  const baseRow = (b, time, tag, d) => '<div class="stop base"><span class="num base">' + I('hotel') + '</span><span class="grow">' + esc(b.name) + (tag ? ' <small class="muted">' + tag + '</small>' : '') + '</span>' + (time ? '<span class="time">' + time + '</span>' : '') +
    (d ? '<button class="btn sm ghost" data-act="dayHotel" data-d="' + d + '" title="這天晚上住哪">' + I('hotel') + ' 今晚</button>' : '') + '</div>';

  function stopRow(t, p, unassigned, i, n, tm) {
    const reorder = S.ui.reorder && !unassigned;
    const hrs = C.hoursFor(p, dayISO(t, p.day));
    const warn = tm && hrs ? C.hoursWarning(hrs, tm.arrive, tm.depart) : null;
    const cur = t.currency ? esc(t.currency) + ' ' : '';
    return '<div class="stop' + (p.done ? ' is-done' : '') + (reorder ? ' can-drag' : '') + '" data-id="' + p.id + '">' +
      (reorder ? '<span class="grip" title="按住拖曳排序">' + I('grip') + '</span>' : '') +
      '<span class="num" style="--c:' + dc(unassigned ? 0 : p.day) + '"><span>' + (unassigned ? '·' : p.order + 1) + '</span></span>' +
      thumb(p) +
      '<span class="grow"><a href="#" data-act="focus" data-id="' + p.id + '">' + esc(p.name) + '</a>' + (p.locked ? ' <span title="已鎖定在這天" class="muted">' + I('lock') + '</span>' : '') +
      '<br>' + (tm ? '<span class="time">' + C.hm(tm.arrive) + '–' + C.hm(tm.depart) + '</span> ' : '') +
      '<span class="muted">停留 ' + C.fmtDur((p.stay || 0) * 60) + (p.cost ? ' · ' + cur + fmtMoney(p.cost) : '') + (p.note ? ' · ' + esc(p.note.slice(0, 40)) : '') + '</span>' +
      (warn ? '<br><span class="warnline">' + I('warn') + ' ' + esc(warn) + '</span>' : '') + '</span>' +
      (reorder ? '<button class="icon-btn sm updown" data-act="up" data-id="' + p.id + '"' + (i === 0 ? ' disabled' : '') + ' title="往前">' + I('up') + '</button>' +
        '<button class="icon-btn sm updown" data-act="down" data-id="' + p.id + '"' + (i === n - 1 ? ' disabled' : '') + ' title="往後">' + I('down') + '</button>' : '') +
      (reorder || unassigned ? '<select class="daysel" data-act="moveDay" data-id="' + p.id + '" title="移到哪一天"><option value="0"' + (p.day ? '' : ' selected') + '>未排</option>' +
        range(t.days).map((d) => '<option value="' + d + '"' + (p.day === d ? ' selected' : '') + '>D' + d + '</option>').join('') + '</select>' : '') +
      (reorder ? '' : '<button class="icon-btn sm tick' + (p.done ? ' on' : '') + '" data-act="toggleDone" data-id="' + p.id + '" title="' + (p.done ? '已去過（再按取消）' : '打卡：標記已去過') + '">' + I(p.done ? 'done' : 'undone') + '</button>') +
      '<button class="icon-btn sm" data-act="edit" data-id="' + p.id + '" title="編輯">' + I('edit') + '</button></div>';
  }
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#b0533b';
  /* ---------- 導航連結（Apple 地圖／Google 地圖） ---------- */
  function navA(a, b, mode, cls, inner, title) {
    return '<a class="navlink ' + (cls || '') + '" target="_blank" rel="noopener" href="' + esc(C.gmapsDirUrl(a, b, mode)) + '" data-apple="' + esc(C.appleDirUrl(a, b, mode)) + '"' + (title ? ' title="' + title + '"' : '') + '>' + inner + '</a>';
  }
  function placeA(p, cls, inner, title) {
    return '<a class="navlink ' + (cls || '') + '" target="_blank" rel="noopener" href="' + esc(C.gmapsPlaceUrl(p)) + '" data-apple="' + esc(C.applePlaceUrl(p)) + '"' + (title ? ' title="' + title + '"' : '') + '>' + inner + '</a>';
  }
  function bindNavLinks() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a.navlink');
      if (!a || !a.dataset.apple) return;
      const pref = settings().navApp || 'ask';
      if (pref === 'google') return;
      if (pref === 'apple') { a.href = a.dataset.apple; return; }
      e.preventDefault(); e.stopPropagation();
      const g = a.getAttribute('href'), ap = a.dataset.apple;
      openModal('<h3>用哪個地圖開啟？</h3>' +
        '<div class="navpick"><a class="btn block" target="_blank" rel="noopener" href="' + esc(ap) + '" data-pick="apple">' + I('map') + ' Apple 地圖</a>' +
        '<a class="btn block" target="_blank" rel="noopener" href="' + esc(g) + '" data-pick="google">' + I('map') + ' Google 地圖</a></div>' +
        '<label class="check"><input type="checkbox" id="navRemember"> 記住我的選擇（之後可在「設定」更改）</label>' +
        '<p class="muted small">Apple 地圖的「整天導航」不支援多個中途點，那個按鈕會固定用 Google 地圖。</p>' +
        '<div class="row end"><button class="btn" data-mact="close">取消</button></div>');
      $('#modalBody .navpick').addEventListener('click', (ev) => {
        const k = ev.target.closest('[data-pick]'); if (!k) return;
        if ($('#navRemember').checked) { settings().navApp = k.dataset.pick; save({ silent: true }); }
        setTimeout(closeModal, 50);
      });
    }, true);
  }

  /* ---------- 照片 ---------- */
  const photoOn = () => settings().photos !== false;
  const photoOf = (p) => (photoOn() ? SV.photoSrc(p.photo, settings()) : '');
  const cssUrl = (u) => "url('" + String(u).replace(/['"\\()\s]/g, encodeURIComponent) + "')";
  /** 縮圖：有照片顯示照片＋右下分類小徽章，沒有就顯示分類圖示 */
  function thumb(p, cls) {
    const u = photoOf(p);
    if (!u) return '<span class="cat" style="color:' + C.CAT_COLOR[p.cat] + '" title="' + C.CATS[p.cat].label + '">' + catIc(p.cat) + '</span>';
    return '<span class="thumb ' + (cls || '') + '" style="background-image:' + cssUrl(u) + '" title="' + C.CATS[p.cat].label + '"><i style="background:' + C.CAT_COLOR[p.cat] + '">' + catIc(p.cat) + '</i></span>';
  }
  const photoBusy = new Set();
  let photoBudget = 40; // 每次開啟最多查 40 個地點，避免大量請求
  function ensurePhotos(list) {
    if (!photoOn() || navigator.onLine === false) return;
    for (const p of list) {
      if (!p || p.photo || photoBusy.has(p.id) || photoBudget <= 0) continue;
      if (p.photoTry && Date.now() - p.photoTry < 7 * 864e5 && !(settings().gkey && p.photoTry < (settings().gkeyAt || 0))) continue;
      photoBusy.add(p.id); photoBudget--;
      SV.findPhoto(p, settings()).then((ph) => {
        p.photoTry = Date.now();
        if (ph) { p.photo = ph; scheduleRender(); }
        save({ silent: true });
      }).catch(() => { /* 離線或服務忙：下次再試 */ }).finally(() => photoBusy.delete(p.id));
    }
  }
  const fmtMoney = (n) => Math.round(n).toLocaleString('en-US');

  function legRow(t, li) {
    if (!li) return '';
    const r = li.res;
    const [aId, bId] = li.key.split('>');
    const a = findPoint(t, aId), b = findPoint(t, bId);
    let detail = '';
    if (r.steps && r.steps.length) {
      detail = '<div class="steps">' + r.steps.map((s) => s.walk ? I('walk') + Math.max(1, Math.round(s.sec / 60)) + '分' :
        '<span class="line" style="--lc:' + esc(s.color || '#555') + '">' + stepIc(s.icon) + ' ' + esc(s.line) + '</span> ' + esc(s.from) + '→' + esc(s.to) + (s.stops ? '（' + s.stops + '站）' : '')).join(' › ') + '</div>';
    }
    const status = r.estimated ? (li.mode === 'transit' && !settings().gkey ? '估算' : r.error ? '估算（' + esc(r.error) + '）' : '估算中…') : (r.source === 'google' ? 'Google' : '實際路線');
    return '<div class="leg">' +
      '<div class="modes">' + Object.entries(C.MODES).map(([k, m]) => '<button class="mode' + (k === li.mode ? ' on' : '') + '" data-act="mode" data-key="' + esc(li.key) + '" data-mode="' + k + '" title="' + m.label + '">' + I(MODE_IC[k]) + '</button>').join('') + '</div>' +
      '<div class="leg-info"><b>' + (r.estimated ? '約 ' : '') + C.fmtDur(r.duration) + '</b> · ' + C.fmtDist(r.distance) + (r.fare ? ' · <b>' + esc(C.fmtFare(r.fare)) + '</b>' : '') + ' <span class="muted">(' + status + (r.note ? '，' + esc(r.note) : '') + ')</span>' + detail + '</div>' +
      (a && b ? navA(a, b, li.mode, 'btn sm ghost', I('nav'), '導航') : '') +
      '</div>';
  }

  function renderPlaces() {
    const t = trip();
    const q = S.ui.search.trim().toLowerCase();
    const cf = S.ui.catFilter || '';
    const counts = {};
    t.places.forEach((p) => { counts[p.cat] = (counts[p.cat] || 0) + 1; });
    const list = t.places.filter((p) => (!cf || p.cat === cf) && (!q || (p.name + ' ' + p.note + ' ' + p.address).toLowerCase().includes(q)));
    let h = sec('// Locations · ' + t.places.length) + '<div class="row gap"><input id="placeSearch" type="search" placeholder="篩選 ' + t.places.length + ' 個地點…" value="' + esc(S.ui.search) + '" class="grow"></div>';
    if (!t.places.length) return h + '<div class="empty">還沒有地點。</div>';
    h += '<div class="chips catchips"><button class="chip' + (cf ? '' : ' on') + '" data-act="catFilter" data-c="">全部 ' + t.places.length + '</button>' +
      Object.keys(C.CATS).filter((k) => counts[k]).map((k) => '<button class="chip ic-chip' + (cf === k ? ' on' : '') + '" data-act="catFilter" data-c="' + k + '" title="' + C.CATS[k].label + '">' + catIc(k) + ' ' + counts[k] + '</button>').join('') + '</div>';
    const shown = list.slice(0, 300);
    h += shown.map((p) => '<div class="stop' + (p.done ? ' is-done' : '') + '" data-id="' + p.id + '"><span class="num" style="--c:' + dc(p.day) + '"><span>' + (p.day ? p.day : '·') + '</span></span>' +
      thumb(p) +
      '<span class="grow"><a href="#" data-act="focus" data-id="' + p.id + '">' + esc(p.name) + '</a><br><span class="muted">' + C.CATS[p.cat].label + (p.hours ? ' · ' + esc(p.hours) : '') + (p.note || p.address ? ' · ' + esc((p.note || p.address || '').slice(0, 50)) : '') + '</span></span>' +
      placeA(p, 'icon-btn sm', I('ext'), '在地圖 App 開啟') +
      '<button class="icon-btn sm" data-act="edit" data-id="' + p.id + '">' + I('edit') + '</button></div>').join('');
    if (list.length > shown.length) h += '<div class="muted center">還有 ' + (list.length - shown.length) + ' 個，請用上方篩選</div>';
    h += '<button class="btn danger block" data-act="clearPlaces">' + I('trash') + ' 刪除全部地點</button>';
    return h;
  }

  function renderAdd() {
    const geo = S.ui.geo;
    let h = itinHtml() + nearbyHtml() + sec('// Add · 新增地點') + '<label class="lbl">貼上 Google Maps 連結、座標或地名（可一次貼多行）</label>' +
      '<textarea id="addInput" rows="3" placeholder="例：https://www.google.com/maps/place/...&#10;或：35.7148, 139.7967&#10;或：清水寺"></textarea>' +
      '<div class="row gap"><button class="btn primary grow" data-act="addGo">加入／搜尋</button><button class="btn" data-act="pickAdd">' + I('map') + ' 在地圖上點</button></div>';
    if (S.ui.addMsg) h += '<div class="msg">' + S.ui.addMsg + '</div>';
    if (S.ui.results) {
      h += '<div class="results"><div class="muted">搜尋結果（' + (S.ui.results.source || '') + '）— 點一下加入：</div>' +
        (S.ui.results.list.length ? S.ui.results.list.map((r, i) => '<button class="result" data-act="pickResult" data-i="' + i + '">' + catIc(r.cat || C.guessCat(r.name)) + ' <b>' + esc(r.name) + '</b><br><span class="muted">' + esc(r.address) + '</span></button>').join('') : '<div class="empty sm">找不到，換個關鍵字（加上城市名通常有幫助）</div>') + '</div>';
    }
    if (geo) {
      h += '<div class="msg">' + I('search') + ' 正在查詢沒有座標的地點：' + geo.done + ' / ' + geo.total + (geo.failed.length ? '，找不到 ' + geo.failed.length + ' 個' : '') + (geo.done < geo.total ? '（每秒約 1 個）' : ' — 完成') + '</div>';
      if (geo.done >= geo.total && geo.failed.length) h += '<div class="msg warn">找不到座標：' + geo.failed.map(esc).join('、') + '<br>可以在上方用地名＋城市重新搜尋。</div>';
    }
    h += '<hr>' + sec('// Import · 匯入') +
      '<button class="btn block" data-act="import">' + I('folder') + ' 選擇檔案（Google 已儲存清單 .csv／已加星號 .json／My Maps .kml／本工具備份 .json）</button>' +
      '<details><summary>怎麼把 Google Maps 存的地點整批匯出？</summary><ol class="help">' +
      '<li>電腦開 <a href="https://takeout.google.com/" target="_blank" rel="noopener">takeout.google.com</a>，先按「取消全選」。</li>' +
      '<li>只勾「<b>已儲存</b>」（Saved，各清單 .csv）和「<b>地圖（你的地點）</b>」（已加星號 .json）。</li>' +
      '<li>建立匯出 → 下載 zip → 解壓縮，把 .csv 或 .json 選進來。</li>' +
      '<li>.csv 沒有座標，工具會自動用地名查（填了 Google 金鑰會更準）。</li>' +
      '<li>Google 我的地圖（My Maps）可用「匯出為 KML」，選「KML」而不是 KMZ。</li></ol></details>' +
      '<details><summary>手機分享出來的 maps.app.goo.gl 短網址？</summary><p class="help">短網址看不到座標，工具會改用連結前面的店名／地址搜尋。想要最準：在 Safari 打開短網址，等它跳到完整網址，再從網址列複製貼上。</p></details>';
    return h;
  }

  function renderMeasure() {
    const t = trip();
    const pts = allPoints(t);
    const extra = Object.values(S.ui.mpoints || {});
    const opts = (sel) => '<option value="">— 選擇 —</option>' +
      (S.ui.me ? '<option value="me"' + (sel === 'me' ? ' selected' : '') + '>◎ 我的位置</option>' : '') +
      extra.map((p) => '<option value="' + p.id + '"' + (sel === p.id ? ' selected' : '') + '>⌖ ' + esc(p.name) + '（' + p.lat.toFixed(4) + ',' + p.lng.toFixed(4) + '）</option>').join('') +
      pts.map((p) => '<option value="' + p.id + '"' + (sel === p.id ? ' selected' : '') + '>' + (/^base/.test(p.id) ? '■ 住宿 ' : p.day ? 'D' + p.day + ' ' : '') + esc(p.name) + '</option>').join('');
    let h = sec('// Measure · 量距離') + '<div class="measure">' +
      '<label class="lbl">起點</label><div class="row gap"><select id="mA" class="grow">' + opts(S.ui.measure.a) + '</select><button class="btn sm" data-act="pickA" title="在地圖上點">' + I('map') + '</button></div>' +
      '<div class="center"><button class="icon-btn" data-act="swap" title="對調">' + I('swap') + '</button></div>' +
      '<label class="lbl">終點</label><div class="row gap"><select id="mB" class="grow">' + opts(S.ui.measure.b) + '</select><button class="btn sm" data-act="pickB" title="在地圖上點">' + I('map') + '</button></div></div>';
    const a = findPointAny(t, S.ui.measure.a), b = findPointAny(t, S.ui.measure.b);
    if (a && b) {
      const straight = C.haversine(a, b);
      h += '<div class="big">直線距離 <b>' + C.fmtDist(straight) + '</b></div><div class="mtable">';
      for (const [k, m] of Object.entries(C.MODES)) {
        const sk = 'M|' + k + '|' + a.lat + ',' + a.lng + '|' + b.lat + ',' + b.lng;
        let r = S.legs[sk];
        if (!r) {
          r = SV.peekLeg(a, b, k);
          if (r.estimated && !S.requested.has(sk)) { S.requested.add(sk); SV.getLeg(a, b, k, settings()).then((x) => { S.legs[sk] = x; if (S.ui.tab === 'measure') renderPanel(true); }); }
          else if (!r.estimated) S.legs[sk] = r;
        }
        const steps = r.steps && r.steps.length ? '<div class="steps">' + r.steps.map((s) => s.walk ? I('walk') + Math.max(1, Math.round(s.sec / 60)) + '分' : stepIc(s.icon) + ' ' + esc(s.line) + ' ' + esc(s.from) + '→' + esc(s.to)).join(' › ') + '</div>' : '';
        const tag = r.estimated ? (k === 'transit' && !settings().gkey ? '估算' : r.error ? '估算' : '查詢中…') : (r.source === 'google' ? 'Google' : '實際路線');
        h += '<div class="mrow"><span class="micon">' + I(MODE_IC[k]) + '</span><span class="grow"><b>' + m.label + '</b> ' + (r.estimated ? '約 ' : '') + C.fmtDur(r.duration) + ' · ' + C.fmtDist(r.distance) + (r.fare ? ' · ' + esc(C.fmtFare(r.fare)) : '') +
          ' <span class="muted">(' + tag + ')</span>' + (r.note ? '<br><span class="muted">' + esc(r.note) + '</span>' : '') + steps + '</span>' +
          navA(a, b, k, 'btn sm ghost', I('nav') + ' 導航') + '</div>';
      }
      h += '</div>';
      if (!settings().gkey) h += '<div class="muted small">大眾運輸目前是估算值。按「導航」在地圖 App 看實際班次，或到「設定」填入 Google 金鑰自動查詢。</div>';
    } else {
      h += '<div class="empty">選兩個地點（或點地圖上的標記 →「從這裡量」），會同時算出步行、單車、開車、大眾運輸的時間和距離。</div>';
    }
    return h;
  }


  /* ================= 主題（每趟旅程各自設定） ================= */
  const THEME_INFO = {
    auto: { name: '自動', desc: '跟隨手機：淺色＝清爽、深色＝清爽深色', sw: ['#ffffff', '#e8553a', '#0f1115', '#ff7a5c'] },
    clean: { name: '清爽', desc: '白底圓角卡片、主流 App 風格', sw: ['#f5f6f8', '#ffffff', '#1d2433', '#e8553a'], dark: false },
    night: { name: '清爽深色', desc: '深灰底、柔和對比', sw: ['#0f1115', '#181b21', '#e8eaed', '#ff7a5c'], dark: true },
    parchment: { name: '羊皮紙終端', desc: '米灰紙張、墨褐細線、方角反白', sw: ['#d4cfb8', '#dcd8c3', '#47443a', '#b0533b'], dark: false },
    relic: { name: '暗金遺跡', desc: '炭黑底、古金細線、暖白文字', sw: ['#13120f', '#1b1915', '#c9a85a', '#d26a42'], dark: true },
    neon: { name: '霓虹街頭', desc: '黑底螢光黃、粗框貼紙感', sw: ['#101012', '#f2e600', '#ff3d7f', '#2de2e6'], dark: true },
    washi: { name: '和紙朱印', desc: '米白和紙、墨黑、朱紅印章', sw: ['#f5f0e6', '#2a2a2a', '#c8102e', '#264a7a'], dark: false },
    tide: { name: '海島晴空', desc: '白沙、海藍、珊瑚橘、圓角', sw: ['#f4f7f6', '#0a7ea4', '#ff7a59', '#ffd166'], dark: false },
  };
  const THEME_PAL = {
    clean: ['#e8553a', '#2f7ae5', '#1f9d6b', '#9b51e0', '#f2a516', '#e0457b', '#00a3bf', '#5b6bd6', '#7cb518', '#8a8f98'],
    night: ['#ff7a5c', '#5aa2ff', '#3ccf91', '#b884ff', '#ffc14d', '#ff6fa0', '#3fd0e8', '#8c9bff', '#a3e04a', '#a5abb4'],
    parchment: ['#b0533b', '#3f6e78', '#6b7a35', '#7d4f7a', '#b4862f', '#9a4558', '#3c5a86', '#5f7f68', '#8a6a4b', '#6e6a5c'],
    relic: ['#d26a42', '#5e9ca8', '#a3b26b', '#b98ab6', '#d9b45a', '#cf7186', '#7d9bd1', '#8fb59c', '#c39b73', '#a39a82'],
    neon: ['#f2e600', '#ff3d7f', '#2de2e6', '#9b5cff', '#ff8a00', '#3dff8f', '#ff5c5c', '#5c9dff', '#ffffff', '#c0c0c0'],
    washi: ['#c8102e', '#264a7a', '#3f7a4a', '#7a3f6e', '#c47b12', '#1f6f78', '#8c5a2b', '#5a5a9c', '#a33a5c', '#555555'],
    tide: ['#ff7a59', '#0a7ea4', '#2a9d8f', '#e9a400', '#7b5ea7', '#e05780', '#3a86ff', '#43aa8b', '#f3722c', '#6c757d'],
  };
  const darkMQ2 = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function activeTheme(name) {
    const th = name || (trip() ? trip().theme : 'auto') || 'auto';
    if (th !== 'auto' && THEME_INFO[th]) return th;
    return darkMQ2 && darkMQ2.matches ? 'night' : 'clean';
  }
  const isDarkTheme = (name) => !!THEME_INFO[activeTheme(name)].dark;
  function applyTheme(preview) {
    const th = activeTheme(preview);
    document.documentElement.dataset.theme = th;
    document.documentElement.dataset.style = th === 'clean' || th === 'night' ? 'modern' : 'classic';
    const meta = document.querySelectorAll('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#d4cfb8';
    meta.forEach((m) => { m.setAttribute('content', bg); m.removeAttribute('media'); });
    if (map) { setTiles(); if (preview) renderMap(false); }
  }
  function themePicker(current) {
    return '<div class="themepick">' + Object.entries(THEME_INFO).map(([k, v]) => '<button type="button" class="themeopt' + (current === k ? ' on' : '') + '" data-theme="' + k + '">' +
      '<span class="sw">' + v.sw.map((c) => '<i style="background:' + c + '"></i>').join('') + '</span><b>' + v.name + '</b><small>' + v.desc + '</small></button>').join('') + '</div>';
  }

  /* ================= 天氣（Open-Meteo，免金鑰，16 天內） ================= */
  const WX_KEY = 'tripmap.wx.v1';
  let wx = LS.get(WX_KEY, {});
  const wxPending = new Set();
  function wxIcon(code) {
    if (code == null) return 'cloudy';
    if (code <= 1) return 'sun';
    if (code <= 3) return 'cloudy';
    if (code <= 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'rain';
  }
  function dayISO(t, d) {
    if (!t.startDate) return '';
    const dt = new Date(t.startDate + 'T00:00:00'); dt.setDate(dt.getDate() + d - 1);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function weatherChip(t, d) {
    const iso = dayISO(t, d);
    if (!iso) return '';
    const days = (new Date(iso + 'T12:00:00') - Date.now()) / 864e5;
    if (days > 15.5 || days < -1) return '';
    const stops = C.dayStops(t, d);
    const pts = stops.length ? stops : C.nightHotel(t, d) ? [C.nightHotel(t, d)] : t.places.slice(0, 1);
    if (!pts.length) return '';
    const c = C.centroid(pts);
    const key = iso + '@' + c.lat.toFixed(1) + ',' + c.lng.toFixed(1);
    const w = wx[key];
    if (w && Date.now() - w.t < 3 * 3600e3) {
      return '<span class="wx" title="天氣預報（Open-Meteo）">' + I(wxIcon(w.code)) + ' ' + Math.round(w.lo) + '°/' + Math.round(w.hi) + '°' + (w.pop != null ? ' · ' + w.pop + '%' : '') + '</span>';
    }
    if (!wxPending.has(key) && navigator.onLine !== false) {
      wxPending.add(key);
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lng.toFixed(3) +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=' + iso + '&end_date=' + iso;
      SV.fetchJSON(url, {}, 10000).then((j) => {
        const dd = j && j.daily;
        if (dd && dd.time && dd.time.length) {
          wx[key] = { t: Date.now(), code: dd.weather_code[0], hi: dd.temperature_2m_max[0], lo: dd.temperature_2m_min[0], pop: dd.precipitation_probability_max ? dd.precipitation_probability_max[0] : null };
          const keys = Object.keys(wx); if (keys.length > 200) keys.slice(0, keys.length - 150).forEach((k) => delete wx[k]);
          LS.set(WX_KEY, wx); scheduleRender();
        }
      }).catch(() => {}).finally(() => setTimeout(() => wxPending.delete(key), 60000));
    }
    return '';
  }

  /* ================= 今天模式（旅行中） ================= */
  function todayIndex(t) {
    if (!t.startDate) return 0;
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const st = new Date(t.startDate + 'T12:00:00');
    const d = Math.round((now - st) / 864e5) + 1;
    return d >= 1 && d <= t.days ? d : 0;
  }
  function todayCard(t) {
    const d = todayIndex(t);
    if (!d) return '';
    const stops = C.dayStops(t, d);
    const next = stops.find((p) => !p.done);
    const doneN = stops.filter((p) => p.done).length;
    let h = '<div class="today"><div class="today-h">' + I('today') + ' <b>今天是' + dayLabel(d) + '</b><span class="muted">' + doneN + ' / ' + stops.length + ' 已去</span>' +
      (S.ui.dayFilter !== d ? '<button class="btn sm" data-act="gotoToday" data-d="' + d + '">只看今天</button>' : '') + '</div>';
    if (next) {
      const prevDone = stops.filter((p) => p.done).pop();
      const from = S.ui.me || prevDone || C.dayEnds(t, d).start;
      const mode = from ? (t.legModes[C.legKey(from, next)] || C.suggestMode(C.haversine(from, next))) : 'transit';
      h += '<div class="today-next">' + thumb(next, 'big') + '<span class="grow"><small class="muted">下一站</small><br><b>' + esc(next.name) + '</b>' +
        (C.hoursFor(next, dayISO(t, d)) ? '<br><span class="muted">' + I('clock') + ' ' + esc(C.hoursFor(next, dayISO(t, d)) === 'off' ? '今天公休' : C.hoursFor(next, dayISO(t, d))) + '</span>' : '') + '</span>' +
        (from ? navA(from, next, mode, 'btn sm primary', I('nav') + ' 導航') : '') +
        '<button class="btn sm" data-act="toggleDone" data-id="' + next.id + '">' + I('done') + ' 打卡</button></div>';
    } else if (stops.length) h += '<div class="muted small">今天的行程都完成了，辛苦了！</div>';
    return h + '</div>';
  }

  /* ================= 貼上文字變行程 ================= */
  function itinHtml() {
    const it = S.ui.itin;
    let h = sec('// Paste · 貼上行程文字');
    if (!it) {
      return h + '<details class="itin-box"' + (S.ui.itinOpen ? ' open' : '') + '><summary>' + I('text') + ' 把 ChatGPT 或部落格的行程貼進來，自動分天、標上地圖</summary>' +
        '<textarea id="itinInput" rows="6" placeholder="例如：&#10;Day 1：淺草・上野&#10;- 上午：淺草寺&#10;- 下午：東京晴空塔&#10;Day 2&#10;- 明治神宮"></textarea>' +
        '<button class="btn primary block" data-act="itinParse">' + I('auto') + ' 解析行程</button></details>';
    }
    if (it.running || it.done) {
      const all = it.days.reduce((a, d) => a + d.items.filter((x) => x.on).length, 0);
      h += '<div class="msg">' + (it.done ? I('check') + ' 完成：' : I('search') + ' 查詢位置中… ') + it.ok + ' / ' + all + ' 個找到位置' + (it.fail.length ? '，' + it.fail.length + ' 個找不到' : '') + '</div>';
      if (it.done && it.fail.length) h += '<div class="msg warn">找不到：' + it.fail.map(esc).join('、') + '<br>可以在下方「新增地點」用地名＋城市再搜尋一次。</div>';
      if (it.done) h += '<div class="row gap"><button class="btn primary grow" data-act="itinView">' + I('plan') + ' 看行程</button><button class="btn" data-act="itinReset">再貼一份</button></div>';
      return h;
    }
    h += '<div class="muted small">找到 ' + it.days.length + ' 天、' + it.days.reduce((a, d) => a + d.items.length, 0) + ' 個地點。可以改名稱或取消勾選，再按「建立行程」。</div>';
    for (const d of it.days) {
      h += '<div class="itin-day"><b>' + dayLabel(d.day) + '</b>' + (d.title ? ' <span class="muted">' + esc(d.title) + '</span>' : '') +
        d.items.map((x, i) => '<label class="itin-item"><input type="checkbox" data-itin="' + d.day + ':' + i + '"' + (x.on ? ' checked' : '') + '><input type="text" class="grow" data-itin-name="' + d.day + ':' + i + '" value="' + esc(x.name) + '"></label>').join('') + '</div>';
    }
    const t = trip();
    h += '<label class="lbl">加到哪裡</label><select id="itinTarget"><option value="new">建立新旅程</option><option value="cur"' + (t.places.length ? '' : ' selected') + '>加到目前旅程「' + esc(t.name) + '」</option></select>' +
      '<label class="lbl">城市或國家（選填，讓搜尋更準，例如：東京、京都、Seoul）</label><input id="itinCity" placeholder="東京" value="' + esc(it.city || '') + '">' +
      '<div class="row gap" style="margin-top:12px"><button class="btn primary grow" data-act="itinRun">' + I('map') + ' 查詢位置並建立行程</button><button class="btn" data-act="itinReset">取消</button></div>';
    return h;
  }
  function itinParse() {
    const txt = ($('#itinInput') && $('#itinInput').value) || '';
    const days = C.parseItineraryText(txt);
    if (!days.length) { modalMsg('看不出行程', '找不到「Day 1／第一天／1日目」這類分天標題，或標題下沒有條列的地點。<br>請確認每一天有標題，地點用「- 」或「1.」條列。'); return; }
    days.forEach((d) => d.items.forEach((x) => { x.on = true; }));
    // 猜城市：常見的「XX三天兩夜」「Kyoto itinerary」
    const m = txt.match(/([\u4e00-\u9fff]{2,4})(?:[一二三四五六七八九十\d]+天|自由行|行程)|(?:in|to)\s+([A-Z][a-z]+)|([A-Z][a-z]+)\s+itinerary/);
    const city = m ? (m[1] || m[2] || m[3] || '').replace(/^.*(?:是|的|去|到|在|遊|游|玩|趟|個|个|為|为|了|份)/, '') : '';
    S.ui.itin = { days, city: city.length >= 2 ? city : '', ok: 0, fail: [] };
    renderPanel();
  }
  async function itinRun() {
    const it = S.ui.itin; if (!it || it.running) return;
    it.city = ($('#itinCity').value || '').trim().slice(0, 40);
    const target = $('#itinTarget').value;
    if (target === 'new') {
      const n = C.newTrip(it.city ? it.city + ' ' + Math.max(...it.days.map((d) => d.day)) + ' 天' : '貼上的行程');
      S.data.trips.push(n); S.data.current = n.id;
    } else snapshot();
    const t = trip();
    t.days = Math.max(t.days, ...it.days.map((d) => d.day));
    it.running = true; it.ok = 0; it.fail = [];
    renderAll();
    let anchor = t.places.length ? C.centroid(t.places) : null;
    for (const d of it.days) {
      let order = C.dayStops(t, d.day).length;
      for (const x of d.items) {
        if (!x.on) continue;
        const q = it.city && !x.name.includes(it.city) ? x.name + ' ' + it.city : x.name;
        let res = [];
        try { res = await SV.geocode(q, { settings: settings(), near: anchor, silent: true }); } catch (e) { res = []; }
        if (!res.length && q !== x.name) { try { res = await SV.geocode(x.name, { settings: settings(), near: anchor, silent: true }); } catch (e) { res = []; } }
        const pick = anchor ? res.find((r) => C.haversine(r, anchor) < 300000) : res[0];
        if (pick) {
          const r = addPlaces([{ name: x.name, lat: pick.lat, lng: pick.lng, address: pick.address || '', cat: pick.cat || '', hoursWeek: pick.hoursWeek || null, url: pick.url || '' }], { silent: true, fit: false });
          const p = r.added[0] || r.places.find((pp) => C.haversine(pp, pick) < 80);
          if (p) { p.day = d.day; p.order = order++; p.locked = true; }
          it.ok++;
          if (!anchor) anchor = { lat: pick.lat, lng: pick.lng };
        } else it.fail.push(x.name);
        save(); if (S.ui.tab === 'add') renderPanel(true);
      }
    }
    for (let k = 1; k <= t.days; k++) C.dayStops(t, k).forEach((s2, i) => { s2.order = i; });
    it.running = false; it.done = true;
    save(); renderAll(true);
    toast('已建立行程：' + it.ok + ' 個地點' + (it.fail.length ? '，' + it.fail.length + ' 個找不到' : ''), 6000, target === 'new' ? null : undoAct);
  }

  /* ================= 附近搜尋 ================= */
  function nearbyHtml() {
    const nb = S.ui.nearby;
    if (!nb) return sec('// Nearby · 附近') + '<div class="row gap wrap"><button class="btn" data-act="nearbyCenter">' + I('search') + ' 搜尋地圖中心附近</button><span class="muted small">或點地圖上的地點 →「附近」</span></div>';
    let h = sec('// Nearby · ' + esc(nb.origin.name) + ' 附近') +
      '<div class="chips catchips">' + Object.entries(C.NEARBY).map(([k, v]) => '<button class="chip ic-chip' + (nb.kind === k ? ' on' : '') + '" data-act="nearbyKind" data-k="' + k + '">' + catIc(v.cat === 'other' ? (k === 'toilet' ? 'other' : 'other') : v.cat) + ' ' + v.label + '</button>').join('') +
      '<button class="chip ic-chip" data-act="nearbyClose" title="關閉">' + I('close') + '</button></div>';
    if (nb.loading) h += '<div class="msg">' + I('search') + ' 搜尋中…</div>';
    else if (nb.error) h += '<div class="msg warn">' + I('warn') + ' ' + esc(nb.error) + '</div>';
    else if (nb.list) {
      if (!nb.list.length) h += '<div class="empty sm">步行範圍內沒找到。可以把地圖移到別處，再按「搜尋地圖中心附近」。</div>';
      else h += '<div class="results">' + nb.list.map((r, i) => '<div class="nrow"><span class="cat">' + catIc(r.cat) + '</span><span class="grow"><b>' + esc(r.name) + '</b><br><span class="muted">' +
        I('walk') + ' ' + C.fmtDist(r.dist * 1.25) + ' · 約 ' + C.fmtDur(C.estimateLeg(r.dist, 'walk').duration) + (r.sub ? ' · ' + esc(r.sub.slice(0, 50)) : '') + '</span></span>' +
        navA(nb.origin, r, 'walk', 'icon-btn sm', I('nav'), '步行導航') +
        (r.added ? '<span class="icon-btn sm tick on" title="已加入">' + I('check') + '</span>' : '<button class="icon-btn sm" data-act="nearbyAdd" data-i="' + i + '" title="加入行程地點">' + I('add') + '</button>') + '</div>').join('') + '</div>' +
        '<div class="muted small">資料來源：OpenStreetMap 社群（可能不完整）</div>';
    }
    return h;
  }
  async function runNearby(kind) {
    const nb = S.ui.nearby; if (!nb) return;
    nb.kind = kind; nb.loading = true; nb.error = ''; nb.list = null; renderPanel(true);
    try {
      nb.list = await SV.nearby(kind, nb.origin, kind === 'station' || kind === 'sight' ? 1200 : 700);
    } catch (e) { nb.error = '搜尋失敗：' + e.message + '（沒有網路或服務忙碌，稍後再試）'; }
    nb.loading = false;
    nearbyLayer.clearLayers();
    if (nb.list) {
      L.circle([nb.origin.lat, nb.origin.lng], { radius: kind === 'station' || kind === 'sight' ? 1200 : 700, color: cssVar('--accent'), weight: 1.5, dashArray: '3 6', fill: false }).addTo(nearbyLayer);
      nb.list.forEach((r) => L.marker([r.lat, r.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<div class="npin">' + catIc(r.cat) + '</div>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: r.name })
        .bindPopup('<div class="pop"><b>' + esc(r.name) + '</b><div class="muted">' + C.fmtDist(r.dist) + (r.sub ? ' · ' + esc(r.sub) : '') + '</div></div>').addTo(nearbyLayer));
      if (nb.list.length) fitTo(nb.list.slice(0, 15).concat([nb.origin]));
    }
    if (S.ui.tab === 'add') renderPanel(true);
  }

  /* ================= 行事曆匯出 ================= */
  async function exportICS(t) {
    if (!t.startDate) { modalMsg('需要出發日', '請先在「行程」設定出發日，才能把每站的時間放進行事曆。'); return; }
    const events = [];
    for (let d = 1; d <= t.days; d++) {
      const stops = C.dayStops(t, d); if (!stops.length) continue;
      const infos = dayLegs(t, d).map(([a, b]) => legInfo(t, a, b));
      const e0 = C.dayEnds(t, d);
      const tl = C.timeline(t.dayStart, infos.map((x) => x.res.duration), stops.map((p) => p.stay || 0), !!(e0.start && e0.end));
      stops.forEach((p, i) => events.push({
        date: dayISO(t, d), start: tl.stops[i].arrive, end: tl.stops[i].depart, uid: t.id + '-' + p.id,
        title: 'D' + d + ' ' + C.CATS[p.cat].emoji + ' ' + p.name, location: p.address || p.name, lat: p.lat, lng: p.lng,
        desc: [p.note, C.hoursFor(p, dayISO(t, d)) ? '營業時間 ' + C.hoursFor(p, dayISO(t, d)) : '', C.gmapsPlaceUrl(p)].filter(Boolean).join('\n'),
      }));
    }
    if (!events.length) { modalMsg('沒有可匯出的行程', '先把地點排進每一天（自動排行程）。'); return; }
    const ics = C.buildICS(t.name, events);
    const fname = (t.name.replace(/[\\/:*?"<>|]/g, '_') || 'trip') + '.ics';
    const file = new File([ics], fname, { type: 'text/calendar' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: t.name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已匯出 ' + events.length + ' 個行程到 ' + fname + '，打開檔案即可加入行事曆', 6000);
    S.ui.lastIcs = ics;
  }

  /* ================= 預訂 ================= */
  const curr = () => (trip().currency ? esc(trip().currency) + ' ' : '');
  function bookingWhen(b) {
    const d = (x) => { if (!x) return ''; const dt = new Date(x + 'T00:00:00'); return (dt.getMonth() + 1) + '/' + dt.getDate() + '（' + WEEK[dt.getDay()] + '）'; };
    let w = d(b.date) + (b.time ? ' ' + b.time : '');
    if (b.endDate || b.endTime) w += ' → ' + (b.endDate && b.endDate !== b.date ? d(b.endDate) + ' ' : '') + (b.endTime || '');
    return w || '未設定日期';
  }
  function renderBookings() {
    const t = trip();
    let h = sec('// Bookings · 機票、住宿、交通、票券');
    if (!t.bookings.length) h += '<div class="empty sm">還沒有預訂。把機票、飯店、車票、門票的時間和確認碼記在這裡，會自動出現在當天的行程裡。</div>';
    const list = t.bookings.slice().sort((a, b) => ((a.date || '9') + (a.time || '')).localeCompare((b.date || '9') + (b.time || '')));
    h += list.map((b) => {
      const ty = C.BOOK_TYPES[b.type];
      return '<div class="bk"><span class="bk-ic">' + I(ty.icon) + '</span><span class="grow"><b>' + esc(b.title || ty.label) + '</b>' +
        '<br><span class="time">' + esc(bookingWhen(b)) + '</span>' + (b.from || b.to ? '<br><span class="muted">' + esc(b.from) + (b.from && b.to ? ' → ' : '') + esc(b.to) + '</span>' : '') +
        (b.code ? '<br><span class="bk-code">確認碼 <b>' + esc(b.code) + '</b> <button class="linkbtn" data-act="copyCode" data-code="' + esc(b.code) + '">' + I('copy') + '</button></span>' : '') +
        (b.cost ? '<br><span class="muted">' + curr() + fmtMoney(b.cost) + '</span>' : '') +
        (b.note ? '<br><span class="muted">' + esc(b.note.slice(0, 120)) + '</span>' : '') + '</span>' +
        (b.link ? '<a class="icon-btn sm" href="' + esc(b.link) + '" target="_blank" rel="noopener" title="開啟連結">' + I('ext') + '</a>' : '') +
        '<button class="icon-btn sm" data-act="bkEdit" data-id="' + b.id + '">' + I('edit') + '</button></div>';
    }).join('');
    h += '<button class="btn primary block" data-act="bkEdit" data-id="">' + I('add') + ' 新增預訂</button>';
    const tot = t.bookings.reduce((a, b) => a + (b.cost || 0), 0);
    if (tot) h += '<div class="muted small">' + I('money') + ' 預訂合計 ' + curr() + fmtMoney(tot) + '</div>';
    return h;
  }
  function bookingModal(id) {
    const t = trip();
    const b = t.bookings.find((x) => x.id === id) || { type: 'flight', date: t.startDate || '' };
    const f = (k, label, type, ph) => '<label class="lbl">' + label + '</label><input id="bk_' + k + '" type="' + (type || 'text') + '" value="' + esc(b[k] || '') + '" placeholder="' + (ph || '') + '">';
    openModal('<h3>' + (id ? '編輯預訂' : '新增預訂') + '</h3>' +
      '<div class="catpick" id="bkType">' + Object.entries(C.BOOK_TYPES).map(([k, v]) => '<button type="button" class="catopt' + (b.type === k ? ' on' : '') + '" data-cat="' + k + '">' + I(v.icon) + '<small>' + v.label + '</small></button>').join('') + '</div>' +
      f('title', '名稱', 'text', '例：BR198 桃園→成田、新宿華盛頓飯店') +
      '<div class="row gap"><div class="grow">' + f('date', '開始日期', 'date') + '</div><div style="width:120px">' + f('time', '時間', 'time') + '</div></div>' +
      '<div class="row gap"><div class="grow">' + f('endDate', '結束日期（住宿退房、還車）', 'date') + '</div><div style="width:120px">' + f('endTime', '時間', 'time') + '</div></div>' +
      '<div class="row gap"><div class="grow">' + f('from', '出發地', 'text', '桃園 T2') + '</div><div class="grow">' + f('to', '目的地', 'text', '成田 T1') + '</div></div>' +
      f('code', '確認碼／訂位代號', 'text', 'ABC123') +
      '<div class="row gap"><div class="grow">' + f('cost', '金額' + (t.currency ? '（' + esc(t.currency) + '）' : ''), 'number') + '</div></div>' +
      f('link', '連結（訂單頁、電子票）', 'url', 'https://') +
      '<label class="lbl">備註</label><textarea id="bk_note" rows="2">' + esc(b.note || '') + '</textarea>' +
      '<div class="row gap end">' + (id ? '<button class="btn danger" data-mact="del">' + I('trash') + ' 刪除</button><span class="grow"></span>' : '') + '<button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">儲存</button></div>', {
      ok: () => {
        const sel = $('#bkType .catopt.on');
        const nb = C.sanitizeBooking({ id: id || undefined, type: sel ? sel.dataset.cat : 'other', title: $('#bk_title').value, date: $('#bk_date').value, time: $('#bk_time').value,
          endDate: $('#bk_endDate').value, endTime: $('#bk_endTime').value, from: $('#bk_from').value, to: $('#bk_to').value, code: $('#bk_code').value,
          cost: $('#bk_cost').value, link: $('#bk_link').value.trim(), note: $('#bk_note').value });
        if (!nb) { $('#bk_title').focus(); toast('請至少填名稱'); return; }
        snapshot();
        const i = t.bookings.findIndex((x) => x.id === id);
        if (i >= 0) t.bookings[i] = nb; else t.bookings.push(nb);
        let msg = '';
        if (!t.startDate && nb.date) { t.startDate = nb.date; msg = '旅程還沒設出發日，已設為 ' + nb.date + '（可在「行程」修改）'; }
        closeModal(); save(); renderPanel(true);
        if (msg) toast(msg, 6000);
      },
      del: () => { snapshot(); t.bookings = t.bookings.filter((x) => x.id !== id); closeModal(); save(); renderPanel(true); toast('已刪除預訂', 5000, undoAct); },
    });
  }
  /** 每天標題下方顯示當天的預訂 */
  function dayBookings(t, d) {
    const list = C.bookingsOn(t, dayISO(t, d));
    if (!list.length) return '';
    return '<div class="day-bk">' + list.map(({ b, kind }) => '<button class="bkchip" data-act="bkOpen" data-id="' + b.id + '">' + I(C.BOOK_TYPES[b.type].icon) +
      '<span>' + esc((kind === 'out' ? b.endTime : b.time) || '') + ' ' + (kind === 'in' ? '入住 ' : kind === 'out' ? (b.type === 'hotel' ? '退房 ' : '還車 ') : '') + esc(b.title || C.BOOK_TYPES[b.type].label) + '</span></button>').join('') + '</div>';
  }

  /* ================= 分帳 ================= */
  function renderSplit() {
    const t = trip();
    const r = C.settle(t.members, t.expenses);
    let h = sec('// Members · 旅伴') + '<div class="chips catchips">' + t.members.map((m) => '<span class="chip member">' + esc(m) + (t.members.length > 1 ? ' <button class="linkbtn" data-act="memDel" data-name="' + esc(m) + '" title="移除">' + I('close') + '</button>' : '') + '</span>').join('') + '</div>' +
      '<div class="row gap"><input id="memInput" placeholder="新增旅伴名字" maxlength="20" class="grow"><button class="btn" data-act="memAdd">' + I('add') + ' 加入</button></div>';
    h += sec('// Expense · 記一筆') +
      '<div class="row gap"><input id="exTitle" placeholder="項目，例：晚餐" class="grow" maxlength="80"><input id="exAmount" type="number" inputmode="decimal" placeholder="金額" style="width:110px"></div>' +
      '<div class="row gap" style="margin-top:8px"><label class="field grow">誰付的 <select id="exPayer">' + t.members.map((m) => '<option>' + esc(m) + '</option>').join('') + '</select></label></div>' +
      '<div class="lbl">誰要分（預設全部）</div><div class="chips catchips" id="exSplit">' + t.members.map((m) => '<label class="chip member pick"><input type="checkbox" checked value="' + esc(m) + '"> ' + esc(m) + '</label>').join('') + '</div>' +
      '<button class="btn primary block" data-act="exAdd">' + I('add') + ' 記一筆</button>';
    if (t.expenses.length) {
      h += sec('// Settle · 結算') + '<div class="settle">' +
        '<div class="muted small">總支出 ' + curr() + fmtMoney2(r.total) + '</div>' +
        t.members.map((m) => '<div class="srow"><b>' + esc(m) + '</b><span class="muted">付 ' + fmtMoney2(r.paid[m]) + '・分攤 ' + fmtMoney2(r.share[m]) + '</span><span class="' + (r.balance[m] >= 0 ? 'pos' : 'neg') + '">' + (r.balance[m] >= 0 ? '+' : '−') + fmtMoney2(Math.abs(r.balance[m])) + '</span></div>').join('') +
        (r.transfers.length ? '<div class="lbl">怎麼還最省事</div>' + r.transfers.map((x) => '<div class="xfer"><b>' + esc(x.from) + '</b> ' + I('next') + ' <b>' + esc(x.to) + '</b><span class="grow"></span><b>' + curr() + fmtMoney2(x.amount) + '</b></div>').join('') : '<div class="muted small">' + I('check') + ' 已經結清</div>') + '</div>';
      h += sec('// History · 明細') + t.expenses.slice().reverse().map((e) => '<div class="clitem"><span class="grow"><b>' + esc(e.title) + '</b> <span class="muted">' + esc(e.payer) + ' 付' + (e.split.length < t.members.length ? '・' + e.split.map(esc).join('、') + ' 分' : '・全部分') + '</span></span><b>' + curr() + fmtMoney2(e.amount) + '</b><button class="icon-btn sm ghost-btn" data-act="exDel" data-id="' + e.id + '" title="刪除">' + I('close') + '</button></div>').join('');
      h += '<button class="btn block" data-act="exShare">' + I('text') + ' 複製結算文字（貼到 LINE）</button>';
    }
    return h;
  }
  const fmtMoney2 = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  function exAdd() {
    const t = trip();
    const amt = parseFloat($('#exAmount').value);
    if (!Number.isFinite(amt) || amt <= 0) { $('#exAmount').focus(); toast('請輸入金額'); return; }
    const split = [...document.querySelectorAll('#exSplit input:checked')].map((x) => x.value);
    const e = C.sanitizeExpense({ title: $('#exTitle').value.trim() || '支出', amount: amt, payer: $('#exPayer').value, split, date: new Date().toISOString().slice(0, 10) }, t.members);
    t.expenses.push(e); save(); renderPanel(true); toast('已記一筆：' + e.title + ' ' + curr() + fmtMoney2(e.amount));
  }
  function settleText(t) {
    const r = C.settle(t.members, t.expenses);
    const c = t.currency ? t.currency + ' ' : '';
    return ['💰 ' + t.name + ' 分帳', '總支出 ' + c + fmtMoney2(r.total), ''].concat(
      t.members.map((m) => m + '：付 ' + fmtMoney2(r.paid[m]) + '，分攤 ' + fmtMoney2(r.share[m])), '',
      r.transfers.length ? r.transfers.map((x) => x.from + ' → ' + x.to + ' ' + c + fmtMoney2(x.amount)) : ['已經結清 ✅']).join('\n');
  }

  /* ================= 行前清單 ================= */
  const CL_TEMPLATE = {
    '證件': ['護照（效期 6 個月以上）', '機票／登機證', '住宿確認信', '旅遊保險資料', '駕照與國際駕照（要開車才需要）'],
    '金錢': ['外幣現金', '信用卡（兩張以上）', '交通卡（Suica 等）'],
    '電子': ['手機充電器', '行動電源（放隨身行李）', '轉接頭', '網卡／eSIM', '耳機'],
    '衣物': ['換洗衣物', '睡衣', '好走的鞋', '外套／雨具'],
    '其他': ['常備藥品', '盥洗用品', '環保袋', '筆（填入境卡）'],
  };
  function renderList() {
    const t = trip();
    const seg = S.ui.listSeg || 'book';
    const done = (t.checklist || []).filter((c) => c.done).length;
    const bar = '<div class="segbar">' + [['book', I('ticket') + ' 預訂 ' + (t.bookings.length || '')], ['split', I('users') + ' 分帳'], ['pack', I('list') + ' 行李 ' + (t.checklist.length ? done + '/' + t.checklist.length : '')]]
      .map(([k, l]) => '<button class="' + (seg === k ? 'on' : '') + '" data-act="listSeg" data-k="' + k + '">' + l + '</button>').join('') + '</div>';
    return bar + (seg === 'book' ? renderBookings() : seg === 'split' ? renderSplit() : renderPack());
  }
  function renderPack() {
    const t = trip();
    const items = t.checklist || [];
    const done = items.filter((c) => c.done).length;
    let h = sec('// Checklist · 行前清單 ' + done + '/' + items.length) +
      '<div class="row gap"><input id="clInput" placeholder="新增項目，例如：轉接頭" class="grow" maxlength="200"><input id="clGroup" placeholder="分類" style="width:86px" maxlength="30" value="' + esc(S.ui.clGroup || '') + '"><button class="btn primary" data-act="clAdd">' + I('add') + '</button></div>';
    if (!items.length) {
      return h + '<div class="empty">清單是空的。可以自己新增，或先載入常用的行李清單再刪改。<br><button class="btn block" data-act="clTemplate">' + I('list') + ' 載入常用行李清單</button></div>';
    }
    const groups = {};
    items.forEach((c, i) => { (groups[c.g || '未分類'] = groups[c.g || '未分類'] || []).push([c, i]); });
    for (const [g, arr] of Object.entries(groups)) {
      h += '<div class="clgroup"><div class="cl-h">' + esc(g) + ' <span class="muted">' + arr.filter(([c]) => c.done).length + '/' + arr.length + '</span></div>' +
        arr.map(([c, i]) => '<div class="clitem' + (c.done ? ' is-done' : '') + '"><button class="icon-btn sm tick' + (c.done ? ' on' : '') + '" data-act="clToggle" data-i="' + i + '">' + I(c.done ? 'done' : 'undone') + '</button>' +
          '<span class="grow">' + esc(c.t) + '</span><button class="icon-btn sm ghost-btn" data-act="clDel" data-i="' + i + '" title="刪除">' + I('close') + '</button></div>').join('') + '</div>';
    }
    h += '<div class="row gap wrap" style="margin-top:12px">' + (done ? '<button class="btn sm" data-act="clClearDone">' + I('trash') + ' 清除已勾選</button>' : '') + '<button class="btn sm" data-act="clTemplate">' + I('list') + ' 補上常用項目</button></div>';
    return h;
  }
  function clAdd() {
    const inp = $('#clInput'); const v = (inp && inp.value || '').trim();
    if (!v) return;
    const g = ($('#clGroup').value || '').trim().slice(0, 30);
    S.ui.clGroup = g;
    trip().checklist.push({ t: v.slice(0, 200), done: false, g });
    save(); renderPanel(true);
    const ni = $('#clInput'); if (ni) ni.focus();
  }
  function clTemplate() {
    const t = trip(); const have = new Set(t.checklist.map((c) => c.t));
    let n = 0;
    for (const [g, arr] of Object.entries(CL_TEMPLATE)) for (const x of arr) if (!have.has(x)) { t.checklist.push({ t: x, done: false, g }); n++; }
    save(); renderPanel(true); toast(n ? '已加入 ' + n + ' 個常用項目' : '常用項目都已經在清單裡了');
  }

  function helpModal() {
    const row = (ic, title, body) => '<div class="help-row"><span class="cat">' + I(ic) + '</span><span class="grow"><b>' + title + '</b><br><span class="muted">' + body + '</span></span></div>';
    openModal('<h3>使用說明</h3>' +
      row('add', '加地點', '「新增」貼 Google Maps 連結（可多行）、搜尋地名、在地圖上點，或匯入 Google Takeout 的 .csv／.json、My Maps 的 .kml。') +
      row('search', '找附近', '點地圖上的地點 →「附近」，找步行範圍的餐廳、咖啡、超商、車站、廁所、ATM。') +
      row('auto', '排行程', '設天數、出發日、住宿 →「自動排行程」。換城市時，在每天最後一列按「今晚」設當晚住宿。') +
      row('grip', '調整順序', '按「調整順序」後，按住 ⠿ 上下拖曳；用天數選單換到別天（會自動鎖定）。') +
      row('transit', '交通方式', '每段路可切換步行／單車／開車／大眾運輸；「導航」直接開 Google Maps。') +
      row('fit', '面板大小', '拖曳面板上方的橫條或分頁列，往下拉就能看大地圖；快速甩動也可以。') +
      row('today', '旅行中', '設定出發日後，旅行當天會自動只看今天，顯示下一站、導航、打卡；營業時間不合會提醒。') +
      row('share', '分享與備份', '「分享」產生連結、文字行程（貼 LINE）、加入行事曆、下載備份檔。') +
      row('theme', '主題', '「設定」裡每趟旅程可選不同風格。') +
      '<p class="muted small">資料存在這台裝置；iPhone 請「加入主畫面」並定期備份。版本 ' + VERSION + '</p>' +
      '<div class="row end"><button class="btn primary" data-mact="close">知道了</button></div>');
  }

  /* ---------- 歡迎畫面、範例、安裝提醒 ---------- */
  function welcomeHtml() {
    return '<div class="welcome"><svg class="art" viewBox="0 0 300 150" aria-hidden="true" fill="none" stroke="currentColor">' +
      '<g stroke-opacity=".25" stroke-width="1">' + Array.from({ length: 13 }, (_, i) => '<path d="M' + (i * 25) + ' 0V150"/>').join('') + Array.from({ length: 7 }, (_, i) => '<path d="M0 ' + (i * 25) + 'H300"/>').join('') + '</g>' +
      '<path d="M40 30 L110 18 L190 30 L260 18 L260 122 L190 134 L110 122 L40 134 Z" fill="var(--card)" stroke-width="1.5"/>' +
      '<path d="M110 18 V122 M190 30 V134" stroke-width="1" stroke-opacity=".5"/>' +
      '<path d="M62 112 C 90 90, 120 104, 146 80 S 196 52, 228 46" stroke="var(--accent)" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="square"/>' +
      '<rect x="56" y="106" width="12" height="12" transform="rotate(45 62 112)" fill="currentColor" stroke="none"/>' +
      '<rect x="140" y="74" width="12" height="12" transform="rotate(45 146 80)" fill="var(--card)" stroke-width="2"/>' +
      '<rect x="218" y="36" width="20" height="20" transform="rotate(45 228 46)" fill="var(--accent)" stroke="none"/>' +
      '<rect x="224" y="42" width="8" height="8" transform="rotate(45 228 46)" fill="var(--card)" stroke="none"/>' +
      '<path d="M228 16 V28 M228 64 V76 M198 46 H210 M246 46 H258" stroke-width="1.5"/>' +
      '<text x="44" y="146" font-size="8" font-family="monospace" fill="currentColor" stroke="none" letter-spacing="2" opacity=".6">LAT 35.68 / LNG 139.76</text></svg>' +
      '<div class="sub">TRIP · MAP · SYSTEM</div><h3>開始規劃你的旅程</h3><ol>' +
      '<li><span>到「新增」貼上 Google Maps 連結、搜尋地名，或匯入 Google 已儲存清單</span></li>' +
      '<li><span>設定天數和住宿，按「自動排行程」</span></li>' +
      '<li><span>每段路切換步行／單車／開車／大眾運輸看時間，按導航直接開 Google Maps</span></li></ol>' +
      '<button class="btn accent block" data-act="sample">' + I('eye') + ' 先看範例：東京 3 天</button>' +
      '<button class="btn block" data-act="help">' + I('text') + ' 使用說明</button></div>';
  }
  function installBanner() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (!ios || standalone) return '';
    const f = S.data.flags.installDismissed;
    if (f && Date.now() - f < 7 * 864e5) return '';
    return '<div class="banner">' + I('phone') + '<span>請按 Safari 的「分享 → <b>加入主畫面</b>」。沒加的話，iPhone 可能在一週沒使用後清掉資料。</span><button data-act="dismissBanner" aria-label="關閉">' + I('close') + '</button></div>';
  }
  function loadSample() {
    const n = C.newTrip('範例：東京 3 天');
    n.startDate = ''; n.days = 3;
    n.base = C.sanitizePlace({ id: 'base', name: '新宿站附近飯店', lat: 35.6896, lng: 139.7006 });
    const pts = [
      ['淺草寺', 35.7148, 139.7967, '雷門拍照，早上人少'], ['東京晴空塔', 35.7101, 139.8107, '展望台建議先上網買票'], ['上野公園', 35.7156, 139.7745, ''], ['阿美橫丁', 35.7101, 139.7745, '小吃、藥妝'],
      ['明治神宮', 35.6764, 139.6993, ''], ['原宿竹下通', 35.6716, 139.7031, ''], ['澀谷十字路口', 35.6595, 139.7005, 'SHIBUYA SKY 看夜景'], ['表參道', 35.6652, 139.7123, ''],
      ['築地場外市場', 35.6655, 139.7707, '早餐吃海鮮'], ['teamLab Planets', 35.6491, 139.7898, '需預約'], ['台場', 35.6251, 139.7756, ''], ['東京鐵塔', 35.6586, 139.7454, ''],
    ];
    n.currency = '¥';
    const extra = { '淺草寺': ['06:00-17:00', 0], '東京晴空塔': ['10:00-21:00', 3100], 'teamLab Planets': ['09:00-22:00', 3800], '築地場外市場': ['05:00-14:00', 2500], '明治神宮': ['06:00-16:30', 0], '阿美橫丁': ['10:00-20:00', 1500] };
    n.places = pts.map(([name, lat, lng, note]) => C.sanitizePlace({ name, lat, lng, note, hours: (extra[name] || [])[0], cost: (extra[name] || [])[1] }));
    n.places = C.planDays(n);
    S.data.trips.push(n); S.data.current = n.id; save(); renderAll(true);
    toast('已載入範例，可以隨意修改或在設定裡刪除');
  }

  /* ================= 動作 ================= */
  function addPlaces(list, opts) {
    const t = trip();
    const r = C.mergePlaces(t.places, list);
    t.places = r.places;
    save(); renderAll();
    if (!opts || !opts.silent) {
      if (r.added.length) toast('已加入 ' + r.added.length + ' 個地點' + (r.dup.length ? '（' + r.dup.length + ' 個重複略過）' : ''));
      else if (r.dup.length) toast('這個地點已經在清單裡了');
    }
    if (r.added.length && (!opts || opts.fit !== false)) fitTo(r.added.length === 1 ? r.added : t.places);
    return r;
  }

  async function handleAddInput() {
    const text = ($('#addInput').value || '').trim();
    if (!text) return;
    S.ui.results = null; S.ui.addMsg = '';
    const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const hasLinkLines = lines.filter((l) => /https?:\/\/|^-?\d+\.\d+\s*,/.test(l));
    const chunks = hasLinkLines.length > 1 ? lines : [text];
    const direct = [], queries = [], msgs = [];
    for (const c of chunks) {
      const g = C.parseGoogleMapsUrl(c);
      if (g && g.lat != null) direct.push({ name: g.name || '地點 ' + g.lat.toFixed(4) + ',' + g.lng.toFixed(4), lat: g.lat, lng: g.lng, url: g.url || '' });
      else if (g && g.short) {
        if (g.name) { queries.push({ q: g.name, url: g.url }); msgs.push('短網址沒有座標，改用「' + esc(g.name) + '」搜尋。'); }
        else msgs.push('短網址 ' + esc(g.url) + ' 沒有附店名，看不到座標。請在 Safari 打開它，再複製跳轉後的完整網址；或直接輸入地名。');
      } else if (g && g.nameOnly) queries.push({ q: g.nameOnly, url: g.url });
      else if (!/https?:\/\//.test(c)) queries.push({ q: c.replace(/\s+/g, ' ').slice(0, 200) });
      else msgs.push('看不懂這個網址：' + esc(c.slice(0, 80)));
    }
    if (direct.length) { addPlaces(direct); $('#addInput') && ($('#addInput').value = ''); }
    if (queries.length) {
      const q = queries[0];
      S.ui.addMsg = msgs.join('<br>') + (msgs.length ? '<br>' : '') + I('search') + ' 搜尋「' + esc(q.q) + '」中…';
      renderPanel();
      try {
        const c = map.getCenter();
        const near = trip().places.length || map.getZoom() > 8 ? { lat: c.lat, lng: c.lng } : null;
        const list = await SV.geocode(q.q, { settings: settings(), near });
        list.forEach((r) => { if (!r.url && q.url) r.url = q.url; });
        S.ui.results = { list, source: list[0] && list[0].source === 'google' ? 'Google' : 'OpenStreetMap' };
        S.ui.addMsg = msgs.join('<br>');
        if (list.length) fitTo(list);
      } catch (e) {
        S.ui.addMsg = msgs.join('<br>') + '<br>' + I('warn') + ' 搜尋失敗：' + esc(e.message) + '（沒有網路？）';
      }
      renderPanel();
    } else if (msgs.length) { S.ui.addMsg = msgs.join('<br>'); renderPanel(); }
  }

  async function importFiles(files) {
    for (const f of files) {
      if (f.size > 30 * 1024 * 1024) { toast('「' + f.name + '」超過 30 MB，太大了', 5000); continue; }
      let text;
      try { text = await f.text(); } catch (e) { toast('讀不到檔案「' + f.name + '」', 5000); continue; }
      let r;
      try { r = C.parseImport(f.name, text); } catch (e) { modalMsg('無法匯入「' + esc(f.name) + '」', esc(e.message)); continue; }
      if (r.kind === 'trip') {
        const exists = S.data.trips.find((t) => t.id === r.trip.id);
        if (exists) r.trip.id = C.uid();
        S.data.trips.push(r.trip); S.data.current = r.trip.id;
        save(); renderAll(true); toast('已匯入旅程「' + r.trip.name + '」');
        continue;
      }
      const withC = r.places.filter((p) => p.lat != null);
      const t0 = trip();
      const known = new Set(t0.places.map((p) => p.name.trim()).concat(t0.base ? [t0.base.name.trim()] : []));
      const noCAll = r.places.filter((p) => p.lat == null);
      const noC = noCAll.filter((p) => !known.has(p.name.trim()));
      const dupNames = noCAll.length - noC.length;
      const res = addPlaces(withC, { silent: true });
      const dupN = res.dup.length + dupNames;
      toast('「' + f.name + '」：加入 ' + res.added.length + ' 個' + (dupN ? '，重複 ' + dupN + ' 個略過' : '') + (noC.length ? '，' + noC.length + ' 個查座標中' : ''), 5000);
      if (noC.length) geocodeBatch(noC);
    }
  }

  async function geocodeBatch(list) {
    const geo = S.ui.geo && S.ui.geo.done < S.ui.geo.total ? S.ui.geo : { total: 0, done: 0, failed: [] };
    geo.total += list.length; S.ui.geo = geo;
    if (S.ui.tab !== 'add') switchTab('add'); else renderPanel();
    const t = trip();
    const center = t.places.length ? C.centroid(t.places) : null;
    for (const p of list) {
      try {
        const q = p.address ? p.name + ' ' + p.address : p.name;
        let res = await SV.geocode(q, { settings: settings(), near: center, silent: true });
        if (!res.length && p.address) res = await SV.geocode(p.name, { settings: settings(), near: center, silent: true });
        if (res.length) {
          // 有已知地點時，排除距離中心 300km 以外的同名結果
          const ok = center ? res.find((r) => C.haversine(r, center) < 300000) || null : res[0];
          if (ok) addPlaces([{ ...p, lat: ok.lat, lng: ok.lng, address: p.address || ok.address }], { silent: true, fit: false });
          else geo.failed.push(p.name);
        } else geo.failed.push(p.name);
      } catch (e) { geo.failed.push(p.name); }
      geo.done++;
      if (S.ui.tab === 'add') renderPanel(true);
    }
    renderMap(true);
  }

  function moveInDay(id, dir) {
    snapshot();
    const t = trip();
    const p = t.places.find((x) => x.id === id);
    const stops = C.dayStops(t, p.day);
    const i = stops.indexOf(p), j = i + dir;
    if (j < 0 || j >= stops.length) return;
    [stops[i], stops[j]] = [stops[j], stops[i]];
    stops.forEach((s, k) => { s.order = k; });
    save(); renderAll();
  }
  function moveToDay(id, d) {
    snapshot();
    const t = trip();
    const p = t.places.find((x) => x.id === id);
    p.day = d; p.locked = d > 0;
    p.order = d ? C.dayStops(t, d).filter((x) => x !== p).length : 0;
    // 重新編號原本那天
    for (let k = 1; k <= t.days; k++) C.dayStops(t, k).forEach((s, i) => { s.order = i; });
    save(); renderAll();
    if (d) toast('已移到 Day ' + d + ' 並鎖定', 5000, undoAct);
  }

  function autoplan() {
    const t = trip();
    const run = () => {
      snapshot();
      t.places = C.planDays(t);
      save(); S.ui.dayFilter = 0; renderAll(true);
      toast('已排成 ' + t.days + ' 天，手動移動的會被鎖定', 6000, undoAct);
    };
    if (t.places.some((p) => p.day)) {
      openModal('<h3>重新排行程？</h3><p>會重新安排所有<b>沒有鎖定</b>的地點。鎖定的地點維持在原本那天。</p>' +
        '<div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">重新排</button></div>', { ok: () => { closeModal(); run(); } });
    } else run();
  }

  function editPlace(id) {
    const t = trip();
    const p = t.places.find((x) => x.id === id);
    if (!p) return;
    openModal('<h3>編輯地點</h3>' +
      '<label class="lbl">名稱</label><input id="eName" value="' + esc(p.name) + '">' +
      '<label class="lbl">分類</label><div class="catpick" id="eCat">' + Object.entries(C.CATS).map(([k, c]) => '<button type="button" class="catopt' + (p.cat === k ? ' on' : '') + '" data-cat="' + k + '" title="' + c.label + '">' + catIc(k) + '<small>' + c.label + '</small></button>').join('') + '</div>' +
      '<label class="lbl">備註</label><textarea id="eNote" rows="3">' + esc(p.note) + '</textarea>' +
      '<div class="row gap"><label class="field grow">' + I('clock') + ' 營業時間<input id="eHours" placeholder="' + (p.hoursWeek ? '留空＝用下方每週時間' : '10:00-18:00') + '" value="' + esc(p.hours) + '"></label></div>' +
      (p.hoursWeek ? '<div class="muted small">每週：' + esc(C.weekSummary(p.hoursWeek)) + '（自動帶入；上面填了就以上面為準）</div>' : '') +
      '<div class="row gap" style="margin-top:8px"><label class="field grow">' + I('money') + ' 預估花費<input id="eCost" type="number" min="0" step="1" inputmode="decimal" value="' + (p.cost || '') + '" placeholder="0"></label><span class="muted">' + esc(t.currency || '') + '</span></div>' +
      '<div class="row gap"><label class="field">停留（分鐘）<input id="eStay" type="number" min="0" max="1440" step="15" value="' + p.stay + '"></label>' +
      '<label class="field">天數 <select id="eDay"><option value="0">未排</option>' + range(t.days).map((d) => '<option value="' + d + '"' + (p.day === d ? ' selected' : '') + '>Day ' + d + '</option>').join('') + '</select></label></div>' +
      '<label class="check"><input type="checkbox" id="eLock"' + (p.locked ? ' checked' : '') + '> 鎖定在這天（自動排行程不會移動）</label>' +
      '<label class="check"><input type="checkbox" id="eDone"' + (p.done ? ' checked' : '') + '> 已去過（打卡）</label>' +
      '<div class="muted small">座標 ' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '</div>' +
      '<div class="row gap end"><button class="btn danger" data-mact="del">刪除</button><span class="grow"></span><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">儲存</button></div>', {
      ok: () => {
        p.name = $('#eName').value.trim().slice(0, 200) || p.name;
        p.note = $('#eNote').value.slice(0, 2000);
        p.stay = Math.max(0, Math.min(1440, parseInt($('#eStay').value, 10) || 0));
        const nd = parseInt($('#eDay').value, 10) || 0;
        if (nd !== p.day) { p.day = nd; p.order = 999; for (let k = 1; k <= t.days; k++) C.dayStops(t, k).forEach((s, i) => { s.order = i; }); }
        p.locked = $('#eLock').checked && p.day > 0;
        p.done = $('#eDone').checked;
        const sel = $('#eCat .catopt.on'); if (sel) p.cat = sel.dataset.cat;
        p.hours = $('#eHours').value.trim().slice(0, 60);
        const cst = parseFloat($('#eCost').value); p.cost = Number.isFinite(cst) && cst > 0 ? cst : 0;
        closeModal(); save(); renderAll();
      },
      del: () => {
        snapshot();
        t.places = t.places.filter((x) => x !== p);
        for (let k = 1; k <= t.days; k++) C.dayStops(t, k).forEach((s, i) => { s.order = i; });
        closeModal(); save(); renderAll(); toast('已刪除「' + p.name + '」', 6000, undoAct);
      },
    });
  }

  function setHotel(t, d, src) {
    if (d) { t.dayBase = t.dayBase || {}; t.dayBase[d] = C.sanitizePlace({ ...src, id: 'base-' + d, day: 0, cat: 'hotel' }); }
    else t.base = C.sanitizePlace({ ...src, id: 'base', day: 0, cat: 'hotel' });
  }
  /** d=0：預設住宿（每天）；d>0：第 d 天晚上的住宿 */
  function setBaseModal(d) {
    d = d || 0;
    const t = trip();
    const cur = d ? (t.dayBase || {})[d] : t.base;
    const known = hotels(t);
    openModal('<h3>' + (d ? 'Day ' + d + ' 晚上住哪' : '設定住宿') + '</h3><p class="muted">' +
      (d ? '換城市時設定。Day ' + d + ' 會從前一晚的住宿出發、結束在這裡；Day ' + (d + 1) + ' 從這裡出發。' : '預設每天從這裡出發、回到這裡。換城市的話，可以在每天的最後一列按「今晚」個別設定。') + '</p>' +
      (known.length ? '<label class="lbl">已設定過的住宿</label><select id="hSel"><option value="">— 選擇 —</option>' + known.map((h, i) => '<option value="' + i + '">' + esc(h.name) + '</option>').join('') + '</select>' : '') +
      (t.places.length ? '<label class="lbl">或從地點清單選（會從清單移到住宿）</label><select id="bSel"><option value="">— 選擇 —</option>' + t.places.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select>' : '') +
      '<div class="row gap wrap" style="margin-top:12px"><button class="btn primary" data-mact="ok">使用</button>' +
      '<button class="btn" data-mact="pick">' + I('map') + ' 在地圖上點</button>' +
      (cur ? '<button class="btn danger" data-mact="clear">' + (d ? '改回預設住宿' : '不設住宿') + '</button>' : '') + '<button class="btn" data-mact="close">取消</button></div>' +
      '<p class="muted small">住宿還沒在清單裡？先到「新增」搜尋或貼上飯店的 Google Maps 連結。</p>', {
      ok: () => {
        const hi = $('#hSel') ? $('#hSel').value : '';
        const id = $('#bSel') ? $('#bSel').value : '';
        if (hi !== '') { setHotel(t, d, known[+hi]); }
        else if (id) {
          const p = t.places.find((x) => x.id === id);
          setHotel(t, d, p);
          t.places = t.places.filter((x) => x !== p);
        } else return;
        closeModal(); save(); renderAll(); toast(d ? 'Day ' + d + ' 晚上住宿已設定，可以重新「自動排行程」讓地點依城市分配' : '已設定住宿', 6000);
      },
      pick: () => { closeModal(); setPick(d ? 'base:' + d : 'base'); },
      clear: () => { if (d) delete t.dayBase[d]; else t.base = null; closeModal(); save(); renderAll(); },
    });
  }

  /* ---------- 分享 / 匯出 ---------- */
  async function compress(str) {
    const bytes = new TextEncoder().encode(str);
    if (window.CompressionStream) {
      const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z' + C.b64urlEncode(new Uint8Array(await new Response(cs).arrayBuffer()));
    }
    return 'j' + C.b64urlEncode(bytes);
  }
  async function decompress(s) {
    const kind = s[0], bytes = C.b64urlDecode(s.slice(1));
    if (kind === 'z') {
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const buf = await new Response(ds).arrayBuffer();
      if (buf.byteLength > 5 * 1024 * 1024) throw new Error('too big');
      return new TextDecoder().decode(buf);
    }
    return new TextDecoder().decode(bytes);
  }
  const baseUrl = () => location.origin + location.pathname;

  async function shareModal() {
    const t = trip();
    const link = baseUrl() + '#t=' + (await compress(JSON.stringify(C.packTrip(t))));
    const fb = settings().fbConfig;
    let syncPart;
    if (!fb) syncPart = '<p class="muted small">想讓同行的人一起即時編輯？到「設定」貼上 Firebase 設定（README 有教學）。</p>';
    else if (!t.synced) syncPart = '<button class="btn primary block" data-mact="enableSync">' + I('cloud') + ' 開啟這趟旅程的即時同步</button>';
    else {
      const join = baseUrl() + '?join=' + t.id + '#fb=' + C.b64urlEncode(new TextEncoder().encode(JSON.stringify(fb)));
      syncPart = '<label class="lbl">共同編輯連結（拿到的人修改也會同步給你）</label><div class="row gap"><input readonly value="' + esc(join) + '" class="grow" id="joinLink"><button class="btn sm" data-mact="copyJoin">複製</button></div>' +
        '<button class="btn sm ghost" data-mact="disableSync">停止同步（保留本機資料）</button>';
    }
    openModal('<h3>分享與備份</h3>' +
      '<label class="lbl">行程快照連結（對方點開即可匯入一份副本）</label>' +
      '<div class="row gap"><input readonly value="' + esc(link) + '" class="grow" id="shareLink"><button class="btn sm" data-mact="copy">複製</button>' + (navigator.share ? '<button class="btn sm" data-mact="native">分享…</button>' : '') + '</div>' +
      '<div class="muted small">連結長度 ' + link.length + ' 字元' + (link.length > 8000 ? '（很長，部分通訊軟體可能截斷，建議改用備份檔）' : '') + '</div>' +
      '<hr>' + syncPart + '<hr>' +
      '<label class="lbl">文字行程與行事曆</label><div class="row gap wrap"><button class="btn" data-mact="text">' + I('text') + ' 文字行程（貼 LINE）</button><button class="btn" data-mact="ics">' + I('today') + ' 加入行事曆（.ics）</button></div><hr>' +
      '<label class="lbl">備份檔 <span class="muted">' + (t.lastBackup ? '上次備份：' + new Date(t.lastBackup).toLocaleDateString('zh-TW') : '還沒備份過') + '</span></label><div class="row gap wrap"><button class="btn" data-mact="download">' + I('download') + ' 下載 .json 備份</button><button class="btn" data-mact="import">' + I('folder') + ' 匯入備份</button></div>' +
      '<div class="row end"><button class="btn" data-mact="close">關閉</button></div>', {
      copy: () => copyText(link),
      copyJoin: () => copyText($('#joinLink').value),
      native: () => navigator.share({ title: t.name, text: '旅遊行程：' + t.name, url: link }).catch(() => {}),
      download: () => {
        const blob = new Blob([JSON.stringify({ app: 'trip-map', version: VERSION, trip: t }, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = (t.name.replace(/[\\/:*?"<>|]/g, '_') || 'trip') + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        t.lastBackup = Date.now(); save({ silent: true });
      },
      ics: () => exportICS(t),
      text: () => {
        const txt = tripText(t);
        openModal('<h3>文字行程</h3><textarea class="textout" readonly id="txtOut">' + esc(txt) + '</textarea><div class="row gap end">' + (navigator.share ? '<button class="btn" data-mact="native">分享…</button>' : '') + '<button class="btn" data-mact="close">關閉</button><button class="btn primary" data-mact="copy">複製</button></div>', {
          copy: () => copyText(txt), native: () => navigator.share({ title: t.name, text: txt }).catch(() => {}),
        });
      },
      import: () => { closeModal(); $('#fileInput').click(); },
      enableSync: async () => {
        try { await SY.init(fb); t.synced = true; await SY.push(t); watchTrip(t); save({ silent: true }); updateBadge(); shareModal(); toast('已開啟同步'); }
        catch (e) { modalMsg('同步失敗', esc(e.message) + '<br>請檢查 Firebase 設定與 README 的安全規則步驟。'); }
      },
      disableSync: () => { t.synced = false; SY.stop(t.id); save({ silent: true }); updateBadge(); shareModal(); },
    });
  }
  function tripText(t) {
    const lines = ['🗺️ ' + t.name + '（' + t.days + ' 天）'];
    if (t.base) lines.push('🏨 住宿：' + t.base.name);
    Object.entries(t.dayBase || {}).forEach(([d, h]) => lines.push('🏨 Day ' + d + ' 晚上住：' + h.name));
    for (let d = 1; d <= t.days; d++) {
      const stops = C.dayStops(t, d);
      if (!stops.length) continue;
      const infos = dayLegs(t, d).map(([a, b]) => legInfo(t, a, b));
      const e0 = C.dayEnds(t, d), hb = !!(e0.start && e0.end);
      const tl = C.timeline(t.dayStart, infos.map((x) => x.res.duration), stops.map((p) => p.stay || 0), hb);
      lines.push('', '【Day ' + d + (dayDate(t, d) ? ' ' + dayDate(t, d) : '') + '】');
      let li = 0;
      const legTxt = (x) => '   ↓ ' + C.MODES[x.mode].icon + ' ' + (x.res.estimated ? '約' : '') + C.fmtDur(x.res.duration) + '（' + C.fmtDist(x.res.distance) + '）';
      if (hb) { lines.push(C.hm(C.toMin(t.dayStart)) + ' 從住宿出發（' + e0.start.name + '）'); lines.push(legTxt(infos[li++])); }
      stops.forEach((p, i) => {
        lines.push(C.hm(tl.stops[i].arrive) + ' ' + C.CATS[p.cat].emoji + ' ' + p.name + (p.note ? '（' + p.note.replace(/\s+/g, ' ').slice(0, 60) + '）' : ''));
        lines.push('   ' + C.gmapsPlaceUrl(p));
        if (i < stops.length - 1 || hb) lines.push(legTxt(infos[li++]));
      });
      if (hb) lines.push(C.hm(tl.end) + (e0.start !== e0.end ? ' 入住 ' + e0.end.name : ' 回到住宿'));
    }
    return lines.join('\n');
  }
  function copyText(s) {
    (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast('已複製'), () => {
      const i = document.createElement('textarea'); i.value = s; document.body.appendChild(i); i.select();
      try { document.execCommand('copy'); toast('已複製'); } catch (e) { toast('請手動長按複製'); }
      i.remove();
    });
  }

  /* ---------- 同步 ---------- */
  const pushT = {};
  function schedulePush(t) {
    clearTimeout(pushT[t.id]);
    pushT[t.id] = setTimeout(async () => {
      try { await SY.init(settings().fbConfig); await SY.push(t); setBadge('已同步', 'ok'); }
      catch (e) { setBadge('未同步', 'warn'); }
    }, 1200);
  }
  function watchTrip(t) {
    SY.watch(t.id, (remote, updatedAt) => {
      const local = S.data.trips.find((x) => x.id === t.id);
      if (!local || (updatedAt || 0) <= (local.updatedAt || 0)) return;
      const s = C.sanitizeTrip(remote); s.synced = true; s.id = t.id;
      Object.assign(local, s);
      save({ silent: true, fromRemote: true });
      if (local.id === S.data.current) { renderAll(); toast('同行者更新了行程'); }
    }, () => setBadge('同步中斷', 'warn'));
  }
  function setBadge(text, cls) { const b = $('#syncBadge'); b.hidden = false; b.textContent = text; b.className = 'badge ' + cls; }
  function updateBadge() { const t = trip(); if (t.synced) setBadge(SY.connected ? '已同步' : '連線中…', 'ok'); else $('#syncBadge').hidden = true; }
  async function startSync() {
    const fb = settings().fbConfig;
    const synced = S.data.trips.filter((t) => t.synced);
    if (!fb || !synced.length) return;
    try { await SY.init(fb); synced.forEach(watchTrip); updateBadge(); } catch (e) { setBadge('同步離線', 'warn'); }
  }

  /* ---------- 設定 ---------- */
  function settingsModal() {
    const s = settings(), t = trip();
    openModal('<h3>設定</h3>' +
      '<label class="lbl">旅程名稱</label><div class="row gap"><input id="sName" value="' + esc(t.name) + '" class="grow"></div>' +
      '<label class="lbl">' + I('theme') + ' 這趟旅程的主題風格（點一下預覽）</label>' + themePicker(t.theme || 'auto') +
      '<label class="lbl">' + I('money') + ' 花費幣別（顯示用，例如 ¥、JPY、NT$）</label><input id="sCur" value="' + esc(t.currency || '') + '" maxlength="5" placeholder="¥" style="width:120px">' +
      '<div class="row gap wrap" style="margin:8px 0"><button class="btn sm" data-mact="newTrip">＋ 新旅程</button><button class="btn sm" data-mact="dupTrip">複製這趟</button><button class="btn sm danger" data-mact="delTrip">刪除這趟</button></div><hr>' +
      '<label class="lbl">Google Maps API 金鑰（選填：大眾運輸實際班次＋更準的地名搜尋）</label>' +
      '<div class="row gap"><input id="sKey" type="password" autocomplete="off" placeholder="AIza…" value="' + esc(s.gkey) + '" class="grow"><button class="btn sm" data-mact="testKey">測試</button></div>' +
      '<div class="muted small" id="keyMsg">需啟用 Routes API 與 Places API (New)。請在 Google Cloud 限制「網站」為本工具網址並設每日上限，步驟見 <a href="https://github.com/kensu-1219/trip-map#google-金鑰選填" target="_blank" rel="noopener">README</a>。</div><hr>' +
      '<label class="lbl">Firebase 設定（選填：多人即時同步）</label>' +
      '<textarea id="sFb" rows="4" placeholder="把 Firebase 主控台的 const firebaseConfig = { … } 整段貼上">' + esc(s.fbConfig ? JSON.stringify(s.fbConfig, null, 1) : '') + '</textarea>' +
      '<div class="muted small" id="fbMsg">教學見 <a href="https://github.com/kensu-1219/trip-map#firebase-同步選填" target="_blank" rel="noopener">README</a>。</div><hr>' +
      '<label class="lbl">' + I('nav') + ' 導航用哪個地圖 App</label><select id="sNav">' + [['ask', '每次詢問'], ['apple', 'Apple 地圖'], ['google', 'Google 地圖']].map(([v, l]) => '<option value="' + v + '"' + ((s.navApp || 'ask') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="sPhotos"' + (s.photos !== false ? ' checked' : '') + '> 顯示地點照片（維基百科；有 Google 金鑰時用 Google 補）</label>' +
      '<label class="lbl">地圖樣式</label><select id="sTiles">' + [['auto', '自動（跟隨深色模式）'], ['osm', 'OpenStreetMap 標準（當地文字）'], ['carto', 'CARTO 清爽版'], ['dark', 'CARTO 深色']].map(([v, l]) => '<option value="' + v + '"' + (s.tiles === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<div class="row gap wrap" style="margin-top:10px"><button class="btn sm" data-mact="help">' + I('text') + ' 使用說明</button><button class="btn sm" data-mact="clearCache">清除路線快取</button></div>' +
      '<div class="muted small">版本 ' + VERSION + ' · 資料存在這台裝置的瀏覽器' + (t.synced ? '＋Firebase' : '') + '</div>' +
      '<div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">儲存</button></div>', {
      testKey: async () => {
        const k = $('#sKey').value.trim(); const m = $('#keyMsg');
        if (!k) { m.textContent = '請先貼上金鑰'; return; }
        m.textContent = '測試中…';
        const r = await SV.testGoogleKey(k);
        const line = (ok, txt) => (ok ? I('check') : I('warn')) + ' ' + txt;
        const rt = r.routes.ok
          ? (r.routes.empty ? 'Routes API 可用（測試路段無班次資料）' : 'Routes API 可用：台北車站→台北101 大眾運輸 ' + C.fmtDur(r.routes.duration))
          : 'Routes API 失敗：' + esc(r.routes.error);
        const pl = r.places.ok ? 'Places API 可用' + (r.places.name ? '：找到「' + esc(r.places.name) + '」' : '') : 'Places API 失敗：' + esc(r.places.error);
        let html = line(r.routes.ok, rt) + '<br>' + line(r.places.ok, pl);
        if (!r.routes.ok || !r.places.ok) html += '<br>請確認兩個 API 都已啟用，且網站限制包含 ' + esc(location.origin) + '/*（設定後最多 5 分鐘生效）';
        html += '<br><small>註：Google 不提供日本的大眾運輸 API 資料，日本行程的大眾運輸會用估算。</small>';
        m.innerHTML = html;
      },
      ok: async () => {
        t.name = $('#sName').value.trim().slice(0, 100) || t.name;
        const thSel = $('#modalBody .themeopt.on'); if (thSel) t.theme = thSel.dataset.theme;
        t.currency = ($('#sCur').value || '').trim().slice(0, 5);
        const newKey = $('#sKey').value.trim();
        if (newKey !== s.gkey) { s.gkey = newKey; s.gkeyAt = Date.now(); S.requested.clear(); S.legs = {}; }
        s.photos = $('#sPhotos').checked;
        s.navApp = $('#sNav').value;
        const fbText = $('#sFb').value.trim();
        if (fbText) {
          const cfg = SY.parseConfig(fbText);
          if (!cfg) { $('#fbMsg').innerHTML = I('warn') + ' 看不懂這段設定，需要包含 apiKey 和 projectId'; return; }
          s.fbConfig = cfg;
        } else s.fbConfig = null;
        if (s.tiles !== $('#sTiles').value) { s.tiles = $('#sTiles').value; setTiles(); }
        closeModal(); save(); renderAll(); startSync();
      },
      newTrip: () => { askText('新旅程', '旅程名稱', '', (name) => { const n = C.newTrip(name || '新旅程'); S.data.trips.push(n); S.data.current = n.id; save(); renderAll(true); }); },
      dupTrip: () => { const n = C.sanitizeTrip(JSON.parse(JSON.stringify(t))); n.id = C.uid(); n.name = t.name + '（副本）'; S.data.trips.push(n); S.data.current = n.id; closeModal(); save(); renderAll(); },
      delTrip: () => {
        openModal('<h3>刪除「' + esc(t.name) + '」？</h3><p>這趟旅程的 ' + t.places.length + ' 個地點會從這台裝置刪除，無法復原。建議先到「分享」下載備份。</p><div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn danger" data-mact="ok">刪除</button></div>', {
          ok: () => {
            SY.stop(t.id);
            S.data.trips = S.data.trips.filter((x) => x !== t);
            if (!S.data.trips.length) S.data.trips.push(C.newTrip('我的旅程'));
            S.data.current = S.data.trips[0].id; closeModal(); save(); renderAll(true);
          },
        });
      },
      help: () => helpModal(),
      clearCache: () => { SV.clearRouteCache(); S.legs = {}; S.requested.clear(); toast('已清除'); renderAll(); },
    });
  }

  /* ---------- Modal / Toast ---------- */
  let modalActs = {};
  function openModal(html, acts) {
    modalActs = acts || {};
    $('#modalBody').innerHTML = html;
    $('#modal').hidden = false;
    const f = $('#modalBody input:not([readonly]), #modalBody textarea');
    if (f && window.innerWidth >= 900) f.focus();
  }
  function closeModal() { const hadTheme = !!$('#modalBody .themepick'); $('#modal').hidden = true; $('#modalBody').innerHTML = ''; modalActs = {}; if (hadTheme) { applyTheme(); renderMap(false); } }
  function modalMsg(title, html) { openModal('<h3>' + title + '</h3><p>' + html + '</p><div class="row end"><button class="btn primary" data-mact="close">好</button></div>'); }
  function askText(title, label, def, cb) {
    openModal('<h3>' + esc(title) + '</h3><label class="lbl">' + esc(label) + '</label><input id="askIn" value="' + esc(def) + '"><div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">確定</button></div>',
      { ok: () => { const v = $('#askIn').value.trim(); closeModal(); cb(v || def); } });
    const i = $('#askIn'); if (i) { i.focus(); i.select(); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') modalActs.ok(); }); }
  }
  let toastT = null;
  function toast(msg, ms, action) {
    const el = $('#toast'); el.textContent = ''; const sp = document.createElement('span'); sp.textContent = msg; el.appendChild(sp); el.hidden = false;
    el.classList.toggle('has-btn', !!action);
    if (action) {
      const b = document.createElement('button'); b.textContent = action.label;
      b.addEventListener('click', () => { el.hidden = true; action.fn(); });
      el.appendChild(b);
    }
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms || (action ? 6000 : 2600));
  }

  /* ---------- 復原 ---------- */
  const undoStack = [];
  function snapshot() {
    const t = trip();
    undoStack.push({ id: t.id, json: JSON.stringify(t) });
    if (undoStack.length > 15) undoStack.shift();
  }
  function undo() {
    const u = undoStack.pop(); if (!u) return;
    const i = S.data.trips.findIndex((x) => x.id === u.id);
    const restored = JSON.parse(u.json);
    if (i >= 0) S.data.trips[i] = restored; else S.data.trips.push(restored);
    S.data.current = u.id; save(); renderAll(); toast('已復原');
  }
  const undoAct = { label: '復原', fn: undo };

  /* ---------- 底部面板 ---------- */
  /* 手機：可拖曳的底部面板。狀態名稱：mini（只剩分頁列）、peek、half、full */
  const isMobile = () => window.innerWidth < 900;
  function sheetSnaps() {
    const vh = window.innerHeight, top = $('#topbar').getBoundingClientRect().height;
    return { mini: 74, peek: Math.round(vh * 0.3), half: Math.round(vh * 0.52), full: vh - top - 8 };
  }
  function applySheetH(h, animate) {
    const p = $('#panel');
    const sn = sheetSnaps();
    h = Math.max(sn.mini, Math.min(sn.full, Math.round(h)));
    p.classList.toggle('dragging', !animate);
    p.style.height = h + 'px';
    const state = Object.entries(sn).reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0];
    p.classList.remove('mini', 'peek', 'half', 'full'); p.classList.add(state);
    document.documentElement.style.setProperty('--sheet-h', h + 'px');
    return state;
  }
  function setSheet(state) {
    if (!isMobile()) return;
    const sn = sheetSnaps();
    applySheetH(sn[state] || sn.half, true);
    S.data.flags.sheet = state; save({ silent: true });
    clearTimeout(setSheet.t); setSheet.t = setTimeout(() => map.invalidateSize(), 280);
  }
  function bindSheetDrag() {
    const p = $('#panel');
    let startY = 0, startH = 0, dragging = false, moved = false, lastY = 0, lastT = 0, vel = 0, pid = null;
    const down = (e) => {
      if (!isMobile()) return;
      if (e.target.closest('#tabs') && e.pointerType === 'mouse' && e.button !== 0) return;
      startY = lastY = e.clientY; startH = p.getBoundingClientRect().height; lastT = performance.now();
      dragging = true; moved = false; vel = 0; pid = e.pointerId;
    };
    const move = (e) => {
      if (!dragging || e.pointerId !== pid) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) < 8) return;
      if (!moved) moved = true;
      const now = performance.now();
      vel = (e.clientY - lastY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
      applySheetH(startH - dy, false);
      e.preventDefault();
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;
      const sn = sheetSnaps();
      const h = p.getBoundingClientRect().height;
      // 甩動：往上快速 → 下一個較高的段，往下快速 → 較低的段
      const order = ['mini', 'peek', 'half', 'full'];
      let target = order.reduce((a, b) => (Math.abs(sn[b] - h) < Math.abs(sn[a] - h) ? b : a));
      if (Math.abs(vel) > 0.6) {
        const sorted = order.filter((k) => (vel < 0 ? sn[k] > h : sn[k] < h));
        target = vel < 0 ? (sorted[0] || 'full') : (sorted[sorted.length - 1] || 'mini');
      }
      setSheet(target);
      p._justDragged = Date.now();
    };
    for (const el of [$('#sheetHandle'), $('#tabs')]) {
      el.addEventListener('pointerdown', down);
      el.style.touchAction = 'none';
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // 拖曳完不要觸發分頁點擊
    $('#tabs').addEventListener('click', (e) => { if (p._justDragged && Date.now() - p._justDragged < 350) e.stopImmediatePropagation(); }, true);
    window.addEventListener('resize', () => { if (isMobile()) setSheet(S.data.flags.sheet || 'half'); else { p.style.height = ''; map.invalidateSize(); } });
  }

  /* ---------- 站點拖曳排序（調整順序模式） ---------- */
  function bindStopDrag() {
    const body = $('#tabBody');
    let dg = null;
    body.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('.grip'); if (!g) return;
      const row = g.closest('.stop'); const day = row.closest('.day');
      const rows = [...day.querySelectorAll('.stop.can-drag')];
      dg = { row, rows, id: row.dataset.id, y0: e.clientY, s0: body.scrollTop, rects: rows.map((r) => r.getBoundingClientRect()), from: rows.indexOf(row), to: rows.indexOf(row), pid: e.pointerId };
      row.classList.add('dragging');
      try { g.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      e.preventDefault();
    });
    const mark = () => {
      dg.rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
      if (dg.to === dg.from) return;
      const tgt = dg.rows[dg.to];
      tgt.classList.add(dg.to > dg.from ? 'drop-after' : 'drop-before');
    };
    window.addEventListener('pointermove', (e) => {
      if (!dg || e.pointerId !== dg.pid) return;
      const scrollD = body.scrollTop - dg.s0;
      const dy = e.clientY - dg.y0 + scrollD;
      dg.row.style.transform = 'translateY(' + dy + 'px)';
      const r0 = dg.rects[dg.from];
      const mid = r0.top + r0.height / 2 + dy;
      // 新位置＝其他站中「中線在拖曳列中線之上」的數量
      let to = 0;
      dg.rects.forEach((r, i) => { if (i !== dg.from && r.top + r.height / 2 < mid) to++; });
      dg.to = to; mark();
      // 靠近邊緣自動捲動
      const br = body.getBoundingClientRect();
      if (e.clientY < br.top + 40) body.scrollTop -= 12; else if (e.clientY > br.bottom - 40) body.scrollTop += 12;
      e.preventDefault();
    }, { passive: false });
    const end = () => {
      if (!dg) return;
      const { from, to, id } = dg;
      dg.row.style.transform = ''; dg.row.classList.remove('dragging');
      dg.rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
      dg = null;
      if (from === to) return;
      snapshot();
      const t = trip(); const p = t.places.find((x) => x.id === id);
      const stops = C.dayStops(t, p.day);
      stops.splice(from, 1); stops.splice(to, 0, p);
      stops.forEach((s2, k) => { s2.order = k; });
      save(); renderPanel(true); renderMap(false);
      toast('已調整順序', 4000, undoAct);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /* ================= 綁定事件 ================= */
  function renderTripSelect() {
    $('#tripSelect').innerHTML = S.data.trips.map((t) => '<option value="' + t.id + '"' + (t.id === S.data.current ? ' selected' : '') + '>' + (t.synced ? '⟲ ' : '') + esc(t.name) + '（' + t.places.length + '）</option>').join('') + '<option value="__new">＋ 新增旅程…</option>';
  }
  let lastTripId = '';
  function renderAll(fit) {
    if (lastTripId && lastTripId !== S.data.current) { S.ui.nearby = null; if (nearbyLayer) nearbyLayer.clearLayers(); S.ui.results = null; S.ui.addMsg = ''; }
    lastTripId = S.data.current;
    applyTheme(); renderTripSelect(); renderPanel(true); renderMap(!!fit); updateBadge(); }

  function bind() {
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) switchTab(b.dataset.tab); });
    $('#sheetHandle').addEventListener('click', () => {
      const p = $('#panel');
      if (p._justDragged && Date.now() - p._justDragged < 350) return;
      setSheet(p.classList.contains('mini') || p.classList.contains('peek') ? 'half' : p.classList.contains('half') ? 'full' : 'mini');
    });
    bindSheetDrag();
    bindStopDrag();
    bindNavLinks();
    bindListSync();
    $('#tripSelect').addEventListener('change', (e) => {
      if (e.target.value === '__new') { renderTripSelect(); askText('新旅程', '旅程名稱', '', (name) => { const n = C.newTrip(name || '新旅程'); S.data.trips.push(n); S.data.current = n.id; save(); renderAll(true); }); return; }
      S.data.current = e.target.value; S.ui.dayFilter = todayIndex(trip()) || 0; S.ui.measure = { a: '', b: '' }; S.ui.catFilter = ''; save({ silent: true }); renderAll(true);
    });
    $('#btnSettings').addEventListener('click', settingsModal);
    $('#btnShare').addEventListener('click', shareModal);
    $('#btnFit').addEventListener('click', () => fitTo(allPoints(trip())));
    $('#btnLocate').addEventListener('click', locate);
    $('#fileInput').addEventListener('change', (e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; importFiles(fs); });
    $('#modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') { closeModal(); return; }
      const co = e.target.closest('.catopt');
      if (co) { co.parentElement.querySelectorAll('.catopt').forEach((x) => x.classList.toggle('on', x === co)); return; }
      const th = e.target.closest('.themeopt');
      if (th) { th.parentElement.querySelectorAll('.themeopt').forEach((x) => x.classList.toggle('on', x === th)); applyTheme(th.dataset.theme); return; }
      const b = e.target.closest('[data-mact]'); if (!b) return;
      const a = b.dataset.mact;
      if (a === 'close') closeModal(); else if (modalActs[a]) modalActs[a]();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (S.ui.pick) setPick(null); } });
    // 拖放匯入
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files || []); if (fs.length) importFiles(fs); });

    const onAct = (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      const act = el.dataset.act, id = el.dataset.id, t = trip();
      if (el.tagName === 'SELECT' && e.type === 'click') return;
      if (el.tagName === 'A' && act !== 'focus') return;
      if (act === 'focus') { e.preventDefault(); }
      switch (act) {
        case 'days': t.days = Math.max(1, Math.min(60, t.days + +el.dataset.d)); if (S.ui.dayFilter > t.days) S.ui.dayFilter = 0; save(); renderAll(); break;
        case 'filter': S.ui.dayFilter = +el.dataset.d; renderPanel(true); renderMap(true); break;
        case 'autoplan': autoplan(); break;
        case 'setBase': setBaseModal(0); break;
        case 'dayHotel': setBaseModal(+el.dataset.d); break;
        case 'up': moveInDay(id, -1); break;
        case 'down': moveInDay(id, 1); break;
        case 'edit': map.closePopup(); editPlace(id); break;
        case 'focus': { const p = findPoint(t, id); if (p) { if (window.innerWidth < 900) setSheet('peek'); setTimeout(() => { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15)); markerLayer.eachLayer((m) => { if (m.options.title === p.name) m.openPopup(); }); }, 280); } break; }
        case 'mode': t.legModes[el.dataset.key] = el.dataset.mode; save(); renderPanel(true); renderMap(false); break;
        case 'addGo': handleAddInput(); break;
        case 'pickAdd': setPick('add'); break;
        case 'pickResult': {
          const r = S.ui.results.list[+el.dataset.i];
          addPlaces([{ name: r.name, lat: r.lat, lng: r.lng, address: r.address, url: r.url || '', cat: r.cat || '', hoursWeek: r.hoursWeek || null }]);
          S.ui.results = null; S.ui.addMsg = ''; const ai = $('#addInput'); if (ai) ai.value = ''; renderPanel(); break;
        }
        case 'import': $('#fileInput').click(); break;
        case 'clearPlaces':
          openModal('<h3>刪除全部 ' + t.places.length + ' 個地點？</h3><p>無法復原。</p><div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn danger" data-mact="ok">全部刪除</button></div>',
            { ok: () => { snapshot(); t.places = []; t.legModes = {}; closeModal(); save(); renderAll(); toast('已刪除全部地點', 8000, undoAct); } });
          break;
        case 'pickA': setPick('a'); break;
        case 'pickB': setPick('b'); break;
        case 'swap': S.ui.measure = { a: S.ui.measure.b, b: S.ui.measure.a }; renderPanel(); renderMap(false); break;
        case 'measureFrom': S.ui.measure.a = id; map.closePopup(); switchTab('measure'); break;
        case 'measureTo': S.ui.measure.b = id; map.closePopup(); switchTab('measure'); break;
        case 'cancelPick': setPick(null); break;
        case 'sample': loadSample(); break;
        case 'help': helpModal(); break;
        case 'itinParse': itinParse(); break;
        case 'itinRun': itinRun(); break;
        case 'itinReset': S.ui.itin = null; S.ui.itinOpen = true; renderPanel(); break;
        case 'itinView': S.ui.itin = null; S.ui.dayFilter = 0; switchTab('plan'); renderMap(true); break;
        case 'nearbyFrom': { const p = findPoint(t, id); if (p) { map.closePopup(); S.ui.nearby = { origin: { id: p.id, name: p.name, lat: p.lat, lng: p.lng }, kind: '', list: null }; switchTab('add'); } break; }
        case 'nearbyCenter': { const c = map.getCenter(); S.ui.nearby = { origin: { id: '', name: '地圖中心', lat: c.lat, lng: c.lng }, kind: '', list: null }; renderPanel(); break; }
        case 'nearbyKind': runNearby(el.dataset.k); break;
        case 'nearbyAdd': { const r = S.ui.nearby.list[+el.dataset.i]; addPlaces([{ name: r.name, lat: r.lat, lng: r.lng, cat: r.cat, hoursWeek: r.hoursWeek || null, note: r.sub }], { fit: false }); r.added = true; renderPanel(true); break; }
        case 'nearbyClose': S.ui.nearby = null; nearbyLayer.clearLayers(); renderPanel(); break;
        case 'toggleDone': { const p = t.places.find((x) => x.id === id); if (p) { p.done = !p.done; save(); renderPanel(true); renderMap(false); if (p.done) toast('已打卡「' + p.name + '」', 4000, { label: '取消', fn: () => { p.done = false; save(); renderAll(); } }); } break; }
        case 'reorder': S.ui.reorder = !S.ui.reorder; renderPanel(true); break;
        case 'openDay': S.ui.open = S.ui.open || {}; S.ui.open[t.id + ':' + el.dataset.d] = true; renderPanel(true); break;
        case 'catFilter': S.ui.catFilter = el.dataset.c; renderPanel(true); break;
        case 'gotoToday': S.ui.dayFilter = +el.dataset.d; renderPanel(true); renderMap(true); break;
        case 'clAdd': clAdd(); break;
        case 'listSeg': S.ui.listSeg = el.dataset.k; renderPanel(); break;
        case 'bkEdit': bookingModal(el.dataset.id); break;
        case 'bkOpen': S.ui.listSeg = 'book'; switchTab('list'); setTimeout(() => bookingModal(el.dataset.id), 50); break;
        case 'copyCode': copyText(el.dataset.code); break;
        case 'memAdd': { const v = ($('#memInput').value || '').trim().slice(0, 20); if (v && !t.members.includes(v) && t.members.length < 20) { t.members.push(v); save(); renderPanel(true); const mi = $('#memInput'); if (mi) mi.focus(); } break; }
        case 'memDel': { const n = el.dataset.name; if (t.expenses.some((e) => e.payer === n || e.split.includes(n))) { modalMsg('無法移除', esc(n) + ' 已經有支出紀錄，請先刪除相關的帳。'); break; } t.members = t.members.filter((m) => m !== n); save(); renderPanel(true); break; }
        case 'exAdd': exAdd(); break;
        case 'exDel': { snapshot(); t.expenses = t.expenses.filter((e) => e.id !== el.dataset.id); save(); renderPanel(true); toast('已刪除', 4000, undoAct); break; }
        case 'exShare': copyText(settleText(t)); break;
        case 'clToggle': { const c = t.checklist[+el.dataset.i]; if (c) { c.done = !c.done; save(); renderPanel(true); } break; }
        case 'clDel': { snapshot(); t.checklist.splice(+el.dataset.i, 1); save(); renderPanel(true); toast('已刪除', 4000, undoAct); break; }
        case 'clTemplate': clTemplate(); break;
        case 'clClearDone': snapshot(); t.checklist = t.checklist.filter((c) => !c.done); save(); renderPanel(true); toast('已清除勾選的項目', 4000, undoAct); break;
        case 'dismissBanner': S.data.flags.installDismissed = Date.now(); save({ silent: true }); renderPanel(true); break;
      }
    };
    document.addEventListener('click', onAct);
    $('#tabBody').addEventListener('change', (e) => {
      const el = e.target;
      if (el.id === 'startDate') { trip().startDate = el.value; save(); renderPanel(true); }
      else if (el.id === 'dayStart') { if (/^\d{2}:\d{2}$/.test(el.value)) { trip().dayStart = el.value; save(); renderPanel(true); } }
      else if (el.dataset.act === 'moveDay') moveToDay(el.dataset.id, parseInt(el.value, 10) || 0);
      else if (el.dataset.itin && S.ui.itin) { const [d, i] = el.dataset.itin.split(':').map(Number); const day = S.ui.itin.days.find((x) => x.day === d); if (day) day.items[i].on = el.checked; }
      else if (el.dataset.itinName && S.ui.itin) { const [d, i] = el.dataset.itinName.split(':').map(Number); const day = S.ui.itin.days.find((x) => x.day === d); if (day) day.items[i].name = el.value.trim().slice(0, 60) || day.items[i].name; }
      else if (el.id === 'mA' || el.id === 'mB') {
        S.ui.measure[el.id === 'mA' ? 'a' : 'b'] = el.value; renderPanel(); renderMap(false);
        const t = trip(), a = findPointAny(t, S.ui.measure.a), b = findPointAny(t, S.ui.measure.b);
        if (a && b) fitTo([a, b]);
      }
    });
    $('#tabBody').addEventListener('input', (e) => {
      if (e.target.id === 'placeSearch') { S.ui.search = e.target.value; S.ui.focusSearch = true; renderPanel(true); S.ui.focusSearch = false; }
    });
    $('#tabBody').addEventListener('keydown', (e) => {
      if (e.target.id === 'addInput' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddInput();
      if ((e.target.id === 'clInput' || e.target.id === 'clGroup') && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); clAdd(); }
      if (e.target.id === 'memInput' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); document.querySelector('[data-act=memAdd]').click(); }
      if ((e.target.id === 'exAmount' || e.target.id === 'exTitle') && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); exAdd(); }
    });
  }

  function locate() {
    if (!navigator.geolocation) { toast('這個瀏覽器不支援定位'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      S.ui.me = { id: 'me', name: '我的位置', lat: pos.coords.latitude, lng: pos.coords.longitude };
      meLayer.clearLayers();
      L.circleMarker([S.ui.me.lat, S.ui.me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1f6feb', fillOpacity: 1 }).addTo(meLayer);
      L.circle([S.ui.me.lat, S.ui.me.lng], { radius: pos.coords.accuracy, color: '#1f6feb', weight: 1, fillOpacity: 0.08 }).addTo(meLayer);
      map.setView([S.ui.me.lat, S.ui.me.lng], 16);
      if (S.ui.tab === 'measure') renderPanel();
    }, (err) => toast('無法定位：' + (err.code === 1 ? '請允許位置權限' : err.message)), { enableHighAccuracy: true, timeout: 10000 });
  }

  /* ---------- 開啟分享 / 加入連結 ---------- */
  async function handleIncoming() {
    const hash = location.hash || '';
    const params = new URLSearchParams(location.search);
    if (hash.length > 300000) { history.replaceState(null, '', baseUrl()); modalMsg('連結太大', '這個分享連結異常地大，已拒絕開啟。'); return; }
    if (hash.startsWith('#t=')) {
      try {
        const t = C.unpackTrip(JSON.parse(await decompress(hash.slice(3))));
        history.replaceState(null, '', baseUrl());
        openModal('<h3>收到一份行程</h3><p>「<b>' + esc(t.name) + '</b>」共 ' + t.places.length + ' 個地點、' + t.days + ' 天。要加入到你的旅程清單嗎？</p><div class="row gap end"><button class="btn" data-mact="close">不要</button><button class="btn primary" data-mact="ok">加入</button></div>', {
          ok: () => { S.data.trips.push(t); S.data.current = t.id; closeModal(); save(); renderAll(true); toast('已加入「' + t.name + '」'); },
        });
      } catch (e) { history.replaceState(null, '', baseUrl()); modalMsg('分享連結壞掉了', '可能被通訊軟體截斷。請對方改傳備份檔。'); }
    } else if (params.get('join')) {
      const id = params.get('join');
      let cfg = null;
      try { if (hash.startsWith('#fb=')) cfg = JSON.parse(new TextDecoder().decode(C.b64urlDecode(hash.slice(4)))); } catch (e) { /* ignore */ }
      history.replaceState(null, '', baseUrl());
      cfg = SY.parseConfig(cfg) || settings().fbConfig;
      if (!cfg) { modalMsg('無法加入', '連結缺少同步設定。'); return; }
      try {
        toast('正在載入共用行程…', 8000);
        await SY.init(cfg);
        const remote = C.sanitizeTrip(await SY.fetchOnce(id));
        remote.id = id; remote.synced = true;
        if (!settings().fbConfig) settings().fbConfig = cfg;
        const exist = S.data.trips.findIndex((x) => x.id === id);
        if (exist >= 0) S.data.trips[exist] = remote; else S.data.trips.push(remote);
        S.data.current = id; save({ silent: true, fromRemote: true }); watchTrip(remote); renderAll(true);
        toast('已加入共用行程「' + remote.name + '」');
      } catch (e) { modalMsg('無法加入共用行程', esc(e.message)); }
    }
  }

  /* ================= 啟動 ================= */
  function start() {
    loadData();
    initMap();
    bind();
    if (isMobile()) setSheet(S.data.flags.sheet || 'half');
    renderAll(true);
    handleIncoming();
    startSync();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
        // 從背景叫回來時檢查有沒有新版
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (nw) nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('有新版本', 15000, { label: '重新整理', fn: () => location.reload() });
          });
        });
      }).catch(() => {});
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', () => { renderAll(); });
    // 旅行中：預設只看今天
    { const d = todayIndex(trip()); if (d) { S.ui.dayFilter = d; renderAll(true); } }
    window.addEventListener('online', () => { S.requested.clear(); scheduleRender(); });
    window.TripApp = { S, trip, renderAll, C, tripText: () => tripText(trip()), undo }; // 方便除錯與測試
  }
  start();
})();
