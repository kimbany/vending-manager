"""
쿠팡 주문내역 크롤러 (Self-hosted Runner용)
- undetected-chromedriver로 봇 감지 우회
- Firebase에 저장된 유저별 쿠팡 계정으로 주문내역 크롤링
- 수집 데이터를 users/{uid}/coupangOrders/{날짜} 에 저장
"""

import json
import os
import re
import time
import random
import base64
from datetime import datetime
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
                    email = base64.b64decode(coupang['email']).decode('utf-8')
                    pw = base64.b64decode(coupang['pw']).decode('utf-8')
                    users.append({'uid': uid, 'email': email, 'pw': pw})
                    print(f"  유저 {uid[:8]}... 쿠팡 계정 발견")
                except Exception as e:
                    print(f"  유저 {uid[:8]}... 디코딩 실패: {e}")
    except Exception as e:
        print(f"  유저 목록 조회 실패: {e}")
    return users

# ── 주문 파싱 ─────────────────────────────────────────────────────────────────
def parse_orders_from_text(text):
    """페이지 텍스트에서 주문 데이터 추출"""
    orders = []
    blocks = re.split(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*주문)', text)

    for i, block in enumerate(blocks):
        date_match = re.match(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\s*주문', block.strip())
        if date_match and i + 1 < len(blocks):
            order_date = date_match.group(1).replace(' ', '')
            content = blocks[i + 1]
            lines = content.strip().split('\n')
            products = []

            for line in lines:
                line = line.strip()
                if not line:
                    continue
                # "상품명, 옵션, N개" 패턴
                qty_match = re.search(r'(\d+)\s*개\s*$', line)
                if qty_match and len(line) > 5:
                    qty = int(qty_match.group(1))
                    name = line[:qty_match.start()].strip().rstrip(',').strip()
                    if name and len(name) > 2:
                        products.append({'product_name': name, 'quantity': qty})
                # 금액 패턴
                price_match = re.match(r'^([\d,]+)\s*원$', line)
                if price_match and products and 'price' not in products[-1]:
                    products[-1]['price'] = int(price_match.group(1).replace(',', ''))

            if products:
                orders.append({'order_date': order_date, 'products': products})

    return orders

# ── 메인 크롤링 (undetected-chromedriver) ─────────────────────────────────────
def crawl_coupang_orders(email, pw, save_path):
    import undetected_chromedriver as uc
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    today = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    debug_log = []
    print(f"  쿠팡 크롤링 시작 (계정: {email[:5]}***)")
    debug_log.append(f"크롤링 시작: {email[:5]}***")

    options = uc.ChromeOptions()
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--headless=new')
    options.add_argument('--window-size=1280,800')
    options.add_argument('--lang=ko-KR')

    driver = None
    try:
        driver = uc.Chrome(options=options, version_main=None)
        debug_log.append("[0] 브라우저 시작")

        # 1. 쿠팡 메인 방문 (사람처럼)
        debug_log.append("[1] 메인 페이지 방문")
        driver.get("https://www.coupang.com")
        time.sleep(3 + random.random() * 2)

        # 2. 로그인 페이지
        debug_log.append("[2] 로그인 페이지 이동")
        driver.get("https://login.coupang.com/login/login.pang?rtnUrl=https%3A%2F%2Fwww.coupang.com%2F")
        time.sleep(3 + random.random() * 3)

        login_url = driver.current_url
        debug_log.append(f"[2] URL: {login_url}")

        # 이메일 필드 찾기
        email_input = None
        pw_input = None
        selectors_email = ['#login-email-input', 'input[name="email"]', 'input[type="email"]']
        selectors_pw = ['#login-password-input', 'input[name="password"]', 'input[type="password"]']

        for sel in selectors_email:
            try:
                el = driver.find_element(By.CSS_SELECTOR, sel)
                if el.is_displayed():
                    email_input = el
                    debug_log.append(f"[2] email 찾음: {sel}")
                    break
            except:
                continue

        for sel in selectors_pw:
            try:
                el = driver.find_element(By.CSS_SELECTOR, sel)
                if el.is_displayed():
                    pw_input = el
                    debug_log.append(f"[2] pw 찾음: {sel}")
                    break
            except:
                continue

        if not email_input or not pw_input:
            # 모든 input 시도
            inputs = driver.find_elements(By.CSS_SELECTOR, 'input:not([type="hidden"])')
            visible = [i for i in inputs if i.is_displayed()]
            debug_log.append(f"[2] visible input: {len(visible)}개")
            if len(visible) >= 2:
                email_input = visible[0]
                pw_input = visible[1]
            else:
                html = driver.page_source[:500]
                debug_log.append(f"[2] HTML: {html}")
                debug_log.append("[2] 이메일 필드 못 찾음")
                rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'no_input'})
                return 0

        # 3. 로그인 입력 (사람처럼 천천히)
        debug_log.append("[3] 로그인 입력")
        email_input.click()
        time.sleep(0.5 + random.random() * 0.5)
        for char in email:
            email_input.send_keys(char)
            time.sleep(0.05 + random.random() * 0.1)

        time.sleep(0.8 + random.random() * 0.5)

        pw_input.click()
        time.sleep(0.5 + random.random() * 0.5)
        for char in pw:
            pw_input.send_keys(char)
            time.sleep(0.05 + random.random() * 0.1)

        time.sleep(1 + random.random() * 0.5)

        # 로그인 버튼 클릭
        login_btn = None
        for sel in ['button[type="submit"]', '.login__button', 'button.login__submit']:
            try:
                btn = driver.find_element(By.CSS_SELECTOR, sel)
                if btn.is_displayed():
                    login_btn = btn
                    break
            except:
                continue

        if login_btn:
            login_btn.click()
        else:
            pw_input.send_keys('\n')  # Enter로 로그인

        time.sleep(5 + random.random() * 2)

        current_url = driver.current_url
        debug_log.append(f"[3] 로그인 후 URL: {current_url}")

        # SMS 인증 체크
        body_text = driver.find_element(By.TAG_NAME, 'body').text
        if '인증' in body_text and ('번호' in body_text or 'SMS' in body_text):
            debug_log.append("[3] SMS 인증 요구됨")
            rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'sms_required'})
            return -1

        if 'login' in current_url.lower():
            debug_log.append("[3] 로그인 실패")
            rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'login_failed'})
            return 0

        debug_log.append("[3] 로그인 성공")

        # 4. 주문내역 페이지
        debug_log.append("[4] 주문내역 페이지 이동")
        driver.get(COUPANG_ORDER_URL)
        time.sleep(3 + random.random() * 2)
        debug_log.append(f"[4] URL: {driver.current_url}")

        # 5. 주문 파싱
        debug_log.append("[5] 주문 파싱")
        body_text = driver.find_element(By.TAG_NAME, 'body').text
        orders = parse_orders_from_text(body_text)

        total_products = sum(len(o.get('products', [])) for o in orders)
        debug_log.append(f"[5] 주문 {len(orders)}건, 상품 {total_products}개")

        # 6. Firebase 저장
        save_data = {
            'date': today,
            'updated_at': now_str,
            'total_orders': len(orders),
            'total_products': total_products,
            'orders': orders,
            'debug_log': debug_log,
        }
        rtdb.reference(f'{save_path}/{today}').set(save_data)
        print(f"  [6] Firebase 저장 완료 ({total_products}건)")

        return total_products

    except Exception as e:
        print(f"  오류: {e}")
        debug_log.append(f"오류: {str(e)}")
        try:
            rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'error', 'error': str(e)})
        except:
            pass
        return 0
    finally:
        if driver:
            try:
                driver.quit()
            except:
                pass

# ── 진입점 ────────────────────────────────────────────────────────────────────
def main():
    init_firebase()
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 쿠팡 주문 크롤러 시작 (undetected-chromedriver)")

    users = get_all_user_coupang()
    if not users:
        print("\n쿠팡 계정이 등록된 유저 없음")
        return

    for user in users:
        print(f"\n유저 {user['uid'][:8]}... 크롤링 시작")
        try:
            count = crawl_coupang_orders(
                user['email'], user['pw'],
                f"users/{user['uid']}/coupangOrders"
            )
            if count == -1:
                print(f"  ⚠️ SMS 인증 필요")
            else:
                print(f"  완료: {count}개 상품")
        except Exception as e:
            print(f"  실패: {e}")

if __name__ == "__main__":
    main()
