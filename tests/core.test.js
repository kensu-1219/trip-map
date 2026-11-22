// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');

const near = (a, b, tol = 1e-4) => Math.abs(a - b) < tol;

test('haversine：東京車站→淺草寺 約 4.9 km', () => {
  const d = C.haversine({ lat: 35.681236, lng: 139.767125 }, { lat: 35.714765, lng: 139.796655 });
  assert.ok(d > 4500 && d < 5200, d);
});

test('Google 網址：place 連結取 !3d!4d 而非 @ 視窗中心', () => {
  const u = 'https://www.google.com/maps/place/%E6%B7%BA%E8%8D%89%E5%AF%BA/@35.7147651,139.7940803,17z/data=!3m1!4b1!4m6!3m5!1s0x60188ec1c3a1f1b9:0x1!8m2!3d35.7147651!4d139.7966552!16zL20vMDJ3ZDZ6';
  const r = C.parseGoogleMapsUrl(u);
  assert.equal(r.name, '淺草寺');
  assert.ok(near(r.lat, 35.7147651) && near(r.lng, 139.7966552));
  assert.ok(!r.approx);
});

test('Google 網址：@ 視窗中心標記為 approx', () => {
  const r = C.parseGoogleMapsUrl('https://www.google.com/maps/@34.6937,135.5023,15z');
  assert.ok(r.approx && near(r.lat, 34.6937));
});

test('Google 網址：?q=lat,lng / api=1 query / search 路徑 / 純座標', () => {
  assert.ok(near(C.parseGoogleMapsUrl('https://maps.google.com/?q=48.8584,2.2945').lat, 48.8584));
  assert.ok(near(C.parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=13.7563,100.5018').lng, 100.5018));
  assert.ok(near(C.parseGoogleMapsUrl('https://www.google.com/maps/search/35.0116,+135.7681').lat, 35.0116));
  const p = C.parseGoogleMapsUrl('  35.6586, 139.7454 ');
  assert.ok(near(p.lat, 35.6586) && near(p.lng, 139.7454));
});

test('Google 網址：短網址回傳 short，保留分享文字中的店名', () => {
  const r = C.parseGoogleMapsUrl('一蘭 拉麵 新宿店\nhttps://maps.app.goo.gl/AbCdEf123');
  assert.equal(r.short, true);
  assert.equal(r.name, '一蘭 拉麵 新宿店');
});

test('Google 網址：只有名稱的查詢回傳 nameOnly；非地圖網址回傳 null', () => {
  assert.equal(C.parseGoogleMapsUrl('https://www.google.com/maps/search/?api=1&query=%E6%B8%85%E6%B0%B4%E5%AF%BA').nameOnly, '清水寺');
  assert.equal(C.parseGoogleMapsUrl('https://example.com/abc'), null);
  assert.equal(C.parseGoogleMapsUrl('隨便一段字'), null);
  assert.equal(C.parseGoogleMapsUrl('0,0'), null);
  assert.equal(C.parseGoogleMapsUrl('95,200'), null);
});

test('CSV：處理 BOM、引號內逗號與換行', () => {
  const rows = C.parseCSV('﻿Title,Note\r\n"a, b","line1\nline2"\r\n"he said ""hi""",x\n');
  assert.deepEqual(rows, [['Title', 'Note'], ['a, b', 'line1\nline2'], ['he said "hi"', 'x']]);
});

test('Takeout 已儲存清單 CSV：有座標的直接取，沒有的留待地名查詢', () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures', '想去的地點.csv'), 'utf8');
  const r = C.parseImport('想去的地點.csv', csv);
  assert.equal(r.kind, 'csv');
  assert.equal(r.places.length, 4);
  const withCoord = r.places.filter((p) => p.lat != null);
  assert.equal(withCoord.length, 2);
  assert.ok(r.places.some((p) => p.name === '東京晴空塔' && p.lat == null));
});

test('Takeout 已加星號 GeoJSON（新舊兩種欄位）', () => {
  const j = fs.readFileSync(path.join(__dirname, 'fixtures', 'Saved Places.json'), 'utf8');
  const r = C.parseImport('Saved Places.json', j);
  assert.equal(r.kind, 'geojson');
  assert.equal(r.places.length, 3);
  assert.equal(r.places[0].name, '伏見稻荷大社');
  assert.ok(near(r.places[0].lat, 34.9671));
  assert.equal(r.places[2].lat, undefined); // 0,0 座標 → 需地名查詢
});

test('My Maps KML', () => {
  const k = fs.readFileSync(path.join(__dirname, 'fixtures', '京都 My Maps.kml'), 'utf8');
  const r = C.parseImport('京都 My Maps.kml', k);
  assert.equal(r.places.length, 2);
  assert.equal(r.places[1].name, '金閣寺 & 庭園');
  assert.ok(near(r.places[1].lng, 135.7292));
});

test('壞檔：空檔、截斷 JSON、亂碼、錯誤 CSV 都丟出中文錯誤', () => {
  assert.throws(() => C.parseImport('a.json', ''), /空的/);
  assert.throws(() => C.parseImport('a.json', '{"type":"FeatureCollection","features":[{"type":'), /JSON 格式錯誤/);
  assert.throws(() => C.parseImport('a.json', '{"foo":1}'), /看不懂/);
  assert.throws(() => C.parseImport('a.csv', 'foo,bar\n1,2'), /Title/);
  assert.throws(() => C.parseImport('a.bin', '\u0000\u0001\u0002'), /不支援/);
  assert.throws(() => C.parseImport('a.kml', '<kml></kml>'), /沒有找到/);
});

test('大檔：5000 筆 GeoJSON 解析 < 1 秒', () => {
  const feats = Array.from({ length: 5000 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [139 + (i % 100) / 100, 35 + Math.floor(i / 100) / 100] }, properties: { Title: '地點' + i } }));
  const t0 = Date.now();
  const r = C.parseImport('big.json', JSON.stringify({ type: 'FeatureCollection', features: feats }));
  assert.equal(r.places.length, 5000);
  assert.ok(Date.now() - t0 < 1000);
});

