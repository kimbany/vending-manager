// ─── 자판기 관리 ──────────────────────────────────────────────────────────────
// ─── 위치/자판기 관리 (새 구조) ─────────────────────────────────────────────
// DB: users/{uid}/locations/{locId}/{name, mainMachineId, machines/{machineId}/{name, deviceNos[], contractStart, contractEnd, appData}}

var currentLocationId = null;
var currentMachineId  = null;

// 자판기 순서 정렬 헬퍼: order 필드 기준 오름차순 (없으면 createdAt 또는 키 순서)
function sortedMachineKeys(machines){
  return Object.keys(machines).sort(function(a,b){
    var oa = typeof machines[a].order === 'number' ? machines[a].order : 99999;
    var ob = typeof machines[b].order === 'number' ? machines[b].order : 99999;
    if(oa !== ob) return oa - ob;
    return (machines[a].createdAt||'').localeCompare(machines[b].createdAt||'');
  });
}

// 자판기 순서 변경
function reorderMachine(locId, machineId, dir){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines').once('value').then(function(snap){
    var machines = snap.val();
    if(!machines) return;
    var keys = sortedMachineKeys(machines);
    var idx = keys.indexOf(machineId);
    if(idx < 0) return;
    var swapIdx = idx + dir;
    if(swapIdx < 0 || swapIdx >= keys.length) return;
    // 모든 자판기에 순서 번호 부여 (normalize) 후 스왑
    var updates = {};
    keys.forEach(function(k, i){ updates[k+'/order'] = i; });
    // 스왑
    updates[keys[idx]+'/order'] = swapIdx;
    updates[keys[swapIdx]+'/order'] = idx;
    db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines').update(updates).then(function(){
      renderMachinesList();
    });
  });
}

// 위치 목록 렌더 (설정 탭)
function renderMachinesList(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    var el = document.getElementById('locations-list');
    if(!el) return;
    if(!snap.exists()||!snap.val()){
      el.innerHTML='<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">등록된 위치가 없어요<br/>위치를 추가해주세요</div>';
      return;
    }
    var mainLocId = '';
    db.ref('users/'+currentUser.uid+'/mainLocationId').once('value').then(function(ms){ mainLocId=ms.val()||''; });
    var html='';
    snap.forEach(function(locSnap){
      var loc=locSnap.val(); var locId=locSnap.key;
      if(!loc || !loc.name) return; // 이름 없는 잘못된 위치 건너뛰기
      var machines=loc.machines||{};
      var now=new Date().toISOString().slice(0,10);
      var mKeys = sortedMachineKeys(machines);
      html+='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
      html+='<div style="font-size:15px;font-weight:700">📍 '+loc.name+'</div>';
      html+='<div style="display:flex;gap:6px">';
      html+='<button onclick="openEditLocation(this.dataset.id)" data-id="'+locId+'" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text2);cursor:pointer;font-family:inherit">✏️</button>';
      html+='<button onclick="openAddMachineToLocation(this.dataset.id)" data-id="'+locId+'" style="background:rgba(122,218,154,.15);border:1px solid rgba(122,218,154,.3);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--green);cursor:pointer;font-family:inherit">+ 자판기</button>';
      html+='<button onclick="openDelItem(this.dataset.type,this.dataset.locid,null)" data-type="location" data-locid="'+locId+'" style="background:rgba(224,88,88,.15);border:1px solid rgba(224,88,88,.3);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--red);cursor:pointer;font-family:inherit">🗑️</button>';
      html+='</div></div>';
      // 자판기 목록 (order 순서)
      mKeys.forEach(function(mid, mIdx){
        var m=machines[mid];
        var devNos=Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
        var modelName=m.model?(' · '+m.model):'';
        var expired=m.contractEnd&&m.contractEnd<now;
        var isFirst = mIdx === 0;
        var isLast = mIdx === mKeys.length - 1;
        html+='<div style="background:var(--bg3);border-radius:8px;padding:10px;margin-bottom:6px">';
        html+='<div style="display:flex;justify-content:space-between;align-items:center">';
        html+='<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">🏪 '+m.name+modelName+'</div>';
        html+='<div style="font-size:11px;color:var(--text3);margin-top:2px">단말기: '+devNos.join(', ')+'</div>';
        if(m.model) html+='<div style="font-size:11px;color:var(--text3)">모델: '+m.model+'</div>';
        html+='<div style="font-size:11px;color:var(--text3)">계약: '+(m.contractStart||'-')+' ~ '+(m.contractEnd||'-')+'</div></div>';
        html+='<div style="display:flex;gap:4px;flex-direction:column;align-items:flex-end">';
        html+='<span style="font-size:10px;background:'+(expired?'rgba(224,88,88,.2)':'rgba(122,218,154,.15)')+';color:'+(expired?'var(--red)':'var(--green)')+';border-radius:4px;padding:2px 6px">'+(expired?'계약종료':'운영중')+'</span>';
        // 순서 변경 버튼
        if(mKeys.length > 1){
          html+='<div style="display:flex;gap:3px;margin-top:3px">';
          html+='<button onclick="reorderMachine(\''+locId+'\',\''+mid+'\',-1)" '+(isFirst?'disabled':'')
            +' style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:2px 6px;font-size:12px;color:'+(isFirst?'var(--text3)':'var(--text2)')+';cursor:'+(isFirst?'default':'pointer')+';font-family:inherit'+(isFirst?';opacity:0.4':'')+'">▲</button>';
          html+='<button onclick="reorderMachine(\''+locId+'\',\''+mid+'\',1)" '+(isLast?'disabled':'')
            +' style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:2px 6px;font-size:12px;color:'+(isLast?'var(--text3)':'var(--text2)')+';cursor:'+(isLast?'default':'pointer')+';font-family:inherit'+(isLast?';opacity:0.4':'')+'">▼</button>';
          html+='</div>';
        }
        html+='<div style="display:flex;gap:4px;margin-top:4px">';
        html+='<button onclick="openEditMachine(this.dataset.locid,this.dataset.mid)" data-locid="'+locId+'" data-mid="'+mid+'" style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:3px 7px;font-size:11px;color:var(--text2);cursor:pointer;font-family:inherit">✏️</button>';
        html+='<button onclick="openDelItem(this.dataset.type,this.dataset.locid,this.dataset.mid)" data-type="machine" data-locid="'+locId+'" data-mid="'+mid+'" style="background:rgba(224,88,88,.15);border:1px solid rgba(224,88,88,.3);border-radius:6px;padding:3px 7px;font-size:11px;color:var(--red);cursor:pointer;font-family:inherit">🗑️</button>';
        html+='</div></div></div></div>';
      });
      html+='</div>';
    });
    el.innerHTML=html;
  });
}

