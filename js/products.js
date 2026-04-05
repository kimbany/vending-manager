// ─── 제품 관리 ────────────────────────────────────────────────────────────────
var editMode = false;
var prodSort = 'name'; // 기본 정렬: 제품명

function setProdSort(s, btn){
  prodSort = s;
  document.querySelectorAll('.stab').forEach(function(b){ if(b.id && b.id.startsWith('psort')) b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  renderProds();
}

// 제품 관리 탭 자판기 네비게이터
var pmMachineList = [];
var pmMachineIdx = 0;

function initProdMachineNav(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    pmMachineList = [];
    if(snap.exists()){
      snap.forEach(function(locSnap){
        var loc = locSnap.val();
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m = loc.machines[mid];
          var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
          pmMachineList.push({machineId:mid, locId:locSnap.key, name:m.name, devno:devnos[0]||''});
        });
      });
    }
    var nav = document.getElementById('pm-machine-nav');
    if(nav){
      nav.style.display = pmMachineList.length > 1 ? 'flex' : 'none';
      if(pmMachineList.length > 0){
        // 현재 자판기 찾기
        var found = -1;
        pmMachineList.forEach(function(mc, i){ if(mc.machineId === currentMachineId) found = i; });
        pmMachineIdx = found >= 0 ? found : 0;
        _updatePmNav();
      }
    }
  });
}

function navProdMachine(dir){
  if(!pmMachineList.length) return;
  pmMachineIdx = (pmMachineIdx + dir + pmMachineList.length) % pmMachineList.length;
  _updatePmNav();
  // 해당 자판기 데이터 로드 후 해당 자판기 제품만 표시
  var mc = pmMachineList[pmMachineIdx];
  var machineREF = db.ref('users/'+currentUser.uid+'/locations/'+mc.locId+'/machines/'+mc.machineId+'/appData');
  machineREF.once('value').then(function(snap){
    var val = snap.val()||{};
    currentLocationId = mc.locId;
    currentMachineId = mc.machineId;
    REF = machineREF;
    D.products = val.products||[];
    D.inventory = val.inventory||[];
    D.inventoryLogs = val.inventoryLogs||[];
    D.salesData = val.salesData||[];
    // 현재 자판기 제품만 표시
    _renderProdsFromList(D.products);
  });
}

function _updatePmNav(){
  var mc = pmMachineList[pmMachineIdx];
  var nameEl = document.getElementById('pm-machine-name');
  var devnoEl = document.getElementById('pm-machine-devno');
  if(nameEl) nameEl.textContent = mc.name + (pmMachineList.length>1 ? ' ('+(pmMachineIdx+1)+'/'+pmMachineList.length+')' : '');
  if(devnoEl) devnoEl.textContent = '단말기: '+mc.devno;
}

