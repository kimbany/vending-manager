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

def parse_day_block(text):
    """
    주문내역 일별 디테일 div의 innerText를 파싱해서
    {order_date, products:[{product_name, quantity, price}]} 1건을 반환
    """
    if not text:
        return None
    # 날짜 추출
    date_match = re.search(r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})', text)
    if not date_match:
        return None
    y, m, d = date_match.group(1), date_match.group(2).zfill(2), date_match.group(3).zfill(2)
    order_date = f"{y}.{m}.{d}"

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    products = []
    for line in lines:
        # "상품명, 옵션, N개" 형태
        qty_match = re.search(r'(\d+)\s*개\s*$', line)
        if qty_match and len(line) > 5:
            qty = int(qty_match.group(1))
            name = line[:qty_match.start()].strip().rstrip(',').strip()
            # 날짜/상태/결제방식 라인 제외
            if name and len(name) > 2 and '주문' not in name and '배송' not in name:
                products.append({'product_name': name, 'quantity': qty})
            continue
        # 금액 라인
        price_match = re.match(r'^([\d,]+)\s*원$', line)
        if price_match and products and 'price' not in products[-1]:
            products[-1]['price'] = int(price_match.group(1).replace(',', ''))

    if not products:
        return None
    return {'order_date': order_date, 'products': products}


def parse_orders_from_text(text):
    """(구버전 호환) 전체 innerText 블록에서 여러 주문 추출"""
    orders = []
    blocks = re.split(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*주문)', text)
    for i, block in enumerate(blocks):
        date_match = re.match(r'(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.\s*주문', block.strip())
        if date_match and i + 1 < len(blocks):
            parsed = parse_day_block(blocks[i].strip() + '\n' + blocks[i + 1])
            if parsed:
                orders.append(parsed)
    return orders

def ensure_display():
    """Xvfb 가상 디스플레이 확보 + 메모리/락 정리"""
    import subprocess, os, glob, shutil
    # 기존 크롬 프로세스 정리 (메모리 확보)
    subprocess.run(['pkill', '-f', 'chrome'], capture_output=True)
    subprocess.run(['pkill', '-f', 'chromium'], capture_output=True)
    subprocess.run(['pkill', '-f', 'nodriver'], capture_output=True)
    # 남은 Chrome 임시 프로필 / 락 파일 정리 (nodriver 연결 실패 원인)
    for pattern in [
        '/tmp/.org.chromium.Chromium*',
        '/tmp/.com.google.Chrome*',
        '/tmp/nodriver*',
        '/tmp/scoped_dir*',
    ]:
        for p in glob.glob(pattern):
            try:
                if os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
                else:
                    os.remove(p)
            except Exception:
                pass
    if not os.environ.get('DISPLAY'):
        os.environ['DISPLAY'] = ':99'
        print(f"  DISPLAY 설정: {os.environ['DISPLAY']}")


