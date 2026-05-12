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
