// ─── 설정 관련 함수 ──────────────────────────────────────────────────────────

function resetVmmsLock(){
  var el = document.getElementById('vmms-lock-pw');
  if(el) el.value = '';
  var msg = document.getElementById('vmms-lock-msg');
  if(msg) msg.textContent = '';
  var locked = document.getElementById('vmms-locked');
  var panel  = document.getElementById('vmms-panel');
  if(locked) locked.style.display = 'block';
  if(panel)  panel.style.display  = 'none';
}

function unlockVmms(){
  var pw  = document.getElementById('vmms-lock-pw').value;
  var msg = document.getElementById('vmms-lock-msg');
  if(!pw){ msg.textContent='비밀번호를 입력하세요'; return; }
  var cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, pw);
  currentUser.reauthenticateWithCredential(cred).then(function(){
    document.getElementById('vmms-locked').style.display='none';
    document.getElementById('vmms-panel').style.display='block';
    renderVmmsInfo();
  }).catch(function(){
    msg.textContent='비밀번호가 올바르지 않아요';
  });
}

function renderVmmsInfo(){
  db.ref('users/'+currentUser.uid+'/vmms').once('value').then(function(snap){
    var v = snap.val()||{};
    var el = document.getElementById('vmms-info');
    var hasData = v.id;
    el.innerHTML = hasData
      ? '<div style="padding:10px 0"><div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--text2)">아이디</span><span style="font-weight:600">'+atob(v.id||'')+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px"><span style="color:var(--text2)">비밀번호</span><span style="font-weight:600">••••••••</span></div></div>'
      : '<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">VMMS 계정을 등록해주세요</div>';
  });
}

function saveVmms(){
  var id  = document.getElementById('ev-id').value.trim();
  var pw  = document.getElementById('ev-pw').value;
  var msg = document.getElementById('ev-msg');
  if(!id||!pw){ msg.style.color='var(--red)'; msg.textContent='아이디와 비밀번호를 입력하세요'; return; }
  db.ref('users/'+currentUser.uid+'/vmms').set({
    id: btoa(id), pw: btoa(pw), updatedAt: new Date().toISOString()
  }).then(function(){
    msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료';
    setTimeout(function(){ closeModal('edit-vmms-modal'); renderVmmsInfo(); }, 1000);
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent=e.message;
  });
}

function switchVmSub(sub){
  var isStatus = sub === 'status';
  document.getElementById('vm-panel-status').style.display   = isStatus ? 'block' : 'none';
  document.getElementById('vm-panel-products').style.display = isStatus ? 'none'  : 'block';
  var btnS = document.getElementById('vm-sub-status');
  var btnP = document.getElementById('vm-sub-products');
  btnS.style.background = isStatus ? 'var(--bg2)' : 'transparent';
  btnS.style.color      = isStatus ? 'var(--text)' : 'var(--text3)';
  btnS.style.fontWeight = isStatus ? '700' : '600';
  btnS.style.boxShadow  = isStatus ? '0 1px 3px rgba(0,0,0,.08)' : 'none';
  btnP.style.background = isStatus ? 'transparent' : 'var(--bg2)';
  btnP.style.color      = isStatus ? 'var(--text3)' : 'var(--text)';
  btnP.style.fontWeight = isStatus ? '600' : '700';
  btnP.style.boxShadow  = isStatus ? 'none' : '0 1px 3px rgba(0,0,0,.08)';
  if(isStatus) renderMachine();
  else { if(typeof initProdMachineNav==='function') initProdMachineNav(); renderProds(); }
}

