# 쿠팡 파트너스 연동 가이드

## 개요
Invendory 앱의 쿠팡 파트너스 연동은 **자판기 재고 부족 제품을 쿠팡에서 구매할 때 파트너스 수수료를 받는 구조**입니다.

사용자가 재고 부족 제품의 "쿠팡" 버튼을 누르면, 파트너스 추적이 포함된 링크로 쿠팡 검색 페이지가 열립니다.

---

## 아키텍처

```
사용자 버튼 클릭
  ↓
js/coupang.js → getCoupangAffiliateUrl(keyword)
  ↓
Cloud Function (coupangAffiliateLink)
  ↓ HMAC-SHA256 서명
Coupang Partners Deeplink API
  ↓
link.coupang.com/a/XXXXX (추적 단축 링크) 반환
  ↓
새 탭에서 열기 → 사용자 구매 → 파트너스 수수료 발생
```

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `js/coupang.js` | 클라이언트: 링크 생성 요청 + 캐시 |
| `functions/index.js` (coupangAffiliateLink) | 서버: HMAC 서명 + API 호출 |
| `js/inventory.js` | UI: 재고 부족 제품에서 쿠팡 버튼 표시 |
| `js/stock-in.js` | 쿠팡 구매 데이터 입고 처리 |
| `coupang_crawler.py` | 주문내역 자동 크롤링 (GitHub Actions) |
| `.github/workflows/coupang-crawl.yml` | 크롤링 스케줄 (매일 21시 KST) |

---

## 1. 파트너스 링크 생성 (클라이언트)

### js/coupang.js

```javascript
// 추적 ID (서버 실패 시 폴백용)
var COUPANG_SUB_ID = 'AF1423505';

// 키워드 → 단축 링크 (캐시 사용)
function getCoupangAffiliateUrl(keyword) {
  // 1. 캐시 확인
  // 2. Cloud Function 호출 → 단축 링크 반환
  // 3. 실패 시 폴백: coupang.com/np/search?q=keyword&lptag=AF1423505
}

// 새 탭으로 열기 (팝업 차단 회피)
function _openCoupangByKeyword(keyword) {
  var w = window.open('about:blank', '_blank'); // 먼저 빈 창 열기
  getCoupangAffiliateUrl(keyword).then(function(url) {
    w.location.href = url; // URL 채워넣기
  });
}
```

**핵심 포인트:**
- `window.open`을 먼저 호출하여 팝업 차단 회피
- 같은 키워드 재요청 방지를 위한 `_coupangLinkCache` 캐시
- Cloud Function 실패 시 폴백 URL 사용 (추적 정확도 낮음)

---

## 2. 파트너스 API 호출 (서버)

### functions/index.js — coupangAffiliateLink

```javascript
exports.coupangAffiliateLink = onCall({
  region: "asia-northeast3",
  secrets: [COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY],
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (req) => {
  // 1. 인증 확인
  // 2. Firebase Secret Manager에서 키 읽기
  // 3. HMAC-SHA256 서명 생성
  // 4. Coupang Partners Deeplink API 호출
  // 5. 단축 링크(shortenUrl) 반환
});
```

### HMAC-SHA256 서명 로직

```javascript
function _coupangSign(method, path, accessKey, secretKey) {
  // datetime: yyMMdd'T'HHmmss'Z' (UTC)
  const datetime = "260512T141058Z"; // 예시
  const message = datetime + method + urlPath + query;
  const signature = crypto.createHmac("sha256", secretKey)
    .update(message).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}
```

### API 엔드포인트
- **URL**: `https://api-gateway.coupang.com/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink`
- **Method**: POST
- **Body**: `{ coupangUrls: ["https://www.coupang.com/np/search?q=키워드"], subId: "AF1423505" }`
- **Response**: `{ data: [{ shortenUrl: "https://link.coupang.com/a/XXXXX", landingUrl: "..." }] }`

---

## 3. 설정 방법

### 3-1. 쿠팡 파트너스 가입
1. https://partners.coupang.com 접속
2. 회원가입 및 승인
3. **API 키 발급**: 마이페이지 → API 키 관리

### 3-2. Firebase Secret 등록
```bash
firebase functions:secrets:set COUPANG_ACCESS_KEY
# → 쿠팡 API Access Key 입력

firebase functions:secrets:set COUPANG_SECRET_KEY
# → 쿠팡 API Secret Key 입력
```

### 3-3. 추적 ID 확인
- `js/coupang.js`의 `COUPANG_SUB_ID` 값이 파트너스센터의 추적 ID와 일치하는지 확인
- `functions/index.js`의 `subId` 값도 동일하게 설정
- 현재 값: `AF1423505`

### 3-4. Cloud Functions 배포
```bash
firebase deploy --only functions --project vending-manager-2d64e
```
또는 `functions/` 변경 후 main에 push → 자동 배포

---

## 4. 쿠팡 주문 크롤링

### 자동 크롤링 (GitHub Actions)
- **스케줄**: 매일 21:00 KST
- **스크립트**: `coupang_crawler.py`
- **기술**: nodriver (Chrome DevTools Protocol)
- **저장 경로**: `users/{uid}/coupangOrders/{date}/`

### 수동 크롤링 (Cloud Function)
```
앱 재고 탭 → "쿠팡 데이터 불러오기" 클릭
→ Cloud Function(crawlCoupangOrders) 호출
→ 쿠팡 로그인 → 주문내역 스크래핑
→ Firebase에 저장
```

