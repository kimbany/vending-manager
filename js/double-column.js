// ─── 2칸 제품 설정 ──────────────────────────────────────────────────────────

// Firebase: users/{uid}/doubleColumns/{deviceNo} = [{productCode, productName, colStart, colEnd}]

function openDoubleColumnModal(){
  if(!currentUser) return;

  // 현재 자판기 정보
  var mc = vmMachineList[vmMachineIdx];
  if(!mc){ showToast('자판기를 먼저 선택해주세요'); return; }

  var devno = mc.devno||'';

  // 제품 드롭다운 채우기 (현재 자판기 컬럼매칭 제품)
  var sel = document.getElementById('dc-product');
  sel.innerHTML = '<option value="">제품 선택</option>';
  var colData = mc._vmmsColumns||{};
  var columns = colData.columns||[];
  if(!Array.isArray(columns)) columns = Object.values(columns);
  var seen = {};
  columns.forEach(function(c){
    var code = c.productCode||'';
    var name = c.productName||'';
    if(seen[code]) return;
    seen[code] = true;
    var opt = document.createElement('option');
    opt.value = code;
    opt.textContent = name+' ('+code+')';
    sel.appendChild(opt);
  });

  document.getElementById('dc-start').value = '';
  document.getElementById('dc-end').value = '';
  document.getElementById('dc-msg').textContent = '';

  // 기존 2칸 설정 표시
  renderDoubleColumnList(devno);
  openModal('double-col-modal');
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
          '<button onclick="removeDoubleColumn(\''+devno+'\','+i+')" style="background:rgba(255,90,95,.1);border:1px solid rgba(255,90,95,.3);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--red);cursor:pointer;font-family:inherit">삭제</button>'+
        '</div>';
      }).join('');
  });
}

function addDoubleColumn(){
  var mc = vmMachineList[vmMachineIdx];
  if(!mc) return;
  var devno = mc.devno||'';

  var sel = document.getElementById('dc-product');
  var startEl = document.getElementById('dc-start');
  var endEl = document.getElementById('dc-end');
  var msg = document.getElementById('dc-msg');

  var code = sel.value;
  var name = sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].textContent:'';
  var colStart = startEl.value.trim();
  var colEnd = endEl.value.trim();

  if(!code){ msg.style.color='var(--red)'; msg.textContent='제품을 선택하세요'; return; }
  if(!colStart||!colEnd){ msg.style.color='var(--red)'; msg.textContent='시작/끝 컬럼을 입력하세요'; return; }

  var s = parseInt(colStart), e = parseInt(colEnd);
  if(isNaN(s)||isNaN(e)){ msg.style.color='var(--red)'; msg.textContent='숫자를 입력하세요'; return; }
  if(Math.abs(e-s) !== 1){ msg.style.color='var(--red)'; msg.textContent='연속된 2칸이어야 합니다 (차이 1)'; return; }
  if(s > e){ var tmp=s; s=e; e=tmp; }

  msg.style.color='var(--text2)'; msg.textContent='저장 중...';

  // 기존 데이터 로드 후 추가
  var ref = db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno);
  ref.once('value').then(function(snap){
    var items = snap.val()||[];
    if(!Array.isArray(items)) items = Object.values(items);

    // 중복 체크
    var dup = items.find(function(it){ return it.colStart==s && it.colEnd==e; });
    if(dup){ msg.style.color='var(--red)'; msg.textContent='이미 설정된 범위입니다'; return; }

    // 겹침 체크
    var overlap = items.find(function(it){
      return (s >= it.colStart && s <= it.colEnd) || (e >= it.colStart && e <= it.colEnd);
    });
    if(overlap){ msg.style.color='var(--red)'; msg.textContent='컬럼 '+overlap.colStart+'~'+overlap.colEnd+'과 겹칩니다'; return; }

    items.push({
      productCode: code,
      productName: name.replace(/\s*\(.*\)$/, ''), // (코드) 제거
      colStart: s,
      colEnd: e
    });

    return ref.set(items);
  }).then(function(){
    msg.style.color='var(--green)'; msg.textContent='✅ 추가 완료';
    startEl.value=''; endEl.value='';
    renderDoubleColumnList(devno);
    // 배치도 새로고침
    if(typeof renderMachine==='function') renderMachine();
    setTimeout(function(){ msg.textContent=''; }, 2000);
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent='저장 실패';
  });
}

function removeDoubleColumn(devno, idx){
  if(!confirm('삭제할까요?')) return;
  var ref = db.ref('users/'+currentUser.uid+'/doubleColumns/'+devno);
  ref.once('value').then(function(snap){
    var items = snap.val()||[];
    if(!Array.isArray(items)) items = Object.values(items);
    items.splice(idx, 1);
    return ref.set(items);
  }).then(function(){
    showToast('✅ 삭제 완료');
    renderDoubleColumnList(devno);
    if(typeof renderMachine==='function') renderMachine();
  });
}
