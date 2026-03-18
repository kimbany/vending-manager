"""
VMMS 거래내역 크롤러 (GitHub Actions용) - 개인화 버전
- Firebase에 저장된 유저별 VMMS 계정으로 크롤링
- 수집 데이터를 users/{uid}/crawledSales/{날짜} 에 저장
- VMMS 계정 없는 유저는 환경변수 계정 사용 (기존 방식)
"""

import asyncio
import json
import os
import base64
from datetime import datetime
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
import firebase_admin
from firebase_admin import credentials, db as rtdb

# ── 설정 ──────────────────────────────────────────────────────────────────────
# 기본 계정 (환경변수) - VMMS 계정 미등록 유저용
DEFAULT_ID = os.environ.get("VMMS_ID", "")
DEFAULT_PW = os.environ.get("VMMS_PW", "")
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

def get_all_user_vmms():
    """Firebase에서 VMMS 계정 등록한 유저 목록 가져오기"""
    users = []
    try:
        users_ref = rtdb.reference('users')
        snap = users_ref.get()
        if not snap:
            return users
        for uid, data in snap.items():
            if isinstance(data, dict) and 'vmms' in data:
                vmms = data['vmms']
                if vmms.get('id') and vmms.get('pw'):
                    try:
                        vmms_id = base64.b64decode(vmms['id']).decode('utf-8')
                        vmms_pw = base64.b64decode(vmms['pw']).decode('utf-8')
                        users.append({'uid': uid, 'id': vmms_id, 'pw': vmms_pw})
                        print(f"  유저 {uid[:8]}... VMMS 계정 발견")
                    except Exception as e:
                        print(f"  유저 {uid[:8]}... VMMS 계정 디코딩 실패: {e}")
    except Exception as e:
        print(f"  유저 목록 조회 실패: {e}")
    return users

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
    try:
        btn = page.locator('text=닫기').first
        if await btn.is_visible(timeout=3000):
            await btn.click()
            print("  팝업 닫기 완료")
            await page.wait_for_timeout(500)
            return
    except Exception:
        pass
    try:
        btn = page.locator('.modal-close, .popup-close, [class*="close"]').first
        if await btn.is_visible(timeout=2000):
            await btn.click()
            await page.wait_for_timeout(500)
    except Exception:
        pass

async def crawl_for_user(vmms_id, vmms_pw, save_path):
    """특정 VMMS 계정으로 크롤링 후 save_path에 저장"""
    today = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"  크롤링 시작 (계정: {vmms_id[:3]}***)")

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
            await page.goto("https://vmms.ubcn.co.kr/login", wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)

            # 디버깅용 스크린샷
            await page.screenshot(path="login_page.png")
            html_preview = await page.content()
            print(f"  페이지 HTML 일부: {html_preview[:300]}")

            await page.locator('#id').fill(vmms_id)
            await page.wait_for_timeout(500)
            await page.locator('#pass').fill(vmms_pw)
            await page.wait_for_timeout(500)
            await page.locator('#loginBtn').click()

            try:
                await page.wait_for_url("**/main**", timeout=15000)
            except Exception:
                await page.wait_for_load_state("networkidle", timeout=15000)
            await page.wait_for_timeout(2000)
            print(f"  로그인 완료. URL: {page.url}")

            await close_popup(page)

            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/a').click()
            await page.wait_for_timeout(1000)
            await page.locator('xpath=/html/body/div[2]/div[1]/div/ul/li[3]/ul/li[1]/a').click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)
            await close_popup(page)

            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[1]/div[3]/div[4]/div/button[1]').click()
            await page.wait_for_timeout(1000)
            await page.locator('xpath=/html/body/div[4]/div/div[4]/div/div/div/div/form/div/div[2]/div/div[2]/button').click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)

            header_cells = await page.locator(
                'xpath=/html/body/div[4]/div/div[5]/div/div/div/div/div/div[1]/table//thead//th'
            ).all()
            headers = [(await c.inner_text()).strip() for c in header_cells]
            print(f"  헤더: {headers}")

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

            # Firebase 저장 (개인 경로)
            ref = rtdb.reference(f'{save_path}/{today}')
            ref.set({
                'date': today,
                'updated_at': now_str,
                'total_count': len(all_rows),
                'headers': headers,
                'rows': all_rows
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


def main():
    init_firebase()
    today = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] VMMS 개인화 크롤러 시작")

    # Firebase에서 VMMS 계정 등록한 유저 목록
    users = get_all_user_vmms()

    if users:
        # 유저별 개인 계정으로 크롤링
        for user in users:
            print(f"\n유저 {user['uid'][:8]}... 크롤링 시작")
            save_path = f"users/{user['uid']}/crawledSales"
            try:
                count = asyncio.run(crawl_for_user(user['id'], user['pw'], save_path))
                print(f"  완료: {count}건")
            except Exception as e:
                print(f"  실패: {e}")
    else:
        # 등록된 VMMS 계정 없음 → 환경변수 기본 계정 사용 (공용 경로)
        print("\nVMMS 개인 계정 없음 → 기본 계정 사용")
        if DEFAULT_ID and DEFAULT_PW:
            save_path = "vendingApp/crawledSales"
            try:
                count = asyncio.run(crawl_for_user(DEFAULT_ID, DEFAULT_PW, save_path))
                print(f"  완료: {count}건")
            except Exception as e:
                print(f"  실패: {e}")
        else:
            print("  기본 VMMS 계정도 없음. 환경변수 VMMS_ID, VMMS_PW를 설정하거나 앱에서 VMMS 계정을 등록해주세요.")


if __name__ == "__main__":
    main()
