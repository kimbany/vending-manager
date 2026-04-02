"""
VMMS 상품마스터 + 자판기별 컬럼매칭 크롤러
- 상품마스터: 상품코드, 상품명, 바코드
- 자판기 목록: 단말기명, 단말기번호
- 자판기별 컬럼매칭: 컬럼번호, 상품코드, 상품명, 원가
- Firebase에 users/{uid}/vmmsProducts, vmmsColumns 저장
"""

import asyncio
import json
import os
import base64
from datetime import datetime
from playwright.async_api import async_playwright
import firebase_admin
from firebase_admin import credentials, db as rtdb

DATABASE_URL = "https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app"

# XPath 상수
XPATH_ID_INPUT   = '//*[@id="id"]'
XPATH_PW_INPUT   = '//*[@id="pass"]'
XPATH_LOGIN_BTN  = '//*[@id="loginBtn"]'
XPATH_POPUP_HIDE = '//*[@id="bottomImage"]/div[1]/button'

# 메뉴
XPATH_MENU_SERVICE    = '//*[@id="main-menu-navigation"]/li[1]/a'
XPATH_MENU_PRODUCT    = '//*[@id="main-menu-navigation"]/li[1]/ul/li[3]/a'
XPATH_MENU_MACHINE    = '//*[@id="main-menu-navigation"]/li[1]/ul/li[4]/a'

# 상품마스터
XPATH_PRODUCT_LIST    = '/html/body/div[4]/div/div[2]/div/div/div/div'
XPATH_PRODUCT_PAGE    = '/html/body/div[4]/div/div[2]/div/div/div/div/div[2]/ul/li/a'
XPATH_PRODUCT_TOTAL   = '//*[@id="maintotalCnt"]'

# 운영머신기
XPATH_MACHINE_SEARCH  = '/html/body/div[4]/div/div[1]/div/div/div/div/form/div/div/div/div[1]/div[5]/button[1]'
XPATH_MACHINE_LIST    = '//*[@id="main"]/div/div/div/div'
XPATH_MACHINE_PAGE    = '//*[@id="main"]/div/div/div/div/div[2]/ul/li/a'
XPATH_MACHINE_GRID    = '//*[@id="main-grid"]'

# 컬럼매칭
XPATH_COLUMN_SEARCH   = '/html/body/div[4]/div/div[2]/div/div/div/div/form/div/div[2]/div[3]/button[1]'
XPATH_COLUMN_DATA     = '/html/body/div[4]/div/div[2]/div/div/div/div/form/div/div[3]/div[2]/div/div'
XPATH_COLUMN_BACK     = '/html/body/div[4]/div/div[3]/div/div/div/div/form/div/div/button[1]'

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
                except:
                    # AES 암호화된 경우 btoa fallback
                    try:
                        vmms_id = base64.b64decode(vmms['id']).decode('utf-8')
                        vmms_pw = base64.b64decode(vmms['pw']).decode('utf-8')
                    except:
                        continue
                users.append({'uid': uid, 'id': vmms_id, 'pw': vmms_pw})
                print(f"  유저 {uid[:8]}... VMMS 계정 발견")
    except Exception as e:
        print(f"  유저 목록 조회 실패: {e}")
    return users

# ── 테이블 수집 유틸 ──────────────────────────────────────────────────────────
async def get_table_rows(page, table_xpath):
    rows = []
    try:
        table = page.locator(f'xpath={table_xpath}')
        if await table.count() == 0:
            return rows
        tr_list = await page.locator(f'xpath={table_xpath}//tbody//tr').all()
        for tr in tr_list:
            cells = await tr.locator('td').all()
            row = []
            for cell in cells:
                text = (await cell.inner_text()).strip()
                row.append(text)
            if any(row):
                rows.append(row)
    except Exception as e:
        print(f"  테이블 수집 오류: {e}")
    return rows

