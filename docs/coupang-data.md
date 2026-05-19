# 쿠팡 구매 데이터 시스템

## 개요

쿠팡 주문 데이터를 3가지 경로로 수집하여 자판기 재고 입고까지 연결하는 시스템입니다.

---

## 데이터 수집 경로 (3가지)

### 1. Gmail API 동기화

| 항목 | 내용 |
|------|------|
| **트리거** | 앱에서 "Gmail로 쿠팡 주문 가져오기" 버튼 |
| **Cloud Function** | `syncCoupangFromGmail` (asia-northeast3) |
| **메모리/타임아웃** | 512MB / 300초 |
| **인증** | Google OAuth 2.0 (`gmail.readonly` 스코프) |

**동작 흐름:**
1. 사용자가 Google 계정 권한 허용
2. Gmail API로 쿠팡 주문 메일 검색 (최근 90일)
3. 각 메일 본문 파싱 → 주문일/상품명/수량/가격 추출
4. `message_id` 기준 중복 제거 후 기존 데이터와 병합
5. Firebase에 저장

**Gmail 검색 쿼리:**
```
from:(@coupang.com) (구매하신 OR 주문 OR 결제 OR 구매내역) newer_than:90d
```

**자동 건너뛰기:** 멤버십/이벤트/광고/혜택안내/포인트 메일

---

### 2. 이메일 전달 (Cloudflare)

| 항목 | 내용 |
|------|------|
| **트리거** | 사용자 메일에서 자동 전달 규칙 |
| **Cloud Function** | `receiveForwardedEmail` (HTTP endpoint) |
| **전달 주소** | `u-{12자리해시}@invendory.kr` |

**동작 흐름:**
1. 사용자가 메일 전달 규칙 설정 (Gmail/네이버/다음 등)
2. 쿠팡 주문 메일 수신 → 자동 전달
3. Cloudflare Email Routing → Worker → Cloud Function
4. MIME 파싱 → 주문 데이터 추출
5. `order_id` 또는 상품 시그니처 기준 중복 제거

**특수 처리:**
- Gmail 전달 확인 메일: 인증 코드(9자리) + 승인 URL 자동 캡처
- 결제/배송 알림 메일: 자동 건너뛰기 (상품 정보 없음)

---

### 3. Python 크롤러 (GitHub Actions)

| 항목 | 내용 |
|------|------|
| **트리거** | GitHub Actions 스케줄 (매일 06:00 KST) + 수동 |
| **파일** | `coupang_crawler.py` |
| **워크플로우** | `.github/workflows/coupang-crawl.yml` |

**동작 흐름:**
1. Firebase에서 쿠팡 계정 정보 읽기 (base64 인코딩)
2. nodriver(무감지 Chromium)로 쿠팡 로그인
3. 마이쿠팡 → 주문목록 페이지 스크래핑
4. 날짜별 주문 블록 파싱
5. Firebase에 저장

**안티탐지:**
- 실제 User-Agent, Akamai WAF 호환
- 자연스러운 스크롤/클릭 시뮬레이션
- 랜덤 딜레이

---

## 이메일 파싱 알고리즘

**함수:** `parseCoupangEmail(text, dateHint)`

### 섹션 추출
- **시작 마커:** `구매 상세내역` / `주문하신 내역` / `주문 상품` / `로켓배송 상품`
- **종료 마커:** `결제 정보` / `결제 금액` / `총 결제 금액`

### 인식 패턴 (3가지)

**패턴 A - 한 줄 (네이버 전달):**
```
상품명 19,900원 1 19,900원
```

**패턴 B - HTML 테이블 변환 (다중 줄):**
```
히트그램 독일군 뮬슬리퍼 스니커즈 3CM    ← 상품명
19,900원                                  ← 쿠팡가
1                                         ← 수량
19,900원                                  ← 구매금액
에스비아이엔티 주식회사                    ← 판매자 (건너뜀)
```

**패턴 C - Gmail 전달:**
```
상품명, 20개
13,900원
20
278,000원
```

### 필터링
- **판매자명:** `주식회사`, `(주)`, `유한회사`, `합자회사` → 상품명에서 제외
- **비상품 줄:** `쿠팡`, `배송`, `받으시는`, `연락처`, `주소` → 건너뜀
- **헤더 줄:** `구매`, `상품`, `쿠팡가`, `수량`, `구매금액`, `판매자` → 건너뜀

### 중복 제거
- 가격 있는 항목이 우선 (같은 상품명 부분 일치 기준)
- 가격 없는 항목: 가격 있는 동일 상품 존재하면 제거

### 메타데이터 추출
- **주문일:** `주문일시:` 레이블 → 본문 날짜 패턴 → 메일 헤더 (순서대로 폴백)
- **주문번호:** `주문 번호: ABC123-XYZ` 패턴
- **결제금액:** `결제 금액: 30,600원` 패턴

---

## Firebase 데이터 구조

### coupangOrders (주문 데이터)

```
users/{uid}/coupangOrders/{YYYY-MM-DD}/
├── date: "2026-05-18"
├── updated_at: "2026-05-18 14:30:45"
├── source: "gmail" | "email" | "crawler"
├── total_orders: 3
├── total_products: 8
└── orders: [
      {
        order_date: "2026.05.18",
        order_id: "ABC-123-XYZ",
        total_amount: 30600,
        message_id: "msg_abc123",        // Gmail 전용
        products: [
          {
            product_name: "히트그램 독일군 뮬슬리퍼...",
            quantity: 1,
            unit_price: 19900,
            price: 19900
          }
        ]
      }
    ]
```

