/* 機票辨識（不用 AI）：
   1. 登機證條碼（IATA BCBP 標準）
   2. 電子機票收據的固定範本（先支援 Amadeus 範本，星宇、國泰、新航、泰航等都用）
   3. 通用規則：航班號＋時間＋日期＋航廈
   機場名稱用 OurAirports 公開資料比對成 IATA 代碼與座標。
   純函式，可在 Node 測試。 */
(function (root) {
  'use strict';

  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);

  // 常用機場中文名
  const ZH = {
    TPE: '桃園', TSA: '台北松山', KHH: '高雄', RMQ: '台中', TNN: '台南',
    CTS: '札幌新千歲', HKD: '函館', AKJ: '旭川', NRT: '東京成田', HND: '東京羽田', KIX: '大阪關西', ITM: '大阪伊丹', NGO: '名古屋中部',
    FUK: '福岡', OKA: '沖繩那霸', KMJ: '熊本', KOJ: '鹿兒島', SDJ: '仙台', AOJ: '青森', HIJ: '廣島', OKJ: '岡山', TAK: '高松', KMQ: '小松',
    KKJ: '北九州', ISG: '石垣', SHI: '宮古下地島', UKB: '神戶', MYJ: '松山（愛媛）', NGS: '長崎', OIT: '大分', KMI: '宮崎', FSZ: '靜岡', IBR: '茨城', HNA: '花卷',
    ICN: '首爾仁川', GMP: '首爾金浦', PUS: '釜山', CJU: '濟州', TAE: '大邱',
    HKG: '香港', MFM: '澳門', PVG: '上海浦東', SHA: '上海虹橋', PEK: '北京首都', PKX: '北京大興', XMN: '廈門',
    BKK: '曼谷蘇凡納布', DMK: '曼谷廊曼', CNX: '清邁', HKT: '普吉', SIN: '新加坡', KUL: '吉隆坡', MNL: '馬尼拉', CEB: '宿霧',
    SGN: '胡志明市', HAN: '河內', DAD: '峴港', DPS: '峇里島', CGK: '雅加達', PNH: '金邊',
    LAX: '洛杉磯', SFO: '舊金山', SEA: '西雅圖', JFK: '紐約', YVR: '溫哥華', LHR: '倫敦希斯洛', CDG: '巴黎戴高樂', FRA: '法蘭克福', MUC: '慕尼黑',
    AMS: '阿姆斯特丹', VIE: '維也納', PRG: '布拉格', FCO: '羅馬', MXP: '米蘭', IST: '伊斯坦堡', DXB: '杜拜', SYD: '雪梨', MEL: '墨爾本', BNE: '布里斯本', AKL: '奧克蘭', GUM: '關島',
  };
  // 航廈代號 → 中文
  function terminalName(t) {
    const s = String(t || '').trim().toUpperCase();
    if (!s) return '';
    if (s === 'I' || s === 'INTL' || s === 'INT') return '國際線航廈';
    if (s === 'D' || s === 'DOM') return '國內線航廈';
    if (/^\d+[A-Z]?$/.test(s)) return '第 ' + s + ' 航廈';
    return s;
  }
  const termShort = (t) => { const s = String(t || '').trim().toUpperCase(); return !s ? '' : s === 'I' ? '國際線' : s === 'D' ? '國內線' : /^\d/.test(s) ? 'T' + s : s; };
  // 機票上沒寫航廈時的備援：桃園機場各航空公司的航廈（2026 年資料，可能異動）
  const TPE_TERMINAL = { CI: '2', BR: '2', JX: '1', IT: '1', MM: '1', GK: '1', AE: '1', CX: '1', CX_: '', SQ: '2', TG: '1', KE: '2', OZ: '1', NH: '2', JL: '2', HX: '1', UO: '1', '7C': '1', TW: '1', LJ: '1', VJ: '1', '5J': '1', AK: '1', D7: '1', TR: '1' };

  /* ---------- 機場比對 ---------- */
  let AP = null, IDX = null;
  const norm = (s) => String(s || '').toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\bINTL\b/g, 'INTERNATIONAL').replace(/[^A-Z0-9぀-鿿 ]+/g, ' ').split(/\s+/).filter((w) => w && w !== 'AIRPORT' && w !== 'THE');
  function loadAirports(rows) {
    AP = rows.map((r) => ({ code: r[0], name: r[1], city: r[2], country: r[3], lat: r[4], lng: r[5], big: !!r[7], toks: new Set(norm(r[1] + ' ' + r[2] + ' ' + r[6])) }));
    IDX = new Map();
    AP.forEach((a, i) => a.toks.forEach((t) => { if (!IDX.has(t)) IDX.set(t, []); IDX.get(t).push(i); }));
    const N = AP.length;
    IDX.idf = new Map([...IDX].map(([t, l]) => [t, Math.log(N / l.length)]));
    AP.byCode = new Map(AP.map((a) => [a.code, a]));
    return AP.length;
  }
  const airportByCode = (c) => (AP && AP.byCode.get(String(c || '').toUpperCase())) || null;
  /** 回傳 {airport, score}：比對名稱詞，罕見的詞（如 CHITOSE）分數高 */
  function matchAirport(text) {
    if (!AP) return { airport: null, score: 0 };
    const q = norm(text);
    if (!q.length) return { airport: null, score: 0 };
    const sc = new Map();
    for (const t of q) for (const i of IDX.get(t) || []) sc.set(i, (sc.get(i) || 0) + IDX.idf.get(t));
    let best = null, bs = 0;
    for (const [i, s] of sc) {
      const a = AP[i];
      const miss = q.filter((t) => !a.toks.has(t)).length;
      const v = s - 0.6 * miss + (a.big ? 0.3 : 0);
      if (v > bs) { bs = v; best = a; }
    }
    return { airport: best, score: bs };
  }
  /** 一串字裡有兩個機場（例：「TAIPEI TAIWAN TAOYUAN INTL SAPPORO NEW CHITOSE」），找最好的切法 */
  function splitTwoAirports(text) {
    const w = String(text || '').trim().split(/\s+/).filter(Boolean);
    let best = null;
    for (let i = 1; i < w.length; i++) {
      const a = matchAirport(w.slice(0, i).join(' ')), b = matchAirport(w.slice(i).join(' '));
      if (!a.airport || !b.airport || a.airport === b.airport) continue;
      const s = a.score + b.score;
      if (!best || s > best.s) best = { s, from: a.airport, to: b.airport, fromText: w.slice(0, i).join(' '), toText: w.slice(i).join(' ') };
    }
    return best;
  }

  /* ---------- 日期時間 ---------- */
  const reDate = /\b(\d{1,2})\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s?(\d{4}|\d{2})?\b/gi;
  function findDates(s, refYear) {
    const out = [];
    let m;
    reDate.lastIndex = 0;
    while ((m = reDate.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 14), m.index);
      if (/NV[AB]\b[^:]*:\s*$/i.test(before) || /(Date|Issued?|日期)\s*:?\s*$/i.test(before)) continue;
      let y = m[3] ? +m[3] : refYear;
      if (y < 100) y += 2000;
      out.push(iso(y, MON[m[2].toUpperCase().slice(0, 3)], +m[1]));
    }
    // 2027-04-04、2027/04/04
    const re2 = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
    while ((m = re2.exec(s))) out.push(iso(+m[1], +m[2], +m[3]));
    return out;
  }
  function findTimes(s) {
    const out = [];
    const re = /\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/g;
    let m;
    while ((m = re.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 22), m.index);
      if (/(Duration|飛行時間|Flying time|Last check-?in|報到截止)\s*:?\s*$/i.test(before)) continue;
      out.push(pad(+m[1]) + ':' + m[2]);
    }
    return out;
  }
  const FLIGHT = /\b((?=[A-Z0-9]{2}\s?\d)(?:[A-Z]{2}|[A-Z]\d|\d[A-Z]))\s?(\d{1,4})\b/g;
  function findFlights(s) {
    const out = [];
    let m;
    FLIGHT.lastIndex = 0;
    while ((m = FLIGHT.exec(s))) {
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 4);
      if (/^[A-Z]{3}/i.test(after)) continue; // 例如 04Apr → 不是航班
      if (/^\d{2,}$/.test(m[1])) continue;
      out.push(m[1] + m[2]);
    }
    return out;
  }

  /* ---------- 電子機票收據 ---------- */
  function detectSystem(text, meta) {
    const p = (meta && (meta.producer || meta.creator || '')) || '';
    if (/amadeus/i.test(p) || /ELECTRONIC TICKET RECEIPT/i.test(text) && /NVB|NVA/.test(text)) return 'amadeus';
    if (/sabre/i.test(p) || /ITINERARY RECEIPT.*SABRE|Sabre/i.test(text)) return 'sabre';
    if (/navitaire/i.test(p)) return 'navitaire';
    return 'generic';
  }
  /** 從整份文字讀出航段 */
  function parseTicketText(text, meta) {
    const T = String(text || '').replace(/\r/g, '');
    const system = detectSystem(T, meta);
    const pnr = (T.match(/(?:Booking ref(?:erence)?|Booking reference|Reservation (?:code|number)|PNR|訂位代號|預約番號)\s*[:：#]?\s*([A-Z0-9]{5,7})\b/i) || [])[1] || '';
    const pax = ((T.match(/Passenger(?: name)?\s*[:：]\s*([^\n(]+?)(?:\s{2,}|\(|\n)/i) || [])[1] || '').trim();
    const issued = T.match(/Date\s*:\s*(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(\d{4})/i);
    const refYear = issued ? +issued[3] : new Date().getFullYear();
    // 只看機票段落（Amadeus 後面還有附加服務收據 EMD，會重複出現航班，要排除）
    let body = T;
    const cut = body.search(/ELECTRONIC TICKET REMARKS|ELECTRONIC MISCELLANEOUS DOCUMENT|PAYMENT DETAILS|LEGAL AND PASSENGER NOTICES/i);
    if (cut > 0) body = body.slice(0, cut);
    const start = body.search(/\bFrom\b[^\n]*\bTo\b[^\n]*\bFlight\b/i);
    if (start >= 0) body = body.slice(start);
    // 切航段：每段是「地名／航班／時間」幾行，接著「Class／Seat／Baggage…」明細幾行
    body = body.replace(/_/g, ' ');
    const DETAIL = /^\s*(Class|Seat|Baggage|Fare basis|Booking status|Operated by|Marketed by|Frequent flyer|NV[AB]|Duration|Status|Cabin|Meal|座位|艙等|行李)\b/i;
    const chunks = [];
    let cur = [], inDetail = false;
    for (const line of body.split('\n')) {
      const isD = DETAIL.test(line);
      if (!line.trim()) { if (inDetail) { chunks.push(cur.join('\n')); cur = []; inDetail = false; } continue; }
      if (inDetail && !isD) { chunks.push(cur.join('\n')); cur = []; inDetail = false; }
      if (isD) inDetail = true;
      cur.push(line);
    }
    if (cur.length) chunks.push(cur.join('\n'));
    const segs = [];
    for (let ch of chunks) {
      ch = ch.replace(/^[^\n]*\bFrom\b[^\n]*\bTo\b[^\n]*\bFlight\b[^\n]*\n/i, '');
      const fl = findFlights(ch.replace(/Ticket number[^\n]*/i, '').replace(/Frequent flyer[^\n]*/i, ''));
      const times = findTimes(ch);
      if (!fl.length || times.length < 2) continue;
      const dates = findDates(ch, refYear);
      const terms = [...ch.matchAll(/Terminal\s*[:：]?\s*([A-Z0-9]{1,3})\b/gi)].map((m) => m[1].toUpperCase());
      const seat = (ch.match(/Seat\s*[:：]\s*(\d{1,3}[A-K])\b/i) || [])[1] || '';
      const cls = (ch.match(/Class\s*[:：]\s*([A-Z])\b/i) || [])[1] || '';
      const bag = (ch.match(/Baggage[^:：]*[:：]\s*([0-9]+\s?(?:PC|K|KG))\b/i) || [])[1] || '';
      const dur = (ch.match(/Duration\s*[:：]\s*(\d{1,2}):(\d{2})/i) || []);
      const status = (ch.match(/Booking status[^:：]*[:：]\s*([A-Z]{2})\b/i) || [])[1] || '';
      // 地名文字：拿掉標籤、時間、日期、航班號後剩下的大寫字
      const loc = ch.split('\n').map((l) => l.replace(/\b(Class|Seat|Baggage|Fare basis|Booking status|Operated by|Marketed by|Frequent flyer number|NV[AB]|Duration|Last check-in)\b.*$/i, ''))
        .join(' ')
        .replace(/Terminal\s*[:：]?\s*[A-Z0-9]{1,3}\b/gi, ' ').replace(reDate, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ')
        .replace(FLIGHT, ' ').replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
      // 有寫 IATA 代碼（TPE、NRT…）就直接用；沒有再用名稱比對
      const codes = [...ch.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]).filter((c) => airportByCode(c) && !/^(THE|AND|FOR|OUT|ADT|PNR|TWD|USD|JPY)$/.test(c));
      let sp = null;
      if (codes.length >= 2 && codes[0] !== codes[1]) sp = { from: airportByCode(codes[0]), to: airportByCode(codes[1]) };
      else sp = splitTwoAirports(loc);
      segs.push({
        flight: fl[0], depDate: dates[0] || '', arrDate: dates[1] || dates[0] || '', depTime: times[0], arrTime: times[1],
        from: sp ? sp.from.code : '', to: sp ? sp.to.code : '', fromTerminal: terms[0] || '', toTerminal: terms[1] || '',
        seat, cls, bag, status, durationMin: dur.length ? +dur[1] * 60 + +dur[2] : 0, raw: loc,
      });
    }
    // 跨夜：抵達時間比起飛早、又只有一個日期 → 隔天
    for (const s of segs) if (s.arrDate === s.depDate && s.arrTime < s.depTime && !s.durationMin) s.arrDate = addDays(s.depDate, 1);
    return { system, pnr, passenger: pax, segments: fillTerminals(segs) };
  }
  function fillTerminals(segs) {
    for (const s of segs) {
      const al = s.flight.slice(0, 2);
      if (!s.fromTerminal && s.from === 'TPE' && TPE_TERMINAL[al]) { s.fromTerminal = TPE_TERMINAL[al]; s.termGuess = true; }
      if (!s.toTerminal && s.to === 'TPE' && TPE_TERMINAL[al]) { s.toTerminal = TPE_TERMINAL[al]; s.termGuess = true; }
    }
    return segs;
  }
  function addDays(isoD, n) {
    const d = new Date(isoD + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* ---------- 登機證條碼 IATA BCBP ---------- */
  function julianToIso(j, today) {
    const now = today ? new Date(today + 'T00:00:00Z') : new Date();
    for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1, now.getUTCFullYear() - 1]) {
      const d = new Date(Date.UTC(y, 0, 1)); d.setUTCDate(j);
      const diff = (d - now) / 864e5;
      if (diff > -60 && diff < 320) return d.toISOString().slice(0, 10);
    }
    const d = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); d.setUTCDate(j);
    return d.toISOString().slice(0, 10);
  }
  function parseBCBP(str, today) {
    const s = String(str || '');
    if (!/^M[1-9]/.test(s) || s.length < 58) return null;
    const legs = +s[1];
    const name = s.slice(2, 22).trim();
    const out = { pnr: '', passenger: name.replace('/', ' '), segments: [], system: 'bcbp' };
    let p = 22 + 1; // 電子機票標記
    for (let i = 0; i < legs; i++) {
      const pnr = s.slice(p, p + 7).trim(); const from = s.slice(p + 7, p + 10); const to = s.slice(p + 10, p + 13);
      const carrier = s.slice(p + 13, p + 16).trim(); const num = s.slice(p + 16, p + 21).trim().replace(/^0+/, '');
      const jd = +s.slice(p + 21, p + 24); const cls = s.slice(p + 24, p + 25); const seat = s.slice(p + 25, p + 29).trim().replace(/^0+/, '');
      const condLen = parseInt(s.slice(p + 35, p + 37), 16) || 0;
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) break;
      out.pnr = out.pnr || pnr;
      out.segments.push({ flight: carrier + num, from, to, depDate: jd ? julianToIso(jd, today) : '', depTime: '', arrDate: '', arrTime: '', cls, seat, fromTerminal: '', toTerminal: '', fromBarcode: true });
      p += 37 + condLen;
    }
    return out.segments.length ? fillTerminals(out.segments) && out : null;
  }

  /** pdf.js 的文字片段（含座標）→ 依版面排成一行一行，欄位間保留多個空白 */
  function itemsToText(items) {
    const its = items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * 5, h: Math.abs(it.transform[3]) || 10 }));
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of its) {
      const L = lines.length ? lines[lines.length - 1] : null;
      if (L && Math.abs(L.y - it.y) <= Math.max(2, it.h * 0.35)) L.items.push(it); else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    const out = [];
    let prevY = null;
    for (const L of lines) {
      if (prevY != null && prevY - L.y > L.h * 2.2) out.push('');
      prevY = L.y;
      L.items.sort((a, b) => a.x - b.x);
      let line = '', end = null;
      for (const it of L.items) {
        if (end != null) {
          const cw = it.w / Math.max(1, it.s.length);
          const gap = it.x - end;
          line += gap > cw * 1.6 ? ' '.repeat(Math.max(2, Math.min(40, Math.round(gap / Math.max(cw, 3))))) : (gap > cw * 0.25 || /\s$/.test(line) ? ' ' : '');
        }
        line += it.s; end = it.x + it.w;
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out.join('\n');
  }

  /* ---------- 整理成行程 ---------- */
  /** 依起飛時間排序，最大的停留空檔切成去程／回程 */
  function splitJourney(segs) {
    const key = (s) => (s.depDate || '') + 'T' + (s.depTime || '00:00');
    const a = segs.slice().sort((x, y) => key(x).localeCompare(key(y)));
    if (a.length < 2) return { out: a, ret: [] };
    let bi = -1, bg = 0;
    for (let i = 0; i < a.length - 1; i++) {
      const g = (Date.parse(key(a[i + 1]) + 'Z') - Date.parse((a[i].arrDate || a[i].depDate) + 'T' + (a[i].arrTime || '00:00') + 'Z')) / 36e5;
      if (g > bg) { bg = g; bi = i; }
    }
    if (bg < 12) return { out: a, ret: [] };
    return { out: a.slice(0, bi + 1), ret: a.slice(bi + 1) };
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

  const api = { itemsToText, parseTicketText, parseBCBP, splitJourney, loadAirports, matchAirport, splitTwoAirports, airportByCode, terminalName, termShort, ZH, addDays, daysBetween, findDates, findTimes, findFlights, detectSystem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TripTicket = api;
})(typeof window !== 'undefined' ? window : globalThis);