// 단말기 번호 입력 필드 추가
function addDevnoField(btn){
  var wrap=btn.parentElement.parentElement;
  var row=document.createElement('div');
  row.style='display:flex;gap:6px';
  row.innerHTML='<input type="text" placeholder="단말기 번호" class="al-devno" style="flex:1"/><button onclick="this.parentElement.remove()" style="background:rgba(224,88,88,.2);border:1px solid rgba(224,88,88,.3);border-radius:8px;padding:0 10px;color:var(--red);font-size:14px;cursor:pointer">−</button>';
  wrap.insertBefore(row, btn.parentElement);
}

// 자판기 행 추가 (위치 추가 모달)
function addMachineRow(){
  var wrap=document.getElementById('al-machines-wrap');
  var div=document.createElement('div');
  div.className='al-machine-row';
  div.style='background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px';
  var vtypeOpts='<option value="">종류 선택</option><option value="멀티자판기">멀티자판기</option><option value="음료자판기">음료자판기</option><option value="아이스크림자판기">아이스크림자판기</option><option value="과자자판기">과자자판기</option><option value="컵라면자판기">컵라면자판기</option><option value="기타">기타</option>';
  div.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div style="font-size:12px;font-weight:600;color:var(--text2)">단말기</div>'+
      '<button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;line-height:1">✕</button>'+
    '</div>'+
    '<div class="f2" style="margin-bottom:8px">'+
      '<div><label class="lbl">단말기 번호</label><div style="display:flex;gap:6px"><input type="text" placeholder="예: 2000107965" class="al-devno" style="flex:1"/><button type="button" onclick="checkDevnoDup(this)" style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--text2);cursor:pointer;font-family:inherit;white-space:nowrap">중복확인</button></div><div class="devno-msg" style="font-size:11px;margin-top:4px;min-height:16px"></div></div>'+
      '<div><label class="lbl">자판기 종류</label><select class="al-vtype" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:13px;font-family:inherit">'+vtypeOpts+'</select></div>'+
    '</div>'+
    '<div class="fr" style="margin-bottom:8px"><label class="lbl">자판기 모델명</label><input type="text" placeholder="예: LM-5000, VM-300 등" class="al-model"/></div>'+
    '<div class="fr" style="margin-bottom:4px"><label class="lbl">계약 시작</label><input type="date" class="al-start"/></div>'+
    '<div class="fr" style="margin-bottom:0"><label class="lbl">계약 종료</label><input type="date" class="al-end"/></div>';
  wrap.appendChild(div);
}

