// ─── 자판기 ───────────────────────────────────────────────────────────────────
// 컬럼 형식:
//   "47"    = 4층 7번 칸 (1칸)
//   "45~46" = 4층 5~6번 칸 (2칸 span)
//   "45,46" = 4층 5번, 4층 6번 (각각 별개)
// 가로: 0~7 (8칸), 세로: 층

function parseCol(col){
  // 컬럼 배치 그리드 표시 전용 (11 → 1층 1번 슬롯)
  // 매칭/비교는 숫자 그대로 사용
  if(!col) return null;
  col = String(col).trim();
  // 범위형: "45~46"
  var rangeMatch = col.match(/^(\d+)~(\d+)$/);
  if(rangeMatch){
    var a = rangeMatch[1], b = rangeMatch[2];
    if(a.length < 2) return {floor:1, slot:parseInt(a), span:parseInt(b)-parseInt(a)+1, label:col};
    var floorA = parseInt(a.slice(0,-1)), slotA = parseInt(a.slice(-1));
    var slotB = parseInt(b.slice(-1));
    if(isNaN(floorA)||isNaN(slotA)||isNaN(slotB)) return null;
    return {floor:floorA, slot:slotA, span:slotB-slotA+1, label:col};
  }
  // 단일형 - 2자리 이상만 층/슬롯으로 분리
  var n = parseInt(col);
  if(isNaN(n)) return null;
  if(col.length < 2) return null; // 1자리는 그리드에 표시 안 함
  var f = parseInt(col.slice(0,-1));
  var s = parseInt(col.slice(-1));
  if(isNaN(f)||isNaN(s)) return null;
  return {floor:f, slot:s, span:1, label:col};
}

// 단말기 네비게이션 상태
var vmMachineList = []; // [{machineId, locId, name, devno, model}]
var vmMachineIdx  = 0;

function navMachine(dir){
  if(!vmMachineList.length) return;
  vmMachineIdx = (vmMachineIdx + dir + vmMachineList.length) % vmMachineList.length;
  var mc = vmMachineList[vmMachineIdx];
  // 해당 단말기 데이터 로드
  var appRef = db.ref('users/'+currentUser.uid+'/locations/'+mc.locId+'/machines/'+mc.machineId+'/appData');
  appRef.once('value').then(function(snap){
    var val = snap.val()||{};
    var mProds = val.products||[];
    var mInv   = val.inventory||[];
    // 제품/재고를 현재 컨텍스트에도 저장 (클릭 이벤트 대응)
    mc._prods = mProds;
    mc._inv = mInv;
    renderMachineView(mc, mProds, mInv);
  });
}

function renderMachine(){
  // 위치의 모든 단말기 로드
  if(!currentUser){ renderMachineView(null, D.products, D.inventory); return; }
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    vmMachineList = [];
    if(snap.exists()){
      snap.forEach(function(locSnap){
        var loc = locSnap.val();
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m = loc.machines[mid];
          var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
          vmMachineList.push({
            machineId:mid, locId:locSnap.key,
            name:m.name, devno:devnos[0]||'', model:m.model||''
          });
        });
      });
    }
    var nav = document.getElementById('vm-machine-nav');
    if(vmMachineList.length > 1){
      nav.style.display='flex';
    } else {
      nav.style.display='none';
    }
    if(vmMachineList.length === 0){
      renderMachineView(null, D.products, D.inventory);
    } else {
      // 현재 선택된 자판기 찾기
      var found = -1;
      vmMachineList.forEach(function(mc, i){
        if(mc.machineId === currentMachineId) found = i;
      });
      vmMachineIdx = found >= 0 ? found : 0;
      var mc = vmMachineList[vmMachineIdx];
      var appRef = db.ref('users/'+currentUser.uid+'/locations/'+mc.locId+'/machines/'+mc.machineId+'/appData');
      appRef.once('value').then(function(snap){
        var val = snap.val()||{};
        renderMachineView(mc, val.products||[], val.inventory||[]);
      });
    }
  });
}

