// ─── Stock-In (Batch 기반 재고 관리) ──────────────────────────────────────────
// stock_in: 입고 batch 관리 (FIFO)
// purchases: 쿠팡 구매 내역 (미입고 → 입고완료)
// product_mapping: 쿠팡 상품명 ↔ 앱 제품명 매핑
// stock_deductions: 차감 내역 (판매/수기)

/*
Firebase 데이터 구조:
appData/
  stockIn: [
    { id, productId, quantity, remainingQty, unitCost, totalCost, date, source:'coupang'|'manual', memo }
  ]
  stockDeductions: [
    { id, productId, quantity, reason:'sale'|'manual', memo, date, saleTxId?, stockInId?, unitCost? }
  ]
  salesCost: [
    { saleId, stockInId, quantity, unitCost }
  ]

users/{uid}/
  purchases: [
    { id, coupangProductName, quantity, totalPrice, unitPrice, purchaseDate, status:'pending'|'stocked', matchedProductId?, locationId?, machineId? }
  ]
  productMapping: [
    { id, coupangProductName, productId, unitsPerBox }
  ]
*/

// ─── 현재 재고 조회 (batch remaining 합산) ───────────────────────────────────
function getStockQty(productId){
  var stockIn = D.stockIn || [];
  var total = 0;
  stockIn.forEach(function(b){
    if(b.productId === productId) total += (b.remainingQty || 0);
  });
  return total;
}

// ─── FIFO 차감 ───────────────────────────────────────────────────────────────
// 오래된 batch부터 차감, 사용한 batch별 원가 배열 반환
function fifoDeduct(productId, qty){
  var stockIn = D.stockIn || [];
  var batches = stockIn
    .filter(function(b){ return b.productId === productId && b.remainingQty > 0; })
    .sort(function(a,b){ return (a.date||'').localeCompare(b.date||'') || (a.id||'').localeCompare(b.id||''); });

  var remaining = qty;
  var costs = []; // [{stockInId, quantity, unitCost}]

  for(var i=0; i<batches.length && remaining>0; i++){
    var batch = batches[i];
    var use = Math.min(remaining, batch.remainingQty);
    batch.remainingQty -= use;
    remaining -= use;
    costs.push({
      stockInId: batch.id,
      quantity: use,
      unitCost: batch.unitCost || 0
    });
  }

  return { costs: costs, unfulfilledQty: remaining };
}

// ─── 입고 처리 (batch 생성) ──────────────────────────────────────────────────
function addStockIn(productId, quantity, unitCost, source, memo, date){
  if(!D.stockIn) D.stockIn = [];
  var batch = {
    id: Date.now().toString() + Math.random().toString(36).substr(2,4),
    productId: productId,
    quantity: quantity,
    remainingQty: quantity,
    unitCost: unitCost,
    totalCost: Math.round(unitCost * quantity),
    date: date || td(),
    source: source || 'manual', // 'coupang' | 'manual'
    memo: memo || ''
  };
  D.stockIn.push(batch);
  return batch;
}

// ─── 수기 차감 (분실/파손 등) ────────────────────────────────────────────────
function addManualDeduction(productId, qty, reason, memo, date){
  if(!D.stockDeductions) D.stockDeductions = [];
  var result = fifoDeduct(productId, qty);
  var deduction = {
    id: Date.now().toString() + Math.random().toString(36).substr(2,4),
    productId: productId,
    quantity: qty,
    reason: reason || 'manual',
    memo: memo || '',
    date: date || td(),
    costs: result.costs
  };
  D.stockDeductions.push(deduction);
  return deduction;
}

// ─── 판매 FIFO 차감 + 원가 기록 ─────────────────────────────────────────────
function deductSale(productId, qty, saleTxId){
  if(!D.salesCost) D.salesCost = [];
  var result = fifoDeduct(productId, qty);
  result.costs.forEach(function(c){
    D.salesCost.push({
      saleId: saleTxId || '',
      stockInId: c.stockInId,
      quantity: c.quantity,
      unitCost: c.unitCost
    });
  });
  return result;
}