function checkMigrationV2(){
  if(!currentUser) return;
  var dismissed = localStorage.getItem('migrateDismissed_v2_' + currentUser.uid);
  if(dismissed) return;

  // appData 또는 기존 machines/ 경로에 데이터 있는지 확인
  Promise.all([
    db.ref('users/'+currentUser.uid+'/appData').once('value'),
    db.ref('users/'+currentUser.uid+'/machines').once('value')
  ]).then(function(results){
    var appSnap = results[0], machSnap = results[1];
    var hasAppData = appSnap.exists() && appSnap.val() && appSnap.val().products && appSnap.val().products.length;
    var hasMachines = machSnap.exists() && machSnap.val() && Object.keys(machSnap.val()).length;
    if(!hasAppData && !hasMachines) return;

    // 이전할 소스 파악
    var sources = [];
    if(hasAppData) sources.push({type:'appData', label:'공통 데이터', ref:'appData'});
    if(hasMachines){
      machSnap.forEach(function(child){
        var m = child.val();
        if(m && m.name) sources.push({type:'machine', label:'🏪 '+m.name, ref:child.key, data:m});
      });
    }

    // locations에 등록된 자판기 목록
    db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(locSnap){
      var sel = document.getElementById('migrate-target');
      if(!sel) return;
      sel.innerHTML = '';

      // 이전할 소스 목록
      sources.forEach(function(src){
        var optSrc = document.createElement('option');
        optSrc.value = 'src:'+src.ref;
        optSrc.textContent = '원본: '+src.label;
        optSrc.disabled = true;
        optSrc.style.color = 'var(--text3)';
        sel.appendChild(optSrc);
      });

      // 이전 대상: locations의 자판기들
      if(locSnap.exists()){
        locSnap.forEach(function(locChild){
          var loc = locChild.val();
          Object.keys(loc.machines||{}).forEach(function(mid){
            var m = loc.machines[mid];
            var opt = document.createElement('option');
            opt.value = locChild.key+'|'+mid+'|'+(sources[0]?sources[0].ref:'appData');
            opt.textContent = '-> 📍 '+loc.name+' · 🏪 '+m.name;
            sel.appendChild(opt);
          });
        });
      }

      // 소스가 1개면 자동 선택용 값 세팅
      // 실제 UI는 단순하게: 소스 첫번째를 기본으로 각 자판기로 이전
      sel.innerHTML = '';
      if(locSnap.exists()){
        locSnap.forEach(function(locChild){
          var loc = locChild.val();
          Object.keys(loc.machines||{}).forEach(function(mid){
            var m = loc.machines[mid];
            sources.forEach(function(src){
              var opt = document.createElement('option');
              opt.value = locChild.key+'|'+mid+'|'+src.ref+'|'+src.type;
              opt.textContent = src.label+' -> 📍 '+loc.name+' · 🏪 '+m.name;
              sel.appendChild(opt);
            });
          });
        });
      }

      if(!sel.options.length){
        // locations가 없음 - 먼저 위치/자판기를 추가하라고 안내
        var banner = document.getElementById('migrate-banner');
        if(banner){
          banner.style.display='block';
          var desc = banner.querySelector('.migrate-desc');
          if(desc) desc.textContent='설정 > 자판기에서 위치와 자판기를 먼저 추가해주세요.';
        }
        return;
      }

      var banner = document.getElementById('migrate-banner');
      if(banner) banner.style.display='block';
    });
  });
}

function migrateOldData(){
  var sel = document.getElementById('migrate-target');
  if(!sel||!sel.value){ showToast('대상을 선택해주세요'); return; }
  var parts = sel.value.split('|');
  var locId=parts[0], machineId=parts[1], srcRef=parts[2], srcType=parts[3];
  var targetLabel = sel.options[sel.selectedIndex].text;
  if(!confirm(targetLabel+' 이전할까요?')) return;
  showToast('⏳ 이전 중...');

  // 소스 데이터 읽기
  var srcPath = srcType==='machine'
    ? db.ref('users/'+currentUser.uid+'/machines/'+srcRef)
    : db.ref('users/'+currentUser.uid+'/appData');

  srcPath.once('value').then(function(snap){
    var val = snap.val();
    // machine 타입이면 appData 서브노드 확인
    if(srcType==='machine' && val && val.appData) val = val.appData;
    if(!val||!val.products||!val.products.length){
      showToast('❌ 이전할 데이터가 없어요'); return;
    }
    var destPath = db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+machineId+'/appData');
    return destPath.set({
      products: val.products||[],
      inventory: val.inventory||[],
      inventoryLogs: val.inventoryLogs||[],
      salesData: val.salesData||[]
    }).then(function(){
      document.getElementById('migrate-banner').style.display='none';
      localStorage.setItem('migrateDismissed_v2_'+currentUser.uid,'1');
      currentLocationId=locId; currentMachineId=machineId; REF=destPath;
      D.products=val.products||[]; D.inventory=val.inventory||[];
      D.inventoryLogs=val.inventoryLogs||[]; D.salesData=val.salesData||[];
      showToast('✅ 이전 완료!');
      loadLocationDropdown(); renderAll();
    });
  }).catch(function(e){ showToast('❌ 실패: '+e.message); });
}