test('mergePlaces：同名 80m 內去重', () => {
  const a = [C.sanitizePlace({ name: 'A', lat: 35, lng: 139 })];
  const r = C.mergePlaces(a, [{ name: 'A', lat: 35.0003, lng: 139 }, { name: 'B', lat: 35.01, lng: 139 }]);
  assert.equal(r.added.length, 1);
  assert.equal(r.dup.length, 1);
});

function sampleTrip() {
  const t = C.newTrip('測試');
  // 東京：淺草群、澀谷群、台場群
  const pts = [
    ['淺草寺', 35.7148, 139.7967], ['晴空塔', 35.7101, 139.8107], ['上野公園', 35.7156, 139.7745],
    ['澀谷十字路口', 35.6595, 139.7005], ['明治神宮', 35.6764, 139.6993], ['原宿竹下通', 35.6716, 139.7031],
    ['台場鋼彈', 35.6251, 139.7756], ['teamLab', 35.6491, 139.7898], ['豐洲市場', 35.6455, 139.7841],
  ];
  t.places = pts.map(([name, lat, lng]) => C.sanitizePlace({ name, lat, lng }));
  t.days = 3;
  return t;
}

test('planDays：9 點 3 天依地理分群，每天 3 點', () => {
  const t = sampleTrip();
  t.places = C.planDays(t);
  const byDay = [1, 2, 3].map((d) => t.places.filter((p) => p.day === d).map((p) => p.name).sort());
  assert.ok(byDay.every((g) => g.length === 3), JSON.stringify(byDay));
  const groups = byDay.map((g) => g.join());
  assert.ok(groups.includes(['上野公園', '晴空塔', '淺草寺'].sort().join()), JSON.stringify(byDay));
  assert.ok(groups.includes(['原宿竹下通', '明治神宮', '澀谷十字路口'].sort().join()), JSON.stringify(byDay));
});

test('planDays：鎖定的點維持原天數；結果是決定性的', () => {
  const t = sampleTrip();
  t.places[0].day = 3; t.places[0].locked = true; // 淺草寺鎖第 3 天
  const r1 = C.planDays(t), r2 = C.planDays(t);
  assert.equal(r1.find((p) => p.name === '淺草寺').day, 3);
  assert.deepEqual(r1.map((p) => p.day), r2.map((p) => p.day));
  const d3 = r1.filter((p) => p.day === 3).map((p) => p.name);
  assert.ok(d3.includes('晴空塔'), d3.join());
});

test('orderStops：2-opt 後路徑不比輸入順序長', () => {
  const t = sampleTrip();
  const shuffled = [t.places[3], t.places[0], t.places[6], t.places[1], t.places[4]];
  const seq = C.orderStops(shuffled, null, null);
  assert.ok(C.pathLen(seq) <= C.pathLen(shuffled));
  assert.equal(seq.length, 5);
});

test('planDays：大量 1000 點 10 天 < 3 秒', () => {
  const t = C.newTrip('big');
  t.days = 10;
  t.places = Array.from({ length: 1000 }, (_, i) => C.sanitizePlace({ name: 'p' + i, lat: 35 + Math.sin(i) * 0.2, lng: 139 + Math.cos(i * 1.7) * 0.2 }));
  const t0 = Date.now();
  const r = C.planDays(t);
  assert.ok(Date.now() - t0 < 3000, Date.now() - t0 + 'ms');
  assert.ok(r.every((p) => p.day >= 1 && p.day <= 10));
});

test('estimateLeg / suggestMode', () => {
  assert.equal(C.suggestMode(500), 'walk');
  assert.equal(C.suggestMode(5000), 'transit');
  assert.equal(C.suggestMode(80000), 'drive');
  const w = C.estimateLeg(1000, 'walk');
  assert.ok(w.duration > 900 && w.duration < 1200, w.duration);
  assert.ok(C.estimateLeg(500, 'transit').note);
});

