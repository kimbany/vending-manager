/**
 * VMMS 실시간 크롤링 Cloud Functions
 * - crawlVmmsProducts: 제품/자판기/컬럼 데이터 실시간 수집
 * - crawlVmmsSales: 판매(거래내역) 데이터 실시간 수집
 * - Puppeteer로 VMMS 사이트에 로그인 → 데이터 수집 → Firebase 저장
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const COUPANG_ACCESS_KEY = defineSecret("COUPANG_ACCESS_KEY");
const COUPANG_SECRET_KEY = defineSecret("COUPANG_SECRET_KEY");

admin.initializeApp();

// ── AES-256-GCM 복호화 (브라우저 encryptAES와 동일 알고리즘) ───────────────
function decryptAES(encoded, uid) {
  if (!encoded) return "";
  try {
    const raw = Buffer.from(encoded, "base64");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(raw.length - 16);
    const data = raw.subarray(12, raw.length - 16);
    const keyStr = (uid + "_invedory_secure_key_2026").slice(0, 32);
    const key = Buffer.from(keyStr, "utf8");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, null, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    // 기존 btoa 형식 호환
    try { return Buffer.from(encoded, "base64").toString("utf8"); }
    catch (e2) { return ""; }
  }
}

// ── XPath 상수 (Python 크롤러와 동일) ───────────────────────────────────────
const XP = {
  ID_INPUT:    '//*[@id="id"]',
  PW_INPUT:    '//*[@id="pass"]',
  LOGIN_BTN:   '//*[@id="loginBtn"]',
  POPUP_HIDE:  '//*[@id="bottomImage"]/div[1]/button',
  MENU_SERVICE:'//*[@id="main-menu-navigation"]/li[1]/a',
  MENU_PRODUCT:'//*[@id="main-menu-navigation"]/li[1]/ul/li[3]/a',
  MENU_MACHINE:'//*[@id="main-menu-navigation"]/li[1]/ul/li[4]/a',
  PRODUCT_LIST:'/html/body/div[4]/div/div[2]/div/div/div/div',
  PRODUCT_PAGE:'/html/body/div[4]/div/div[2]/div/div/div/div/div[2]/ul/li/a',
  PRODUCT_NEXT:'/html/body/div[4]/div/div[2]/div/div/div/div/div[2]/ul/li[11]/a',
  MACHINE_SEARCH:'/html/body/div[4]/div/div[1]/div/div/div/div/form/div/div/div/div[1]/div[5]/button[1]',
  MACHINE_GRID:'//*[@id="main-grid"]',
  MACHINE_PAGE:'//*[@id="main"]/div/div/div/div/div[2]/ul/li/a',
  COLUMN_SEARCH:'/html/body/div[4]/div/div[2]/div/div/div/div/form/div/div[2]/div[3]/button[1]',
  COLUMN_DATA: '/html/body/div[4]/div/div[2]/div/div/div/div/form/div/div[3]/div[2]/div/div',
  COLUMN_BACK: '/html/body/div[4]/div/div[3]/div/div/div/div/form/div/div/button[1]',
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────
async function closePopup(page) {
  try {
    const popup = await page.$(`xpath/${XP.POPUP_HIDE}`);
    if (popup && await popup.isIntersectingViewport()) {
      await popup.click();
      await delay(500);
    }
  } catch (e) { /* ignore */ }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitIdle(page) {
  try { await page.waitForNetworkIdle({ timeout: 8000 }); } catch (e) { /* ok */ }
}

// XPath로 요소 찾기
async function $x(page, xpath) {
  return page.$$(`xpath/${xpath}`);
}

async function $x1(page, xpath) {
  return page.$(`xpath/${xpath}`);
}

// ── 페이지네이션 처리 ─────────────────────────────────────────────────────────
async function getAllPages(page, pageXpath, nextXpath, collectFn) {
  const allData = [];
  const first = await collectFn(page);
  allData.push(...first);
  if (!first.length) return allData;

  let currentPage = 1;
  while (true) {
    const nextPage = currentPage + 1;
    let clicked = false;

    // 페이지 번호 버튼 클릭
    try {
      const btns = await $x(page, pageXpath);
      for (const btn of btns) {
        const txt = (await btn.evaluate(el => el.textContent)).trim();
        if (txt === String(nextPage)) {
          await btn.click();
          await waitIdle(page);
          await delay(1000);
          clicked = true;
          break;
        }
      }
    } catch (e) { /* ignore */ }

    // 다음 버튼 클릭
    if (!clicked && nextXpath) {
      try {
        const nextBtn = await $x1(page, nextXpath);
        if (nextBtn && await nextBtn.isIntersectingViewport()) {
          await nextBtn.click();
          await waitIdle(page);
          await delay(1000);
          clicked = true;
        }
      } catch (e) { /* ignore */ }
    }

    if (!clicked) break;
    const data = await collectFn(page);
    if (!data.length) break;
    allData.push(...data);
    currentPage = nextPage;
  }
  return allData;
}

// ── 상품마스터 크롤링 ─────────────────────────────────────────────────────────
async function crawlProducts(page) {
  // 서비스관리 > 상품마스터
  await (await $x1(page, XP.MENU_SERVICE)).click();
  await delay(800);
  await (await $x1(page, XP.MENU_PRODUCT)).click();
  await waitIdle(page);
  await delay(2000);
  await closePopup(page);

  async function collectProducts(pg) {
    const rows = [];
    try {
      const trList = await $x(pg, `${XP.PRODUCT_LIST}//table//tbody//tr`);
      for (const tr of trList) {
        const cells = await tr.$$("td");
        const texts = [];
        for (const c of cells) texts.push((await c.evaluate(el => el.textContent)).trim());
        if (texts.length >= 8) {
          rows.push({
            productCode: texts[6] || "",
            productName: texts[7] || "",
            costPrice: texts[8] || "",
            barcode: texts[9] || "",
          });
        }
      }
    } catch (e) { /* ignore */ }
    return rows;
  }

  return getAllPages(page, XP.PRODUCT_PAGE, XP.PRODUCT_NEXT, collectProducts);
}

// ── 자판기 + 컬럼매칭 크롤링 ─────────────────────────────────────────────────
async function crawlMachinesAndColumns(page) {
  // 메인 → 서비스관리 > 운영머신기관리
  await page.goto("https://vmms.ubcn.co.kr/index", { waitUntil: "domcontentloaded" });
  await delay(2000);
  await closePopup(page);
  await (await $x1(page, XP.MENU_SERVICE)).click();
  await delay(1000);
  await (await $x1(page, XP.MENU_MACHINE)).click();
  await waitIdle(page);
  await delay(2000);
  await closePopup(page);

  // 조회 버튼
  try {
    const searchBtn = await $x1(page, XP.MACHINE_SEARCH);
    if (searchBtn) { await searchBtn.click(); await waitIdle(page); await delay(2000); }
  } catch (e) { /* ignore */ }

  // 자판기 목록 수집
  async function collectMachines(pg) {
    const rows = [];
    try {
      const trList = await $x(pg, `${XP.MACHINE_GRID}//tr`);
      for (const tr of trList) {
        const cells = await tr.$$("td");
        const texts = [];
        for (const c of cells) texts.push((await c.evaluate(el => el.textContent)).trim());
        if (texts.length >= 5) {
          rows.push({ machineName: texts[3] || "", deviceNo: texts[4] || "" });
        }
      }
    } catch (e) { /* ignore */ }
    return rows;
  }

  const machines = await getAllPages(page, XP.MACHINE_PAGE, null, collectMachines);
  const allColumns = {};

  // 각 자판기별 컬럼매칭
  for (let i = 0; i < machines.length; i++) {
    const devno = machines[i].deviceNo;
    const name = machines[i].machineName;
    if (!devno) continue;

    try {
      // 관리 버튼
      const mgmtBtn = await $x1(page, `${XP.MACHINE_GRID}//tr[${i + 1}]/td[2]/div/button`);
      if (!mgmtBtn) continue;
      await mgmtBtn.click();
      await delay(500);

      // 상품매칭 버튼
      let matchBtn = await $x1(page, `${XP.MACHINE_GRID}//tr[${i + 1}]/td[2]/div/div/a[2]`);
      if (!matchBtn) {
        const links = await $x(page, `${XP.MACHINE_GRID}//tr[${i + 1}]/td[2]/div/div/a`);
        for (const link of links) {
          const txt = (await link.evaluate(el => el.textContent)).trim();
          if (txt.includes("상품매칭")) { matchBtn = link; break; }
        }
      }
      if (!matchBtn) continue;
      await matchBtn.click();
      await waitIdle(page);
      await delay(2000);
      await closePopup(page);

      // 조회 버튼
      try {
        const colSearch = await $x1(page, XP.COLUMN_SEARCH);
        if (colSearch) { await colSearch.click(); await waitIdle(page); await delay(2000); }
      } catch (e) { /* ignore */ }

      // 스크롤
      try {
        const scrollArea = await $x1(page, XP.COLUMN_DATA);
        if (scrollArea) {
          for (let s = 0; s < 20; s++) {
            await scrollArea.evaluate(el => el.scrollTop = el.scrollHeight);
            await delay(300);
          }
        }
      } catch (e) { /* ignore */ }

      // 컬럼 데이터 수집
      const columns = [];
      try {
        let colRows = await $x(page, `${XP.COLUMN_DATA}//table//tbody//tr`);
        if (!colRows.length) colRows = await $x(page, `${XP.COLUMN_DATA}//tr`);

        for (const row of colRows) {
          const cells = await row.$$("td");
          const cellTexts = [];
          for (const c of cells) {
            const inp = await c.$("input");
            if (inp) {
              cellTexts.push((await inp.evaluate(el => el.value)).trim());
            } else {
              cellTexts.push((await c.evaluate(el => el.textContent)).trim());
            }
          }
          if (cellTexts.length >= 3) {
            columns.push({
              columnNo: cellTexts[0] || "",
              productCode: cellTexts[1] || "",
              productName: cellTexts[2] || "",
              costPrice: cellTexts[3] || "",
            });
          }
        }
      } catch (e) { /* ignore */ }

      allColumns[devno] = { machineName: name, deviceNo: devno, columns, count: columns.length };

      // 목록으로 돌아가기
      try {
        const backBtn = await $x1(page, XP.COLUMN_BACK);
        if (backBtn) { await backBtn.click(); await waitIdle(page); await delay(1500); }
        else { await page.goBack(); await delay(1500); }
      } catch (e) { await page.goBack(); await delay(1500); }
      await closePopup(page);

    } catch (e) {
      try { await page.goBack(); await delay(1500); } catch (e2) { /* ignore */ }
    }
  }

  return { machines, columns: allColumns };
}