// ─── 제품별 입고 내역 조회 ───────────────────────────────────────────────────
function getStockInHistory(productId){
  var stockIn = D.stockIn || [];
  return stockIn
    .filter(function(b){ return b.productId === productId; })
    .sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); }); // 최신순
}

// ─── 제품별 차감 내역 조회 ───────────────────────────────────────────────────
function getDeductionHistory(productId){
  var deductions = D.stockDeductions || [];
  // 판매 차감도 salesData에서 가져오기
  var salesDeductions = (D.salesData || [])
    .filter(function(s){ return s.productId === productId && !s.cancelled; })
    .map(function(s){
      return { date: s.date, quantity: s.qty || 1, reason: 'sale', memo: '판매 (자동)', txId: s.txId };
    });
  var manualDeductions = deductions
    .filter(function(d){ return d.productId === productId; })
    .map(function(d){
      return { date: d.date, quantity: d.quantity, reason: d.reason, memo: d.memo };
    });
  return salesDeductions.concat(manualDeductions)
    .sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
}

// ─── 기간별 이익 계산 ────────────────────────────────────────────────────────
function calculateProfit(fromDate, toDate){
  var salesCost = D.salesCost || [];
  var salesData = D.salesData || [];

  // 기간 내 판매
  var periodSales = salesData.filter(function(s){
    return s.date >= fromDate && s.date <= toDate && !s.cancelled;
  });

  var totalRevenue = 0;
  periodSales.forEach(function(s){
    totalRevenue += (s.amt || s.amount || 0);
  });

  // 기간 내 판매에 대한 원가
  var totalCost = 0;
  var periodTxIds = {};
  periodSales.forEach(function(s){ if(s.txId) periodTxIds[s.txId] = true; });

  salesCost.forEach(function(sc){
    if(periodTxIds[sc.saleId]){
      totalCost += (sc.unitCost || 0) * (sc.quantity || 0);
    }
  });

  return {
    revenue: totalRevenue,
    cost: totalCost,
    profit: totalRevenue - totalCost,
    margin: totalRevenue > 0 ? Math.round((totalRevenue - totalCost) / totalRevenue * 100) : 0
  };
}

// ─── D 객체에 새 필드 초기화 ─────────────────────────────────────────────────
function initStockData(){
  if(!D.stockIn) D.stockIn = [];
  if(!D.stockDeductions) D.stockDeductions = [];
  if(!D.salesCost) D.salesCost = [];
}

// ─── 제품 매핑 (쿠팡 상품명 → 앱 제품ID) ────────────────────────────────────
var _productMappings = []; // users/{uid}/productMapping에서 로드

function loadProductMappings(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/productMapping').once('value').then(function(snap){
    _productMappings = snap.val() || [];
    if(!Array.isArray(_productMappings)) _productMappings = Object.values(_productMappings);
  });
}

function findMappedProduct(coupangName){
  return _productMappings.find(function(m){ return m.coupangProductName === coupangName; });
}

// ─── 쿠팡 메일 전달 연동 (Cloudflare Email Routing) ────────────────────────────
// 사용자 본인 메일(네이버/Gmail/다음)에서 "쿠팡 메일 오면 이 주소로 전달" 규칙
// 1회 설정. 이후 쿠팡 주문 메일이 오면 Cloudflare Email Worker가 받아 파싱 →
// Cloud Function → Firebase 저장. 앱은 📥 버튼으로 반영.

function openMailForwardModal(){
  if(!currentUser){ showToast('❌ 로그인 필요'); return; }
  openModal('mail-forward-modal');

  var body = document.getElementById('mfm-body');
  body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:13px">⏳ 전달 주소 불러오는 중...</div>';

  var fn = firebase.app().functions('asia-northeast3').httpsCallable('getMailForwardAddress', { timeout: 30000 });
  fn({}).then(function(result){
    var d = (result && result.data) || {};
    var addr = d.address || '';
    var lastReceived = d.last_received_at || '';
    _renderMailForwardBody(addr, lastReceived);
  }).catch(function(e){
    var msg = (e && e.message) || String(e);
    body.innerHTML = '<div style="padding:20px;color:var(--red);font-size:13px">❌ 전달 주소 발급 실패: '+msg.slice(0,120)+'</div>';
  });
}

