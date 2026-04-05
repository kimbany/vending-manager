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
  if(mc._vmmsColumns){
    _renderMachineFromVmms(mc);
  } else {
    renderMachineView(mc, [], []);
  }
}

function renderMachine(){
  if(!currentUser) return;

  // VMMS 데이터 로드
  Promise.all([
    db.ref('users/'+currentUser.uid+'/vmmsMachines').once('value'),
    db.ref('users/'+currentUser.uid+'/vmmsColumns').once('value'),
    db.ref('users/'+currentUser.uid+'/locations').once('value')
  ]).then(function(results){
    var machData = results[0].val();
    var colData = results[1].val();
    var locData = results[2].val();

    var vmmsMachines = (machData && machData.items) ? machData.items : [];
    var vmmsColumns = (colData && colData.machines) ? colData.machines : {};
    if(!Array.isArray(vmmsMachines)) vmmsMachines = Object.values(vmmsMachines);

    vmMachineList = [];

    if(vmmsMachines.length > 0){
      // VMMS 데이터 기반
      vmmsMachines.forEach(function(vm){
        var devno = vm.deviceNo || '';
        var model = '';
        var locId = '', machineId = '';
        // locations에서 모델명 + locId/machineId 찾기
        if(locData){
          Object.keys(locData).forEach(function(lid){
            var loc = locData[lid];
            Object.keys(loc.machines||{}).forEach(function(mid){
              var m = loc.machines[mid];
              var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
              if(devnos.indexOf(devno)>=0){ model = m.model||''; locId = lid; machineId = mid; }
            });
          });
        }
        var colMatch = vmmsColumns[devno] || {};
        console.log('[자판기현황] devno:'+devno+' 컬럼데이터:'+(colMatch.columns?colMatch.columns.length:0)+'개 vmmsColumns키:', Object.keys(vmmsColumns));
        var machineOrder = 99999;
        if(locId && machineId && locData[locId] && locData[locId].machines && locData[locId].machines[machineId]){
          var mo = locData[locId].machines[machineId].order;
          if(typeof mo === 'number') machineOrder = mo;
        }
        vmMachineList.push({
          name: vm.machineName||'', devno: devno, model: model,
          locId: locId, machineId: machineId,
          _vmmsColumns: colMatch, _order: machineOrder
        });
      });
      // VMMS 기반 목록도 order 순서로 정렬 (0은 falsy이므로 typeof 체크)
      vmMachineList.sort(function(a,b){
        var oa = typeof a._order === 'number' ? a._order : 99999;
        var ob = typeof b._order === 'number' ? b._order : 99999;
        return oa - ob;
      });
    } else if(locData){
      // VMMS 없으면 기존 locations 기반 (fallback) - order 순서 적용
      Object.keys(locData).forEach(function(locId){
        var loc = locData[locId];
        var machines = loc.machines||{};
        var mKeys = (typeof sortedMachineKeys === 'function') ? sortedMachineKeys(machines) : Object.keys(machines);
        mKeys.forEach(function(mid){
          var m = machines[mid];
          var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
          vmMachineList.push({
            machineId:mid, locId:locId,
            name:m.name, devno:devnos[0]||'', model:m.model||'',
            _vmmsColumns: vmmsColumns[devnos[0]]||{}
          });
        });
      });
    }

    var nav = document.getElementById('vm-machine-nav');
    nav.style.display = vmMachineList.length > 1 ? 'flex' : 'none';

    if(vmMachineList.length === 0){
      document.getElementById('vm-grid').innerHTML = '<div class="empty"><div class="ei">🏪</div><div class="et">자판기 데이터가 없습니다</div></div>';
      return;
    }

    // order 순서 기준 첫 번째 자판기부터 표시 (인덱스 0 = 가장 높은 순위)
    vmMachineIdx = 0;
    var mc = vmMachineList[vmMachineIdx];
    _renderMachineFromVmms(mc);
  });
}

function _renderMachineFromVmms(mc){
  var colData = mc._vmmsColumns || {};
  var columns = colData.columns || [];
  if(!Array.isArray(columns)) columns = Object.values(columns);

  // 2칸 제품 데이터 로드
  var devno = mc.devno||'';
  db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno).once('value').then(function(dcSnap){
    var doubleItems = dcSnap.val()||[];
    if(!Array.isArray(doubleItems)) doubleItems = Object.values(doubleItems);
    _buildMachineView(mc, columns, doubleItems);
  });
}