test('OSRM 與 Google Routes 回應解析', () => {
  const o = C.parseOsrm({ code: 'Ok', routes: [{ distance: 1234, duration: 900, geometry: { coordinates: [[139.7, 35.6], [139.71, 35.61]] } }] });
  assert.deepEqual(o.coords[0], [35.6, 139.7]);
  assert.throws(() => C.parseOsrm({ code: 'NoRoute' }));
  assert.deepEqual(C.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  const g = C.parseGoogleRoute({ routes: [{ distanceMeters: 5000, duration: '1260s', polyline: { encodedPolyline: '_p~iF~ps|U' }, legs: [{ steps: [
    { travelMode: 'WALK', staticDuration: '120s' }, { travelMode: 'WALK', staticDuration: '60s' },
    { travelMode: 'TRANSIT', transitDetails: { stopCount: 4, transitLine: { nameShort: '銀座線', vehicle: { type: 'SUBWAY' } }, stopDetails: { departureStop: { name: '淺草' }, arrivalStop: { name: '上野' } } } },
  ] }] }] });
  assert.equal(g.duration, 1260);
  assert.equal(g.steps.length, 2);
  assert.equal(g.steps[0].sec, 180);
  assert.equal(g.steps[1].line, '銀座線');
  assert.equal(g.steps[1].icon, '🚇');
});

test('分享：pack/unpack 往返保留地點、天數、交通方式', () => {
  const t = sampleTrip();
  t.base = C.sanitizePlace({ id: 'base', name: '新宿飯店', lat: 35.6909, lng: 139.7003 });
  t.places = C.planDays(t);
  const d1 = C.dayStops(t, 1);
  t.legModes[C.legKey(d1[0], d1[1])] = 'bike';
  t.legModes[C.legKey(t.base, d1[0])] = 'drive';
  const json = JSON.stringify(C.packTrip(t));
  const back = C.unpackTrip(JSON.parse(json));
  assert.equal(back.places.length, 9);
  assert.equal(back.base.name, '新宿飯店');
  const b1 = C.dayStops(back, 1);
  assert.equal(b1[0].name, d1[0].name);
  assert.equal(back.legModes[C.legKey(b1[0], b1[1])], 'bike');
  assert.equal(back.legModes[C.legKey(back.base, b1[0])], 'drive');
  const bytes = new TextEncoder().encode(json);
  assert.deepEqual(C.b64urlDecode(C.b64urlEncode(bytes)), bytes);
});

test('sanitizeTrip：擋掉惡意或錯誤欄位', () => {
  const t = C.sanitizeTrip({ name: 'x'.repeat(500), days: 999, places: [{ name: '<img src=x onerror=alert(1)>', lat: 35, lng: 139 }, { lat: 'abc' }, null], legModes: { 'a>b': 'rocket' } });
  assert.equal(t.name.length, 100);
  assert.equal(t.days, 60);
  assert.equal(t.places.length, 1);
  assert.deepEqual(t.legModes, {});
});

test('timeline：有住宿時含頭尾移動，時間正確', () => {
  const r = C.timeline('09:00', [600, 1200, 900], [60, 90], true);
  assert.deepEqual(r.stops.map((x) => [C.hm(x.arrive), C.hm(x.depart)]), [['09:10', '10:10'], ['10:30', '12:00']]);
  assert.equal(C.hm(r.end), '12:15');
  const n = C.timeline('08:30', [1800], [30, 30], false);
  assert.equal(C.hm(n.stops[1].arrive), '09:30');
});

test('gmapsDayUrl：起終點與中途點、最多 9 個', () => {
  const pts = Array.from({ length: 13 }, (_, i) => ({ lat: 35 + i / 100, lng: 139 }));
  const u = C.gmapsDayUrl(pts, 'walk');
  assert.ok(u.includes('origin=35,139') && u.includes('destination=35.12,139') && u.includes('travelmode=walking'));
  assert.equal(decodeURIComponent(u.split('waypoints=')[1].split('&')[0]).split('|').length, 9);
  assert.equal(C.gmapsDayUrl([pts[0]], 'walk'), '');
});

test('分享往返保留每日出發時間', () => {
  const t = C.newTrip('x'); t.dayStart = '07:45';
  t.places = [C.sanitizePlace({ name: 'a', lat: 35, lng: 139 })];
  assert.equal(C.unpackTrip(JSON.parse(JSON.stringify(C.packTrip(t)))).dayStart, '07:45');
  assert.equal(C.sanitizeTrip({ dayStart: '25:99' }).dayStart, '09:00');
});

test('分類自動判斷：中日英名稱', () => {
  const cases = { '淺草寺': 'temple', '明治神宮': 'temple', '東京晴空塔': 'view', '上野公園': 'park', '阿美橫丁': 'market', '築地場外市場': 'market',
    'teamLab Planets': 'museum', '國立西洋美術館': 'museum', '一蘭 拉麵 新宿店': 'food', '星巴克 京都二寧坂': 'cafe', '居酒屋 鳥貴族': 'bar',
    '新宿站': 'station', '京都駅': 'station', 'Tokyo Station': 'station', '成田機場': 'airport', '伊勢丹新宿店': 'shopping', '大阪城': 'castle',
    '環球影城 USJ': 'theme', '海遊館 水族館': 'zoo', '箱根湯本溫泉': 'onsen', '新宿站附近飯店': 'hotel', '台場': 'other' };
  for (const [n, c] of Object.entries(cases)) assert.equal(C.guessCat(n), c, n);
  assert.equal(C.catFromGoogleType('ramen_restaurant'), 'food');
  assert.equal(C.catFromGoogleType('art_gallery'), 'museum');
  assert.equal(C.catFromGoogleType('subway_station'), 'station');
  assert.equal(C.catFromGoogleType('department_store'), 'shopping');
});

test('營業時間：太早、已關、離開前關門、跨夜', () => {
  assert.match(C.hoursWarning('10:00-18:00', 540, 600), /還沒開/);
  assert.equal(C.hoursWarning('10:00-18:00', 660, 720), null);
  assert.match(C.hoursWarning('10:00-18:00', 1050, 1110), /離開前已關門/);
  assert.match(C.hoursWarning('10:00-18:00', 1140, 1200), /已經關門/);
  assert.equal(C.hoursWarning('18:00-02:00', 1380, 1470), null);
  assert.match(C.hoursWarning('11:00-14:00, 17:00-22:00', 900, 960), /還沒開（17:00/);
  assert.equal(C.hoursWarning('隨便寫', 0, 10), null);
});

test('新欄位：分類、打卡、營業時間、花費、主題、清單 往返與清理', () => {
  const t = C.newTrip('x'); t.theme = 'washi'; t.currency = '¥';
  t.checklist = [{ t: '護照', done: true, g: '證件' }];
  t.places = [C.sanitizePlace({ name: '某地', lat: 35, lng: 139, cat: 'food', done: true, hours: '10:00-20:00', cost: 1200 })];
  const b = C.unpackTrip(JSON.parse(JSON.stringify(C.packTrip(t))));
  assert.equal(b.theme, 'washi'); assert.equal(b.currency, '¥');
  assert.deepEqual(b.checklist, [{ t: '護照', done: true, g: '證件' }]);
  assert.equal(b.places[0].cat, 'food'); assert.equal(b.places[0].done, true); assert.equal(b.places[0].hours, '10:00-20:00'); assert.equal(b.places[0].cost, 1200);
  const z = C.sanitizeTrip({ theme: 'evil', places: [{ name: 'a', lat: 1, lng: 1, cat: 'xx', cost: -5 }] });
  assert.equal(z.theme, 'auto'); assert.equal(z.places[0].cost, 0); assert.ok(C.CATS[z.places[0].cat]);
});

test('附近搜尋：Overpass 查詢與解析（中文名優先、去重、依距離排序）', () => {
  const q = C.overpassQuery('food', 35.7, 139.8, 700);
  assert.ok(q.includes('around:700,35.700000,139.800000') && q.includes('restaurant'));
  const r = C.parseOverpass({ elements: [
    { type: 'node', lat: 35.701, lon: 139.8, tags: { name: 'Far Ramen', 'name:zh': '遠拉麵', cuisine: 'ramen' } },
    { type: 'way', center: { lat: 35.7001, lon: 139.8001 }, tags: { name: '近い食堂' } },
    { type: 'node', lat: 35.7001, lon: 139.8001, tags: { name: '近い食堂' } },
    { type: 'node', lat: 35.7002, lon: 139.8, tags: {} },
  ] }, { lat: 35.7, lng: 139.8 }, 'food');
  assert.equal(r.length, 2);
  assert.equal(r[0].name, '近い食堂');
  assert.equal(r[1].name, '遠拉麵');
  assert.equal(r[1].sub, 'ramen');
  assert.equal(r[0].cat, 'food');
  const t = C.parseOverpass({ elements: [{ lat: 35.7, lon: 139.8, tags: { amenity: 'toilets' } }] }, { lat: 35.7, lng: 139.8 }, 'toilet');
  assert.equal(t[0].name, '公共廁所');
});

test('票價格式與 .ics 行事曆', () => {
  assert.equal(C.fmtFare({ currencyCode: 'JPY', units: '210' }), '¥210');
  assert.equal(C.fmtFare({ currencyCode: 'USD', units: '2', nanos: 750000000 }), 'US$2.75');
  assert.equal(C.fmtFare(null), '');
  const ics = C.buildICS('東京, 3天', [{ date: '2026-12-20', start: 9 * 60 + 18, end: 10 * 60 + 18, title: 'D1 ⛩️ 淺草寺; 雷門', location: '東京', desc: '早上去\nhttps://x', lat: 35.7148, lng: 139.7967, uid: 'a-b' }]);
  assert.ok(ics.includes('DTSTART:20261220T091800') && ics.includes('DTEND:20261220T101800'));
  assert.ok(ics.includes('SUMMARY:D1 ⛩️ 淺草寺\; 雷門'));
  assert.ok(ics.includes('X-WR-CALNAME:東京\\, 3天'));
  assert.ok(ics.includes('GEO:35.714800;139.796700'));
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), '每行不超過 75 bytes');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trim().endsWith('END:VCALENDAR'));
});

