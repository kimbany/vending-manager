// ─── 2칸 제품 설정 ──────────────────────────────────────────────────────────

// Firebase: users/{uid}/doubleColumns/{deviceNo} = [{productCode, productName, colStart, colEnd}]

function openDoubleColumnModal(){
  if(!currentUser) return;

  var mc = vmMachineList[vmMachineIdx];
  if(!mc){ showToast('자판기를 먼저 선택해주세요'); return; }

  var devno = mc.devno||'';
  var colData = mc._vmmsColumns||{};
  var columns = colData.columns||[];
  if(!Array.isArray(columns)) columns = Object.values(columns);

  // 기존 2칸 설정 표시
  renderDoubleColumnList(devno);

  // 2칸 설정 데이터 로드 후 후보 분석
  db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno).once('value').then(function(snap){
    var doubleItems = snap.val()||[];
    if(!Array.isArray(doubleItems)) doubleItems = Object.values(doubleItems);
    renderDoubleColumnCandidates(devno, columns, doubleItems);
  });

  document.getElementById('dc-msg').textContent = '';
  openModal('double-col-modal');
}

function renderDoubleColumnCandidates(devno, columns, doubleItems){
  var el = document.getElementById('dc-candidates');
  if(!el) return;

  // 사용 중인 컬럼 번호 맵: colNo → {productCode, productName}
  var usedCols = {};
  columns.forEach(function(c){
    var colNo = String(c.columnNo||'').trim();
    if(colNo) usedCols[colNo] = {productCode: c.productCode||'', productName: c.productName||''};
  });

  // 이미 2칸 설정된 컬럼 번호 Set
  var doubleSet = {};
  doubleItems.forEach(function(d){
    doubleSet[String(d.colStart)] = true;
    doubleSet[String(d.colEnd)] = true;
  });

  // 각 제품별로 가능한 확장 탐색
  // 같은 층(같은 십의 자리)의 인접 컬럼만 허용
  var candidates = []; // [{productCode, productName, colNo, direction, colStart, colEnd, label}]
  var seenPairs = {}; // 중복 방지

  columns.forEach(function(c){
    var colNo = String(c.columnNo||'').trim();
    if(!colNo) return;
    var num = parseInt(colNo);
    if(isNaN(num) || colNo.length < 2) return;

    // 이미 2칸 설정된 컬럼은 건너뜀
    if(doubleSet[colNo]) return;

    var floor = parseInt(colNo.slice(0,-1));
    var slot = parseInt(colNo.slice(-1));
    var code = c.productCode||'';
    var name = c.productName||'';

    // 위쪽 (slot - 1, 같은 층)
    if(slot > 0){
      var prevCol = String(floor) + String(slot - 1);
      if(!usedCols[prevCol] && !doubleSet[prevCol]){
        var key = prevCol+'~'+colNo;
        if(!seenPairs[key]){
          seenPairs[key] = true;
          candidates.push({
            productCode: code, productName: name, colNo: colNo,
            direction: 'up', colStart: parseInt(prevCol), colEnd: num,
            label: prevCol+'~'+colNo+' 병합'
          });
        }
      }
    }

    // 아래쪽 (slot + 1, 같은 층)
    if(slot < 7){
      var nextCol = String(floor) + String(slot + 1);
      if(!usedCols[nextCol] && !doubleSet[nextCol]){
        var key = colNo+'~'+nextCol;
        if(!seenPairs[key]){
          seenPairs[key] = true;
          candidates.push({
            productCode: code, productName: name, colNo: colNo,
            direction: 'down', colStart: num, colEnd: parseInt(nextCol),
            label: colNo+'~'+nextCol+' 병합'
          });
        }
      }
    }
  });

  if(!candidates.length){
    el.innerHTML = '<div style="text-align:center;padding:16px;background:var(--bg3);border-radius:12px;color:var(--text3);font-size:13px">확장 가능한 2칸 조합이 없습니다</div>';
    return;
  }

  // 제품별로 그룹핑
  var grouped = {};
  candidates.forEach(function(c){
    var key = c.productCode+'_'+c.colNo;
    if(!grouped[key]) grouped[key] = {productCode:c.productCode, productName:c.productName, colNo:c.colNo, options:[]};
    grouped[key].options.push(c);
  });

  var groupKeys = Object.keys(grouped);
  var html = '<div style="font-size:14px;font-weight:700;margin-bottom:10px">2칸 확장 가능한 제품 ('+groupKeys.length+')</div>';

  groupKeys.forEach(function(key, gi){
    var g = grouped[key];
    html += '<div id="dc-candidate-'+gi+'" style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">';
    html += '<div style="font-size:14px;font-weight:600">'+sanitize(g.productName)+'</div>';
    html += '<button onclick="skipDoubleColumnCandidate('+gi+')" '+
      'style="background:rgba(150,150,150,.1);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--text3);cursor:pointer;font-family:inherit">건너뛰기</button>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text3);margin-bottom:8px">현재 컬럼: '+g.colNo+'</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';

    g.options.forEach(function(opt){
      var icon = '⬛';
      html += '<button onclick="addDoubleColumnAuto(\''+devno+'\',\''+opt.productCode+'\',\''+sanitize(opt.productName)+'\','+opt.colStart+','+opt.colEnd+')" '+
        'style="flex:1;min-width:120px;background:rgba(0,100,255,.08);border:1px solid rgba(0,100,255,.25);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;color:var(--blue);cursor:pointer;font-family:inherit">'+
        icon+' '+opt.label+'</button>';
    });

    html += '</div></div>';
  });

  el.innerHTML = html;
}