function toggleEditMode(){
  editMode = !editMode;
  var btn = document.getElementById('edit-mode-btn');
  var toolbar = document.getElementById('edit-toolbar');
  if(editMode){
    btn.innerHTML = '<span style="color:var(--red)">✕ 편집 취소</span><span style="font-size:16px;color:var(--text3);line-height:1">›</span>';
    btn.style.borderColor = 'rgba(255,90,95,.3)';
    toolbar.style.display = 'block';
  } else {
    btn.innerHTML = '<span>✏️ 편집</span><span style="font-size:16px;color:var(--text3);line-height:1">›</span>';
    btn.style.borderColor = 'var(--border)';
    toolbar.style.display = 'none';
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
  // VMMS 모드면 vmms-products.js에서 처리
  if(document.getElementById('vmms-prod-list')) return;
  _renderProdsFromList(D.products);
}

function _renderProdsFromList(products){
  var titleEl = document.getElementById('prod-title');
  var el = document.getElementById('prod-list');
  if(!titleEl || !el) return;
  titleEl.textContent='등록 제품 ('+products.length+'개)';
  if(!products.length){el.innerHTML='<div class="empty"><div class="ei">🏷️</div><div class="et">등록된 제품이 없습니다</div></div>';return;}

  // 정렬 적용
  var sorted = products.slice();
  if(prodSort==='name'){
    sorted.sort(function(a,b){return (a.name||'').localeCompare(b.name||'','ko');});
  } else if(prodSort==='col'){
    sorted.sort(function(a,b){
      var ac=Array.isArray(a.column)?a.column:(a.column?[a.column]:[]); var av=ac.length?parseInt(ac[0])||0:999;
      var bc=Array.isArray(b.column)?b.column:(b.column?[b.column]:[]); var bv=bc.length?parseInt(bc[0])||0:999;
      return av-bv;
    });
  } else if(prodSort==='qasc'){
    sorted.sort(function(a,b){return gq(a.id)-gq(b.id);});
  } else if(prodSort==='qdesc'){
    sorted.sort(function(a,b){return gq(b.id)-gq(a.id);});
  }
  products = sorted;

  function renderProdCard(p){
    var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    var colLabel=cols.length?cols.join(', '):'미배정';
    var currentStock = gq(p.id);
    var cbHtml=editMode?'<input type="checkbox" class="prod-cb" value="'+p.id+'" onclick="event.stopPropagation()" onchange="updateSelectedCount()" style="width:20px;height:20px;accent-color:var(--blue);flex-shrink:0;cursor:pointer"/>'  :'';
    var discBadge=p.discontinued?'<span style="background:rgba(224,88,88,.2);border:1px solid rgba(224,88,88,.4);border-radius:4px;padding:1px 6px;font-size:10px;color:var(--red);font-weight:700;white-space:nowrap">판매중단</span>':'';
    var btnHtml=editMode?'':'<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn-sm" style="background:#1a2a4a;color:var(--blue)" onclick="editProd(\'' +p.id+ '\')">수정</button><button class="btn-sm" style="background:#2a1a1a;color:var(--red)" onclick="delProd(\'' +p.id+ '\')">삭제</button></div>';
    var clickFn=editMode?'var cb=this.querySelector(\'.prod-cb\');cb.checked=!cb.checked;updateSelectedCount()':'';
    return '<div class="pc" style="'+(editMode?'cursor:pointer':'')+'" onclick="'+clickFn+'"><div class="pch" style="gap:8px"><div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">'+cbHtml+'<div style="min-width:0"><div class="in" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+p.name+' '+discBadge+'</div><div class="is">컬럼: '+colLabel+'</div></div></div>'+btnHtml+'</div><div class="pm">'+[['구매가',fmt(p.buyPrice)+'원'],['낱개가',fmt(p.unitPrice)+'원'],['판매가',fmt(p.sellPrice)+'원'],['마진가',fmt(p.marginAmt)+'원'],['마진율',(p.marginRate||0)+'%'],['재고',currentStock+'개']].map(function(lv){return '<div class="pmb"><div class="pml">'+lv[0]+'</div><div class="pmv">'+lv[1]+'</div></div>';}).join('')+'</div></div>';
  }

  var groups={}, noDevno=[];
  products.forEach(function(p){
    if(p.deviceNo){ if(!groups[p.deviceNo]) groups[p.deviceNo]=[]; groups[p.deviceNo].push(p); }
    else noDevno.push(p);
  });
  var html='';
  var devnos=Object.keys(groups);
  devnos.forEach(function(devno){
    html+='<div style="font-size:13px;font-weight:700;color:var(--blue);padding:8px 0 6px;border-top:1px solid var(--border);margin-top:4px">📟 단말기 '+devno+' ('+groups[devno].length+'개)</div>';
    html+=groups[devno].map(renderProdCard).join('');
  });
  if(noDevno.length){
    if(devnos.length) html+='<div style="font-size:13px;font-weight:700;color:var(--text2);padding:8px 0 6px;border-top:1px solid var(--border);margin-top:4px">📦 단말기 미지정 ('+noDevno.length+'개)</div>';
    html+=noDevno.map(renderProdCard).join('');
  }
  el.innerHTML=html;
}

function _renderProdsMulti(machineDataList, totalProds){
  document.getElementById('prod-title').textContent='등록 제품 ('+machineDataList.length+'대 · '+totalProds+'개)';
  var el=document.getElementById('prod-list');
  if(!totalProds){el.innerHTML='<div class="empty"><div class="ei">🏷️</div><div class="et">등록된 제품이 없습니다</div></div>';return;}

  function renderProdCard(p, isCurrent){
    var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    var colLabel=cols.length?cols.join(', '):'미배정';
    var currentStock = gq(p.id);
    var cbHtml=editMode && isCurrent?'<input type="checkbox" class="prod-cb" value="'+p.id+'" onclick="event.stopPropagation()" onchange="updateSelectedCount()" style="width:20px;height:20px;accent-color:var(--blue);flex-shrink:0;cursor:pointer"/>':'';
    var discBadge=p.discontinued?'<span style="background:rgba(224,88,88,.2);border:1px solid rgba(224,88,88,.4);border-radius:4px;padding:1px 6px;font-size:10px;color:var(--red);font-weight:700;white-space:nowrap">판매중단</span>':'';
    var btnHtml=editMode?'':'<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn-sm" style="background:#1a2a4a;color:var(--blue)" onclick="editProd(\'' +p.id+ '\')">수정</button><button class="btn-sm" style="background:#2a1a1a;color:var(--red)" onclick="delProd(\'' +p.id+ '\')">삭제</button></div>';
    var clickFn=editMode && isCurrent?'var cb=this.querySelector(\'.prod-cb\');cb.checked=!cb.checked;updateSelectedCount()':'';
    return '<div class="pc" style="'+(editMode && isCurrent?'cursor:pointer':'')+'" onclick="'+clickFn+'"><div class="pch" style="gap:8px"><div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">'+cbHtml+'<div style="min-width:0"><div class="in" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+p.name+' '+discBadge+'</div><div class="is">컬럼: '+colLabel+'</div></div></div>'+btnHtml+'</div><div class="pm">'+[['구매가',fmt(p.buyPrice)+'원'],['낱개가',fmt(p.unitPrice)+'원'],['판매가',fmt(p.sellPrice)+'원'],['마진가',fmt(p.marginAmt)+'원'],['마진율',(p.marginRate||0)+'%'],['재고',currentStock+'개']].map(function(lv){return '<div class="pmb"><div class="pml">'+lv[0]+'</div><div class="pmv">'+lv[1]+'</div></div>';}).join('')+'</div></div>';
  }

  var html='';
  machineDataList.forEach(function(md){
    html+='<div style="font-size:13px;font-weight:700;color:var(--blue);padding:10px 0 6px;border-top:2px solid var(--border);margin-top:8px">📍 '+md.locName+' · 🏪 '+md.machineName+' ('+md.products.length+'개)</div>';
    if(!md.products.length){
      html+='<div style="text-align:center;padding:12px;color:var(--text3);font-size:13px">등록된 제품 없음</div>';
      return;
    }
    md.products.forEach(function(p){ html+=renderProdCard(p, md.isCurrent); });
  });
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
  var p=gp(id);
  // D.products에 없으면 _vmViewProds에서 찾기
  if(!p && typeof _vmViewProds !== 'undefined') p = _vmViewProds.find(function(x){return x.id===id;});
  // 그래도 없으면 모든 자판기에서 찾기 (비동기)
  if(!p && currentUser){
    db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
      if(!snap.exists()) return;
      var locs = snap.val();
      var found = null;
      Object.keys(locs).forEach(function(locId){
        var loc = locs[locId];
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m = loc.machines[mid];
          var appData = m.appData||{};
          var prods = appData.products||[];
          if(!Array.isArray(prods)) prods = Object.values(prods);
          var match = prods.find(function(x){return x.id===id;});
          if(match) found = match;
        });
      });
      if(found) _openEditProdModal(found);
    });
    return;
  }
  if(!p) return;
  _openEditProdModal(p);
}

