"""
쿠팡 주문내역 크롤러 (GitHub Actions용)
- Firebase에 저장된 유저별 쿠팡 계정으로 주문내역 크롤링
- 수집 데이터를 users/{uid}/coupangOrders/{날짜} 에 저장
"""

import asyncio
import json
import os
import re
import base64
from datetime import datetime, timedelta
from playwright.async_api import async_playwright
import firebase_admin
from firebase_admin import credentials, db as rtdb

DATABASE_URL = "https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app"
COUPANG_ORDER_URL = "https://mc.coupang.com/ssr/desktop/order/list"

# ── Firebase ──────────────────────────────────────────────────────────────────
def init_firebase():
    if firebase_admin._apps:
        return
    key_json = os.environ.get("FIREBASE_KEY", "")
    if key_json:
        cred = credentials.Certificate(json.loads(key_json))
    elif os.path.exists("firebase_key.json"):
        cred = credentials.Certificate("firebase_key.json")
    else:
        raise Exception("Firebase 키 없음")
    firebase_admin.initialize_app(cred, {'databaseURL': DATABASE_URL})

def get_all_user_coupang():
    """쿠팡 계정이 등록된 유저 목록 반환"""
    users = []
    try:
        snap = rtdb.reference('users').get()
        if not snap:
            return users
        for uid, data in snap.items():
            if not isinstance(data, dict):
                continue
            coupang = data.get('coupangAccount', {})
            if coupang.get('email') and coupang.get('pw'):
                try:
                    # AES 암호화된 경우 서버에서는 btoa(base64)로 저장된 것을 디코딩
                    email = base64.b64decode(coupang['email']).decode('utf-8')
                    pw = base64.b64decode(coupang['pw']).decode('utf-8')
                    users.append({'uid': uid, 'email': email, 'pw': pw})
                    print(f"  유저 {uid[:8]}... 쿠팡 계정 발견")
                except Exception as e:
                    print(f"  유저 {uid[:8]}... 디코딩 실패: {e}")
    except Exception as e:
        print(f"  유저 목록 조회 실패: {e}")
    return users

# ── 주문내역 파싱 ─────────────────────────────────────────────────────────────
async def parse_order_page(page):
    """현재 페이지에서 주문 데이터 추출"""
    orders = []

    # 전체 페이지 텍스트 기반 파싱 (DOM 구조 변경에 강함)
    try:
        # 주문 블록들 찾기 - 여러 selector 시도
        order_selectors = [
            '.myorder-list .order-list-item',
            '[class*="order-list"] [class*="order-item"]',
            '.my-order-list__order',
            'section[class*="order"]',
        ]

        order_blocks = []
        for sel in order_selectors:
            blocks = await page.locator(sel).all()
            if blocks:
                print(f"  [파싱] selector '{sel}' → {len(blocks)}개 블록")
                order_blocks = blocks
                break

        if not order_blocks:
            # fallback: innerText 기반 파싱
            print("  [파싱] selector 실패 → innerText 기반 파싱")
            return await parse_order_by_text(page)

        for block in order_blocks:
            try:
                text = await block.inner_text()
                order = parse_order_text(text)
                if order and order.get('products'):
                    orders.append(order)
            except:
                continue

    except Exception as e:
        print(f"  [파싱] 오류: {e}")
        return await parse_order_by_text(page)

    return orders