function dismissMigrate(){
  var banner=document.getElementById('migrate-banner');
  if(banner) banner.style.display='none';
  if(currentUser) localStorage.setItem('migrateDismissed_'+currentUser.uid,'1');
}

function switchSettingsSub(sub){
  ['profile','machines','vmms'].forEach(function(s){
    document.getElementById('set-panel-'+s).style.display = s===sub ? 'block' : 'none';
    var btn = document.getElementById('set-sub-'+s);
    btn.style.background = s===sub ? 'var(--bg2)' : 'transparent';
    btn.style.color      = s===sub ? 'var(--text)' : 'var(--text3)';
    btn.style.fontWeight = s===sub ? '700' : '600';
    btn.style.boxShadow  = s===sub ? '0 1px 3px rgba(0,0,0,.08)' : 'none';
  });
  if(sub==='profile'){ renderProfileInfo(); loadLowStockSetting(); }
  if(sub==='machines') renderMachinesList();
  if(sub==='vmms') resetVmmsLock();
  // 다른 탭으로 이동 시 VMMS 잠금 초기화
  if(sub!=='vmms') resetVmmsLock();
}

// ─── 회원 정보 ────────────────────────────────────────────────────────────────
// ─── 회원정보 렌더 (요약 - 설정 첫화면) ────────────────────────────────────
function renderProfileInfo(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid).once('value').then(function(snap){
    var d = snap.val()||{};
    var p = d.profile||{};
    var el = document.getElementById('profile-info');
    if(!el) return;
    // 자판기 대수 계산 (locations 기반)
    var machineCount = 0;
    if(d.locations){
      Object.keys(d.locations).forEach(function(locId){
        var loc = d.locations[locId];
        if(loc && loc.machines) machineCount += Object.keys(loc.machines).length;
      });
    }
    // 구형 machines 경로도 체크
    if(machineCount === 0 && d.machines) machineCount = Object.keys(d.machines).length;
    el.innerHTML = [
      ['아이디', p.username||'-'],
      ['이메일', p.email||currentUser.email||'-'],
      ['가입일', p.createdAt ? p.createdAt.slice(0,10) : '-'],
      ['자판기', machineCount+'대']
    ].map(function(row){
      return '<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px">'+
        '<span style="color:var(--text2)">'+row[0]+'</span>'+
        '<span style="font-weight:700;color:var(--text)">'+row[1]+'</span></div>';
    }).join('');
  });
}

// ─── 회원정보 수정 모달 열기/닫기 ────────────────────────────────────────────
function openEditProfileModal(){
  document.getElementById('edit-profile-lock').style.display='block';
  document.getElementById('edit-profile-unlocked').style.display='none';
  document.getElementById('ep-lock-pw').value='';
  document.getElementById('ep-lock-msg').textContent='';
  openModal('edit-profile-modal');
}

function closeEditProfileModal(){
  document.getElementById('ep-lock-pw').value='';
  closeModal('edit-profile-modal');
}

function switchEpTab(tab){
  ['info','edit','pw'].forEach(function(t){
    document.getElementById('ep-panel-'+t).style.display = t===tab ? 'block' : 'none';
    var btn = document.getElementById('ep-tab-'+t);
    btn.style.background = t===tab ? 'var(--blue)' : 'transparent';
    btn.style.color      = t===tab ? '#fff' : 'var(--text2)';
    btn.style.fontWeight = t===tab ? '700' : '600';
  });
}

