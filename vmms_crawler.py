"""
VMMS 거래내역 크롤러 (GitHub Actions용)
- Firebase에 저장된 유저별 VMMS 계정으로 크롤링
- 수집 데이터를 users/{uid}/crawledSales/{날짜} 에 저장
"""

import asyncio
import json
import os
import sys
import base64
from datetime import datetime
from playwright.async_api import async_playwright
import firebase_admin
from firebase_admin import credentials, db as rtdb

# ── 설정 ──────────────────────────────────────────────────────────────────────
DEFAULT_ID   = os.environ.get("VMMS_ID", "")
DEFAULT_PW   = os.environ.get("VMMS_PW", "")
DATABASE_URL = "https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app"

# XPath 상수 (알려주신 정확한 경로)
XPATH_ID_INPUT   = '//*[@id="id"]'
XPATH_PW_INPUT   = '//*[@id="pass"]'
XPATH_LOGIN_BTN  = '//*[@id="loginBtn"]'
XPATH_POPUP_HIDE = '//*[@id="bottomImage"]/div[1]/button'
XPATH_MENU_MAIN  = '//*[@id="main-menu-navigation"]/li[3]/a'
XPATH_MENU_TXN   = '//*[@id="main-menu-navigation"]/li[3]/ul/li[1]/a'
XPATH_BTN_TODAY  = '//*[@id="hide"]/div/div[1]/div[3]/div[4]'
XPATH_BTN_SEARCH = '//*[@id="hide"]/div/div[2]/button'
XPATH_TABLE      = '//*[@id="main"]/div/div/div/div/div[1]/table'
XPATH_PAGINATION = '//*[@id="main"]/div/div/div/div/div[2]/ul'

FIXED_HEADERS = ['순번','거래일시','조직루트','단말기명','단말기번호','머신기코드',
                 '판매항목','컬럼','판매가','수단','입력','상태','카드번호',
                 '승인번호','일련번호','카드사','매입사','사업자번호','상점ID',
                 '마감일시','입금일','취소일']

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

def get_all_user_vmms():
    users = []
    try:
        snap = rtdb.reference('users').get()
        if not snap:
            return users
        for uid, data in snap.items():
            if not isinstance(data, dict):
                continue
            vmms = data.get('vmms', {})
            if vmms.get('id') and vmms.get('pw'):
                try:
                    vmms_id = base64.b64decode(vmms['id']).decode('utf-8')
                    vmms_pw = base64.b64decode(vmms['pw']).decode('utf-8')
                    users.append({'uid': uid, 'id': vmms_id, 'pw': vmms_pw})
                    print(f"  유저 {uid[:8]}... VMMS 계정 발견")
                except Exception as e:
                    print(f"  유저 {uid[:8]}... 디코딩 실패: {e}")
    except Exception as e:
        print(f"  유저 목록 조회 실패: {e}")
    return users

# ── 테이블 수집 ───────────────────────────────────────────────────────────────
async def get_table_rows(page):
    rows = []
    try:
        tr_list = await page.locator(f'xpath={XPATH_TABLE}//tbody//tr').all()
        print(f"  [TR] tbody tr 개수: {len(tr_list)}")
        for idx, tr in enumerate(tr_list):
            # tr이 보이는지 확인
            is_visible = await tr.is_visible()
            cells = await tr.locator('td').all()
            row = [(await cell.inner_text()).strip() for cell in cells]

            # 셀이 1개 이하이거나 완전히 비어있으면 스킵
            if len(cells) <= 1:
                print(f"  [TR] row[{idx}] 스킵 - 셀 {len(cells)}개")
                continue
            if not any(row):
                print(f"  [TR] row[{idx}] 스킵 - 모든 셀 비어있음")
                continue
            # "데이터가 없습니다" 안내 행 제외
            joined = ''.join(row)
            if '데이터' in joined and '없습니다' in joined:
                print(f"  [TR] row[{idx}] 스킵 - 안내 메시지")
                continue

            rows.append(row)
            if not is_visible:
                print(f"  [TR] row[{idx}] 수집 (hidden) - {row[:2]}")
    except Exception as e:
        print(f"  테이블 수집 오류: {e}")
    return rows

async def get_table_headers(page):
    try:
        ths = await page.locator(f'xpath={XPATH_TABLE}//thead//th').all()
        headers = [(await th.inner_text()).strip() for th in ths]
        if headers and len(headers) > 3:
            return headers
    except:
        pass
    return FIXED_HEADERS

