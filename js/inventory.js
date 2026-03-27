// ─── 재고 서브탭 ──────────────────────────────────────────────────────────────
var invSubCurrent = 'stock';

function switchInvSub(sub){
  invSubCurrent = sub;
  var isStock = sub === 'stock';
  document.getElementById('inv-panel-stock').style.display = isStock ? 'block' : 'none';
  document.getElementById('inv-panel-purchase').style.display = isStock ? 'none' : 'block';
  var btnStock    = document.getElementById('inv-sub-stock');
  var btnPurchase = document.getElementById('inv-sub-purchase');
  btnStock.style.background    = isStock ? 'var(--gold)' : 'transparent';
  btnStock.style.color         = isStock ? '#1a1208' : 'var(--text2)';
  btnStock.style.fontWeight    = isStock ? '700' : '600';
  btnPurchase.style.background = isStock ? 'transparent' : 'var(--gold)';
  btnPurchase.style.color      = isStock ? 'var(--text2)' : '#1a1208';
  btnPurchase.style.fontWeight = isStock ? '600' : '700';
  if(!isStock) renderPurchase();
}

function renderPurchase(){
  var lowProds = D.products.filter(function(p){ return gq(p.id) <= 5; });
  var el = document.getElementById('purchase-low-list');
  if(!lowProds.length){
    el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">✅ 재고 부족 제품 없음</div>';
    return;
  }
  el.innerHTML = lowProds.map(function(p){
    var q = gq(p.id);
    var cols = Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(224,88,88,.15)">'+
      '<div style="flex:1;cursor:pointer" onclick="openCoupangSearch(this.dataset.name)" data-name="'+p.name+'">'+
        '<div style="font-size:13px;font-weight:600">'+p.name+'</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-top:2px">컬럼: '+( cols.join(', ')||'-')+'</div>'+
      '</div>'+
      '<span style="font-size:14px;font-weight:800;color:'+(q===0?'var(--red)':'var(--gold)')+'">'+q+'개</span>'+
      '<span onclick="openCoupangSearch(\''+p.name.replace(/'/g,"\\'")+'\')" style="font-size:11px;background:rgba(232,184,109,.2);color:var(--gold);border:1px solid rgba(232,184,109,.4);border-radius:6px;padding:3px 8px;white-space:nowrap;cursor:pointer">쿠팡 검색 &#8594;</span>'+
    '</div>';
  }).join('');
}

function openCoupang(name){
  // 파트너스 키가 있으면 파트너스 링크로 열기
  if(typeof openCoupangWithAffiliate === 'function'){
    openCoupangWithAffiliate(name);
  } else {
    var url = 'https://www.coupang.com/np/search?q=' + encodeURIComponent(name);
    window.open(url, '_blank');
    requestNotification('🛒 쿠팡 검색', name + ' 쿠팡 검색 페이지를 열었어요');
  }
}

function openAllCoupang(){
  var lowProds = D.products.filter(function(p){ return gq(p.id) <= 5; });
  if(!lowProds.length){ showToast('재고 부족 제품이 없어요'); return; }
  if(!confirm(lowProds.length+'개 제품을 순차적으로 쿠팡에서 검색할게요. 팝업 차단을 허용해주세요.')) return;
  lowProds.forEach(function(p, i){
    setTimeout(function(){
      openCoupang(p.name);
    }, i * 800);
  });
}

// ─── 브라우저 푸시 알림 ────────────────────────────────────────────────────────
function requestNotification(title, body){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'granted'){
    new Notification(title, {body:body, icon:'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f6d2.png'});
  } else if(Notification.permission !== 'denied'){
    Notification.requestPermission().then(function(perm){
      if(perm === 'granted'){
        new Notification(title, {body:body});
      }
    });
  }
}

function checkLowStockNotify(){
  var lowProds = D.products.filter(function(p){ return gq(p.id) <= 5; });
  if(lowProds.length > 0){
    var names = lowProds.slice(0,3).map(function(p){return p.name;}).join(', ');
    requestNotification('⚠️ 재고 부족 알림', names + (lowProds.length>3?' 외 '+(lowProds.length-3)+'개':'') + ' 재고가 부족해요');
  }
}

var invSort = 'name';

function setInvSort(s, btn){
  invSort = s;
  document.querySelectorAll('.stab').forEach(function(b){ if(b.id&&b.id.startsWith('isort')) b.classList.remove('active'); });
  btn.classList.add('active');
  renderInv();
}