// ── 메인 크롤링 함수 ─────────────────────────────────────────────────────────
async function crawlVmms(vmmsId, vmmsPw) {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 800 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(30000);

    // 1. 로그인
    await page.goto("https://vmms.ubcn.co.kr/login", { waitUntil: "domcontentloaded" });
    await delay(2000);
    await page.type('[id="id"]', vmmsId);
    await delay(300);
    await page.type('[id="pass"]', vmmsPw);
    await delay(300);
    await page.click('[id="loginBtn"]');
    try {
      await page.waitForNavigation({ timeout: 12000 });
    } catch (e) {
      await waitIdle(page);
    }
    await delay(1500);
    await closePopup(page);

    // 2. 상품마스터
    const products = await crawlProducts(page);

    // 3. 자판기 + 컬럼매칭
    const { machines, columns } = await crawlMachinesAndColumns(page);

    return { products, machines, columns };
  } finally {
    await browser.close();
  }
}

// ── 판매 데이터 크롤링 (거래내역 페이지) ────────────────────────────────────
const SALES_XP = {
  MENU_MAIN:   '//*[@id="main-menu-navigation"]/li[3]/a',
  MENU_TXN:    '//*[@id="main-menu-navigation"]/li[3]/ul/li[1]/a',
  BTN_SEARCH:  '//*[@id="hide"]/div/div[2]/button',
  TABLE:       '//*[@id="main"]/div/div/div/div/div[1]/table',
  PAGINATION:  '//*[@id="main"]/div/div/div/div/div[2]/ul',
};

const FIXED_HEADERS = ['순번','거래일시','조직루트','단말기명','단말기번호','머신기코드',
  '판매항목','컬럼','판매가','수단','입력','상태','카드번호',
  '승인번호','일련번호','카드사','매입사','사업자번호','상점ID',
  '마감일시','입금일','취소일'];

async function crawlSalesData(vmmsId, vmmsPw, targetDate) {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");

  console.log("[Sales] 브라우저 시작");
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 800 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(30000);

    // 1. 로그인
    console.log("[Sales] 1. 로그인");
    await page.goto("https://vmms.ubcn.co.kr/login", { waitUntil: "domcontentloaded" });
    await delay(2000);
    await page.type('[id="id"]', vmmsId);
    await delay(300);
    await page.type('[id="pass"]', vmmsPw);
    await delay(300);
    await page.click('[id="loginBtn"]');
    try { await page.waitForNavigation({ timeout: 12000 }); }
    catch (e) { await waitIdle(page); }
    await delay(1500);
    await closePopup(page);
    console.log("[Sales] 1. 로그인 완료, URL:", page.url());

    // 2. 거래내역 메뉴
    console.log("[Sales] 2. 거래내역 메뉴 이동");
    const menuMain = await $x1(page, SALES_XP.MENU_MAIN);
    if (!menuMain) throw new Error("거래현황 메뉴를 찾을 수 없습니다");
    await menuMain.click();
    await delay(800);
    const menuTxn = await $x1(page, SALES_XP.MENU_TXN);
    if (!menuTxn) throw new Error("거래내역 메뉴를 찾을 수 없습니다");
    await menuTxn.click();
    await waitIdle(page);
    await delay(2000);
    await closePopup(page);
    console.log("[Sales] 2. 거래내역 페이지 도착");

    // 3. 날짜 설정 (#sDate, #eDate 직접 사용)
    const today = targetDate || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    console.log("[Sales] 3. 날짜 설정:", today);
    // 방법 1: JavaScript setter
    await page.evaluate((td) => {
      ['sDate', 'eDate'].forEach(id => {
        const inp = document.getElementById(id);
        if (inp) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, td);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }, today);
    await delay(500);
    // 방법 2: Puppeteer fill로 재설정 (확실하게)
    for (const dateId of ['#sDate', '#eDate']) {
      try {
        const inp = await page.$(dateId);
        if (inp) {
          await inp.click({ clickCount: 3 }); // 전체 선택
          await inp.type(today, { delay: 50 });
          const val = await inp.evaluate(el => el.value);
          console.log(`[Sales] 3. ${dateId} = ${val}`);
        }
      } catch (e) { console.log(`[Sales] 3. ${dateId} fill 실패:`, e.message); }
    }
    await delay(500);

    // 4. 상세조회 → 전체 체크박스 선택
    console.log("[Sales] 4. 상세조회 필터");
    try {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button, a, span');
        for (const b of btns) {
          if (b.textContent.trim().includes('상세조회') && b.offsetParent !== null) {
            b.click(); return true;
          }
        }
        return false;
      });
      await delay(1000);
      await page.evaluate(() => {
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        });
      });
      await delay(500);
      // 상세조회 닫기
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button, a, span');
        for (const b of btns) {
          if (b.textContent.trim().includes('상세조회') && b.offsetParent !== null) {
            b.click(); return;
          }
        }
      });
      await delay(800);
    } catch (e) { console.log("[Sales] 4. 상세조회 설정 실패 (무시):", e.message); }

    // 5. 조회 클릭
    console.log("[Sales] 5. 조회 버튼 클릭");
    let searchClicked = false;
    try {
      const searchBtn = await $x1(page, SALES_XP.BTN_SEARCH);
      if (searchBtn) { await searchBtn.click(); searchClicked = true; }
    } catch (e) { /* ignore */ }
    if (!searchClicked) {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim().includes('조회') && b.offsetParent !== null) { b.click(); return; }
        }
      });
    }
    await waitIdle(page);
    await delay(3000);
    console.log("[Sales] 5. 조회 완료");

    // 5-1. 페이지 사이즈 최대로
    try {
      const maxVal = await page.evaluate(() => {
        const selects = document.querySelectorAll('select');
        for (const sel of selects) {
          let max = null;
          sel.querySelectorAll('option').forEach(o => {
            if (o.value && /^\d+$/.test(o.value)) {
              if (!max || parseInt(o.value) > parseInt(max)) max = o.value;
            }
          });
          if (max && parseInt(max) >= 20) {
            sel.value = max;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return max;
          }
        }
        return null;
      });
      if (maxVal) { console.log("[Sales] 페이지사이즈:", maxVal); await waitIdle(page); await delay(1500); }
    } catch (e) { /* ignore */ }

    // 6. 헤더 수집
    console.log("[Sales] 6. 헤더 수집");
    let headers = FIXED_HEADERS;
    try {
      const ths = await $x(page, `${SALES_XP.TABLE}//thead//th`);
      if (ths.length > 3) {
        headers = [];
        for (const th of ths) headers.push(await th.evaluate(el => el.textContent.trim()));
      }
    } catch (e) { /* ignore */ }
    console.log("[Sales] 6. 헤더:", headers.length, "개");

    // 7. 데이터 수집 (페이지네이션 포함)
    console.log("[Sales] 7. 데이터 수집");
    async function collectRows() {
      const rows = [];
      try {
        const trList = await $x(page, `${SALES_XP.TABLE}//tbody//tr`);
        for (const tr of trList) {
          const cells = await tr.$$('td');
          if (cells.length <= 1) continue;
          const row = [];
          for (const c of cells) row.push(await c.evaluate(el => el.textContent.trim()));
          const joined = row.join('');
          if (joined && !joined.includes('데이터가 없습니다')) rows.push(row);
        }
      } catch (e) { console.log("[Sales] collectRows 오류:", e.message); }
      return rows;
    }

    const allRows = [];
    const firstPage = await collectRows();
    allRows.push(...firstPage);
    console.log("[Sales] 7. 1페이지:", firstPage.length, "건");

    // 페이지네이션
    for (let nextPg = 2; nextPg < 200; nextPg++) {
      let clicked = false;
      try {
        const pageLinks = await $x(page, `${SALES_XP.PAGINATION}/li/a`);
        for (const link of pageLinks) {
          const txt = (await link.evaluate(el => el.textContent)).trim();
          if (txt === String(nextPg)) { await link.click(); await waitIdle(page); await delay(1000); clicked = true; break; }
        }
        // 페이지 번호가 안 보이면 '>' 또는 '다음' 버튼 클릭
        if (!clicked) {
          for (const link of pageLinks) {
            const txt = (await link.evaluate(el => el.textContent)).trim();
            if (txt === '>' || txt === '›' || txt === '다음' || txt === '»') {
              await link.click(); await waitIdle(page); await delay(1000); clicked = true; break;
            }
          }
        }
      } catch (e) { /* ignore */ }
      if (!clicked) break;
      const rows = await collectRows();
      if (!rows.length) break;
      allRows.push(...rows);
      console.log("[Sales] 7.", nextPg, "페이지:", rows.length, "건 (누계:", allRows.length, ")");
    }

    console.log("[Sales] 총", allRows.length, "건 수집 완료");
    return { today, headers, rows: allRows };
  } finally {
    await browser.close();
  }
}

