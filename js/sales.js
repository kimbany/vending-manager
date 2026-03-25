// ─── 판매 통계 ─────────────────────────────────────────────────────────────────
function setSalesSort(s,el){
  salesSort=s;
  document.querySelectorAll('.stab').forEach(function(b){b.classList.remove('active');});
  el.classList.add('active');
  renderSales();
}

// ─── 판매 통계 ────────────────────────────────────────────────────────────────
var salesPeriod = 'today';

function setSalesPeriod(period, btn){
  salesPeriod = period;
  document.querySelectorAll('.stab').forEach(function(b){
    if(b.id && b.id.startsWith('sp-')) b.classList.remove('active');
  });
  btn.classList.add('active');
  var customEl = document.getElementById('sales-custom-range');
  customEl.style.display = period==='custom' ? 'flex' : 'none';
  renderSalesStats();
}

function getSalesDateRange(){
  var today = td();
  if(salesPeriod==='today') return {from:today, to:today};
  if(salesPeriod==='yesterday'){
    var yd = new Date(); yd.setDate(yd.getDate()-1);
    var ydStr = yd.toISOString().slice(0,10);
    return {from:ydStr, to:ydStr};
  }
  if(salesPeriod==='week'){
    var d = new Date(); d.setDate(d.getDate()-6);
    return {from:d.toISOString().slice(0,10), to:today};
  }
  if(salesPeriod==='month'){
    var d2 = new Date(); d2.setDate(d2.getDate()-29);
    return {from:d2.toISOString().slice(0,10), to:today};
  }
  if(salesPeriod==='custom'){
    return {
      from: document.getElementById('sales-date-from').value || today,
      to:   document.getElementById('sales-date-to').value   || today
    };
  }
  return {from:today, to:today};
}

function getFilteredSales(){
  var range = getSalesDateRange();
  return D.salesData.filter(function(s){
    return s.date>=range.from && s.date<=range.to && !s.cancelled;
  });
}

function renderSales(){ renderSalesStats(); } // 하위 호환

function renderSalesStats(){
  var panel = document.getElementById('sales-stats-panel');
  if(!panel) return;
  var range = getSalesDateRange();

  // 위치의 모든 자판기 salesData 합산
  if(!currentUser || !currentLocationId){
    _doRenderSalesStats([{sales: D.salesData, prods: D.products, inv: D.inventory, name:'', devno:''}], range, panel);
    return;
  }
  db.ref('users/'+currentUser.uid+'/locations/'+currentLocationId+'/machines').once('value').then(function(snap){
    if(!snap.exists()){ _doRenderSalesStats([{sales:D.salesData,prods:D.products,inv:D.inventory,name:'',devno:''}], range, panel); return; }
    var machines = snap.val();
    var promises = Object.keys(machines).map(function(mid){
      var m = machines[mid];
      var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
      return db.ref('users/'+currentUser.uid+'/locations/'+currentLocationId+'/machines/'+mid+'/appData').once('value').then(function(as){
        var val = as.val()||{};
        return {sales: val.salesData||[], prods: val.products||[], inv: val.inventory||[], name: m.name||mid, devno: devnos[0]||mid, locId: currentLocationId, machineId: mid};
      });
    });
    Promise.all(promises).then(function(machineDataList){
      _doRenderSalesStats(machineDataList, range, panel);
    });
  });
}

