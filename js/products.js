// ─── 제품 등록 ────────────────────────────────────────────────────────────────
var editMode = false;

function toggleEditMode(){
  editMode = !editMode;
  var btn = document.getElementById('edit-mode-btn');
  var toolbar = document.getElementById('edit-toolbar');
  if(editMode){
    btn.textContent = '✕ 취소';
    btn.style.background = 'var(--bg3)';
    btn.style.color = 'var(--red)';
    toolbar.style.display = 'block';
  } else {
    btn.textContent = '✏️ 편집';
    btn.style.background = 'var(--bg3)';
    btn.style.color = 'var(--text2)';
    toolbar.style.display = 'none';
    // 체크박스 초기화
    document.getElementById('select-all-cb').checked = false;
  }
  renderProds();
}

function toggleSelectAll(checked){
  document.querySelectorAll('.prod-cb').forEach(function(cb){ cb.checked = checked; });
  updateSelectedCount();
}

function updateSelectedCount(){
  var cnt = document.querySelectorAll('.prod-cb:checked').length;
  document.getElementById('selected-count').textContent = cnt+'개 선택';
}

function deleteSelected(){
  var ids = Array.from(document.querySelectorAll('.prod-cb:checked')).map(function(cb){return cb.value;});
  if(!ids.length){ showToast('❌ 선택된 제품이 없어요'); return; }
  if(!confirm(ids.length+'개 제품을 삭제할까요?')) return;
  D.products = D.products.filter(function(p){ return ids.indexOf(p.id) < 0; });
  save();
  showToast('✅ '+ids.length+'개 삭제 완료');
  document.getElementById('select-all-cb').checked = false;
  renderAll();
}

function renderProds(){
  document.getElementById('prod-title').textContent='등록 제품 ('+D.products.length+'개)';
  var el=document.getElementById('prod-list');
  if(!D.products.length){el.innerHTML='<div class="empty"><div class="ei">🏷️</div><div class="et">등록된 제품이 없습니다</div></div>';return;}

  function renderProdCard(p){
    var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    var colLabel=cols.length?cols.join(', '):'미배정';
    var cbHtml=editMode?'<input type="checkbox" class="prod-cb" value="'+p.id+'" onclick="event.stopPropagation()" onchange="updateSelectedCount()" style="width:20px;height:20px;accent-color:var(--gold);flex-shrink:0;cursor:pointer"/>'  :'';
    var discBadge=p.discontinued?'<span style="background:rgba(224,88,88,.2);border:1px solid rgba(224,88,88,.4);border-radius:4px;padding:1px 6px;font-size:10px;color:var(--red);font-weight:700">판매중단</span>':'';
    var btnHtml=editMode?'':'<div style="display:flex;gap:6px"><button class="btn-sm" style="background:#1a2a4a;color:var(--blue)" onclick="editProd(\'' +p.id+ '\')">수정</button><button class="btn-sm" style="background:#2a1a1a;color:var(--red)" onclick="delProd(\'' +p.id+ '\')">삭제</button></div>';
    var clickFn=editMode?'var cb=this.querySelector(\'.prod-cb\');cb.checked=!cb.checked;updateSelectedCount()':'';
    return '<div class="pc" style="'+(editMode?'cursor:pointer':'')+'" onclick="'+clickFn+'"><div class="pch"><div style="display:flex;align-items:center;gap:10px">'+cbHtml+'<div><div class="in">'+p.name+' '+discBadge+'</div><div class="is">컬럼: '+colLabel+'</div></div></div>'+btnHtml+'</div><div class="pm">'+[['구매가',fmt(p.buyPrice)+'원'],['낱개가',fmt(p.unitPrice)+'원'],['판매가',fmt(p.sellPrice)+'원'],['마진가',fmt(p.marginAmt)+'원'],['마진율',(p.marginRate||0)+'%'],['총수량',p.totalQty+'개']].map(function(lv){return '<div class="pmb"><div class="pml">'+lv[0]+'</div><div class="pmv">'+lv[1]+'</div></div>';}).join('')+'</div></div>';
  }

  // 단말기번호별 그룹화
  var groups={}, noDevno=[];
  D.products.forEach(function(p){
    if(p.deviceNo){ if(!groups[p.deviceNo]) groups[p.deviceNo]=[]; groups[p.deviceNo].push(p); }
    else noDevno.push(p);
  });

  var html='';
  var devnos=Object.keys(groups);
  devnos.forEach(function(devno){
    html+='<div style="font-size:12px;font-weight:700;color:var(--gold);padding:8px 0 6px;border-top:1px solid var(--border);margin-top:4px">📟 단말기 '+devno+' ('+groups[devno].length+'개)</div>';
    html+=groups[devno].map(renderProdCard).join('');
  });
  if(noDevno.length){
    if(devnos.length) html+='<div style="font-size:12px;font-weight:700;color:var(--text2);padding:8px 0 6px;border-top:1px solid var(--border);margin-top:4px">📦 단말기 미지정 ('+noDevno.length+'개)</div>';
    html+=noDevno.map(renderProdCard).join('');
  }
  el.innerHTML=html;
}
function calcProduct(){
  var buy=parseFloat(document.getElementById('p-buy').value);
  var total=parseFloat(document.getElementById('p-total').value);
  var sell=parseFloat(document.getElementById('p-sell').value);
  var unit=(!isNaN(buy)&&!isNaN(total)&&total>0)?Math.round(buy/total):null;
  document.getElementById('p-unit').textContent=unit!=null?fmt(unit)+'원':'구매가 ÷ 총수량';
  if(unit!=null&&!isNaN(sell)){
    document.getElementById('p-ma').textContent=fmt(sell-unit)+'원';
    document.getElementById('p-mr').textContent=sell>0?Math.round((sell-unit)/sell*100)+'%':'-';
  }else{
    document.getElementById('p-ma').textContent='-';
    document.getElementById('p-mr').textContent='-';
  }
}