// 현재 보고 있는 자판기 데이터 캐시 (openProdDetail에서 사용)
var _vmViewProds = [];
var _vmViewInv = [];

function renderMachineView(mc, prods, inv){
  // 현재 보고 있는 자판기의 products/inventory 캐시
  _vmViewProds = prods || [];
  _vmViewInv = inv || [];

  // 네비게이터 업데이트
  if(mc){
    mc._prods = prods;
    mc._inv = inv;
    var nameEl = document.getElementById('vm-machine-name');
    var devnoEl = document.getElementById('vm-machine-devno');
    if(nameEl) nameEl.textContent = (mc.name||'') + (mc.model ? ' · '+mc.model : '');
    if(devnoEl) devnoEl.textContent = '단말기: '+mc.devno + (vmMachineList.length>1 ? ' ('+( vmMachineIdx+1)+'/'+vmMachineList.length+')' : '');
  }

  // 모델명에 따라 레이아웃 결정
  var model = mc ? (mc.model||'').toUpperCase() : '';
  var isLVM482 = model.indexOf('LVM-482') >= 0 || model.indexOf('LVM482') >= 0;

  if(!isLVM482 && mc && mc.model){
    // 모델 있지만 LVM-482 아닌 경우 - 업데이트 중 메시지 + 제품 목록만
    var gridEl = document.getElementById('vm-grid');
    gridEl.innerHTML = '<div style="text-align:center;padding:24px;background:var(--bg3);border-radius:12px;margin-bottom:8px">'+
      '<div style="font-size:32px;margin-bottom:8px">🔧</div>'+
      '<div style="font-size:14px;font-weight:700;color:var(--text)">'+mc.model+'</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:4px">컬럼 레이아웃 업데이트 중...</div>'+
    '</div>';
    renderVmList(mc, prods, inv);
    return;
  }

  // LVM-482 또는 모델 없는 경우 - 기존 컬럼 레이아웃
  var TOTAL_SLOTS = 8;

  // 제품 슬롯 파싱
  // 단말기번호 기준 제품 필터
  var devno = mc ? mc.devno : '';
  var filteredProds = (prods||[]).filter(function(p){
    if(!devno) return true;
    return !p.deviceNo || p.deviceNo === devno;
  });
  function getQLocal(pid){ var i=(inv||[]).find(function(x){return x.productId===pid;}); return i?i.qty:0; }

  var allSlots=[];
  filteredProds.forEach(function(p){
    var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    cols.forEach(function(c){
      var pc=parseCol(c);
      if(pc) allSlots.push({floor:pc.floor,slot:pc.slot,span:pc.span||1,prod:p,label:pc.label||c});
    });
  });

  // 층 목록 (내림차순)
  var floorSet={};
  allSlots.forEach(function(s){floorSet[s.floor]=true;});
  var floors=Object.keys(floorSet).map(Number).sort(function(a,b){return b-a;});
  if(!floors.length) floors=[6,5,4,3,2,1];

  // 이 층의 2칸짜리 span 목록으로 grid-template 계산
  // 1칸=1fr, 2칸span=(span값)fr — 모든 층 동일하게 repeat(8,1fr) 사용
  // span된 칸은 grid-column:span N 으로 처리
  var GRID = 'repeat('+TOTAL_SLOTS+',1fr)';

  var html='<div class="vmh"><img src="img/logo.png" style="width:18px;height:18px;vertical-align:middle;margin-right:6px"/>VENDING MACHINE</div>';
  // overflow 방지 wrapper
  html+='<div style="overflow:hidden;width:100%">';

  floors.forEach(function(floor){
    var floorSlots=allSlots.filter(function(s){return s.floor===floor;});

    html+='<div style="display:grid;grid-template-columns:'+GRID+';gap:2px;margin-bottom:3px">';

    var skipSlots={};
    for(var s=0;s<TOTAL_SLOTS;s++){
      if(skipSlots[s]) continue;

      var entry=floorSlots.find(function(x){return x.slot===s;});
      var p=entry?entry.prod:null;
      var span=entry?entry.span:1;
      var q=p?getQLocal(p.id):0;
      var cl=!p?'':q<=5?' ls':' hp';

      var spanStyle='';
      if(span>1){
        spanStyle='grid-column:span '+span+';';
        for(var sk=s+1;sk<s+span;sk++) skipSlots[sk]=true;
      }

      var colLabel = entry ? entry.label : floor+String(s);
      var cellH = p ? '44px' : '36px';
      var clickAttr = p ? ' onclick="openProdDetail(this.dataset.pid)" data-pid="'+p.id+'" ' : ' ';
      html+='<div class="vmc'+cl+'"'+clickAttr+'style="min-height:'+cellH+';min-width:0;overflow:hidden;'+(p?'cursor:pointer;':'')+spanStyle+(p?'':';opacity:0.3')+'">';
      // 컬럼 번호만 내부에 표시
      html+='<div style="font-size:11px;font-weight:700;color:'+(p?(q<=5?'var(--red)':'var(--text)'):'var(--text3)')+'">'+colLabel+'</div>';
      html+='</div>';
    }
    html+='</div>';
  });

  html+='</div>'; // overflow wrapper 닫기
  html+='<div class="vml" style="margin-top:8px"><div class="vmli"><div class="vmld" style="border:1px solid rgba(126,200,227,.4);background:rgba(126,200,227,.1)"></div>정상</div><div class="vmli"><div class="vmld" style="border:1px solid rgba(224,88,88,.4);background:rgba(224,88,88,.1)"></div>부족(≤5)</div><div class="vmli"><div class="vmld" style="border:1px solid var(--border);background:var(--bg)"></div>비어있음</div></div>';
  document.getElementById('vm-grid').innerHTML=html;
  renderVmList(mc, prods, inv);
}

