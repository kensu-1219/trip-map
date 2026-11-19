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