function getSortedProducts(){
  var prods = D.products.slice();
  if(invSort==='name'){
    prods.sort(function(a,b){return a.name.localeCompare(b.name,'ko');});
  } else if(invSort==='col'){
    prods.sort(function(a,b){
      var ac = Array.isArray(a.column)?a.column:(a.column?[a.column]:[]); var av = ac.length?parseInt(ac[0])||0:999;
      var bc = Array.isArray(b.column)?b.column:(b.column?[b.column]:[]); var bv = bc.length?parseInt(bc[0])||0:999;
      return av-bv;
    });
  } else if(invSort==='qasc'){
    prods.sort(function(a,b){return gq(a.id)-gq(b.id);});
  } else if(invSort==='qdesc'){
    prods.sort(function(a,b){return gq(b.id)-gq(a.id);});
  }
  return prods;
}

function renderInv(){
  // 모든 자판기 재고를 로드하여 표시
  if(!currentUser || !currentLocationId){
    _renderInvSingle(D.products, D.inventory, '');
    return;
  }
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    if(!snap.exists()||!snap.val()){
      _renderInvSingle(D.products, D.inventory, '');
      return;
    }
    var locs = snap.val();
    var promises = [];
    Object.keys(locs).forEach(function(locId){
      var loc = locs[locId];
      Object.keys(loc.machines||{}).forEach(function(mid){
        var m = loc.machines[mid];
        promises.push(
          db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+mid+'/appData').once('value').then(function(ds){
            var val = ds.val()||{};
            var prods = val.products||[];
            if(!Array.isArray(prods)) prods = Object.values(prods);
            prods = prods.filter(function(p){ return p && p.name; });
            return {locId:locId, machineId:mid, locName:loc.name, machineName:m.name, products:prods, inventory:val.inventory||[], isCurrent:(locId===currentLocationId && mid===currentMachineId)};
          })
        );
      });
    });
    Promise.all(promises).then(function(machineDataList){
      if(machineDataList.length <= 1){
        var md = machineDataList[0]||{products:D.products, inventory:D.inventory};
        _renderInvSingle(md.products, md.inventory, md.machineName||'');
      } else {
        _renderInvMulti(machineDataList);
      }
    });
  });
}

