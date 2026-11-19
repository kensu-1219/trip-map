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
        db = {'東京晴空塔': (35.7101, 139.8107), '清水寺': (34.9949, 135.7850), '祇園': (35.0037, 135.7788), '一蘭 拉麵 新宿店': (35.6909, 139.7027)}
        res = []
        for k, (la, lo) in db.items():
            if k in q or q in k:
                res.append({'name': k, 'display_name': k + ', 日本', 'lat': str(la), 'lon': str(lo)})
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(res))
    if 'routes.googleapis.com' in url:
        calls['google'] += 1
        body = {'routes': [{'distanceMeters': 5200, 'duration': '1320s', 'polyline': {'encodedPolyline': ''}, 'legs': [{'steps': [
            {'travelMode': 'WALK', 'staticDuration': '240s'},
            {'travelMode': 'TRANSIT', 'transitDetails': {'stopCount': 4, 'transitLine': {'nameShort': '銀座線', 'color': '#f39700', 'vehicle': {'type': 'SUBWAY'}}, 'stopDetails': {'departureStop': {'name': '淺草'}, 'arrivalStop': {'name': '上野'}}}},
            {'travelMode': 'WALK', 'staticDuration': '180s'}]}]}]}
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
    if url.startswith(BASE):
        return route.continue_()
    return route.abort()

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
    first_leg = page.locator('.leg').first
    first_leg.locator('[data-mode=bike]').click()
    page.wait_for_timeout(800)
    on = page.locator('.leg').first.locator('.mode.on').get_attribute('data-mode')
    check('改交通方式為單車並保存', on == 'bike' and 'bike' in page.evaluate('Object.values(TripApp.trip().legModes)'))
    page.screenshot(path=f'{OUT}/08_day2_bike.png')

    # 7) 手動移動到別天 → 鎖定
    pid = page.evaluate('TripApp.C.dayStops(TripApp.trip(),2)[0].id')
    page.select_option(f'select.daysel[data-id="{pid}"]', '1')
    page.wait_for_timeout(200)
    check('手動移到 Day 1 並自動鎖定', page.evaluate(f'(()=>{{const p=TripApp.trip().places.find(x=>x.id=="{pid}");return p.day===1&&p.locked}})()'))
    page.click('[data-act=filter][data-d="0"]')
    page.click('[data-act=autoplan]'); page.click('[data-mact=ok]'); page.wait_for_timeout(300)
    check('重新自動排程後鎖定點仍在 Day 1', page.evaluate(f'TripApp.trip().places.find(x=>x.id=="{pid}").day') == 1)

    # 8) 量距離（無 Google 金鑰）
    page.click('#tabs button[data-tab=measure]')
    ids = page.evaluate("(()=>{const t=TripApp.trip();return [t.places.find(p=>p.name=='淺草寺').id,t.places.find(p=>p.name=='上野公園').id]})()")
    page.select_option('#mA', ids[0]); page.select_option('#mB', ids[1])
    page.wait_for_timeout(1500)
    mt = page.inner_text('#tabBody')
    check('量距離：四種交通方式都有結果', all(k in mt for k in ['步行', '單車', '開車', '大眾運輸']) and '直線距離' in mt)
    check('無金鑰時大眾運輸標示「估算」', '估算' in mt)
    page.screenshot(path=f'{OUT}/09_measure.png')

    # 9) 填 Google 金鑰 → 大眾運輸實際轉乘
    page.click('#btnSettings')
    page.fill('#sKey', 'AIzaFAKE-test-key')
    page.click('[data-mact=testKey]'); page.wait_for_timeout(500)
    check('金鑰測試成功訊息', '金鑰可用' in page.inner_text('#keyMsg'))
    page.click('[data-mact=ok]'); page.wait_for_timeout(1500)
    mt = page.inner_text('#tabBody')
    check('有金鑰時大眾運輸顯示路線（銀座線 淺草→上野）', '銀座線' in mt and 'Google' in mt, '')
    page.screenshot(path=f'{OUT}/10_measure_google_transit.png')

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
    check('iPhone Safari 未加主畫面 → 顯示提醒', sp.locator('.banner').count() == 1)
    sp.screenshot(path=f'{OUT}/14_welcome.png')
    sp.click('[data-act=sample]'); sp.wait_for_timeout(2500)
    body = sp.inner_text('#tabBody')
    check('範例行程：12 個地點排成 3 天', sp.evaluate('TripApp.trip().places.every(p=>p.day>=1)') and sp.evaluate('TripApp.trip().places.length') == 12)
    check('時間表：顯示 09:00 出發與每站時間', '09:00 出發' in body and '回到住宿' in body and re.search(r'\d\d:\d\d–\d\d:\d\d', body) is not None)
    check('整天導航連結含中途點', 'waypoints=' in (sp.locator('.day-tools a').first.get_attribute('href') or ''))
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