function _openEditProdModal(p){
  document.getElementById('p-eid').value=p.id;
  document.getElementById('prod-modal-title').textContent='판매가 수정';
  document.getElementById('p-save-btn').textContent='수정 완료';
  document.getElementById('p-name').value=p.name;
  document.getElementById('p-buy').value=p.buyPrice||0;
  document.getElementById('p-total').value=p.totalQty||0;
  document.getElementById('p-sell').value=p.sellPrice||'';
  var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
  document.getElementById('p-col').value=cols.join(', ');
  var discEl=document.getElementById('p-discontinued');
  if(discEl) discEl.checked=p.discontinued||false;
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
  // 중복 위치 체크: 같은 단말기 내, 판매중단 제품 제외
  var conflicts=[];
  if(!discontinuedVal){
    col.forEach(function(c){
      D.products.forEach(function(p){
        if(p.id===eid) return;
        if(p.discontinued) return; // 판매중단 제품은 제외
        if(devno && p.deviceNo && p.deviceNo !== devno) return;
        var pCols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
        if(pCols.indexOf(c)>=0) conflicts.push({col:c, name:p.name});
      });
    });
  }
  if(conflicts.length){
    var msg=conflicts.map(function(c){return c.col+'번 ('+c.name+')';}).join(', ');
    if(!confirm('⚠️ 같은 자판기에 중복된 컬럼 위치가 있어요!\n\n'+msg+'\n\n이미 위 제품이 배정된 위치예요.\n그래도 저장할까요?')) return;
  }
  // 중복 제품 체크: 같은 단말기번호 + 같은 상품명 (신규 등록 시만)
  if(!eid){
    var duplicate = D.products.find(function(p){
      var sameDevice = !devno || !p.deviceNo || p.deviceNo === devno;
      return p.name.trim() === name && sameDevice;
    });
    if(duplicate){
      if(!confirm('⚠️ 같은 자판기에 "'+name+'" 제품이 이미 등록되어 있습니다.\n그래도 등록할까요?')) return;
    }
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
  // 현재 자판기(D.products)에 있으면 바로 삭제
  var found = D.products.find(function(p){return p.id===id;});
  if(found){
    D.products=D.products.filter(function(p){return p.id!==id;});
    save();
    showToast('✅ 삭제 완료');
    renderAll();
    return;
  }
  // 다른 자판기에서 삭제
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    if(!snap.exists()) return;
    var locs = snap.val();
    var deleted = false;
    var promises = [];
    Object.keys(locs).forEach(function(locId){
      var loc = locs[locId];
      Object.keys(loc.machines||{}).forEach(function(mid){
        var appData = loc.machines[mid].appData;
        if(!appData || !appData.products) return;
        var prods = appData.products;
        if(!Array.isArray(prods)) prods = Object.values(prods);
        var hasIt = prods.find(function(p){return p.id===id;});
        if(hasIt){
          var filtered = prods.filter(function(p){return p.id!==id;});
          promises.push(db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+mid+'/appData/products').set(filtered));
          deleted = true;
        }
      });
    });
    if(promises.length){
      Promise.all(promises).then(function(){
        showToast('✅ 삭제 완료');
        renderProds();
      });
    } else {
      showToast('❌ 제품을 찾을 수 없어요');
    }
  });
}

