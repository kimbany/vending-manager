// ─── 데이터 로드 / 저장 ───────────────────────────────────────────────────────
function startApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('verify-screen').style.display='none';
  document.getElementById('loading').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('home-date').value=td();
  var crawlDate = document.getElementById('crawl-date');
  if(crawlDate) crawlDate.value=td();
  if(currentUser){
    var name = currentUser.displayName || currentUser.email;
    document.getElementById('header-user').textContent = name + ' 님';
  }
  D = {products:[], inventory:[], inventoryLogs:[], salesData:[], stockIn:[], stockDeductions:[], salesCost:[]};
  startAutoCollect();
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
  loadMachineDropdown();
  if(typeof loadLowStockThreshold === 'function') loadLowStockThreshold();
  if(typeof loadLowStockSetting === 'function') loadLowStockSetting();
  if(typeof loadPinSettings === 'function') loadPinSettings();
  if(typeof syncDeviceNumberIndex === 'function') syncDeviceNumberIndex();
  // 쿠팡 제품 매핑 + 미입고 목록 자동 로드 (새로고침 후에도 유지)
  if(typeof loadProductMappings === 'function') loadProductMappings();
  if(typeof loadCoupangPending === 'function'){
    setTimeout(function(){ loadCoupangPending(); }, 300);
  }
  // URL 해시에서 이전 탭 복원
  setTimeout(restoreTab, 100);
}

function loadUserData(){
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    if(snap.exists() && snap.val() && Object.keys(snap.val()).length > 0){
      D = {products:[], inventory:[], inventoryLogs:[], salesData:[], stockIn:[], stockDeductions:[], salesCost:[]};
      startApp();
      return;
    }
    if(!REF){ startApp(); return; }
    var done = false;
    var timer = setTimeout(function(){
      if(done) return; done = true;
      startApp();
      showToast('⚠️ 데이터 로드 실패 - 빈 상태로 시작');
    }, 8000);
    REF.once('value').then(function(snap){
      if(done) return; done = true;
      clearTimeout(timer);
      var val = snap.val();
      if(val){
        D.products      = val.products      || [];
        D.inventory     = val.inventory     || [];
        D.inventoryLogs = val.inventoryLogs || [];
        D.salesData     = val.salesData     || [];
      }
      startApp();
    }).catch(function(e){
      if(done) return; done = true;
      clearTimeout(timer);
      startApp();
    });
  });
}

function load(){ loadUserData(); } // 하위 호환

function save(){
  if(!REF){ return; }
  invalidateLocationsCache();
  REF.set(JSON.parse(JSON.stringify(D))).catch(function(e){
    console.error(e);
    showToast('⚠️ 저장 실패');
  });
}

// ─── locations 캐시 (성능 개선) ───────────────────────────────────────────────
var _locationsCache = null;
var _locationsCacheTime = 0;
function getLocationsData(callback){
  if(!currentUser){ callback(null); return; }
  // 10초 이내 캐시 사용
  if(_locationsCache && (Date.now() - _locationsCacheTime < 10000)){
    callback(_locationsCache);
    return;
  }
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    _locationsCache = snap.exists() ? snap.val() : null;
    _locationsCacheTime = Date.now();
    callback(_locationsCache);
  });
}
function invalidateLocationsCache(){ _locationsCache=null; _locationsCacheTime=0; }

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function td(){ var d=new Date(Date.now()+9*3600000); return d.toISOString().slice(0,10); }
function fmt(n){ return (Number(n)||0).toLocaleString('ko-KR'); }
function gq(pid){
  // 1차: D.stockIn에서 productId로 직접 매칭
  var siTotal = 0, siFound = false;
  if(D.stockIn && D.stockIn.length){
    D.stockIn.forEach(function(b){ if(b.productId===pid){ siTotal+=(b.remainingQty||0); siFound=true; } });
  }
  if(siFound) return siTotal;

  // 2차: D.products에서 pid로 제품 찾기
  var prod = D.products ? D.products.find(function(p){return p.id===pid;}) : null;

  // 3차: stockIn을 productCode로 매칭 (D.products.productCode ↔ stockIn.productCode)
  if(prod && prod.productCode && D.stockIn && D.stockIn.length){
    var codeTotal = 0, codeFound = false;
    D.stockIn.forEach(function(b){
      if(b.productCode===prod.productCode || b.productId===prod.productCode){
        codeTotal += (b.remainingQty||0); codeFound = true;
      }
    });
    if(codeFound) return codeTotal;
  }

  // 4차: 제품 이름으로 매칭 (stockIn이 다른 ID로 저장된 경우)
  if(prod && prod.name && D.stockIn && D.stockIn.length){
    var altTotal = 0, altFound = false;
    D.stockIn.forEach(function(b){
      if(b.productId===pid) return;
      // stockIn의 productId로 D.products 역조회
      var otherProd = D.products.find(function(p){return p.id===b.productId;});
      if(otherProd && otherProd.name && otherProd.name.trim() === prod.name.trim()){
        altTotal += (b.remainingQty||0); altFound = true;
      }
    });
    if(altFound) return altTotal;
  }

  // 5차: D.inventory에서 productId로 찾기
  if(D.inventory){
    var i=D.inventory.find(function(x){return x.productId===pid;});
    if(i) return i.qty;
    // productCode로도 시도
    if(prod && prod.productCode){
      var i2 = D.inventory.find(function(x){return x.productId===prod.productCode;});
      if(i2) return i2.qty;
    }
  }
  return 0;
}
function gp(id){ return D.products.find(function(p){return p.id===id;}); }
function showToast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  clearTimeout(t._t); t._t=setTimeout(function(){t.style.display='none';},2500);
}
function renderAll(){ renderHome(); renderInv(); renderSales(); renderMachine(); renderProds(); }