async def get_page_numbers(page):
    nums = []
    try:
        lis = await page.locator(f'xpath={XPATH_PAGINATION}/li').all()
        for li in lis:
            a = li.locator('a')
            if await a.count() > 0:
                txt = (await a.inner_text()).strip()
                if txt.isdigit():
                    nums.append(int(txt))
    except:
        pass
    return nums

async def click_page(page, page_num):
    try:
        btn = page.locator(f'xpath={XPATH_PAGINATION}/li/a[text()="{page_num}"]')
        if await btn.count() > 0:
            await btn.click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(800)
            return True
    except:
        pass
    return False

# ── 메인 크롤링 ───────────────────────────────────────────────────────────────
async def crawl_for_user(vmms_id, vmms_pw, save_path, target_date=None):
    today   = target_date or datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"  크롤링 시작 (계정: {vmms_id[:3]}***, 날짜: {today})")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage',
                  '--disable-blink-features=AutomationControlled']
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) '
                       'Chrome/120.0.0.0 Safari/537.36'
        )
        page = await context.new_page()
        page.set_default_timeout(30000)

        try:
            # 1. 로그인
            print("  [1] 로그인")
            await page.goto("https://vmms.ubcn.co.kr/login", wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)
            await page.locator(f'xpath={XPATH_ID_INPUT}').fill(vmms_id)
            await page.wait_for_timeout(300)
            await page.locator(f'xpath={XPATH_PW_INPUT}').fill(vmms_pw)
            await page.wait_for_timeout(300)
            await page.locator(f'xpath={XPATH_LOGIN_BTN}').click()
            try:
                await page.wait_for_url("**/index**", timeout=12000)
            except:
                await page.wait_for_load_state("networkidle", timeout=12000)
            await page.wait_for_timeout(1500)
            print(f"  [1] 로그인 완료. URL: {page.url}")

            # 2. 팝업 닫기
            try:
                popup = page.locator(f'xpath={XPATH_POPUP_HIDE}')
                if await popup.is_visible(timeout=3000):
                    await popup.click()
                    await page.wait_for_timeout(500)
                    print("  [2] 팝업 닫기 완료")
                else:
                    print("  [2] 팝업 없음")
            except:
                print("  [2] 팝업 없음 (skip)")

            # 3. 거래내역 메뉴
            print("  [3] 거래내역 메뉴")
            await page.locator(f'xpath={XPATH_MENU_MAIN}').click()
            await page.wait_for_timeout(800)
            await page.locator(f'xpath={XPATH_MENU_TXN}').click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(1500)

            # 메뉴 이동 후 팝업 재확인
            try:
                popup2 = page.locator(f'xpath={XPATH_POPUP_HIDE}')
                if await popup2.is_visible(timeout=2000):
                    await popup2.click()
                    await page.wait_for_timeout(500)
            except:
                pass

            # 4. 조회 날짜 설정 (시작일 = 끝일 = today)
            print(f"  [4] 조회 날짜 설정: {today}")
            # #sDate(시작날짜), #eDate(끝날짜) 직접 설정
            for date_id in ['sDate', 'eDate']:
                await page.evaluate(f'''() => {{
                    var inp = document.getElementById("{date_id}");
                    if(inp) {{
                        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(inp, "{today}");
                        inp.dispatchEvent(new Event("input", {{bubbles:true}}));
                        inp.dispatchEvent(new Event("change", {{bubbles:true}}));
                    }}
                }}''')
            await page.wait_for_timeout(500)
            # 설정 검증
            for date_id in ['sDate', 'eDate']:
                try:
                    val = await page.locator(f'#{date_id}').input_value()
                    if val.strip() != today:
                        await page.locator(f'#{date_id}').fill(today)
                        print(f"  [4] {date_id} 재설정: {val} → {today}")
                    else:
                        print(f"  [4] {date_id} OK: {val}")
                except:
                    print(f"  [4] {date_id} 검증 실패 - 계속 진행")
            await page.wait_for_timeout(300)

            # 4-1. 상세조회 열고 전체 체크 후 닫기
            print("  [4-1] 상세조회 필터 설정")
            try:
                # "상세조회 열기" 버튼 찾기
                detail_btn = None
                detail_btns = await page.locator('text=/상세조회/').all()
                for dbtn in detail_btns:
                    if await dbtn.is_visible():
                        detail_btn = dbtn
                        await dbtn.click()
                        await page.wait_for_timeout(1000)
                        print("  [4-1] 상세조회 패널 열기 완료")
                        break

                # 결제유형 + 거래상태 전체 체크박스 모두 선택
                await page.evaluate('''() => {
                    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
                    checkboxes.forEach(function(cb) {
                        if (!cb.checked) {
                            cb.checked = true;
                            cb.dispatchEvent(new Event("change", {bubbles: true}));
                        }
                    });
                }''')
                await page.wait_for_timeout(500)
                print("  [4-1] 모든 체크박스 선택 완료")

                # 상세조회 패널 닫기 (조회 버튼이 가려지지 않도록)
                close_btns = await page.locator('text=/상세조회 닫기/').all()
                if not close_btns:
                    close_btns = await page.locator('text=/닫기/').all()
                if not close_btns and detail_btn:
                    # 같은 버튼 다시 클릭 (토글)
                    close_btns = [detail_btn]
                for cbtn in close_btns:
                    if await cbtn.is_visible():
                        await cbtn.click()
                        await page.wait_for_timeout(800)
                        print("  [4-1] 상세조회 패널 닫기 완료")
                        break
            except Exception as e:
                print(f"  [4-1] 상세조회 설정 실패 (무시): {e}")

            # 5. 조회
            print("  [5] 조회 버튼 클릭")
            search_clicked = False
            # 방법 1: 기존 XPath
            try:
                btn = page.locator(f'xpath={XPATH_BTN_SEARCH}')
                if await btn.is_visible(timeout=3000):
                    await btn.click()
                    search_clicked = True
                    print("  [5] 방법1 - 기존 XPath 클릭 OK")
            except:
                pass
            # 방법 2: 텍스트로 찾기
            if not search_clicked:
                try:
                    btn2 = page.locator('button:has-text("조회")').first
                    if await btn2.is_visible(timeout=3000):
                        await btn2.click()
                        search_clicked = True
                        print("  [5] 방법2 - 텍스트 '조회' 클릭 OK")
                except:
                    pass
            # 방법 3: JavaScript 클릭
            if not search_clicked:
                try:
                    await page.evaluate('''() => {
                        var btns = document.querySelectorAll('button');
                        for(var i=0;i<btns.length;i++){
                            if(btns[i].textContent.trim().indexOf('조회')>=0 && btns[i].offsetParent !== null){
                                btns[i].click();
                                return true;
                            }
                        }
                        return false;
                    }''')
                    search_clicked = True
                    print("  [5] 방법3 - JS 클릭 OK")
                except:
                    pass
            if not search_clicked:
                print("  [5] 조회 버튼 클릭 실패!")
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(3000)  # 테이블 로딩 충분히 대기

            # 5-0. 페이지당 표시 건수를 최대로 변경 (select box가 있는 경우)
            try:
                # 일반적인 페이지 사이즈 셀렉트 박스 찾기
                page_size_selectors = [
                    'select[name*="length"]',
                    'select[name*="pageSize"]',
                    'select[name*="size"]',
                    'select.page-size',
                    '#main select',
                    '.dataTables_length select'
                ]
                for sel in page_size_selectors:
                    select_el = page.locator(sel)
                    if await select_el.count() > 0:
                        # 가장 큰 값 선택 (보통 50, 100, 전체 등)
                        options = await select_el.locator('option').all()
                        max_val = None
                        for opt in options:
                            val = await opt.get_attribute('value')
                            if val and val.isdigit():
                                if max_val is None or int(val) > int(max_val):
                                    max_val = val
                        if max_val:
                            await select_el.select_option(max_val)
                            print(f"  [5-0] 페이지 사이즈 → {max_val}건")
                            await page.wait_for_load_state("networkidle")
                            await page.wait_for_timeout(1500)
                        break
            except Exception as e:
                print(f"  [5-0] 페이지 사이즈 변경 실패 (무시): {e}")

            # 5-1. 디버깅: 조회 후 스크린샷 + 페이지 상태 확인
            safe_id = vmms_id[:3].replace('/', '_')
            await page.screenshot(path=f"after_search_{safe_id}.png")
            print(f"  [5-1] 스크린샷 저장: after_search_{safe_id}.png")
            print(f"  [5-1] 현재 URL: {page.url}")
            # 테이블 존재 여부 확인
            table_count = await page.locator(f'xpath={XPATH_TABLE}').count()
            print(f"  [5-1] 테이블 발견: {table_count}개")
            if table_count > 0:
                tbody_rows = await page.locator(f'xpath={XPATH_TABLE}//tbody//tr').count()
                print(f"  [5-1] tbody tr 수: {tbody_rows}")
            # 검색결과 텍스트 확인
            try:
                body_text = await page.inner_text('body')
                for line in body_text.split('\n'):
                    if '검색결과' in line or '건' in line:
                        print(f"  [5-1] 검색결과: {line.strip()[:80]}")
                        break
            except:
                pass

            # 6. 헤더
            headers = await get_table_headers(page)
            print(f"  [6] 헤더 ({len(headers)}개): {headers[:8]}...")

            # 7. 전체 데이터 수집
            all_rows = []
            first = await get_table_rows(page)
            all_rows.extend(first)
            print(f"  [7] 1페이지: {len(first)}건")

            # 페이지네이션
            for next_pg in range(2, 200):
                available = await get_page_numbers(page)
                if next_pg not in available:
                    print(f"  [7] {next_pg}페이지 없음 → 수집 완료")
                    break
                if not await click_page(page, next_pg):
                    print(f"  [7] {next_pg}페이지 클릭 실패 → 종료")
                    break
                rows = await get_table_rows(page)
                if not rows:
                    print(f"  [7] {next_pg}페이지 데이터 없음 → 종료")
                    break
                all_rows.extend(rows)
                print(f"  [7] {next_pg}페이지: {len(rows)}건 (누계: {len(all_rows)}건)")

            print(f"  총 {len(all_rows)}건 수집 완료")
            # 디버깅: 각 행의 첫 3셀 출력
            for i, r in enumerate(all_rows):
                print(f"  row[{i}]: {r[:3] if len(r)>=3 else r}")

            # 8. Firebase 저장
            rtdb.reference(f'{save_path}/{today}').set({
                'date':        today,
                'updated_at':  now_str,
                'total_count': len(all_rows),
                'headers':     headers,
                'rows':        all_rows
            })
            print(f"  Firebase 저장 완료 ({save_path}/{today}) ✅")
            return len(all_rows)

        except Exception as e:
            print(f"  오류: {e}")
            try:
                await page.screenshot(path="error_screenshot.png")
            except:
                pass
            raise
        finally:
            await browser.close()

