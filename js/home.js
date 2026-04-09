// ─── 홈 ───────────────────────────────────────────────────────────────────────

function toggleRankFull(btn){
  var rid = btn.dataset.rid;
  var total = btn.dataset.total;
  var el = document.getElementById(rid);
  var show = el.style.display === 'none';
  el.style.display = show ? 'block' : 'none';
  btn.textContent = show ? '▲ 접기' : '▼ 전체 '+total+'개 제품 보기';
}

function renderHome(){
  var date = document.getElementById('home-date').value || td();
  document.getElementById('home-dt').textContent = date + ' 판매 현황';

  var mnEl = document.getElementById('home-machine-name');
  if(mnEl) mnEl.textContent = '';

  if(!currentUser){
    _renderHomeSalesSingle(date);
    renderAllMachineLowStock();
    return;
  }

  // 모든 위치/자판기에서 판매 데이터 합산 (위치별)
  getLocationsData(function(locs){
    if(!locs){
      _renderHomeSalesSingle(date);
      renderAllMachineLowStock();
      return;
    }
    var locDataList = []; // {locName, totalQty, totalAmt, byP:{pid:{name,qty}}}

    Object.keys(locs).forEach(function(locId){
      var loc = locs[locId];
      var locEntry = {locName:loc.name, totalQty:0, totalAmt:0, byP:{}};
      Object.keys(loc.machines||{}).forEach(function(mid){
        var m = loc.machines[mid];
        var appData = m.appData||{};
        var sales = appData.salesData||[];
        var prods = appData.products||[];
        if(!Array.isArray(sales)) sales = Object.values(sales);
        if(!Array.isArray(prods)) prods = Object.values(prods);
        function getP(pid){ return prods.find(function(p){return p.id===pid;}); }
        sales.forEach(function(s){
          if(s.date!==date || s.cancelled) return;
          var p = getP(s.productId);
          locEntry.totalQty += (s.qty||0);
          locEntry.totalAmt += (s.qty||0)*(p?p.sellPrice:0);
          if(s.productId){
            if(!locEntry.byP[s.productId]) locEntry.byP[s.productId]={name:p?p.name:'미매칭',qty:0};
            locEntry.byP[s.productId].qty += (s.qty||0);
          }
        });
      });
      locDataList.push(locEntry);
    });

    // 전체 합산
    var grandQty=0, grandAmt=0;
    locDataList.forEach(function(ld){ grandQty+=ld.totalQty; grandAmt+=ld.totalAmt; });
    document.getElementById('home-qty').textContent = fmt(grandQty)+'개';
    document.getElementById('home-amt').textContent = fmt(grandAmt)+'원';

    // TOP 3 (전체 합산)
    var allByP = {};
    locDataList.forEach(function(ld){
      Object.keys(ld.byP).forEach(function(pid){
        if(!allByP[pid]) allByP[pid]={name:ld.byP[pid].name,qty:0};
        allByP[pid].qty += ld.byP[pid].qty;
      });
    });
    var top3 = Object.values(allByP).sort(function(a,b){return b.qty-a.qty;}).slice(0,3);
    var em=['🥇','🥈','🥉'];
    document.getElementById('home-top3').innerHTML = top3.length
      ? top3.map(function(x,i){ return '<div class="ti" style="border:1px solid var(--border)"><span style="font-size:20px">'+em[i]+'</span><div style="flex:1"><div class="in">'+x.name+'</div></div><span style="font-weight:800;font-size:16px;color:var(--text);white-space:nowrap">'+x.qty+'개</span></div>'; }).join('')
      : '<div class="empty"><div class="ei">📦</div><div class="et">판매 데이터 없음</div></div>';

    // 위치별 판매 순위 (위치가 2개 이상일 때)
    var locRankEl = document.getElementById('home-loc-ranks');
    if(locRankEl){
      if(locDataList.length > 1){
        var html = '';
        locDataList.forEach(function(ld){
          if(!ld.totalQty) return;
          var rank = Object.values(ld.byP).sort(function(a,b){return b.qty-a.qty;}).slice(0,5);
          html += '<div class="card" style="margin-top:12px"><div class="ch"><div class="ca" style="background:var(--blue)"></div><div><div class="ct">📍 '+ld.locName+'</div><div class="cs">'+fmt(ld.totalQty)+'개 · '+fmt(ld.totalAmt)+'원</div></div></div><div class="cb">';
          rank.forEach(function(item,i){
            html += '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:14px"><span>#'+(i+1)+' '+item.name+'</span><span style="font-weight:700;color:var(--blue);white-space:nowrap">'+item.qty+'개</span></div>';
          });
          html += '</div></div>';
        });
        locRankEl.innerHTML = html;
      } else {
        locRankEl.innerHTML = '';
      }
    }

    renderAllMachineLowStock();
  });
}

