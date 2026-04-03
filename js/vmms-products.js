// ─── VMMS 제품 데이터 표시 ──────────────────────────────────────────────────

var _vmmsProducts = [];    // 상품마스터
var _vmmsMachines = [];    // 자판기 목록
var _vmmsColumns = {};     // 단말기별 컬럼매칭

// ─── 크롤링 데이터 불러오기 (버튼용) ─────────────────────────────────────────
function syncVmmsProducts(){
  var msg = document.getElementById('vmms-sync-msg');
  if(msg){ msg.style.color='var(--text2)'; msg.textContent='제품 데이터 불러오는 중...'; }
  db.ref('users/'+currentUser.uid+'/vmmsProducts').once('value').then(function(snap){
    var data = snap.val();
    if(!data || !data.items){
      if(msg){ msg.style.color='var(--red)'; msg.textContent='VMMS 제품 데이터가 없습니다. GitHub Actions에서 크롤링을 실행해주세요.'; }
      return;
    }
    _vmmsProducts = data.items;
    if(!Array.isArray(_vmmsProducts)) _vmmsProducts = Object.values(_vmmsProducts);
    if(msg){ msg.style.color='var(--green)'; msg.textContent='✅ 제품 '+_vmmsProducts.length+'개 불러오기 완료 ('+data.updated_at+')'; }
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
    Object.values(_vmmsColumns).forEach(function(m){ totalCols += (m.columns?m.columns.length:0); });
    if(msg){ msg.style.color='var(--green)'; msg.textContent='✅ 자판기 '+_vmmsMachines.length+'대 · 컬럼 '+totalCols+'개 불러오기 완료'; }
    initVmmsMachineNav();
    renderVmmsProducts();
    setTimeout(function(){ if(msg) msg.textContent=''; }, 3000);
  });
}
var _vmmsMachineIdx = 0;   // 현재 자판기 인덱스
var _vmmsProdSort = 'name';

// ─── VMMS 데이터 로드 ────────────────────────────────────────────────────────
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

    // 배열 변환 (Firebase 객체 → 배열)
    if(!Array.isArray(_vmmsProducts)) _vmmsProducts = Object.values(_vmmsProducts);
    if(!Array.isArray(_vmmsMachines)) _vmmsMachines = Object.values(_vmmsMachines);

    renderVmmsProducts();
    initVmmsMachineNav();
  });
}

// ─── 자판기 네비게이터 ───────────────────────────────────────────────────────
function initVmmsMachineNav(){
  var nav = document.getElementById('pm-machine-nav');
  if(!nav) return;
  if(_vmmsMachines.length > 1){
    nav.style.display = 'flex';
  } else {
    nav.style.display = _vmmsMachines.length === 1 ? 'flex' : 'none';
  }
  _vmmsMachineIdx = 0;
  _updateVmmsMachineNav();
}

function navVmmsMachine(dir){
  if(!_vmmsMachines.length) return;
  _vmmsMachineIdx = (_vmmsMachineIdx + dir + _vmmsMachines.length) % _vmmsMachines.length;
  _updateVmmsMachineNav();
  renderVmmsProducts();
}

function _updateVmmsMachineNav(){
  if(!_vmmsMachines.length) return;
  var mc = _vmmsMachines[_vmmsMachineIdx];
  var nameEl = document.getElementById('pm-machine-name');
  var devnoEl = document.getElementById('pm-machine-devno');
  if(nameEl) nameEl.textContent = (mc.machineName||'') + (_vmmsMachines.length>1 ? ' ('+(_vmmsMachineIdx+1)+'/'+_vmmsMachines.length+')' : '');
  if(devnoEl) devnoEl.textContent = '단말기: '+(mc.deviceNo||'');
}

// ─── 정렬 ────────────────────────────────────────────────────────────────────
function setVmmsProdSort(s, btn){
  _vmmsProdSort = s;
  document.querySelectorAll('.stab').forEach(function(b){ if(b.id && b.id.startsWith('vpsort')) b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  renderVmmsProducts();
}

// ─── 제품 목록 렌더링 ────────────────────────────────────────────────────────
function renderVmmsProducts(){
  var titleEl = document.getElementById('vmms-prod-title');
  var listEl = document.getElementById('vmms-prod-list');
  if(!listEl) return;

  // 현재 자판기의 컬럼 데이터 가져오기
  var mc = _vmmsMachines[_vmmsMachineIdx];
  var devno = mc ? mc.deviceNo : '';
  var colData = devno ? (_vmmsColumns[devno] || {}) : {};
  var columns = colData.columns || [];
  if(!Array.isArray(columns)) columns = Object.values(columns);

  // 상품코드 → 컬럼 매핑
  var colMap = {}; // {productCode: [{columnNo, productName}]}
  columns.forEach(function(c){
    var code = c.productCode || '';
    if(!colMap[code]) colMap[code] = [];
    colMap[code].push(c);
  });

  // 이 자판기에 매칭된 제품만 표시
  var items = [];
  columns.forEach(function(c){
    // 중복 제거 (같은 상품코드는 한번만, 컬럼은 합침)
    var existing = items.find(function(i){ return i.productCode === c.productCode; });
    if(existing){
      existing.columns.push(c.columnNo);
    } else {
      items.push({
        productCode: c.productCode || '',
        productName: c.productName || '',
        columns: [c.columnNo || ''],
        costPrice: c.costPrice || ''
      });
    }
  });

  // 정렬
  if(_vmmsProdSort === 'name'){
    items.sort(function(a,b){ return (a.productName||'').localeCompare(b.productName||'','ko'); });
  } else if(_vmmsProdSort === 'col'){
    items.sort(function(a,b){
      var ac = a.columns[0] ? parseInt(a.columns[0]) : 999;
      var bc = b.columns[0] ? parseInt(b.columns[0]) : 999;
      return ac - bc;
    });
  }

  if(titleEl) titleEl.textContent = 'VMMS 제품 ('+(mc?mc.machineName:'')+ ' · '+items.length+'개)';

  if(!items.length){
    listEl.innerHTML = '<div class="empty"><div class="ei">📦</div><div class="et">이 자판기에 매칭된 제품이 없습니다</div></div>';
    return;
  }

  listEl.innerHTML = items.map(function(item){
    var colLabels = item.columns.map(function(c){
      return '<span style="background:rgba(0,100,255,.08);border:1px solid rgba(0,100,255,.2);border-radius:6px;padding:2px 7px;font-size:12px;font-weight:700;color:var(--blue)">'+c+'</span>';
    }).join(' ');

    return '<div class="item" style="flex-wrap:wrap;gap:8px">'+
      '<div style="flex:1;min-width:0">'+
        '<div class="in">'+sanitize(item.productName)+'</div>'+
        '<div class="is">상품코드: '+sanitize(item.productCode)+'</div>'+
      '</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:4px;flex-shrink:0">'+colLabels+'</div>'+
    '</div>';
  }).join('');
}