function _doRenderSalesStats(machineDataList, range, panel){
  // 전체 합산 필터 (환불 포함 - 건별 내역 표시용)
  var allFiltered = [];
  machineDataList.forEach(function(md){
    var f = (md.sales||[]).filter(function(s){ return s.date>=range.from && s.date<=range.to; });
    f.forEach(function(s){ s._machineName = md.name; s._devno = md.devno; s._prods = md.prods; s._inv = md.inv; s._locId = md.locId||''; s._machineId = md.machineId||''; });
    allFiltered = allFiltered.concat(f);
  });
  var filtered = allFiltered;

  if(!filtered.length){
    panel.innerHTML='<div class="empty" style="margin-top:20px"><div class="ei">📊</div><div class="et">해당 기간 판매 데이터 없어요</div></div>';
    return;
  }

  var range = getSalesDateRange();
  var totalQty=0, totalAmt=0;
  var prodMap={}, priceMap={}, hourMap={};

  var unmatchedQty = 0; // 매칭 안 된 수량

  var cancelledQty = 0, cancelledAmt = 0;
  filtered.forEach(function(s){
    // 취소건 별도 집계
    if(s.cancelled){
      cancelledQty += s.qty;
      cancelledAmt += s.amt||0;
      return;
    }

    // 각 자판기 products에서 제품 찾기
    var p = null;
    if(s._prods) p = s._prods.find(function(x){return x.id===s.productId;});
    if(!p && s.productId) p = gp(s.productId);

    var sAmt = (s.amt && s.amt > 0) ? s.amt : (p ? s.qty*(p.sellPrice||0) : 0);
    totalQty += s.qty;
    totalAmt += sAmt;

    // 매칭 안 된 경우 - itemName으로 집계
    if(!p){
      unmatchedQty += s.qty;
      var uname = s.itemName || ('컬럼 '+s.colVal) || '미매칭';
      var uid = 'unmatched_'+uname;
      if(!prodMap[uid]) prodMap[uid]={name:'[미매칭] '+uname, qty:0, amt:0, price:0, unmatched:true};
      prodMap[uid].qty += s.qty;
      prodMap[uid].amt += sAmt;
      return;
    }

    if(!prodMap[p.id]) prodMap[p.id]={name:p.name, qty:0, amt:0, price:p.sellPrice||0};
    prodMap[p.id].qty += s.qty;
    prodMap[p.id].amt += sAmt;

    var tier = s.qty > 0 ? getPriceTier(p.sellPrice||0) : null;
    if(tier){ priceMap[tier]=(priceMap[tier]||0)+s.qty; }

    var hour = s.hour !== undefined ? s.hour : -1;
    if(hour>=0){ hourMap[hour]=(hourMap[hour]||0)+s.qty; }
  });

  var prodRank = Object.values(prodMap).sort(function(a,b){return b.qty-a.qty;});
  var period = range.from + '_' + range.to; // rank-more ID용
  var html = '';

  // 기간 요약 카드
  var periodLabel = range.from===range.to ? range.from : range.from+' ~ '+range.to;
  html += '<div style="background:var(--bg3);border-radius:12px;padding:14px;margin-bottom:12px">';
  html += '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+periodLabel+'</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  html += '<div style="text-align:center"><div style="font-size:11px;color:var(--text2);margin-bottom:3px">총 판매량</div><div style="font-size:22px;font-weight:800;color:var(--blue)">'+fmt(totalQty)+'<span style="font-size:12px;font-weight:400">개</span></div></div>';
  html += '<div style="text-align:center"><div style="font-size:11px;color:var(--text2);margin-bottom:3px">총 매출</div><div style="font-size:22px;font-weight:800;color:var(--green)">'+fmtK(totalAmt)+'</div></div>';
  html += '</div>';
  if(unmatchedQty > 0){
    html += '<div style="margin-top:8px;padding:7px 10px;background:rgba(224,88,88,.08);border:1px solid rgba(224,88,88,.25);border-radius:8px;display:flex;align-items:center;justify-content:space-between">';
    html += '<span style="font-size:12px;color:var(--text2)">⚠️ 제품 미매칭</span>';
    html += '<span style="font-size:12px;font-weight:700;color:var(--red)">'+unmatchedQty+'개</span>';
    html += '</div>';
  }
  if(cancelledQty > 0){
    html += '<div style="margin-top:8px;padding:7px 10px;background:rgba(224,88,88,.08);border:1px solid rgba(224,88,88,.25);border-radius:8px;display:flex;align-items:center;justify-content:space-between">';
    html += '<span style="font-size:12px;color:var(--text2)">↩️ 취소 처리</span>';
    html += '<span style="font-size:12px;font-weight:700;color:var(--red)">'+cancelledQty+'개 · '+fmt(cancelledAmt)+'원</span>';
    html += '</div>';
  }
  html += '</div>';

  // 제품 판매 순위
  if(prodRank.length){
    html += '<div class="card" style="margin-bottom:12px">';
    html += '<div class="ch"><div class="ca" style="background:var(--gold)"></div><div><div class="ct">🏆 제품 판매 순위 ('+prodRank.length+'종)</div></div></div>';
    html += '<div class="cb">';
    var maxQ = prodRank[0].qty;
    var showAll = prodRank.length <= 10;
    prodRank.forEach(function(item, i){
      if(!showAll && i >= 10) return;
      var pct = Math.round(item.qty / maxQ * 100);
      var color = item.unmatched ? 'var(--text3)' : i===0 ? 'var(--gold)' : i===1 ? '#b0b0c0' : i===2 ? '#c87941' : 'var(--blue)';
      html += '<div style="margin-bottom:10px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">';
      html += '<span style="font-size:11px;color:var(--text3);min-width:20px;font-weight:700">#'+(i+1)+'</span>';
      html += '<span style="font-size:13px;flex:1;margin:0 6px">'+ item.name +'</span>';
      html += '<span style="font-size:12px;font-weight:700;color:'+color+'">'+item.qty+'개</span>';
      html += '</div>';
      html += '<div style="height:4px;background:var(--bg3);border-radius:2px">';
      html += '<div style="height:4px;width:'+pct+'%;background:'+color+';border-radius:2px"></div></div>';
      html += '</div>';
    });
    if(!showAll){
      html += '<div id="rank-more-'+period+'" style="display:none">';
      prodRank.slice(10).forEach(function(item, ii){
        var i = ii + 10;
        var pct = Math.round(item.qty / maxQ * 100);
        html += '<div style="margin-bottom:10px">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">';
        html += '<span style="font-size:11px;color:var(--text3);min-width:20px;font-weight:700">#'+(i+1)+'</span>';
        html += '<span style="font-size:13px;flex:1;margin:0 6px">'+item.name+'</span>';
        html += '<span style="font-size:12px;font-weight:700;color:var(--blue)">'+item.qty+'개</span>';
        html += '</div>';
        html += '<div style="height:4px;background:var(--bg3);border-radius:2px">';
        html += '<div style="height:4px;width:'+pct+'%;background:var(--blue);border-radius:2px"></div></div>';
        html += '</div>';
      });
      html += '</div>';
      html += '<button onclick="toggleRankFull(this)" data-rid="rank-more-'+period+'" data-total="'+prodRank.length+'" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px;font-size:12px;color:var(--text2);cursor:pointer;font-family:inherit;margin-top:4px">▼ 전체 '+prodRank.length+'종 보기</button>';
    }
    html += '</div></div>';
  }

  // 금액대별
  if(Object.keys(priceMap).length){
    html += '<div class="card" style="margin-bottom:12px">';
    html += '<div class="ch"><div class="ca" style="background:var(--blue)"></div><div><div class="ct">💰 금액대별 판매량</div></div></div>';
    html += '<div class="cb">';
    var tiers = ['~500원','501~1000원','1001~1500원','1501~2000원','2000원~'];
    var maxT = Math.max.apply(null, Object.values(priceMap).concat([1]));
    tiers.forEach(function(t){
      var q = priceMap[t]||0; if(!q) return;
      var pct = Math.round(q/maxT*100);
      html += '<div style="margin-bottom:8px">';
      html += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">';
      html += '<span style="color:var(--text2)">'+t+'</span><span style="font-weight:700;color:var(--blue)">'+q+'개</span></div>';
      html += '<div style="height:4px;background:var(--bg3);border-radius:2px"><div style="height:4px;width:'+pct+'%;background:var(--blue);border-radius:2px"></div></div>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  // 시간대별
  if(Object.keys(hourMap).length){
    html += '<div class="card" style="margin-bottom:12px">';
    html += '<div class="ch"><div class="ca" style="background:var(--green)"></div><div><div class="ct">⏰ 시간대별 판매량</div></div></div>';
    html += '<div class="cb">';
    var maxH = Math.max.apply(null, Object.values(hourMap).concat([1]));
    for(var h=0;h<24;h++){
      var q2 = hourMap[h]||0; if(!q2) continue;
      var pct2 = Math.round(q2/maxH*100);
      html += '<div style="margin-bottom:6px;display:flex;align-items:center;gap:8px">';
      html += '<span style="font-size:11px;color:var(--text3);min-width:36px;text-align:right">'+(h<10?'0':'')+h+':00</span>';
      html += '<div style="flex:1;height:14px;background:var(--bg3);border-radius:3px"><div style="height:14px;width:'+pct2+'%;background:var(--green);border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:3px"><span style="font-size:8px;color:#fff;font-weight:700">'+q2+'</span></div></div>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  // 건별 상세 카드 (모든 기간에서 표시)
  html += '<div class="card" style="margin-bottom:12px">';
  html += '<div class="ch"><div class="ca" style="background:var(--blue)"></div><div><div class="ct">📋 건별 판매 내역</div><div style="font-size:11px;color:var(--text3);margin-top:2px">환불/복구 처리 가능</div></div></div>';
  html += '<div class="cb" style="padding:0">';
  // 날짜+시간 기준 정렬
  var sorted = filtered.slice().sort(function(a,b){
    var da = a.date+(a.hour>=0?(a.hour<10?'T0'+a.hour:'T'+a.hour):'')+(a.minute>=0?(a.minute<10?'0'+a.minute:''+a.minute):'');
    var db2 = b.date+(b.hour>=0?(b.hour<10?'T0'+b.hour:'T'+b.hour):'')+(b.minute>=0?(b.minute<10?'0'+b.minute:''+b.minute):'');
    return db2.localeCompare(da);
  });
  if(!sorted.length){
    html += '<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">내역 없음</div>';
  } else {
    sorted.forEach(function(s){
      var p = s._prods ? s._prods.find(function(x){return x.id===s.productId;}) : null;
      if(!p) p = gp(s.productId);
      if(!p) return;
      var isCancelled = s.cancelled === true;
      var timeStr = '';
      if(s.hour>=0){
        timeStr = (s.hour<10?'0'+s.hour:s.hour)+':'+(s.minute>=0?(s.minute<10?'0'+s.minute:s.minute):'00');
      }
      var saleAmt = (s.amt && s.amt > 0) ? s.amt : p.sellPrice;
      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);'+(isCancelled?'opacity:0.5':'') +'">';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-size:13px;font-weight:600;color:'+(isCancelled?'var(--text3)':'var(--text1)')+'">'+p.name+(isCancelled?'<span style="font-size:10px;color:var(--red);margin-left:6px;background:rgba(224,88,88,.15);padding:1px 6px;border-radius:4px">환불</span>':'')+'</div>';
      html += '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+s.date+(timeStr?' '+timeStr:'')+'</div>';
      html += '</div>';
      html += '<div style="text-align:right;margin-right:8px">';
      html += '<div style="font-size:13px;font-weight:700;color:'+(isCancelled?'var(--text3)':'var(--blue)')+'">'+fmt(saleAmt)+'원</div>';
      html += '</div>';
      var btnBg = isCancelled ? 'rgba(122,218,154,.15)' : 'rgba(224,88,88,.15)';
      var btnColor = isCancelled ? 'var(--green)' : 'var(--red)';
      var btnBorder = isCancelled ? 'rgba(122,218,154,.3)' : 'rgba(224,88,88,.3)';
      var btnLabel = isCancelled ? '복구' : '환불';
      var sMachineKey = (s._machineName||'')+'|'+(s._devno||'');
      html += '<button onclick="toggleSaleCancel(this.dataset.id,this.dataset.loc,this.dataset.mid)" data-id="'+s.id+'" data-loc="'+(s._locId||currentLocationId||'')+'" data-mid="'+(s._machineId||currentMachineId||'')+'" style="background:'+btnBg+';color:'+btnColor+';border:1px solid '+btnBorder+';border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">'+btnLabel+'</button>';
      html += '</div>';
    });
  }
  html += '</div></div>';

  // 자판기별 세부 섹션 (자판기 2개 이상일 때만)
  if(machineDataList.length > 1){
    machineDataList.forEach(function(md){
      var mFiltered = (md.sales||[]).filter(function(s){ return s.date>=range.from && s.date<=range.to && !s.cancelled; });
      if(!mFiltered.length) return;
      var mQty=0, mAmt=0, mProdMap={};
      mFiltered.forEach(function(s){
        var p = (md.prods||[]).find(function(x){return x.id===s.productId;});
        if(!p) return;
        mQty += s.qty;
        mAmt += s.qty*(p.sellPrice||0);
        if(!mProdMap[p.id]) mProdMap[p.id]={name:p.name, qty:0};
        mProdMap[p.id].qty += s.qty;
      });
      var mRank = Object.values(mProdMap).sort(function(a,b){return b.qty-a.qty;});
      html += '<div class="card" style="margin-bottom:12px">';
      html += '<div class="ch"><div class="ca" style="background:var(--blue)"></div><div>';
      html += '<div class="ct">📟 '+(md.name||md.devno)+'</div>';
      html += '<div style="font-size:11px;color:var(--text3)">단말기: '+md.devno+' · '+mQty+'개 · '+fmtK(mAmt)+'</div>';
      html += '</div></div><div class="cb">';
      mRank.forEach(function(item, i){
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">';
        html += '<span style="font-size:12px;color:var(--text3);min-width:24px">#'+(i+1)+'</span>';
        html += '<span style="font-size:13px;flex:1">'+item.name+'</span>';
        html += '<span style="font-size:13px;font-weight:700;color:var(--blue)">'+item.qty+'개</span>';
        html += '</div>';
      });
      html += '</div></div>';
    });
  }

  panel.innerHTML = html;
}

function getPriceTier(price){
  if(price<=500) return '~500원';
  if(price<=1000) return '501~1000원';
  if(price<=1500) return '1001~1500원';
  if(price<=2000) return '1501~2000원';
  return '2000원~';
}

function fmtK(v){
  return fmt(v)+'원';
}

function setSalesSort(s,el){
  // 하위 호환 (기존 코드 호출 대비)
  renderSalesStats();
}

// 컬럼 번호로 제품 찾기 (25 → "25" 포함 여부 체크)
function colMatch(p, col){
  var cols = Array.isArray(p.column) ? p.column : (p.column ? [p.column] : []);
  return cols.some(function(c){
    c = String(c).trim();
    if(c === col) return true;
    var rm = c.match(/^(\d+)~(\d+)$/);
    if(rm){ var n=parseInt(col); return n>=parseInt(rm[1])&&n<=parseInt(rm[2]); }
    return false;
  });
}

function nameMatch(p, itemName){
  if(!itemName) return false;
  var pn = (p.name||'').trim();
  var it = itemName.trim();
  return pn === it || pn.indexOf(it) >= 0 || it.indexOf(pn) >= 0;
}

// 상품명 + 컬럼 복합 매칭
// 1순위: 상품명 일치 + 컬럼 일치
// 2순위: 상품명만 일치
// 3순위: 컬럼만 일치 (fallback)
function findProduct(colStr, itemName, prods){
  prods = prods || D.products;
  var col = String(colStr||'').trim();

  // 1순위: 상품명 + 컬럼 둘 다 일치
  if(itemName && col){
    var both = prods.find(function(p){ return nameMatch(p, itemName) && colMatch(p, col); });
    if(both) return both;
  }
  // 2순위: 상품명만 일치
  if(itemName){
    var byName = prods.find(function(p){ return nameMatch(p, itemName); });
    if(byName) return byName;
  }
  // 3순위: 컬럼만 일치
  if(col){
    var byCol = prods.find(function(p){ return colMatch(p, col); });
    if(byCol) return byCol;
  }
  return null;
}

function findProductByColumn(colStr){ return findProduct(colStr, '', D.products); }

var salesPreviewRows = []; // 파싱된 행 임시 저장