// 위치 추가
function addLocation(){
  var locName=document.getElementById('al-locname').value.trim();
  var isMain=document.getElementById('al-main').checked;
  var msg=document.getElementById('al-msg');
  if(!locName){ msg.style.color='var(--red)'; msg.textContent='위치명을 입력하세요'; return; }
  var rows=document.querySelectorAll('#al-machines-wrap .al-machine-row');
  if(!rows.length){ msg.style.color='var(--red)'; msg.textContent='단말기를 1개 이상 추가하세요'; return; }
  var machines={};
  var valid=true;
  rows.forEach(function(row){
    var devno=row.querySelector('.al-devno').value.trim();
    var vtype=row.querySelector('.al-vtype').value.trim();
    var model=row.querySelector('.al-model') ? row.querySelector('.al-model').value.trim() : '';
    var start=row.querySelector('.al-start').value;
    var end=row.querySelector('.al-end').value;
    if(!devno){ msg.style.color='var(--red)'; msg.textContent='단말기 번호를 입력하세요'; valid=false; return; }
    if(!vtype){ msg.style.color='var(--red)'; msg.textContent='자판기 종류를 선택하세요'; valid=false; return; }
    var mid='machine_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    machines[mid]={name:vtype, model:model, deviceNos:[devno], contractStart:start, contractEnd:end, createdAt:td()};
  });
  if(!valid) return;
  msg.style.color='var(--text2)'; msg.textContent='저장 중...';
  var locId='location_'+Date.now();
  var locData={name:locName, createdAt:td(), machines:machines};
  var promises=[db.ref('users/'+currentUser.uid+'/locations/'+locId).set(locData)];
  if(isMain) promises.push(db.ref('users/'+currentUser.uid+'/mainLocationId').set(locId));
  Promise.all(promises).then(function(){
    // 단말기번호 인덱스 등록
    Object.keys(machines).forEach(function(mid){ var m=machines[mid]; if(m.deviceNos) m.deviceNos.forEach(function(d){updateDeviceNumberIndex(d);}); });
    closeModal('add-location-modal');
    document.getElementById('al-locname').value='';
    document.getElementById('al-main').checked=false;
    // 초기화
    var vtypeOpts='<option value="">종류 선택</option><option value="멀티자판기">멀티자판기</option><option value="음료자판기">음료자판기</option><option value="아이스크림자판기">아이스크림자판기</option><option value="과자자판기">과자자판기</option><option value="컵라면자판기">컵라면자판기</option><option value="기타">기타</option>';
    document.getElementById('al-machines-wrap').innerHTML=
      '<div class="al-machine-row" style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px">'+
        '<div class="f2" style="margin-bottom:8px">'+
          '<div><label class="lbl">단말기 번호 *</label><div style="display:flex;gap:6px"><input type="text" placeholder="예: 2000107965" class="al-devno" style="flex:1"/><button type="button" onclick="checkDevnoDup(this)" style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--text2);cursor:pointer;font-family:inherit;white-space:nowrap">중복확인</button></div><div class="devno-msg" style="font-size:11px;margin-top:4px;min-height:16px"></div></div>'+
          '<div><label class="lbl">자판기 종류 *</label><select class="al-vtype" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:13px;font-family:inherit">'+vtypeOpts+'</select></div>'+
        '</div>'+
        '<div class="fr" style="margin-bottom:8px"><label class="lbl">자판기 모델명</label><input type="text" placeholder="예: VM-3000" class="al-model"/></div>'+
        '<div class="fr" style="margin-bottom:4px"><label class="lbl">계약 시작</label><input type="date" class="al-start"/></div>'+
        '<div class="fr" style="margin-bottom:0"><label class="lbl">계약 종료</label><input type="date" class="al-end"/></div>'+
      '</div>';
    showToast('✅ 위치 추가 완료');
    renderMachinesList();
    loadLocationDropdown();
  }).catch(function(e){ msg.style.color='var(--red)'; msg.textContent=e.message; });
}