### Gmail 연동 (대안)
```
앱 재고 탭 → "Gmail에서 직접 가져오기" 클릭
→ Google OAuth (gmail.readonly 스코프)
→ Cloud Function(syncCoupangFromGmail) 호출
→ 쿠팡 주문확인 이메일 파싱
→ purchases 목록에 추가
```

---

## 5. 쿠팡 입고 처리

### 데이터 구조

**purchases (구매 내역)**
```json
{
  "id": "pid_0_abc123",
  "coupangProductName": "칸쵸 32개들이",
  "quantity": 2,
  "totalPrice": 10000,
  "unitPrice": 5000,
  "purchaseDate": "2026-05-12",
  "status": "pending",
  "matchedProductId": null,
  "locationId": null,
  "machineId": null
}
```

**productMapping (상품 매핑)**
```json
{
  "id": "map_abc",
  "coupangProductName": "칸쵸 32개들이",
  "productId": "prod_xyz",
  "unitsPerBox": 32,
  "locId": "loc_001",
  "machineId": "mach_001"
}
```

### 입고 처리 흐름

```
쿠팡 데이터 로드 (loadCoupangPending)
  ↓
각 구매 건별 매핑 확인 (findMappedProduct)
  ↓
├── 매칭됨 (초록): "입고 처리" 버튼 표시
│   → stockInFromPurchaseById()
│   → 수량 × 박스당 개수 = 총 입고량
│   → FIFO 배치 생성 (addStockIn)
│   → purchase.status = 'stocked'
│
├── 미매칭 (빨강): "제품 매칭" 버튼 표시
│   → openMatchingModal()
│   → 앱 제품 선택 + 박스당 개수 입력
│   → saveProductMapping()
│
└── 일괄 입고 (상단 버튼)
    → batchStockInAll()
    → 매칭된 모든 건 한번에 입고
    → 미매칭 건은 자동 제외
```

### 주요 함수

| 함수 | 파일 | 역할 |
|------|------|------|
| `loadCoupangPending()` | stock-in.js:884 | 미입고 구매 목록 로드 + 렌더링 |
| `findMappedProduct(name)` | stock-in.js:262 | 쿠팡 상품명 → 앱 제품 매핑 조회 |
| `stockInFromPurchaseById(id)` | stock-in.js:1322 | 개별 입고 처리 |
| `batchStockInAll()` | stock-in.js:1287 | 매칭된 건 일괄 입고 |
| `addStockIn(...)` | stock-in.js:79 | FIFO 배치 생성 |
| `openMatchingModal(name)` | stock-in.js | 제품 매칭 모달 |
| `saveProductMapping(...)` | stock-in.js:1365 | 매핑 정보 저장 |
| `skipPurchaseById(id)` | stock-in.js:940 | 구매 건 건너뛰기 |

---

## 6. FIFO 재고 관리

입고된 제품은 **FIFO(선입선출) 배치** 방식으로 관리됩니다.

```
입고 배치 1: 100개 (개당 500원) ← remainingQty: 75
입고 배치 2:  50개 (개당 600원) ← remainingQty: 50
                                   ↑
                          판매 시 오래된 것부터 차감
```

### 배치 데이터 구조
```json
{
  "id": "1715500000abc",
  "productId": "prod_xyz",
  "quantity": 100,
  "remainingQty": 75,
  "unitCost": 500,
  "totalCost": 50000,
  "date": "2026-05-12",
  "source": "coupang",
  "memo": "쿠팡 구매 (칸쵸 32개들이)"
}
```

---

## 7. 트러블슈팅

### 파트너스 링크가 안 열려요
1. Firebase Console → Functions 로그 확인
2. `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY`가 설정되어 있는지 확인
3. 쿠팡 파트너스 계정이 활성 상태인지 확인

### 수수료가 안 잡혀요
1. `subId`가 `AF1423505`로 설정되어 있는지 확인 (`functions/index.js` + `js/coupang.js`)
2. `link.coupang.com/a/...` 형식으로 열리는지 확인 (폴백 URL이면 추적 안 됨)
3. 쿠팡 파트너센터에서 API 사용량 확인

### 쿠팡 데이터가 안 불러와져요
1. 설정 탭 → 쿠팡 계정 정보 확인
2. GitHub Actions → "쿠팡 주문 크롤링" 워크플로우 로그 확인
3. 2FA가 활성화되어 있으면 크롤링 실패할 수 있음

### 입고 처리가 안 돼요
1. 제품 매칭이 되어 있는지 확인 (초록 ✅ 표시)
2. "박스당 개수"가 올바르게 설정되어 있는지 확인
3. 현재 선택된 자판기가 매칭된 자판기와 일치하는지 확인

---

## 8. 관련 GitHub Secrets

| 시크릿 | 용도 | 위치 |
|--------|------|------|
| `COUPANG_ACCESS_KEY` | Partners API 인증 | Firebase Secret Manager |
| `COUPANG_SECRET_KEY` | Partners API 서명 | Firebase Secret Manager |
| `FIREBASE_KEY` | Firebase Admin SDK | GitHub Actions |

---

## 9. API 참고

### Coupang Partners Deeplink API
- **문서**: https://partners.coupang.com/api-docs
- **엔드포인트**: `/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink`
- **인증**: CEA HMAC-SHA256
- **Rate Limit**: 초당 10회
- **응답 형식**:
```json
{
  "rCode": 0,
  "rMessage": "",
  "data": [{
    "originalUrl": "https://www.coupang.com/np/search?q=칸쵸",
    "shortenUrl": "https://link.coupang.com/a/dHcAJsftRY",
    "landingUrl": "https://www.coupang.com/np/search?q=칸쵸&lptag=..."
  }]
}
```
