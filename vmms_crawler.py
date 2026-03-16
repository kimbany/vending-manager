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

async def crawl_today():
    today = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] 크롤링 시작 ({today})...")

    async with async_playwright() as p:
        # 타임아웃 60초로 늘리기
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 720},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        page = await context.new_page()
        page.set_default_timeout(60000)  # 60초

        try:
            print("  로그인 페이지 접속...")
            await page.goto("https://vmms.ubcn.co.kr/login", wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)  # 2초 대기

            # 아이디 입력 (여러 방법 시도)
            print("  아이디 입력...")
            try:
                await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/ul/li[1]/input').fill(ID)
            except PlaywrightTimeout:
                # XPath 실패시 input[type=text] 시도
                await page.locator('input[type="text"]').first.fill(ID)

            # 비밀번호 입력
            print("  비밀번호 입력...")
            try:
                await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/ul/li[2]/input').fill(PW)
            except PlaywrightTimeout:
                await page.locator('input[type="password"]').first.fill(PW)

            # 로그인 버튼
            print("  로그인 버튼 클릭...")
            try:
                await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/div[1]/a').click()
            except PlaywrightTimeout:
                await page.locator('a:has-text("로그인")').click()

            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)
            print(f"  로그인 완료. 현재 URL: {page.url}")

            # 광고 팝업 닫기 (있으면 닫고, 없으면 그냥 통과)
            print("  팝업 확인...")
            try:
                # "닫기" 버튼 또는 "오늘은 더이상 보지 않기" 버튼
                close_btn = page.locator('text=닫기').first
                if await close_btn.is_visible(timeout=3000):
                    await close_btn.click()
                    print("  팝업 닫기 완료")
                    await page.wait_for_timeout(500)
            except Exception:
                pass  # 팝업 없으면 그냥 통과

            # 거래내역 메뉴
            print("  메뉴 클릭...")
            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/a').click()
            await page.wait_for_timeout(1000)
            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/ul/li[1]/a').click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)

            # 오늘 버튼
            print("  오늘 날짜 선택...")
            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[1]/div[3]/div[4]/div/button[1]').click()
            await page.wait_for_timeout(1000)

            # 조회하기
            print("  조회하기...")
            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[2]/button').click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)

            # 헤더 수집
            header_cells = await page.locator(
                'xpath=/html/body/div[4]/div/div[5]/div/div/div/div/div/div[1]/table//thead//th'
            ).all()
            headers = [(await c.inner_text()).strip() for c in header_cells]
            print(f"  헤더: {headers}")

            # 데이터 수집 (전체 페이지)
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

            # Firebase 저장
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
            # 스크린샷 저장 (디버깅용)
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
