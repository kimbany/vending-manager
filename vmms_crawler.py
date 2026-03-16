"""
VMMS 거래내역 크롤러 (GitHub Actions용)
"""

import asyncio
import json
import os
from datetime import datetime
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
import firebase_admin
from firebase_admin import credentials, db as rtdb

# ── 설정 ──────────────────────────────────────────────────────────────────────
ID = os.environ.get("VMMS_ID", "")
PW = os.environ.get("VMMS_PW", "")
DATABASE_URL = "https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app"

def init_firebase():
    if firebase_admin._apps:
        return
    key_json = os.environ.get("FIREBASE_KEY", "")
    if key_json:
        key_dict = json.loads(key_json)
        cred = credentials.Certificate(key_dict)
    elif os.path.exists("firebase_key.json"):
        cred = credentials.Certificate("firebase_key.json")
    else:
        raise Exception("Firebase 키 없음")
    firebase_admin.initialize_app(cred, {'databaseURL': DATABASE_URL})

async def get_table_data(page):
    rows = await page.locator(
        'xpath=/html/body/div[4]/div/div[5]/div/div/div/div/div/div[1]/table//tbody//tr'
    ).all()
    data = []
    for row in rows:
        cells = await row.locator('td').all()
        row_data = [(await cell.inner_text()).strip() for cell in cells]
        if any(row_data):
            data.append(row_data)
    return data

async def close_popup(page):
    """광고 팝업 닫기 - 여러 방법 시도"""
    try:
        # 방법 1: "닫기" 텍스트 버튼
        btn = page.locator('text=닫기').first
        if await btn.is_visible(timeout=3000):
            await btn.click()
            print("  팝업 닫기 완료 (닫기 버튼)")
            await page.wait_for_timeout(500)
            return
    except Exception:
        pass
    try:
        # 방법 2: X 버튼 (팝업 상단 닫기)
        btn = page.locator('.modal-close, .popup-close, [class*="close"]').first
        if await btn.is_visible(timeout=2000):
            await btn.click()
            print("  팝업 닫기 완료 (X 버튼)")
            await page.wait_for_timeout(500)
            return
    except Exception:
        pass
    # 팝업 없으면 그냥 통과
    print("  팝업 없음 (통과)")

async def crawl_today():
    today = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] 크롤링 시작 ({today})...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 720},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        page = await context.new_page()
        page.set_default_timeout(60000)

        try:
            # ── 로그인 ──────────────────────────────────────────────────────
            print("  로그인 페이지 접속...")
            await page.goto("https://vmms.ubcn.co.kr/login", wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)

            # 디버깅용 스크린샷
            await page.screenshot(path="login_page.png")
            print(f"  페이지 HTML 일부: {await page.content()[:500]}")

            print("  아이디 입력...")
            # 여러 방법으로 시도
            try:
                await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/ul/li[1]/input').fill(ID, timeout=10000)
            except Exception:
                try:
                    await page.locator('input[name="id"]').fill(ID, timeout=5000)
                except Exception:
                    await page.locator('input[type="text"]').first.fill(ID, timeout=5000)
            await page.wait_for_timeout(500)

            print("  비밀번호 입력...")
            await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/ul/li[2]/input').fill(PW)
            await page.wait_for_timeout(500)

            print("  로그인 버튼 클릭...")
            # XPath만 사용 (텍스트 검색 제거)
            await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/div[1]/a').click()

            # 로그인 완료 대기 (URL 변경 또는 networkidle)
            try:
                await page.wait_for_url("**/main**", timeout=15000)
            except Exception:
                await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(2000)
            print(f"  로그인 완료. URL: {page.url}")

            # ── 광고 팝업 닫기 ───────────────────────────────────────────────
            await close_popup(page)

            # ── 거래내역 메뉴 ────────────────────────────────────────────────
            print("  머신기 매출정보 메뉴 클릭...")
            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/a').click()
            await page.wait_for_timeout(1000)

            print("  거래내역 하위메뉴 클릭...")
            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/ul/li[1]/a').click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)

            # 거래내역 페이지에서도 팝업 있을 수 있음
            await close_popup(page)

            # ── 오늘 날짜 조회 ───────────────────────────────────────────────
            print("  오늘 버튼 클릭...")
            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[1]/div[3]/div[4]/div/button[1]').click()
            await page.wait_for_timeout(1000)

            print("  조회하기 클릭...")
            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[2]/button').click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)

            # ── 헤더 수집 ────────────────────────────────────────────────────
            header_cells = await page.locator(
                'xpath=/html/body/div[4]/div/div[5]/div/div/div/div/div/div[1]/table//thead//th'
            ).all()
            headers = [(await c.inner_text()).strip() for c in header_cells]
            print(f"  헤더: {headers}")

            # ── 전체 페이지 데이터 수집 ──────────────────────────────────────
            all_rows = []
            all_rows.extend(await get_table_data(page))
            print(f"  1페이지: {len(all_rows)}건")

            page_num = 2
            while True:
                next_btn = page.locator(
                    f'xpath=/html/body/div[4]/div/div[5]/div/div/div/div/div/div[2]/ul/li[{page_num}]/a'
                )
                if await next_btn.count() == 0:
                    break
                if not (await next_btn.inner_text()).strip().isdigit():
                    break
                await next_btn.click()
                await page.wait_for_load_state("networkidle")
                await page.wait_for_timeout(1000)
                new_rows = await get_table_data(page)
                all_rows.extend(new_rows)
                print(f"  {page_num}페이지: {len(new_rows)}건 추가")
                page_num += 1

            print(f"  총 {len(all_rows)}건 수집 완료")

            # ── Firebase 저장 ─────────────────────────────────────────────────
            ref = rtdb.reference(f'vendingApp/crawledSales/{today}')
            ref.set({
                'date': today,
                'updated_at': now_str,
                'total_count': len(all_rows),
                'headers': headers,
                'rows': all_rows
            })
            print(f"  Firebase 저장 완료 ✅")
            return len(all_rows)

        except Exception as e:
            print(f"  오류: {e}")
            try:
                await page.screenshot(path="error_screenshot.png")
                print("  오류 스크린샷 저장됨")
            except:
                pass
            raise
        finally:
            await browser.close()


def main():
    init_firebase()
    count = asyncio.run(crawl_today())
    print(f"완료: {count}건")


if __name__ == "__main__":
    main()