function _renderMailForwardBody(address, lastReceived){
  var body = document.getElementById('mfm-body');
  var addrSafe = (address || '').replace(/"/g, '&quot;');
  var statusLine = lastReceived
    ? '<div style="font-size:12px;color:var(--green);margin-top:6px">✅ 마지막 메일 수신: '+lastReceived+'</div>'
    : '<div style="font-size:12px;color:var(--text3);margin-top:6px">아직 수신된 메일 없음</div>';

  var html = '' +
    '<div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:14px">' +
    '쿠팡 주문 메일을 아래 주소로 <b>자동 전달</b>하도록 본인 메일에서 규칙을 1회만 설정하면 돼요.<br>' +
    '이후 쿠팡 주문이 있을 때마다 자동으로 앱에 반영됩니다.' +
    '</div>' +

    '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:14px">' +
    '<div style="font-size:11px;color:var(--text3);margin-bottom:4px">내 전달 주소</div>' +
    '<div style="display:flex;gap:8px;align-items:center">' +
    '<input type="text" id="mfm-addr" value="'+addrSafe+'" readonly ' +
    'style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:monospace;background:var(--bg3);color:var(--text)"/>' +
    '<button onclick="_copyMailAddress()" ' +
    'style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:10px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">복사</button>' +
    '</div>' +
    statusLine +
    '</div>' +

    '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px">✉️ 메일 서비스별 설정 가이드</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">' +
      _mfmProviderRow('네이버', 'naver') +
      _mfmProviderRow('Gmail', 'gmail') +
      _mfmProviderRow('다음', 'daum') +
      _mfmProviderRow('네이트', 'nate') +
    '</div>' +

    '<div style="background:rgba(0,150,0,.05);border:1px solid rgba(0,150,0,.2);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--text2);line-height:1.6">' +
    '💡 <b>Tip</b>: 설정이 잘 됐는지 확인하려면, 쿠팡 주문 메일 한 개를 수동으로 위 주소에 전달해보세요. 1분 후 앱에서 📥 <b>쿠팡 데이터 가져오기</b>를 누르면 반영돼요.' +
    '</div>';

  body.innerHTML = html;
}

function _mfmProviderRow(label, key){
  return '<button onclick="_mfmShowGuide(\''+key+'\')" ' +
    'style="text-align:left;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit;display:flex;justify-content:space-between;align-items:center">' +
    '<span>📧 '+label+' 설정 방법</span>' +
    '<span style="color:var(--text3);font-size:11px">보기 ▸</span>' +
    '</button>';
}

function _copyMailAddress(){
  var el = document.getElementById('mfm-addr');
  if(!el) return;
  el.select();
  try {
    document.execCommand('copy');
    if(navigator.clipboard){ navigator.clipboard.writeText(el.value); }
    showToast('✅ 주소 복사됨');
  } catch(_){
    showToast('⚠️ 복사 실패, 직접 드래그해서 복사해주세요');
  }
}

var _mfmGuides = {
  naver: [
    '1. PC에서 <b>네이버 메일</b> 로그인',
    '2. 좌측 메뉴 맨 아래 <b>환경설정</b> 클릭',
    '3. <b>메일함 관리 → 자동분류</b> (또는 <b>필터링</b>)',
    '4. <b>추가</b> 버튼 → 조건:<br>&nbsp;&nbsp;&nbsp;&nbsp;• 보낸사람: <code>coupang.com</code> <b>포함</b>',
    '5. 실행작업: <b>다른 메일로 전달</b> 체크 → 위 주소 붙여넣기',
    '6. <b>확인</b> 또는 <b>저장</b>',
    '',
    '⚠️ 네이버는 전달을 원본 그대로 보내기 때문에 우리 서버에서 쿠팡 메일을 인식할 수 있어요.',
  ],
  gmail: [
    '1. PC에서 <b>Gmail</b> 로그인',
    '2. 검색창에 <code>from:(@coupang.com)</code> 입력 → 검색',
    '3. 검색창 우측 <b>필터 만들기</b> (깔때기 모양) 클릭',
    '4. 팝업 하단 <b>검색조건으로 필터 만들기</b> 클릭',
    '5. <b>다음 주소로 전달</b> 체크',
    '6. 드롭다운에서 주소 추가 → 위 전달 주소 입력',
    '7. Gmail이 그 주소에 확인 메일 보냄 → 수신된 메일의 링크 클릭 (본인 메일에서 확인)',
    '',
    '⚠️ Gmail은 처음 전달 주소를 등록할 때 확인 절차가 있어요. 링크 클릭 후 규칙이 활성화돼요.',
  ],
  daum: [
    '1. PC에서 <b>다음 메일</b> 로그인',
    '2. 우측 상단 <b>환경설정</b> (톱니바퀴) 클릭',
    '3. <b>메일 필터</b> 탭',
    '4. <b>필터 추가</b> → 조건:<br>&nbsp;&nbsp;&nbsp;&nbsp;• 보낸사람 주소에 <code>coupang.com</code> 포함',
    '5. 실행 작업: <b>지정한 메일주소로 전달</b> → 위 주소 입력',
    '6. 저장',
  ],
  nate: [
    '1. PC에서 <b>네이트 메일</b> 로그인',
    '2. <b>환경설정</b> → <b>자동분류/필터</b>',
    '3. <b>새 규칙 만들기</b> → 보낸사람에 <code>coupang.com</code>',
    '4. 작업에 <b>메일 전달</b> 선택 → 위 주소 입력',
    '5. 저장',
    '',
    '⚠️ 네이트는 전달 기능이 제한적일 수 있어요. 안 되면 수동 전달 필요.',
  ],
};

function _mfmShowGuide(key){
  var guide = _mfmGuides[key];
  if(!guide) return;
  var html = '<div style="font-size:13px;color:var(--text);line-height:1.8">' +
    guide.map(function(line){ return '<div>'+line+'</div>'; }).join('') +
    '</div>' +
    '<button onclick="openMailForwardModal()" ' +
    'style="margin-top:14px;width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:13px;font-weight:600;color:var(--text2);cursor:pointer;font-family:inherit">◂ 돌아가기</button>';
  document.getElementById('mfm-body').innerHTML = html;
}

// ─── Gmail OAuth + 쿠팡 메일 동기화 ───────────────────────────────────────────
// Google Identity Services (GIS) token client 로드 & 토큰 발급 → Cloud Function
// syncCoupangFromGmail 호출. Client ID는 appConfig/googleClientId 에 저장해둠.

var _gmailTokenClient = null;
var _gmailClientIdCached = null;

function _loadGoogleGisScript(){
  return new Promise(function(resolve, reject){
    if(window.google && window.google.accounts && window.google.accounts.oauth2){
      resolve();
      return;
    }
    var existing = document.getElementById('gis-script');
    if(existing){
      existing.addEventListener('load', function(){ resolve(); });
      existing.addEventListener('error', function(){ reject(new Error('GIS 로드 실패')); });
      return;
    }
    var s = document.createElement('script');
    s.id = 'gis-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = function(){ resolve(); };
    s.onerror = function(){ reject(new Error('GIS 로드 실패')); };
    document.head.appendChild(s);
  });
}

function _getGoogleClientId(){
  if(_gmailClientIdCached) return Promise.resolve(_gmailClientIdCached);
  return db.ref('appConfig/googleClientId').once('value').then(function(snap){
    var cid = snap.val();
    if(!cid) throw new Error('Google Client ID가 설정되지 않았습니다');
    _gmailClientIdCached = cid;
    return cid;
  });
}

// 메인: 버튼에서 호출
function syncCoupangFromGmail(){
  if(!currentUser){ showToast('❌ 로그인 필요'); return; }
  var btn = document.getElementById('gmail-sync-btn');
  if(btn){ btn.textContent = '⏳ Gmail 연결 중...'; btn.disabled = true; }

  _loadGoogleGisScript()
    .then(_getGoogleClientId)
    .then(function(clientId){
      return new Promise(function(resolve, reject){
        _gmailTokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          callback: function(tokenResponse){
            if(tokenResponse && tokenResponse.access_token){
              resolve(tokenResponse.access_token);
            } else {
              reject(new Error('토큰 발급 실패'));
            }
          },
          error_callback: function(err){
            reject(new Error((err && err.message) || '사용자가 권한 요청을 취소했습니다'));
          }
        });
        // 권한 요청 팝업 열기
        _gmailTokenClient.requestAccessToken({ prompt: 'consent' });
      });
    })
    .then(function(accessToken){
      if(btn){ btn.textContent = '⏳ 쿠팡 메일 분석 중...'; }
      showToast('⏳ Gmail에서 쿠팡 주문 메일을 분석하고 있어요...');
      var fn = firebase.app().functions('asia-northeast3').httpsCallable('syncCoupangFromGmail', { timeout: 300000 });
      return fn({ accessToken: accessToken, daysBack: 90 });
    })
    .then(function(result){
      if(btn){ btn.textContent = '📧 Gmail로 쿠팡 주문 가져오기'; btn.disabled = false; }
      var d = result.data || {};
      showToast('✅ ' + (d.message || 'Gmail 동기화 완료'));
      // Firebase 데이터 → 앱 미입고 목록에 반영 (기존 loadCoupangOrders 재사용)
      setTimeout(function(){ loadCoupangOrders(); }, 500);
    })
    .catch(function(e){
      if(btn){ btn.textContent = '📧 Gmail로 쿠팡 주문 가져오기'; btn.disabled = false; }
      var msg = (e && e.message) || String(e);
      if(msg.indexOf('Client ID가 설정') >= 0){
        showToast('⚠️ Google Client ID 설정이 필요해요 (appConfig/googleClientId)');
      } else if(msg.indexOf('취소') >= 0){
        showToast('❌ 권한 요청이 취소됐어요');
      } else {
        showToast('❌ Gmail 동기화 실패: ' + msg.slice(0, 100));
      }
      console.error('[syncCoupangFromGmail] error:', e);
    });
}