// ─── 신규 상품 감지 ──────────────────────────────────────────────────────────
function checkNewProducts(){
  // 판매 데이터에서 미매칭(productId=null) 항목의 상품명 수집
  var unknowns = {};
  D.salesData.forEach(function(s){
    if(!s.productId && s.itemName){
      var name = s.itemName.trim();
      if(!unknowns[name]) unknowns[name] = {name:name, count:0};
      unknowns[name].count++;
    }
  });
  var unknownList = Object.values(unknowns);
  if(!unknownList.length) return;

  var el = document.getElementById('new-prod-list');
  el.innerHTML = unknownList.map(function(u){
    return '<div style="background:var(--bg3);border-radius:10px;padding:12px;margin-bottom:8px;border:1px solid var(--border)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
        '<div><div style="font-size:14px;font-weight:700">'+u.name+'</div><div style="font-size:12px;color:var(--text3)">미매칭 '+u.count+'건</div></div>'+
      '</div>'+
      '<div style="display:flex;gap:6px">'+
        '<button onclick="registerNewProd(\''+u.name.replace(/'/g,"\\'")+'\')" style="flex:1;background:rgba(122,218,154,.15);border:1px solid rgba(122,218,154,.3);border-radius:8px;padding:8px;font-size:13px;font-weight:600;color:var(--green);cursor:pointer;font-family:inherit">신규 등록</button>'+
        '<button onclick="mapToExistingProd(\''+u.name.replace(/'/g,"\\'")+'\')" style="flex:1;background:rgba(126,200,227,.15);border:1px solid rgba(126,200,227,.3);border-radius:8px;padding:8px;font-size:13px;font-weight:600;color:var(--blue);cursor:pointer;font-family:inherit">기존 상품 매칭</button>'+
      '</div>'+
    '</div>';
  }).join('');
  openModal('new-product-modal');
}

function registerNewProd(name){
  closeModal('new-product-modal');
  document.getElementById('p-eid').value='';
  document.getElementById('prod-modal-title').textContent='신규 제품 등록';
  document.getElementById('p-save-btn').textContent='등록 완료';
  ['p-buy','p-total','p-sell','p-col'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('p-name').value=name;
  var discEl=document.getElementById('p-discontinued');
  if(discEl) discEl.checked=false;
  document.getElementById('p-unit').textContent='구매가 ÷ 총수량';
  document.getElementById('p-ma').textContent='-';
  document.getElementById('p-mr').textContent='-';
  loadDevnoOptions('p-devno', null);
  openModal('prod-modal');
}

function mapToExistingProd(unknownName){
  // 기존 제품 선택 드롭다운
  var opts = D.products.map(function(p){return '<option value="'+p.id+'">'+p.name+'</option>';}).join('');
  var el = document.getElementById('new-prod-list');
  el.innerHTML =
    '<div style="padding:14px">'+
      '<div style="font-size:14px;font-weight:700;margin-bottom:8px">"'+unknownName+'"을 어느 제품에 매칭할까요?</div>'+
      '<select id="map-existing-select" style="margin-bottom:12px">'+opts+'</select>'+
      '<div style="display:flex;gap:8px">'+
        '<button onclick="confirmMapExisting(\''+unknownName.replace(/'/g,"\\'")+'\')" style="flex:1;background:var(--blue);border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">매칭 적용</button>'+
        '<button onclick="checkNewProducts()" style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px;color:var(--text2);cursor:pointer;font-family:inherit">뒤로</button>'+
      '</div>'+
    '</div>';
}

function confirmMapExisting(unknownName){
  var sel = document.getElementById('map-existing-select');
  if(!sel||!sel.value) return;
  var targetProd = gp(sel.value);
  if(!targetProd){ showToast('❌ 제품을 찾을 수 없어요'); return; }
  // 해당 상품명의 모든 미매칭 판매 데이터를 기존 제품에 매칭
  var count = 0;
  D.salesData.forEach(function(s){
    if(!s.productId && s.itemName && s.itemName.trim() === unknownName){
      s.productId = targetProd.id;
      s.itemName = targetProd.name;
      count++;
    }
  });
  save();
  showToast('✅ '+count+'건을 "'+targetProd.name+'"에 매칭 완료');
  closeModal('new-product-modal');
  renderAll();
}