function _buildMachineView(mc, columns, doubleItems){
  // VMMS 컬럼 데이터를 기존 renderMachineView 형식으로 변환
  var prods = [];
  var seen = {};

  columns.forEach(function(c){
    var code = c.productCode||'';
    var name = c.productName||'';
    var colNo = c.columnNo||'';
    var id = code || name;

    if(!seen[id]){
      seen[id] = {id:id, name:name, column:[], deviceNo:mc.devno, productCode:code};
      prods.push(seen[id]);
    }
    // 2칸 제품인지 확인 - 현재 컬럼이 속한 2칸 범위 찾기
    var colNum = parseInt(colNo);
    var dcMatch = doubleItems.find(function(d){
      return d.productCode === code && colNum >= d.colStart && colNum <= d.colEnd;
    });
    if(dcMatch){
      // 2칸 제품: "시작~끝" 형식으로 저장 (이미 있으면 건너뜀)
      var rangeCol = dcMatch.colStart+'~'+dcMatch.colEnd;
      if(seen[id].column.indexOf(rangeCol) < 0){
        // 개별 컬럼 대신 범위로 교체
        seen[id].column = seen[id].column.filter(function(c){ return c!=String(dcMatch.colStart) && c!=String(dcMatch.colEnd); });
        seen[id].column.push(rangeCol);
      }
    } else {
      if(colNo) seen[id].column.push(colNo);
    }
  });

  // VMMS 제품 ID → D.products ID 매칭 (이름 기준) 및 속성 병합
  // 재고는 gq()로 D.inventory에서 직접 조회 (별도 inv 배열 불필요)
  var needsSave = false;
  prods.forEach(function(vmProd){
    var origId = vmProd.id; // 원본 VMMS 코드
    var dProd = D.products.find(function(ep){ return ep.name.trim() === vmProd.name.trim(); });
    if(dProd){
      vmProd.id = dProd.id;
      if(dProd.sellPrice!=null) vmProd.sellPrice = dProd.sellPrice;
      if(dProd.buyPrice!=null) vmProd.buyPrice = dProd.buyPrice;
      if(dProd.unitPrice!=null) vmProd.unitPrice = dProd.unitPrice;
      if(dProd.totalQty!=null) vmProd.totalQty = dProd.totalQty;
      if(dProd.marginAmt!=null) vmProd.marginAmt = dProd.marginAmt;
      if(dProd.marginRate!=null) vmProd.marginRate = dProd.marginRate;
      // D.inventory에 VMMS 코드로 저장된 항목 → D.products ID로 마이그레이션
      if(origId !== dProd.id){
        var vmmsIdx = D.inventory.findIndex(function(x){ return x.productId === origId; });
        if(vmmsIdx >= 0){
          var dprodEntry = D.inventory.find(function(x){ return x.productId === dProd.id; });
          if(dprodEntry){
            if(D.inventory[vmmsIdx].qty > 0) dprodEntry.qty = D.inventory[vmmsIdx].qty;
            D.inventory.splice(vmmsIdx, 1);
          } else {
            D.inventory[vmmsIdx].productId = dProd.id;
          }
          D.inventoryLogs.forEach(function(l){
            if(l.productId === origId) l.productId = dProd.id;
          });
          needsSave = true;
        }
      }
    }
  });
  if(needsSave) save();
  renderMachineView(mc, prods, null);
}

// 현재 보고 있는 자판기 데이터 캐시 (openProdDetail에서 사용)
var _vmViewProds = [];
var _vmViewInv = [];

function renderMachineView(mc, prods, inv){
  // inv는 더 이상 사용하지 않음 — gq()로 D.inventory 직접 조회
  // 현재 보고 있는 자판기의 products 캐시
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
  function getQLocal(pid){ return gq(pid); }

  var allSlots=[];
  filteredProds.filter(function(p){return !p.discontinued;}).forEach(function(p){
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

  var html='<div class="vmh"><img src="img/logo.png" style="width:36px;height:36px;vertical-align:middle;margin-right:6px"/>VENDING MACHINE</div>';
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
  function getQ(pid){ return gq(pid); }

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

  var listItems=[], discontinuedItems=[];
  filteredProds.forEach(function(p){
    var cols=Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    if(!cols.length && !p.discontinued) return;
    var q=getQ(p.id);
    var labels=cols.map(function(c){return String(c).trim();});
    var item={id:p.id, name:p.name, labels:labels, q:q, discontinued:p.discontinued};
    if(p.discontinued) discontinuedItems.push(item);
    else listItems.push(item);
  });
  listItems.sort(function(a,b){return (a.labels[0]||'').localeCompare(b.labels[0]||'');});

  var html = listItems.length
    ? listItems.map(function(item){
        var q=item.q;
        var tagHtml=item.labels.map(function(l){
          return '<span style="background:rgba(0,100,255,.08);border:1px solid rgba(0,100,255,.2);border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700;color:var(--blue)">'+l+'</span>';
        }).join(' ');
        return '<div class="item" style="flex-wrap:wrap;gap:6px;cursor:pointer" onclick="openProdDetail(this.dataset.pid)" data-pid="'+item.id+'">'+
          '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1">'+tagHtml+
          '<span style="font-size:13px;font-weight:600">'+item.name+'</span></div>'+
          '<span style="color:'+(q<=5?'var(--red)':'var(--green)')+';font-weight:700;white-space:nowrap">'+q+'개</span></div>';
      }).join('')
    : '<div class="empty"><div class="ei">🏪</div><div class="et">컬럼 배정된 제품 없음</div></div>';

  // 판매중단 제품 리스트
  if(discontinuedItems.length){
    html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:8px">🚫 판매중단 제품 ('+discontinuedItems.length+')</div>';
    discontinuedItems.forEach(function(item){
      html += '<div class="item" style="flex-wrap:wrap;gap:6px;opacity:.6;cursor:pointer" onclick="openProdDetail(this.dataset.pid)" data-pid="'+item.id+'">'+
        '<div style="flex:1"><span style="font-size:13px;font-weight:600">'+item.name+'</span></div>'+
        '<span style="font-size:11px;background:rgba(255,90,95,.1);color:var(--red);border-radius:4px;padding:2px 6px;font-weight:600">중단</span></div>';
    });
    html += '</div>';
  }

  listEl.innerHTML = html;
}