async def _start_browser_with_retry(debug_log, attempts=3):
    """nodriver 브라우저를 clean state + 재시도로 기동"""
    import nodriver as uc
    import shutil, tempfile, os

    # Chrome 실행 경로 자동 탐지
    chrome_path = None
    for cand in [
        shutil.which('google-chrome'),
        shutil.which('google-chrome-stable'),
        shutil.which('chromium'),
        shutil.which('chromium-browser'),
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
    ]:
        if cand and os.path.exists(cand):
            chrome_path = cand
            break
    debug_log.append(f"[0] chrome_path: {chrome_path or '(auto)'}")

    # 최신 Chrome 안정판 User-Agent (Akamai 봇 탐지 우회용)
    real_ua = (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/131.0.0.0 Safari/537.36'
    )
    browser_args = [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-networking',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees,IsolateOrigins,site-per-process',
        '--window-size=1280,800',
        '--lang=ko-KR',
        f'--user-agent={real_ua}',
        '--accept-lang=ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    ]

    last_err = None
    for i in range(1, attempts + 1):
        # 매 시도마다 신규 user-data-dir (락 충돌 방지)
        user_data_dir = tempfile.mkdtemp(prefix='nodriver_coupang_')
        try:
            kwargs = {
                'sandbox': False,
                'headless': False,
                'user_data_dir': user_data_dir,
                'browser_args': browser_args,
            }
            if chrome_path:
                kwargs['browser_executable_path'] = chrome_path
            browser = await uc.start(**kwargs)
            debug_log.append(f"[0] 브라우저 기동 성공 (시도 {i}/{attempts})")
            return browser
        except Exception as e:
            last_err = e
            debug_log.append(f"[0] 브라우저 기동 실패 {i}/{attempts}: {str(e)[:200]}")
            # 실패 후 정리
            try:
                shutil.rmtree(user_data_dir, ignore_errors=True)
            except Exception:
                pass
            import subprocess as _sp
            _sp.run(['pkill', '-9', '-f', 'chrome'], capture_output=True)
            _sp.run(['pkill', '-9', '-f', 'chromium'], capture_output=True)
            await asyncio.sleep(3)
    raise RuntimeError(f"브라우저 기동 3회 실패: {last_err}")

async def _xpath_click(page, xpath):
    """document.evaluate로 XPath 노드 클릭"""
    js = f'''(() => {{
        const r = document.evaluate({json.dumps(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const el = r.singleNodeValue;
        if (!el) return false;
        el.click();
        return true;
    }})()'''
    try:
        return bool(await page.evaluate(js))
    except Exception:
        return False


MAX_PAGES = 10


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
        browser = await _start_browser_with_retry(debug_log)

        # 1. 쿠팡 메인 방문 (Akamai WAF sensor 설정 / 쿠키 수집)
        debug_log.append("[1] 메인 페이지 방문: https://www.coupang.com/")
        page = await browser.get("https://www.coupang.com/")
        await asyncio.sleep(5 + random.random() * 3)

        # 자연스러운 사용자 행동 시뮬레이션 (Akamai 사람 감지)
        try:
            await page.evaluate('window.scrollTo({top: 400, behavior: "smooth"})')
            await asyncio.sleep(1.5 + random.random())
            await page.evaluate('window.scrollTo({top: 800, behavior: "smooth"})')
            await asyncio.sleep(1.5 + random.random())
            await page.evaluate('window.scrollTo({top: 0, behavior: "smooth"})')
            await asyncio.sleep(1 + random.random())
        except:
            pass

        # 메인 페이지가 제대로 로드됐는지 (차단 아닌지) 확인
        try:
            main_text = await page.evaluate('document.body.innerText')
            if 'Access Denied' in main_text or 'Reference #' in main_text:
                debug_log.append(f"[1] 메인 페이지도 차단됨: {main_text[:200]}")
                rtdb.reference(f'{save_path}/_debug').set({
                    'log': debug_log, 'updated_at': now_str,
                    'status': 'waf_blocked_main',
                    'text_sample': main_text[:500],
                })
                return 0
        except:
            pass

        # 2. 로그인 페이지로 이동
        #    Akamai WAF가 login.coupang.com 직접 접근(browser.get)을 차단하는
        #    경우가 있음 → location.href 할당으로 현재 탭 내부 네비게이션 수행
        #    (Referer: www.coupang.com + 기존 Akamai 센서 쿠키 유지)
        debug_log.append("[2] 로그인 페이지 이동 (location.href 방식)")
        login_url = "https://login.coupang.com/login/login.pang?rtnUrl=https%3A%2F%2Fwww.coupang.com%2F"
        try:
            await page.evaluate(f'location.href = {json.dumps(login_url)}')
        except Exception as _e:
            debug_log.append(f"[2] location.href 실패, browser.get 폴백: {_e}")
            try:
                page = await browser.get(login_url)
            except Exception as _e2:
                debug_log.append(f"[2] browser.get도 실패: {_e2}")
        await asyncio.sleep(5 + random.random() * 2)

        # 페이지 확인 + 차단 감지
        try:
            cur = await page.evaluate('location.href')
            debug_log.append(f"[2] URL: {cur}")
        except:
            cur = ''

        try:
            body_text = await page.evaluate('document.body.innerText')
        except:
            body_text = ''

        # Akamai WAF 차단 감지 → 모바일 로그인으로 폴백
        if 'Access Denied' in body_text or ("Reference #" in body_text and 'permission' in body_text.lower()):
            debug_log.append(f"[2] 데스크탑 로그인 차단 감지 → 모바일 로그인 시도")
            try:
                mobile_login = "https://login.coupang.com/login/loginMember.pang?rtnUrl=https%3A%2F%2Fm.coupang.com%2F"
                await page.evaluate(f'location.href = {json.dumps(mobile_login)}')
            except:
                try:
                    page = await browser.get("https://m.coupang.com/")
                    await asyncio.sleep(4)
                    await page.evaluate('location.href = "https://login.coupang.com/login/loginMember.pang"')
                except Exception as _e:
                    debug_log.append(f"[2] 모바일 폴백 실패: {_e}")
            await asyncio.sleep(5 + random.random() * 2)
            try:
                cur = await page.evaluate('location.href')
                body_text = await page.evaluate('document.body.innerText')
                debug_log.append(f"[2] 모바일 URL: {cur}")
            except:
                pass

        # 여전히 차단됐으면 종료
        if 'Access Denied' in body_text or ("Reference #" in body_text and 'permission' in body_text.lower()):
            debug_log.append(f"[2] 로그인 페이지 차단 유지: {body_text[:200]}")
            rtdb.reference(f'{save_path}/_debug').set({
                'log': debug_log, 'updated_at': now_str,
                'status': 'waf_blocked_login',
                'url': cur,
                'text_sample': body_text[:500],
            })
            return 0

        # 3. 이메일/비밀번호 입력
        #    전략 우선순위:
        #      (a) nodriver CSS select: #login-email-input / #login-password-input
        #      (b) nodriver CSS select: input[name=email|password]
        #      (c) 사용자 제공 XPath (label>span>input 래핑 구조)
        #      (d) 타입 기반 최종 폴백: input[type=email|password]
        email_input = await page.select('#login-email-input')
        pw_input = await page.select('#login-password-input')
        if not email_input:
            email_input = await page.select('input[name=email]')
        if not pw_input:
            pw_input = await page.select('input[name=password]')

        filled_via = 'nodriver'
        if not email_input or not pw_input:
            # (c) XPath + JS native setter 폴백
            debug_log.append("[3] CSS select 실패 → XPath/JS 폴백 시도")
            # nodriver evaluate의 반환 타입이 환경/모드에 따라 다르므로
            # JS 내부에서 JSON.stringify 하여 항상 문자열로 받고 Python에서 파싱.
            js_fill_body = r'''(() => {
                const xpEmail = __XP_EMAIL__;
                const xpPw = __XP_PW__;
                const emailVal = __EMAIL__;
                const pwVal = __PW__;
                const getXp = (xp) => {
                    try {
                        return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    } catch (_) { return null; }
                };
                const fill = (el, val) => {
                    if (!el) return false;
                    try {
                        el.focus();
                        const proto = window.HTMLInputElement.prototype;
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                        setter.call(el, val);
                        el.dispatchEvent(new Event('input', {bubbles: true}));
                        el.dispatchEvent(new Event('change', {bubbles: true}));
                        el.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
                        return true;
                    } catch (e) { return false; }
                };
                // 후보 수집: XPath → 표준 속성 → 타입/placeholder/autocomplete 기반
                let e = getXp(xpEmail);
                if (!e) e = document.querySelector('input[name=email]');
                if (!e) e = document.querySelector('input[type=email]');
                if (!e) e = document.querySelector('input[autocomplete=username]');
                if (!e) e = document.querySelector('input[id*="email" i]');
                if (!e) e = document.querySelector('input[placeholder*="이메일"],input[placeholder*="아이디"]');
                let p = getXp(xpPw);
                if (!p) p = document.querySelector('input[name=password]');
                if (!p) p = document.querySelector('input[type=password]');
                if (!p) p = document.querySelector('input[autocomplete=current-password]');
                if (!p) p = document.querySelector('input[id*="password" i]');
                // 페이지에 존재하는 모든 input 정보(디버그용)
                const allInputs = Array.from(document.querySelectorAll('input')).slice(0, 10).map(i => ({
                    type: i.type || '',
                    name: i.name || '',
                    id: i.id || '',
                    placeholder: i.placeholder || '',
                    visible: !!(i.offsetWidth || i.offsetHeight)
                }));
                const out = {
                    emailOk: fill(e, emailVal),
                    pwOk: fill(p, pwVal),
                    emailFound: !!e,
                    pwFound: !!p,
                    emailTag: e ? (e.outerHTML||'').slice(0, 200) : '',
                    pwTag: p ? (p.outerHTML||'').slice(0, 200) : '',
                    inputs: allInputs,
                    url: location.href,
                };
                return JSON.stringify(out);
            })()'''
            xp_email = '/html/body/div[2]/div[1]/div[2]/div[1]/form/div[1]/div[1]/div[1]/label/span[2]/input'
            xp_pw = '/html/body/div[2]/div[1]/div[2]/div[1]/form/div[1]/div[2]/div[1]/label/span[2]/input'
            call_js = (
                js_fill_body
                .replace('__XP_EMAIL__', json.dumps(xp_email))
                .replace('__XP_PW__', json.dumps(xp_pw))
                .replace('__EMAIL__', json.dumps(email))
                .replace('__PW__', json.dumps(pw))
            )

            raw = None
            try:
                raw = await page.evaluate(call_js)
            except Exception as _e:
                debug_log.append(f"[3] JS 폴백 실행 실패: {str(_e)[:200]}")

            # raw는 보통 JSON 문자열이지만 nodriver 버전에 따라
            # list/dict/tuple로 래핑될 수 있음 → 안전하게 파싱
            result = None
            try:
                if isinstance(raw, str):
                    result = json.loads(raw)
                elif isinstance(raw, dict):
                    result = raw
                elif isinstance(raw, (list, tuple)) and raw:
                    # [value, ...] 형태인 경우 첫 요소만 취함
                    first = raw[0]
                    if isinstance(first, str):
                        result = json.loads(first)
                    elif isinstance(first, dict):
                        result = first
            except Exception as _e:
                debug_log.append(f"[3] JS 결과 파싱 실패: {str(_e)[:200]} / raw={str(raw)[:200]}")

            if isinstance(result, dict) and result.get('emailOk') and result.get('pwOk'):
                filled_via = 'xpath_js'
                debug_log.append(f"[3] JS 폴백 성공 (url={result.get('url','')[:100]})")
                debug_log.append(f"[3] emailTag={result.get('emailTag','')[:120]}")
                email_input = None
                pw_input = None
            else:
                # 디버그 정보 최대한 기록
                if isinstance(result, dict):
                    debug_log.append(f"[3] JS 폴백 실패: emailFound={result.get('emailFound')}, pwFound={result.get('pwFound')}")
                    debug_log.append(f"[3] inputs: {json.dumps(result.get('inputs', []))[:400]}")
                    debug_log.append(f"[3] url: {result.get('url','')[:150]}")
                else:
                    debug_log.append(f"[3] JS 폴백 실패 (raw type={type(raw).__name__}, raw={str(raw)[:200]})")
                try:
                    text = await page.evaluate('document.body.innerText')
                    debug_log.append(f"[3] 페이지: {text[:200]}")
                except:
                    pass
                rtdb.reference(f'{save_path}/_debug').set({
                    'log': debug_log,
                    'updated_at': now_str,
                    'status': 'no_input',
                })
                return 0

        if filled_via == 'nodriver':
            debug_log.append("[3] 로그인 필드 찾음 (nodriver)")
            await email_input.click()
            await asyncio.sleep(0.5 + random.random() * 0.5)
            await email_input.send_keys(email)
            await asyncio.sleep(0.8 + random.random() * 0.5)

            await pw_input.click()
            await asyncio.sleep(0.5 + random.random() * 0.5)
            await pw_input.send_keys(pw)
            await asyncio.sleep(1 + random.random() * 0.5)

        # 로그인 제출
        # 소셜 로그인(네이버/카카오 등) 버튼이 button[type=submit]로 잡힐 위험이
        # 있어서 pw_input Enter → form.submit() 순서로 시도.
        submitted_via = 'enter'
        try:
            if pw_input is not None:
                await pw_input.send_keys('\n')
            else:
                # JS 폴백 경로: form을 직접 submit
                await page.evaluate('''(() => {
                    const pw = document.querySelector('input[type=password]');
                    if (pw && pw.form) { pw.form.submit(); return true; }
                    return false;
                })()''')
                submitted_via = 'form.submit()'
        except Exception as _e:
            # Enter 실패 시 form 내부 로그인 버튼 탐색
            try:
                btn = None
                for sel in [
                    'form button[type=submit]',
                    '.login__button',
                    'button.login__button',
                    '#login-submit',
                    'button#login-submit-button',
                ]:
                    btn = await page.select(sel)
                    if btn:
                        break
                if btn:
                    await btn.click()
                    submitted_via = 'button'
            except Exception as _e2:
                pass
        debug_log.append(f"[3] 제출: {submitted_via}")

        await asyncio.sleep(5 + random.random() * 2)

        # 로그인 결과 확인
        try:
            current_text = await page.evaluate('document.body.innerText')
            debug_log.append(f"[3] 로그인 후 텍스트: {current_text[:150]}")
        except:
            current_text = ''

        # 현재 URL / 페이지 정보
        try:
            current_url = await page.evaluate('location.href')
            page_title = await page.evaluate('document.title')
            debug_log.append(f"[3] URL: {current_url}")
            debug_log.append(f"[3] title: {page_title}")
        except:
            current_url = ''
            page_title = ''

        # SMS / 2차 인증 / 캡차 체크 (감지 범위 확대)
        auth_keywords = ['SMS 인증', '휴대폰 인증', '본인 인증', '보안 인증', '2단계 인증', '인증번호', '캡차', 'CAPTCHA', '자동입력 방지', '보안문자']
        if any(k in current_text for k in auth_keywords):
            debug_log.append(f"[3] 추가 인증 감지됨")
            rtdb.reference(f'{save_path}/_debug').set({
                'log': debug_log,
                'updated_at': now_str,
                'status': 'sms_required',
                'url': current_url,
                'title': page_title,
                'text_sample': current_text[:500],
            })
            return -1

        # 여전히 로그인 페이지면 실패 — 에러 원인 진단 강화
        try:
            still_login = await page.select('#login-email-input') or await page.select('input[name=email]')
        except:
            still_login = None

        if still_login:
            # 로그인 폼 근처 에러 메시지 수집
            try:
                error_msg = await page.evaluate('''(() => {
                    const sels = [
                        '.error-message', '.error', '.form-error',
                        '.login__error', '[class*="error"]', '.msg-error',
                        '[role="alert"]'
                    ];
                    for (const s of sels) {
                        const el = document.querySelector(s);
                        if (el && el.innerText && el.innerText.trim()) {
                            return el.innerText.trim().slice(0, 300);
                        }
                    }
                    return '';
                })()''')
            except:
                error_msg = ''

            # 캡차 이미지 탐지
            try:
                has_captcha = await page.evaluate('''(() => {
                    const imgs = document.querySelectorAll('img');
                    for (const i of imgs) {
                        const s = (i.src||'') + ' ' + (i.alt||'') + ' ' + (i.id||'') + ' ' + (i.className||'');
                        if (/captcha|secu/i.test(s)) return true;
                    }
                    return !!document.querySelector('input[name*="captcha"], input[id*="captcha"]');
                })()''')
            except:
                has_captcha = False

            # 스크린샷 저장 (workflow가 coupang_*.png 아티팩트로 업로드)
            try:
                await page.save_screenshot('coupang_login_failed.png')
                debug_log.append("[3] 스크린샷 저장")
            except Exception as _e:
                debug_log.append(f"[3] 스크린샷 실패: {_e}")

            debug_log.append(f"[3] 로그인 실패 (아직 로그인 페이지)")
            debug_log.append(f"[3] 에러메시지: {error_msg or '(없음)'}")
            debug_log.append(f"[3] 캡차감지: {has_captcha}")

            rtdb.reference(f'{save_path}/_debug').set({
                'log': debug_log,
                'updated_at': now_str,
                'status': 'login_failed',
                'url': current_url,
                'title': page_title,
                'error_message': error_msg,
                'has_captcha': has_captcha,
                'text_sample': current_text[:500],
            })
            return 0

        debug_log.append("[3] 로그인 성공")

        # 4. 마이쿠팡 링크 클릭
        #    //*[@id="wa-mycoupang-link"]/img
        debug_log.append("[4] 마이쿠팡 이동")
        mycoupang_clicked = await _xpath_click(page, '//*[@id="wa-mycoupang-link"]')
        if not mycoupang_clicked:
            mycoupang_clicked = await _xpath_click(page, '//*[@id="wa-mycoupang-link"]/img')
        await asyncio.sleep(3 + random.random() * 2)

        # 5. 주문목록 클릭
        #    //*[@id="wa-header"]/div[2]/div[1]/div[2]/div[1]/ul/li[1]/p/span/a[1]
        debug_log.append("[5] 주문목록 이동")
        order_clicked = await _xpath_click(
            page, '//*[@id="wa-header"]/div[2]/div[1]/div[2]/div[1]/ul/li[1]/p/span/a[1]'
        )
        if not order_clicked:
            debug_log.append("[5] 주문목록 링크 못 찾음 → 주문 URL 직접 이동")
            page = await browser.get(COUPANG_ORDER_URL)
        await asyncio.sleep(6 + random.random() * 3)

        # 6. 주문목록 페이지네이션 순회
        #    주문목록 내용: //*[@id="__next"]/div[2]/div[2]/div
        #    일별 디테일:   //*[@id="__next"]/div[2]/div[2]/div/div[3]/div[i]
        #    다음페이지:    //*[@id="__next"]/div[2]/div[2]/div/div[3]/div[6]/button[2]
        debug_log.append("[6] 주문목록 순회 시작")

        all_orders = []
        seen_keys = set()

        for page_no in range(1, MAX_PAGES + 1):
            # JS 렌더링 대기
            loaded = False
            for retry in range(8):
                try:
                    cnt = await page.evaluate('''(() => {
                        const r = document.evaluate('//*[@id="__next"]/div[2]/div[2]/div/div[3]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        const el = r.singleNodeValue;
                        if (!el) return 0;
                        return el.children ? el.children.length : 0;
                    })()''')
                except:
                    cnt = 0
                if cnt and cnt > 0:
                    loaded = True
                    break
                await asyncio.sleep(2)

            if not loaded:
                debug_log.append(f"[6] 페이지{page_no}: 주문목록 컨테이너 비어있음")
                break

            # 스크롤 (Lazy-render 안정화)
            try:
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(1.5)
                await page.evaluate('window.scrollTo(0, 0)')
                await asyncio.sleep(0.5)
            except:
                pass

            # 일별 디테일 div들의 innerText 배열로 수집
            day_texts = await page.evaluate('''(() => {
                const r = document.evaluate('//*[@id="__next"]/div[2]/div[2]/div/div[3]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = r.singleNodeValue;
                if (!el) return [];
                const out = [];
                for (const c of el.children) {
                    const t = (c.innerText || '').trim();
                    if (!t) continue;
                    // 날짜 포함한 자식만 주문 블록으로 간주 (마지막 페이지네이션 div는 제외됨)
                    if (/\\d{4}\\.\\s*\\d{1,2}\\.\\s*\\d{1,2}/.test(t)) out.push(t);
                }
                return out;
            })()''') or []

            debug_log.append(f"[6] 페이지{page_no}: 일별 블록 {len(day_texts)}개")

            new_on_page = 0
            for text in day_texts:
                parsed = parse_day_block(text)
                if not parsed:
                    continue
                key = parsed['order_date'] + '|' + ','.join(
                    p['product_name'] + 'x' + str(p.get('quantity', 1)) for p in parsed['products']
                )
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                all_orders.append(parsed)
                new_on_page += 1

            if new_on_page == 0 and page_no > 1:
                debug_log.append(f"[6] 페이지{page_no}: 신규 주문 없음 → 종료")
                break

            # 다음 페이지 버튼 클릭
            #   button[2] = 2번째 버튼 (1=이전, 2=다음)
            next_clicked = False
            try:
                next_clicked = await page.evaluate('''(() => {
                    const r = document.evaluate('//*[@id="__next"]/div[2]/div[2]/div/div[3]/div[6]/button[2]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    let btn = r.singleNodeValue;
                    if (!btn) {
                        // 폴백: 페이지네이션 마지막 div의 마지막 버튼
                        const r2 = document.evaluate('//*[@id="__next"]/div[2]/div[2]/div/div[3]/div[last()]//button[last()]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        btn = r2.singleNodeValue;
                    }
                    if (!btn) return false;
                    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
                    btn.click();
                    return true;
                })()''')
            except:
                next_clicked = False

            if not next_clicked:
                debug_log.append(f"[6] 페이지{page_no}: 다음 페이지 없음 → 종료")
                break

            await asyncio.sleep(3 + random.random())

        total_products = sum(len(o.get('products', [])) for o in all_orders)
        debug_log.append(f"[6] 총 주문 {len(all_orders)}건, 상품 {total_products}개")

        # 7. Firebase 저장
        save_data = {
            'date': today,
            'updated_at': now_str,
            'total_orders': len(all_orders),
            'total_products': total_products,
            'orders': all_orders,
            'debug_log': debug_log,
        }
        rtdb.reference(f'{save_path}/{today}').set(save_data)
        print(f"  [7] Firebase 저장 완료 (주문 {len(all_orders)}건, 상품 {total_products}개)")
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