// ─── 쿠팡 구매내역 크롤링 (GitHub Actions 트리거) ─────────────────────────────
function crawlCoupangPurchases(){
  if(!currentUser){showToast('❌ 로그인 필요');return;}
  var btn = document.getElementById('coupang-crawl-btn');

  // 서버 공용 GitHub PAT 사용
  db.ref('appConfig/githubPat').once('value').then(function(snap){
    var pat = snap.val();
    if(!pat){
      showToast('❌ 서버 설정 오류 - 관리자에게 문의하세요');
      return;
    }
    btn.textContent = '⏳ 쿠팡 크롤링 요청 중...'; btn.disabled = true;

    fetch('https://api.github.com/repos/kimbany/vending-manager/actions/workflows/coupang-crawl.yml/dispatches', {
      method: 'POST',
      headers: {'Authorization': 'token '+pat, 'Accept': 'application/vnd.github.v3+json'},
      body: JSON.stringify({ref: 'main'})
    }).then(function(res){
      btn.textContent = '🛒 쿠팡 구매내역 불러오기'; btn.disabled = false;
      if(res.status === 204){
        showToast('✅ 쿠팡 크롤링 시작! 2~3분 후 아래 버튼으로 데이터를 가져오세요');
        // 자동으로 2분 후 데이터 로드 시도
        setTimeout(function(){ loadCoupangOrders(); }, 120000);
      } else {
        showToast('❌ 요청 실패: '+res.status);
      }
    }).catch(function(){
      btn.textContent = '🛒 쿠팡 구매내역 불러오기'; btn.disabled = false;
      showToast('❌ 네트워크 오류');
    });
  });
}

