# Invendory - 자판기 관리 시스템

## 프로젝트 개요
**Invendory**는 자판기 운영을 위한 올인원 PWA(Progressive Web App)입니다.
매출 분석, 재고 관리, 자판기 관리, VMMS 연동, 쿠팡 파트너스 연동을 하나의 앱에서 제공합니다.

- **URL**: https://invendory.kr
- **호스팅**: Firebase Hosting + GitHub Pages
- **DB**: Firebase Realtime Database (asia-southeast1)
- **Cloud Functions**: asia-northeast3 (서울)
- **프로젝트 ID**: vending-manager-2d64e

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프론트엔드 | Vanilla JS + HTML5 (PWA) |
| 데이터베이스 | Firebase Realtime Database |
| 인증 | Firebase Auth (Google 로그인) |
| 서버리스 | Firebase Cloud Functions (Node.js 20) |
| 크롤링 (서버) | Puppeteer-Core + @sparticuz/chromium |
| 크롤링 (스케줄) | Playwright (Python, GitHub Actions) |
| 호스팅 | Firebase Hosting |
| CI/CD | GitHub Actions |

---

## 디렉토리 구조

```
vending-manager/
├── index.html              # 메인 PWA 앱 (싱글 페이지)
├── manifest.json           # PWA 설정
├── sw.js                   # 서비스 워커 (캐시 v77)
├── firebase.json           # Firebase 호스팅/함수 설정
├── css/
│   └── style.css           # 전체 스타일 (다크모드 지원)
├── img/                    # 아이콘, 로고
├── js/
│   ├── firebase-config.js  # Firebase 초기화, 전역 상태(D, REF)
│   ├── auth.js             # 인증, 사용자 동기화
│   ├── data.js             # 앱 초기화, 공지사항
│   ├── ui.js               # 탭 전환, 모달, 토스트
│   ├── security.js         # AES-256-GCM 암호화, SHA-256
│   ├── lock.js             # 화면 잠금 (PIN)
│   ├── home.js             # 홈 대시보드
│   ├── machines.js         # 위치/자판기 CRUD
│   ├── products.js         # 제품 관리, 신규 상품 감지
│   ├── inventory.js        # 재고 관리, 구매 추천
│   ├── sales.js            # 판매 통계, 기간별 분석
│   ├── crawl.js            # 실시간 판매 데이터 수집
│   ├── vmms-products.js    # VMMS 제품/컬럼 데이터 표시
│   ├── coupang.js          # 쿠팡 파트너스 연동
│   ├── stock-in.js         # FIFO 입고 관리, 쿠팡 입고
│   ├── csv.js              # XLSX/CSV 파일 가져오기
│   ├── bulk.js             # 제품 일괄 등록
│   ├── machine-view.js     # 자판기 상세 뷰
│   └── double-column.js    # 2칸 제품 설정
├── functions/
│   ├── index.js            # Cloud Functions (7개 함수)
│   └── package.json        # Node.js 의존성
├── .github/workflows/
│   ├── crawl.yml           # VMMS 판매 크롤링 (12시/19시)
│   ├── vmms-product-crawl.yml  # VMMS 제품 크롤링 (8시/20시)
│   ├── coupang-crawl.yml   # 쿠팡 주문 크롤링 (21시)
│   ├── backup.yml          # Firebase 백업 (3시)
│   └── deploy-functions.yml # Cloud Functions 자동 배포
├── vmms_crawler.py         # VMMS 거래내역 크롤러
├── vmms_product_crawler.py # VMMS 제품/컬럼 크롤러
├── coupang_crawler.py      # 쿠팡 주문 크롤러
└── backups/                # 일별 Firebase 백업 JSON
```

---

## Cloud Functions

| 함수명 | 트리거 | 메모리 | 타임아웃 | 용도 |
|--------|--------|--------|----------|------|
| `crawlVmmsSales` | onCall | 2GB | 5분 | VMMS 판매 실시간 크롤링 |
| `crawlVmmsProducts` | onCall | 2GB | 5분 | VMMS 제품/자판기/컬럼 크롤링 |
| `coupangAffiliateLink` | onCall | 256MB | 30초 | 쿠팡 파트너스 딥링크 생성 |
| `crawlCoupangOrders` | onCall | - | 10분 | 쿠팡 주문내역 크롤링 |
| `syncCoupangFromGmail` | onCall | - | 5분 | Gmail에서 쿠팡 주문 파싱 |
| `getMailForwardAddress` | onCall | - | - | 메일 포워딩 주소 반환 |
| `receiveForwardedEmail` | onRequest | - | - | 포워딩 이메일 수신 웹훅 |

### 시크릿 (Firebase Secret Manager)
- `COUPANG_ACCESS_KEY` - 쿠팡 파트너스 API 키
- `COUPANG_SECRET_KEY` - 쿠팡 파트너스 시크릿 키

---

## GitHub Actions 스케줄