async def get_all_pages(page, page_xpath, table_xpath, collector_fn):
    """모든 페이지 순회하며 데이터 수집"""
    all_data = []

    # 1페이지 수집
    first = await collector_fn(page)
    all_data.extend(first)
    print(f"    1페이지: {len(first)}건")

    # 페이지네이션
    for pg_num in range(2, 500):
        try:
            pg_btn = page.locator(f'xpath={page_xpath}').filter(has_text=str(pg_num))
            if await pg_btn.count() == 0:
                break
            # 정확히 해당 숫자만 클릭
            btns = await page.locator(f'xpath={page_xpath}').all()
            clicked = False
            for btn in btns:
                txt = (await btn.inner_text()).strip()
                if txt == str(pg_num):
                    await btn.click()
                    await page.wait_for_load_state("networkidle")
                    await page.wait_for_timeout(1000)
                    data = await collector_fn(page)
                    all_data.extend(data)
                    print(f"    {pg_num}페이지: {len(data)}건 (누계: {len(all_data)})")
                    clicked = True
                    break
            if not clicked:
                break
        except:
            break

    return all_data

# ── 상품마스터 크롤링 ─────────────────────────────────────────────────────────
async def crawl_products(page):
    """상품마스터 전체 크롤링"""
    print("  [상품마스터] 메뉴 이동")

    # 서비스관리 메뉴
    await page.locator(f'xpath={XPATH_MENU_SERVICE}').click()
    await page.wait_for_timeout(800)

    # 상품마스터관리
    await page.locator(f'xpath={XPATH_MENU_PRODUCT}').click()
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(2000)

    # 팝업 닫기
    await close_popup(page)

    # 총 개수 확인
    try:
        total_el = page.locator(f'xpath={XPATH_PRODUCT_TOTAL}')
        if await total_el.count() > 0:
            total_text = (await total_el.inner_text()).strip().replace(',', '')
            print(f"  [상품마스터] 총 {total_text}개")
    except:
        pass

    # 데이터 수집 함수
    async def collect_products(pg):
        rows = []
        try:
            table = pg.locator(f'xpath={XPATH_PRODUCT_LIST}//table')
            if await table.count() == 0:
                # table 없으면 div 기반
                table = pg.locator(f'xpath={XPATH_PRODUCT_LIST}')
            tr_list = await pg.locator(f'xpath={XPATH_PRODUCT_LIST}//table//tbody//tr').all()
            if not tr_list:
                tr_list = await pg.locator(f'xpath={XPATH_PRODUCT_LIST}//tbody//tr').all()
            for tr in tr_list:
                cells = await tr.locator('td').all()
                cell_texts = [(await c.inner_text()).strip() for c in cells]
                if len(cell_texts) >= 3:
                    rows.append({
                        'seq': cell_texts[0] if len(cell_texts) > 0 else '',
                        'productCode': cell_texts[1] if len(cell_texts) > 1 else '',
                        'productName': cell_texts[2] if len(cell_texts) > 2 else '',
                        'barcode': cell_texts[3] if len(cell_texts) > 3 else ''
                    })
        except Exception as e:
            print(f"    수집 오류: {e}")
        return rows

    products = await get_all_pages(page, XPATH_PRODUCT_PAGE,
                                    f'{XPATH_PRODUCT_LIST}//table', collect_products)
    print(f"  [상품마스터] 총 {len(products)}개 수집 완료")
    return products

