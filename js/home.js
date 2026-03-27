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

  // 현재 자판기 이름 표시
  var sel = document.getElementById('machine-select');
  var machineName = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
  var mnEl = document.getElementById('home-machine-name');
  if(mnEl) mnEl.textContent = machineName || '';

  // ── 판매 현황 (현재 선택된 자판기 기준) ──
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
    ? top3.map(function(x,i){ return '<div class="ti" style="border:1px solid var(--border)"><span style="font-size:20px">'+em[i]+'</span><div style="flex:1"><div class="in">'+x.p.name+'</div></div><span style="font-weight:800;font-size:16px;color:var(--text)">'+x.q+'개</span></div>'; }).join('')
    : '<div class="empty"><div class="ei">📦</div><div class="et">판매 데이터 없음</div></div>';

  // ── 전체 자판기 재고 부족 (자판기별 각각 표시) ──
  renderAllMachineLowStock();
}

function renderAllMachineLowStock(){
  var el = document.getElementById('home-all-low-list');
  if(!el || !currentUser) return;

  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    if(!snap.exists()||!snap.val()){
      // locations 없음 → 현재 D 기준
      var lt = typeof getLowStockThreshold==='function' ? getLowStockThreshold() : 5;
      var low = D.inventory.filter(function(i){return i.qty<=lt;})
        .map(function(i){return {i:i,p:gp(i.productId)};}).filter(function(x){return x.p;});
      el.innerHTML = low.length
        ? low.map(function(x){
            var cl=Array.isArray(x.p.column)?x.p.column.join(', '):(x.p.column||'-');
            return '<div class="li"><div><div class="in">'+x.p.name+'</div><div class="is">컬럼: '+cl+'</div></div><span class="badge '+(x.i.qty===0?'br':'bo')+'">'+x.i.qty+'개</span></div>';
          }).join('')
        : '<div class="empty"><div class="ei">✅</div><div class="et">재고 부족 없음</div></div>';
      return;
    }
    // 모든 위치 > 자판기 순회
    var locs = snap.val();
    var promises = [];
    Object.keys(locs).forEach(function(locId){
      var loc=locs[locId];
      Object.keys(loc.machines||{}).forEach(function(mid){
        var m=loc.machines[mid];
        promises.push(
          db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+mid+'/appData').once('value').then(function(ds){
            return {locName:loc.name, machineName:m.name, data:ds.val()||{}};
          })
        );
      });
    });
    Promise.all(promises).then(function(results){
      var totalLow=0;
      var cards=[];
      results.forEach(function(md){
        var inv=md.data.inventory||[]; var prods=md.data.products||[];
        function getP(pid){ return prods.find(function(p){return p.id===pid;}); }
        var lt2 = typeof getLowStockThreshold==='function' ? getLowStockThreshold() : 5;
        var low=inv.filter(function(i){return i.qty<=lt2;}).map(function(i){return {i:i,p:getP(i.productId)};}).filter(function(x){return x.p;});
        if(!low.length) return;
        totalLow+=low.length;
        var itemsHtml='';
        low.forEach(function(x){
          var cl=Array.isArray(x.p.column)?x.p.column.join(', '):(x.p.column||'-');
          itemsHtml+='<div class="li"><div><div class="in">'+x.p.name+'</div><div class="is">컬럼: '+cl+'</div></div><span class="badge '+(x.i.qty===0?'br':'bo')+'">'+x.i.qty+'개</span></div>';
        });
        cards.push('<div class="low-stock-card"><div style="font-size:11px;font-weight:700;color:var(--gold);padding:0 0 6px">📍 '+md.locName+' · 🏪 '+md.machineName+' <span style="color:var(--red)">('+low.length+')</span></div>'+itemsHtml+'</div>');
      });
      if(!totalLow){
        el.innerHTML='<div class="empty"><div class="ei">✅</div><div class="et">모든 자판기 재고 부족 없음</div></div>';
      } else {
        el.innerHTML='<div class="low-stock-grid">'+cards.join('')+'</div>';
      }
    });
  });
}
