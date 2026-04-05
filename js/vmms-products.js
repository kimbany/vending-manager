// ─── VMMS 제품 데이터 표시 ──────────────────────────────────────────────────

var _vmmsProducts = [];    // 상품마스터 (전체 제품)
var _vmmsMachines = [];    // 자판기 목록
var _vmmsColumns = {};     // 단말기별 컬럼매칭
var _vmmsProdSort = 'name';

// ─── 실시간 VMMS 크롤링 (Cloud Function 호출) ────────────────────────────────
function crawlVmmsRealtime(){
  var msg = document.getElementById('vmms-sync-msg');
  if(msg){ msg.style.color='var(--text2)'; msg.textContent='⏳ VMMS에서 제품 데이터를 수집하고 있어요... (1~2분 소요)'; }
  var crawlFn = firebase.functions().httpsCallable('crawlVmmsProducts');
  crawlFn().then(function(result){
    var d = result.data;
    if(msg){ msg.style.color='var(--green)'; msg.textContent='✅ '+d.message; }
    // 수집된 데이터 바로 로드
    syncVmmsProducts();
    syncVmmsColumns();
    setTimeout(function(){ if(msg) msg.textContent=''; }, 5000);
  }).catch(function(e){
    if(msg){
      msg.style.color='var(--red)';
      if(e.code==='functions/failed-precondition') msg.textContent=e.message;
      else if(e.code==='functions/unauthenticated') msg.textContent='로그인이 필요합니다';
      else msg.textContent='크롤링 실패: '+e.message;
    }
  });
}

// ─── 크롤링 데이터 불러오기 (Firebase에서 읽기) ─────────────────────────────
function syncVmmsProducts(){
  var msg = document.getElementById('vmms-sync-msg');
  if(msg){ msg.style.color='var(--text2)'; msg.textContent='제품 데이터 불러오는 중...'; }
  db.ref('users/'+currentUser.uid+'/vmmsProducts').once('value').then(function(snap){
    var data = snap.val();
    if(!data || !data.items){
      if(msg){ msg.style.color='var(--text2)'; msg.textContent='VMMS 제품 데이터가 없습니다. 아래 "VMMS 실시간 수집" 버튼을 눌러주세요.'; }
      return;
    }
    _vmmsProducts = data.items;
    if(!Array.isArray(_vmmsProducts)) _vmmsProducts = Object.values(_vmmsProducts);
    if(msg){ msg.style.color='var(--green)'; msg.textContent='✅ 제품 '+_vmmsProducts.length+'개 불러오기 완료 ('+data.updated_at+')'; }
    renderVmmsProducts();
    setTimeout(function(){ if(msg) msg.textContent=''; }, 3000);
  });
}

function syncVmmsColumns(){
  var msg = document.getElementById('vmms-sync-msg');
  if(msg){ msg.style.color='var(--text2)'; msg.textContent='컬럼 매칭 데이터 불러오는 중...'; }
  Promise.all([
    db.ref('users/'+currentUser.uid+'/vmmsMachines').once('value'),
    db.ref('users/'+currentUser.uid+'/vmmsColumns').once('value')
  ]).then(function(results){
    var machData = results[0].val();
    var colData = results[1].val();
    if(!machData || !machData.items){
      if(msg){ msg.style.color='var(--red)'; msg.textContent='VMMS 자판기 데이터가 없습니다. GitHub Actions에서 크롤링을 실행해주세요.'; }
      return;
    }
    _vmmsMachines = machData.items;
    _vmmsColumns = (colData && colData.machines) ? colData.machines : {};
    if(!Array.isArray(_vmmsMachines)) _vmmsMachines = Object.values(_vmmsMachines);
    var totalCols = 0;
    Object.values(_vmmsColumns).forEach(function(m){ var cols=m.columns||[]; totalCols += (Array.isArray(cols)?cols.length:Object.keys(cols).length); });
    if(msg){ msg.style.color='var(--green)'; msg.textContent='✅ 자판기 '+_vmmsMachines.length+'대 · 컬럼 '+totalCols+'개 불러오기 완료'; }
    renderVmmsProducts();
    setTimeout(function(){ if(msg) msg.textContent=''; }, 3000);
  });
}

// ─── VMMS 데이터 로드 (탭 열때 자동) ─────────────────────────────────────────
function loadVmmsProductData(){
  if(!currentUser) return;
  Promise.all([
    db.ref('users/'+currentUser.uid+'/vmmsProducts').once('value'),
    db.ref('users/'+currentUser.uid+'/vmmsMachines').once('value'),
    db.ref('users/'+currentUser.uid+'/vmmsColumns').once('value')
  ]).then(function(results){
    var prodSnap = results[0].val();
    var machSnap = results[1].val();
    var colSnap = results[2].val();
    _vmmsProducts = (prodSnap && prodSnap.items) ? prodSnap.items : [];
    _vmmsMachines = (machSnap && machSnap.items) ? machSnap.items : [];
    _vmmsColumns = (colSnap && colSnap.machines) ? colSnap.machines : {};
    if(!Array.isArray(_vmmsProducts)) _vmmsProducts = Object.values(_vmmsProducts);
    if(!Array.isArray(_vmmsMachines)) _vmmsMachines = Object.values(_vmmsMachines);
    renderVmmsProducts();
  });
}