test('每週營業時間：OSM 與 Google 格式、公休、依星期判斷', () => {
  const w = C.parseOSMHours('Tu-Su 11:30-14:00,17:30-22:00');
  assert.equal(w[1], 'off'); assert.equal(w[2], '11:30-14:00, 17:30-22:00');
  assert.deepEqual(C.parseOSMHours('Mo-Fr 10:00-20:00; Sa,Su 11:00-18:00; We off'), ['11:00-18:00', '10:00-20:00', '10:00-20:00', 'off', '10:00-20:00', '10:00-20:00', '11:00-18:00']);
  assert.equal(C.parseOSMHours('24/7')[3], '00:00-24:00');
  assert.equal(C.parseOSMHours('sunrise-sunset'), null);
  assert.equal(C.parseOSMHours('Fr-Mo 09:00-17:00')[0], '09:00-17:00');
  assert.equal(C.parseOSMHours('Fr-Mo 09:00-17:00')[3], 'off');
  const g = C.parseGoogleWeek(['Monday: 9:00 AM – 5:00 PM', 'Tuesday: Closed', 'Friday: 11:30 AM – 2:00 PM, 5:30 – 10:00 PM', '星期日: 24 小時營業']);
  assert.equal(g[1], '09:00-17:00'); assert.equal(g[2], 'off'); assert.equal(g[5], '11:30-14:00, 17:30-22:00'); assert.equal(g[0], '00:00-24:00');
  const p = { hours: '', hoursWeek: g };
  assert.equal(C.hoursFor(p, '2026-12-22'), 'off'); // 2026-12-22 是星期二
  assert.equal(C.hoursWarning(C.hoursFor(p, '2026-12-22'), 600, 660), '這天公休');
  assert.equal(C.hoursFor({ hours: '10:00-12:00', hoursWeek: g }, '2026-12-22'), '10:00-12:00');
  assert.match(C.weekSummary(C.parseOSMHours('Mo-Fr 10:00-20:00; Sa,Su 11:00-18:00')), /一–五 10:00-20:00；六、日 11:00-18:00/);
});