function renderVmList(mc, prods, inv){
  function getQ(pid){ var i=(inv||[]).find(function(x){return x.productId===pid;}); return i?i.qty:0; }

  var devno = mc ? mc.devno : '';

  // 단말기번호 기준으로 제품 필터 (없으면 전체)
  var filteredProds = prods.filter(function(p){
    if(!devno) return true;
    // p.deviceNo가 현재 단말기번호와 일치하거나 미지정
    return !p.deviceNo || p.deviceNo === devno;
  });

  var listEl = document.getElementById('vm-list');
  var subEl  = document.getElementById('vm-list-sub');
  if(subEl) subEl.textContent = devno ? '단말기: '+devno : '제품 눌러서 상세 보기';

  var listItems=[];
  filteredProds.forEach(function(p){
    var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    if(!cols.length) return;
    var q=getQ(p.id);
    var labels=cols.map(function(c){return String(c).trim();});
    listItems.push({id:p.id, name:p.name, labels:labels, q:q});
  });
  listItems.sort(function(a,b){return (a.labels[0]||'').localeCompare(b.labels[0]||'');});

  listEl.innerHTML = listItems.length
    ? listItems.map(function(item){
        var q=item.q;
        var tagHtml=item.labels.map(function(l){
          return '<span style="background:rgba(232,184,109,.15);border:1px solid rgba(232,184,109,.4);border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700;color:var(--blue)">'+l+'</span>';
        }).join(' ');
        return '<div class="item" style="flex-wrap:wrap;gap:6px;cursor:pointer" onclick="openProdDetail(this.dataset.pid)" data-pid="'+item.id+'">'+
          '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1">'+tagHtml+
          '<span style="font-size:13px;font-weight:600">'+item.name+'</span></div>'+
          '<span style="color:'+(q<=5?'var(--red)':'var(--green)')+';font-weight:700">'+q+'개</span></div>';
      }).join('')
    : '<div class="empty"><div class="ei">🏪</div><div class="et">컬럼 배정된 제품 없음</div></div>';
}