function unlockEditProfile(){
  var pw = document.getElementById('ep-lock-pw').value;
  var msg = document.getElementById('ep-lock-msg');
  if(!pw){ msg.textContent='비밀번호를 입력하세요'; return; }
  var cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, pw);
  currentUser.reauthenticateWithCredential(cred).then(function(){
    document.getElementById('edit-profile-lock').style.display='none';
    document.getElementById('edit-profile-unlocked').style.display='block';
    switchEpTab('info');
    loadProfileForEdit();
  }).catch(function(){
    msg.textContent='비밀번호가 올바르지 않아요';
  });
}

function loadProfileForEdit(){
  db.ref('users/'+currentUser.uid+'/profile').once('value').then(function(snap){
    var p = snap.val()||{};
    document.getElementById('ep-email').value = p.email||currentUser.email||'';
    document.getElementById('ep-phone').value = p.phone||'';
    // 상세 정보 표시
    var el = document.getElementById('ep-detail-info');
    if(el) el.innerHTML = [
      ['이름', p.name||'-'],
      ['아이디', p.username||'-'],
      ['이메일', p.email||currentUser.email||'-'],
      ['연락처', p.phone||'-'],
      ['가입일', p.createdAt ? p.createdAt.slice(0,10) : '-']
    ].map(function(row){
      return '<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">'+
        '<span style="color:var(--text2)">'+row[0]+'</span>'+
        '<span style="font-weight:600">'+row[1]+'</span></div>';
    }).join('');
  });
}

function initEpBirthSelects(current){
  var el = document.getElementById('ep-birth-selects');
  if(!el) return;
  var ss = 'style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 6px;color:var(--text);font-size:13px;font-family:inherit;"';
  var parts = current ? current.split('-') : ['','',''];
  var yOpts='<option value="">년</option>', mOpts='<option value="">월</option>', dOpts='<option value="">일</option>';
  var thisYear=new Date().getFullYear();
  for(var y=thisYear-80;y<=thisYear-14;y++) yOpts+='<option value="'+y+'"'+(parts[0]==y?' selected':'')+'>'+y+'</option>';
  for(var m=1;m<=12;m++){var mv=(m<10?'0':'')+m; mOpts+='<option value="'+mv+'"'+(parts[1]==mv?' selected':'')+'>'+mv+'</option>';}
  for(var d=1;d<=31;d++){var dv=(d<10?'0':'')+d; dOpts+='<option value="'+dv+'"'+(parts[2]==dv?' selected':'')+'>'+dv+'</option>';}
  el.innerHTML='<select id="ep-birth-y" '+ss+'>'+yOpts+'</select><select id="ep-birth-m" '+ss+'>'+mOpts+'</select><select id="ep-birth-d" '+ss+'>'+dOpts+'</select>';
}

function saveProfile(){
  var email = document.getElementById('ep-email').value.trim();
  var phone = document.getElementById('ep-phone').value.trim();
  var msg = document.getElementById('ep-msg');
  if(!email){ msg.style.color='var(--red)'; msg.textContent='이메일을 입력하세요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='저장 중...';
  var updates = {email:email, phone:phone};
  var promises = [db.ref('users/'+currentUser.uid+'/profile').update(updates)];
  if(email !== currentUser.email){
    // 새 이메일로 인증 메일 발송 (인증 후 자동 변경)
    promises.push(currentUser.verifyBeforeUpdateEmail(email));
  }
  Promise.all(promises).then(function(){
    if(email !== currentUser.email){
      msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료. 새 이메일로 인증 메일을 보냈어요. 인증 후 변경됩니다.';
    } else {
      msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료';
    }
    renderProfileInfo();
    setTimeout(function(){ switchEpTab('info'); loadProfileForEdit(); }, 1000);
  }).catch(function(e){
    msg.style.color='var(--red)';
    if(e.code==='auth/requires-recent-login') msg.textContent='보안을 위해 다시 로그인 후 시도해주세요';
    else if(e.code==='auth/invalid-email') msg.textContent='이메일 형식이 올바르지 않아요';
    else if(e.code==='auth/email-already-in-use') msg.textContent='이미 사용 중인 이메일이에요';
    else msg.textContent='저장 실패. 다시 시도해주세요';
  });
}

// ─── 비밀번호 변경 ────────────────────────────────────────────────────────────
function checkNewPw(){
  var pw = document.getElementById('cp-new').value;
  var el = document.getElementById('cp-strength');
  var ok = /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw) && pw.length>=8;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.textContent = pw ? (ok ? '✅ 사용 가능' : '❌ 영문+숫자 8자 이상') : '';
}