test('多城市：每晚不同住宿 → 依住宿分配地點、起終點正確', () => {
  const t = C.newTrip('關西');
  t.days = 3;
  t.base = C.sanitizePlace({ id: 'base', name: '京都飯店', lat: 35.0037, lng: 135.7588 });
  t.dayBase = { 3: { name: '大阪飯店', lat: 34.6937, lng: 135.5023 } };
  t.places = [
    ['清水寺', 34.9949, 135.785], ['金閣寺', 35.0394, 135.7292], ['伏見稻荷', 34.9671, 135.7727], ['嵐山', 35.017, 135.6717],
    ['大阪城', 34.6873, 135.5262], ['道頓堀', 34.6687, 135.5013], ['通天閣', 34.6525, 135.5063],
  ].map(([name, lat, lng]) => C.sanitizePlace({ name, lat, lng }));
  const s = C.sanitizeTrip(t);
  assert.equal(s.dayBase[3].name, '大阪飯店'); assert.equal(s.dayBase[3].id, 'base-3');
  assert.ok(C.multiHotel(s));
  const e3 = C.dayEnds(s, 3);
  assert.equal(e3.start.name, '京都飯店'); assert.equal(e3.end.name, '大阪飯店');
  s.places = C.planDays(s);
  const day = (n) => s.places.find((p) => p.name === n).day;
  assert.equal(day('大阪城'), 3); assert.equal(day('道頓堀'), 3); assert.equal(day('通天閣'), 3);
  assert.ok([1, 2].includes(day('清水寺')) && [1, 2].includes(day('金閣寺')));
  const b = C.unpackTrip(JSON.parse(JSON.stringify(C.packTrip(s))));
  assert.equal(b.dayBase[3].name, '大阪飯店');
  s.legModes[C.legKey({ id: 'base' }, { id: 'base-3' })] = 'drive';
  const b2 = C.unpackTrip(JSON.parse(JSON.stringify(C.packTrip(s))));
  assert.equal(b2.legModes['base>base-3'], 'drive');
});