# ── 자판기 목록 + 컬럼매칭 크롤링 ─────────────────────────────────────────────
async def crawl_machines_and_columns(page):
    """자판기 목록 + 각 자판기별 컬럼매칭 크롤링"""
    print("  [자판기] 메뉴 이동")

    # 서비스관리 > 운영머신기관리
    await page.locator(f'xpath={XPATH_MENU_SERVICE}').click()
    await page.wait_for_timeout(800)
    await page.locator(f'xpath={XPATH_MENU_MACHINE}').click()
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(2000)

    # 팝업 닫기
    await close_popup(page)

    # 조회 버튼
    try:
        search_btn = page.locator(f'xpath={XPATH_MACHINE_SEARCH}')
        if await search_btn.is_visible(timeout=3000):
            await search_btn.click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)
    except:
        pass

    # 자판기 목록 수집
    machines = []
    async def collect_machines(pg):
        rows = []
        try:
            tr_list = await pg.locator(f'xpath={XPATH_MACHINE_GRID}//tr').all()
            for tr in tr_list:
                cells = await tr.locator('td').all()
                cell_texts = [(await c.inner_text()).strip() for c in cells]
                if len(cell_texts) >= 5:
                    rows.append({
                        'machineName': cell_texts[3] if len(cell_texts) > 3 else '',
                        'deviceNo': cell_texts[4] if len(cell_texts) > 4 else '',
                    })
        except Exception as e:
            print(f"    수집 오류: {e}")
        return rows

    machines = await get_all_pages(page, XPATH_MACHINE_PAGE,
                                    XPATH_MACHINE_GRID, collect_machines)
    print(f"  [자판기] {len(machines)}대 발견")

    # 각 자판기별 컬럼매칭 크롤링
    all_columns = {}

    for i, machine in enumerate(machines):
        devno = machine.get('deviceNo', '')
        name = machine.get('machineName', '')
        if not devno:
            continue

        print(f"  [컬럼매칭] {i+1}/{len(machines)} {name} ({devno})")

        try:
            # 관리 버튼 클릭
            mgmt_btn = page.locator(f'xpath={XPATH_MACHINE_GRID}//tr[{i+1}]/td[2]/div/button')
            if await mgmt_btn.count() == 0:
                print(f"    관리 버튼 없음 - 스킵")
                continue
            await mgmt_btn.click()
            await page.wait_for_timeout(500)

            # 웹 상품매칭 버튼
            match_btn = page.locator(f'xpath={XPATH_MACHINE_GRID}//tr[{i+1}]/td[2]/div/div/a[2]')
            if await match_btn.count() == 0:
                match_btn = page.locator(f'xpath={XPATH_MACHINE_GRID}//tr[{i+1}]/td[2]/div/div/a').filter(has_text="상품매칭")
            if await match_btn.count() == 0:
                print(f"    상품매칭 버튼 없음 - 스킵")
                continue
            await match_btn.click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)

            # 팝업 닫기
            await close_popup(page)

            # 조회 버튼
            try:
                col_search = page.locator(f'xpath={XPATH_COLUMN_SEARCH}')
                if await col_search.is_visible(timeout=3000):
                    await col_search.click()
                    await page.wait_for_load_state("networkidle")
                    await page.wait_for_timeout(2000)
            except:
                pass

            # 스크롤 영역 끝까지 스크롤
            try:
                scroll_area = page.locator(f'xpath={XPATH_COLUMN_DATA}')
                if await scroll_area.count() > 0:
                    for _ in range(20):
                        await scroll_area.evaluate('el => el.scrollTop = el.scrollHeight')
                        await page.wait_for_timeout(300)
            except:
                pass

            # 컬럼 데이터 수집
            columns = []
            try:
                # 테이블 또는 div 기반 데이터
                col_rows = await page.locator(f'xpath={XPATH_COLUMN_DATA}//table//tbody//tr').all()
                if not col_rows:
                    col_rows = await page.locator(f'xpath={XPATH_COLUMN_DATA}//tr').all()
                if not col_rows:
                    # div 기반 시도
                    col_rows = await page.locator(f'xpath={XPATH_COLUMN_DATA}//div[contains(@class,"row")]').all()

                for row in col_rows:
                    cells = await row.locator('td').all()
                    if not cells:
                        cells = await row.locator('div').all()
                    cell_texts = [(await c.inner_text()).strip() for c in cells]

                    if len(cell_texts) >= 3:
                        col_entry = {
                            'columnNo': cell_texts[0] if len(cell_texts) > 0 else '',
                            'productCode': cell_texts[1] if len(cell_texts) > 1 else '',
                            'productName': cell_texts[2] if len(cell_texts) > 2 else '',
                            'costPrice': cell_texts[3] if len(cell_texts) > 3 else ''
                        }
                        columns.append(col_entry)
            except Exception as e:
                print(f"    컬럼 수집 오류: {e}")

            all_columns[devno] = {
                'machineName': name,
                'deviceNo': devno,
                'columns': columns,
                'count': len(columns)
            }
            print(f"    → {len(columns)}개 컬럼")

            # 목록으로 돌아가기
            try:
                back_btn = page.locator(f'xpath={XPATH_COLUMN_BACK}')
                if await back_btn.count() > 0:
                    await back_btn.click()
                    await page.wait_for_load_state("networkidle")
                    await page.wait_for_timeout(1500)
                else:
                    await page.go_back()
                    await page.wait_for_load_state("networkidle")
                    await page.wait_for_timeout(1500)
            except:
                await page.go_back()
                await page.wait_for_timeout(1500)

            # 팝업 닫기
            await close_popup(page)

        except Exception as e:
            print(f"    오류: {e}")
            try:
                await page.go_back()
                await page.wait_for_timeout(1500)
            except:
                pass

    return machines, all_columns

