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
        ...(CATS[pr.cat] ? { cat: pr.cat } : {}),
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

  /* ---------- 地點分類 ---------- */
  // 每個分類一個顏色（大地色系，彼此可區分）
  const CAT_COLOR = {
    food: '#c4583c', cafe: '#b07a3a', bar: '#8e4a7a', station: '#3c5a86', airport: '#4a7fa3', hotel: '#2f2c25',
    shopping: '#c2902f', market: '#cf6e2e', museum: '#6d5a8e', temple: '#b3412f', castle: '#7a5a3c', park: '#5f7f3a',
    beach: '#2f8a8a', view: '#3f6e78', theme: '#c0507a', zoo: '#8a6a3b', onsen: '#a3524a', landmark: '#5b6e8a', other: '#7a7563',
  };
  const CATS = {
    food: { label: '餐廳', emoji: '🍜' }, cafe: { label: '咖啡甜點', emoji: '☕' }, bar: { label: '酒吧夜生活', emoji: '🍸' },
    station: { label: '車站', emoji: '🚉' }, airport: { label: '機場', emoji: '✈️' }, hotel: { label: '住宿', emoji: '🏨' },
    shopping: { label: '百貨購物', emoji: '🛍️' }, market: { label: '市場商店街', emoji: '🏮' }, museum: { label: '美術館博物館', emoji: '🏛️' },
    temple: { label: '寺廟神社', emoji: '⛩️' }, castle: { label: '城堡古蹟', emoji: '🏯' }, park: { label: '公園自然', emoji: '🌳' },
    beach: { label: '海灘', emoji: '🏖️' }, view: { label: '展望夜景', emoji: '🗼' }, theme: { label: '樂園', emoji: '🎡' },
    zoo: { label: '動物園水族館', emoji: '🐾' }, onsen: { label: '溫泉', emoji: '♨️' }, landmark: { label: '地標景點', emoji: '📍' },
    other: { label: '其他', emoji: '📌' },
  };
  const CAT_RULES = [
    ['airport', /機場|空港|airport/i],
    ['hotel', /飯店|酒店|旅館|旅店|民宿|ホテル|旅籠|hotel|hostel|\binn\b|resort|ryokan|住宿/i],
    ['theme', /樂園|楽園|遊樂|游樂|disney|universal|usj|legoland|theme ?park|ジブリパーク/i],
    ['zoo', /動物園|水族館|aquarium|\bzoo\b|safari/i],
    ['museum', /美術館|博物館|museum|gallery|ギャラリー|藝廊|紀念館|記念館|teamlab|美術|展覧|exhibition/i],
    ['castle', /城$|城堡|城跡|castle|palace|宮殿|遺跡|古蹟|ruins|fort/i],
    ['temple', /寺|神社|神宮|大社|天滿宮|天満宮|稲荷|稻荷|廟|宮$|shrine|temple|church|cathedral|basilica|mosque|教堂|聖堂|chapel/i],
    ['onsen', /溫泉|温泉|onsen|錢湯|銭湯|hot ?spring|spa\b/i],
    ['beach', /海灘|海水浴|沙灘|beach|ビーチ/i],
    ['view', /展望|夜景|觀景|観景|tower|タワー|塔$|塔\b|鐵塔|晴空塔|sky\b|スカイ|observatory|viewpoint|觀景台/i],
    ['station', /車站|[^網]站$|駅|station|地鐵|地下鉄|metro\b|\bmrt\b|\bjr\b/i],
    ['market', /市場|夜市|横丁|橫丁|商店街|market|bazaar|朝市/i],
    ['cafe', /咖啡|カフェ|珈琲|喫茶|cafe|café|coffee|甜點|甜品|スイーツ|bakery|麵包|パン屋|starbucks|星巴克|dessert|パフェ|抹茶/i],
    ['bar', /酒吧|居酒屋|izakaya|\bbar\b|pub\b|夜店|club\b|ゴールデン街|bistro bar|酒場|brewery/i],
    ['food', /餐|食堂|料理|拉麵|ラーメン|ramen|壽司|寿司|sushi|燒肉|焼肉|烤肉|丼|うどん|烏龍|蕎麥|そば|天婦羅|天ぷら|串|鍋|牛排|steak|burger|pizza|restaurant|kitchen|diner|bistro|一蘭|吉野家|すき家|燒|焼き|小籠包|火鍋|飯$|麵$|麺|カレー|咖哩|食べ|美食|grill|trattoria|ramen/i],
    ['shopping', /百貨|三越|伊勢丹|高島屋|大丸|阪急|阪神|outlet|mall|shopping|購物|商場|ドン・?キホーテ|唐吉訶德|驚安|ビック|bic ?camera|yodobashi|uniqlo|表參道|表参道|竹下通|心齋橋|心斎橋|商圈|store\b|shop\b|parco|lumine|loft|無印|ginza six|銀座|秋葉原|akihabara/i],
    ['park', /公園|庭園|園$|森林|竹林|山$|岳$|瀑布|滝|湖$|峽谷|峡谷|花園|植物園|park|garden|forest|lake|falls|valley|mountain|trail|步道/i],
    ['landmark', /十字路口|crossing|門$|橋$|bridge|廣場|広場|square|street|大道|通り|老街|街$|地標|landmark|monument|雕像|statue|鳥居/i],
  ];
  function guessCat(name, extra) {
    const n = String(name || '').trim();
    for (const [k, re] of CAT_RULES) if (re.test(n)) return k;
    return 'other';
  }
  const GTYPE = [
    [/airport/, 'airport'], [/lodging|hotel|hostel|motel|resort|bed_and_breakfast/, 'hotel'],
    [/amusement_park|theme_park|water_park/, 'theme'], [/zoo|aquarium/, 'zoo'], [/museum|art_gallery|cultural_center/, 'museum'],
    [/castle|historical/, 'castle'], [/place_of_worship|temple|church|mosque|synagogue|shrine/, 'temple'],
    [/spa|hot_spring|sauna/, 'onsen'], [/beach/, 'beach'], [/observation_deck|scenic/, 'view'],
    [/train_station|subway_station|transit_station|bus_station|light_rail|railway/, 'station'],
    [/market/, 'market'], [/cafe|coffee|bakery|dessert|tea_house|ice_cream|confectionery/, 'cafe'],
    [/bar|night_club|pub|wine|brewery/, 'bar'], [/restaurant|food|meal|diner/, 'food'],
    [/department_store|shopping_mall|store|shop|outlet/, 'shopping'], [/park|garden|hiking|national_park|campground/, 'park'],
    [/station|halt|platform/, 'station'], [/attraction|viewpoint/, 'landmark'],
    [/tourist_attraction|landmark|monument|plaza/, 'landmark'],
  ];
  function catFromGoogleType(type) {
    if (!type) return '';
    for (const [re, k] of GTYPE) if (re.test(type)) return k;
    return '';
  }

  /* ---------- 營業時間 ---------- */
  /** "10:00-18:00" 或 "10:00–18:00, 19:00-22:00" → [[600,1080],...]；跨夜 "18:00-02:00" → [1080, 1560] */
  function parseHours(str) {
    if (!str) return null;
    const out = [];
    const re = /(\d{1,2})[:：](\d{2})\s*[-–~〜至到]\s*(\d{1,2})[:：](\d{2})/g;
    let m;
    while ((m = re.exec(String(str)))) {
      const a = +m[1] * 60 + +m[2]; let b = +m[3] * 60 + +m[4];
      if (b <= a) b += 1440;
      out.push([a, b]);
    }
    return out.length ? out : null;
  }
  /** 回傳 null（沒問題）或警告字串 */
  function hoursWarning(hoursStr, arrive, depart) {
    if (hoursStr === 'off') return '這天公休';
    const h = parseHours(hoursStr);
    if (!h) return null;
    const inside = h.some(([a, b]) => arrive >= a && depart <= b);
    if (inside) return null;
    const open = h.some(([a, b]) => arrive < b && depart > a);
    if (!open) {
      const first = h.find(([a]) => a > arrive);
      return first ? '抵達時還沒開（' + hm(first[0]) + ' 開）' : '抵達時已經關門';
    }
    const cur = h.find(([a, b]) => arrive < b && depart > a);
    if (arrive < cur[0]) return '早到 ' + Math.round(cur[0] - arrive) + ' 分（' + hm(cur[0]) + ' 開）';
    return '離開前已關門（' + hm(cur[1]) + ' 關）';
  }


  /* ---------- 每週營業時間：week[0..6] = 日..六；'' 不知道、'off' 公休、'10:00-18:00, 19:00-22:00' ---------- */
  const OSM_D = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
  function osmDays(spec) {
    const out = new Set();
    for (const part of spec.split(',')) {
      const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
      if (!m) { if (part.trim() === 'PH') continue; return null; }
      const a = OSM_D[m[1]], b = m[2] != null ? OSM_D[m[2]] : a;
      // Mo=1..Su=0 的區間（例如 Fr-Mo 跨週）
      const seq = [1, 2, 3, 4, 5, 6, 0];
      let i = seq.indexOf(a); out.add(a);
      while (seq[i] !== b) { i = (i + 1) % 7; out.add(seq[i]); }
    }
    return [...out];
  }
  function osmTimes(t) {
    t = t.trim();
    if (/^(off|closed)$/i.test(t)) return 'off';
    const r = [];
    for (const x of t.split(',')) {
      const m = x.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
      if (!m) return null;
      r.push(m[1].padStart(2, '0') + ':' + m[2] + '-' + m[3].padStart(2, '0') + ':' + m[4]);
    }
    return r.join(', ');
  }
  function parseOSMHours(str) {
    if (!str) return null;
    str = String(str).trim();
    if (str === '24/7') return Array(7).fill('00:00-24:00');
    const week = Array(7).fill('');
    let any = false, explicit = false;
    for (const rule of str.split(';')) {
      const r = rule.trim(); if (!r) continue;
      let days = [0, 1, 2, 3, 4, 5, 6], times = r;
      const m = r.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su|PH))*)\s+(.+)$/);
      if (m) { days = osmDays(m[1]); times = m[2]; if (!days) continue; explicit = true; }
      else if (/^(Mo|Tu|We|Th|Fr|Sa|Su)[-,A-Za-z]*$/.test(r)) continue;
      const tv = osmTimes(times);
      if (tv == null) continue;
      days.forEach((d) => { week[d] = tv; }); any = true;
    }
    if (any && explicit) for (let d = 0; d < 7; d++) if (!week[d]) week[d] = 'off'; // OSM：沒列到的天＝公休
    return any ? week : null;
  }
  const GDAY = [[/星期日|週日|周日|sunday/i, 0], [/星期一|週一|周一|monday/i, 1], [/星期二|週二|周二|tuesday/i, 2], [/星期三|週三|周三|wednesday/i, 3], [/星期四|週四|周四|thursday/i, 4], [/星期五|週五|周五|friday/i, 5], [/星期六|週六|周六|saturday/i, 6]];
  function to24(h, m, ap) {
    h = +h; m = m || '00';
    if (ap) { ap = ap.toUpperCase(); if (/P|下午|晚上/.test(ap) && h < 12) h += 12; if (/A|上午|凌晨/.test(ap) && h === 12) h = 0; }
    return String(h).padStart(2, '0') + ':' + m;
  }
  function parseGoogleWeek(lines) {
    if (!Array.isArray(lines) || !lines.length) return null;
    const week = Array(7).fill(''); let any = false;
    for (const line of lines) {
      const g = GDAY.find(([re]) => re.test(line)); if (!g) continue;
      const body = line.slice(line.search(/[:：]/) + 1);
      if (/休息|公休|closed|休業|定休/i.test(body)) { week[g[1]] = 'off'; any = true; continue; }
      if (/24\s*(小時|hours)/i.test(body)) { week[g[1]] = '00:00-24:00'; any = true; continue; }
      const re = /(上午|下午|晚上|凌晨)?\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM|上午|下午)?\s*[–\-~至到]\s*(上午|下午|晚上|凌晨)?\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM|上午|下午)?/gi;
      const out = []; let m;
      while ((m = re.exec(body))) {
        const apA = m[4] || m[1] || (m[8] && !m[4] ? m[8] : ''), apB = m[8] || m[5] || '';
        out.push(to24(m[2], m[3], apA) + '-' + to24(m[6], m[7], apB));
      }
      if (out.length) { week[g[1]] = out.join(', '); any = true; }
    }
    return any ? week : null;
  }
  /** 某天實際使用的營業時間：手動填的優先，否則用每週資料 */
  function hoursFor(p, iso) {
    if (p.hours) return p.hours;
    if (!p.hoursWeek || !iso) return '';
    const wd = new Date(iso + 'T12:00:00').getDay();
    return p.hoursWeek[wd] || '';
  }
  const WD = '日一二三四五六';
  function weekSummary(week) {
    if (!week) return '';
    const groups = [];
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const v = week[d] || '?';
      const last = groups[groups.length - 1];
      if (last && last.v === v) last.d.push(d); else groups.push({ v, d: [d] });
    });
    return groups.map((g) => (g.d.length > 2 ? WD[g.d[0]] + '–' + WD[g.d[g.d.length - 1]] : g.d.map((x) => WD[x]).join('、')) + ' ' + (g.v === 'off' ? '公休' : g.v === '?' ? '不明' : g.v)).join('；');
  }


  /* ---------- 地點照片 ---------- */
  const normName = (x) => String(x || '').toLowerCase().replace(/[\s·・\-_'’"“”()（）【】\[\]、,，.。!！?？:：]/g, '');
  /** 從維基百科查詢結果挑一張「真的是這個地點」的照片 */
  function wikiPick(json, place, opts) {
    opts = opts || {};
    const pages = json && json.query && json.query.pages ? Object.values(json.query.pages) : [];
    const want = normName(place.name);
    const cands = [];
    for (const pg of pages) {
      if (!pg.thumbnail || !/^https:\/\/upload\.wikimedia\.org\//.test(pg.thumbnail.source || '')) continue;
      if (/\.svg/i.test(pg.thumbnail.source) || /(logo|map|flag|地図|地圖|位置図)/i.test(pg.thumbnail.source)) continue;
      const co = pg.coordinates && pg.coordinates[0];
      const dist = co ? haversine(place, { lat: co.lat, lng: co.lon }) : null;
      const title = normName(pg.title);
      const nameHit = title && want && (title === want || (want.length >= 2 && (title.includes(want) || want.includes(title))));
      if (dist != null && dist > (opts.maxDist || 2500)) continue;
      if (dist == null && !(title === want)) continue;
      if (opts.geo ? dist == null : !(nameHit || (dist != null && dist < 400))) continue;
      const score = (nameHit ? 0 : 1000) + (dist != null ? dist : 500) + (pg.index || 0) * 10;
      cands.push({ score, url: pg.thumbnail.source, title: pg.title, link: pg.fullurl || '' });
    }
    cands.sort((a, b) => a.score - b.score);
    return cands[0] || null;
  }
  function wikiLangs(name) {
    if (/[぀-ヿ]/.test(name)) return ['ja', 'zh', 'en'];
    if (/[一-鿿]/.test(name)) return ['zh', 'ja', 'en'];
    return ['en', 'zh', 'ja'];
  }
  const PHOTO_GEO_CATS = ['temple', 'museum', 'castle', 'park', 'view', 'landmark', 'theme', 'zoo', 'beach', 'station', 'market', 'onsen'];
  function sanitizePhoto(ph) {
    if (!ph || typeof ph !== 'object') return null;
    if (ph.src === 'wiki' && /^https:\/\/upload\.wikimedia\.org\/[^\s"'<>()]+$/.test(ph.url || '')) {
      return { src: 'wiki', url: ph.url, link: /^https:\/\/[a-z]{2,3}\.(m\.)?wikipedia\.org\/[^\s"'<>]+$/.test(ph.link || '') ? ph.link : '' };
    }
    if (ph.src === 'google' && /^places\/[\w-]+\/photos\/[\w-]+$/.test(ph.name || '')) return { src: 'google', name: ph.name };
    return null;
  }


  /* ---------- 貼上文字行程（ChatGPT／部落格）→ 每天的地點 ---------- */
  const CN_NUM = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function cnToInt(x) {
    if (/^\d+$/.test(x)) return +x;
    if (x.length === 1) return CN_NUM[x] || 0;
    if (x[0] === '十') return 10 + (CN_NUM[x[1]] || 0);
    if (x[1] === '十') return (CN_NUM[x[0]] || 0) * 10 + (CN_NUM[x[2]] || 0);
    return 0;
  }
  const DAY_RE = /^[\s#>*_\-–—|]*(?:(?:day|d)\s*0?(\d{1,2})|第\s*([一二兩三四五六七八九十\d]{1,3})\s*[天日]|([一二兩三四五六七八九十]{1,3})日目|(\d{1,2})日目)(?![\d])\s*[:：.、\-–—)）]?\s*(.*)$/i;
  // 開頭的時間／時段標籤：「09:00」「上午：」「午餐：」「Morning:」「1.」「•」
  const LEAD_RE = /^(?:[\s>*•·・●○◆◇▪■□※\-–—+]|\d{1,2}[.)、]\s|[（(]?\d{1,2}[:：]\d{2}\s*(?:[ap]\.?m\.?)?(?:\s*[-–~〜至]\s*\d{1,2}[:：]\d{2}\s*(?:[ap]\.?m\.?)?)?[)）]?\s*[:：\-–—]?\s*|(?:早上|上午|中午|下午|傍晚|晚上|晚餐|午餐|早餐|宵夜|點心|下午茶|住宿|入住|夜晚|清晨|凌晨|全天|morning|afternoon|evening|night|lunch|dinner|breakfast|brunch|stay|hotel)\s*[:：\-–—]?\s*)+/i;
  const VERB_RE = /^(?:(?:參觀|参观|前往|抵達|抵达|到達|逛逛|遊覽|游览|造訪|拜訪|漫步|散步|欣賞|體驗|品嚐|品嘗|享用|搭乘|入住|到|去|逛|吃|喝|在|於|搭|住)\s*|(?:check[- ]?in at|visit(?:ing)?|explore|head to|go to|stroll (?:through|around)|walk (?:through|around)|enjoy|try|have (?:lunch|dinner|breakfast) at|lunch at|dinner at|breakfast at|stop by|at|in)\s+)/i;
  const SKIP_RE = /^(?:交通|tips?|小提醒|注意|備註|备注|預算|预算|費用|费用|建议|建議|note|budget|transport(?:ation)?|getting there|總結|总结|summary|行程概要|overview)\b|^(?:交通|小提醒|注意|備註|預算|費用|建議)/i;
  function cleanPlaceName(line) {
    let t = String(line).replace(/\*\*|__|`/g, '').trim();
    // 粗體優先：「**淺草寺**：…」→ 淺草寺
    const bold = String(line).match(/\*\*([^*]{2,40})\*\*/);
    if (bold && !LEAD_RE.test(bold[1] + ' ')) t = bold[1];
    t = t.replace(LEAD_RE, '').replace(VERB_RE, '').trim();
    t = t.replace(LEAD_RE, '').replace(VERB_RE, '').trim();
    // 去掉後面的說明：「淺草寺（雷門）- 早上人少」→ 淺草寺
    t = t.split(/\s[-–—|]\s|[：:]|[（(]|，|,|。|；|;|\s→|→/)[0].trim();
    // 英文後面的說明：「Fushimi Inari Shrine early to avoid crowds」
    t = t.split(/\s(?:early|to|for|then|before|after|while|which|where|with|if|and then|around|at night|in the (?:morning|afternoon|evening))\s/i)[0].trim();
    // 中文地名後面黏著的動作：「上野阿美橫丁逛街吃小吃」「築地場外市場吃海鮮早餐」
    const act = t.search(/(?:逛街|逛逛|吃|喝|買|購物|用餐|散步|休息|拍照|看夜景|看景|體驗|享用|品嚐|品嘗|參拜|泡湯)/);
    if (act >= 3) t = t.slice(0, act).trim();
    t = t.replace(/[\s.。、]+$/, '').replace(/^(?:the)\s+/i, '');
    return t;
  }
  function parseItineraryText(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const days = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(DAY_RE);
      if (m) {
        const n = +(m[1] || m[4] || 0) || cnToInt(m[2] || m[3] || '');
        if (n >= 1 && n <= 60) {
          cur = { day: n, title: (m[5] || '').replace(/\*\*/g, '').trim(), items: [] };
          days.push(cur);
          // 標題同一行列出多個地點：「Day 1：淺草寺 → 晴空塔 → 上野」
          const rest = (m[5] || '').replace(/\*\*/g, '');
          if (/→|->|➜|、/.test(rest) && rest.length < 120) {
            rest.split(/→|->|➜|、/).map(cleanPlaceName).filter((x) => x.length >= 2).forEach((name) => cur.items.push({ name, raw: rest }));
            cur.title = '';
          }
          continue;
        }
      }
      if (!cur) continue;
      if (SKIP_RE.test(line.replace(/^[\s>*•·・\-–—#\d.)]+/, ''))) continue;
      const isBullet = /^(?:[>*•·・●○◆◇▪■□※\-–—+]|\d{1,2}[.)、]|\d{1,2}[:：]\d{2}|[（(]\d{1,2}[:：])/.test(line) || LEAD_RE.test(line);
      if (!isBullet && line.length > 40) continue; // 一般敘述段落
      const parts = /→|->|➜/.test(line) ? line.split(/→|->|➜/) : [line];
      for (const part of parts) {
        const name = cleanPlaceName(part);
        if (name.length < 2 || name.length > 40) continue;
        if (/^(?:自由活動|休息|返回|回飯店|回到飯店|回酒店|飯店|酒店|機場|搭機|返程|出發|集合|free time|rest|return|back to (?:the )?hotel)$/i.test(name)) continue;
        if (/^(?:回|返回|回到)(?:飯店|酒店|旅館|住宿|民宿)|^(?:return|head back|back) to (?:the )?(?:hotel|airport)/i.test(name)) continue;
        if (cur.items.some((x) => x.name === name)) continue;
        cur.items.push({ name, raw: line.slice(0, 120) });
      }
    }
    return days.filter((d) => d.items.length).sort((a, b) => a.day - b.day);
  }


  /* ---------- 預訂（機票、住宿、交通、票券） ---------- */
  const BOOK_TYPES = {
    flight: { label: '機票', icon: 'c_airport' }, hotel: { label: '住宿', icon: 'hotel' }, train: { label: '火車／高鐵', icon: 'c_station' },
    bus: { label: '巴士', icon: 'bus' }, car: { label: '租車', icon: 'car' }, ticket: { label: '門票／活動', icon: 'ticket' },
    restaurant: { label: '餐廳訂位', icon: 'c_food' }, other: { label: '其他', icon: 'text' },
  };
  const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
  const isTime = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x || '');
  function sanitizeBooking(b) {
    if (!b || typeof b !== 'object') return null;
    const s2 = (v, n) => String(v == null ? '' : v).slice(0, n);
    const out = {
      id: /^[a-z0-9]{4,40}$/i.test(b.id || '') ? b.id : uid(), type: BOOK_TYPES[b.type] ? b.type : 'other',
      title: s2(b.title, 120), date: isDate(b.date) ? b.date : '', time: isTime(b.time) ? b.time : '',
      endDate: isDate(b.endDate) ? b.endDate : '', endTime: isTime(b.endTime) ? b.endTime : '',
      from: s2(b.from, 80), to: s2(b.to, 80), code: s2(b.code, 60), note: s2(b.note, 1000),
      cost: Number.isFinite(+b.cost) && +b.cost > 0 ? Math.min(1e9, +b.cost) : 0,
      link: /^https:\/\/[^\s"'<>]+$/.test(b.link || '') ? s2(b.link, 500) : '',
    };
    return out.title || out.code || out.from ? out : null;
  }
  /** 某天要顯示的預訂：當天開始的，以及住宿的退房日 */
  function bookingsOn(trip, iso) {
    if (!iso) return [];
    const out = [];
    for (const b of trip.bookings || []) {
      if (b.date === iso) out.push({ b, kind: b.type === 'hotel' ? 'in' : 'start' });
      else if (b.type === 'hotel' && b.endDate === iso) out.push({ b, kind: 'out' });
      else if (b.type === 'car' && b.endDate === iso) out.push({ b, kind: 'out' });
    }
    return out.sort((x, y) => ((x.kind === 'out' ? x.b.endTime : x.b.time) || '99').localeCompare((y.kind === 'out' ? y.b.endTime : y.b.time) || '99'));
  }

  /* ---------- 分帳 ---------- */
  function sanitizeExpense(e, members) {
    if (!e || typeof e !== 'object') return null;
    const amount = +e.amount;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const split = (Array.isArray(e.split) ? e.split : []).filter((n) => members.includes(n));
    return {
      id: /^[a-z0-9]{4,40}$/i.test(e.id || '') ? e.id : uid(), title: String(e.title || '').slice(0, 80) || '支出',
      amount: Math.min(1e9, Math.round(amount * 100) / 100), payer: members.includes(e.payer) ? e.payer : members[0],
      split: split.length ? split : members.slice(), date: isDate(e.date) ? e.date : '',
    };
  }
  /** 算每人淨額，並用「最大債務人配最大債權人」得出最少轉帳 */
  function settle(members, expenses) {
    const bal = Object.fromEntries(members.map((m) => [m, 0]));
    const paid = Object.fromEntries(members.map((m) => [m, 0]));
    const share = Object.fromEntries(members.map((m) => [m, 0]));
    for (const e of expenses) {
      if (!(e.payer in bal)) continue;
      const who = e.split.filter((n) => n in bal);
      if (!who.length) continue;
      // 以分（0.01）為單位平均分攤，餘數給前幾個人，總和不會差
      const cents = Math.round(e.amount * 100), per = Math.floor(cents / who.length);
      let rem = cents - per * who.length;
      paid[e.payer] += cents;
      who.forEach((n) => { const c = per + (rem > 0 ? 1 : 0); if (rem > 0) rem--; share[n] += c; });
    }
    members.forEach((m) => { bal[m] = paid[m] - share[m]; });
    const cred = members.filter((m) => bal[m] > 0).map((m) => [m, bal[m]]).sort((a, b) => b[1] - a[1]);
    const debt = members.filter((m) => bal[m] < 0).map((m) => [m, -bal[m]]).sort((a, b) => b[1] - a[1]);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const x = Math.min(debt[i][1], cred[j][1]);
      if (x > 0) transfers.push({ from: debt[i][0], to: cred[j][0], amount: x / 100 });
      debt[i][1] -= x; cred[j][1] -= x;
      if (debt[i][1] === 0) i++;
      if (cred[j][1] === 0) j++;
    }
    const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / 100]));
    return { paid: f(paid), share: f(share), balance: f(bal), transfers, total: Object.values(paid).reduce((a, b) => a + b, 0) / 100 };
  }

  /* ---------- 行程資料 ---------- */
  const PALETTE = ['#b0533b', '#3f6e78', '#6b7a35', '#7d4f7a', '#b4862f', '#9a4558', '#3c5a86', '#5f7f68', '#8a6a4b', '#6e6a5c'];
  const THEMES = ['auto', 'clean', 'night', 'parchment', 'relic', 'neon', 'washi', 'tide'];
  const dayColor = (d) => (d > 0 ? PALETTE[(d - 1) % PALETTE.length] : '#8a8370');

  function newTrip(name) {
    return { id: uid(), name: name || '我的旅程', days: 3, startDate: '', dayStart: '09:00', theme: 'auto', currency: '', base: null, places: [], legModes: {}, checklist: [], bookings: [], members: ['我'], expenses: [], updatedAt: Date.now() };
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
      cat: CATS[p.cat] ? p.cat : guessCat(p.name, p.address),
      done: !!p.done, hours: s(p.hours, 60),
      hoursWeek: Array.isArray(p.hoursWeek) && p.hoursWeek.length === 7 ? p.hoursWeek.map((x) => s(x, 60)) : null,
      photo: sanitizePhoto(p.photo), photoTry: Number.isFinite(+p.photoTry) ? +p.photoTry : 0, cost: Number.isFinite(+p.cost) && +p.cost > 0 ? Math.min(1e9, +p.cost) : 0,
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
    const hhmm = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : '');
    out.arrive = t.arrive ? sanitizePlace({ ...t.arrive, id: 'arrive', day: 0, cat: 'airport' }) : null;
    out.depart = t.depart ? sanitizePlace({ ...t.depart, id: 'depart', day: 0, cat: 'airport' }) : null;
    out.arriveTime = out.arrive ? hhmm(t.arriveTime) : '';
    out.departTime = out.depart ? hhmm(t.departTime) : '';
    out.dayBase = {};
    if (t.dayBase && typeof t.dayBase === 'object') {
      for (const [k, v] of Object.entries(t.dayBase)) {
        const d = parseInt(k, 10);
        if (d >= 1 && d <= 60 && v) { const sp = sanitizePlace({ ...v, id: 'base-' + d, day: 0, cat: 'hotel' }); if (sp) out.dayBase[d] = sp; }
      }
    }
    out.places = (Array.isArray(t.places) ? t.places : []).map(sanitizePlace).filter(Boolean).slice(0, 5000);
    out.legModes = {};
    if (t.legModes && typeof t.legModes === 'object') {
      for (const [k, v] of Object.entries(t.legModes)) if (MODES[v]) out.legModes[String(k).slice(0, 90)] = v;
    }
    out.theme = THEMES.includes(t.theme) ? t.theme : 'auto';
    out.currency = String(t.currency || '').replace(/[^A-Za-z$¥€£₩NT]/g, '').slice(0, 5);
    out.checklist = (Array.isArray(t.checklist) ? t.checklist : []).filter((c) => c && typeof c.t === 'string').slice(0, 300)
      .map((c) => ({ t: c.t.slice(0, 200), done: !!c.done, g: String(c.g || '').slice(0, 30) }));
    out.bookings = (Array.isArray(t.bookings) ? t.bookings : []).map(sanitizeBooking).filter(Boolean).slice(0, 300);
    const mem = (Array.isArray(t.members) ? t.members : []).map((m) => String(m || '').trim().slice(0, 20)).filter(Boolean);
    out.members = [...new Set(mem)].slice(0, 20);
    if (!out.members.length) out.members = ['我'];
    out.expenses = (Array.isArray(t.expenses) ? t.expenses : []).map((e) => sanitizeExpense(e, out.members)).filter(Boolean).slice(0, 2000);
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

  /** Apple 地圖：d 開車、w 步行、r 大眾運輸、c 單車 */
  function appleDirUrl(a, b, mode) {
    const f = { walk: 'w', bike: 'c', drive: 'd', transit: 'r' }[mode] || 'r';
    return 'https://maps.apple.com/?saddr=' + a.lat + ',' + a.lng + '&daddr=' + b.lat + ',' + b.lng + '&dirflg=' + f;
  }
  function applePlaceUrl(p) {
    return 'https://maps.apple.com/?ll=' + p.lat + ',' + p.lng + '&q=' + encodeURIComponent(p.name || '');
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
  /** 第 d 晚住哪：每天自訂的住宿，沒設就用預設住宿 */
  function nightHotel(trip, d) { return (trip.dayBase && trip.dayBase[d]) || trip.base || null; }
  /** 第 d 天從哪出發、回到哪：前一晚的住宿 → 今晚的住宿 */
  function dayEnds(trip, d) {
    const days = Math.max(1, trip.days | 0);
    let end = nightHotel(trip, d);
    let start = d > 1 ? nightHotel(trip, d - 1) || end : nightHotel(trip, 1);
    // 去程：第 1 天從抵達機場出發；回程：最後一天結束在出發機場
    if (d === 1 && trip.arrive) start = trip.arrive;
    if (d === days && trip.depart) end = trip.depart;
    return { start, end };
  }
  const CLEAR_MIN = 60;   // 落地到出關
  const CHECKIN_MIN = 120; // 起飛前要到機場
  /** 第 d 天幾點出門：第 1 天有抵達時間 → 落地 + 1 小時 */
  function dayStartTime(trip, d) {
    if (d === 1 && trip.arrive && trip.arriveTime) return hm(toMin(trip.arriveTime) + CLEAR_MIN);
    return trip.dayStart || '09:00';
  }
  /** 最後一天最晚要到機場的時間（分鐘），沒設回程班機則 null */
  function departDeadline(trip) {
    return trip.depart && trip.departTime ? toMin(trip.departTime) - CHECKIN_MIN : null;
  }
  const multiHotel = (trip) => !!trip.dayBase && Object.keys(trip.dayBase).some((k) => trip.dayBase[k]);

  const range0 = (n) => Array.from({ length: n }, (_, i) => i);
  function planDays(trip) {
    const days = Math.max(1, trip.days | 0);
    const places = trip.places.map((p) => ({ ...p }));
    const free = places.filter((p) => !(p.locked && p.day >= 1 && p.day <= days));
    const lockedCount = new Array(days).fill(0);
    places.forEach((p) => { if (p.locked && p.day >= 1 && p.day <= days) lockedCount[p.day - 1]++; });
    const total = places.length;
    // 每天可用時間：抵達日（落地後才開始）、回程日（要提早到機場）會比較短
    const normal = Math.max(240, 20 * 60 - toMin(trip.dayStart || '09:00'));
    const w = Array.from({ length: days }, (_, d) => {
      let avail = normal;
      if (d === 0 && trip.arrive && trip.arriveTime) avail = Math.min(avail, 20 * 60 - toMin(dayStartTime(trip, 1)));
      const dl = departDeadline(trip);
      if (d === days - 1 && dl != null) avail = Math.min(avail, dl - 60 - toMin(dayStartTime(trip, days)));
      return Math.max(0.15, Math.min(1, avail / normal));
    });
    const sw = w.reduce((a, b) => a + b, 0);
    const caps = lockedCount.map((c, d) => Math.max(0, Math.ceil(total * w[d] / sw) - c));
    // 容量總和不足時補足
    let deficit = free.length - caps.reduce((a, b) => a + b, 0);
    for (let j = 0; deficit > 0; j = (j + 1) % days) { caps[j]++; deficit--; }

    if (free.length && multiHotel(trip)) {
      // 多城市：先把「起終點相近」的天數合成一組，地點分到最近的一組，組內再平均分天
      const anchors = Array.from({ length: days }, (_, d) => {
        const e = dayEnds(trip, d + 1);
        return e.start && e.end ? centroid([e.start, e.end]) : e.end || e.start;
      });
      const groups = [];
      anchors.forEach((a, d) => {
        const g = a && groups.find((x) => x.anchor && haversine(x.anchor, a) < 5000);
        if (g) g.days.push(d); else groups.push({ anchor: a, days: [d] });
      });
      const gCap = groups.map((g) => Math.ceil(g.days.reduce((s2, d) => s2 + caps[d], 0) * 1.4) + 1);
      const gCnt = groups.map(() => 0);
      const gOf = new Array(free.length);
      const ord = free.map((p, i) => {
        const ds = groups.map((g) => (g.anchor ? haversine(p, g.anchor) : 1e12)).sort((x, y) => x - y);
        return { i, regret: (ds[1] || 0) - ds[0] };
      }).sort((x, y) => y.regret - x.regret);
      for (const { i } of ord) {
        const ranked = groups.map((g, gi) => ({ gi, dist: g.anchor ? haversine(free[i], g.anchor) : 1e12 })).sort((x, y) => x.dist - y.dist);
        const pick = ranked.find((r) => gCnt[r.gi] < gCap[r.gi]) || ranked[0];
        gOf[i] = pick.gi; gCnt[pick.gi]++;
      }
      groups.forEach((g, gi) => {
        const pts = free.filter((_, i) => gOf[i] === gi);
        if (!pts.length) return;
        if (g.days.length === 1) { pts.forEach((p) => { p.day = g.days[0] + 1; }); return; }
        const k = Math.min(g.days.length, pts.length);
        const per = Math.ceil(pts.length / k);
        const asg = balancedClusters(pts, k, Array(k).fill(per));
        const cl = [...new Set(asg)];
        const cents = cl.map((c) => centroid(pts.filter((_, i) => asg[i] === c)));
        // 依各天起點遠近配對：離前一晚住宿近的群組排前面
        const used = new Set(); const mapD = {};
        g.days.forEach((d) => {
          const st = dayEnds(trip, d + 1).start || g.anchor;
          let best = -1, bd = Infinity;
          cl.forEach((c, ci) => { if (!used.has(c)) { const dd = st ? haversine(st, cents[ci]) : ci; if (dd < bd) { bd = dd; best = c; } } });
          if (best !== -1) { used.add(best); mapD[best] = d; }
        });
        pts.forEach((p, i) => { p.day = (mapD[asg[i]] != null ? mapD[asg[i]] : g.days[0]) + 1; });
      });
    } else if (free.length) {
      const assign = balancedClusters(free, Math.min(days, free.length), caps.slice(0, Math.min(days, free.length)));
      // 把群組對應到天數：有鎖定點的天數優先配最接近的群組
      const groups = [...new Set(assign)];
      const gCent = groups.map((g) => centroid(free.filter((_, i) => assign[i] === g)));
      const dayCent = Array.from({ length: days }, (_, d) => {
        const lk = places.filter((p) => p.locked && p.day === d + 1);
        if (lk.length) return centroid(lk);
        if (d === 0 && trip.arrive && days > 1) return trip.arrive;
        if (d === days - 1 && trip.depart && days > 1) return trip.depart;
        return null;
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
      // 群組大小與當天容量不一定吻合（抵達日／回程日較短）：把超量的點移到最近、還有空位的天
      const cnt = (d) => places.filter((p) => p.day === d).length;
      const cap = (d) => caps[d - 1] + lockedCount[d - 1];
      for (let guard = 0; guard < free.length * 2; guard++) {
        let over = 0;
        for (let d = 1; d <= days; d++) if (cnt(d) > cap(d)) { over = d; break; }
        if (!over) break;
        const cents = range0(days).map((d) => { const ps = places.filter((p) => p.day === d + 1); return ps.length ? centroid(ps) : null; });
        let best = null, bc = Infinity;
        for (const p of free) {
          if (p.day !== over) continue;
          for (let d = 1; d <= days; d++) {
            if (d === over || cnt(d) >= cap(d)) continue;
            const c = cents[d - 1] || p;
            const cost = haversine(p, c) - haversine(p, cents[over - 1]);
            if (cost < bc) { bc = cost; best = [p, d]; }
          }
        }
        if (!best) break;
        best[0].day = best[1];
      }
    }
    // 每天排序
    for (let d = 1; d <= days; d++) {
      const pts = places.filter((p) => p.day === d);
      const e = dayEnds(trip, d);
      const seq = orderStops(pts, e.start, e.end);
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


  /* ---------- 附近搜尋（OpenStreetMap Overpass） ---------- */
  const NEARBY = {
    food: { label: '餐廳', cat: 'food', q: ['nwr["amenity"~"^(restaurant|fast_food|food_court)$"]'] },
    cafe: { label: '咖啡甜點', cat: 'cafe', q: ['nwr["amenity"~"^(cafe|ice_cream)$"]', 'nwr["shop"~"^(bakery|confectionery|pastry)$"]'] },
    konbini: { label: '便利商店', cat: 'shopping', q: ['nwr["shop"="convenience"]'] },
    station: { label: '車站', cat: 'station', q: ['nwr["railway"~"^(station|halt)$"]', 'nwr["public_transport"="station"]'] },
    toilet: { label: '廁所', cat: 'other', q: ['nwr["amenity"="toilets"]'] },
    atm: { label: 'ATM／銀行', cat: 'other', q: ['nwr["amenity"~"^(atm|bank)$"]'] },
    sight: { label: '景點', cat: 'landmark', q: ['nwr["tourism"~"^(attraction|museum|viewpoint|gallery)$"]', 'nwr["historic"]["name"]'] },
  };
  function overpassQuery(kind, lat, lng, radius) {
    const k = NEARBY[kind]; if (!k) throw new Error('unknown kind');
    const around = '(around:' + Math.round(radius) + ',' + lat.toFixed(6) + ',' + lng.toFixed(6) + ')';
    return '[out:json][timeout:15];(' + k.q.map((x) => x + around + ';').join('') + ');out center 80;';
  }
  function parseOverpass(json, origin, kind) {
    const k = NEARBY[kind] || {};
    const seen = new Set();
    const out = [];
    for (const e of (json && json.elements) || []) {
      const tg = e.tags || {};
      const lat = e.lat != null ? e.lat : e.center && e.center.lat;
      const lng = e.lon != null ? e.lon : e.center && e.center.lon;
      if (!validLatLng(lat, lng)) continue;
      const name = tg['name:zh-Hant'] || tg['name:zh_hant'] || tg['name:zh-TW'] || tg['name:zh'] || tg.name || tg['name:ja'] || tg['name:en'] ||
        (kind === 'toilet' ? '公共廁所' : kind === 'atm' ? (tg.operator || 'ATM') : '');
      if (!name) continue;
      const key = name + '@' + lat.toFixed(4) + ',' + lng.toFixed(4);
      if (seen.has(key)) continue; seen.add(key);
      const sub = [tg.cuisine && tg.cuisine.replace(/;/g, '、'), tg.brand && tg.brand !== name ? tg.brand : '', tg.opening_hours ? tg.opening_hours : ''].filter(Boolean).join(' · ');
      out.push({ name, lat, lng, dist: haversine(origin, { lat, lng }), sub, hours: tg.opening_hours || '', hoursWeek: parseOSMHours(tg.opening_hours), cat: kind === 'sight' ? guessCat(name) === 'other' ? 'landmark' : guessCat(name) : k.cat || 'other' });
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, 40);
  }

  /* ---------- 票價 ---------- */
  function fmtFare(f) {
    if (!f || !f.currencyCode) return '';
    const v = (+f.units || 0) + (+f.nanos || 0) / 1e9;
    const sym = { JPY: '¥', TWD: 'NT$', USD: 'US$', EUR: '€', GBP: '£', KRW: '₩', HKD: 'HK$', CNY: '¥', THB: '฿', SGD: 'S$' }[f.currencyCode] || f.currencyCode + ' ';
    return sym + (v % 1 ? v.toFixed(2) : v.toLocaleString('en-US'));
  }

  /* ---------- 行事曆匯出（.ics，當地時間） ---------- */
  function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsFold(line) {
    const out = []; let cur = '';
    for (const ch of line) {
      if (new TextEncoder().encode(cur + ch).length > 73) { out.push(cur); cur = ' ' + ch; } else cur += ch;
    }
    out.push(cur); return out.join('\r\n');
  }
  /** events: [{date:'YYYY-MM-DD', start: min, end: min, title, location, desc, lat, lng, uid}] */
  function buildICS(name, events) {
    const pad = (n) => String(n).padStart(2, '0');
    const dt = (date, min) => {
      const d = new Date(date + 'T00:00:00'); d.setMinutes(Math.round(min));
      return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
    };
    const now = new Date();
    const stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + '00Z';
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//trip-map//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEscape(name)];
    for (const e of events) {
      L.push('BEGIN:VEVENT', 'UID:' + e.uid + '@trip-map', 'DTSTAMP:' + stamp, 'DTSTART:' + dt(e.date, e.start), 'DTEND:' + dt(e.date, Math.max(e.end, e.start + 5)),
        'SUMMARY:' + icsEscape(e.title));
      if (e.location) L.push('LOCATION:' + icsEscape(e.location));
      if (e.lat != null) L.push('GEO:' + e.lat.toFixed(6) + ';' + e.lng.toFixed(6));
      if (e.desc) L.push('DESCRIPTION:' + icsEscape(e.desc));
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
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
      db: t.dayBase && Object.keys(t.dayBase).length ? Object.fromEntries(Object.entries(t.dayBase).map(([d, v]) => [d, [v.name, +v.lat.toFixed(6), +v.lng.toFixed(6)]])) : undefined,
      p: t.places.map((p) => [p.name, +p.lat.toFixed(6), +p.lng.toFixed(6), p.day, p.order, p.note || 0, p.locked ? 1 : 0, p.stay === 60 ? 0 : p.stay, p.url && p.url.length < 300 ? p.url : 0, p.cat || 0, p.hours || 0, p.cost || 0, p.done ? 1 : 0, p.hoursWeek || 0, p.photo && p.photo.src === 'wiki' ? [p.photo.url, p.photo.link] : 0]),
      th: t.theme && t.theme !== 'auto' ? t.theme : undefined, cu: t.currency || undefined,
      cl: t.checklist && t.checklist.length ? t.checklist.map((c) => [c.t, c.done ? 1 : 0, c.g || 0]) : undefined,
      bk: t.bookings && t.bookings.length ? t.bookings.map((b) => { const o = {}; for (const [k, v] of Object.entries(b)) if (v && k !== 'id') o[k] = v; return o; }) : undefined,
      mb: t.members && (t.members.length > 1 || t.members[0] !== '我') ? t.members : undefined,
      ex: t.expenses && t.expenses.length ? t.expenses.map((e) => [e.title, e.amount, e.payer, e.split.length === t.members.length ? 0 : e.split, e.date || 0]) : undefined,
      m: packModes(t),
    };
  }
  function packModes(t) {
    const idx = { base: 'b' };
    Object.keys(t.dayBase || {}).forEach((d) => { idx['base-' + d] = 'b' + d; });
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
    t.days = o.d; t.startDate = o.s || ''; t.dayStart = o.h || '09:00'; t.theme = o.th || 'auto'; t.currency = o.cu || '';
    t.checklist = (o.cl || []).map((c) => ({ t: c[0], done: !!c[1], g: c[2] || '' }));
    t.bookings = o.bk || [];
    t.members = o.mb || ['我'];
    t.expenses = (o.ex || []).map((e) => ({ title: e[0], amount: e[1], payer: e[2], split: e[3] || t.members.slice(), date: e[4] || '' }));
    if (o.b) t.base = { name: o.b[0], lat: o.b[1], lng: o.b[2] };
    if (o.db) t.dayBase = Object.fromEntries(Object.entries(o.db).map(([d, v]) => [d, { name: v[0], lat: v[1], lng: v[2] }]));
    const idMap = [];
    t.places = (o.p || []).map((a, i) => {
      const id = 'p' + i.toString(36);
      idMap.push(id);
      return { id, name: a[0], lat: a[1], lng: a[2], day: a[3], order: a[4], note: a[5] || '', locked: !!a[6], stay: a[7] || 60, url: a[8] || '', cat: a[9] || '', hours: a[10] || '', cost: a[11] || 0, done: !!a[12], hoursWeek: a[13] || null, photo: a[14] ? { src: 'wiki', url: a[14][0], link: a[14][1] } : null, photoTry: a[14] ? 1 : 0 };
    });
    t.legModes = {};
    for (const [k, v] of Object.entries(o.m || {})) {
      const [a, b] = k.split('>').map((x) => (x === 'b' ? 'base' : /^b\d+$/.test(x) ? 'base-' + x.slice(1) : idMap[+x]));
      if (a && b) t.legModes[a + '>' + b] = v;
    }
    return sanitizeTrip(t);
  }

  /** 金鑰只留 API key 合法字元（手機貼上常混入全形字、空白、零寬字元） */
  function cleanKey(k) {
    return String(k || '').normalize('NFKC').replace(/[^A-Za-z0-9_\-]/g, '');
  }

  return {
    haversine, validLatLng, uid, fmtDist, fmtDur, parseGoogleMapsUrl, parseCSV, parseImport,
    cleanKey, parseGeoJSON, parseTakeoutCSV, parseKML, newTrip, sanitizeTrip, sanitizePlace, mergePlaces,
    MODES, estimateLeg, suggestMode, gmapsDirUrl, gmapsPlaceUrl, gmapsDayUrl, appleDirUrl, applePlaceUrl, timeline, hm, toMin, centroid, balancedClusters,
    orderStops, planDays, pathLen, dayStops, legKey, parseOsrm, decodePolyline, parseGoogleRoute,
    b64urlEncode, b64urlDecode, packTrip, unpackTrip, dayColor, PALETTE, CATS, guessCat, catFromGoogleType, parseHours, hoursWarning, THEMES, NEARBY, overpassQuery, parseOverpass, fmtFare, buildICS, CAT_COLOR, BOOK_TYPES, sanitizeBooking, bookingsOn, sanitizeExpense, settle, parseItineraryText, cleanPlaceName, wikiPick, wikiLangs, PHOTO_GEO_CATS, sanitizePhoto, parseOSMHours, parseGoogleWeek, hoursFor, weekSummary, nightHotel, dayEnds, multiHotel, dayStartTime, departDeadline, CLEAR_MIN, CHECKIN_MIN,
  };
});