// ─── Firebase에서 쿠팡 주문 데이터 로드 → 미입고 구매 목록 생성 ──────────────
function loadCoupangOrders(){
  if(!currentUser) return;
  showToast('⏳ 쿠팡 데이터 확인 중...');

  db.ref('users/'+currentUser.uid+'/coupangOrders').orderByKey().limitToLast(7).once('value').then(function(snap){
    var data = snap.val();
    if(!data){showToast('📭 쿠팡 주문 데이터 없음');return;}

    // 기존 purchases 로드
    db.ref('users/'+currentUser.uid+'/purchases').once('value').then(function(pSnap){
      var purchases = pSnap.val() || [];
      if(!Array.isArray(purchases)) purchases = Object.values(purchases);
      var existingNames = {};
      purchases.forEach(function(p){ existingNames[p.coupangProductName+'_'+p.purchaseDate] = true; });

      var added = 0;
      Object.keys(data).forEach(function(dateKey){
        var dayData = data[dateKey];
        var orders = dayData.orders || [];
        if(!Array.isArray(orders)) orders = Object.values(orders);
        orders.forEach(function(order){
          var products = order.products || [];
          if(!Array.isArray(products)) products = Object.values(products);
          var orderDate = (order.order_date||'').replace(/\./g,'-').replace(/\s/g,'');
          products.forEach(function(prod){
            var key = prod.product_name+'_'+orderDate;
            if(existingNames[key]) return; // 중복 방지
            purchases.push({
              id: Date.now().toString()+Math.random().toString(36).substr(2,4),
              coupangProductName: prod.product_name,
              quantity: prod.quantity || 1,
              totalPrice: prod.price || 0,
              unitPrice: prod.price && prod.quantity ? Math.round(prod.price / prod.quantity) : 0,
              purchaseDate: orderDate,
              status: 'pending'
            });
            existingNames[key] = true;
            added++;
          });
        });
      });

      db.ref('users/'+currentUser.uid+'/purchases').set(purchases).then(function(){
        showToast('✅ 쿠팡 주문 '+added+'건 추가');
        loadCoupangPending();
      });
    });
  });
}

