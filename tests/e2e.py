"""端對端測試：本機伺服器 + 模擬外部服務（圖磚 / OSRM / Nominatim / Google Routes）。
執行：python3 tests/e2e.py  （輸出截圖到 tests/out/）
"""
import json, math, os, sys, threading, http.server, functools, io, re
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'out'); os.makedirs(OUT, exist_ok=True)
FIX = os.path.join(ROOT, 'tests', 'fixtures')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')

# ---- 本機伺服器 ----
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_port}/'

# ---- 模擬圖磚：依 z/x/y 畫網格與座標，看得出地圖在動 ----
def tile_png(z, x, y):
    im = Image.new('RGB', (256, 256), (238, 240, 233))
    d = ImageDraw.Draw(im)
    for i in range(0, 256, 64):
        d.line([(i, 0), (i, 256)], fill=(220, 223, 214)); d.line([(0, i), (256, i)], fill=(220, 223, 214))
    if (x + y) % 3 == 0: d.rectangle([30, 40, 120, 110], fill=(205, 228, 196))
    if (x * 7 + y) % 4 == 0: d.line([(0, 180), (256, 150)], fill=(255, 255, 255), width=8)
    d.text((6, 6), f'{z}/{x}/{y}', fill=(170, 170, 170))
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()

def hav(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, [a[1], a[0], b[1], b[0]])
    s = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(s))

calls = {'osrm': 0, 'nominatim': 0, 'google': 0, 'tiles': 0}
SPEED = {'routed-foot': 1.3, 'routed-bike': 4.0, 'routed-car': 8.0}

OFM = {'mode': 'ok'}