// ── Cloud Function: 실시간 VMMS 판매 데이터 크롤링 ─────────────────────────
exports.crawlVmmsSales = onCall(
  {
    memory: "2GiB",
    timeoutSeconds: 300,
    region: "asia-northeast3",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다");
    }
    const uid = request.auth.uid;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

    // VMMS 계정 정보 읽기
    let vmmsData;
    try {
      const vmmsSnap = await admin.database().ref(`users/${uid}/vmms`).once("value");
      vmmsData = vmmsSnap.val();
    } catch (e) {
      throw new HttpsError("internal", "VMMS 계정 조회 실패: " + e.message);
    }
    if (!vmmsData || !vmmsData.id || !vmmsData.pw) {
      throw new HttpsError("failed-precondition", "VMMS 계정이 등록되어 있지 않습니다. 설정에서 VMMS 계정을 먼저 등록해주세요.");
    }

    let vmmsId, vmmsPw;
    try {
      vmmsId = decryptAES(vmmsData.id, uid);
      vmmsPw = decryptAES(vmmsData.pw, uid);
    } catch (e) {
      throw new HttpsError("internal", "VMMS 계정 복호화 실패: " + e.message);
    }
    if (!vmmsId || !vmmsPw) {
      throw new HttpsError("failed-precondition", "VMMS 계정 정보를 복호화할 수 없습니다");
    }

    // 크롤링 실행
    let result;
    try {
      const requestDate = request.data && request.data.date ? request.data.date : null;
      result = await crawlSalesData(vmmsId, vmmsPw, requestDate);
    } catch (e) {
      console.error("crawlSalesData 실패:", e);
      throw new HttpsError("internal", "VMMS 판매 크롤링 실패: " + (e.message || String(e)));
    }

    // Firebase 저장
    try {
      await admin.database().ref(`users/${uid}/crawledSales/${result.today}`).set({
        date: result.today,
        updated_at: nowStr,
        total_count: result.rows.length,
        headers: result.headers,
        rows: result.rows,
      });
    } catch (e) {
      console.error("Firebase 저장 실패:", e);
      throw new HttpsError("internal", "데이터 저장 실패: " + e.message);
    }

    return {
      success: true,
      total: result.rows.length,
      date: result.today,
      message: `${result.today} 판매 데이터 ${result.rows.length}건 수집 완료`,
    };
  }
);

// ── Cloud Function: 실시간 VMMS 제품 크롤링 ─────────────────────────────────
exports.crawlVmmsProducts = onCall(
  {
    memory: "2GiB",
    timeoutSeconds: 300,
    region: "asia-northeast3",
    cors: true,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다");
    }
    const uid = request.auth.uid;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

    // VMMS 계정 정보 읽기
    const vmmsSnap = await admin.database().ref(`users/${uid}/vmms`).once("value");
    const vmmsData = vmmsSnap.val();
    if (!vmmsData || !vmmsData.id || !vmmsData.pw) {
      throw new HttpsError("failed-precondition", "VMMS 계정이 등록되어 있지 않습니다. 설정에서 VMMS 계정을 먼저 등록해주세요.");
    }

    // 복호화
    const vmmsId = decryptAES(vmmsData.id, uid);
    const vmmsPw = decryptAES(vmmsData.pw, uid);
    if (!vmmsId || !vmmsPw) {
      throw new HttpsError("failed-precondition", "VMMS 계정 정보를 복호화할 수 없습니다");
    }

    // 크롤링 실행
    try {
      const result = await crawlVmms(vmmsId, vmmsPw);

      // Firebase 저장
      const updates = {};
      updates[`users/${uid}/vmmsProducts`] = {
        updated_at: nowStr,
        total: result.products.length,
        items: result.products,
      };
      updates[`users/${uid}/vmmsMachines`] = {
        updated_at: nowStr,
        total: result.machines.length,
        items: result.machines,
      };
      const totalCols = Object.values(result.columns).reduce((s, c) => s + (c.count || 0), 0);
      updates[`users/${uid}/vmmsColumns`] = {
        updated_at: nowStr,
        machines: result.columns,
      };
      await admin.database().ref().update(updates);

      return {
        success: true,
        products: result.products.length,
        machines: result.machines.length,
        columns: totalCols,
        message: `제품 ${result.products.length}개 · 자판기 ${result.machines.length}대 · 컬럼 ${totalCols}개 수집 완료`,
      };
    } catch (e) {
      throw new HttpsError("internal", "VMMS 크롤링 실패: " + e.message);
    }
  }
);

