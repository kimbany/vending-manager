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

// ─── 쿠팡 구매내역 크롤링 (GitHub Actions 트리거) ─────────────────────────────
function crawlCoupangPurchases(){
  if(!currentUser){showToast('❌ 로그인 필요');return;}
  var btn = document.getElementById('coupang-crawl-btn');

  db.ref('users/'+currentUser.uid+'/settings/githubPat').once('value').then(function(snap){
    var pat = snap.val();
    if(!pat){
      showToast('⚠️ 설정 → VMMS → GitHub 토큰을 먼저 등록하세요');
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