def handle(route):
    url = route.request.url
    if 'tile.openstreetmap.org' in url or 'cartocdn' in url:
        calls['tiles'] += 1
        m = re.search(r'/(\d+)/(\d+)/(\d+)', url)
        return route.fulfill(status=200, content_type='image/png', body=tile_png(*map(int, m.groups())))
    if 'routing.openstreetmap.de' in url:
        calls['osrm'] += 1
        m = re.search(r'/(routed-\w+)/route/v1/\w+/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)', url)
        prof = m.group(1); a = (float(m.group(2)), float(m.group(3))); b = (float(m.group(4)), float(m.group(5)))
        dist = hav(a, b) * 1.3
        mid = ((a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.15, (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.15)
        body = {'code': 'Ok', 'routes': [{'distance': dist, 'duration': dist / SPEED[prof], 'geometry': {'type': 'LineString', 'coordinates': [list(a), list(mid), list(b)]}}]}
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
    if 'nominatim.openstreetmap.org' in url:
        calls['nominatim'] += 1
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(url).query).get('q', [''])[0]
        db = {'東京晴空塔': (35.7101, 139.8107), '清水寺': (34.9949, 135.7850), '祇園': (35.0037, 135.7788), '一蘭 拉麵 新宿店': (35.6909, 139.7027), '羽田機場': (35.5494, 139.7798)}
        res = []
        for k, (la, lo) in db.items():
            if k in q or q in k:
                res.append({'name': k, 'display_name': k + ', 日本', 'lat': str(la), 'lon': str(lo)})
        if not res and q.endswith(' 東京') and '找不到' not in q:
            h = abs(hash(q)) % 1000
            res.append({'name': q[:-3], 'display_name': q[:-3] + ', 東京, 日本', 'lat': str(35.62 + (h % 100) / 1000), 'lon': str(139.68 + (h // 10) / 1000)})
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(res))
    if 'routes.googleapis.com' in url:
        calls['google'] += 1
        body = {'routes': [{'distanceMeters': 5200, 'duration': '1320s', 'travelAdvisory': {'transitFare': {'currencyCode': 'JPY', 'units': '210'}}, 'polyline': {'encodedPolyline': ''}, 'legs': [{'steps': [
            {'travelMode': 'WALK', 'staticDuration': '240s'},
            {'travelMode': 'TRANSIT', 'transitDetails': {'stopCount': 4, 'transitLine': {'nameShort': '銀座線', 'color': '#f39700', 'vehicle': {'type': 'SUBWAY'}}, 'stopDetails': {'departureStop': {'name': '淺草'}, 'arrivalStop': {'name': '上野'}}}},
            {'travelMode': 'WALK', 'staticDuration': '180s'}]}]}]}
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
    if 'places.googleapis.com/v1/places:searchNearby' in url:
        calls['gnearby'] = calls.get('gnearby', 0) + 1
        req = json.loads(route.request.post_data or '{}')
        c = req['locationRestriction']['circle']['center']
        body = {'places': [
            {'displayName': {'text': '測試拉麵 淺草店'}, 'location': {'latitude': c['latitude'] + 0.001, 'longitude': c['longitude']}, 'primaryType': 'ramen_restaurant', 'primaryTypeDisplayName': {'text': '拉麵店'}, 'rating': 4.3, 'userRatingCount': 812},
            {'displayName': {'text': '測試壽司'}, 'location': {'latitude': c['latitude'] + 0.003, 'longitude': c['longitude']}, 'primaryType': 'sushi_restaurant', 'primaryTypeDisplayName': {'text': '壽司店'}, 'rating': 4.6},
        ]}
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
    if 'places.googleapis.com/v1/places:searchText' in url:
        calls['gplaces'] = calls.get('gplaces', 0) + 1
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'places': []}))
    if 'wikipedia.org/w/api.php' in url:
        calls['wiki'] = calls.get('wiki', 0) + 1
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(url).query)
        q = qs.get('gsrsearch', [''])[0]
        known = {'淺草寺': (35.7148, 139.7967), '東京晴空塔': (35.7101, 139.8107), '明治神宮': (35.6764, 139.6993), '東京鐵塔': (35.6586, 139.7454), '上野公園': (35.7156, 139.7745)}
        pages = {}
        if q in known:
            la, lo = known[q]
            pages['1'] = {'index': 1, 'title': q, 'fullurl': 'https://zh.wikipedia.org/wiki/' + q, 'thumbnail': {'source': 'https://upload.wikimedia.org/wikipedia/commons/thumb/test/' + str(abs(hash(q)) % 1000) + '.jpg'}, 'coordinates': [{'lat': la, 'lon': lo}]}
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'query': {'pages': pages}} if pages else {}))
    if 'upload.wikimedia.org' in url:
        calls['wikiimg'] = calls.get('wikiimg', 0) + 1
        n = int(re.search(r'/(\d+)\.jpg', url).group(1)) if re.search(r'/(\d+)\.jpg', url) else 0
        im = Image.new('RGB', (320, 240), ((n * 37) % 200 + 30, (n * 91) % 200 + 30, (n * 53) % 200 + 30))
        d = ImageDraw.Draw(im)
        d.ellipse([90, 50, 230, 190], fill=(250, 240, 220)); d.rectangle([0, 190, 320, 240], fill=(60, 90, 60))
        b = io.BytesIO(); im.save(b, 'JPEG'); return route.fulfill(status=200, content_type='image/jpeg', body=b.getvalue())
    if 'overpass-api.de' in url:
        calls['overpass'] = calls.get('overpass', 0) + 1
        body = {'elements': [
            {'type': 'node', 'lat': 35.7152, 'lon': 139.7970, 'tags': {'name': '浅草今半', 'name:zh': '淺草今半', 'cuisine': 'sukiyaki', 'opening_hours': '11:30-21:30'}},
            {'type': 'node', 'lat': 35.7140, 'lon': 139.7955, 'tags': {'name': '大黒家天麩羅', 'cuisine': 'tempura'}},
            {'type': 'way', 'center': {'lat': 35.7160, 'lon': 139.7980}, 'tags': {'name': 'Asakusa Kagetsudo'}}]}
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
    if 'api.open-meteo.com' in url:
        calls['weather'] = calls.get('weather', 0) + 1
        from urllib.parse import urlparse, parse_qs
        d = parse_qs(urlparse(url).query).get('start_date', ['2026-01-01'])[0]
        body = {'daily': {'time': [d], 'weather_code': [61], 'temperature_2m_max': [14.2], 'temperature_2m_min': [7.8], 'precipitation_probability_max': [70]}}
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
    if 'tiles.openfreemap.org' in url:
        calls['ofm'] = calls.get('ofm', 0) + 1
        if OFM['mode'] == 'fail':
            return route.abort()
        h = {'Access-Control-Allow-Origin': '*'}
        if url.rstrip('/').endswith('/planet'):
            tj = {'tilejson': '2.2.0', 'tiles': ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'], 'minzoom': 0, 'maxzoom': 14, 'vector_layers': [{'id': x, 'fields': {}} for x in ['water', 'waterway', 'landcover', 'landuse', 'park', 'building', 'transportation', 'transportation_name', 'boundary', 'water_name', 'place', 'poi']]}
            return route.fulfill(status=200, content_type='application/json', headers=h, body=json.dumps(tj))
        return route.fulfill(status=200, content_type='application/x-protobuf', headers=h, body=b'')
    if url.startswith(BASE):
        return route.continue_()
    return route.abort()

def open_setup(pg):
    if pg.locator('.setup-sum').count():
        pg.click('.setup-sum .btn[data-act=setupToggle]'); pg.wait_for_timeout(200)

def wait_js(pg, expr, timeout=15000):
    """CSP 禁止 eval，所以不用 wait_for_function，改用 evaluate 輪詢"""
    import time as _t
    end = _t.time() + timeout / 1000
    while _t.time() < end:
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(150)
    raise TimeoutError('wait_js timeout: ' + expr)

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('✅' if cond else '❌'), name, detail)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    # iPhone 15 尺寸
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW')
    ctx.route('**/*', handle)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE)
    page.wait_for_selector('#tabBody')
    page.screenshot(path=f'{OUT}/01_empty.png')

    # 1) 貼上 Google 網址（多行）
    page.click('#tabs button[data-tab=add]')
    links = '\n'.join([
        'https://www.google.com/maps/place/%E6%B7%BA%E8%8D%89%E5%AF%BA/@35.7147651,139.7940803,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d35.7147651!4d139.7966552',
        'https://www.google.com/maps/place/%E4%B8%8A%E9%87%8E%E5%85%AC%E5%9C%92/@35.7156,139.7745,17z/data=!3d35.7156!4d139.7745',
        'https://www.google.com/maps/place/%E6%BE%80%E8%B0%B7%E5%8D%81%E5%AD%97%E8%B7%AF%E5%8F%A3/data=!3d35.6595!4d139.7005',
        'https://www.google.com/maps/place/%E6%98%8E%E6%B2%BB%E7%A5%9E%E5%AE%AE/data=!3d35.6764!4d139.6993',
        '35.6716, 139.7031',
        'https://www.google.com/maps/place/teamLab/data=!3d35.6491!4d139.7898',
        'https://www.google.com/maps/place/%E8%B1%90%E6%B4%B2%E5%B8%82%E5%A0%B4/data=!3d35.6455!4d139.7841',
    ])
    page.fill('#addInput', links)
    page.click('[data-act=addGo]')
    page.wait_for_timeout(400)
    n = page.evaluate('TripApp.trip().places.length')
    check('貼上 7 行 Google 網址/座標 → 加入 7 個地點', n == 7, f'實際 {n}')
    names = page.evaluate('TripApp.trip().places.map(p=>p.name)')
    check('從網址解出中文店名', '淺草寺' in names and '明治神宮' in names, ','.join(names))

    # 2) 短網址 → 用店名搜尋
    page.fill('#addInput', '一蘭 拉麵 新宿店\nhttps://maps.app.goo.gl/AbCdEf123')
    page.click('[data-act=addGo]')
    page.wait_for_selector('.result', timeout=5000)
    page.screenshot(path=f'{OUT}/02_short_link_search.png')
    page.click('.result')
    page.wait_for_timeout(300)
    check('短網址 → 以店名搜尋並加入', page.evaluate('TripApp.trip().places.length') == 8)

    # 3) 匯入中文檔名 Takeout CSV（含沒有座標的 → 地名查詢）
    page.set_input_files('#fileInput', os.path.join(FIX, '想去的地點.csv'))
    wait_js(page, 'TripApp.S.ui.geo && TripApp.S.ui.geo.done >= TripApp.S.ui.geo.total', 15000)
    page.wait_for_timeout(300)
    places = page.evaluate('TripApp.trip().places.map(p=>p.name)')
    check('匯入「想去的地點.csv」：有座標直接加、晴空塔用地名查到', '東京晴空塔' in places and '築地場外市場' in places, f'{len(places)} 個')
    check('重複地點（淺草寺）去重', places.count('淺草寺') == 1)
    page.screenshot(path=f'{OUT}/03_import_csv.png')

    # 4) 壞檔
    bad = os.path.join(OUT, '壞掉的檔案.json'); open(bad, 'w').write('{"type":"FeatureCollection","features":[{')
    page.set_input_files('#fileInput', bad)
    page.wait_for_selector('#modal:not([hidden])')
    msg = page.inner_text('#modalBody')
    check('壞檔顯示中文錯誤、不當機', 'JSON 格式錯誤' in msg, msg.replace('\n', ' ')[:60])
    page.screenshot(path=f'{OUT}/04_bad_file.png')
    page.click('[data-mact=close]')

    # 5) 設定住宿 + 自動排 3 天
    page.click('#tabs button[data-tab=plan]')
    page.click('[data-act=setBase]')
    page.select_option('#bSel', label='一蘭 拉麵 新宿店')
    page.click('[data-mact=ok]')
    open_setup(page)
    page.fill('#startDate', '2026-12-20'); page.dispatch_event('#startDate', 'change')
    page.click('[data-act=autoplan]')
    page.wait_for_timeout(1500)
    days = page.evaluate('[1,2,3].map(d=>TripApp.C.dayStops(TripApp.trip(),d).map(p=>p.name))')
    print('   分天結果:', days)
    check('自動排程：每天都有地點、全部排入', all(len(d) >= 2 for d in days) and sum(len(d) for d in days) == page.evaluate('TripApp.trip().places.length'))
    flat = {n: i for i, d in enumerate(days) for n in d}
    check('地理分群合理：澀谷/明治神宮/原宿同一天', flat.get('澀谷十字路口') == flat.get('明治神宮') == flat.get('地點 35.6716,139.7031'))
    check('地理分群合理：teamLab/豐洲同一天', flat.get('teamLab') == flat.get('豐洲市場'))
    page.wait_for_timeout(1500)
    check('呼叫路線服務（OSRM）取得實際路線', calls['osrm'] > 0, f"{calls['osrm']} 次")
    txt = page.inner_text('#tabBody')
    check('顯示日期與星期', '12/20（日）' in txt, '')
    check('顯示每天移動時間/距離', '移動' in txt and 'km' in txt)
    page.screenshot(path=f'{OUT}/05_plan_3days.png')
    page.click('#sheetHandle'); page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/06_plan_full.png')
    page.click('#sheetHandle'); page.wait_for_timeout(400)  # → peek
    page.screenshot(path=f'{OUT}/07_map_routes.png')
    page.click('#sheetHandle'); page.wait_for_timeout(300)  # → half

    # 6) 切換單日、改交通方式
    page.click('[data-act=filter][data-d="2"]')
    page.wait_for_timeout(300)
    page.locator('.leg .leg-mode').first.click()
    page.wait_for_selector('.mode-grid')
    check('交通方式視窗有 5 種（含計程車）', page.locator('.mode-opt').count() == 5 and '計程車' in page.inner_text('.mode-grid'))
    page.screenshot(path=f'{OUT}/08a_leg_editor.png')
    page.click('[data-mact=m_bike]')
    page.fill('#legNote', '沿隅田川騎，租借站在雷門旁')
    page.click('[data-mact=ok]'); page.wait_for_timeout(800)
    lt = page.locator('.leg').first.inner_text()
    check('改交通方式為單車並保存', '單車' in lt and 'bike' in page.evaluate('Object.values(TripApp.trip().legModes)'))
    check('每段備註顯示在行程中', '沿隅田川騎' in lt)
    page.locator('.leg .leg-mode').first.click(); page.wait_for_selector('.mode-grid')
    page.click('[data-mact=m_taxi]'); page.click('[data-mact=ok]'); page.wait_for_timeout(500)
    check('可選計程車', '計程車' in page.locator('.leg').first.inner_text())
    page.locator('.leg .leg-mode').first.click(); page.wait_for_selector('.mode-grid')
    page.click('[data-mact=m_bike]'); page.click('[data-mact=ok]'); page.wait_for_timeout(500)
    page.screenshot(path=f'{OUT}/08_day2_bike.png')

    # 7) 手動移動到別天 → 鎖定
    pid = page.evaluate('TripApp.C.dayStops(TripApp.trip(),2)[0].id')
    page.click('[data-act=reorder]')
    page.select_option(f'select.daysel[data-id="{pid}"]', '1')
    page.click('[data-act=reorder]')
    page.wait_for_timeout(200)
    check('手動移到 Day 1 並自動鎖定', page.evaluate(f'(()=>{{const p=TripApp.trip().places.find(x=>x.id=="{pid}");return p.day===1&&p.locked}})()'))
    page.click('[data-act=filter][data-d="0"]')
    page.click('[data-act=autoplan]'); page.click('[data-mact=ok]'); page.wait_for_timeout(300)
    check('重新自動排程後鎖定點仍在 Day 1', page.evaluate(f'TripApp.trip().places.find(x=>x.id=="{pid}").day') == 1)

    # 7a) 排好行程後，行程設定自動收成一列摘要，可展開
    check('排好行程後行程設定收成摘要列', page.locator('.setup-sum').count() == 1 and page.locator('[data-act=setAirport]').count() == 0)
    open_setup(page)
    check('按「修改」展開行程設定', page.locator('[data-act=setAirport]').count() == 2)
    # 7b) 去程／回程機場
    page.click('[data-act=setAirport][data-k=arrive]')
    page.fill('#aTime', '15:00'); page.fill('#aQ', '羽田機場'); page.click('[data-mact=search]'); page.wait_for_timeout(800)
    page.click('[data-mact=ok]'); page.wait_for_timeout(300)
    page.click('[data-act=setAirport][data-k=depart]')
    page.fill('#aTime', '17:00'); page.click('[data-mact=same]'); page.wait_for_timeout(300)
    page.click('[data-act=autoplan]'); page.click('[data-mact=ok]'); page.wait_for_timeout(1200)
    d1 = page.locator('.day[data-day="1"]').inner_text(); d3 = page.locator('.day[data-day="3"]').inner_text()
    check('Day 1 從羽田出發（落地 15:00 → 16:00 出關）', '羽田機場' in d1.split('\n')[1] + d1 and '16:00 出關' in d1 and '15:00 落地' in d1, d1.replace('\n', ' ')[:80])
    check('最後一天結束在羽田（17:00 起飛）', '到機場' in d3 and '17:00 起飛' in d3)
    n = page.evaluate('[1,2,3].map(d=>TripApp.C.dayStops(TripApp.trip(),d).length)')
    check('抵達日排的點比較少', n[0] < n[1], str(n))
    page.screenshot(path=f'{OUT}/08b_airports.png')
    page.evaluate("(()=>{const t=TripApp.trip();t.arrive=null;t.depart=null;t.arriveTime='';t.departTime='';})()")
    page.click('[data-act=filter][data-d="0"]')

    # 7c) 自動排行程後可「復原排程」
    before = page.evaluate('JSON.stringify(TripApp.trip().places.map(p=>[p.id,p.day,p.order]))')
    page.click('[data-act=autoplan]'); page.click('[data-mact=ok]'); page.wait_for_timeout(500)
    check('自動排程後出現「復原排程」按鈕', page.locator('[data-act=restorePlan]').count() == 1)
    page.click('[data-act=restorePlan]'); page.wait_for_timeout(400)
    after = page.evaluate('JSON.stringify(TripApp.trip().places.map(p=>[p.id,p.day,p.order]))')
    check('復原排程回到原本分天與順序', before == after)

    # 8) 量距離（無 Google 金鑰）
    page.click('#tabs button[data-tab=places]')
    check('量距離分頁已移除、改成「展示」', page.locator('#tabs button[data-tab=measure]').count() == 0 and page.locator('#tabs button[data-tab=present]').count() == 1)
    page.click('[data-act=measureOpen]')
    ids = page.evaluate("(()=>{const t=TripApp.trip();return [t.places.find(p=>p.name=='淺草寺').id,t.places.find(p=>p.name=='上野公園').id]})()")
    page.select_option('#mA', ids[0]); page.select_option('#mB', ids[1])
    page.wait_for_timeout(1500)
    mt = page.inner_text('#tabBody')
    check('量距離：四種交通方式都有結果', all(k in mt for k in ['步行', '單車', '開車', '大眾運輸']) and '直線距離' in mt)
    check('無金鑰時大眾運輸標示「估算」', '估算' in mt)
    page.screenshot(path=f'{OUT}/09_measure.png')

    # 9) 填 Google 金鑰 → 大眾運輸實際轉乘
    page.click('#btnSettings')
    page.fill('#sKey', ' AIzaFAKE-test-key\u200b')
    page.click('[data-mact=testKey]'); page.wait_for_timeout(500)
    km = page.inner_text('#keyMsg'); check('金鑰測試：Routes 與 Places 皆可用', 'Routes API 可用' in km and 'Places API 可用' in km)
    page.click('[data-mact=ok]'); page.wait_for_timeout(1500)
    mt = page.inner_text('#tabBody')
    check('有金鑰時大眾運輸顯示路線（銀座線 淺草→上野）', '銀座線' in mt and 'Google' in mt, '')
    check('顯示票價 ¥210', '¥210' in mt)
    page.screenshot(path=f'{OUT}/10_measure_google_transit.png')

    # 9b) 展示模式
    page.click('#tabs button[data-tab=present]'); page.wait_for_timeout(900)
    check('展示：右側天數條', page.locator('#pRail .pr-d').count() == page.evaluate('TripApp.trip().days'))
    page.click('#pRail .pr-d[data-d="2"]'); page.wait_for_timeout(900)
    check('展示：點 D2 只顯示該天並有站點卡片', page.evaluate('TripApp.S.ui.dayFilter') == 2 and page.locator('#pCards .pcard[data-i]').count() >= 2)
    check('展示：地圖上每段標交通方式與時間', page.locator('.leg-badge').count() >= 1)
    check('展示：卡片帶出備註', '沿隅田川騎' in page.inner_text('#pCards') or page.evaluate("Object.keys(TripApp.trip().legNotes).length") >= 1)
    page.screenshot(path=f'{OUT}/09c_present.png')
    page.click('#pCards .pcard[data-i="1"]'); page.wait_for_timeout(1000)
    check('展示：點卡片飛到該站', page.locator('#pCards .pcard.on').count() == 1)
    page.click('[data-act=pPlay]'); page.wait_for_timeout(3600)
    check('展示：播放自動前進', page.evaluate('TripApp.S.ui.present.idx') >= 1 and page.evaluate('TripApp.S.ui.present.playing') in (True, False))
    page.click('#pRail .pr-x'); page.wait_for_timeout(500)
    check('離開展示後恢復', page.locator('#presentUI').count() == 0 and page.locator('.leg-badge').count() == 0)

    # 10) 分享連結往返
    page.click('#btnShare'); page.wait_for_selector('#shareLink')
    link = page.input_value('#shareLink')
    check('產生壓縮分享連結', '#t=z' in link, f'{len(link)} 字元')
    page.screenshot(path=f'{OUT}/11_share.png')
    page.click('[data-mact=close]')
    page2 = br.new_context(viewport={'width': 393, 'height': 852}).new_page()
    page2.context.route('**/*', handle)
    page2.goto(link)
    page2.wait_for_selector('#modal:not([hidden])')
    page2.click('[data-mact=ok]'); page2.wait_for_timeout(300)
    n2 = page2.evaluate('TripApp.trip().places.length'); n1 = page.evaluate('TripApp.trip().places.length')
    check('另一台裝置開分享連結 → 匯入同樣地點與分天', n2 == n1 and page2.evaluate('TripApp.trip().base.name') == '一蘭 拉麵 新宿店', f'{n2}/{n1}')
    check('分享連結帶上每段備註', page2.evaluate("Object.values(TripApp.trip().legNotes).join()") == page.evaluate("Object.values(TripApp.trip().legNotes).join()") != '')
    page2.context.close()

    # 11) 重新整理後資料還在
    page.reload(); page.wait_for_selector('#tabBody'); page.wait_for_timeout(300)
    check('重新整理後資料保留', page.evaluate('TripApp.trip().places.length') == n1)

    # 12) 大檔：匯入 5000 筆 GeoJSON
    big = os.path.join(OUT, '大量地點.json')
    feats = [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [139.5 + (i % 100) * 0.006, 35.5 + (i // 100) * 0.006]}, 'properties': {'Title': f'地點{i}'}} for i in range(5000)]
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(big, 'w'), ensure_ascii=False)
    page.click('#btnSettings'); page.click('[data-mact=newTrip]'); page.fill('#askIn', '大檔測試'); page.click('[data-mact=ok]')
    import time; t0 = time.time()
    page.set_input_files('#fileInput', big)
    wait_js(page, 'TripApp.trip().places.length >= 5000', 30000)
    dt = time.time() - t0
    check('大檔 5000 筆匯入', True, f'{dt:.1f} 秒（{os.path.getsize(big)//1024} KB）')
    t0 = time.time(); page.click('[data-act=autoplan]'); page.wait_for_timeout(200)
    page.evaluate('TripApp.trip().days'); dt2 = time.time() - t0
    check('5000 點自動排程不卡死', page.evaluate('TripApp.trip().places.every(p=>p.day>=1)'), f'{dt2:.1f} 秒')
    page.screenshot(path=f'{OUT}/12_big_file.png')

    # 13) v1.1：範例行程、時間表、文字行程、復原、CSP
    sctx = br.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW',
                          user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    sctx.route('**/*', handle)
    sp = sctx.new_page(); serr = []
    sp.on('pageerror', lambda e: serr.append(str(e)))
    sp.on('console', lambda m: serr.append(m.text) if m.type == 'error' else None)
    sp.goto(BASE); sp.wait_for_selector('.welcome')
    check('空白時顯示歡迎畫面與範例按鈕', sp.locator('[data-act=sample]').count() == 1)
    sp.locator('.welcome [data-act=help]').click(); sp.wait_for_selector('.help-row')
    check('使用說明', sp.locator('.help-row').count() >= 8)
    sp.screenshot(path=f'{OUT}/30_help.png'); sp.click('[data-mact=close]')
    check('iPhone Safari 未加主畫面 → 顯示提醒', sp.locator('.banner').count() == 1)
    sp.screenshot(path=f'{OUT}/14_welcome.png')
    sp.click('[data-act=sample]'); sp.wait_for_timeout(2500)
    body = sp.inner_text('#tabBody')
    check('範例行程：12 個地點排成 3 天', sp.evaluate('TripApp.trip().places.every(p=>p.day>=1)') and sp.evaluate('TripApp.trip().places.length') == 12)
    wait_js(sp, "TripApp.trip().places.filter(p=>p.photo).length >= 4", 15000); sp.wait_for_timeout(400)
    check('地點照片：維基百科找到淺草寺、晴空塔等的照片', sp.evaluate("TripApp.trip().places.filter(p=>p.photo).length") >= 4 and sp.locator('.thumb').count() >= 3, str(sp.evaluate("TripApp.trip().places.filter(p=>p.photo).map(p=>p.name)")))
    check('找不到照片的地點顯示分類圖示（不亂抓）', sp.evaluate("TripApp.trip().places.find(p=>p.name=='台場').photo") is None)
    check('時間表：顯示 09:00 出發與每站時間', '09:00 出發' in body and '回到住宿' in body and re.search(r'\d\d:\d\d–\d\d:\d\d', body) is not None)
    check('整天導航連結含中途點', 'waypoints=' in (sp.locator('.day-tools a').first.get_attribute('href') or ''))
    open_setup(sp)
    sp.fill('#dayStart', '08:00'); sp.dispatch_event('#dayStart', 'change'); sp.wait_for_timeout(300)
    check('改每天出門時間 → 時間表跟著變', '08:00 出發' in sp.inner_text('#tabBody'))
    sp.screenshot(path=f'{OUT}/15_sample_timeline.png')
    txt = sp.evaluate('TripApp.tripText()')
    check('文字行程含每天標題、時間、Google 連結', '【Day 1' in txt and '08:00 從住宿出發' in txt and 'google.com/maps' in txt, f'{len(txt)} 字')
    before = sp.evaluate('TripApp.trip().places.length')
    pid = sp.evaluate('TripApp.trip().places[0].id')
    sp.click(f'.stop[data-id="{pid}"] [data-act=edit]'); sp.click('[data-mact=del]'); sp.wait_for_timeout(200)
    check('刪除後出現「復原」按鈕', sp.locator('#toast button').count() == 1)
    sp.screenshot(path=f'{OUT}/16_undo_toast.png')
    sp.click('#toast button'); sp.wait_for_timeout(200)
    check('按復原 → 地點回來', sp.evaluate('TripApp.trip().places.length') == before)
    sp.click('#btnShare'); sp.click('[data-mact=text]'); sp.wait_for_selector('#txtOut')
    sp.screenshot(path=f'{OUT}/17_text_itinerary.png')
    check('v1.1 頁面沒有錯誤（含 CSP 違規）', not serr, '; '.join(serr[:3]))
    sctx.close()

    # 15) v1.3：分類圖示、打卡、營業時間、清單、主題、今天模式、天氣、面板拖曳
    vctx = br.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW')
    vctx.route('**/*', handle)
    vp = vctx.new_page(); verr = []
    vp.on('pageerror', lambda e: verr.append(str(e)))
    vp.on('console', lambda m: verr.append(m.text) if m.type == 'error' else None)
    vp.goto(BASE); vp.wait_for_selector('.welcome', state='attached'); vp.click('[data-act=sample]'); vp.wait_for_timeout(2000)
    cats = vp.evaluate('Object.fromEntries(TripApp.trip().places.map(p=>[p.name,p.cat]))')
    check('分類自動判斷（淺草寺=寺廟、晴空塔=展望、築地=市場、teamLab=美術館）', cats['淺草寺'] == 'temple' and cats['東京晴空塔'] == 'view' and cats['築地場外市場'] == 'market' and cats['teamLab Planets'] == 'museum', str(cats)[:120])
    check('地圖標記顯示分類圖示、不再有擋畫面的號碼', vp.locator('.pin use[href="#i-c_temple"]').count() >= 1 and vp.locator('.pin em').count() == 0)
    vp.evaluate("document.querySelector('#map').classList.add('show-labels')")
    check('放大後地名標籤帶順序號碼', vp.locator('.leaflet-tooltip.plabel b').count() >= 10)
    vp.evaluate("document.querySelector('#map').classList.remove('show-labels')")
    # 營業時間警告：把每天出門時間改到 05:00 → 淺草寺 06:00 才開
    open_setup(vp)
    vp.fill('#dayStart', '04:30'); vp.dispatch_event('#dayStart', 'change'); vp.wait_for_timeout(300)
    check('營業時間衝突警告（太早到）', vp.locator('.warnline').count() >= 1, vp.locator('.warnline').first.inner_text() if vp.locator('.warnline').count() else '')
    open_setup(vp)
    vp.fill('#dayStart', '09:00'); vp.dispatch_event('#dayStart', 'change'); vp.wait_for_timeout(200)
    check('預估總花費顯示', '預估總花費 ¥' in vp.inner_text('#tabBody'))
    first = vp.evaluate('TripApp.C.dayStops(TripApp.trip(),1)[0].id')
    vp.click(f'.stop[data-id="{first}"] [data-act=toggleDone]'); vp.wait_for_timeout(200)
    check('打卡：標記已去過、地圖標記變灰', vp.evaluate(f'TripApp.trip().places.find(p=>p.id=="{first}").done') and vp.locator('.pin.done').count() == 1)
    vp.screenshot(path=f'{OUT}/19_categories_done.png')
    # 編輯分類
    vp.click(f'.stop[data-id="{first}"] [data-act=edit]'); vp.click('.catopt[data-cat=food]'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(150)
    check('編輯時可改分類', vp.evaluate(f'TripApp.trip().places.find(p=>p.id=="{first}").cat') == 'food')
    # 地點分頁分類篩選
    vp.click('#tabs button[data-tab=places]'); vp.click('[data-act=catFilter][data-c=temple]'); vp.wait_for_timeout(150)
    n_t = vp.locator('#tabBody .stop').count()
    check('地點分頁可依分類篩選', n_t == sum(1 for v in vp.evaluate('TripApp.trip().places.map(p=>p.cat)') if v == 'temple') and n_t >= 1, f'{n_t} 個')
    vp.screenshot(path=f'{OUT}/20_places_filter.png')
    # 清單
    vp.click('#tabs button[data-tab=list]'); vp.click('[data-act=listSeg][data-k=pack]'); vp.click('[data-act=clTemplate]'); vp.wait_for_timeout(150)
    nCl = vp.evaluate('TripApp.trip().checklist.length')
    vp.fill('#clInput', '日幣零錢包'); vp.fill('#clGroup', '金錢'); vp.press('#clInput', 'Enter'); vp.wait_for_timeout(150)
    vp.locator('[data-act=clToggle]').first.click(); vp.wait_for_timeout(100)
    check('行前清單：載入範本、新增、勾選', nCl >= 15 and vp.evaluate('TripApp.trip().checklist.length') == nCl + 1 and vp.evaluate('TripApp.trip().checklist[0].done'))
    vp.screenshot(path=f'{OUT}/21_checklist.png')
    # 主題切換（每趟旅程）
    vp.click('#btnSettings'); vp.click('.themeopt[data-theme=neon]'); vp.wait_for_timeout(150)
    check('主題預覽即時套用', vp.evaluate('document.documentElement.dataset.theme') == 'neon')
    vp.screenshot(path=f'{OUT}/22_theme_picker.png')
    vp.click('[data-mact=ok]'); vp.wait_for_timeout(200)
    vp.click('#tabs button[data-tab=plan]'); vp.wait_for_timeout(300)
    vp.screenshot(path=f'{OUT}/23_theme_neon.png')
    # 另一趟旅程用不同主題
    vp.evaluate("(()=>{})()")
    vp.select_option('#tripSelect', index=0); vp.wait_for_timeout(200)
    check('切換到另一趟旅程 → 主題回到該旅程設定', vp.evaluate('document.documentElement.dataset.theme') in ('clean', 'night'))
    vp.select_option('#tripSelect', index=1); vp.wait_for_timeout(200)
    check('切回範例旅程 → 霓虹主題', vp.evaluate('document.documentElement.dataset.theme') == 'neon')
    for th in ['washi', 'tide', 'relic']:
        vp.click('#btnSettings'); vp.click(f'.themeopt[data-theme={th}]'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(250)
        vp.screenshot(path=f'{OUT}/24_theme_{th}.png')
    # 新主題：觀光繪地圖、機械紀錄（風格底圖連不到時要退回一般地圖）
    for th in ['illust', 'nier']:
        vp.click('#btnSettings'); vp.click(f'.themeopt[data-theme={th}]'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(300)
        check(f'{th} 主題切換有過場動畫', vp.locator('#themeFx').count() == 1)
        for _ in range(40):
            if vp.evaluate('!!(window.__vecFail || window.__vecFirstMs) && !document.querySelector(".leaflet-tile-pane img.leaflet-tile")'): break
            vp.wait_for_timeout(500)
        st = vp.evaluate("[document.documentElement.dataset.theme, document.documentElement.dataset.style, !!window.maplibregl, document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile').length, window.__vecFail||'', (window.__vecErrs||[]).slice(0,3)]")
        check(f'{th} 主題套用、風格底圖載入完成後移除一般圖磚', st[0] == th and st[2] and st[3] == 0 and st[4] == '' and vp.evaluate("document.documentElement.classList.contains('vec-ready') && !!document.querySelector('.leaflet-tile-pane canvas')"), str(st))
        vp.screenshot(path=f'{OUT}/24_theme_{th}.png')
        vp.evaluate("document.querySelector('#tabs button[data-tab=plan]').click()"); vp.wait_for_timeout(300)
        vp.evaluate("document.getElementById('tabBody').scrollTop = 420"); vp.wait_for_timeout(200)
        vp.screenshot(path=f'{OUT}/24_theme_{th}_panel.png')
        vp.evaluate("window.__vecFail=''; window.__vecFirstMs=0")
    vp.click('#btnSettings'); vp.click('.themeopt[data-theme=relic]'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(300)
    # 今天模式＋天氣：出發日設成今天
    import datetime
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    open_setup(vp)
    vp.fill('#startDate', today); vp.dispatch_event('#startDate', 'change'); vp.wait_for_timeout(400)
    vp.reload(); vp.wait_for_selector('#tabBody'); vp.wait_for_timeout(1500)
    body = vp.inner_text('#tabBody')
    check('今天模式：顯示「今天是 DAY 01」與下一站', ('今天是第 1 天' in body or '今天是DAY01' in body.replace(' ', '')) and '下一站' in body)
    check('今天模式：自動只看今天', vp.evaluate('TripApp.S.ui.dayFilter') == 1)
    check('天氣：顯示預報（Open-Meteo）', vp.locator('.wx').count() >= 1 and '8°/14°' in vp.inner_text('.wx'), vp.inner_text('.wx') if vp.locator('.wx').count() else '')
    vp.screenshot(path=f'{OUT}/25_today_weather.png')
    # 面板拖曳
    h0 = vp.evaluate("document.querySelector('#panel').getBoundingClientRect().height")
    hb = vp.locator('#sheetHandle').bounding_box()
    x, y = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
    vp.mouse.move(x, y); vp.mouse.down()
    for k in range(1, 11): vp.mouse.move(x, y + 30 * k); vp.wait_for_timeout(16)
    vp.mouse.up(); vp.wait_for_timeout(500)
    h1 = vp.evaluate("document.querySelector('#panel').getBoundingClientRect().height")
    check('面板往下拖 → 變矮（地圖變大）', h1 < h0 - 100, f'{h0:.0f}px → {h1:.0f}px')
    vp.screenshot(path=f'{OUT}/26_sheet_dragged.png')
    hb = vp.locator('#sheetHandle').bounding_box(); x, y = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
    vp.mouse.move(x, y); vp.mouse.down()
    for k in range(1, 16): vp.mouse.move(x, y - 40 * k); vp.wait_for_timeout(16)
    vp.mouse.up(); vp.wait_for_timeout(500)
    h2 = vp.evaluate("document.querySelector('#panel').getBoundingClientRect().height")
    check('面板往上拖 → 變高', h2 > h1 + 200, f'{h1:.0f}px → {h2:.0f}px')
    vp.reload(); vp.wait_for_selector('#tabBody'); vp.wait_for_timeout(600)
    h3 = vp.evaluate("document.querySelector('#panel').getBoundingClientRect().height")
    check('重新整理後記住面板高度', abs(h3 - h2) < 30, f'{h3:.0f}px')
    # v1.4：附近搜尋、行事曆
    vp.click('#tabs button[data-tab=places]'); vp.click('[data-act=catFilter][data-c=""]')
    sid = vp.evaluate("TripApp.trip().places.find(p=>p.name=='淺草寺').id")
    vp.evaluate(f"document.querySelector('[data-act=focus][data-id=\"{sid}\"]').click()"); vp.wait_for_timeout(700)
    vp.click('.leaflet-popup [data-act=nearbyFrom]'); vp.wait_for_timeout(300)
    vp.click('[data-act=nearbyKind][data-k=food]'); vp.wait_for_timeout(1500)
    nb = vp.inner_text('#tabBody')
    check('附近搜尋：從淺草寺找餐廳，中文名優先、依距離排序', '淺草今半' in nb and '大黒家天麩羅' in nb and nb.index('大黒家天麩羅') < nb.index('Asakusa Kagetsudo'), nb[:80].replace('\n', ' '))
    check('附近結果標在地圖上', vp.locator('.npin').count() == 3)
    before = vp.evaluate('TripApp.trip().places.length')
    vp.locator('[data-act=nearbyAdd]').first.click(); vp.wait_for_timeout(200)
    added = vp.evaluate('TripApp.trip().places[TripApp.trip().places.length-1]')
    check('附近結果一鍵加入（分類＝餐廳）', vp.evaluate('TripApp.trip().places.length') == before + 1 and added['cat'] == 'food', added['name'])
    check('附近結果自動帶入每週營業時間', added.get('hoursWeek') and added['hoursWeek'][1] == '11:30-21:30')
    vp.screenshot(path=f'{OUT}/27_nearby.png')
    # 有 Google 金鑰時改用 Google 附近搜尋（評分、類型）
    vp.evaluate("TripApp.S.data.settings.gkey='AIzaFAKE-nearby'")
    vp.click('[data-act=nearbyKind][data-k=cafe]'); vp.wait_for_timeout(300); vp.click('[data-act=nearbyKind][data-k=food]'); vp.wait_for_timeout(1200)
    nb2 = vp.inner_text('#tabBody')
    check('有金鑰時附近搜尋用 Google（含評分、來源標示）', '測試拉麵 淺草店' in nb2 and '★4.3' in nb2 and 'Google 地圖' in nb2, nb2[:120].replace('\n', ' '))
    vp.evaluate("TripApp.S.data.settings.gkey=''")
    vp.click('#btnShare'); vp.wait_for_selector('[data-mact=ics]')
    with vp.expect_download() as dl:
        vp.click('[data-mact=ics]')
    dname = dl.value.suggested_filename
    vp.wait_for_timeout(300)
    check('行事曆檔名＝旅程名稱.ics', dname.endswith('.ics') and '東京' in dname, dname)
    ics = vp.evaluate('TripApp.S.ui.lastIcs || ""')
    check('匯出行事曆 .ics（每站一個事件、含時間）', ics.count('BEGIN:VEVENT') >= 12 and 'DTSTART:' in ics, f"{ics.count('BEGIN:VEVENT')} 個事件")
    vp.click('[data-mact=close]')
    # v1.5：拖曳排序
    vp.click('#tabs button[data-tab=plan]'); vp.wait_for_timeout(200)
    vp.click('[data-act=filter][data-d="2"]'); vp.wait_for_timeout(200)
    vp.click('[data-act=reorder]'); vp.wait_for_timeout(200)
    order0 = vp.evaluate('TripApp.C.dayStops(TripApp.trip(),2).map(p=>p.name)')
    grips = vp.locator('.day .stop.can-drag .grip')
    vp.evaluate("document.querySelectorAll('.day .stop.can-drag')[0].scrollIntoView({block:'start'})"); vp.wait_for_timeout(200)
    g0 = grips.nth(0).bounding_box(); g1 = grips.nth(1).bounding_box()
    vp.mouse.move(g0['x'] + 8, g0['y'] + 10); vp.mouse.down()
    steps = 10
    for k in range(1, steps + 1): vp.mouse.move(g0['x'] + 8, g0['y'] + 10 + (g1['y'] - g0['y'] + 12) * k / steps); vp.wait_for_timeout(16)
    vp.mouse.up(); vp.wait_for_timeout(300)
    order1 = vp.evaluate('TripApp.C.dayStops(TripApp.trip(),2).map(p=>p.name)')
    check('拖曳排序：把第 1 站拖到第 2 站之後', order1[:3] == [order0[1], order0[0], order0[2]], ' → '.join(order0[:3]) + ' ⇒ ' + ' → '.join(order1[:3]))
    vp.screenshot(path=f'{OUT}/28_reorder_mode.png')
    vp.click('#toast button'); vp.wait_for_timeout(200)
    check('拖曳排序可復原', vp.evaluate('TripApp.C.dayStops(TripApp.trip(),2).map(p=>p.name)') == order0)
    vp.click('[data-act=reorder]')
    # v1.7：每晚不同住宿
    vp.click('[data-act=filter][data-d="0"]'); vp.wait_for_timeout(200)
    vp.locator('[data-act=dayHotel][data-d="2"]').first.click(); vp.wait_for_selector('#bSel')
    vp.select_option('#bSel', label='台場'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(300)
    check('設定 Day 2 晚上住宿', vp.evaluate("TripApp.trip().dayBase[2] && TripApp.trip().dayBase[2].name") == '台場')
    vp.click('[data-act=autoplan]'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(800)
    e3 = vp.evaluate("(()=>{const e=TripApp.C.dayEnds(TripApp.trip(),3);return [e.start.name,e.end.name]})()")
    check('Day 3 從台場出發、回到預設住宿', e3 == ['台場', '新宿站附近飯店'], str(e3))
    body = vp.inner_text('#tabBody')
    check('時間表顯示「入住」與「退房」', '入住' in body and '退房' in body)
    check('地圖顯示兩間住宿標記', vp.locator('.pin.base').count() == 2)
    txt = vp.evaluate('TripApp.tripText()')
    check('文字行程含每晚住宿', 'Day 2 晚上住：台場' in txt and '入住 台場' in txt)
    vp.screenshot(path=f'{OUT}/29_multi_hotel.png')
    # v1.8：導航 App 選擇
    vp.click('#tabs button[data-tab=plan]'); vp.wait_for_timeout(200)
    nav = vp.locator('.leg a.navlink').first
    nav.scroll_into_view_if_needed(); nav.click(); vp.wait_for_selector('.navpick')
    ap = vp.get_attribute('.navpick [data-pick=apple]', 'href'); gg = vp.get_attribute('.navpick [data-pick=google]', 'href')
    check('按導航 → 詢問 Apple 地圖或 Google 地圖', ap.startswith('https://maps.apple.com/?saddr=') and 'dirflg=' in ap and gg.startswith('https://www.google.com/maps/dir/'))
    vp.screenshot(path=f'{OUT}/31_nav_choice.png')
    vp.check('#navRemember')
    with vctx.expect_page() as newp:
        vp.click('.navpick [data-pick=apple]')
    newp.value.close()
    vp.wait_for_timeout(200)
    check('記住選擇 Apple 地圖', vp.evaluate('TripApp.S.data.settings.navApp') == 'apple')
    reqs = []
    vctx.on('request', lambda r: reqs.append(r.url) if 'maps.apple.com' in r.url or 'google.com/maps' in r.url else None)
    with vctx.expect_page() as newp2:
        vp.locator('.leg a.navlink').first.click()
    vp.wait_for_timeout(300); newp2.value.close()
    check('之後按導航直接開 Apple 地圖（不再詢問）', any('maps.apple.com' in u for u in reqs) and vp.locator('.navpick').count() == 0, (reqs or [''])[0][:60])
    # v1.9：貼文字變行程
    vp.click('#tabs button[data-tab=add]'); vp.wait_for_timeout(200)
    vp.click('[data-act=itinToggle]')
    vp.fill('#itinInput', open(os.path.join(FIX, 'chatgpt_zh.txt'), encoding='utf8').read().replace('澀谷十字路口', '找不到的地方'))
    vp.click('[data-act=itinParse]'); vp.wait_for_selector('.itin-day')
    check('貼上 ChatGPT 行程 → 解析出 3 天', vp.locator('.itin-day').count() == 3 and vp.input_value('#itinCity') == '東京')
    vp.screenshot(path=f'{OUT}/32_itin_preview.png')
    vp.uncheck('[data-itin="2:4"]')  # 取消 SHIBUYA SKY
    vp.select_option('#itinTarget', 'new')
    vp.click('[data-act=itinRun]')
    wait_js(vp, "!!(TripApp.S.ui.itin && TripApp.S.ui.itin.done)", 40000); vp.wait_for_timeout(300)
    dd = vp.evaluate("[1,2,3].map(d=>TripApp.C.dayStops(TripApp.trip(),d).map(p=>p.name))")
    check('建立新旅程並排進對應天數', dd[0][:2] == ['淺草寺', '淺草今半'] and dd[2][0] == '築地場外市場' and 'SHIBUYA SKY' not in sum(dd, []), str(dd))
    check('找不到的地點列出來', '找不到的地方' in vp.inner_text('#tabBody'))
    vp.screenshot(path=f'{OUT}/33_itin_done.png')
    vp.click('[data-act=itinView]'); vp.wait_for_timeout(500)
    # v1.10：地圖 ⇄ 清單連動
    vp.click('#tabs button[data-tab=plan]'); vp.click('[data-act=filter][data-d="0"]'); vp.wait_for_timeout(300)
    vp.evaluate("document.querySelector('#tabBody').scrollTop = 0"); vp.wait_for_timeout(200)
    vp.evaluate("(()=>{const b=document.querySelector('#tabBody');const r=b.querySelectorAll('.stop[data-id]')[5];b.scrollTop += r.getBoundingClientRect().top - b.getBoundingClientRect().top;})()")
    vp.wait_for_timeout(900)
    hl = vp.evaluate("(document.querySelector('.leaflet-marker-icon.hl')||{}).title || ''")
    act = vp.evaluate("(()=>{const r=document.querySelector('#tabBody .stop.active');return r? r.querySelector('a').textContent:''})()")
    check('捲動清單 → 地圖突顯同一站', hl != '' and hl == act, f'{act} / {hl}')
    vp.screenshot(path=f'{OUT}/34_list_sync.png')
    pid = vp.evaluate("TripApp.C.dayStops(TripApp.trip(),1)[0].id")
    nm = vp.evaluate(f"TripApp.trip().places.find(p=>p.id=='{pid}').name")
    vp.evaluate(f"document.querySelector('.leaflet-marker-icon[title=\"{nm}\"]').click()"); vp.wait_for_timeout(900)
    vis = vp.evaluate(f"(()=>{{const r=document.querySelector('#tabBody .stop[data-id=\"{pid}\"]').getBoundingClientRect();const b=document.querySelector('#tabBody').getBoundingClientRect();return r.top>=b.top-2 && r.bottom<=b.bottom+2}})()")
    check('點地圖標記 → 清單捲到那張卡片', vis and vp.locator('.leaflet-popup').count() == 1, nm)
    # v1.11：預訂與分帳
    import datetime as _dt
    td = _dt.datetime.now().strftime('%Y-%m-%d')
    vp.click('#tabs button[data-tab=list]'); vp.click('[data-act=listSeg][data-k=book]'); vp.wait_for_timeout(150)
    vp.click('[data-act=bkEdit][data-id=""]'); vp.wait_for_selector('#bk_title')
    vp.fill('#bk_title', 'BR198 桃園→成田'); vp.fill('#bk_date', td); vp.fill('#bk_time', '08:30'); vp.fill('#bk_code', 'ABC123'); vp.fill('#bk_cost', '12000')
    vp.click('[data-mact=ok]'); vp.wait_for_timeout(200)
    vp.click('[data-act=bkEdit][data-id=""]'); vp.click('#bkType .catopt[data-cat=hotel]'); vp.fill('#bk_title', '新宿華盛頓飯店'); vp.fill('#bk_date', td); vp.fill('#bk_time', '15:00')
    vp.click('[data-mact=ok]'); vp.wait_for_timeout(200)
    check('新增預訂（機票、住宿）', vp.evaluate('TripApp.trip().bookings.length') == 2 and 'ABC123' in vp.inner_text('#tabBody'))
    vp.screenshot(path=f'{OUT}/35_bookings.png')
    vp.click('#tabs button[data-tab=plan]'); vp.wait_for_timeout(300)
    check('預訂出現在當天行程', vp.locator('.bkchip').count() == 2 and '入住 新宿華盛頓飯店' in vp.inner_text('#tabBody'))
    check('總花費含預訂', '含預訂 12,000' in vp.inner_text('#tabBody'))
    vp.click('#tabs button[data-tab=list]'); vp.click('[data-act=listSeg][data-k=split]'); vp.wait_for_timeout(150)
    for nm in ['Amy', 'Bob']:
        vp.fill('#memInput', nm); vp.press('#memInput', 'Enter'); vp.wait_for_timeout(100)
    vp.fill('#exTitle', '晚餐'); vp.fill('#exAmount', '3000'); vp.select_option('#exPayer', '我'); vp.click('[data-act=exAdd]'); vp.wait_for_timeout(150)
    vp.fill('#exTitle', '計程車'); vp.fill('#exAmount', '1000'); vp.select_option('#exPayer', 'Amy')
    vp.uncheck('#exSplit input[value="我"]'); vp.click('[data-act=exAdd]'); vp.wait_for_timeout(200)
    st = vp.inner_text('#tabBody')
    check('分帳：3 人、2 筆、算出誰該給誰', vp.evaluate('TripApp.trip().expenses.length') == 2 and 'Bob' in st and '怎麼還最省事' in st, st[st.find('怎麼還'):st.find('怎麼還') + 60].replace('\n', ' '))
    tr = vp.evaluate("TripApp.C.settle(TripApp.trip().members, TripApp.trip().expenses).transfers.map(x=>x.from+'>'+x.to+':'+x.amount)")
    check('結算正確（Amy 給我 500、Bob 給我 1500）', sorted(tr) == ['Amy>我:500', 'Bob>我:1500'], str(tr))
    vp.screenshot(path=f'{OUT}/36_split.png')
    # 備註標記匯入：第幾晚住宿、午／晚餐
    vp.click('#btnSettings'); vp.click('[data-mact=newTrip]'); vp.fill('#askIn', '北海道備註'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(300)
    vp.set_input_files('#fileInput', os.path.join(FIX, '北海道_備註標記.json')); vp.wait_for_timeout(800)
    info = vp.evaluate("(()=>{const t=TripApp.trip();return {d:t.days,h1:t.dayBase[1]&&t.dayBase[1].name,h3:t.dayBase[3]&&t.dayBase[3].name,n:t.places.length,meal:t.places.filter(p=>p.meal).map(p=>p.name+':'+p.meal+':'+p.day)}})()")
    check('備註「第1-2晚」「第3晚」設成住宿，天數自動變 4', info['h1'] == 'JR Tower 日航' and info['h3'] == '洞爺湖飯店' and info['d'] == 4 and info['n'] == 8, str(info))
    check('備註「D1 晚餐」「午餐」標成用餐', '羊八:dinner:1' in info['meal'] and any(x.startswith('湯咖哩 GARAKU:lunch') for x in info['meal']), str(info['meal']))
    vp.click('#tabs button[data-tab=plan]'); vp.click('[data-act=autoplan]'); vp.wait_for_timeout(300)
    if vp.locator('#modal:not([hidden]) [data-mact=ok]').count(): vp.click('[data-mact=ok]')
    vp.wait_for_timeout(800)
    d1 = vp.evaluate('TripApp.C.dayStops(TripApp.trip(),1).map(p=>p.name)')
    check('Day 1 晚餐（羊八）排在最後', d1 and d1[-1] == '羊八', str(d1))
    check('洞爺湖的點排在住洞爺湖前後（Day 3/4）', vp.evaluate("TripApp.trip().places.find(p=>p.name=='昭和新山').day") in (3, 4))
    vp.screenshot(path=f'{OUT}/37_note_tags.png')
    # 天數多時晶片換行，不用左右滑
    open_setup(vp)
    for _ in range(8): vp.click('[data-act=days][data-d="1"]')
    vp.wait_for_timeout(300)
    box = vp.evaluate("(()=>{const c=document.querySelector('.route-bar .chips');return [c.scrollWidth,c.clientWidth,c.getBoundingClientRect().height]})()")
    check('12 天的天數晶片換行顯示（不用橫向捲動）', box[0] <= box[1] + 2 and box[2] > 50, str(box))
    dot = vp.evaluate("getComputedStyle(document.querySelector('.route-bar .chip[data-d=\"1\"]'),'::before').backgroundColor")
    check('天數晶片的色點正常顯示（HTML 屬性沒壞）', dot not in ('rgba(0, 0, 0, 0)', 'transparent') and vp.locator('.route-bar .chip[data-d="1"] .en').count() == 1, dot)
    vp.locator('.route-bar').scroll_into_view_if_needed(); vp.screenshot(path=f'{OUT}/38_day_chips.png')
    # 刪除某一天
    nd = vp.evaluate('TripApp.trip().days')
    vp.locator('[data-act=dayMenu][data-d="2"]').click(); vp.click('[data-mact=remove]'); vp.wait_for_timeout(300)
    check('刪除第 2 天：天數 −1、該天地點回到未排', vp.evaluate('TripApp.trip().days') == nd - 1)
    vp.click('#toast button'); vp.wait_for_timeout(300)
    check('刪除天數可以復原', vp.evaluate('TripApp.trip().days') == nd)
    check('v1.3 頁面沒有錯誤', not verr, '; '.join(verr[:3]))
    # 機票匯入（假機票，中文檔名）：Amadeus 範本 → 預訂、機場、出發日、出門時間
    vp.click('#btnSettings'); vp.click('[data-mact=newTrip]'); vp.fill('#askIn', '東京機票測試'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(300)
    vp.evaluate("(()=>{TripApp.S.data.settings.home={name:'台北車站',lat:25.0478,lng:121.517}; TripApp.S.data.settings.checkin=150;})()")
    vp.evaluate("document.querySelector('#tabs button[data-tab=add]').click()"); vp.wait_for_timeout(300)
    vp.set_input_files('#ticketInput', os.path.join(FIX, '假機票_Amadeus_TPE-NRT.pdf'))
    vp.wait_for_selector('.tk-seg', timeout=20000)
    segs = vp.locator('.tk-seg').all_inner_texts()
    check('機票 PDF：讀到去程、回程兩段（Amadeus 範本）', len(segs) == 2 and 'CI100' in segs[0] and '成田' in segs[0] and 'T2' in segs[0] and 'CI101' in segs[1], ' | '.join(segs))
    vp.screenshot(path=f'{OUT}/40_ticket_confirm.png')
    vp.click('[data-mact=ok]'); vp.wait_for_timeout(600)
    tk = vp.evaluate("(()=>{const t=TripApp.trip();return {sd:t.startDate,days:t.days,arr:t.arrive&&t.arrive.name,at:t.arriveTime,dep:t.depart&&t.depart.name,dt:t.departTime,bk:(t.bookings||[]).filter(b=>b.type==='flight').map(b=>b.title+'|'+b.code),fl:t.flights&&[t.flights.out.length,t.flights.ret.length]}})()")
    check('匯入後：出發日 3/1、6 天、去回程機場與時間、兩筆航班預訂', tk['sd'] == '2027-03-01' and tk['days'] == 6 and '成田' in (tk['arr'] or '') and tk['at'] == '12:25' and tk['dt'] == '13:40' and len(tk['bk']) == 2 and 'TST9QZ' in tk['bk'][0], str(tk))
    vp.evaluate("document.querySelector('#tabs button[data-tab=plan]').click()"); vp.wait_for_timeout(500)
    d1 = vp.locator('.day[data-day="1"]').inner_text()
    check('第 1 天：從家出門、桃園 T2 05:40 報到、CI100 航班列', '出門' in d1 and '05:40 報到' in d1 and 'CI100' in d1 and '桃園機場' in d1, d1.replace('\n', ' ')[:160])
    d6 = vp.locator('.day[data-day="6"]').inner_text()
    check('最後一天：CI101 航班與到家時間', 'CI101' in d6 and '到家' in d6, d6.replace('\n', ' ')[:160])
    vp.locator('.day[data-day="1"]').scroll_into_view_if_needed(); vp.screenshot(path=f'{OUT}/41_ticket_day1.png')
    # 登機證截圖（QR 條碼）
    vp.evaluate("document.querySelector('#tabs button[data-tab=add]').click()"); vp.wait_for_timeout(300)
    vp.set_input_files('#ticketInput', os.path.join(FIX, '假登機證_QR.png'))
    vp.wait_for_selector('.tk-seg', timeout=20000)
    qs = vp.locator('.tk-seg').all_inner_texts()
    check('登機證截圖：解出條碼 CI100 TPE→NRT、座位 41C', len(qs) == 1 and 'CI100' in qs[0] and '41C' in qs[0] and '成田' in qs[0], ' | '.join(qs))
    vp.click('[data-mact=close]')
    # 風格底圖連不到 → 退回一般地圖
    OFM['mode'] = 'fail'
    vp.evaluate("window.__vecFail=''")
    vp.click('#btnSettings'); vp.click('.themeopt[data-theme=illust]'); vp.click('[data-mact=ok]'); vp.wait_for_timeout(300)
    for _ in range(40):
        if vp.evaluate('!!window.__vecFail'): break
        vp.wait_for_timeout(500)
    fb = vp.evaluate("[window.__vecFail||'', document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile').length]")
    check('風格底圖連不到時，自動退回一般地圖（不會一片空白）', fb[0] != '' and fb[1] > 0, str(fb))
    OFM['mode'] = 'ok'
    vctx.close()

    # 14) 桌機版面
    dctx = br.new_context(viewport={'width': 1366, 'height': 800}, locale='zh-TW')
    dctx.route('**/*', handle)
    dp = dctx.new_page(); dp.goto(link); dp.wait_for_selector('#modal:not([hidden])'); dp.click('[data-mact=ok]'); dp.wait_for_timeout(2000)
    dp.screenshot(path=f'{OUT}/13_desktop.png')

    check('沒有 JavaScript 錯誤', not [e for e in errors if 'favicon' not in e], '; '.join(errors[:3]))
    br.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} 通過；外部呼叫（模擬）：{calls}')
sys.exit(1 if fails else 0)