| 워크플로우 | 시간 (KST) | 용도 |
|-----------|------------|------|
| VMMS 판매 크롤링 | 12:00, 19:00 | 거래내역 수집 → crawledSales |
| VMMS 제품 크롤링 | 08:00, 20:00 | 제품마스터/컬럼매칭 수집 |
| 쿠팡 주문 크롤링 | 21:00 | 주문내역 수집 → coupangOrders |
| Firebase 백업 | 03:00 | 전체 DB 백업 (30일 보관) |
| Functions 배포 | push 시 | functions/ 변경 시 자동 배포 |

---

## Firebase DB 구조

```
users/{uid}/
  ├── profile/           {name, email, phone, username, createdAt}
  ├── settings/          {securityPin, lowStockThreshold, ...}
  ├── vmms/              {id(암호화), pw(암호화)}
  ├── coupangAccount/    {email(암호화), pw(암호화)}
  ├── locations/{locId}/
  │   ├── name, mainMachineId
  │   └── machines/{machineId}/
  │       ├── name, model, deviceNos[], order
  │       └── appData/
  │           ├── products[]      # 제품 목록
  │           ├── inventory[]     # 재고 수량
  │           ├── salesData[]     # 판매 데이터
  │           ├── inventoryLogs[] # 재고 로그
  │           ├── stockIn[]       # FIFO 입고 배치
  │           └── stockDeductions[] # 차감 내역
  ├── vmmsProducts/      {items[], updated_at}
  ├── vmmsMachines/      {items[], updated_at}
  ├── vmmsColumns/       {machines: {deviceNo: {columns[]}}}
  ├── crawledSales/{date}/  {headers[], rows[], total_count}
  ├── coupangOrders/{date}/ {items[]}
  ├── purchases[]        # 쿠팡 구매 내역 (pending/stocked)
  └── productMapping[]   # 쿠팡 상품명 ↔ 앱 제품 매핑

adminUsers/{uid}/        # 관리자 대시보드용 요약
deviceNumbers/{code}/    # 단말기번호 → uid 역인덱스
usernames/{name}/        # username → uid 역인덱스
notices/                 # 앱 공지사항
```

---

## 주요 데이터 흐름

### 판매 데이터 수집
```
버튼 클릭 → Cloud Function(crawlVmmsSales)
         → VMMS 로그인 → 거래내역 스크래핑
         → Firebase crawledSales 저장
         → 클라이언트에서 읽어서 salesData 반영
         → VMMS 제품명 자동 매칭 + 제품 자동 등록
```

### 제품 불러오기
```
버튼 클릭 → Cloud Function(crawlVmmsProducts)
         → VMMS 로그인 → 상품마스터/자판기/컬럼 스크래핑
         → Firebase vmmsProducts/vmmsMachines/vmmsColumns 저장
         → 클라이언트에서 표시
```

### 쿠팡 파트너스 링크
```
제품 클릭 → Cloud Function(coupangAffiliateLink)
         → HMAC-SHA256 서명 → Coupang Partners API
         → link.coupang.com/a/XXXXX 단축 링크 반환
         → 새 탭에서 열기
```

### 쿠팡 입고
```
쿠팡 데이터 로드 → 구매 내역 표시
→ 매칭된 건: 초록 "입고 처리" / "일괄 입고처리"
→ 미매칭 건: "제품 매칭" 필요
→ 입고 처리 → FIFO 배치 생성 → 재고 반영
```

---

## 보안

- **인증**: Firebase Auth (Google OAuth2)
- **암호화**: AES-256-GCM (VMMS/쿠팡 계정 정보)
- **해싱**: SHA-256 (PIN)
- **XSS 방지**: HTML 이스케이프 (sanitize 함수)
- **API 보안**: HMAC-SHA256 (쿠팡 Partners API)
- **화면 잠금**: PIN 기반, 5회 실패 시 자동 로그아웃
- **시크릿 관리**: GitHub Secrets + Firebase Secret Manager

---

## 서비스 워커 캐시 전략

| 대상 | 전략 | 이유 |
|------|------|------|
| HTML/JS | Network-First | 코드 업데이트 즉시 반영 |
| CSS/이미지 | Stale-While-Revalidate | 빠른 로딩 + 오프라인 |
| Firebase API | 캐시 안 함 | 실시간 데이터 |
| Cloud Functions | 캐시 안 함 | 실시간 응답 |

---

## 개발 가이드

### Cloud Functions 배포
```bash
cd functions && npm install && cd ..
firebase deploy --only functions --project vending-manager-2d64e
```
또는 `functions/` 파일 변경 후 main에 push하면 자동 배포.

### GitHub Secrets 필요
- `FIREBASE_KEY` - Firebase Admin SDK 서비스 계정 JSON
- `VMMS_ID` / `VMMS_PW` - VMMS 기본 계정 (base64)
- `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY` - 쿠팡 Partners API 키

### 로컬 테스트
정적 사이트이므로 로컬 HTTP 서버로 바로 실행 가능:
```bash
npx serve .
```
Firebase 연동은 실제 Firebase 프로젝트에 연결되어 있어 그대로 동작합니다.