function _renderInvSingle(prods, inv, machineName){
  function getQ(pid){ var i=inv.find(function(x){return x.productId===pid;}); return i?i.qty:0; }
  var sorted = prods.slice();
  if(invSort==='name') sorted.sort(function(a,b){return a.name.localeCompare(b.name,'ko');});
  else if(invSort==='qasc') sorted.sort(function(a,b){return getQ(a.id)-getQ(b.id);});
  else if(invSort==='qdesc') sorted.sort(function(a,b){return getQ(b.id)-getQ(a.id);});
  document.getElementById('inv-title').textContent='전체 재고 현황 ('+sorted.length+'개)';
  var el=document.getElementById('inv-list');
  if(!sorted.length){
    document.getElementById('inv-low-card').style.display='none';
    document.getElementById('inv-low-list').innerHTML='';
    el.innerHTML='<div class="empty"><div class="ei">📦</div><div class="et">등록된 제품이 없습니다</div></div>';
    return;
  }
  var lowThreshold = getLowStockThreshold();
  var lowProds = sorted.filter(function(p){return getQ(p.id)<=lowThreshold;});
  var lowCard = document.getElementById('inv-low-card');
  if(lowProds.length){
    lowCard.style.display='block';
    document.getElementById('inv-low-list').innerHTML = lowProds.map(function(p){
      var q=getQ(p.id);
      var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(224,88,88,.15);cursor:pointer" onclick="openInvDetail(\''+p.id+'\')">'+
        '<div><span style="font-size:14px;font-weight:600">'+p.name+'</span>'+
        '<span style="font-size:12px;color:var(--text3);margin-left:6px">컬럼 '+cols.join(', ')+'</span></div>'+
        '<span style="font-size:14px;font-weight:800;color:'+(q===0?'var(--red)':'var(--gold)')+'">'+q+'개</span></div>';
    }).join('');
  } else {
    lowCard.style.display='none';
  }
  el.innerHTML=sorted.map(function(p){
    var q=getQ(p.id),lw=q<=lowThreshold;
    var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    var colLabel=cols.length?cols.join(', '):'-';
    return '<div class="item" style="cursor:pointer;'+(lw?'border-color:rgba(224,88,88,.3)':'')+'" onclick="openInvDetail(this.dataset.pid)" data-pid="'+p.id+'">'+
      '<div><div class="in">'+p.name+'</div><div class="is">컬럼: '+colLabel+' | 판매가: '+fmt(p.sellPrice)+'원</div></div>'+
      '<span class="badge '+(q===0?'br':lw?'bo':'bg')+'">'+q+'개</span></div>';
  }).join('');
  var sel=document.getElementById('inv-product');
  sel.innerHTML='<option value="">제품 선택</option>'+D.products.map(function(p){return '<option value="'+p.id+'">'+p.name+'</option>';}).join('');
}

function _renderInvMulti(machineDataList){
  var totalProds = 0;
  machineDataList.forEach(function(md){ totalProds += md.products.length; });
  document.getElementById('inv-title').textContent='전체 재고 현황 ('+machineDataList.length+'대 · '+totalProds+'개)';
  var el=document.getElementById('inv-list');
  var lowCard = document.getElementById('inv-low-card');

  var lowThreshold = getLowStockThreshold();
  var allLow = [];
  machineDataList.forEach(function(md){
    function getQ(pid){ var i=md.inventory.find(function(x){return x.productId===pid;}); return i?i.qty:0; }
    md.products.forEach(function(p){
      var q=getQ(p.id);
      if(q<=lowThreshold) allLow.push({p:p, q:q, machineName:md.machineName, locName:md.locName});
    });
  });
  if(allLow.length){
    lowCard.style.display='block';
    document.getElementById('inv-low-list').innerHTML = allLow.map(function(x){
      var cols=Array.isArray(x.p.column)?x.p.column:(x.p.column?[x.p.column]:[]);
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(224,88,88,.15)">'+
        '<div><span style="font-size:14px;font-weight:600">'+x.p.name+'</span>'+
        '<span style="font-size:12px;color:var(--text3);margin-left:6px">'+x.machineName+'</span></div>'+
        '<span style="font-size:14px;font-weight:800;color:'+(x.q===0?'var(--red)':'var(--gold)')+'">'+x.q+'개</span></div>';
    }).join('');
  } else {
    lowCard.style.display='none';
  }

  var html = '';
  machineDataList.forEach(function(md){
    function getQ(pid){ var i=md.inventory.find(function(x){return x.productId===pid;}); return i?i.qty:0; }
    var sorted = md.products.slice();
    if(invSort==='name') sorted.sort(function(a,b){return a.name.localeCompare(b.name,'ko');});
    else if(invSort==='qasc') sorted.sort(function(a,b){return getQ(a.id)-getQ(b.id);});
    else if(invSort==='qdesc') sorted.sort(function(a,b){return getQ(b.id)-getQ(a.id);});

    html += '<div style="font-size:13px;font-weight:700;color:var(--gold);padding:10px 0 6px;border-top:1px solid var(--border);margin-top:6px">'+
      '📍 '+md.locName+' · 🏪 '+md.machineName+' ('+sorted.length+'개)</div>';
    if(!sorted.length){
      html += '<div style="text-align:center;padding:12px;color:var(--text3);font-size:13px">등록된 제품 없음</div>';
      return;
    }
    sorted.forEach(function(p){
      var q=getQ(p.id), lw=q<=lowThreshold;
      var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
      var colLabel=cols.length?cols.join(', '):'-';
      var isCurrent = md.isCurrent;
      var clickAttr = isCurrent ? ' onclick="openInvDetail(this.dataset.pid)" data-pid="'+p.id+'" style="cursor:pointer;' : ' style="';
      html += '<div class="item"'+clickAttr+(lw?'border-color:rgba(224,88,88,.3)':'')+'">'+
        '<div><div class="in">'+p.name+'</div><div class="is">컬럼: '+colLabel+' | 판매가: '+fmt(p.sellPrice)+'원</div></div>'+
        '<span class="badge '+(q===0?'br':lw?'bo':'bg')+'">'+q+'개</span></div>';
    });
  });
  el.innerHTML = html;

  var sel=document.getElementById('inv-product');
  sel.innerHTML='<option value="">제품 선택</option>'+D.products.map(function(p){return '<option value="'+p.id+'">'+p.name+'</option>';}).join('');
}

function getLowStockThreshold(){
  // 설정에서 재고 부족 기준 불러오기 (기본: 5)
  if(typeof _lowStockThreshold !== 'undefined' && _lowStockThreshold !== null) return _lowStockThreshold;
  return 5;
}
var _lowStockThreshold = null;
function loadLowStockThreshold(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/settings/lowStock').once('value').then(function(snap){
    var v = snap.val();
    if(v && v.mode === 'fixed' && v.fixedQty !== undefined){
      _lowStockThreshold = parseInt(v.fixedQty)||5;
    } else if(v && v.mode === 'average' && v.avgDays !== undefined){
      _lowStockThreshold = null; // 평균 판매량 기준은 별도 계산
      _lowStockAvgDays = parseInt(v.avgDays)||3;
    } else {
      _lowStockThreshold = 5;
    }
  });
}
var _lowStockAvgDays = 3;