# ── 팝업 닫기 ─────────────────────────────────────────────────────────────────
async def close_popup(page):
    try:
        popup = page.locator(f'xpath={XPATH_POPUP_HIDE}')
        if await popup.is_visible(timeout=2000):
            await popup.click()
            await page.wait_for_timeout(500)
    except:
        pass

# ── 메인 크롤링 ───────────────────────────────────────────────────────────────
async def crawl_vmms_products(vmms_id, vmms_pw, save_path):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"  VMMS 제품 크롤링 시작 (계정: {vmms_id[:3]}***)")

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
            print(f"  [1] 로그인 완료")

            # 2. 팝업 닫기
            await close_popup(page)

            # 3. 상품마스터 크롤링
            products = await crawl_products(page)

            # 4. 자판기 + 컬럼매칭 크롤링
            machines, columns = await crawl_machines_and_columns(page)

            # 5. Firebase 저장
            print("  [저장] Firebase 저장 중...")

            # 상품마스터
            rtdb.reference(f'{save_path}/vmmsProducts').set({
                'updated_at': now_str,
                'total': len(products),
                'items': products
            })
            print(f"  [저장] 상품마스터 {len(products)}개")

            # 자판기 목록
            rtdb.reference(f'{save_path}/vmmsMachines').set({
                'updated_at': now_str,
                'total': len(machines),
                'items': machines
            })
            print(f"  [저장] 자판기 {len(machines)}대")

            # 컬럼매칭 (단말기별)
            rtdb.reference(f'{save_path}/vmmsColumns').set({
                'updated_at': now_str,
                'machines': columns
            })
            total_cols = sum(c.get('count', 0) for c in columns.values())
            print(f"  [저장] 컬럼매칭 {total_cols}개 ({len(columns)}대)")

            print(f"  ✅ 완료: 제품 {len(products)}개 / 자판기 {len(machines)}대 / 컬럼 {total_cols}개")
            return len(products)

        except Exception as e:
            print(f"  오류: {e}")
            try:
                await page.screenshot(path="vmms_product_error.png")
            except:
                pass
            raise
        finally:
            await browser.close()

# ── 진입점 ────────────────────────────────────────────────────────────────────
async def main_async():
    init_firebase()
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] VMMS 제품 크롤러 시작")

    users = get_all_user_vmms()
    if not users:
        print("\nVMMS 계정이 등록된 유저 없음")
        return

    for user in users:
        print(f"\n유저 {user['uid'][:8]}... 크롤링 시작")
        try:
            count = await crawl_vmms_products(
                user['id'], user['pw'],
                f"users/{user['uid']}"
            )
            print(f"  완료: {count}개 제품")
        except Exception as e:
            print(f"  실패: {e}")

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()