### purchases (구매 내역 / 입고 대기)

```
users/{uid}/purchases/
[
  {
    id: "pid_0_abc123",
    coupangProductName: "조지아 오리지널 185ml",
    quantity: 2,
    totalPrice: 14400,
    unitPrice: 7200,
    purchaseDate: "2026-05-15",
    status: "pending" | "stocked" | "skipped",
    matchedProductId: "prod_001",        // 입고 후
    locationId: "loc_123",               // 입고 후
    machineId: "m_456"                   // 입고 후
  }
]
```

### productMapping (쿠팡 상품 ↔ 앱 제품 매핑)

```
users/{uid}/productMapping/
[
  {
    id: "1234567890",
    coupangProductName: "조지아 오리지널 185ml, 30개",
    productId: "prod_001",               // 앱 제품 ID
    unitsPerBox: 30,                     // 박스당 낱개 수
    locId: "loc_123",                    // 연결된 위치
    machineId: "m_456"                   // 연결된 자판기
  }
]
```

### mailForward (이메일 전달 설정)

```
users/{uid}/mailForward/
├── hash: "abc123def456"
├── address: "u-abc123def456@invendory.kr"
├── created_at: "2026-05-01 10:00:00"
├── last_received_at: "2026-05-18 14:30:00"
├── last_sender: "coupang@coupang.com"
├── pending_verification: {              // Gmail 전달 확인
│     type: "gmail",
│     code: "123456789",
│     url: "https://mail.google.com/...",
│     received_at: "...",
│     expires_at: "..."
│   }
├── recent_mails: [                      // 최근 10건 진단
│     { at, subject, from, outcome, products }
│   ]
└── last_parse_debug: { ... }
```

---

## 제품 매칭 → 입고 흐름

```
1. 쿠팡 주문 데이터 로드
   └→ coupangOrders/{date} → purchases[] (status: "pending")

2. 제품 매칭
   ├→ 자동매칭: productMapping에 저장된 매핑 확인
   └→ 수동매칭: "제품 매칭" 버튼 → 자판기/제품 선택 모달

3. 입고 처리
   ├→ 개별: "입고 처리" 버튼
   └→ 일괄: "일괄 입고처리" 버튼
   
4. FIFO 배치 생성
   {
     productId, 
     quantity: 쿠팡수량 × 박스당낱개수,
     unitCost: 총가격 / 총수량,
     source: "coupang",
     memo: "쿠팡 구매 (상품명)"
   }

5. 재고 반영
   └→ appData/inventory 수량 증가
   └→ purchase.status → "stocked"
```

---

## 중복 제거 전략

| 채널 | 기준 | 방식 |
|------|------|------|
| Gmail API | `message_id` | 기존 메시지 ID 있으면 건너뜀 |
| 이메일 전달 | `order_id` 또는 상품 시그니처 | `${이름}x${수량}\|...` 해시 비교 |
| Python 크롤러 | 날짜 + 상품 조합 | 전체 덮어쓰기 (일별) |
| 앱 UI | `${상품명}_${구매일}` | purchases 로드 시 중복 방지 |

---

## 쿠팡 파트너스 (어필리에이트 링크)

| 항목 | 내용 |
|------|------|
| **Cloud Function** | `coupangAffiliateLink` |
| **API** | Coupang Partners Open API (HMAC-SHA256 서명) |
| **시크릿** | `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY` (Secret Manager) |

**흐름:** 키워드 → 딥링크 API → 단축 URL(`link.coupang.com/a/XXXXX`) → 새 탭 열기

---

## 디버깅 가이드

### Gmail 동기화 실패 시
1. 앱에서 Gmail 가져오기 실행
2. **F12 > Console**에서 `[Gmail 쿠팡] 디버그:` 확인
3. ✅/❌ 각 이메일별 파싱 결과 + 상품명 확인
4. 실패 원인: 본문 길이, 제목, 주문일 확인

### 이메일 전달 실패 시
1. Firebase Console > `users/{uid}/mailForward` 확인
2. `recent_mails`: 최근 수신 이력 (최대 10건)
3. `last_parse_debug`: 마지막 파싱 시도 결과
4. `last_parse_failed`: 실패 원인 (제목 + 본문 샘플)

### Python 크롤러 실패 시
1. GitHub Actions > coupang-crawl 워크플로우 로그
2. Firebase > `coupangOrders/{date}/_debug` 확인
3. `status`: `waf_blocked`, `login_failed`, `sms_required` 등
4. 스크린샷 아티팩트 다운로드 (3일 보관)

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `js/stock-in.js` | 입고 UI, 제품 매칭, Gmail 동기화 트리거 |
| `js/coupang.js` | 쿠팡 파트너스 어필리에이트 링크 |
| `functions/index.js` | Cloud Functions (Gmail 동기화, 이메일 전달, 크롤링 등) |
| `coupang_crawler.py` | Python 주문 크롤러 |
| `.github/workflows/coupang-crawl.yml` | 크롤러 스케줄 (매일 06:00 KST) |