// ─── 미입고 구매 목록 로드 ───────────────────────────────────────────────────
function loadCoupangPending(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/purchases').once('value').then(function(snap){
    var purchases = snap.val() || [];
    if(!Array.isArray(purchases)) purchases = Object.values(purchases);
    var pending = purchases.filter(function(p){ return p.status === 'pending'; });
    var container = document.getElementById('coupang-pending');
    var list = document.getElementById('coupang-pending-list');
    if(!pending.length){
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    list.innerHTML = pending.map(function(p, idx){
      var mapped = findMappedProduct(p.coupangProductName);
      var matchLabel = mapped ? '✅ 매칭됨' : '⚠️ 매칭 필요';
      var matchColor = mapped ? 'var(--green)' : 'var(--red)';
      return '<div style="padding:8px 0;border-bottom:1px solid rgba(0,100,255,.1)">'+
        '<div style="font-size:13px;font-weight:600">'+p.coupangProductName+'</div>'+
        '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+
          p.quantity+'개 · '+fmt(p.totalPrice)+'원 · '+p.purchaseDate+
        '</div>'+
        '<div style="display:flex;gap:6px;margin-top:6px;align-items:center">'+
          '<span style="font-size:11px;color:'+matchColor+'">'+matchLabel+'</span>'+
          (!mapped ? '<button onclick="openMatchingModal(\''+p.coupangProductName.replace(/'/g,"\\'")+'\')" style="font-size:11px;background:var(--blue);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit">제품 매칭</button>' : '')+
          (mapped ? '<button onclick="stockInFromPurchase('+idx+')" style="font-size:11px;background:var(--green);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit">입고 처리</button>' : '')+
        '</div>'+
      '</div>';
    }).join('');
  });
}

// ─── 제품 매칭 모달 ──────────────────────────────────────────────────────────
function openMatchingModal(coupangName){
  var html = '<div style="margin-bottom:12px"><div style="font-size:13px;color:var(--text2);margin-bottom:4px">쿠팡 상품명</div>'+
    '<div style="font-size:15px;font-weight:700;padding:8px;background:var(--bg3);border-radius:8px">'+coupangName+'</div></div>';
  html += '<div class="fr" style="margin-bottom:8px"><label class="lbl">매칭할 제품 선택</label>'+
    '<select id="match-product-sel" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:var(--bg2);color:var(--text)">'+
    '<option value="">제품 선택</option>'+
    D.products.map(function(p){return '<option value="'+p.id+'">'+p.name+'</option>';}).join('')+
    '</select></div>';
  html += '<div class="fr" style="margin-bottom:12px"><label class="lbl">박스당 낱개 수</label>'+
    '<input type="number" id="match-units-per-box" value="1" min="1" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"/></div>';
  html += '<button onclick="confirmMatching(\''+coupangName.replace(/'/g,"\\'")+'\')" style="width:100%;background:var(--blue);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">매칭 저장</button>';

  document.getElementById('pdm-title').textContent = '제품 매칭';
  document.getElementById('pdm-body').innerHTML = html;
  openModal('prod-detail-modal');
}

function confirmMatching(coupangName){
  var productId = document.getElementById('match-product-sel').value;
  var unitsPerBox = parseInt(document.getElementById('match-units-per-box').value) || 1;
  if(!productId){showToast('❌ 제품을 선택하세요');return;}
  saveProductMapping(coupangName, productId, unitsPerBox);
  closeModal('prod-detail-modal');
  showToast('✅ 매칭 저장 완료');
  loadCoupangPending();
}

// ─── 입고 처리 (쿠팡 구매 → stock_in) ───────────────────────────────────────
function stockInFromPurchase(purchaseIdx){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/purchases').once('value').then(function(snap){
    var purchases = snap.val() || [];
    if(!Array.isArray(purchases)) purchases = Object.values(purchases);
    var p = purchases[purchaseIdx];
    if(!p){showToast('❌ 구매 데이터 없음');return;}

    var mapped = findMappedProduct(p.coupangProductName);
    if(!mapped){showToast('❌ 제품 매칭이 필요합니다');return;}

    var unitsPerBox = mapped.unitsPerBox || 1;
    var totalUnits = p.quantity * unitsPerBox;
    var unitCost = totalUnits > 0 ? Math.round(p.totalPrice / totalUnits) : 0;

    initStockData();
    addStockIn(mapped.productId, totalUnits, unitCost, 'coupang', '쿠팡 구매 ('+p.coupangProductName+')', p.purchaseDate || td());

    // 구매 상태 업데이트
    purchases[purchaseIdx].status = 'stocked';
    purchases[purchaseIdx].matchedProductId = mapped.productId;
    purchases[purchaseIdx].locationId = currentLocationId;
    purchases[purchaseIdx].machineId = currentMachineId;
    db.ref('users/'+currentUser.uid+'/purchases').set(purchases);

    save();
    showToast('✅ '+totalUnits+'개 입고 완료 (단가 '+fmt(unitCost)+'원)');
    loadCoupangPending();
    renderInv();
  });
}

function saveProductMapping(coupangName, productId, unitsPerBox){
  var existing = _productMappings.findIndex(function(m){ return m.coupangProductName === coupangName; });
  var mapping = {
    id: Date.now().toString(),
    coupangProductName: coupangName,
    productId: productId,
    unitsPerBox: unitsPerBox || 1
  };
  if(existing >= 0) _productMappings[existing] = mapping;
  else _productMappings.push(mapping);
  db.ref('users/'+currentUser.uid+'/productMapping').set(_productMappings);
  return mapping;
}