function setDir(d){
  invDir=d;
  document.getElementById('dir-plus').className='dbtn plus'+(d==='plus'?' active':'');
  document.getElementById('dir-minus').className='dbtn minus'+(d==='minus'?' active':'');
}

function applyInventoryChange(pid, delta, memo){
  var idx=D.inventory.findIndex(function(i){return i.productId===pid;});
  if(idx>=0) D.inventory[idx].qty=Math.max(0,D.inventory[idx].qty+delta);
  else D.inventory.push({productId:pid,qty:Math.max(0,delta)});
  D.inventoryLogs.push({id:Date.now().toString()+Math.random(),productId:pid,delta:delta,memo:memo||'',date:td()});
  // 재고 감소 후 부족 알림 체크
  if(delta < 0){
    var newQty = D.inventory.find(function(i){return i.productId===pid;});
    if(newQty && newQty.qty <= 5){
      var p = gp(pid);
      if(p) requestNotification('⚠️ 재고 부족', p.name+' 재고가 '+newQty.qty+'개 남았어요');
    }
  }
}

function submitInventory(){
  var pid=document.getElementById('inv-product').value;
  var qty=parseInt(document.getElementById('inv-qty').value);
  var memo=document.getElementById('inv-memo').value;
  if(!pid||isNaN(qty)||qty<=0){showToast('❌ 제품과 수량을 입력하세요');return;}
  var delta=invDir==='plus'?qty:-qty;
  applyInventoryChange(pid,delta,memo);
  save();
  closeModal('inv-modal');
  document.getElementById('inv-qty').value='';
  document.getElementById('inv-memo').value='';
  showToast(invDir==='plus'?'✅ +'+qty+'개 입고 완료':'✅ -'+qty+'개 출고 완료');
  renderAll();
}

// ─── 재고 상세 팝업 ───────────────────────────────────────────────────────────
var idmDir = 'plus';
var idmPid = '';

function openInvDetail(el){
  var pid = (typeof el === 'string') ? el : el.dataset.pid;
  idmPid = pid;
  idmDir = 'plus';
  document.getElementById('idm-qty').value='';
  document.getElementById('idm-memo').value='';
  setIdmDir('plus');
  renderIdmDetail();
  openModal('inv-detail-modal');
}

function setIdmDir(d){
  idmDir = d;
  document.getElementById('idm-dir-plus').className='dbtn plus'+(d==='plus'?' active':'');
  document.getElementById('idm-dir-minus').className='dbtn minus'+(d==='minus'?' active':'');
}