# ── 진입점 ────────────────────────────────────────────────────────────────────
def migrate_user_emails():
    """기존 계정의 username→email 매핑을 userEmails에 저장 (1회성 마이그레이션)"""
    try:
        users_data = rtdb.reference('users').get()
        if not users_data:
            return
        count = 0
        for uid, data in users_data.items():
            if not isinstance(data, dict):
                continue
            profile = data.get('profile', {})
            username = profile.get('username', '')
            email = profile.get('email', '')
            if username and email:
                rtdb.reference(f'userEmails/{username}').set(email)
                count += 1
                print(f"  userEmails 등록: {username} → {email}")
        print(f"  userEmails 마이그레이션 완료: {count}건")
    except Exception as e:
        print(f"  userEmails 마이그레이션 실패: {e}")

async def main_async():
    init_firebase()

    # 환경변수 또는 CLI에서 날짜 받기 (없으면 오늘)
    crawl_date = os.environ.get('CRAWL_DATE', '').strip()
    if len(sys.argv) > 1 and sys.argv[1].strip():
        crawl_date = sys.argv[1].strip()
    if crawl_date:
        try:
            datetime.strptime(crawl_date, "%Y-%m-%d")
        except ValueError:
            print(f"❌ 잘못된 날짜 형식: {crawl_date} (YYYY-MM-DD 형식 필요)")
            return
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] VMMS 크롤러 시작 (지정 날짜: {crawl_date})")
    else:
        crawl_date = None
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] VMMS 크롤러 시작 (오늘)")

    # userEmails 마이그레이션 (기존 계정 로그인 지원)
    migrate_user_emails()

    users = get_all_user_vmms()
    if users:
        for user in users:
            print(f"\n유저 {user['uid'][:8]}... 크롤링 시작")
            try:
                count = await crawl_for_user(
                    user['id'], user['pw'],
                    f"users/{user['uid']}/crawledSales",
                    target_date=crawl_date
                )
                print(f"  완료: {count}건")
            except Exception as e:
                print(f"  실패: {e}")
    else:
        print("\nVMMS 개인 계정 없음 → 기본 계정 사용")
        if DEFAULT_ID and DEFAULT_PW:
            try:
                count = await crawl_for_user(
                    DEFAULT_ID, DEFAULT_PW, "vendingApp/crawledSales",
                    target_date=crawl_date
                )
                print(f"  완료: {count}건")
            except Exception as e:
                print(f"  실패: {e}")
        else:
            print("  VMMS 계정 없음. 설정 > VMMS에서 계정을 등록해주세요.")

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()