function openProductModal(){
  document.getElementById('p-eid').value='';
  document.getElementById('prod-modal-title').textContent='제품 등록';
  document.getElementById('p-save-btn').textContent='등록 완료';
  ['p-name','p-buy','p-total','p-sell','p-col'].forEach(function(id){document.getElementById(id).value='';});
  var discontinuedEl = document.getElementById('p-discontinued');
  if(discontinuedEl) discontinuedEl.checked = false;
  document.getElementById('p-unit').textContent='구매가 ÷ 총수량';
  document.getElementById('p-ma').textContent='-';
  document.getElementById('p-mr').textContent='-';
  loadDevnoOptions('p-devno', null);
  openModal('prod-modal');
}

// 단말기번호 드롭다운 로드
function loadDevnoOptions(selectId, selectedDevno){
  var sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">단말기 선택 (선택 시 해당 자판기에 배치)</option>';
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    if(!snap.exists()) return;
    snap.forEach(function(locSnap){
      var loc = locSnap.val();
      Object.keys(loc.machines||{}).forEach(function(mid){
        var m = loc.machines[mid];
        var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
        devnos.forEach(function(devno){
          var opt = document.createElement('option');
          opt.value = locSnap.key+'|'+mid+'|'+devno;
          opt.textContent = '📍 '+loc.name+' · 🏪 '+m.name+' ('+devno+')';
          if(selectedDevno && devno===selectedDevno) opt.selected=true;
          sel.appendChild(opt);
        });
      });
    });
  });
}

function editProd(id){
  var p=gp(id);if(!p)return;
  document.getElementById('p-eid').value=id;
  document.getElementById('prod-modal-title').textContent='제품 수정';
  document.getElementById('p-save-btn').textContent='수정 완료';
  document.getElementById('p-name').value=p.name;
  document.getElementById('p-buy').value=p.buyPrice;
  document.getElementById('p-total').value=p.totalQty;
  document.getElementById('p-sell').value=p.sellPrice;
  loadDevnoOptions('p-devno', p.deviceNo||null);
  var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
  document.getElementById('p-col').value=cols.join(', ');
  var discEl=document.getElementById('p-discontinued');
  if(discEl) discEl.checked=p.discontinued||false;
  calcProduct();
  openModal('prod-modal');
}

