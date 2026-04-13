/**
 * VMMS 실시간 크롤링 Cloud Functions
 * - crawlVmmsProducts: 제품/자판기/컬럼 데이터 실시간 수집
 * - crawlVmmsSales: 판매(거래내역) 데이터 실시간 수집
 * - Puppeteer로 VMMS 사이트에 로그인 → 데이터 수집 → Firebase 저장
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

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
  const products = [];

  // 금액 패턴 (1,234원 또는 1234원)
  const priceRe = /([\d,]+)\s*원/;

  // "구매 상세내역" ~ "결제 정보" 사이 섹션 추출
  const startIdx = text.search(/구매\s*(상세)?\s*내역|구매\s*정보|주문\s*상품/);
  const endIdx = text.search(/결제\s*정보|주문\s*정보|결제\s*금액/);
  let section = "";
  if (startIdx >= 0) {
    section = endIdx > startIdx ? text.slice(startIdx, endIdx) : text.slice(startIdx, startIdx + 4000);
  } else {
    section = text;
  }

  // 줄 단위 파싱: "상품명 ... 7,200원 1 7,200원 ..." 형태
  //  - 가격이 두 번 등장하고 그 사이에 수량(정수)이 있는 경우 = 1개 상품
  const lines = section.split(/\n|\r/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // 헤더 줄 스킵
    if (/^(구매|상품|쿠팡가|수량|구매금액|배송정보|판매자|결제)/.test(line)) continue;
    // "... 7,200원 1 7,200원 ..." 가격-수량-가격 패턴
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
    // 폴백: "상품명 ... N개" + 다음 줄에 가격
    const qm = line.match(/^(.{3,}?)[,\s]+(\d+)\s*개\s*$/);
    if (qm) {
      products.push({
        product_name: qm[1].trim(),
        quantity: parseInt(qm[2], 10),
      });
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

  // 주문일자: 메일 헤더(Date)에서 온 dateHint 우선, 없으면 본문 검색
  let orderDate = dateHint || "";
  if (!orderDate) {
    const dm = text.match(/(\d{4})\.?\s*(\d{1,2})\.?\s*(\d{1,2})/);
    if (dm) orderDate = `${dm[1]}.${dm[2].padStart(2, "0")}.${dm[3].padStart(2, "0")}`;
  }

  if (products.length === 0) return null;
  return {
    order_date: orderDate,
    products,
    total_amount: totalAmount,
    order_id: orderId,
  };
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
          } else {
            failCount++;
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
