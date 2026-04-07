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