function doChangePw(){
  var nw  = document.getElementById('cp-new').value;
  var nw2 = document.getElementById('cp-new2').value;
  var msg = document.getElementById('cp-msg');
  if(!nw||!nw2){ msg.style.color='var(--red)'; msg.textContent='새 비밀번호를 입력하세요'; return; }
  if(nw!==nw2){ msg.style.color='var(--red)'; msg.textContent='새 비밀번호가 일치하지 않아요'; return; }
  if(!/[a-zA-Z]/.test(nw)||!/[0-9]/.test(nw)||nw.length<8){ msg.style.color='var(--red)'; msg.textContent='영문+숫자 8자 이상이어야 해요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='변경 중...';
  currentUser.updatePassword(nw).then(function(){
    msg.style.color='var(--green)'; msg.textContent='✅ 비밀번호 변경 완료!';
    document.getElementById('cp-new').value='';
    document.getElementById('cp-new2').value='';
    document.getElementById('cp-strength').textContent='';
    setTimeout(function(){ closeEditProfileModal(); }, 1500);
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent=e.message;
  });
}

// ─── 재고 부족 기준 설정 ──────────────────────────────────────────────────────
function toggleLowStockMode(){
  var mode = document.querySelector('input[name="low-stock-mode"]:checked').value;
  document.getElementById('ls-fixed-input').style.display = mode==='fixed' ? 'flex' : 'none';
  document.getElementById('ls-avg-input').style.display = mode==='average' ? 'flex' : 'none';
}

function saveLowStockSetting(){
  var mode = document.querySelector('input[name="low-stock-mode"]:checked').value;
  var msg = document.getElementById('ls-save-msg');
  var data = {mode: mode};
  if(mode==='fixed'){
    data.fixedQty = parseInt(document.getElementById('ls-fixed-qty').value)||5;
  } else {
    data.avgDays = parseInt(document.getElementById('ls-avg-days').value)||3;
  }
  msg.style.color='var(--text2)'; msg.textContent='저장 중...';
  db.ref('users/'+currentUser.uid+'/settings/lowStock').set(data).then(function(){
    msg.style.color='var(--green)'; msg.textContent='저장 완료';
    if(mode==='fixed'){
      _lowStockThreshold = data.fixedQty;
    } else {
      _lowStockThreshold = null;
      _lowStockAvgDays = data.avgDays;
    }
    if(typeof loadLowStockThreshold === 'function') loadLowStockThreshold();
    renderAll();
    setTimeout(function(){ msg.textContent=''; }, 2000);
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent=e.message;
  });
}

function loadLowStockSetting(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/settings/lowStock').once('value').then(function(snap){
    var v = snap.val();
    if(!v) return;
    var radios = document.querySelectorAll('input[name="low-stock-mode"]');
    radios.forEach(function(r){ r.checked = (r.value === v.mode); });
    if(v.mode==='fixed'){
      document.getElementById('ls-fixed-qty').value = v.fixedQty||5;
      document.getElementById('ls-fixed-input').style.display = 'flex';
      document.getElementById('ls-avg-input').style.display = 'none';
    } else if(v.mode==='average'){
      document.getElementById('ls-avg-days').value = v.avgDays||3;
      document.getElementById('ls-fixed-input').style.display = 'none';
      document.getElementById('ls-avg-input').style.display = 'flex';
    }
  });
}
