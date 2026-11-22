/* 外部服務：路線、地名搜尋、儲存。全部可在無網路時優雅退回估算。 */
(function () {
  'use strict';
  const C = window.TripCore;

  /* ---------- 安全的 localStorage ---------- */
  const LS = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  /* ---------- 簡單並行佇列 ---------- */
  function makeQueue(concurrency, gapMs) {
    const q = []; let active = 0; let last = 0;
    const pump = () => {
      while (active < concurrency && q.length) {
        const wait = Math.max(0, last + gapMs - Date.now());
        if (wait > 0) { setTimeout(pump, wait); return; }
        const job = q.shift(); active++; last = Date.now();
        job.fn().then(job.res, job.rej).finally(() => { active--; pump(); });
      }
    };
    return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); pump(); });
  }

  async function fetchJSON(url, opts, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 12000);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch (e) { /* ignore */ }
      if (!r.ok) {
        const msg = j && j.error && (j.error.message || j.error.status) || ('HTTP ' + r.status);
        const err = new Error(msg); err.status = r.status; throw err;
      }
      return j;
    } finally { clearTimeout(t); }
  }

  /* ---------- 路線（含快取） ---------- */
  const ROUTE_CACHE_KEY = 'tripmap.routes.v1';
  let routeCache = LS.get(ROUTE_CACHE_KEY, {});
  let saveTimer = null;
  const persistRoutes = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keys = Object.keys(routeCache);
      if (keys.length > 1500) {
        keys.sort((a, b) => (routeCache[a].t || 0) - (routeCache[b].t || 0));
        keys.slice(0, keys.length - 1200).forEach((k) => delete routeCache[k]);
      }
      if (!LS.set(ROUTE_CACHE_KEY, routeCache)) { // 空間不足：丟掉路線形狀
        for (const k in routeCache) routeCache[k].coords = [];
        LS.set(ROUTE_CACHE_KEY, routeCache);
      }
    }, 800);
  };
  const r5 = (n) => n.toFixed(5);
  const cacheKey = (a, b, mode) => mode + ':' + r5(a.lat) + ',' + r5(a.lng) + '>' + r5(b.lat) + ',' + r5(b.lng);

  const osrmQueue = makeQueue(2, 250);
  const googleQueue = makeQueue(3, 0);
  const inflight = {};

  /** 立即取得（快取或估算），不發請求 */
  function peekLeg(a, b, mode) {
    const c = routeCache[cacheKey(a, b, mode)];
    if (c) return c;
    const est = C.estimateLeg(C.haversine(a, b), mode);
    est.coords = [[a.lat, a.lng], [b.lat, b.lng]];
    return est;
  }

  /** 取得實際路線；失敗時回傳估算並附 error */
  function getLeg(a, b, mode, settings) {
    const key = cacheKey(a, b, mode);
    if (routeCache[key]) return Promise.resolve(routeCache[key]);
    if (inflight[key]) return inflight[key];
    const straight = C.haversine(a, b);
    const fallback = (err) => {
      const est = C.estimateLeg(straight, mode);
      est.coords = [[a.lat, a.lng], [b.lat, b.lng]];
      if (err) est.error = err.message || String(err);
      return est;
    };
    let p;
    if (straight < 30) {
      p = Promise.resolve({ distance: straight, duration: straight / 1.25, coords: [[a.lat, a.lng], [b.lat, b.lng]] });
    } else if (mode === 'transit') {
      if (settings && settings.gkey) {
        p = googleQueue(() => googleTransit(a, b, settings.gkey)).catch(fallback);
      } else p = Promise.resolve(fallback());
    } else {
      const prof = C.MODES[mode].osrm;
      if (straight > 1500000) p = Promise.resolve(fallback(new Error('距離太遠，無法計算路線')));
      else {
        const url = 'https://routing.openstreetmap.de/' + prof + '/route/v1/driving/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson';
        p = osrmQueue(() => fetchJSON(url, {}, 15000)).then(C.parseOsrm).catch(fallback);
      }
    }
    inflight[key] = p.then((res) => {
      delete inflight[key];
      if (!res.estimated) {
        res.t = Date.now();
        // 路線形狀抽稀，節省空間
        if (res.coords && res.coords.length > 300) {
          const step = Math.ceil(res.coords.length / 300);
          res.coords = res.coords.filter((_, i) => i % step === 0 || i === res.coords.length - 1);
        }
        routeCache[key] = res; persistRoutes();
      }
      return res;
    });
    return inflight[key];
  }

  async function googleTransit(a, b, key) {
    const body = {
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode: 'TRANSIT', languageCode: 'zh-TW', computeAlternativeRoutes: false,
    };
    const j = await fetchJSON('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': C.cleanKey(key),
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails,routes.travelAdvisory.transitFare',
      },
      body: JSON.stringify(body),
    }, 15000);
    if (!j || !j.routes || !j.routes.length) { const e = new Error('Google 查無大眾運輸路線（太近，或該地區 Google 未開放大眾運輸資料，例如日本），已改用估算'); e.noRoute = true; throw e; }
    const r = C.parseGoogleRoute(j);
    r.source = 'google';
    return r;
  }

  function clearRouteCache() { routeCache = {}; LS.set(ROUTE_CACHE_KEY, {}); }

  /* ---------- 地名搜尋 ---------- */
  const nominatimQueue = makeQueue(1, 1100); // Nominatim 使用政策：每秒 1 次

  async function geocode(query, opts) {
    opts = opts || {};
    const s = opts.settings || {};
    if (s.gkey) {
      try {
        const body = { textQuery: query, languageCode: 'zh-TW', pageSize: 8 };
        if (opts.near) body.locationBias = { circle: { center: { latitude: opts.near.lat, longitude: opts.near.lng }, radius: 50000 } };
        const j = await googleQueue(() => fetchJSON('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': C.cleanKey(s.gkey), 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.primaryType,places.regularOpeningHours.weekdayDescriptions' },
          body: JSON.stringify(body),
        }));
        const list = (j && j.places || []).map((p) => ({
          name: p.displayName ? p.displayName.text : query, address: p.formattedAddress || '',
          lat: p.location.latitude, lng: p.location.longitude, url: p.googleMapsUri || '', source: 'google',
          cat: C.catFromGoogleType(p.primaryType),
          hoursWeek: p.regularOpeningHours ? C.parseGoogleWeek(p.regularOpeningHours.weekdayDescriptions) : null,
        }));
        if (list.length) return list;
      } catch (e) { if (!opts.silent) console.warn('Google 搜尋失敗，改用 OpenStreetMap', e); }
    }
    let url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=zh-TW,zh,en&q=' + encodeURIComponent(query);
    if (opts.near) {
      const d = 1.0;
      url += '&viewbox=' + [opts.near.lng - d, opts.near.lat + d, opts.near.lng + d, opts.near.lat - d].join(',');
    }
    const j = await nominatimQueue(() => fetchJSON(url, { headers: { 'Accept': 'application/json' } }));
    return (j || []).map((r) => ({
      name: r.name || (r.display_name || '').split(',')[0], address: r.display_name || '',
      lat: parseFloat(r.lat), lng: parseFloat(r.lon), source: 'osm',
      cat: C.catFromGoogleType(r.type) || C.catFromGoogleType(r.category) || '',
    }));
  }

  const overpassQueue = makeQueue(1, 1000);
  // OpenStreetMap 的 Overpass 主站常塞車：依序試幾個公開鏡像站，每個最多等 9 秒
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  let overpassGood = 0;
  async function nearbyOSM(kind, origin, radius) {
    const q = C.overpassQuery(kind, origin.lat, origin.lng, radius || 700);
    let err;
    for (let i = 0; i < OVERPASS.length; i++) {
      const ix = (overpassGood + i) % OVERPASS.length;
      try {
        const j = await overpassQueue(() => fetchJSON(OVERPASS[ix], {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q),
        }, 9000));
        overpassGood = ix;
        return { list: C.parseOverpass(j, origin, kind), source: 'osm' };
      } catch (e) { err = e; }
    }
    throw err || new Error('OpenStreetMap 附近搜尋暫時連不上');
  }
  /** 附近：有 Google 金鑰用 Google（快、有評分與營業時間），否則或失敗時用 OpenStreetMap */
  async function nearby(kind, origin, radius, settings) {
    const key = settings && settings.gkey;
    if (key && C.NEARBY_G[kind]) {
      try {
        const j = await googleQueue(() => fetchJSON('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': C.cleanKey(key), 'X-Goog-FieldMask': 'places.displayName,places.location,places.primaryType,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.googleMapsUri,places.regularOpeningHours.weekdayDescriptions' },
          body: JSON.stringify({ includedTypes: C.NEARBY_G[kind], maxResultCount: 20, rankPreference: 'DISTANCE', languageCode: 'zh-TW', locationRestriction: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: radius || 700 } } }),
        }, 12000));
        return { list: C.parseGoogleNearby(j, origin, kind), source: 'google' };
      } catch (e) { console.warn('Google 附近搜尋失敗，改用 OpenStreetMap', e); }
    }
    return nearbyOSM(kind, origin, radius);
  }

  /* ---------- 地點照片 ---------- */
  const photoQueue = makeQueue(2, 200);
  async function wikiPhoto(place) {
    const name = String(place.name || '').replace(/\s+(本店|店|分店)$/, '').slice(0, 80);
    for (const lang of C.wikiLangs(name)) {
      const url = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=5&gsrsearch=' + encodeURIComponent(name) +
        '&prop=pageimages|coordinates|info&inprop=url&piprop=thumbnail&pithumbsize=640&coprimary=primary';
      const j = await photoQueue(() => fetchJSON(url, {}, 10000));
      const pick = C.wikiPick(j, place, { maxDist: 3000 });
      if (pick) return { src: 'wiki', url: pick.url, link: pick.link };
    }
    if (C.PHOTO_GEO_CATS.includes(place.cat)) {
      for (const lang of ['ja', 'zh', 'en'].slice(0, 2)) {
        const url = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggslimit=6&ggsradius=120&ggscoord=' +
          place.lat.toFixed(6) + '%7C' + place.lng.toFixed(6) + '&prop=pageimages|coordinates|info&inprop=url&piprop=thumbnail&pithumbsize=640&coprimary=primary';
        const j = await photoQueue(() => fetchJSON(url, {}, 10000));
        const pick = C.wikiPick(j, place, { maxDist: 150, geo: true });
        if (pick) return { src: 'wiki', url: pick.url, link: pick.link };
      }
    }
    return null;
  }
  async function googlePhoto(place, key) {
    const j = await photoQueue(() => fetchJSON('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': C.cleanKey(key), 'X-Goog-FieldMask': 'places.location,places.photos' },
      body: JSON.stringify({ textQuery: place.name, pageSize: 3, locationBias: { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: 300 } } }),
    }, 10000));
    for (const p of (j && j.places) || []) {
      if (!p.location || !p.photos || !p.photos.length) continue;
      if (C.haversine(place, { lat: p.location.latitude, lng: p.location.longitude }) > 400) continue;
      return C.sanitizePhoto({ src: 'google', name: p.photos[0].name });
    }
    return null;
  }
  async function findPhoto(place, settings) {
    let r = null;
    try { r = await wikiPhoto(place); } catch (e) { /* 網路錯誤：交給下次 */ if (!settings || !settings.gkey) throw e; }
    if (!r && settings && settings.gkey) { try { r = await googlePhoto(place, settings.gkey); } catch (e) { /* ignore */ } }
    return r;
  }
  function photoSrc(ph, settings) {
    if (!ph) return '';
    if (ph.src === 'wiki') return ph.url;
    if (ph.src === 'google' && settings && settings.gkey) return 'https://places.googleapis.com/v1/' + ph.name + '/media?maxWidthPx=640&key=' + encodeURIComponent(C.cleanKey(settings.gkey));
    return '';
  }

  /** 分別測 Routes 與 Places；回傳 { routes:{ok,duration|error}, places:{ok,name|error} } */
  async function testGoogleKey(key) {
    // 用台北測（Google 不提供日本的大眾運輸 API 資料，東京會回空結果）
    const a = { lat: 25.047675, lng: 121.517055 }, b = { lat: 25.033976, lng: 121.564472 };
    const out = {};
    try { const r = await googleTransit(a, b, key); out.routes = { ok: true, duration: r.duration }; }
    catch (e) { out.routes = { ok: !!e.noRoute, empty: !!e.noRoute, error: e.message, status: e.status }; }
    try {
      const j = await fetchJSON('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': C.cleanKey(key), 'X-Goog-FieldMask': 'places.displayName' },
        body: JSON.stringify({ textQuery: '台北101', languageCode: 'zh-TW', pageSize: 1 }),
      });
      const p = j && j.places && j.places[0];
      out.places = { ok: true, name: p && p.displayName ? p.displayName.text : '' };
    } catch (e) { out.places = { ok: false, error: e.message, status: e.status }; }
    return out;
  }

  window.TripServices = { LS, peekLeg, getLeg, geocode, testGoogleKey, clearRouteCache, fetchJSON, nearby, findPhoto, photoSrc };
})();