// ── 쿠팡 주문내역 크롤링 ─────────────────────────────────────────────────────
async function crawlCoupangOrders(email, pw) {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 800 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  try {
    // 1. 로그인
    console.log("[Coupang] 1. 로그인");
    await page.goto("https://login.coupang.com/login/login.pang", { waitUntil: "networkidle2" });
    await delay(5000);

    // 페이지 상태 디버깅
    const pageUrl = page.url();
    const inputCount = await page.evaluate(() => document.querySelectorAll('input').length);
    console.log("[Coupang] URL:", pageUrl, "input 수:", inputCount);

    // 모든 input 셀렉터 시도
    let emailInput = null, pwInput = null;
    const emailSelectors = ['#login-email-input', 'input[name="email"]', 'input[type="email"]', 'input[placeholder*="이메일"]', 'input[placeholder*="아이디"]'];
    const pwSelectors = ['#login-password-input', 'input[name="password"]', 'input[type="password"]'];

    for (const sel of emailSelectors) {
      emailInput = await page.$(sel);
      if (emailInput) { console.log("[Coupang] 이메일 필드:", sel); break; }
    }
    for (const sel of pwSelectors) {
      pwInput = await page.$(sel);
      if (pwInput) { console.log("[Coupang] 비밀번호 필드:", sel); break; }
    }

    // 그래도 못 찾으면 input 태그 순서로
    if (!emailInput || !pwInput) {
      const allInputs = await page.$$('input:not([type="hidden"])');
      console.log("[Coupang] visible input 수:", allInputs.length);
      if (allInputs.length >= 2) {
        emailInput = allInputs[0];
        pwInput = allInputs[1];
        console.log("[Coupang] input 순서로 할당");
      }
    }

    if (!emailInput || !pwInput) {
      const html = await page.evaluate(() => document.body.innerHTML.substring(0, 500));
      console.log("[Coupang] HTML:", html);
      throw new Error("로그인 필드를 찾을 수 없습니다");
    }

    await emailInput.click();
    await emailInput.type(email, { delay: 30 });
    await delay(300);
    await pwInput.click();
    await pwInput.type(pw, { delay: 30 });
    await delay(300);

    // 로그인 버튼
    const loginBtn = await page.$('button[type="submit"]') || await page.$('.login__button');
    if (loginBtn) await loginBtn.click();
    else await page.keyboard.press("Enter");
    await delay(5000);

    const url = page.url();
    console.log("[Coupang] 1. 로그인 후:", url);
    if (url.includes("login")) throw new Error("로그인 실패 - 이메일/비밀번호를 확인하세요");

    // SMS 인증 체크
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes("인증") && (bodyText.includes("번호") || bodyText.includes("SMS"))) {
      throw new Error("SMS 인증이 필요합니다. 쿠팡 앱에서 먼저 로그인하세요");
    }

    // 2. 주문내역 페이지
    console.log("[Coupang] 2. 주문내역 이동");
    await page.goto("https://mc.coupang.com/ssr/desktop/order/list", { waitUntil: "domcontentloaded" });
    await delay(3000);

    // 3. 주문 파싱
    console.log("[Coupang] 3. 주문 파싱");
    const orders = await page.evaluate(() => {
      const results = [];
      const text = document.body.innerText;
      // "YYYY. M. D 주문" 패턴으로 블록 분리
      const blocks = text.split(/(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*주문)/);

      for (let i = 0; i < blocks.length; i++) {
        const dateMatch = blocks[i].match(/(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\s*주문/);
        if (dateMatch && i + 1 < blocks.length) {
          const orderDate = dateMatch[1].replace(/\s/g, "");
          const content = blocks[i + 1];
          const lines = content.split("\n").map(l => l.trim()).filter(l => l);
          const products = [];

          for (const line of lines) {
            // "상품명, 옵션, N개" 패턴
            const qtyMatch = line.match(/(\d+)\s*개\s*$/);
            if (qtyMatch && line.length > 5) {
              const qty = parseInt(qtyMatch[1]);
              const name = line.slice(0, qtyMatch.index).trim().replace(/,\s*$/, "");
              if (name.length > 2) {
                products.push({ product_name: name, quantity: qty });
              }
            }
            // 금액 패턴
            const priceMatch = line.match(/^([\d,]+)\s*원$/);
            if (priceMatch && products.length > 0 && !products[products.length - 1].price) {
              products[products.length - 1].price = parseInt(priceMatch[1].replace(/,/g, ""));
            }
          }

          if (products.length) {
            results.push({ order_date: orderDate, products });
          }
        }
      }
      return results;
    });

    console.log("[Coupang] 3. 주문", orders.length, "건");
    const totalProducts = orders.reduce((sum, o) => sum + o.products.length, 0);
    return { orders, totalProducts };

  } finally {
    await browser.close();
  }
}

exports.crawlCoupangOrders = onCall(
  {
    memory: "2GiB",
    timeoutSeconds: 300,
    region: "asia-northeast3",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다");
    }
    const uid = request.auth.uid;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

    // 쿠팡 계정 읽기
    let coupangData;
    try {
      const snap = await admin.database().ref(`users/${uid}/coupangAccount`).once("value");
      coupangData = snap.val();
    } catch (e) {
      throw new HttpsError("internal", "쿠팡 계정 조회 실패");
    }
    if (!coupangData || !coupangData.email || !coupangData.pw) {
      throw new HttpsError("failed-precondition", "쿠팡 계정이 등록되어 있지 않습니다. 설정에서 먼저 등록해주세요.");
    }

    let email, pw;
    try {
      email = decryptAES(coupangData.email, uid);
      pw = decryptAES(coupangData.pw, uid);
    } catch (e) {
      throw new HttpsError("internal", "쿠팡 계정 복호화 실패");
    }

    let result;
    try {
      result = await crawlCoupangOrders(email, pw);
    } catch (e) {
      throw new HttpsError("internal", "쿠팡 크롤링 실패: " + (e.message || String(e)));
    }

    // Firebase 저장
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    try {
      await admin.database().ref(`users/${uid}/coupangOrders/${today}`).set({
        date: today,
        updated_at: nowStr,
        total_orders: result.orders.length,
        total_products: result.totalProducts,
        orders: result.orders,
      });
    } catch (e) {
      throw new HttpsError("internal", "데이터 저장 실패");
    }

    return {
      success: true,
      total_orders: result.orders.length,
      total_products: result.totalProducts,
      message: `쿠팡 주문 ${result.orders.length}건, 상품 ${result.totalProducts}개 수집 완료`,
    };
  }
);

// ─── 쿠팡 Gmail 주문내역 수집 ────────────────────────────────────────────────
// 클라이언트에서 Google OAuth access_token을 받아 Gmail API로 쿠팡 주문 메일을
// 조회한 뒤 본문을 파싱해 users/{uid}/coupangOrders/{날짜}에 저장.

/**
 * Gmail API 호출 래퍼
 */
