"""
쿠팡 주문내역 크롤러 (nodriver - CDP 직접 통신)
- nodriver로 봇 감지 우회
- Firebase에 저장된 유저별 쿠팡 계정으로 주문내역 크롤링
"""

import json
import os
import re
import asyncio
import random
import base64
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, db as rtdb

DATABASE_URL = "https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app"
COUPANG_ORDER_URL = "https://mc.coupang.com/ssr/desktop/order/list"

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

def parse_orders_from_text(text):
    orders = []
    blocks = re.split(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*주문)', text)
    for i, block in enumerate(blocks):
        date_match = re.match(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.\s*주문', block.strip())
        if date_match and i + 1 < len(blocks):
            order_date = date_match.group(1).replace(' ', '')
            content = blocks[i + 1]
            lines = content.strip().split('\n')
            products = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                qty_match = re.search(r'(\d+)\s*개\s*$', line)
                if qty_match and len(line) > 5:
                    qty = int(qty_match.group(1))
                    name = line[:qty_match.start()].strip().rstrip(',').strip()
                    if name and len(name) > 2:
                        products.append({'product_name': name, 'quantity': qty})
                price_match = re.match(r'^([\d,]+)\s*원$', line)
                if price_match and products and 'price' not in products[-1]:
                    products[-1]['price'] = int(price_match.group(1).replace(',', ''))
            if products:
                orders.append({'order_date': order_date, 'products': products})
    return orders

def ensure_display():
    """Xvfb 가상 디스플레이 확보 + 메모리 정리"""
    import subprocess, os
    # 기존 크롬 프로세스 정리 (메모리 확보)
    subprocess.run(['pkill', '-f', 'chrome'], capture_output=True)
    subprocess.run(['pkill', '-f', 'chromium'], capture_output=True)
    if not os.environ.get('DISPLAY'):
        os.environ['DISPLAY'] = ':99'
        print(f"  DISPLAY 설정: {os.environ['DISPLAY']}")

async def crawl_coupang_orders(email, pw, save_path):
    import nodriver as uc

    today = datetime.now(tz=__import__('datetime').timezone(__import__('datetime').timedelta(hours=9))).strftime("%Y-%m-%d")
    now_str = datetime.now(tz=__import__('datetime').timezone(__import__('datetime').timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S")
    debug_log = []
    print(f"  쿠팡 크롤링 시작 (계정: {email[:5]}***)")
    debug_log.append(f"크롤링 시작: {email[:5]}***")

    ensure_display()

    browser = None
    try:
        browser = await uc.start(sandbox=False, headless=False)
        debug_log.append("[0] 브라우저 시작 (nodriver)")

        # 1. 쿠팡 메인 방문
        debug_log.append("[1] 메인 페이지 방문")
        page = await browser.get("https://www.coupang.com")
        await asyncio.sleep(3 + random.random() * 2)

        # 2. 로그인 페이지
        debug_log.append("[2] 로그인 페이지 이동")
        page = await browser.get("https://login.coupang.com/login/login.pang?rtnUrl=https%3A%2F%2Fwww.coupang.com%2F")
        await asyncio.sleep(4 + random.random() * 2)

        # 이메일/비밀번호 입력
        email_input = await page.select('input[name=email]')
        pw_input = await page.select('input[name=password]')

        if not email_input or not pw_input:
            debug_log.append("[2] 이메일/비밀번호 필드 못 찾음")
            try:
                text = await page.evaluate('document.body.innerText')
                debug_log.append(f"[2] 페이지: {text[:200]}")
            except:
                pass
            rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'no_input'})
            return 0

        debug_log.append("[2] 로그인 필드 찾음")

        # 3. 로그인 입력
        debug_log.append("[3] 로그인 입력")
        await email_input.click()
        await asyncio.sleep(0.5 + random.random() * 0.5)
        await email_input.send_keys(email)
        await asyncio.sleep(0.8 + random.random() * 0.5)

        await pw_input.click()
        await asyncio.sleep(0.5 + random.random() * 0.5)
        await pw_input.send_keys(pw)
        await asyncio.sleep(1 + random.random() * 0.5)

        # 로그인 버튼 클릭
        try:
            login_btn = await page.select('button[type=submit]')
            if login_btn:
                await login_btn.click()
            else:
                await pw_input.send_keys('\n')
        except:
            await pw_input.send_keys('\n')

        await asyncio.sleep(5 + random.random() * 2)

        # 로그인 결과 확인
        try:
            current_text = await page.evaluate('document.body.innerText')
            debug_log.append(f"[3] 로그인 후 텍스트: {current_text[:100]}")
        except:
            current_text = ''

        # SMS 인증 체크
        if '인증' in current_text and ('번호' in current_text or 'SMS' in current_text):
            debug_log.append("[3] SMS 인증 요구됨")
            rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'sms_required'})
            return -1

        # 여전히 로그인 페이지인지 확인
        try:
            still_login = await page.select('input[name=email]')
            if still_login:
                debug_log.append("[3] 로그인 실패 (아직 로그인 페이지)")
                rtdb.reference(f'{save_path}/_debug').set({'log': debug_log, 'updated_at': now_str, 'status': 'login_failed'})
                return 0
        except:
            pass

        debug_log.append("[3] 로그인 성공")

        # 4. 주문내역 페이지
        debug_log.append("[4] 주문내역 페이지 이동")
        page = await browser.get(COUPANG_ORDER_URL)
        await asyncio.sleep(10 + random.random() * 3)

        # 페이지 완전 로딩 대기 (JS 렌더링)
        for retry in range(5):
            try:
                order_text = await page.evaluate('document.body.innerText')
                if len(order_text) > 300:
                    break
                debug_log.append(f"[4] 로딩 대기 중... ({len(order_text)}자, {retry+1}/5)")
                await asyncio.sleep(3)
            except:
                await asyncio.sleep(3)
                order_text = ''

        # 스크롤 다운 (더 많은 주문 로드)
        try:
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            await asyncio.sleep(3)
        except:
            pass

        try:
            order_text = await page.evaluate('document.body.innerText')
            debug_log.append(f"[4] 최종 텍스트 길이: {len(order_text)}")
            debug_log.append(f"[4] 텍스트: {order_text[:500]}")
        except:
            order_text = ''

        # 5. 주문 파싱
        debug_log.append("[5] 주문 파싱")
        orders = parse_orders_from_text(order_text)
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
        if browser:
            try:
                browser.stop()
            except:
                pass

async def main_async():
    init_firebase()
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 쿠팡 주문 크롤러 시작 (nodriver)")

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
                print(f"  ⚠️ SMS 인증 필요")
            else:
                print(f"  완료: {count}개 상품")
        except Exception as e:
            print(f"  실패: {e}")

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()