test('照片：只採用「名稱相符且座標相近」的維基百科圖片', () => {
  const place = { name: '淺草寺', lat: 35.7148, lng: 139.7967, cat: 'temple' };
  const j = { query: { pages: {
    1: { index: 1, title: '淺草寺', fullurl: 'https://zh.wikipedia.org/wiki/淺草寺', thumbnail: { source: 'https://upload.wikimedia.org/a/sensoji.jpg' }, coordinates: [{ lat: 35.7147, lon: 139.7966 }] },
    2: { index: 2, title: '淺草寺 (台南)', thumbnail: { source: 'https://upload.wikimedia.org/b/other.jpg' }, coordinates: [{ lat: 23.0, lon: 120.2 }] },
    3: { index: 3, title: '淺草', thumbnail: { source: 'https://upload.wikimedia.org/c/Asakusa_map.svg.png' }, coordinates: [{ lat: 35.71, lon: 139.79 }] },
  } } };
  const r = C.wikiPick(j, place, { maxDist: 3000 });
  assert.equal(r.url, 'https://upload.wikimedia.org/a/sensoji.jpg');
  // 同名但在別的城市 → 不採用
  const far = { query: { pages: { 1: { title: '淺草寺', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' }, coordinates: [{ lat: 25, lon: 121 }] } } } };
  assert.equal(C.wikiPick(far, place, { maxDist: 3000 }), null);
  // 名稱不相符且沒有座標 → 不採用
  const nocoord = { query: { pages: { 1: { title: '雷門', thumbnail: { source: 'https://upload.wikimedia.org/y.jpg' } } } } };
  assert.equal(C.wikiPick(nocoord, place, {}), null);
  // 非維基網域的圖片 → 不採用
  const evil = { query: { pages: { 1: { title: '淺草寺', thumbnail: { source: 'https://evil.example/x.jpg' }, coordinates: [{ lat: 35.7148, lon: 139.7967 }] } } } };
  assert.equal(C.wikiPick(evil, place, {}), null);
  assert.deepEqual(C.wikiLangs('浅草寺カフェ'), ['ja', 'zh', 'en']);
  assert.equal(C.sanitizePhoto({ src: 'wiki', url: 'javascript:alert(1)' }), null);
  assert.equal(C.sanitizePhoto({ src: 'wiki', url: "https://upload.wikimedia.org/a').jpg" }), null);
  assert.deepEqual(C.sanitizePhoto({ src: 'google', name: 'places/abc/photos/xyz' }), { src: 'google', name: 'places/abc/photos/xyz' });
});

test('Apple 地圖連結：交通方式對應 dirflg', () => {
  const a = { lat: 35.7148, lng: 139.7967 }, b = { lat: 35.7101, lng: 139.8107, name: '東京晴空塔' };
  assert.equal(C.appleDirUrl(a, b, 'walk'), 'https://maps.apple.com/?saddr=35.7148,139.7967&daddr=35.7101,139.8107&dirflg=w');
  assert.ok(C.appleDirUrl(a, b, 'transit').endsWith('dirflg=r'));
  assert.ok(C.appleDirUrl(a, b, 'drive').endsWith('dirflg=d'));
  assert.ok(C.appleDirUrl(a, b, 'bike').endsWith('dirflg=c'));
  assert.equal(C.applePlaceUrl(b), 'https://maps.apple.com/?ll=35.7101,139.8107&q=' + encodeURIComponent('東京晴空塔'));
});

test('貼文字變行程：ChatGPT 中文格式', () => {
  const d = C.parseItineraryText(fs.readFileSync(path.join(__dirname, 'fixtures', 'chatgpt_zh.txt'), 'utf8'));
  assert.deepEqual(d.map((x) => x.day), [1, 2, 3]);
  assert.deepEqual(d[0].items.map((x) => x.name), ['淺草寺', '淺草今半', '東京晴空塔', '上野阿美橫丁']);
  assert.deepEqual(d[1].items.map((x) => x.name), ['明治神宮', '原宿竹下通', '一蘭拉麵 澀谷店', '澀谷十字路口', 'SHIBUYA SKY']);
  assert.deepEqual(d[2].items.map((x) => x.name), ['築地場外市場', 'teamLab Planets', '台場海濱公園']);
  assert.ok(!d.some((x) => x.items.some((i) => /Suica|預算|回飯店/.test(i.name))), '小提醒、回飯店不算地點');
});

test('貼文字變行程：英文、同一行箭頭、第N天、日目', () => {
  const d = C.parseItineraryText(fs.readFileSync(path.join(__dirname, 'fixtures', 'chatgpt_en.txt'), 'utf8'));
  assert.deepEqual(d[0].items.map((x) => x.name), ['Fushimi Inari Shrine', 'Nishiki Market', 'Kiyomizu-dera Temple', 'Gion district']);
  assert.deepEqual(d[1].items.map((x) => x.name), ['Arashiyama Bamboo Grove', 'Tenryu-ji Temple', 'Okochi Sanso Villa', 'Kinkaku-ji']);
  const a = C.parseItineraryText('第一天：淺草寺 → 晴空塔 → 上野公園\n第二天\n・明治神宮\n・表參道\n3日目\n- 鎌倉大佛');
  assert.deepEqual(a.map((x) => [x.day, x.items.map((i) => i.name)]), [[1, ['淺草寺', '晴空塔', '上野公園']], [2, ['明治神宮', '表參道']], [3, ['鎌倉大佛']]]);
  assert.deepEqual(C.parseItineraryText('隨便一段沒有天數的文字'), []);
});

test('分帳：平均分攤、部分人分攤、最少轉帳、總和不差一分', () => {
  const m = ['Ken', 'Amy', 'Bob'];
  const ex = [
    { title: '晚餐', amount: 3000, payer: 'Ken', split: m },
    { title: '計程車', amount: 1000, payer: 'Amy', split: ['Amy', 'Bob'] },
    { title: '門票', amount: 100, payer: 'Bob', split: m },
  ].map((e) => C.sanitizeExpense(e, m));
  const r = C.settle(m, ex);
  assert.equal(r.total, 4100);
  // Ken 付 3000、分攤 1033.34 → +1966.66；Amy 付 1000、分攤 1000+500+33.33 → -533.33；Bob 付 100、分攤 1000+500+33.33 → -1433.33
  assert.equal(Math.round((r.balance.Ken + r.balance.Amy + r.balance.Bob) * 100), 0);
  assert.equal(r.balance.Ken, 1966.66);
  assert.ok(r.transfers.every((x) => x.to === 'Ken'));
  assert.equal(r.transfers.length, 2);
  assert.equal(Math.round(r.transfers.reduce((a, x) => a + x.amount, 0) * 100), 196666);
  assert.equal(C.sanitizeExpense({ amount: -5 }, m), null);
  assert.deepEqual(C.sanitizeExpense({ amount: 10, payer: 'X', split: ['Y'] }, m).split, m);
});

test('預訂：清理、依日期列出（住宿入住與退房）、分享往返', () => {
  const t = C.newTrip('x');
  t.bookings = [
    { type: 'flight', title: 'BR198 台北→東京', date: '2026-12-20', time: '08:30', code: 'ABC123', cost: 12000 },
    { type: 'hotel', title: '新宿飯店', date: '2026-12-20', time: '15:00', endDate: '2026-12-23', endTime: '11:00' },
    { type: 'evil', title: '<b>x</b>', date: 'tomorrow', link: 'javascript:alert(1)' },
    { title: '' },
  ];
  t.members = ['Ken', 'Amy']; t.expenses = [{ title: '午餐', amount: 2000, payer: 'Amy', split: ['Ken', 'Amy'] }];
  const s = C.sanitizeTrip(t);
  assert.equal(s.bookings.length, 3);
  assert.equal(s.bookings[2].type, 'other'); assert.equal(s.bookings[2].date, ''); assert.equal(s.bookings[2].link, '');
  assert.deepEqual(C.bookingsOn(s, '2026-12-20').map((x) => [x.b.type, x.kind]), [['flight', 'start'], ['hotel', 'in']]);
  assert.deepEqual(C.bookingsOn(s, '2026-12-23').map((x) => [x.b.type, x.kind]), [['hotel', 'out']]);
  const b = C.unpackTrip(JSON.parse(JSON.stringify(C.packTrip(s))));
  assert.equal(b.bookings[0].code, 'ABC123'); assert.deepEqual(b.members, ['Ken', 'Amy']);
  assert.equal(b.expenses[0].payer, 'Amy'); assert.deepEqual(b.expenses[0].split, ['Ken', 'Amy']);
});

test('cleanKey 去掉手機貼上的雜字元', () => {
  assert.strictEqual(C.cleanKey(' ＡＩza​SyX-_9 \n'), 'AIzaSyX-_9');
  assert.strictEqual(C.cleanKey(null), '');
});

test('機場：第 1 天從抵達機場出發、最後一天到出發機場；抵達日排較少點', () => {
  const t = C.newTrip('北海道');
  t.days = 4; t.dayStart = '09:00';
  t.base = C.sanitizePlace({ name: '札幌飯店', lat: 43.0653, lng: 141.351, id: 'base', day: 0 });
  t.arrive = C.sanitizePlace({ name: '新千歲空港', lat: 42.7752, lng: 141.6923, id: 'arrive', day: 0, cat: 'airport' });
  t.depart = t.arrive; t.arriveTime = '15:00'; t.departTime = '17:00';
  const pts = [];
  for (let i = 0; i < 16; i++) pts.push(C.sanitizePlace({ name: 'P' + i, lat: 43.0 + (i % 4) * 0.02, lng: 141.3 + Math.floor(i / 4) * 0.02 }));
  t.places = pts;
  assert.strictEqual(C.dayEnds(t, 1).start.name, '新千歲空港');
  assert.strictEqual(C.dayEnds(t, 1).end.name, '札幌飯店');
  assert.strictEqual(C.dayEnds(t, 4).start.name, '札幌飯店');
  assert.strictEqual(C.dayEnds(t, 4).end.name, '新千歲空港');
  assert.strictEqual(C.dayStartTime(t, 1), '16:00');
  assert.strictEqual(C.dayStartTime(t, 2), '09:00');
  assert.strictEqual(C.departDeadline(t), 15 * 60);
  const planned = C.planDays(t);
  const n = (d) => planned.filter((p) => p.day === d).length;
  assert.ok(n(1) < n(2) && n(1) < n(3), 'day1 應較少：' + [1, 2, 3, 4].map(n));
  assert.ok(n(4) < n(2), 'day4 應較少：' + [1, 2, 3, 4].map(n));
  assert.strictEqual(n(1) + n(2) + n(3) + n(4), 16);
  const back = C.sanitizeTrip(JSON.parse(JSON.stringify(t)));
  assert.strictEqual(back.arrive.cat, 'airport'); assert.strictEqual(back.departTime, '17:00');
});

test('備註標記：第幾晚住宿、午／晚餐、指定天', () => {
  const tg = C.parseNoteTags;
  assert.deepStrictEqual(tg('第1-3晚').nights, [1, 2, 3]);
  assert.deepStrictEqual(tg('D2晚餐'), { nights: [], meal: 'dinner', day: 2 });
  assert.strictEqual(tg('中餐').meal, 'lunch');
  assert.deepStrictEqual(tg('夜景很美').nights, []);
  const t = C.newTrip('北海道'); t.days = 3;
  const r = C.applyNoteTags(t, [
    { name: 'JR Tower 日航', lat: 43.0682, lng: 141.3531, note: '第1-2晚', cat: 'hotel' },
    { name: '洞爺湖飯店', lat: 42.5787, lng: 140.7959, note: '第3晚' },
    { name: '羊八', lat: 43.0532, lng: 141.3503, note: 'D1 晚餐' },
    { name: '湯咖哩', lat: 43.05, lng: 141.35, note: '午餐' },
    { name: '蟹王', lat: 42.4779, lng: 141.2422, note: '第2晚吃' , cat: 'food' },
    { name: '白鬚瀑布', lat: 43.47, lng: 142.63, note: '' },
  ]);
  assert.strictEqual(r.hotels, 2);
  assert.strictEqual(t.dayBase[1].name, 'JR Tower 日航'); assert.strictEqual(t.dayBase[2].name, 'JR Tower 日航'); assert.strictEqual(t.dayBase[3].name, '洞爺湖飯店');
  assert.strictEqual(t.days, 4, '住 3 晚 → 至少 4 天');
  const yang = r.places.find((p) => p.name === '羊八');
  assert.ok(yang.meal === 'dinner' && yang.day === 1 && yang.locked);
  const crab = r.places.find((p) => p.name === '蟹王');
  assert.ok(crab.meal === 'dinner' && crab.day === 2);
  assert.strictEqual(r.places.find((p) => p.name === '湯咖哩').meal, 'lunch');
});

test('排程：晚餐排最後、午餐排在接近中午', () => {
  const t = C.newTrip('x'); t.days = 1; t.dayStart = '09:00';
  t.base = C.sanitizePlace({ name: 'H', lat: 43.0653, lng: 141.351 });
  const mk = (name, lat, lng, extra) => C.sanitizePlace({ name, lat, lng, stay: 90, ...extra });
  t.places = [mk('晚餐店', 43.054, 141.352, { meal: 'dinner' }), mk('A', 43.06, 141.33), mk('B', 43.07, 141.34), mk('午餐店', 43.065, 141.355, { meal: 'lunch' }), mk('C', 43.08, 141.36), mk('D', 43.05, 141.32)];
  const p = C.planDays(t);
  const seq = p.filter((x) => x.day === 1).sort((a, b) => a.order - b.order).map((x) => x.name);
  assert.strictEqual(seq[seq.length - 1], '晚餐店', seq.join('>'));
  const li = seq.indexOf('午餐店');
  assert.ok(li >= 1 && li <= 3, '午餐位置 ' + seq.join('>'));
});

test('刪除某一天：地點回未排、後面往前移、住宿跟著移', () => {
  const t = C.newTrip('x'); t.days = 3;
  t.dayBase = { 1: { name: 'H1', lat: 1, lng: 1, id: 'base-1' }, 2: { name: 'H2', lat: 2, lng: 2, id: 'base-2' }, 3: { name: 'H3', lat: 3, lng: 3, id: 'base-3' } };
  t.places = [1, 2, 3].map((d) => C.sanitizePlace({ name: 'P' + d, lat: 35 + d / 100, lng: 139, day: d, locked: true }));
  C.removeDay(t, 2);
  assert.strictEqual(t.days, 2);
  assert.deepStrictEqual(t.places.map((p) => p.day), [1, 0, 2]);
  assert.strictEqual(t.places[1].locked, false);
  assert.strictEqual(t.dayBase[2].name, 'H3'); assert.strictEqual(t.dayBase[3], undefined);
  const u = C.newTrip('y'); u.days = 2; u.places = [C.sanitizePlace({ name: 'A', lat: 1, lng: 1, day: 2 })];
  assert.strictEqual(C.clearDay(u, 2), 1); assert.strictEqual(u.places[0].day, 0); assert.strictEqual(u.days, 2);
});

test('沒設住宿、只設機場：第 1 天從機場出發、最後一天結束在機場', () => {
  const t = C.newTrip('x'); t.days = 2;
  t.arrive = C.sanitizePlace({ name: '新千歲空港', lat: 42.7752, lng: 141.6923, cat: 'airport' });
  t.depart = t.arrive; t.arriveTime = '10:00';
  t.places = ['A', 'B', 'C', 'D'].map((n, i) => C.sanitizePlace({ name: n, lat: 43.05 + i * 0.01, lng: 141.35 }));
  const p = C.planDays(t);
  assert.strictEqual(p.filter((x) => x.day).length, 4);
  const e1 = C.dayEnds(t, 1), e2 = C.dayEnds(t, 2);
  assert.strictEqual(e1.start.name, '新千歲空港'); assert.strictEqual(e1.end, null);
  assert.strictEqual(e2.start, null); assert.strictEqual(e2.end.name, '新千歲空港');
  const tl = C.timeline('09:00', [600, 600, 600], [60, 60], false, true);
  assert.strictEqual(tl.stops[0].arrive, 540); assert.strictEqual(tl.end, 540 + 60 + 10 + 60 + 10);
});

const TT = require('../js/ticket.js');
TT.loadAirports(JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../data/airports.json'), 'utf8')));
test('機票：Amadeus 電子機票收據（假資料）讀出兩段航班', () => {
  const txt = require('fs').readFileSync(require('path').join(__dirname, 'fixtures/amadeus_sample.txt'), 'utf8');
  const r = TT.parseTicketText(txt, { producer: 'Amadeus' });
  assert.strictEqual(r.system, 'amadeus'); assert.strictEqual(r.pnr, 'TST9QZ');
  assert.strictEqual(r.segments.length, 2, JSON.stringify(r.segments));
  const [a, b] = r.segments;
  assert.deepStrictEqual([a.flight, a.from, a.to, a.depDate, a.depTime, a.arrTime, a.fromTerminal, a.seat], ['CI100', 'TPE', 'NRT', '2027-03-01', '08:10', '12:25', '2', '41C']);
  assert.deepStrictEqual([b.flight, b.from, b.to, b.depDate, b.depTime], ['CI101', 'NRT', 'TPE', '2027-03-06', '13:40']);
  const j = TT.splitJourney(r.segments);
  assert.deepStrictEqual([j.out.length, j.ret.length], [1, 1]);
});
test('機票：機場名稱比對、兩個機場黏在一起也能切開', () => {
  assert.strictEqual(TT.matchAirport('SAPPORO NEW CHITOSE').airport.code, 'CTS');
  assert.strictEqual(TT.matchAirport('TAIPEI TAIWAN TAOYUAN INTL').airport.code, 'TPE');
  const sp = TT.splitTwoAirports('TAIPEI TAIWAN TAOYUAN INTL SAPPORO NEW CHITOSE');
  assert.deepStrictEqual([sp.from.code, sp.to.code], ['TPE', 'CTS']);
  assert.strictEqual(TT.terminalName('I'), '國際線航廈'); assert.strictEqual(TT.termShort('1'), 'T1');
});
test('機票：登機證條碼 BCBP、貼上的確認信文字', () => {
  const s = 'M1' + 'TEST/PASSENGER MS'.padEnd(20) + 'E' + 'TST9QZ'.padEnd(7) + 'TPE' + 'NRT' + 'CI ' + '0100 ' + '060' + 'Y' + '041C' + '0012 ' + '1' + '00';
  const b = TT.parseBCBP(s, '2026-11-22');
  assert.deepStrictEqual([b.pnr, b.segments[0].flight, b.segments[0].from, b.segments[0].to, b.segments[0].depDate, b.segments[0].seat], ['TST9QZ', 'CI100', 'TPE', 'NRT', '2027-03-01', '41C']);
  assert.strictEqual(TT.parseBCBP('hello'), null);
  const g = TT.parseTicketText('訂位代號：ABC123\n\nCI 130  TPE 2027/05/01 08:00 → NRT 2027/05/01 12:20\nSeat: 33A\n\nCI 131 NRT 2027/05/06 13:30 → TPE 2027/05/06 16:20\nSeat: 33B\n');
  assert.deepStrictEqual(g.segments.map((x) => x.flight + x.from + x.to + x.depTime), ['CI130TPENRT08:00', 'CI131NRTTPE13:30']);
});
test('出門時間：起飛 − 報到 − 交通', () => {
  assert.strictEqual(C.leaveHomeMin('10:05', 150, 3600), 10 * 60 + 5 - 150 - 60);
  const f = C.sanitizeFlights({ out: [{ flight: 'JX850', from: { code: 'TPE', lat: 25, lng: 121, terminal: '1' }, to: { code: 'CTS', lat: 42.7, lng: 141.6, terminal: 'I' }, depDate: '2027-04-04', depTime: '10:05' }], ret: [{ flight: 'bad' }] });
  assert.strictEqual(f.out.length, 1); assert.strictEqual(f.ret.length, 0); assert.strictEqual(f.out[0].from.terminal, '1');
});