async function gmailFetch(accessToken, path) {
  const url = `https://gmail.googleapis.com/gmail/v1/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Gmail 메시지 payload에서 text/html part를 찾아 base64url 디코드한 HTML 반환
 */
function extractHtmlFromPayload(payload) {
  if (!payload) return "";
  const decode = (data) => {
    if (!data) return "";
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    try { return Buffer.from(b64, "base64").toString("utf8"); }
    catch (_) { return ""; }
  };

  // 단일 body
  if (payload.body && payload.body.data && payload.mimeType === "text/html") {
    return decode(payload.body.data);
  }

  // multipart — 재귀 탐색
  const walk = (parts) => {
    if (!Array.isArray(parts)) return "";
    let htmlBody = "";
    let textBody = "";
    for (const p of parts) {
      if (p.mimeType === "text/html" && p.body && p.body.data) {
        htmlBody = decode(p.body.data);
      } else if (p.mimeType === "text/plain" && p.body && p.body.data && !textBody) {
        textBody = decode(p.body.data);
      } else if (p.parts) {
        const inner = walk(p.parts);
        if (inner) htmlBody = htmlBody || inner;
      }
    }
    return htmlBody || textBody;
  };
  return walk(payload.parts || []);
}

/**
 * HTML에서 태그 제거하고 공백 정리
 */
function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Gmail 메시지 내부 헤더에서 특정 이름을 찾아 반환
 */
function getHeader(headers, name) {
  if (!Array.isArray(headers)) return "";
  const h = headers.find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return h ? (h.value || "") : "";
}

/**
 * 쿠팡 구매 메일 본문 텍스트 → {order_date, products:[], total, order_id}
 *
 * 쿠팡 메일 샘플 구조:
 *   구매하신 내역을 확인해 주세요!
 *   구매 정보
 *   구매 상세내역          쿠팡가   수량   구매금액   배송정보   판매자
 *   조지아 오리지날 ...    7,200원  1     7,200원    주문확인중  휠링F/S
 *   결제 정보
 *   주문금액        7,200원
 *   배송비          5,000원
 *   결제금액       12,200원 ...
 */
function parseCoupangEmail(text, dateHint) {
  if (!text) return null;
  // \u00A0 (non-breaking space) → 일반 공백 치환 (Gmail 전달 시 발생)
  text = text.replace(/\u00A0/g, " ");
  const products = [];

  // 금액 패턴 (1,234원 또는 1234원)
  const priceRe = /([\d,]+)\s*원/;

  // "구매 상세내역" / "주문하신 내역" / "주문 상품" ~ "결제 정보" 사이 섹션 추출
  // "[쿠팡] 주문하신 내역" 메일은 본문에 "주문하신 내역" 또는 "주문 상품 정보" 헤더 사용
  const startIdx = text.search(/구매\s*(상세)?\s*내역|구매\s*정보|주문\s*상품|주문\s*하신\s*내역|주문\s*내역|상품\s*정보/);
  const endIdx = text.search(/결제\s*정보|주문\s*정보|결제\s*금액|총\s*결제\s*금액/);
  let section = "";
  if (startIdx >= 0) {
    section = endIdx > startIdx ? text.slice(startIdx, endIdx) : text.slice(startIdx, startIdx + 4000);
  } else {
    section = text;
  }

  // 줄 단위 파싱
  const lines = section.split(/\n|\r/).map((l) => l.trim()).filter(Boolean);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // 헤더 줄 스킵
    if (/^(구매|상품|쿠팡가|수량|구매금액|배송정보|판매자|결제|주문)/.test(line)) continue;
    // 한 줄에 "이름 가격원 수량 가격원" 패턴 (네이버 수동 전달)
    const m = line.match(/(.{3,}?)\s+([\d,]+)\s*원\s+(\d{1,3})\s+([\d,]+)\s*원/);
    if (m) {
      const name = m[1].replace(/[,\u00A0]+$/g, "").trim();
      const unitPrice = parseInt(m[2].replace(/,/g, ""), 10);
      const qty = parseInt(m[3], 10);
      const totalPrice = parseInt(m[4].replace(/,/g, ""), 10);
      if (name.length > 2 && qty > 0) {
        products.push({
          product_name: name,
          quantity: qty,
          unit_price: unitPrice,
          price: totalPrice || unitPrice * qty,
        });
      }
      continue;
    }
    // 여러 줄에 걸친 패턴 (Gmail 전달): "상품명, N개" 줄 → 다음 줄들에서 가격/수량 탐색
    const nameMatch = line.match(/^(.{3,}[,\s]+\d+\s*개)\s*$/);
    if (nameMatch) {
      const fullName = nameMatch[1].trim();
      let unitPrice = 0, qty = 0, totalPrice = 0;
      for (let j = li + 1; j < Math.min(li + 10, lines.length); j++) {
        const nl = lines[j];
        if (/^(구매|상품|쿠팡가|수량|구매금액|배송정보|판매자)/.test(nl)) continue;
        // 다음 상품 섹션 시작이면 중단
        if (nl.match(/^(.{3,}?)[,\s]+\d+\s*개\s*$/) && unitPrice) break;
        const priceM = nl.match(/^([\d,]+)\s*원\s*$/);
        if (priceM) {
          const val = parseInt(priceM[1].replace(/,/g, ""), 10);
          if (!unitPrice) unitPrice = val;
          else if (!totalPrice) totalPrice = val;
        }
        const qtyM = nl.match(/^(\d{1,3})$/);
        if (qtyM && !qty) qty = parseInt(qtyM[1], 10);
        if (unitPrice && qty && totalPrice) break;
      }
      if (unitPrice > 0 && qty > 0) {
        products.push({
          product_name: fullName,
          quantity: qty,
          unit_price: unitPrice,
          price: totalPrice || unitPrice * qty,
        });
      } else {
        products.push({
          product_name: fullName,
          quantity: 1,
        });
      }
    }
  }

  // ── 중복 제거: 섹션 제목(가격 없음)과 상세 테이블 행(가격 있음) 양쪽에서
  //    같은 상품이 추출되는 경우, 가격 있는 쪽만 남긴다.
  //    예: "싱싱 스낵 100g" (qty=20, price=undefined) vs
  //        "싱싱 스낵 100g, 20개" (qty=1, price=13900) → 후자만 유지.
  const deduped = [];
  for (const p of products) {
    const hasPrice = p.price && p.price > 0;
    if (hasPrice) {
      // 가격 있는 항목: 이전에 같은 이름(부분 일치)으로 가격 없이 추가된 게 있으면 제거
      const dupIdx = deduped.findIndex(
        (d) => (!d.price || d.price === 0) &&
               (p.product_name.includes(d.product_name) || d.product_name.includes(p.product_name))
      );
      if (dupIdx >= 0) deduped.splice(dupIdx, 1);
      deduped.push(p);
    } else {
      // 가격 없는 항목: 이미 같은 이름으로 가격 있는 게 있으면 스킵
      const alreadyHasPrice = deduped.some(
        (d) => d.price && d.price > 0 &&
               (p.product_name.includes(d.product_name) || d.product_name.includes(p.product_name))
      );
      if (!alreadyHasPrice) deduped.push(p);
    }
  }

  // 결제금액 추출
  let totalAmount = 0;
  const payMatch = text.match(/결제\s*금액\s*[:：]?\s*([\d,]+)\s*원/);
  if (payMatch) totalAmount = parseInt(payMatch[1].replace(/,/g, ""), 10);

  // 주문번호 추출
  let orderId = "";
  const idMatch = text.match(/주문\s*번호\s*[:：]?\s*([A-Z0-9\-]{6,})/);
  if (idMatch) orderId = idMatch[1];

  // 주문일자: 본문에서 먼저 찾고, 없으면 메일 헤더(dateHint) 사용.
  // 이유: 네이버/Gmail 에서 "전달"하면 Date 헤더가 전달 시각으로 바뀌어서
  //       원래 주문일(본문 안)과 다를 수 있음.
  let orderDate = "";
  // 1차: "주문일시" / "주문일" 레이블 근처의 날짜
  const odLabel = text.match(/주문\s*일(?:시|자)?\s*[:：]?\s*(\d{4})[.\-\/\s]*(\d{1,2})[.\-\/\s]*(\d{1,2})/);
  if (odLabel) {
    orderDate = `${odLabel[1]}.${odLabel[2].padStart(2, "0")}.${odLabel[3].padStart(2, "0")}`;
  }
  // 2차: 본문 어딘가의 yyyy.mm.dd 패턴
  if (!orderDate) {
    const dm = text.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (dm) orderDate = `${dm[1]}.${dm[2].padStart(2, "0")}.${dm[3].padStart(2, "0")}`;
  }
  // 3차: 헤더 날짜 (폴백)
  if (!orderDate) orderDate = dateHint || "";

  if (deduped.length === 0) return null;
  return {
    order_date: orderDate,
    products: deduped,
    total_amount: totalAmount,
    order_id: orderId,
  };
}

/**
 * 최근 받은 메일 목록 갱신 (최대 10건 유지, 최신이 앞에 옴)
 */
async function appendRecentMail(ref, entry) {
  try {
    const snap = await ref.once("value");
    const arr = snap.val() || [];
    const list = Array.isArray(arr) ? arr.slice() : Object.values(arr);
    list.unshift(entry);
    await ref.set(list.slice(0, 10));
  } catch (e) {
    console.error("[appendRecentMail] error:", e);
  }
}

/**
 * RFC 2822 날짜 문자열을 "YYYY.MM.DD" (KST)로
 */
function toKstDateStr(rfcDate) {
  try {
    const d = new Date(rfcDate);
    if (isNaN(d.getTime())) return "";
    const kst = new Date(d.getTime() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const day = String(kst.getUTCDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  } catch (_) {
    return "";
  }
}

exports.syncCoupangFromGmail = onCall(
  {
    memory: "512MiB",
    timeoutSeconds: 300,
    region: "asia-northeast3",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다");
    }
    const uid = request.auth.uid;
    const accessToken = request.data && request.data.accessToken;
    const daysBack = (request.data && request.data.daysBack) || 90;

    if (!accessToken || typeof accessToken !== "string") {
      throw new HttpsError("invalid-argument", "accessToken이 필요합니다");
    }

    const debugLog = [];
    debugLog.push(`Gmail 동기화 시작 uid=${uid.slice(0, 8)}, daysBack=${daysBack}`);

    try {
      // 1. Gmail 메시지 목록 조회 — 쿠팡 주문 메일 필터
      //    쿠팡 발송 도메인: coupang.com, marketplace.coupang.com 등
      const query = [
        "from:(@coupang.com)",
        "(구매하신 OR 주문 OR 결제 OR 구매내역)",
        `newer_than:${daysBack}d`,
      ].join(" ");
      debugLog.push(`query: ${query}`);

      const listPath = `users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`;
      const listResp = await gmailFetch(accessToken, listPath);
      const messages = listResp.messages || [];
      debugLog.push(`검색 결과: ${messages.length}건`);

      if (messages.length === 0) {
        return {
          success: true,
          total_messages: 0,
          total_orders: 0,
          total_products: 0,
          message: "쿠팡 주문 메일이 없습니다",
          debug_log: debugLog,
        };
      }

      // 2. 각 메시지 본문 가져와서 파싱
      const parsed = [];
      let okCount = 0;
      let failCount = 0;
      for (const msg of messages) {
        try {
          const full = await gmailFetch(accessToken, `users/me/messages/${msg.id}?format=full`);
          const headers = (full.payload && full.payload.headers) || [];
          const subject = getHeader(headers, "Subject");
          const dateRaw = getHeader(headers, "Date");
          const dateHint = toKstDateStr(dateRaw);

          const html = extractHtmlFromPayload(full.payload);
          const text = htmlToText(html);
          const order = parseCoupangEmail(text, dateHint);

          if (order && order.products.length > 0) {
            parsed.push({ ...order, message_id: msg.id, subject });
            okCount++;
            debugLog.push(`✅ "${subject}" → 제품 ${order.products.length}개 (${dateHint})`);
          } else {
            failCount++;
            debugLog.push(`❌ "${subject}" → 제품 추출 실패 (${dateHint}) 본문길이:${(text||'').length}자`);
          }
        } catch (e) {
          failCount++;
          debugLog.push(`메시지 ${msg.id} 파싱 실패: ${String(e.message || e).slice(0, 150)}`);
        }
      }
      debugLog.push(`파싱 성공 ${okCount}건 / 실패 ${failCount}건`);

      // 3. 주문일자 기준으로 그룹 → users/{uid}/coupangOrders/{YYYY-MM-DD}
      const grouped = {};
      for (const order of parsed) {
        const dateKey = (order.order_date || "").replace(/\./g, "-");
        if (!dateKey) continue;
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(order);
      }

      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
      const updates = {};
      let totalOrders = 0;
      let totalProducts = 0;

      for (const [dateKey, orders] of Object.entries(grouped)) {
        // 기존 스크립트(🛒 경로) 저장 스키마와 동일하게 맞춰서 저장
        const products = orders.reduce((acc, o) => acc + o.products.length, 0);
        totalOrders += orders.length;
        totalProducts += products;
        updates[`users/${uid}/coupangOrders/${dateKey}`] = {
          date: dateKey,
          updated_at: nowStr,
          source: "gmail",
          total_orders: orders.length,
          total_products: products,
          orders: orders.map((o) => ({
            order_date: o.order_date,
            order_id: o.order_id || "",
            total_amount: o.total_amount || 0,
            products: o.products,
          })),
        };
      }

      if (Object.keys(updates).length > 0) {
        await admin.database().ref().update(updates);
      }

      return {
        success: true,
        total_messages: messages.length,
        total_orders: totalOrders,
        total_products: totalProducts,
        dates: Object.keys(grouped).sort(),
        message: `Gmail에서 쿠팡 주문 ${totalOrders}건(상품 ${totalProducts}개) 동기화 완료`,
        debug_log: debugLog,
      };
    } catch (e) {
      console.error("[syncCoupangFromGmail] error:", e);
      throw new HttpsError("internal", `Gmail 동기화 실패: ${e.message || String(e)}`);
    }
  }
);

// ─── 쿠팡 이메일 전달 방식 ─────────────────────────────────────────────────────
// 사용자가 본인 메일(네이버/Gmail/다음 등)에 "쿠팡 메일 오면 u-{hash}@invendory.kr
// 로 전달" 규칙을 설정. Cloudflare Email Routing이 받은 메일을 Cloudflare
// Worker로 넘기고, Worker가 본 함수 receiveForwardedEmail로 HTTP POST 전송.

/**
 * MIME quoted-printable 디코더 (UTF-8 정상 처리)
 */
function decodeQuotedPrintable(input) {
  const cleaned = String(input).replace(/=\r?\n/g, ""); // soft line breaks 제거
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "=" && i + 2 < cleaned.length) {
      const hex = cleaned.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * 단일 MIME part 헤더/바디 분리 후 CTE 디코드
 */
function _decodeMimePart(partRaw) {
  // part 내부 헤더/바디 분리
  let sepIdx = partRaw.indexOf("\r\n\r\n");
  let sep = "\r\n\r\n";
  if (sepIdx < 0) {
    sepIdx = partRaw.indexOf("\n\n");
    sep = "\n\n";
  }
  if (sepIdx < 0) return partRaw;

  const headers = partRaw.slice(0, sepIdx).toLowerCase();
  let body = partRaw.slice(sepIdx + sep.length);

  // Content-Transfer-Encoding
  const cteMatch = headers.match(/content-transfer-encoding:\s*([^\r\n;]+)/i);
  const cte = cteMatch ? cteMatch[1].trim().toLowerCase() : "7bit";

  if (cte === "base64") {
    try {
      const clean = body.replace(/\s/g, "");
      body = Buffer.from(clean, "base64").toString("utf8");
    } catch (_) { /* keep raw */ }
  } else if (cte === "quoted-printable") {
    body = decodeQuotedPrintable(body);
  }
  return body;
}

/**
 * 원시 MIME 이메일에서 사람이 읽을 수 있는 본문 텍스트를 추출.
 * text/html 파트를 우선하고, 없으면 text/plain 사용.
 */
function extractEmailBody(raw) {
  if (!raw) return "";

  // 1. 최상위 헤더/바디 분리
  let sepIdx = raw.indexOf("\r\n\r\n");
  let sep = "\r\n\r\n";
  if (sepIdx < 0) {
    sepIdx = raw.indexOf("\n\n");
    sep = "\n\n";
  }
  if (sepIdx < 0) return htmlToText(raw);

  const topHeaders = raw.slice(0, sepIdx);
  const topHeadersLower = topHeaders.toLowerCase();
  let body = raw.slice(sepIdx + sep.length);

  // 2. multipart 인지 확인
  const boundaryMatch = topHeadersLower.match(/boundary=["']?([^"'\r\n;]+)/);

  if (boundaryMatch) {
    const boundary = "--" + boundaryMatch[1];
    const parts = body.split(boundary).map((p) => p.trim()).filter(Boolean);

    let htmlPart = "";
    let plainPart = "";

    for (const part of parts) {
      if (!part || part === "--") continue;
      const partLower = part.toLowerCase();

      // 중첩 multipart 재귀
      if (partLower.startsWith("content-type: multipart/")) {
        const nested = extractEmailBody(part);
        if (nested) {
          if (/</.test(nested)) htmlPart = htmlPart || nested;
          else plainPart = plainPart || nested;
        }
        continue;
      }

      // message/rfc822 (Gmail 자동 전달 등 — 원본 메일이 첨부 형태로 포함)
      if (partLower.includes("content-type: message/rfc822")) {
        const nested = extractEmailBody(part);
        if (nested && nested.length > (htmlPart || plainPart || "").length) {
          htmlPart = nested;
        }
        continue;
      }

      if (partLower.includes("content-type: text/html")) {
        htmlPart = _decodeMimePart(part);
      } else if (partLower.includes("content-type: text/plain") && !plainPart) {
        plainPart = _decodeMimePart(part);
      }
    }

    const chosen = htmlPart || plainPart || body;
    return htmlToText(chosen);
  }

  // 3. 단일 파트 — 최상위 CTE 적용
  const cteMatch = topHeadersLower.match(/content-transfer-encoding:\s*([^\r\n;]+)/i);
  const cte = cteMatch ? cteMatch[1].trim().toLowerCase() : "7bit";
  if (cte === "base64") {
    try {
      body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
    } catch (_) { /* ignore */ }
  } else if (cte === "quoted-printable") {
    body = decodeQuotedPrintable(body);
  }
  return htmlToText(body);
}

/**
 * 전달 주소 발급(또는 기존 조회)용 onCall
 * users/{uid}/mailForward/address 와 mailForward/{hash} 매핑 생성.
 */
exports.getMailForwardAddress = onCall(
  {
    memory: "256MiB",
    timeoutSeconds: 30,
    region: "asia-northeast3",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다");
    }
    const uid = request.auth.uid;
    const domain = "invendory.kr";

    // 기존 주소 재사용
    try {
      const existingSnap = await admin.database().ref(`users/${uid}/mailForward`).once("value");
      const existing = existingSnap.val();
      if (existing && existing.hash && existing.address) {
        return {
          address: existing.address,
          hash: existing.hash,
          created_at: existing.created_at || null,
          last_received_at: existing.last_received_at || null,
          reused: true,
        };
      }
    } catch (_) { /* fall through */ }

    // 신규 발급 — 12자리 base36 (약 62bit)
    const hash = crypto.randomBytes(8).toString("hex").slice(0, 12);
    const address = `u-${hash}@${domain}`;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

    const updates = {};
    updates[`mailForward/${hash}`] = { uid, created_at: nowStr };
    updates[`users/${uid}/mailForward`] = {
      hash,
      address,
      created_at: nowStr,
    };
    await admin.database().ref().update(updates);

    return { address, hash, created_at: nowStr, reused: false };
  }
);

/**
 * Cloudflare Email Worker가 호출하는 HTTP 엔드포인트.
 * Worker가 raw MIME + 메타데이터를 POST.
 * 인증: X-Worker-Secret 헤더가 appConfig/emailWorkerSecret 과 일치해야 함.
 */
exports.receiveForwardedEmail = onRequest(
  {
    memory: "512MiB",
    timeoutSeconds: 60,
    region: "asia-northeast3",
    cors: false,
    invoker: "public",
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      // 1. 공유 비밀키 검증
      const workerSecret = (req.get("x-worker-secret") || "").trim();
      let expectedSecret = "";
      try {
        const snap = await admin.database().ref("appConfig/emailWorkerSecret").once("value");
        expectedSecret = snap.val() || "";
      } catch (e) {
        console.error("[receiveForwardedEmail] secret read failed:", e);
        res.status(500).json({ error: "config read failed" });
        return;
      }
      if (!expectedSecret || workerSecret !== expectedSecret) {
        console.log("[receiveForwardedEmail] unauthorized");
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      // 2. payload 파싱
      const { to, from, subject, raw, receivedAt } = req.body || {};
      if (!to || !raw) {
        res.status(400).json({ error: "to + raw required" });
        return;
      }

      console.log(`[receiveForwardedEmail] to=${to}, from=${from}, subject=${String(subject).slice(0, 80)}`);

      // 3. 수신 주소 → hash → uid
      const m = String(to).toLowerCase().match(/u-([a-z0-9]{8,24})@invendory\.kr/);
      if (!m) {
        console.log(`[receiveForwardedEmail] invalid recipient: ${to}`);
        res.status(200).json({ ok: true, dropped: true, reason: "invalid recipient" });
        return;
      }
      const hash = m[1];

      let uid = "";
      try {
        const snap = await admin.database().ref(`mailForward/${hash}`).once("value");
        const val = snap.val();
        uid = val && val.uid;
      } catch (e) {
        console.error("[receiveForwardedEmail] lookup failed:", e);
        res.status(500).json({ error: "db lookup failed" });
        return;
      }
      if (!uid) {
        console.log(`[receiveForwardedEmail] unknown hash: ${hash}`);
        res.status(200).json({ ok: true, dropped: true, reason: "unknown recipient" });
        return;
      }

      // ── from 주소 추출 헬퍼 ("Name <addr@domain>" 형태 대응) ──
      const extractAddr = (v) => {
        if (!v) return "";
        const s = String(v);
        const angle = s.match(/<([^>]+)>/);
        if (angle) return angle[1].trim().toLowerCase();
        const tok = s.match(/[\w.+-]+@[\w.-]+/);
        return tok ? tok[0].trim().toLowerCase() : s.trim().toLowerCase();
      };
      const fromAddr = extractAddr(from);

      // ── Gmail 전달 주소 확인 메일 감지 (v3) ───────────────────────────
      // 사용자가 Gmail "전달 및 POP/IMAP" 에 u-xxx@invendory.kr 를 등록하면
      // Gmail 이 forwarding-noreply@google.com 에서 9자리 확인 코드를 보냄.
      // 쿠팡 발신자가 아니므로 아래의 쿠팡 계정 검증/쿠팡 키워드 필터에서
      // 드롭되기 전에 먼저 가로채서 pending_verification 에 저장.
      //
      // 감지는 여러 소스에서 `forwarding-noreply` 문자열을 단순 substring 으로
      // 찾는 방식으로 최대한 관대하게 한다 (regex/escape 이슈 회피).
      try {
        const fromStrRaw = String(from || "").toLowerCase();
        const rawStrEarly = String(raw || "");
        const rawLowerEarly = rawStrEarly.toLowerCase();
        const subjStrEarly = String(subject || "");
        const subjLowerEarly = subjStrEarly.toLowerCase();

        const hasForwardingFrom =
          fromAddr.indexOf("forwarding-noreply") >= 0 ||
          fromStrRaw.indexOf("forwarding-noreply") >= 0 ||
          rawLowerEarly.indexOf("from: google <forwarding-noreply") >= 0 ||
          rawLowerEarly.indexOf("forwarding-noreply@google.com") >= 0;
        const hasForwardingSubject =
          subjLowerEarly.indexOf("forwarding confirmation") >= 0 ||
          subjStrEarly.indexOf("전달 확인") >= 0 ||
          subjStrEarly.indexOf("전달확인") >= 0 ||
          subjLowerEarly.indexOf("gmail 전달") >= 0;
        const isGmailVerify = hasForwardingFrom || hasForwardingSubject;

        // 항상 진단 로그 + debug 노드 남김 (감지가 안 될 때 원인 파악용)
        console.log(`[receiveForwardedEmail] gmail-verify-check uid=${uid.slice(0, 8)} fromMatch=${hasForwardingFrom} subjMatch=${hasForwardingSubject} detected=${isGmailVerify}`);

        if (isGmailVerify) {
          const bodyEarly = extractEmailBody(rawStrEarly) || "";
          // 코드 추출 — 여러 패턴 시도, 9자리 숫자 우선
          let code = "";
          const ctxMatch = bodyEarly.match(/(?:Confirmation code|확인\s*코드|인증\s*코드)[^\d]{0,30}(\d{6,12})/i);
          if (ctxMatch) code = ctxMatch[1];
          if (!code) {
            const nine = bodyEarly.match(/\b(\d{9})\b/) || rawStrEarly.match(/\b(\d{9})\b/);
            if (nine) code = nine[1];
          }
          if (!code) {
            const anyLong = bodyEarly.match(/\b(\d{6,12})\b/) || rawStrEarly.match(/\b(\d{6,12})\b/);
            if (anyLong) code = anyLong[1];
          }
          // 승인 링크 — mail.google.com 과 mail-settings.google.com 양쪽 대응
          // bodyEarly 가 base64 인코딩된 채로 올 수 있으므로 디코딩 후에도 탐색.
          let url = "";
          const urlRe = /https:\/\/mail(?:[.-]settings)?\.google\.com\/mail\/[^\s"<>\r\n]+/i;
          const urlMatch = urlRe.exec(bodyEarly) || urlRe.exec(rawStrEarly);
          if (urlMatch) {
            url = urlMatch[0];
          } else {
            // bodyEarly 가 base64 통째로 들어왔을 수 있음 — 디코딩 후 재시도
            try {
              const decodedBody = Buffer.from(bodyEarly.replace(/\s/g, ""), "base64").toString("utf8");
              const m2 = urlRe.exec(decodedBody);
              if (m2) url = m2[0];
            } catch (_) { /* not base64, ignore */ }
          }
          if (!url) {
            // raw 본문 안의 base64 블록을 찾아 디코딩
            try {
              const b64Block = rawStrEarly.match(/\r?\n\r?\n([A-Za-z0-9+/=\s]{100,})/);
              if (b64Block) {
                const decoded2 = Buffer.from(b64Block[1].replace(/\s/g, ""), "base64").toString("utf8");
                const m3 = urlRe.exec(decoded2);
                if (m3) url = m3[0];
              }
            } catch (_) { /* ignore */ }
          }

          const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

          // 디버그 샘플 저장 — 앞으로 파싱 실패 원인 분석용
          try {
            await admin.database().ref(`users/${uid}/mailForward/last_gmail_verify_debug`).set({
              at: nowStr,
              from: fromAddr.slice(0, 120),
              subject: subjStrEarly.slice(0, 200),
              body_sample: bodyEarly.slice(0, 1200),
              code_found: !!code,
              url_found: !!url,
            });
          } catch (_) { /* ignore */ }

          // 코드/링크 중 하나라도 찾았으면 pending_verification 에 저장
          await admin.database().ref(`users/${uid}/mailForward/pending_verification`).set({
            type: "gmail",
            code: code || "",
            url: url || "",
            received_at: nowStr,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          });
          await admin.database().ref(`users/${uid}/mailForward/last_received_at`).set(nowStr);
          await admin.database().ref(`users/${uid}/mailForward/last_sender`).set(fromAddr.slice(0, 100));
          console.log(`[receiveForwardedEmail] gmail verification captured uid=${uid.slice(0, 8)} code=${code ? "yes" : "no"} url=${url ? "yes" : "no"}`);
          res.status(200).json({ ok: true, verification: "gmail_pending", has_code: !!code, has_url: !!url });
          return;
        }
      } catch (e) {
        console.error("[receiveForwardedEmail] gmail verify detection failed:", e);
      }

      // 4. 발신자 신원 검증 — 비활성화
      //    이메일 전달 방식에서는 전달 주소(u-xxx@invendory.kr) 자체가 사용자별
      //    고유하므로, 해당 주소로 도착한 메일은 해당 사용자의 것으로 신뢰.
      //    기존의 coupangAccount 이메일 대조 검증은 네이버→Gmail 전환, 수동 전달
      //    등 정상 시나리오에서 false positive 가 많아 제거함.
      console.log(`[receiveForwardedEmail] identity check skipped (trust unique address) uid=${uid.slice(0, 8)} from=${fromAddr.slice(0, 40)}`);

      // 5. 발신자/본문 검증 — 쿠팡 관련 메일인지 판단
      //    네이버에서 사용자가 수동으로 "전달"한 경우 from은 본인 주소가 되고
      //    원본 발신자 정보는 본문 내부에만 남음. 따라서 from만 보면 안 되고
      //    제목/본문에서도 쿠팡 흔적을 찾아야 함.
      const fromLower = String(from || "").toLowerCase();
      const subjectLower = String(subject || "").toLowerCase();
      const rawLower = String(raw || "").toLowerCase();
      const isCoupang =
        fromLower.includes("coupang") ||
        subjectLower.includes("coupang") ||
        subjectLower.includes("쿠팡") ||
        rawLower.includes("coupang.com") ||
        rawLower.includes("@coupang") ||
        rawLower.includes("쿠팡");
      if (!isCoupang) {
        // 쿠팡이 아닌 메일은 드롭 (테스트 메일 등)
        // last_received_at은 갱신해서 UI에 "테스트 메일 받음" 표시 가능
        const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
        await admin.database().ref(`users/${uid}/mailForward/last_received_at`).set(nowStr);
        await admin.database().ref(`users/${uid}/mailForward/last_sender`).set(fromLower.slice(0, 100));
        console.log(`[receiveForwardedEmail] non-coupang sender dropped: ${fromLower}`);
        res.status(200).json({ ok: true, dropped: true, reason: "non-coupang sender" });
        return;
      }

      // 5. 본문 텍스트 추출 + 쿠팡 파싱
      const bodyText = extractEmailBody(String(raw));
      const dateHint = receivedAt ? toKstDateStr(receivedAt) : "";
      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

      // last_received_at 는 항상 갱신
      await admin.database().ref(`users/${uid}/mailForward/last_received_at`).set(nowStr);
      await admin.database().ref(`users/${uid}/mailForward/last_sender`).set(fromLower.slice(0, 100));

      // 최근 받은 메일 목록 (최대 10건) — 어떤 제목이 실제로 도착했는지 진단용
      const recentMailsRef = admin.database().ref(`users/${uid}/mailForward/recent_mails`);
      const recentMailEntry = {
        at: nowStr,
        subject: String(subject || "").slice(0, 200),
        from: fromLower.slice(0, 100),
        outcome: "received",
      };

      // 5-1. 결제 확인/배송/취소 등 상품 정보가 없는 알림 메일은 파싱 시도 없이 스킵
      //      예: "김*기님, 쿠팡(주)에서 [신용카드]결제하신 내역입니다."
      //      → 이런 메일은 카드사 결제 영수증 형식이라 상품 line item이 없음.
      //      실제 상품 정보는 별도 "구매 확정"/"구매 상세내역" 메일에 들어옴.
      const subjectStr = String(subject || "");
      // "주문하신 내역", "주문 내역", "구매 상세내역" 등 — 상품 정보가 들어있는 메일 패턴
      const hasOrderDetails = /구매\s*하신|구매\s*상세|구매\s*내역|주문\s*상품|주문\s*확인|주문\s*하신\s*내역|주문\s*내역|배송\s*완료/.test(subjectStr) ||
                              /구매\s*상세\s*내역|구매하신\s*내역|주문\s*상품|주문\s*하신\s*내역|주문\s*내역/.test(bodyText);
      const isNotificationOnly =
        (/결제하신\s*내역|결제\s*확인|결제\s*완료|\[신용카드\]|입금\s*확인|배송\s*시작|취소\s*완료|환불/.test(subjectStr)) &&
        !hasOrderDetails;
      if (isNotificationOnly) {
        console.log(`[receiveForwardedEmail] notification-only mail skipped: subject="${subjectStr.slice(0, 80)}"`);
        await admin.database().ref(`users/${uid}/mailForward/last_skipped`).set({
          at: nowStr,
          subject: subjectStr.slice(0, 200),
          reason: "결제/배송 알림 메일 (상품 정보 없음)",
        });
        recentMailEntry.outcome = "skipped";
        await appendRecentMail(recentMailsRef, recentMailEntry);
        // 이전 파싱 실패 기록은 그대로 두되 — 실제 실패가 아니므로 새로 기록하지 않음
        res.status(200).json({ ok: true, parsed: false, reason: "notification-only" });
        return;
      }

      const order = parseCoupangEmail(bodyText, dateHint);

      // 파싱 디버그: 성공/실패 무관하게 본문 샘플 저장
      await admin.database().ref(`users/${uid}/mailForward/last_parse_debug`).set({
        at: nowStr,
        subject: subjectStr.slice(0, 200),
        body_sample: bodyText.slice(0, 1500),
        products_found: order ? (order.products || []).length : 0,
        has_prices: order ? (order.products || []).some(p => p.price > 0) : false,
      });

      if (!order || !order.products || order.products.length === 0) {
        console.log(`[receiveForwardedEmail] parse failed: to=${to}, subject=${subject}`);
        await admin.database().ref(`users/${uid}/mailForward/last_parse_failed`).set({
          at: nowStr,
          subject: subjectStr.slice(0, 200),
          body_sample: bodyText.slice(0, 800),
        });
        recentMailEntry.outcome = "parse_failed";
        await appendRecentMail(recentMailsRef, recentMailEntry);
        res.status(200).json({ ok: true, parsed: false, reason: "no products" });
        return;
      }
      recentMailEntry.outcome = "parsed";
      recentMailEntry.products = order.products.length;
      await appendRecentMail(recentMailsRef, recentMailEntry);

      // 6. Firebase 저장 (날짜별 그룹)
      const dateKey = (order.order_date || dateHint || "").replace(/\./g, "-");
      if (!dateKey) {
        res.status(200).json({ ok: true, parsed: false, reason: "no date" });
        return;
      }

      const dayRef = admin.database().ref(`users/${uid}/coupangOrders/${dateKey}`);
      const existingSnap = await dayRef.once("value");
      const existingVal = existingSnap.val() || {};
      let existingOrders = existingVal.orders || [];
      if (!Array.isArray(existingOrders)) {
        existingOrders = Object.values(existingOrders);
      }

      // 중복 체크 (order_id 또는 상품 구성 기준)
      const key = (o) => {
        if (o.order_id) return `id:${o.order_id}`;
        const sig = (o.products || [])
          .map((p) => `${p.product_name}x${p.quantity}`)
          .join("|");
        return `sig:${sig}`;
      };
      const existingKeys = new Set(existingOrders.map(key));
      const newOrder = {
        order_date: order.order_date,
        order_id: order.order_id || "",
        total_amount: order.total_amount || 0,
        products: order.products,
      };
      let added = false;
      if (!existingKeys.has(key(newOrder))) {
        existingOrders.push(newOrder);
        added = true;
      }

      const totalProducts = existingOrders.reduce(
        (s, o) => s + ((o.products && o.products.length) || 0),
        0
      );

      await dayRef.set({
        date: dateKey,
        updated_at: nowStr,
        source: "email",
        total_orders: existingOrders.length,
        total_products: totalProducts,
        orders: existingOrders,
      });

      console.log(`[receiveForwardedEmail] saved uid=${uid.slice(0, 8)} date=${dateKey} added=${added} products=${order.products.length}`);
      res.status(200).json({
        ok: true,
        parsed: true,
        added,
        dateKey,
        products: order.products.length,
      });
    } catch (e) {
      console.error("[receiveForwardedEmail] fatal:", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 쿠팡 파트너스 Deeplink API
// 검색어 → 추적되는 단축 링크(link.coupang.com/a/XXXXXX) 변환
// HMAC-SHA256 서명을 서버에서 처리해야 키가 노출되지 않음.
// ─────────────────────────────────────────────────────────────────────────────
function _coupangSign(method, path, accessKey, secretKey) {
  // datetime: yyMMdd'T'HHmmss'Z' (UTC)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const datetime =
    String(d.getUTCFullYear()).slice(2) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z";
  // path와 query를 분리
  const [urlPath, query = ""] = path.split("?");
  const message = datetime + method + urlPath + query;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(message)
    .digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

exports.coupangAffiliateLink = onCall(
  {
    region: "asia-northeast3",
    secrets: [COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다");
    const keyword = (req.data && req.data.keyword) || "";
    if (!keyword || !keyword.trim()) {
      throw new HttpsError("invalid-argument", "검색어가 필요합니다");
    }
    const accessKey = COUPANG_ACCESS_KEY.value();
    const secretKey = COUPANG_SECRET_KEY.value();
    if (!accessKey || !secretKey) {
      throw new HttpsError(
        "failed-precondition",
        "쿠팡 파트너스 키가 설정되어 있지 않습니다"
      );
    }

    const fullUrl = "https://www.coupang.com/np/search?q=" + encodeURIComponent(keyword.trim());
    const apiPath = "/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink";
    const auth = _coupangSign("POST", apiPath, accessKey, secretKey);
    const body = JSON.stringify({ coupangUrls: [fullUrl], subId: "AF1423505" });

    const resp = await fetch("https://api-gateway.coupang.com" + apiPath, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json;charset=UTF-8",
      },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("[coupangAffiliateLink] HTTP", resp.status, text);
      throw new HttpsError(
        "internal",
        "쿠팡 파트너스 API 오류: " + resp.status
      );
    }
    const json = await resp.json();
    const item =
      json && json.data && Array.isArray(json.data) && json.data[0];
    if (!item || !item.shortenUrl) {
      console.error("[coupangAffiliateLink] unexpected response:", json);
      throw new HttpsError("internal", "단축 링크 변환 실패");
    }
    return {
      shortUrl: item.shortenUrl,
      landingUrl: item.landingUrl || fullUrl,
    };
  }
);

