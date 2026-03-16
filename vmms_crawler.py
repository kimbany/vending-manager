"""
VMMS 거래내역 크롤러 (GitHub Actions용)
- GitHub Actions에서 실행
- 수집 데이터를 Firebase Realtime Database에 저장
  경로: vendingApp/crawledSales/{날짜}
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from playwright.async_api import async_playwright
import firebase_admin
from firebase_admin import credentials, db as rtdb

# ── 설정: 환경변수에서 읽기 (GitHub Actions Secret) ──────────────────────────
ID = os.environ.get("VMMS_ID", "")
PW = os.environ.get("VMMS_PW", "")
DATABASE_URL = "https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app"

# Firebase 초기화 (환경변수에서 JSON 키 읽기)
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
        raise Exception("Firebase 키가 없어요. FIREBASE_KEY 환경변수 또는 firebase_key.json 필요")
    firebase_admin.initialize_app(cred, {'databaseURL': DATABASE_URL})

# ── 크롤링 함수 ───────────────────────────────────────────────────────────────
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
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            await page.goto("https://vmms.ubcn.co.kr/login")
            await page.wait_for_load_state("networkidle")
            await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/ul/li[1]/input').fill(ID)
            await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/ul/li[2]/input').fill(PW)
            await page.locator('xpath=/html/body/div[1]/section/div/div[2]/form/div/div[1]/a').click()
            await page.wait_for_load_state("networkidle")

            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/a').click()
            await page.wait_for_timeout(500)
            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/ul/li[1]/a').click()
            await page.wait_for_load_state("networkidle")

            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[1]/div[3]/div[4]/div/button[1]').click()
            await page.wait_for_timeout(500)
            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[2]/button').click()
            await page.wait_for_load_state("networkidle")

            header_cells = await page.locator(
                'xpath=/html/body/div[4]/div/div[5]/div/div/div/div/div/div[1]/table//thead//th'
            ).all()
            headers = [(await c.inner_text()).strip() for c in header_cells]

            all_rows = []
            all_rows.extend(await get_table_data(page))

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
                await page.wait_for_timeout(500)
                all_rows.extend(await get_table_data(page))
                page_num += 1

            print(f"  수집 완료: {len(all_rows)}건")

            # Realtime Database 저장
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

        finally:
            await browser.close()


def main():
    init_firebase()
    count = asyncio.run(crawl_today())
    print(f"완료: {count}건")


if __name__ == "__main__":
    main()