function _renderHomeSalesSingle(date){
  var ds = D.salesData.filter(function(s){ return s.date===date && !s.cancelled; });
  var qty = ds.reduce(function(s,x){ return s+(x.qty||0); }, 0);
  var amt = ds.reduce(function(s,x){ var p=gp(x.productId); return s+(x.qty||0)*(p?p.sellPrice:0); }, 0);
  document.getElementById('home-qty').textContent = fmt(qty)+'개';
  document.getElementById('home-amt').textContent = fmt(amt)+'원';
  var byP = {};
  ds.forEach(function(s){ byP[s.productId]=(byP[s.productId]||0)+s.qty; });
  var top3 = Object.keys(byP).map(function(id){ return {p:gp(id),q:byP[id]}; }).filter(function(x){return x.p;}).sort(function(a,b){return b.q-a.q;}).slice(0,3);
  var em=['🥇','🥈','🥉'];
  document.getElementById('home-top3').innerHTML = top3.length
    ? top3.map(function(x,i){ return '<div class="ti" style="border:1px solid var(--border)"><span style="font-size:20px">'+em[i]+'</span><div style="flex:1"><div class="in">'+x.p.name+'</div></div><span style="font-weight:800;font-size:16px;color:var(--text);white-space:nowrap">'+x.q+'개</span></div>'; }).join('')
    : '<div class="empty"><div class="ei">📦</div><div class="et">판매 데이터 없음</div></div>';
}

function renderAllMachineLowStock(){
  var el = document.getElementById('home-all-low-list');
  if(!el || !currentUser) return;

  // VMMS + locations 데이터 로드
  Promise.all([
    db.ref('users/'+currentUser.uid+'/vmmsColumns').once('value'),
    db.ref('users/'+currentUser.uid+'/vmmsMachines').once('value'),
    db.ref('users/'+currentUser.uid+'/locations').once('value')
  ]).then(function(results){
    var colSnap = results[0].val();
    var machSnap = results[1].val();
    var locSnap = results[2].val();

    var vmmsColumns = (colSnap && colSnap.machines) ? colSnap.machines : {};
    var vmmsMachines = (machSnap && machSnap.items) ? machSnap.items : [];
    if(!Array.isArray(vmmsMachines)) vmmsMachines = Object.values(vmmsMachines);

    if(!vmmsMachines.length){
      // VMMS 데이터 없으면 기존 방식 fallback
      var lt = typeof getLowStockThreshold==='function' ? getLowStockThreshold() : 5;
      var low = D.inventory.filter(function(i){return i.qty<=lt;})
        .map(function(i){return {i:i,p:gp(i.productId)};}).filter(function(x){return x.p && !x.p.discontinued;});
      el.innerHTML = low.length
        ? low.map(function(x){
            return '<div class="li"><div style="min-width:0"><div class="in">'+x.p.name+'</div></div><span class="badge '+(x.i.qty===0?'br':'bo')+'">'+x.i.qty+'개</span></div>';
          }).join('')
        : '<div class="empty"><div class="ei">✅</div><div class="et">재고 부족 없음</div></div>';
      return;
    }

    // VMMS 자판기별 재고부족
    var totalLow=0;
    var cards=[];
    var lt2 = typeof getLowStockThreshold==='function' ? getLowStockThreshold() : 5;

    vmmsMachines.forEach(function(vm){
      var devno = vm.deviceNo||'';
      var colData = vmmsColumns[devno]||{};
      var columns = colData.columns||[];
      if(!Array.isArray(columns)) columns = Object.values(columns);

      // locations에서 재고 가져오기
      var inv = [];
      var stockIn = [];
      if(locSnap){
        Object.keys(locSnap).forEach(function(locId){
          var loc = locSnap[locId];
          Object.keys(loc.machines||{}).forEach(function(mid){
            var m = loc.machines[mid];
            var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
            if(devnos.indexOf(devno)>=0){
              var appData = m.appData||{};
              inv = appData.inventory||[];
              stockIn = appData.stockIn||[];
              if(!Array.isArray(inv)) inv = Object.values(inv);
              if(!Array.isArray(stockIn)) stockIn = Object.values(stockIn);
            }
          });
        });
      }

      var locLow = [];
      // 제품별 재고 확인
      var seen = {};
      columns.forEach(function(c){
        var code = c.productCode||'';
        var name = c.productName||'';
        var id = code||name;
        if(seen[id]) return;
        seen[id] = true;
        // stockIn(batch)에서 해당 제품 찾고, 없으면 inventory(구 시스템)
        var q = 0, siFound = false;
        stockIn.forEach(function(b){ if(b.productId===id){ q+=(b.remainingQty||0); siFound=true; } });
        if(!siFound){ var qi = inv.find(function(x){return x.productId===id;}); q = qi ? qi.qty : 0; }
        if(q <= lt2) locLow.push({p:{name:name}, q:q, machineName:vm.machineName||''});
      });
      if(!locLow.length) return;
      totalLow += locLow.length;
      var itemsHtml = locLow.map(function(x){
        return '<div class="li"><div style="min-width:0"><div class="in">'+x.p.name+'</div><div class="is">'+x.machineName+'</div></div><span class="badge '+(x.q===0?'br':'bo')+'">'+x.q+'개</span></div>';
      }).join('');
      cards.push('<div class="low-stock-card"><div style="font-size:12px;font-weight:700;color:var(--blue);padding:0 0 6px">🏪 '+(vm.machineName||devno)+' <span style="color:var(--red)">('+locLow.length+')</span></div>'+itemsHtml+'</div>');
    });

    if(!totalLow){
      el.innerHTML='<div class="empty"><div class="ei">✅</div><div class="et">모든 자판기 재고 부족 없음</div></div>';
    } else {
      el.innerHTML='<div class="low-stock-grid">'+cards.join('')+'</div>';
    }
  });
}