// 위치에 자판기 추가 모달 열기
function openAddMachineToLocation(locId){
  // edit-machine-modal을 자판기 추가 모드로 사용
  document.getElementById('em-modal-title').textContent='🏪 자판기 추가';
  document.getElementById('edit-machine-id').value='__new__';
  document.getElementById('edit-machine-type').value='machine_to_loc:'+locId;
  document.getElementById('em-location-fields').style.display='none';
  document.getElementById('em-machine-fields').style.display='block';
  document.getElementById('em-name').value='';
  document.getElementById('em-devnos').innerHTML='<div style="display:flex;gap:6px"><input type="text" placeholder="단말기 번호" class="em-devno" style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;font-family:inherit"/><button onclick="this.parentElement.remove()" style="background:rgba(224,88,88,.15);border:1px solid rgba(224,88,88,.3);border-radius:8px;padding:0 10px;color:var(--red);cursor:pointer">−</button></div>';
  document.getElementById('em-start').value='';
  document.getElementById('em-end').value='';
  document.getElementById('em-main').checked=false;
  document.getElementById('em-msg').textContent='';
  openModal('edit-machine-modal');
}

function addEmDevnoField(){} // 하위호환

function makeEmRowHtml(devno, vtype, model, start, end){
  var vtypeOpts = '<option value="">종류 선택</option><option value="멀티자판기">멀티자판기</option><option value="음료자판기">음료자판기</option><option value="아이스크림자판기">아이스크림자판기</option><option value="과자자판기">과자자판기</option><option value="컵라면자판기">컵라면자판기</option><option value="기타">기타</option>';
  vtypeOpts = vtypeOpts.replace('value="'+vtype+'"', 'value="'+vtype+'" selected');
  return '<div class="em-machine-row" style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div style="font-size:12px;font-weight:600;color:var(--text2)">단말기</div>'+
      '<button onclick="this.closest(\'.em-machine-row\').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px">✕</button>'+
    '</div>'+
    '<div class="f2" style="margin-bottom:8px">'+
      '<div><label class="lbl">단말기 번호</label><div style="display:flex;gap:6px"><input type="text" value="'+(devno||'')+'" class="em-devno" placeholder="예: 2000107965" style="flex:1"/><button type="button" onclick="checkDevnoDup(this)" style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--text2);cursor:pointer;font-family:inherit;white-space:nowrap">중복확인</button></div><div class="devno-msg" style="font-size:11px;margin-top:4px;min-height:16px"></div></div>'+
      '<div><label class="lbl">자판기 종류</label><select class="em-vtype" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:13px;font-family:inherit">'+vtypeOpts+'</select></div>'+
    '</div>'+
    '<div class="fr" style="margin-bottom:8px"><label class="lbl">자판기 모델명 <span style="font-size:11px;color:var(--text3);font-weight:400">(선택)</span></label><input type="text" value="'+(model||'')+'" class="em-model" placeholder="예: VM-3000"/></div>'+
    '<div class="fr" style="margin-bottom:4px"><label class="lbl">계약 시작</label><input type="date" value="'+(start||'')+'" class="em-start"/></div>'+
    '<div class="fr" style="margin-bottom:0"><label class="lbl">계약 종료</label><input type="date" value="'+(end||'')+'" class="em-end"/></div>'+
  '</div>';
}

function addEmMachineRow(){
  var wrap = document.getElementById('em-machines-wrap');
  var div = document.createElement('div');
  div.innerHTML = makeEmRowHtml('','','','','');
  wrap.appendChild(div.firstChild);
}


// 위치 수정
function openEditLocation(locId){
  db.ref('users/'+currentUser.uid+'/locations/'+locId).once('value').then(function(snap){
    var loc=snap.val();if(!loc)return;
    document.getElementById('em-modal-title').textContent='📍 위치 수정';
    document.getElementById('edit-machine-id').value=locId;
    document.getElementById('edit-machine-type').value='location';
    document.getElementById('em-location-fields').style.display='block';
    document.getElementById('em-machine-fields').style.display='none';
    document.getElementById('em-locname').value=loc.name||'';
    document.getElementById('em-msg').textContent='';
    openModal('edit-machine-modal');
  });
}