async def parse_order_by_text(page):
    """innerText 기반 전체 파싱 (fallback)"""
    orders = []
    try:
        body_text = await page.inner_text('body')
        # "YYYY. M. D 주문" 패턴으로 주문 블록 분리
        blocks = re.split(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*주문)', body_text)

        current_date = ''
        for i, block in enumerate(blocks):
            date_match = re.match(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\s*주문', block.strip())
            if date_match:
                current_date = date_match.group(1).replace(' ', '')
                # 다음 블록이 상품 내용
                if i + 1 < len(blocks):
                    content = blocks[i + 1]
                    products = parse_products_from_text(content)
                    if products:
                        orders.append({
                            'order_date': current_date,
                            'products': products
                        })
    except Exception as e:
        print(f"  [텍스트파싱] 오류: {e}")

    return orders

def parse_order_text(text):
    """단일 주문 블록 텍스트에서 데이터 추출"""
    lines = text.strip().split('\n')
    order_date = ''
    products = []

    for line in lines:
        line = line.strip()
        if not line:
            continue
        # 날짜 패턴
        date_match = re.match(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\s*주문', line)
        if date_match:
            order_date = date_match.group(1).replace(' ', '')

    products = parse_products_from_text(text)

    if order_date and products:
        return {'order_date': order_date, 'products': products}
    return None

def parse_products_from_text(text):
    """텍스트에서 상품 정보 추출"""
    products = []
    lines = text.strip().split('\n')

    current_status = ''
    current_message = ''

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 배송상태 감지
        if line in ['배송완료', '배송중', '배송준비중', '취소완료', '반품완료', '교환완료']:
            current_status = line
            continue

        # 배송 메시지 (오늘 도착, 어제 도착 등)
        if '도착' in line or '전달' in line or '배송' in line:
            if len(line) < 50:  # 짧은 배송 메시지
                current_message = line
                continue

        # 상품명 + 수량 패턴 감지
        # 예: "밀키스 제로 탄산음료, 250ml, 30개"
        # 예: "세포랩 ... 2개"
        qty_match = re.search(r'(\d+)\s*개\s*$', line)
        if qty_match and len(line) > 5:
            qty = int(qty_match.group(1))
            product_name = line[:qty_match.start()].strip().rstrip(',').strip()
            if product_name and len(product_name) > 2:
                products.append({
                    'product_name': product_name,
                    'quantity': qty,
                    'delivery_status': current_status,
                    'delivery_message': current_message,
                })
                current_status = ''
                current_message = ''
                continue

        # 금액 패턴 (수량이 없는 경우 1개로 간주)
        price_match = re.search(r'([\d,]+)\s*원', line)
        if price_match and len(line) > 10 and '배송' not in line and '주문' not in line:
            # 이전에 수량 매칭 안 된 상품명일 수 있음
            pass

    return products

# ── 결제금액 추출 ─────────────────────────────────────────────────────────────
async def get_order_detail_amounts(page, detail_url):
    """주문 상세 페이지에서 결제금액, 배송비 추출"""
    try:
        await page.goto(detail_url, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        text = await page.inner_text('body')

        amounts = {}
        # 상품금액, 배송비, 총 결제금액 패턴
        for pattern, key in [
            (r'상품\s*금액.*?([\d,]+)\s*원', 'product_amount'),
            (r'배송비.*?([\d,]+)\s*원', 'shipping_fee'),
            (r'총\s*결제\s*금액.*?([\d,]+)\s*원', 'total_amount'),
            (r'결제\s*금액.*?([\d,]+)\s*원', 'total_amount'),
        ]:
            m = re.search(pattern, text)
            if m and key not in amounts:
                amounts[key] = int(m.group(1).replace(',', ''))

        return amounts
    except:
        return {}

# ── 메인 크롤링 ───────────────────────────────────────────────────────────────
async def crawl_coupang_orders(email, pw, save_path):
    today = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    debug_log = []  # Firebase에 저장할 디버그 로그
    print(f"  쿠팡 크롤링 시작 (계정: {email[:5]}***)")
    debug_log.append(f"크롤링 시작: {email[:5]}***")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage',
                  '--disable-blink-features=AutomationControlled',
                  '--disable-features=IsolateOrigins,site-per-process']
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) '
                       'Chrome/131.0.0.0 Safari/537.36',
            locale='ko-KR',
            timezone_id='Asia/Seoul',
        )
        # 봇 감지 우회
        page = await context.new_page()
        await page.add_init_script('''
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['ko-KR', 'ko', 'en-US', 'en']});
        ''')
        page.set_default_timeout(30000)

        try:
            # 1. 로그인 페이지
            print("  [1] 쿠팡 로그인")
            debug_log.append("[1] 로그인 시도")

            # 먼저 쿠팡 메인 페이지 방문 (사람처럼 행동)
            await page.goto("https://www.coupang.com", wait_until="domcontentloaded")
            await page.wait_for_timeout(3000 + int(2000 * __import__('random').random()))

            # 로그인 페이지로 이동
            await page.goto("https://login.coupang.com/login/login.pang?rtnUrl=https%3A%2F%2Fwww.coupang.com%2F", wait_until="domcontentloaded")
            await page.wait_for_timeout(5000 + int(3000 * __import__('random').random()))

            login_url = page.url
            debug_log.append(f"[1] URL: {login_url}")

            # 이메일/비밀번호 입력 - 여러 셀렉터 시도
            email_input = None
            pw_input = None

            email_selectors = ['#login-email-input', 'input[name="email"]', 'input[type="email"]', 'input[placeholder*="이메일"]', 'input[placeholder*="아이디"]']
            pw_selectors = ['#login-password-input', 'input[name="password"]', 'input[type="password"]']

            for sel in email_selectors:
                loc = page.locator(sel)
                if await loc.count() > 0:
                    email_input = loc.first
                    debug_log.append(f"[1] email 찾음: {sel}")
                    break

            for sel in pw_selectors:
                loc = page.locator(sel)
                if await loc.count() > 0:
                    pw_input = loc.first
                    debug_log.append(f"[1] pw 찾음: {sel}")
                    break

            # 그래도 못 찾으면 모든 visible input 시도
            if not email_input or not pw_input:
                all_inputs = page.locator('input:not([type="hidden"])')
                input_count = await all_inputs.count()
                debug_log.append(f"[1] visible input: {input_count}개")
                if input_count >= 2:
                    email_input = all_inputs.nth(0)
                    pw_input = all_inputs.nth(1)
                    debug_log.append("[1] input 순서로 할당")

            if not email_input or not pw_input:
                # 페이지 HTML 일부 저장 (디버깅)
                html_snippet = await page.evaluate('() => document.body.innerHTML.substring(0, 1000)')
                debug_log.append(f"[1] HTML: {html_snippet[:500]}")
                debug_log.append("[1] 이메일 필드 못 찾음")
                rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str})
                return 0

            # 사람처럼 천천히 입력
            await email_input.click()
            await page.wait_for_timeout(500 + int(500 * __import__('random').random()))
            for char in email:
                await email_input.type(char, delay=50 + int(100 * __import__('random').random()))
            await page.wait_for_timeout(800 + int(500 * __import__('random').random()))

            await pw_input.click()
            await page.wait_for_timeout(500 + int(500 * __import__('random').random()))
            for char in pw:
                await pw_input.type(char, delay=50 + int(100 * __import__('random').random()))
            await page.wait_for_timeout(1000 + int(500 * __import__('random').random()))
                await page.wait_for_timeout(300)

            # 로그인 버튼 클릭
            login_btn = page.locator('button[type="submit"], .login__button, [class*="login-btn"]')
            if await login_btn.count() > 0:
                await login_btn.first.click()
            else:
                await page.keyboard.press('Enter')

            await page.wait_for_timeout(3000)

            # 로그인 결과 확인
            current_url = page.url
            debug_log.append(f"[1] 로그인 후 URL: {current_url}")

            # SMS 인증 체크
            body_text = await page.inner_text('body')
            if '인증' in body_text and ('번호' in body_text or 'SMS' in body_text or '코드' in body_text):
                debug_log.append("[1] SMS 인증 요구됨")
                rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'sms_required'})
                return -1

            if 'login' in current_url.lower():
                debug_log.append("[1] 로그인 실패")
                rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'login_failed'})
                return 0

            debug_log.append("[1] 로그인 성공")

            # 2. 주문내역 페이지
            debug_log.append("[2] 주문내역 페이지 이동")
            await page.goto(COUPANG_ORDER_URL, wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)

            debug_log.append(f"[2] URL: {page.url}")

            # 3. 주문 데이터 파싱
            debug_log.append("[3] 주문 파싱 시작")
            orders = await parse_order_page(page)

            # 오늘/최근 주문만 필터
            today_orders = []
            yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y.%-m.%-d")
            today_str = datetime.now().strftime("%Y.%-m.%-d")

            for order in orders:
                # 날짜 정규화
                od = order.get('order_date', '').replace(' ', '')
                today_orders.append(order)

            total_products = sum(len(o.get('products', [])) for o in today_orders)
            debug_log.append(f"[3] 주문 {len(today_orders)}건, 상품 {total_products}개")

            # 4. Firebase 저장 (0건이어도 저장 + 디버그 로그 포함)
            save_data = {
                'date': today,
                'updated_at': now_str,
                'total_orders': len(today_orders),
                'total_products': total_products,
                'orders': today_orders,
                'login_url': current_url,
                'debug_log': debug_log,
            }
            rtdb.reference(f'{save_path}/{today}').set(save_data)
            print(f"  [4] Firebase 저장 완료 ({save_path}/{today}, {total_products}건)")

            return total_products

        except Exception as e:
            print(f"  오류: {e}")
            debug_log.append(f"오류: {str(e)}")
            try:
                rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'error', 'error': str(e)})
                await page.screenshot(path="coupang_error.png")
            except:
                pass
            return 0
        finally:
            await browser.close()

# ── 진입점 ────────────────────────────────────────────────────────────────────
async def main_async():
    init_firebase()
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 쿠팡 주문 크롤러 시작")

    users = get_all_user_coupang()
    if not users:
        print("\n쿠팡 계정이 등록된 유저 없음")
        return

    for user in users:
        print(f"\n유저 {user['uid'][:8]}... 크롤링 시작")
        try:
            count = await crawl_coupang_orders(
                user['email'], user['pw'],
                f"users/{user['uid']}/coupangOrders"
            )
            if count == -1:
                print(f"  ⚠️ SMS 인증 필요 - 수동 로그인 후 재시도")
            else:
                print(f"  완료: {count}개 상품")
        except Exception as e:
            print(f"  실패: {e}")

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()