function skipDoubleColumnCandidate(idx){
  var el = document.getElementById('dc-candidate-'+idx);
  if(el) el.style.display = 'none';
}

function addDoubleColumnAuto(devno, productCode, productName, colStart, colEnd){
  var msg = document.getElementById('dc-msg');
  msg.style.color='var(--text2)'; msg.textContent='저장 중...';

  var ref = db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno);
  ref.once('value').then(function(snap){
    var items = snap.val()||[];
    if(!Array.isArray(items)) items = Object.values(items);

    // 중복 체크
    var dup = items.find(function(it){ return it.colStart==colStart && it.colEnd==colEnd; });
    if(dup){ msg.style.color='var(--red)'; msg.textContent='이미 설정된 범위입니다'; return; }

    // 겹침 체크
    var overlap = items.find(function(it){
      return (colStart >= it.colStart && colStart <= it.colEnd) || (colEnd >= it.colStart && colEnd <= it.colEnd);
    });
    if(overlap){ msg.style.color='var(--red)'; msg.textContent='컬럼 '+overlap.colStart+'~'+overlap.colEnd+'과 겹칩니다'; return; }

    items.push({
      productCode: productCode,
      productName: productName,
      colStart: colStart,
      colEnd: colEnd
    });

    return ref.set(items);
  }).then(function(){
    msg.style.color='var(--green)'; msg.textContent='추가 완료';
    renderDoubleColumnList(devno);

    // 후보 목록 새로고침
    var mc = vmMachineList[vmMachineIdx];
    var colData = mc._vmmsColumns||{};
    var columns = colData.columns||[];
    if(!Array.isArray(columns)) columns = Object.values(columns);
    db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno).once('value').then(function(snap2){
      var doubleItems = snap2.val()||[];
      if(!Array.isArray(doubleItems)) doubleItems = Object.values(doubleItems);
      renderDoubleColumnCandidates(devno, columns, doubleItems);
    });

    // 배치도 새로고침
    if(typeof renderMachine==='function') renderMachine();
    setTimeout(function(){ msg.textContent=''; }, 2000);
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent='저장 실패';
  });
}

function renderDoubleColumnList(devno){
  var el = document.getElementById('dc-current-list');
  if(!el) return;
  db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno).once('value').then(function(snap){
    var items = snap.val()||[];
    if(!Array.isArray(items)) items = Object.values(items);
    if(!items.length){
      el.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text3);font-size:13px">설정된 2칸 제품 없음</div>';
      return;
    }
    el.innerHTML = '<div style="font-size:13px;font-weight:700;margin-bottom:8px">현재 2칸 제품</div>'+
      items.map(function(item, i){
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">'+
          '<div>'+
            '<div style="font-size:14px;font-weight:600">'+sanitize(item.productName||'')+'</div>'+
            '<div style="font-size:12px;color:var(--text3)">컬럼: '+item.colStart+'~'+item.colEnd+'</div>'+
          '</div>'+
          '<button onclick="removeDoubleColumn(\''+devno+'\','+i+')" style="background:rgba(255,90,95,.1);border:1px solid rgba(255,90,95,.3);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--red);cursor:pointer;font-family:inherit">해제</button>'+
        '</div>';
      }).join('');
  });
}

function removeDoubleColumn(devno, idx){
  if(!confirm('2칸 설정을 해제할까요?')) return;
  var ref = db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno);
  ref.once('value').then(function(snap){
    var items = snap.val()||[];
    if(!Array.isArray(items)) items = Object.values(items);
    items.splice(idx, 1);
    return ref.set(items);
  }).then(function(){
    showToast('해제 완료');
    renderDoubleColumnList(devno);

    // 후보 목록도 새로고침
    var mc = vmMachineList[vmMachineIdx];
    var colData = mc._vmmsColumns||{};
    var columns = colData.columns||[];
    if(!Array.isArray(columns)) columns = Object.values(columns);
    db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno).once('value').then(function(snap2){
      var doubleItems = snap2.val()||[];
      if(!Array.isArray(doubleItems)) doubleItems = Object.values(doubleItems);
      renderDoubleColumnCandidates(devno, columns, doubleItems);
    });

    if(typeof renderMachine==='function') renderMachine();
  });
}