// 자판기 수정
function openEditMachine(locId, machineId){
  db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+machineId).once('value').then(function(snap){
    var m=snap.val(); if(!m) return;
    var devnos=Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
    document.getElementById('em-modal-title').textContent='✏️ 자판기 수정';
    document.getElementById('edit-machine-id').value=locId+'|'+machineId;
    document.getElementById('edit-machine-type').value='machine';
    document.getElementById('em-location-fields').style.display='none';
    document.getElementById('em-machine-fields').style.display='block';
    document.getElementById('em-msg').textContent='';
    // 단말기 행 렌더 (단말기번호 1개 = 1행)
    var wrap = document.getElementById('em-machines-wrap');
    wrap.innerHTML = '';
    if(devnos.length){
      devnos.forEach(function(d){
        var div=document.createElement('div');
        div.innerHTML=makeEmRowHtml(d, m.name||'', m.model||'', m.contractStart||'', m.contractEnd||'');
        wrap.appendChild(div.firstChild);
      });
    } else {
      var div=document.createElement('div');
      div.innerHTML=makeEmRowHtml('', m.name||'', m.model||'', m.contractStart||'', m.contractEnd||'');
      wrap.appendChild(div.firstChild);
    }
    openModal('edit-machine-modal');
  });
}

// 수정 저장
function saveMachineEdit(){
  var type=document.getElementById('edit-machine-type').value;
  var id=document.getElementById('edit-machine-id').value;
  var msg=document.getElementById('em-msg');
  msg.style.color='var(--text2)'; msg.textContent='저장 중...';

  if(type==='location'){
    var locName=document.getElementById('em-locname').value.trim();
    if(!locName){ msg.style.color='var(--red)'; msg.textContent='위치명을 입력하세요'; return; }
    db.ref('users/'+currentUser.uid+'/locations/'+id+'/name').set(locName).then(function(){
      msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료';
      setTimeout(function(){ closeModal('edit-machine-modal'); renderMachinesList(); loadLocationDropdown(); }, 800);
    });
  } else if(type==='machine' || type.startsWith('machine_to_loc:')){
    var locId = type.startsWith('machine_to_loc:') ? type.split(':')[1] : id.split('|')[0];
    var machineId = type.startsWith('machine_to_loc:') ? 'machine_'+Date.now() : id.split('|')[1];
    // em-machines-wrap 에서 각 행 읽기
    var rows = document.querySelectorAll('#em-machines-wrap .em-machine-row');
    if(!rows.length){ msg.style.color='var(--red)'; msg.textContent='단말기를 1개 이상 추가하세요'; return; }
    var saves = [];
    var valid = true;
    rows.forEach(function(row){
      var devno = row.querySelector('.em-devno').value.trim();
      var vtype = row.querySelector('.em-vtype').value.trim();
      var model = row.querySelector('.em-model') ? row.querySelector('.em-model').value.trim() : '';
      var start = row.querySelector('.em-start') ? row.querySelector('.em-start').value : '';
      var end   = row.querySelector('.em-end')   ? row.querySelector('.em-end').value   : '';
      if(!devno){ msg.style.color='var(--red)'; msg.textContent='단말기 번호를 입력하세요'; valid=false; return; }
      saves.push({devno:devno, vtype:vtype, model:model, start:start, end:end});
    });
    if(!valid) return;
    // 단말기 1개: 기존 자판기 업데이트 / 여러 개: 추가분은 새 machineId로 생성
    var promises = [];
    saves.forEach(function(s, i){
      var mid = i===0 ? machineId : 'machine_'+Date.now()+'_'+i;
      var mname = s.vtype || s.model || s.devno;
      var data = {name:mname, deviceNos:[s.devno], contractStart:s.start, contractEnd:s.end};
      if(s.model) data.model = s.model;
      if(type.startsWith('machine_to_loc:') || i>0) data.createdAt=td();
      promises.push(db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+mid).update(data));
    });
    Promise.all(promises).then(function(){
      msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료';
      setTimeout(function(){ closeModal('edit-machine-modal'); renderMachinesList(); loadLocationDropdown(); }, 800);
    });
  }
}