// ─── 정렬 ────────────────────────────────────────────────────────────────────
function setVmmsProdSort(s, btn){
  _vmmsProdSort = s;
  document.querySelectorAll('.stab').forEach(function(b){ if(b.id && b.id.startsWith('vpsort')) b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  renderVmmsProducts();
}

// ─── 컬럼매칭 여부 확인 (판매상태 판단) ──────────────────────────────────────
function _getProductColumnMap(){
  // 전체 자판기의 컬럼 데이터에서 상품코드 → 컬럼 매핑
  var map = {}; // {productCode: [{columnNo, machineName, deviceNo}]}
  Object.keys(_vmmsColumns).forEach(function(devno){
    var machData = _vmmsColumns[devno];
    var cols = machData.columns || [];
    if(!Array.isArray(cols)) cols = Object.values(cols);
    cols.forEach(function(c){
      var code = c.productCode||'';
      if(!code) return;
      if(!map[code]) map[code] = [];
      map[code].push({
        columnNo: c.columnNo||'',
        machineName: machData.machineName||'',
        deviceNo: devno
      });
    });
  });
  return map;
}

// ─── 전체 제품 렌더링 (통합 리스트) ──────────────────────────────────────────
function renderVmmsProducts(){
  var titleEl = document.getElementById('vmms-prod-title');
  var listEl = document.getElementById('vmms-prod-list');
  if(!listEl) return;

  // 필터/검색 값
  var filterEl = document.getElementById('vprod-filter');
  var searchEl = document.getElementById('vprod-search');
  var filterVal = filterEl ? filterEl.value : 'all';
  var searchVal = searchEl ? searchEl.value.trim().toLowerCase() : '';

  // 컬럼 매핑 생성
  var colMap = _getProductColumnMap();

  // 전체 제품에 판매상태 추가
  var items = _vmmsProducts.map(function(p){
    var code = p.productCode || '';
    var columns = colMap[code] || [];
    var isActive = columns.length > 0;
    return {
      productCode: code,
      productName: p.productName || '',
      barcode: p.barcode || '',
      isActive: isActive,
      columns: columns
    };
  });

  // 필터 적용
  if(filterVal === 'active') items = items.filter(function(i){ return i.isActive; });
  if(filterVal === 'inactive') items = items.filter(function(i){ return !i.isActive; });

  // 검색 적용
  if(searchVal){
    items = items.filter(function(i){
      return i.productName.toLowerCase().indexOf(searchVal) >= 0 ||
             i.productCode.toLowerCase().indexOf(searchVal) >= 0;
    });
  }

  // 정렬
  if(_vmmsProdSort === 'name'){
    items.sort(function(a,b){ return (a.productName||'').localeCompare(b.productName||'','ko'); });
  } else if(_vmmsProdSort === 'code'){
    items.sort(function(a,b){ return (a.productCode||'').localeCompare(b.productCode||''); });
  } else if(_vmmsProdSort === 'status'){
    items.sort(function(a,b){ return (b.isActive?1:0) - (a.isActive?1:0); });
  }

  var activeCount = items.filter(function(i){return i.isActive;}).length;
  var inactiveCount = items.length - activeCount;
  if(titleEl) titleEl.textContent = '전체 제품 ('+items.length+'개 · 판매중 '+activeCount+' · 중지 '+inactiveCount+')';

  if(!items.length){
    listEl.innerHTML = '<div class="empty"><div class="ei">📦</div><div class="et">'+(_vmmsProducts.length ? '검색 결과 없음' : 'VMMS 데이터를 불러와주세요')+'</div></div>';
    return;
  }

  listEl.innerHTML = items.map(function(item){
    var statusBadge = item.isActive
      ? '<span style="background:rgba(0,199,115,.1);color:var(--green);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap">판매중</span>'
      : '<span style="background:rgba(255,90,95,.1);color:var(--red);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap">판매중지</span>';

    var colInfo = '';
    if(item.columns.length){
      var colNos = item.columns.map(function(c){return c.columnNo;}).join(', ');
      colInfo = ' · 컬럼: '+colNos;
    }

    return '<div class="item" style="gap:8px">'+
      '<div style="flex:1;min-width:0">'+
        '<div class="in" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
          sanitize(item.productName)+' '+statusBadge+
        '</div>'+
        '<div class="is">상품코드: '+sanitize(item.productCode)+colInfo+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