function renderIdmDetail(){
  var p = D.products.find(function(x){return x.id===idmPid;}); if(!p) return;
  var q = gq(idmPid);
  var lw = q<=5;

  // 상단 재고 현황
  document.getElementById('idm-title').textContent = p.name;
  document.getElementById('idm-stock').innerHTML =
    '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">현재 재고</div>'+
    '<div style="font-size:36px;font-weight:800;color:'+(lw?'var(--red)':'var(--green)')+'">'+q+
    '<span style="font-size:15px;font-weight:400;color:var(--text2);margin-left:6px">개</span></div>'+
    (lw?'<div style="font-size:11px;color:var(--red);margin-top:4px">⚠️ 재고 부족</div>':'');

  // ── 입출고 로그 (수동) ──────────────────────────────────────────────────────
  var invLogs = D.inventoryLogs.filter(function(l){ return l.productId===idmPid; });
  var manualLogs = [];
  invLogs.forEach(function(l){
    var delta = (typeof l.delta !== 'undefined') ? l.delta : (l.dir==='minus' ? -(l.qty||0) : (l.qty||0));
    var isSalesAuto = l.memo && (l.memo.indexOf('자동차감')>=0 || l.memo.indexOf('판매데이터')>=0 || l.memo.indexOf('환불')>=0);
    if(!isSalesAuto){
      manualLogs.push({delta:delta, date:l.date||'', memo:l.memo||'', isSales:false, isManual:true});
    }
  });

  // ── 판매 데이터 날짜별 합산 (실제 매출 날짜 기준) ──────────────────────────
  var salesByDate = {};
  D.salesData.filter(function(s){ return s.productId===idmPid && !s.cancelled; }).forEach(function(s){
    var key = s.date||'';
    if(!salesByDate[key]) salesByDate[key] = 0;
    salesByDate[key] -= (s.qty||1); // 판매 = 재고 차감
  });
  var salesLogs = Object.keys(salesByDate).map(function(date){
    return {delta:salesByDate[date], date:date, memo:'판매 차감', isSales:true};
  });

  // ── 환불 로그 (inventoryLogs 중 환불처리) ─────────────────────────────────
  var refundLogs = [];
  invLogs.forEach(function(l){
    var delta = (typeof l.delta !== 'undefined') ? l.delta : (l.dir==='minus' ? -(l.qty||0) : (l.qty||0));
    var isRefund = l.memo && l.memo.indexOf('환불')>=0;
    if(isRefund){
      refundLogs.push({delta:delta, date:l.date||'', memo:l.memo||'', isSales:false, isRefund:true});
    }
  });

  // ── 전체 합쳐서 날짜 내림차순 정렬 ──────────────────────────────────────────
  var allLogs = manualLogs.concat(salesLogs).concat(refundLogs)
    .filter(function(l){ return l.date; })
    .sort(function(a,b){
      // 날짜 내림차순, 같은 날짜면 판매차감이 아래
      var dc = b.date.localeCompare(a.date);
      if(dc !== 0) return dc;
      if(a.isSales && !b.isSales) return 1;
      if(!a.isSales && b.isSales) return -1;
      return 0;
    });

  if(!allLogs.length){
    document.getElementById('idm-logs').innerHTML='<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">내역이 없어요</div>';
    return;
  }

  document.getElementById('idm-logs').innerHTML = allLogs.map(function(l){
    var isPlus  = l.delta >= 0;
    var absQty  = Math.abs(l.delta);
    var isSales = l.isSales;
    var isRefund= l.isRefund;
    // 태그/색상 결정
    var tagLabel = isSales ? '판매차감' : isRefund ? '환불' : isPlus ? '입고' : '출고';
    var tagBg    = isSales ? 'rgba(224,88,88,.15)'   : isRefund ? 'rgba(122,218,154,.15)' : isPlus ? 'rgba(122,218,154,.15)' : 'var(--bg3)';
    var tagColor = isSales ? 'var(--red)'             : isRefund ? 'var(--green)'          : isPlus ? 'var(--green)'          : 'var(--text3)';
    var numColor = isPlus  ? 'var(--green)' : 'var(--red)';
    var memoColor= isSales ? 'var(--red)'   : isRefund ? 'var(--green)' : isPlus ? 'var(--green)' : 'var(--text2)';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">'+
      '<div style="min-width:36px;text-align:center">'+
        '<span style="font-size:18px;font-weight:800;color:'+numColor+'">'+(isPlus?'+':'-')+absQty+'</span>'+
      '</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:11px;color:var(--text3)">'+l.date+'</div>'+
        '<div style="font-size:12px;color:'+memoColor+';margin-top:1px;font-weight:'+(isSales||isRefund?'600':'400')+'">'+l.memo+'</div>'+
      '</div>'+
      '<span style="font-size:10px;background:'+tagBg+';color:'+tagColor+';border-radius:4px;padding:2px 7px;font-weight:600">'+tagLabel+'</span>'+
    '</div>';
  }).join('');
}

function submitIdmInventory(){
  var qty = parseInt(document.getElementById('idm-qty').value);
  var memo = document.getElementById('idm-memo').value.trim();
  if(isNaN(qty)||qty<=0){showToast('❌ 수량을 입력하세요');return;}
  var delta = idmDir==='plus' ? qty : -qty;
  applyInventoryChange(idmPid, delta, memo);
  save();
  document.getElementById('idm-qty').value='';
  document.getElementById('idm-memo').value='';
  showToast(idmDir==='plus'?'✅ +'+qty+'개 입고':'✅ -'+qty+'개 출고');
  renderIdmDetail(); // 팝업 내 재고/내역 즉시 갱신
  renderInv();       // 목록도 갱신
}