// 삭제 모달
function openDelItem(type, locId, machineId){
  document.getElementById('del-machine-id').value=locId+(machineId?'|'+machineId:'');
  document.getElementById('del-machine-type').value=type;
  document.getElementById('dm-pw').value='';
  document.getElementById('dm-msg').textContent='';
  openModal('del-machine-modal');
}
function openDelMachine(id){ openDelItem('machine_legacy', id, null); } // 하위호환

function confirmDelMachine(){
  var pw=document.getElementById('dm-pw').value;
  var type=document.getElementById('del-machine-type').value;
  var ids=document.getElementById('del-machine-id').value.split('|');
  var msg=document.getElementById('dm-msg');
  if(!pw){ msg.textContent='비밀번호를 입력하세요'; return; }
  var cred=firebase.auth.EmailAuthProvider.credential(currentUser.email, pw);
  currentUser.reauthenticateWithCredential(cred).then(function(){
    var path;
    if(type==='location') path=db.ref('users/'+currentUser.uid+'/locations/'+ids[0]);
    else path=db.ref('users/'+currentUser.uid+'/locations/'+ids[0]+'/machines/'+ids[1]);
    return path.remove();
  }).then(function(){
    closeModal('del-machine-modal');
    showToast('✅ 삭제 완료');
    renderMachinesList();
    loadLocationDropdown();
  }).catch(function(e){
    if(e.code==='auth/wrong-password') msg.textContent='비밀번호가 올바르지 않아요';
    else msg.textContent=e.message;
  });
}

function setMainMachine(id){ /* 하위호환 - 미사용 */ }

// ─── 드롭다운: 위치→자판기 2단계 ────────────────────────────────────────────
function loadLocationDropdown(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    var locSel=document.getElementById('location-select');
    var machSel=document.getElementById('machine-select');
    var selectorDiv=document.getElementById('machine-selector');
    if(!snap.exists()||!snap.val()){ selectorDiv.style.display='none'; return; }
    var locs=snap.val(); var keys=Object.keys(locs).filter(function(lid){ return locs[lid] && locs[lid].name; });
    if(!keys.length){ selectorDiv.style.display='none'; return; }
    selectorDiv.style.display='flex';
    locSel.innerHTML=keys.map(function(lid){
      return '<option value="'+lid+'">📍 '+locs[lid].name+'</option>';
    }).join('');
    // 이전 선택 복원
    if(currentLocationId && locs[currentLocationId]) locSel.value=currentLocationId;
    else locSel.value=keys[0];
    onLocationSelect(true);
  });
}
function loadMachineDropdown(){ loadLocationDropdown(); } // 하위호환

function onLocationSelect(autoLoad){
  var locSel=document.getElementById('location-select');
  currentLocationId=locSel.value;
  if(!currentLocationId) return;
  db.ref('users/'+currentUser.uid+'/locations/'+currentLocationId+'/machines').once('value').then(function(snap){
    if(!snap.exists()||!snap.val()) return;
    var machines=snap.val(); var keys=sortedMachineKeys(machines);
    currentMachineId = keys[0]; // order 순서 기준 첫 번째 자판기
    if(autoLoad !== false) loadMachineData(currentLocationId, currentMachineId);
  });
}

function onMachineSelect(){
  var machSel=document.getElementById('machine-select');
  currentMachineId=machSel.value;
  loadMachineData(currentLocationId, currentMachineId);
}

function loadMachineData(locId, machineId){
  if(!locId||!machineId) return;
  var machineREF=db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+machineId+'/appData');
  machineREF.once('value').then(function(snap){
    var val=snap.val();
    D.products      =(val&&val.products)     ||[];
    D.inventory     =(val&&val.inventory)    ||[];
    D.inventoryLogs =(val&&val.inventoryLogs)||[];
    D.salesData     =(val&&val.salesData)    ||[];
    REF=machineREF;
    // 일회성 데이터 정리: 테스트용 초기 재고/로그 리셋 + totalQty 제거
    var flagRef = db.ref('users/'+currentUser.uid+'/migrations/inventoryReset_'+locId+'_'+machineId);
    flagRef.once('value').then(function(flagSnap){
      if(!flagSnap.val()){
        D.inventory = [];
        D.inventoryLogs = [];
        D.products.forEach(function(p){ delete p.totalQty; });
        save();
        flagRef.set(true);
      }
      renderAll();
    });
  });
}