function saveProduct(){
  var name=document.getElementById('p-name').value.trim();
  if(!name){showToast('❌ 제품명을 입력하세요');return;}
  var buy=parseFloat(document.getElementById('p-buy').value)||0;
  var total=parseFloat(document.getElementById('p-total').value)||0;
  var sell=parseFloat(document.getElementById('p-sell').value)||0;
  var unit=total>0?Math.round(buy/total):0;
  var ma=sell-unit;
  var mr=sell>0?Math.round(ma/sell*100):0;
  var colRaw=document.getElementById('p-col').value;
  var col=colRaw.split(',').map(function(c){return c.trim();}).filter(function(c){return c.length>0;});
  // 단말기번호 - locId|machineId|devno 형태
  var devnoVal = document.getElementById('p-devno').value;
  var discontinuedVal = document.getElementById('p-discontinued') ? document.getElementById('p-discontinued').checked : false;
  var devno = devnoVal ? devnoVal.split('|')[2]||'' : '';
  var eid=document.getElementById('p-eid').value;
  // 중복 위치 체크: 다른 제품이 이미 사용 중인 컬럼인지 확인
  var conflicts=[];
  col.forEach(function(c){
    D.products.forEach(function(p){
      if(p.id===eid) return; // 수정 중인 제품 자신은 제외
      var pCols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
      if(pCols.indexOf(c)>=0) conflicts.push({col:c, name:p.name});
    });
  });
  if(conflicts.length){
    var msg=conflicts.map(function(c){return c.col+'번 ('+c.name+')';}).join(', ');
    if(!confirm('⚠️ 중복된 컬럼 위치가 있어요!\n\n'+msg+'\n\n이미 위 제품이 배정된 위치예요.\n그래도 저장할까요?')) return;
  }
  var prod={id:eid||Date.now().toString(),name:name,buyPrice:buy,totalQty:total,unitPrice:unit,sellPrice:sell,marginAmt:ma,marginRate:mr,column:col,deviceNo:devno,discontinued:discontinuedVal};
  // 다른 자판기 제품이면 해당 appData에 저장
  var targetLocMachine = null;
  if(devnoVal && devnoVal.indexOf('|') >= 0){
    var parts = devnoVal.split('|');
    var tLocId = parts[0], tMachId = parts[1];
    if(tLocId !== currentLocationId || tMachId !== currentMachineId){
      targetLocMachine = {locId: tLocId, machId: tMachId};
    }
  }

  if(targetLocMachine){
    var tRef = db.ref('users/'+currentUser.uid+'/locations/'+targetLocMachine.locId+'/machines/'+targetLocMachine.machId+'/appData/products');
    tRef.once('value').then(function(snap){
      var tProds = snap.val()||[];
      if(!Array.isArray(tProds)) tProds = Object.values(tProds);
      if(eid){ tProds = tProds.map(function(p){return p.id===prod.id?prod:p;}); }
      else { tProds.push(prod); }
      tRef.set(tProds).then(function(){
        closeModal('prod-modal');
        showToast(eid?'✅ 수정 완료':'✅ 등록 완료');
        renderProds();
      });
    });
    return;
  }

  if(eid){
    D.products=D.products.map(function(p){return p.id===prod.id?prod:p;});
  } else {
    D.products.push(prod);
    // 신규 등록 시 초기 재고 설정
    if(total>0){
      var idx=D.inventory.findIndex(function(i){return i.productId===prod.id;});
      if(idx>=0) D.inventory[idx].qty=total;
      else D.inventory.push({productId:prod.id, qty:total});
      D.inventoryLogs.push({
        id:Date.now().toString()+Math.random(),
        productId:prod.id,
        delta:total,
        memo:'초기 재고 설정',
        date:td()
      });
    }
  }
  save();
  closeModal('prod-modal');
  showToast(eid?'✅ 수정 완료':'✅ 제품 등록 완료 (초기 재고 '+total+'개)');
  renderAll();
}

function delProd(id){
  if(!confirm('삭제하시겠습니까?'))return;
  D.products=D.products.filter(function(p){return p.id!==id;});
  save();
  showToast('✅ 삭제 완료');
  renderAll();
}
