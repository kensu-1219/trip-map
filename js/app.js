/* 旅遊地圖 — 介面 */
(function () {
  'use strict';
  const C = window.TripCore, SV = window.TripServices, SY = window.TripSync, LS = SV.LS;
  const VERSION = '1.1.0';
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
      if (!LS.set(STORE_KEY, S.data)) toast('⚠️ 手機儲存空間不足，資料可能沒有存到。請匯出備份。', 6000);
    }, 200);
    if (t.synced && (!opts || !opts.fromRemote)) schedulePush(t);
  }
  const trip = () => S.data.trips.find((t) => t.id === S.data.current);
  const settings = () => S.data.settings;
  const allPoints = (t) => (t.base ? [t.base] : []).concat(t.places);
  const findPoint = (t, id) => (id === 'base' ? t.base : id === 'me' ? S.ui.me : t.places.find((p) => p.id === id));

  /* ================= 地圖 ================= */
  let map, markerLayer, routeLayer, tileLayer, meLayer;
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
    map.on('click', onMapClick);
  }
  function setTiles() {
    let k = settings().tiles;
    if (k === 'auto' || !TILES[k]) k = darkMQ && darkMQ.matches ? 'dark' : 'osm';
    const t = TILES[k];
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(t.url, { attribution: t.attr, maxZoom: t.max, subdomains: 'abcd', crossOrigin: true }).addTo(map);
  }

  function pinIcon(color, label, cls) {
    const base = (cls || '').includes('base');
    return L.divIcon({ className: 'pin-wrap', html: '<div class="pin ' + (cls || '') + '" style="--c:' + color + '"><span>' + esc(label) + '</span></div>',
      iconSize: base ? [32, 32] : [30, 30], iconAnchor: base ? [16, 16] : [15, 37], popupAnchor: base ? [0, -16] : [0, -36] });
  }

  function renderMap(fit) {
    const t = trip();
    markerLayer.clearLayers(); routeLayer.clearLayers();
    const f = S.ui.dayFilter;
    const visible = t.places.filter((p) => !f || p.day === f);
    const dim = (p) => f && p.day !== f;
    for (const p of t.places) {
      if (dim(p) && t.places.length > 300) continue;
      const label = p.day ? String(p.order + 1) : '•';
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(C.dayColor(p.day), label, dim(p) ? 'dim' : ''), title: p.name, zIndexOffset: dim(p) ? -100 : 0 });
      m.bindPopup(() => popupHtml(p), { maxWidth: 260 });
      m.addTo(markerLayer);
    }
    if (t.base) {
      L.marker([t.base.lat, t.base.lng], { icon: pinIcon('#222', '🏨', 'base'), title: t.base.name, zIndexOffset: 500 })
        .bindPopup(() => popupHtml(t.base)).addTo(markerLayer);
    }
    // 路線
    const days = f ? [f] : range(t.days);
    if (t.places.length <= 400) {
      for (const d of days) {
        for (const [a, b] of dayLegs(t, d)) {
          const leg = legInfo(t, a, b);
          const coords = leg.res.coords && leg.res.coords.length ? leg.res.coords : [[a.lat, a.lng], [b.lat, b.lng]];
          L.polyline(coords, { color: C.dayColor(d), weight: f ? 5 : 4, opacity: 0.85, dashArray: leg.res.estimated ? '6 8' : null }).addTo(routeLayer);
        }
      }
    }
    // 量距離
    const ma = findPointAny(t, S.ui.measure.a), mb = findPointAny(t, S.ui.measure.b);
    if (S.ui.tab === 'measure' && ma && mb) {
      L.polyline([[ma.lat, ma.lng], [mb.lat, mb.lng]], { color: '#111', weight: 2, dashArray: '2 6' }).addTo(routeLayer);
    }
    if (fit) fitTo(visible.length ? visible.concat(t.base ? [t.base] : []) : allPoints(t));
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
    const isBase = p.id === 'base';
    return '<div class="pop"><b>' + esc(p.name) + '</b>' +
      (isBase ? '<div class="muted">住宿（每天起終點）</div>' : '<div class="muted">' + (p.day ? 'Day ' + p.day + ' · 第 ' + (p.order + 1) + ' 站' : '尚未排入行程') + '</div>') +
      (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
      '<div class="pop-btns">' +
      '<a class="btn sm" href="' + esc(C.gmapsPlaceUrl(p)) + '" target="_blank" rel="noopener">Google 地圖</a>' +
      '<button class="btn sm" data-act="measureFrom" data-id="' + p.id + '">從這裡量</button>' +
      '<button class="btn sm" data-act="measureTo" data-id="' + p.id + '">量到這裡</button>' +
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
    } else if (pick === 'base') {
      askText('設定住宿', '住宿名稱', '飯店', (name) => { trip().base = C.sanitizePlace({ id: 'base', name, ...pt }); save(); renderAll(); });
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
    const text = { add: '點地圖新增地點', base: '點地圖設定住宿位置', a: '點地圖選起點', b: '點地圖選終點' }[mode];
    h.hidden = !mode;
    h.innerHTML = mode ? '👆 ' + text + ' <button class="btn sm" data-act="cancelPick">取消</button>' : '';
    document.body.classList.toggle('picking', !!mode);
    if (mode && window.innerWidth < 900) setSheet('peek');
  }

  /* ================= 行程計算 ================= */
  const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
  function dayLegs(t, d) {
    const stops = C.dayStops(t, d);
    const seq = t.base && stops.length ? [t.base].concat(stops, [t.base]) : stops;
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
  function scheduleRender() { clearTimeout(rT); rT = setTimeout(() => { renderPanel(true); renderMap(false); }, 120); }

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
    if (window.innerWidth < 900 && $('#panel').classList.contains('peek')) setSheet('half');
    renderPanel(); renderMap(false);
  }

  function renderPanel(keepScroll) {
    const body = $('#tabBody');
    const st = body.scrollTop;
    const fn = { plan: renderPlan, places: renderPlaces, add: renderAdd, measure: renderMeasure }[S.ui.tab];
    body.innerHTML = fn();
    if (keepScroll) body.scrollTop = st;
    if (S.ui.tab === 'places') { const i = $('#placeSearch'); if (i && S.ui.focusSearch) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  function renderPlan() {
    const t = trip();
    const f = S.ui.dayFilter;
    let h = '<div class="row wrap gap">' +
      '<label class="field">天數 <span class="stepper"><button data-act="days" data-d="-1">−</button><b>' + t.days + '</b><button data-act="days" data-d="1">＋</button></span></label>' +
      '<label class="field">出發日 <input type="date" id="startDate" value="' + esc(t.startDate) + '"></label>' +
      '<label class="field">每天 <input type="time" id="dayStart" value="' + esc(t.dayStart || '09:00') + '" step="900"> 出門</label>' +
      '</div>' + installBanner() +
      '<div class="row gap base-row">🏨 <span class="grow">' + (t.base ? '<b>' + esc(t.base.name) + '</b> <span class="muted">每天從這裡出發、回來</span>' : '<span class="muted">未設定住宿（設定後每天會從住宿出發）</span>') + '</span><button class="btn sm" data-act="setBase">' + (t.base ? '更換' : '設定') + '</button></div>' +
      '<button class="btn primary block" data-act="autoplan"' + (t.places.length ? '' : ' disabled') + '>✨ 自動排行程（依遠近分成 ' + t.days + ' 天、排出最順路線）</button>';
    if (!t.places.length) return h + welcomeHtml();
    h += '<div class="chips">' + '<button class="chip' + (f ? '' : ' on') + '" data-act="filter" data-d="0">全部</button>' +
      range(t.days).map((d) => '<button class="chip' + (f === d ? ' on' : '') + '" data-act="filter" data-d="' + d + '" style="--c:' + C.dayColor(d) + '">D' + d + '</button>').join('') + '</div>';
    const days = f ? [f] : range(t.days);
    for (const d of days) h += dayBlock(t, d);
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
    const tl = C.timeline(t.dayStart, infos.map((x) => x.res.duration), stops.map((p) => p.stay || 0), !!t.base);
    const seq = t.base && stops.length ? [t.base].concat(stops, [t.base]) : stops;
    const mainMode = mostCommonMode(infos);
    let h = '<div class="day" data-day="' + d + '"><div class="day-h" style="--c:' + C.dayColor(d) + '"><b>Day ' + d + '</b> <span>' + dayDate(t, d) + '</span>' +
      (seq.length >= 2 ? '<span class="day-tools"><a class="btn sm ghost" target="_blank" rel="noopener" href="' + esc(C.gmapsDayUrl(seq, mainMode)) + '" title="整天路線在 Google Maps 開啟（最多 9 個中途點）">整天導航</a></span>' : '') +
      '<span class="muted">' + stops.length + ' 站' + (stops.length ? ' · ' + C.hm(C.toMin(t.dayStart)) + '–' + C.hm(tl.end) + ' · 移動 ' + (est ? '約 ' : '') + C.fmtDur(move) + ' · ' + C.fmtDist(dist) + ' · 停留 ' + C.fmtDur(stay) : '') + '</span></div>';
    if (!stops.length) return h + '<div class="empty sm">這天沒有安排</div></div>';
    let li = 0;
    if (t.base) h += baseRow(t.base, C.hm(C.toMin(t.dayStart)) + ' 出發') + legRow(t, infos[li++]);
    stops.forEach((p, i) => {
      h += stopRow(t, p, false, i, stops.length, tl.stops[i]);
      if (i < stops.length - 1 || t.base) h += legRow(t, infos[li++]);
    });
    if (t.base) h += baseRow(t.base, C.hm(tl.end) + ' 回到住宿');
    return h + '</div>';
  }
  function mostCommonMode(infos) {
    const c = {}; infos.forEach((i) => { c[i.mode] = (c[i.mode] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || 'transit';
  }
  const baseRow = (b, time) => '<div class="stop base"><span class="num" style="--c:#1b2537">🏨</span><span class="grow">' + esc(b.name) + '</span>' + (time ? '<span class="time">' + time + '</span>' : '') + '</div>';

  function stopRow(t, p, unassigned, i, n, tm) {
    return '<div class="stop" data-id="' + p.id + '">' +
      '<span class="num" style="--c:' + C.dayColor(unassigned ? 0 : p.day) + '">' + (unassigned ? '•' : p.order + 1) + '</span>' +
      '<span class="grow"><a href="#" data-act="focus" data-id="' + p.id + '">' + esc(p.name) + '</a>' + (p.locked ? ' <span title="已鎖定在這天">🔒</span>' : '') +
      '<br>' + (tm ? '<span class="time">' + C.hm(tm.arrive) + '–' + C.hm(tm.depart) + '</span> ' : '') + '<span class="muted">停留 ' + C.fmtDur((p.stay || 0) * 60) + (p.note ? ' · ' + esc(p.note.slice(0, 40)) : '') + '</span></span>' +
      (unassigned ? '' : '<button class="icon-btn sm" data-act="up" data-id="' + p.id + '"' + (i === 0 ? ' disabled' : '') + ' title="往前">↑</button>' +
        '<button class="icon-btn sm" data-act="down" data-id="' + p.id + '"' + (i === n - 1 ? ' disabled' : '') + ' title="往後">↓</button>') +
      '<select class="daysel" data-act="moveDay" data-id="' + p.id + '" title="移到哪一天"><option value="0"' + (p.day ? '' : ' selected') + '>未排</option>' +
      range(t.days).map((d) => '<option value="' + d + '"' + (p.day === d ? ' selected' : '') + '>D' + d + '</option>').join('') + '</select>' +
      '<button class="icon-btn sm" data-act="edit" data-id="' + p.id + '" title="編輯">✏️</button></div>';
  }

  function legRow(t, li) {
    if (!li) return '';
    const r = li.res;
    const [aId, bId] = li.key.split('>');
    const a = findPoint(t, aId), b = findPoint(t, bId);
    let detail = '';
    if (r.steps && r.steps.length) {
      detail = '<div class="steps">' + r.steps.map((s) => s.walk ? '🚶' + Math.max(1, Math.round(s.sec / 60)) + '分' :
        '<span class="line" style="--lc:' + esc(s.color || '#555') + '">' + s.icon + ' ' + esc(s.line) + '</span> ' + esc(s.from) + '→' + esc(s.to) + (s.stops ? '（' + s.stops + '站）' : '')).join(' › ') + '</div>';
    }
    const status = r.estimated ? (li.mode === 'transit' && !settings().gkey ? '估算' : r.error ? '估算（' + esc(r.error) + '）' : '估算中…') : (r.source === 'google' ? 'Google' : '實際路線');
    return '<div class="leg">' +
      '<div class="modes">' + Object.entries(C.MODES).map(([k, m]) => '<button class="mode' + (k === li.mode ? ' on' : '') + '" data-act="mode" data-key="' + esc(li.key) + '" data-mode="' + k + '" title="' + m.label + '">' + m.icon + '</button>').join('') + '</div>' +
      '<div class="leg-info"><b>' + (r.estimated ? '約 ' : '') + C.fmtDur(r.duration) + '</b> · ' + C.fmtDist(r.distance) + ' <span class="muted">(' + status + (r.note ? '，' + esc(r.note) : '') + ')</span>' + detail + '</div>' +
      (a && b ? '<a class="btn sm ghost" target="_blank" rel="noopener" href="' + esc(C.gmapsDirUrl(a, b, li.mode)) + '">導航</a>' : '') +
      '</div>';
  }

  function renderPlaces() {
    const t = trip();
    const q = S.ui.search.trim().toLowerCase();
    const list = t.places.filter((p) => !q || (p.name + ' ' + p.note + ' ' + p.address).toLowerCase().includes(q));
    let h = '<div class="row gap"><input id="placeSearch" type="search" placeholder="篩選 ' + t.places.length + ' 個地點…" value="' + esc(S.ui.search) + '" class="grow"></div>';
    if (!t.places.length) return h + '<div class="empty">還沒有地點。</div>';
    const shown = list.slice(0, 300);
    h += shown.map((p) => '<div class="stop" data-id="' + p.id + '"><span class="num" style="--c:' + C.dayColor(p.day) + '">' + (p.day ? 'D' + p.day : '•') + '</span>' +
      '<span class="grow"><a href="#" data-act="focus" data-id="' + p.id + '">' + esc(p.name) + '</a><br><span class="muted">' + esc((p.note || p.address || '').slice(0, 60)) + '</span></span>' +
      '<a class="icon-btn sm" href="' + esc(C.gmapsPlaceUrl(p)) + '" target="_blank" rel="noopener" title="在 Google 地圖開啟">G</a>' +
      '<button class="icon-btn sm" data-act="edit" data-id="' + p.id + '">✏️</button></div>').join('');
    if (list.length > shown.length) h += '<div class="muted center">還有 ' + (list.length - shown.length) + ' 個，請用上方篩選</div>';
    h += '<button class="btn danger block" data-act="clearPlaces">刪除全部地點</button>';
    return h;
  }

  function renderAdd() {
    const geo = S.ui.geo;
    let h = '<label class="lbl">貼上 Google Maps 連結、座標或地名（可一次貼多行）</label>' +
      '<textarea id="addInput" rows="3" placeholder="例：https://www.google.com/maps/place/...&#10;或：35.7148, 139.7967&#10;或：清水寺"></textarea>' +
      '<div class="row gap"><button class="btn primary grow" data-act="addGo">加入／搜尋</button><button class="btn" data-act="pickAdd">🗺️ 在地圖上點</button></div>';
    if (S.ui.addMsg) h += '<div class="msg">' + S.ui.addMsg + '</div>';
    if (S.ui.results) {
      h += '<div class="results"><div class="muted">搜尋結果（' + (S.ui.results.source || '') + '）— 點一下加入：</div>' +
        (S.ui.results.list.length ? S.ui.results.list.map((r, i) => '<button class="result" data-act="pickResult" data-i="' + i + '"><b>' + esc(r.name) + '</b><br><span class="muted">' + esc(r.address) + '</span></button>').join('') : '<div class="empty sm">找不到，換個關鍵字（加上城市名通常有幫助）</div>') + '</div>';
    }
    if (geo) {
      h += '<div class="msg">📍 正在查詢沒有座標的地點：' + geo.done + ' / ' + geo.total + (geo.failed.length ? '，找不到 ' + geo.failed.length + ' 個' : '') + (geo.done < geo.total ? '（每秒約 1 個）' : ' ✅') + '</div>';
      if (geo.done >= geo.total && geo.failed.length) h += '<div class="msg warn">找不到座標：' + geo.failed.map(esc).join('、') + '<br>可以在上方用地名＋城市重新搜尋。</div>';
    }
    h += '<hr><label class="lbl">匯入檔案</label>' +
      '<button class="btn block" data-act="import">📂 選擇檔案（Google 已儲存清單 .csv／已加星號 .json／My Maps .kml／本工具備份 .json）</button>' +
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
      (S.ui.me ? '<option value="me"' + (sel === 'me' ? ' selected' : '') + '>📍 我的位置</option>' : '') +
      extra.map((p) => '<option value="' + p.id + '"' + (sel === p.id ? ' selected' : '') + '>🗺️ ' + esc(p.name) + '（' + p.lat.toFixed(4) + ',' + p.lng.toFixed(4) + '）</option>').join('') +
      pts.map((p) => '<option value="' + p.id + '"' + (sel === p.id ? ' selected' : '') + '>' + (p.id === 'base' ? '🏨 ' : p.day ? 'D' + p.day + ' ' : '') + esc(p.name) + '</option>').join('');
    let h = '<div class="measure">' +
      '<label class="lbl">起點</label><div class="row gap"><select id="mA" class="grow">' + opts(S.ui.measure.a) + '</select><button class="btn sm" data-act="pickA">🗺️</button></div>' +
      '<div class="center"><button class="icon-btn" data-act="swap" title="對調">⇅</button></div>' +
      '<label class="lbl">終點</label><div class="row gap"><select id="mB" class="grow">' + opts(S.ui.measure.b) + '</select><button class="btn sm" data-act="pickB">🗺️</button></div></div>';
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
        const steps = r.steps && r.steps.length ? '<div class="steps">' + r.steps.map((s) => s.walk ? '🚶' + Math.max(1, Math.round(s.sec / 60)) + '分' : s.icon + ' ' + esc(s.line) + ' ' + esc(s.from) + '→' + esc(s.to)).join(' › ') + '</div>' : '';
        const tag = r.estimated ? (k === 'transit' && !settings().gkey ? '估算' : r.error ? '估算' : '查詢中…') : (r.source === 'google' ? 'Google' : '實際路線');
        h += '<div class="mrow"><span class="micon">' + m.icon + '</span><span class="grow"><b>' + m.label + '</b> ' + (r.estimated ? '約 ' : '') + C.fmtDur(r.duration) + ' · ' + C.fmtDist(r.distance) +
          ' <span class="muted">(' + tag + ')</span>' + (r.note ? '<br><span class="muted">' + esc(r.note) + '</span>' : '') + steps + '</span>' +
          '<a class="btn sm ghost" target="_blank" rel="noopener" href="' + esc(C.gmapsDirUrl(a, b, k)) + '">Google</a></div>';
      }
      h += '</div>';
      if (!settings().gkey) h += '<div class="muted small">🚇 大眾運輸目前是估算值。按「Google」看實際班次，或到 ⚙️ 設定填入 Google 金鑰自動查詢。</div>';
    } else {
      h += '<div class="empty">選兩個地點（或點地圖上的 📍 →「從這裡量」），會同時算出步行、單車、開車、大眾運輸的時間和距離。</div>';
    }
    return h;
  }

  /* ---------- 歡迎畫面、範例、安裝提醒 ---------- */
  function welcomeHtml() {
    return '<div class="welcome"><svg viewBox="0 0 220 120" aria-hidden="true"><path d="M20 22 L80 10 L140 22 L200 10 L200 98 L140 110 L80 98 L20 110 Z" fill="var(--card)" stroke="var(--line)" stroke-width="2"/>' +
      '<path d="M80 10 L80 98 M140 22 L140 110" stroke="var(--line)" stroke-width="2"/>' +
      '<path d="M40 90 C 60 70, 90 84, 110 62 S 150 40, 170 34" fill="none" stroke="var(--pri)" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>' +
      '<circle cx="40" cy="90" r="6" fill="var(--pri)"/><path d="M170 8 c-11 0 -18 8 -18 17 c0 11 12 21 18 29 c6 -8 18 -18 18 -29 c0 -9 -7 -17 -18 -17z" fill="var(--accent)"/><circle cx="170" cy="25" r="6" fill="#fff"/></svg>' +
      '<h3>開始規劃你的旅程</h3><ol>' +
      '<li>到「➕ 新增」貼上 Google Maps 連結、搜尋地名，或匯入 Google 已儲存清單</li>' +
      '<li>設定天數和住宿，按「✨ 自動排行程」</li>' +
      '<li>每段路切換 🚶🚲🚗🚇 看時間，按「導航」直接開 Google Maps</li></ol>' +
      '<button class="btn accent block" data-act="sample">👀 先看範例：東京 3 天</button></div>';
  }
  function installBanner() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (!ios || standalone) return '';
    const f = S.data.flags.installDismissed;
    if (f && Date.now() - f < 7 * 864e5) return '';
    return '<div class="banner">📲<span>請按 Safari 的「分享 → <b>加入主畫面</b>」。沒加的話，iPhone 可能在一週沒使用後清掉資料。</span><button data-act="dismissBanner" aria-label="關閉">✕</button></div>';
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
    n.places = pts.map(([name, lat, lng, note]) => C.sanitizePlace({ name, lat, lng, note }));
    n.places = C.planDays(n);
    S.data.trips.push(n); S.data.current = n.id; save(); renderAll(true);
    toast('已載入範例，可以隨意修改或在 ⚙️ 刪除');
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
      S.ui.addMsg = msgs.join('<br>') + (msgs.length ? '<br>' : '') + '🔎 搜尋「' + esc(q.q) + '」中…';
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
        S.ui.addMsg = msgs.join('<br>') + '<br>⚠️ 搜尋失敗：' + esc(e.message) + '（沒有網路？）';
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
    if (d) toast('已移到 Day ' + d + ' 並鎖定 🔒', 5000, undoAct);
  }

  function autoplan() {
    const t = trip();
    const run = () => {
      snapshot();
      t.places = C.planDays(t);
      save(); S.ui.dayFilter = 0; renderAll(true);
      toast('✨ 已排成 ' + t.days + ' 天，手動移動的會被鎖定', 6000, undoAct);
    };
    if (t.places.some((p) => p.day)) {
      openModal('<h3>重新排行程？</h3><p>會重新安排所有<b>沒有鎖定🔒</b>的地點。鎖定的地點維持在原本那天。</p>' +
        '<div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">重新排</button></div>', { ok: () => { closeModal(); run(); } });
    } else run();
  }

  function editPlace(id) {
    const t = trip();
    const p = t.places.find((x) => x.id === id);
    if (!p) return;
    openModal('<h3>編輯地點</h3>' +
      '<label class="lbl">名稱</label><input id="eName" value="' + esc(p.name) + '">' +
      '<label class="lbl">備註</label><textarea id="eNote" rows="3">' + esc(p.note) + '</textarea>' +
      '<div class="row gap"><label class="field">停留（分鐘）<input id="eStay" type="number" min="0" max="1440" step="15" value="' + p.stay + '"></label>' +
      '<label class="field">天數 <select id="eDay"><option value="0">未排</option>' + range(t.days).map((d) => '<option value="' + d + '"' + (p.day === d ? ' selected' : '') + '>Day ' + d + '</option>').join('') + '</select></label></div>' +
      '<label class="check"><input type="checkbox" id="eLock"' + (p.locked ? ' checked' : '') + '> 🔒 鎖定在這天（自動排行程不會移動）</label>' +
      '<div class="muted small">座標 ' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '</div>' +
      '<div class="row gap end"><button class="btn danger" data-mact="del">刪除</button><span class="grow"></span><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">儲存</button></div>', {
      ok: () => {
        p.name = $('#eName').value.trim().slice(0, 200) || p.name;
        p.note = $('#eNote').value.slice(0, 2000);
        p.stay = Math.max(0, Math.min(1440, parseInt($('#eStay').value, 10) || 0));
        const nd = parseInt($('#eDay').value, 10) || 0;
        if (nd !== p.day) { p.day = nd; p.order = 999; for (let k = 1; k <= t.days; k++) C.dayStops(t, k).forEach((s, i) => { s.order = i; }); }
        p.locked = $('#eLock').checked && p.day > 0;
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

  function setBaseModal() {
    const t = trip();
    openModal('<h3>🏨 設定住宿</h3><p class="muted">住宿會當作每天的起點和終點（排行程時也會考慮離住宿的遠近）。</p>' +
      (t.places.length ? '<label class="lbl">從地點清單選一個當住宿</label><select id="bSel"><option value="">— 選擇 —</option>' + t.places.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select>' : '') +
      '<div class="row gap wrap" style="margin-top:12px">' + (t.places.length ? '<button class="btn primary" data-mact="ok">使用選擇的地點</button>' : '') +
      '<button class="btn" data-mact="pick">🗺️ 在地圖上點</button>' + (t.base ? '<button class="btn danger" data-mact="clear">不設住宿</button>' : '') + '<button class="btn" data-mact="close">取消</button></div>' +
      '<p class="muted small">住宿還沒在清單裡？先到「➕ 新增」搜尋或貼上飯店的 Google Maps 連結。</p>', {
      ok: () => {
        const id = $('#bSel').value; if (!id) return;
        const p = t.places.find((x) => x.id === id);
        t.base = C.sanitizePlace({ ...p, id: 'base', day: 0 });
        t.places = t.places.filter((x) => x !== p);
        closeModal(); save(); renderAll(); toast('已把「' + p.name + '」設為住宿');
      },
      pick: () => { closeModal(); setPick('base'); },
      clear: () => { t.base = null; closeModal(); save(); renderAll(); },
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
    if (!fb) syncPart = '<p class="muted small">想讓同行的人一起即時編輯？到 ⚙️ 設定貼上 Firebase 設定（README 有教學）。</p>';
    else if (!t.synced) syncPart = '<button class="btn primary block" data-mact="enableSync">☁️ 開啟這趟旅程的即時同步</button>';
    else {
      const join = baseUrl() + '?join=' + t.id + '#fb=' + C.b64urlEncode(new TextEncoder().encode(JSON.stringify(fb)));
      syncPart = '<label class="lbl">☁️ 共同編輯連結（拿到的人修改也會同步給你）</label><div class="row gap"><input readonly value="' + esc(join) + '" class="grow" id="joinLink"><button class="btn sm" data-mact="copyJoin">複製</button></div>' +
        '<button class="btn sm ghost" data-mact="disableSync">停止同步（保留本機資料）</button>';
    }
    openModal('<h3>📤 分享與備份</h3>' +
      '<label class="lbl">行程快照連結（對方點開即可匯入一份副本）</label>' +
      '<div class="row gap"><input readonly value="' + esc(link) + '" class="grow" id="shareLink"><button class="btn sm" data-mact="copy">複製</button>' + (navigator.share ? '<button class="btn sm" data-mact="native">分享…</button>' : '') + '</div>' +
      '<div class="muted small">連結長度 ' + link.length + ' 字元' + (link.length > 8000 ? '（很長，部分通訊軟體可能截斷，建議改用備份檔）' : '') + '</div>' +
      '<hr>' + syncPart + '<hr>' +
      '<label class="lbl">文字行程（貼到 LINE／記事本）</label><button class="btn" data-mact="text">📝 產生文字行程</button><hr>' +
      '<label class="lbl">備份檔 <span class="muted">' + (t.lastBackup ? '上次備份：' + new Date(t.lastBackup).toLocaleDateString('zh-TW') : '還沒備份過') + '</span></label><div class="row gap wrap"><button class="btn" data-mact="download">⬇️ 下載 .json 備份</button><button class="btn" data-mact="import">📂 匯入備份</button></div>' +
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
      text: () => {
        const txt = tripText(t);
        openModal('<h3>📝 文字行程</h3><textarea class="textout" readonly id="txtOut">' + esc(txt) + '</textarea><div class="row gap end">' + (navigator.share ? '<button class="btn" data-mact="native">分享…</button>' : '') + '<button class="btn" data-mact="close">關閉</button><button class="btn primary" data-mact="copy">複製</button></div>', {
          copy: () => copyText(txt), native: () => navigator.share({ title: t.name, text: txt }).catch(() => {}),
        });
      },
      import: () => { closeModal(); $('#fileInput').click(); },
      enableSync: async () => {
        try { await SY.init(fb); t.synced = true; await SY.push(t); watchTrip(t); save({ silent: true }); updateBadge(); shareModal(); toast('☁️ 已開啟同步'); }
        catch (e) { modalMsg('同步失敗', esc(e.message) + '<br>請檢查 Firebase 設定與 README 的安全規則步驟。'); }
      },
      disableSync: () => { t.synced = false; SY.stop(t.id); save({ silent: true }); updateBadge(); shareModal(); },
    });
  }
  function tripText(t) {
    const lines = ['🗺️ ' + t.name + '（' + t.days + ' 天）'];
    if (t.base) lines.push('🏨 住宿：' + t.base.name);
    for (let d = 1; d <= t.days; d++) {
      const stops = C.dayStops(t, d);
      if (!stops.length) continue;
      const infos = dayLegs(t, d).map(([a, b]) => legInfo(t, a, b));
      const tl = C.timeline(t.dayStart, infos.map((x) => x.res.duration), stops.map((p) => p.stay || 0), !!t.base);
      lines.push('', '【Day ' + d + (dayDate(t, d) ? ' ' + dayDate(t, d) : '') + '】');
      let li = 0;
      const legTxt = (x) => '   ↓ ' + C.MODES[x.mode].icon + ' ' + (x.res.estimated ? '約' : '') + C.fmtDur(x.res.duration) + '（' + C.fmtDist(x.res.distance) + '）';
      if (t.base) { lines.push(C.hm(C.toMin(t.dayStart)) + ' 從住宿出發'); lines.push(legTxt(infos[li++])); }
      stops.forEach((p, i) => {
        lines.push(C.hm(tl.stops[i].arrive) + ' ' + p.name + (p.note ? '（' + p.note.replace(/\s+/g, ' ').slice(0, 60) + '）' : ''));
        lines.push('   ' + C.gmapsPlaceUrl(p));
        if (i < stops.length - 1 || t.base) lines.push(legTxt(infos[li++]));
      });
      if (t.base) lines.push(C.hm(tl.end) + ' 回到住宿');
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
      try { await SY.init(settings().fbConfig); await SY.push(t); setBadge('☁️ 已同步', 'ok'); }
      catch (e) { setBadge('⚠️ 未同步', 'warn'); }
    }, 1200);
  }
  function watchTrip(t) {
    SY.watch(t.id, (remote, updatedAt) => {
      const local = S.data.trips.find((x) => x.id === t.id);
      if (!local || (updatedAt || 0) <= (local.updatedAt || 0)) return;
      const s = C.sanitizeTrip(remote); s.synced = true; s.id = t.id;
      Object.assign(local, s);
      save({ silent: true, fromRemote: true });
      if (local.id === S.data.current) { renderAll(); toast('☁️ 同行者更新了行程'); }
    }, () => setBadge('⚠️ 同步中斷', 'warn'));
  }
  function setBadge(text, cls) { const b = $('#syncBadge'); b.hidden = false; b.textContent = text; b.className = 'badge ' + cls; }
  function updateBadge() { const t = trip(); if (t.synced) setBadge(SY.connected ? '☁️ 已同步' : '☁️ 連線中…', 'ok'); else $('#syncBadge').hidden = true; }
  async function startSync() {
    const fb = settings().fbConfig;
    const synced = S.data.trips.filter((t) => t.synced);
    if (!fb || !synced.length) return;
    try { await SY.init(fb); synced.forEach(watchTrip); updateBadge(); } catch (e) { setBadge('⚠️ 同步離線', 'warn'); }
  }

  /* ---------- 設定 ---------- */
  function settingsModal() {
    const s = settings(), t = trip();
    openModal('<h3>⚙️ 設定</h3>' +
      '<label class="lbl">旅程名稱</label><div class="row gap"><input id="sName" value="' + esc(t.name) + '" class="grow"></div>' +
      '<div class="row gap wrap" style="margin:8px 0"><button class="btn sm" data-mact="newTrip">＋ 新旅程</button><button class="btn sm" data-mact="dupTrip">複製這趟</button><button class="btn sm danger" data-mact="delTrip">刪除這趟</button></div><hr>' +
      '<label class="lbl">Google Maps API 金鑰（選填：大眾運輸實際班次＋更準的地名搜尋）</label>' +
      '<div class="row gap"><input id="sKey" type="password" autocomplete="off" placeholder="AIza…" value="' + esc(s.gkey) + '" class="grow"><button class="btn sm" data-mact="testKey">測試</button></div>' +
      '<div class="muted small" id="keyMsg">需啟用 Routes API 與 Places API (New)。請在 Google Cloud 限制「網站」為本工具網址並設每日上限，步驟見 <a href="https://github.com/kensu-1219/trip-map#google-金鑰選填" target="_blank" rel="noopener">README</a>。</div><hr>' +
      '<label class="lbl">Firebase 設定（選填：多人即時同步）</label>' +
      '<textarea id="sFb" rows="4" placeholder="把 Firebase 主控台的 const firebaseConfig = { … } 整段貼上">' + esc(s.fbConfig ? JSON.stringify(s.fbConfig, null, 1) : '') + '</textarea>' +
      '<div class="muted small" id="fbMsg">教學見 <a href="https://github.com/kensu-1219/trip-map#firebase-同步選填" target="_blank" rel="noopener">README</a>。</div><hr>' +
      '<label class="lbl">地圖樣式</label><select id="sTiles">' + [['auto', '自動（跟隨深色模式）'], ['osm', 'OpenStreetMap 標準（當地文字）'], ['carto', 'CARTO 清爽版'], ['dark', 'CARTO 深色']].map(([v, l]) => '<option value="' + v + '"' + (s.tiles === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<div class="row gap wrap" style="margin-top:10px"><button class="btn sm" data-mact="clearCache">清除路線快取</button></div>' +
      '<div class="muted small">版本 ' + VERSION + ' · 資料存在這台裝置的瀏覽器' + (t.synced ? '＋Firebase' : '') + '</div>' +
      '<div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">儲存</button></div>', {
      testKey: async () => {
        const k = $('#sKey').value.trim(); const m = $('#keyMsg');
        if (!k) { m.textContent = '請先貼上金鑰'; return; }
        m.textContent = '測試中…';
        try { const r = await SV.testGoogleKey(k); m.innerHTML = '✅ 金鑰可用：東京車站→淺草 大眾運輸 ' + C.fmtDur(r.duration); }
        catch (e) { m.innerHTML = '❌ ' + esc(e.message) + '<br>請確認已啟用 Routes API，且網站限制包含 ' + esc(location.origin); }
      },
      ok: async () => {
        t.name = $('#sName').value.trim().slice(0, 100) || t.name;
        const newKey = $('#sKey').value.trim();
        if (newKey !== s.gkey) { s.gkey = newKey; S.requested.clear(); S.legs = {}; }
        const fbText = $('#sFb').value.trim();
        if (fbText) {
          const cfg = SY.parseConfig(fbText);
          if (!cfg) { $('#fbMsg').innerHTML = '❌ 看不懂這段設定，需要包含 apiKey 和 projectId'; return; }
          s.fbConfig = cfg;
        } else s.fbConfig = null;
        if (s.tiles !== $('#sTiles').value) { s.tiles = $('#sTiles').value; setTiles(); }
        closeModal(); save(); renderAll(); startSync();
      },
      newTrip: () => { askText('新旅程', '旅程名稱', '', (name) => { const n = C.newTrip(name || '新旅程'); S.data.trips.push(n); S.data.current = n.id; save(); renderAll(true); }); },
      dupTrip: () => { const n = C.sanitizeTrip(JSON.parse(JSON.stringify(t))); n.id = C.uid(); n.name = t.name + '（副本）'; S.data.trips.push(n); S.data.current = n.id; closeModal(); save(); renderAll(); },
      delTrip: () => {
        openModal('<h3>刪除「' + esc(t.name) + '」？</h3><p>這趟旅程的 ' + t.places.length + ' 個地點會從這台裝置刪除，無法復原。建議先到 📤 下載備份。</p><div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn danger" data-mact="ok">刪除</button></div>', {
          ok: () => {
            SY.stop(t.id);
            S.data.trips = S.data.trips.filter((x) => x !== t);
            if (!S.data.trips.length) S.data.trips.push(C.newTrip('我的旅程'));
            S.data.current = S.data.trips[0].id; closeModal(); save(); renderAll(true);
          },
        });
      },
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
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; modalActs = {}; }
  function modalMsg(title, html) { openModal('<h3>' + title + '</h3><p>' + html + '</p><div class="row end"><button class="btn primary" data-mact="close">好</button></div>'); }
  function askText(title, label, def, cb) {
    openModal('<h3>' + esc(title) + '</h3><label class="lbl">' + esc(label) + '</label><input id="askIn" value="' + esc(def) + '"><div class="row gap end"><button class="btn" data-mact="close">取消</button><button class="btn primary" data-mact="ok">確定</button></div>',
      { ok: () => { const v = $('#askIn').value.trim(); closeModal(); cb(v || def); } });
    const i = $('#askIn'); if (i) { i.focus(); i.select(); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') modalActs.ok(); }); }
  }
  let toastT = null;
  function toast(msg, ms, action) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
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
  function setSheet(state) {
    const p = $('#panel'); p.classList.remove('peek', 'half', 'full'); p.classList.add(state);
    setTimeout(() => map.invalidateSize(), 260);
  }

  /* ================= 綁定事件 ================= */
  function renderTripSelect() {
    $('#tripSelect').innerHTML = S.data.trips.map((t) => '<option value="' + t.id + '"' + (t.id === S.data.current ? ' selected' : '') + '>' + (t.synced ? '☁️ ' : '') + esc(t.name) + '（' + t.places.length + '）</option>').join('') + '<option value="__new">＋ 新增旅程…</option>';
  }
  function renderAll(fit) { renderTripSelect(); renderPanel(true); renderMap(!!fit); updateBadge(); }

  function bind() {
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) switchTab(b.dataset.tab); });
    $('#sheetHandle').addEventListener('click', () => {
      const p = $('#panel');
      setSheet(p.classList.contains('peek') ? 'half' : p.classList.contains('half') ? 'full' : 'peek');
    });
    $('#tripSelect').addEventListener('change', (e) => {
      if (e.target.value === '__new') { renderTripSelect(); askText('新旅程', '旅程名稱', '', (name) => { const n = C.newTrip(name || '新旅程'); S.data.trips.push(n); S.data.current = n.id; save(); renderAll(true); }); return; }
      S.data.current = e.target.value; S.ui.dayFilter = 0; S.ui.measure = { a: '', b: '' }; save({ silent: true }); renderAll(true);
    });
    $('#btnSettings').addEventListener('click', settingsModal);
    $('#btnShare').addEventListener('click', shareModal);
    $('#btnFit').addEventListener('click', () => fitTo(allPoints(trip())));
    $('#btnLocate').addEventListener('click', locate);
    $('#fileInput').addEventListener('change', (e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; importFiles(fs); });
    $('#modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') { closeModal(); return; }
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
        case 'setBase': setBaseModal(); break;
        case 'up': moveInDay(id, -1); break;
        case 'down': moveInDay(id, 1); break;
        case 'edit': map.closePopup(); editPlace(id); break;
        case 'focus': { const p = findPoint(t, id); if (p) { if (window.innerWidth < 900) setSheet('peek'); setTimeout(() => { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15)); markerLayer.eachLayer((m) => { if (m.options.title === p.name) m.openPopup(); }); }, 280); } break; }
        case 'mode': t.legModes[el.dataset.key] = el.dataset.mode; save(); renderPanel(true); renderMap(false); break;
        case 'addGo': handleAddInput(); break;
        case 'pickAdd': setPick('add'); break;
        case 'pickResult': {
          const r = S.ui.results.list[+el.dataset.i];
          addPlaces([{ name: r.name, lat: r.lat, lng: r.lng, address: r.address, url: r.url || '' }]);
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
        case 'dismissBanner': S.data.flags.installDismissed = Date.now(); save({ silent: true }); renderPanel(true); break;
      }
    };
    document.addEventListener('click', onAct);
    $('#tabBody').addEventListener('change', (e) => {
      const el = e.target;
      if (el.id === 'startDate') { trip().startDate = el.value; save(); renderPanel(true); }
      else if (el.id === 'dayStart') { if (/^\d{2}:\d{2}$/.test(el.value)) { trip().dayStart = el.value; save(); renderPanel(true); } }
      else if (el.dataset.act === 'moveDay') moveToDay(el.dataset.id, parseInt(el.value, 10) || 0);
      else if (el.id === 'mA' || el.id === 'mB') {
        S.ui.measure[el.id === 'mA' ? 'a' : 'b'] = el.value; renderPanel(); renderMap(false);
        const t = trip(), a = findPointAny(t, S.ui.measure.a), b = findPointAny(t, S.ui.measure.b);
        if (a && b) fitTo([a, b]);
      }
    });
    $('#tabBody').addEventListener('input', (e) => {
      if (e.target.id === 'placeSearch') { S.ui.search = e.target.value; S.ui.focusSearch = true; renderPanel(true); S.ui.focusSearch = false; }
    });
    $('#tabBody').addEventListener('keydown', (e) => { if (e.target.id === 'addInput' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddInput(); });
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
        toast('☁️ 正在載入共用行程…', 8000);
        await SY.init(cfg);
        const remote = C.sanitizeTrip(await SY.fetchOnce(id));
        remote.id = id; remote.synced = true;
        if (!settings().fbConfig) settings().fbConfig = cfg;
        const exist = S.data.trips.findIndex((x) => x.id === id);
        if (exist >= 0) S.data.trips[exist] = remote; else S.data.trips.push(remote);
        S.data.current = id; save({ silent: true, fromRemote: true }); watchTrip(remote); renderAll(true);
        toast('☁️ 已加入共用行程「' + remote.name + '」');
      } catch (e) { modalMsg('無法加入共用行程', esc(e.message)); }
    }
  }

  /* ================= 啟動 ================= */
  function start() {
    loadData();
    initMap();
    bind();
    if (window.innerWidth < 900) setSheet('half');
    renderAll(true);
    handleIncoming();
    startSync();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (nw) nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('有新版本', 15000, { label: '重新整理', fn: () => location.reload() });
          });
        });
      }).catch(() => {});
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener('change', () => { if (settings().tiles === 'auto') setTiles(); });
    window.addEventListener('online', () => { S.requested.clear(); scheduleRender(); });
    window.TripApp = { S, trip, renderAll, C, tripText: () => tripText(trip()), undo }; // 方便除錯與測試
  }
  start();
})();