// ─── 데이터 이전 ──────────────────────────────────────────────────────────────
function openMigratePanel(){
  var panel = document.getElementById('migrate-inline');
  var isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if(!isOpen){
    var sel = document.getElementById('migrate-target-inline');
    sel.innerHTML = '<option value="">자판기 선택</option>';
    db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
      if(!snap.exists()) return;
      snap.forEach(function(locSnap){
        var loc=locSnap.val();
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m=loc.machines[mid];
          var opt=document.createElement('option');
          opt.value=locSnap.key+'|'+mid;
          opt.textContent='📍 '+loc.name+' · 🏪 '+m.name;
          sel.appendChild(opt);
        });
      });
    });
  }
}

function doMigrateInline(){
  var sel = document.getElementById('migrate-target-inline');
  var targetVal = sel.value;
  var targetName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
  var msg = document.getElementById('migrate-inline-msg');
  if(!targetVal){ msg.style.color='var(--red)'; msg.textContent='자판기를 선택해주세요'; return; }
  var parts = targetVal.split('|');
  var locId=parts[0], machineId=parts[1];
  if(!confirm(targetName + '으로 이전할까요?')) return;
  msg.style.color='var(--text2)'; msg.textContent='이전 중...';
  db.ref('users/'+currentUser.uid+'/appData').once('value').then(function(snap){
    var val = snap.val();
    if(!val || !val.products || !val.products.length){
      msg.style.color='var(--red)'; msg.textContent='이전할 데이터가 없어요'; return;
    }
    var destPath = db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+machineId+'/appData');
    destPath.set(val).then(function(){
      msg.style.color='var(--green)'; msg.textContent='✅ 이전 완료!';
      currentLocationId=locId; currentMachineId=machineId; REF=destPath;
      D.products=val.products||[]; D.inventory=val.inventory||[];
      D.inventoryLogs=val.inventoryLogs||[]; D.salesData=val.salesData||[];
      localStorage.setItem('migrateDismissed_'+currentUser.uid, '1');
      showToast('✅ ' + targetName + ' 이전 완료!');
      loadLocationDropdown(); renderAll();
    });
  }).catch(function(e){ msg.style.color='var(--red)'; msg.textContent='실패: '+e.message; });
}

// ─── 단말기번호 중복 체크 (전체 계정 기준) ──────────────────────────────────────
function checkDevnoDup(btn){
  var input = btn.closest('div').querySelector('input');
  var msgEl = btn.closest('div').parentElement.querySelector('.devno-msg');
  if(!input || !msgEl) return;
  var devno = input.value.trim();
  if(!devno){ msgEl.style.color='var(--red)'; msgEl.textContent='단말기 번호를 입력하세요'; return; }
  msgEl.style.color='var(--text2)'; msgEl.textContent='확인 중...';
  // deviceNumbers/{devno} 인덱스 확인
  db.ref('deviceNumbers/'+devno).once('value').then(function(snap){
    if(snap.exists() && snap.val() !== currentUser.uid){
      msgEl.style.color='var(--red)'; msgEl.textContent='❌ 이미 사용 중인 단말기 번호입니다';
    } else {
      msgEl.style.color='var(--green)'; msgEl.textContent='✅ 사용 가능한 단말기 번호입니다';
    }
  }).catch(function(){
    msgEl.style.color='var(--red)'; msgEl.textContent='확인 실패. 다시 시도해주세요';
  });
}

// 자판기 저장 시 deviceNumbers 인덱스 업데이트
function updateDeviceNumberIndex(devno){
  if(!devno || !currentUser) return;
  db.ref('deviceNumbers/'+devno).set(currentUser.uid);
}

// 앱 시작 시 본인의 모든 단말기번호를 인덱스에 자동 등록 (마이그레이션)
function syncDeviceNumberIndex(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    if(!snap.exists()) return;
    snap.forEach(function(locSnap){
      var loc = locSnap.val();
      Object.keys(loc.machines||{}).forEach(function(mid){
        var m = loc.machines[mid];
        var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
        devnos.forEach(function(d){ if(d) updateDeviceNumberIndex(d); });
      });
    });
  });
}
