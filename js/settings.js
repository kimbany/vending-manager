// ─── 설정 관련 함수 ──────────────────────────────────────────────────────────

// ─── 설정 탭 초기화 ──────────────────────────────────────────────────────────
function initSettingsTab(){
  renderProfileSummary();
  loadLowStockSetting();
}

// 하위호환: 이전 탭 전환 함수
function switchSettingsSub(sub){
  if(sub==='profile'){ renderProfileSummary(); loadLowStockSetting(); renderVmmsAccountStatus(); renderCoupangAccountStatus(); }
  if(sub==='machines') renderMachinesList();
}

// ─── 1. 내 정보 ────────────────────────────────────────────────────────────────
function renderProfileSummary(){
  if(!currentUser) return;
  // 이전 유저 DOM 캐시 초기화
  var detailEl = document.getElementById('set-prof-detail');
  var fullEl = document.getElementById('set-prof-full-info');
  var manageBtn = document.getElementById('set-prof-manage-btn');
  var editArea = document.getElementById('set-prof-edit-area');
  var editBtn = document.getElementById('set-prof-edit-btn');
  var editLock = document.getElementById('set-prof-edit-lock');
  var editForm = document.getElementById('set-prof-edit-form');
  if(detailEl) detailEl.style.display = 'none';
  if(fullEl) fullEl.innerHTML = '';
  if(manageBtn) manageBtn.textContent = '관리';
  if(editArea) editArea.style.display = 'none';
  if(editBtn) editBtn.textContent = '정보 수정';
  if(editLock) editLock.style.display = 'block';
  if(editForm) editForm.style.display = 'none';

  db.ref('users/'+currentUser.uid+'/profile').once('value').then(function(snap){
    if(!currentUser || currentUser.uid !== auth.currentUser.uid) return;
    var p = snap.val()||{};
    var nameEl = document.getElementById('set-prof-name');
    var emailEl = document.getElementById('set-prof-email');
    if(nameEl) nameEl.textContent = p.username||p.name||'사용자';
    if(emailEl) emailEl.textContent = p.email||currentUser.email||'';
  });
}

// 하위호환: renderProfileInfo
function renderProfileInfo(){ renderProfileSummary(); }

function toggleProfileDetail(){
  var detail = document.getElementById('set-prof-detail');
  var btn = document.getElementById('set-prof-manage-btn');
  var isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen ? '관리' : '닫기';
  if(!isOpen) renderProfileFullInfo();
  // 닫을 때 수정 영역도 닫기
  if(isOpen){
    document.getElementById('set-prof-edit-area').style.display='none';
    document.getElementById('set-prof-edit-btn').textContent='정보 수정';
  }
}

function renderProfileFullInfo(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/profile').once('value').then(function(snap){
    var p = snap.val()||{};
    var el = document.getElementById('set-prof-full-info');
    if(!el) return;
    el.innerHTML = [
      ['이름', p.name||'-'],
      ['아이디', p.username||'-'],
      ['이메일', p.email||currentUser.email||'-'],
      ['연락처', p.phone||'-'],
      ['가입일', p.createdAt ? p.createdAt.slice(0,10) : '-']
    ].map(function(row){
      return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">'+
        '<span style="color:var(--text2)">'+row[0]+'</span>'+
        '<span style="font-weight:600">'+row[1]+'</span></div>';
    }).join('');
  });
}

function toggleProfileEdit(){
  var area = document.getElementById('set-prof-edit-area');
  var btn = document.getElementById('set-prof-edit-btn');
  var isOpen = area.style.display !== 'none';
  area.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen ? '정보 수정' : '취소';
  if(!isOpen){
    // 초기화
    document.getElementById('set-prof-edit-lock').style.display='block';
    document.getElementById('set-prof-edit-form').style.display='none';
    document.getElementById('set-prof-lock-pw').value='';
    document.getElementById('set-prof-lock-msg').textContent='';
  }
}

function unlockProfileEdit(){
  verifyPin(function(){
    document.getElementById('set-prof-edit-lock').style.display='none';
    document.getElementById('set-prof-edit-form').style.display='block';
    db.ref('users/'+currentUser.uid+'/profile').once('value').then(function(snap){
      var p = snap.val()||{};
      document.getElementById('set-prof-email-input').value = p.email||currentUser.email||'';
      document.getElementById('set-prof-phone-input').value = p.phone||'';
    });
    var el;
    el=document.getElementById('set-prof-cur-pw'); if(el) el.value='';
    el=document.getElementById('set-prof-new-pw'); if(el) el.value='';
    el=document.getElementById('set-prof-new-pw2'); if(el) el.value='';
    el=document.getElementById('set-prof-pw-strength'); if(el) el.textContent='';
    el=document.getElementById('set-prof-save-msg'); if(el) el.textContent='';
  });
}

function checkSetNewPw(){
  var pw = document.getElementById('set-prof-new-pw').value;
  var el = document.getElementById('set-prof-pw-strength');
  var ok = /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw) && pw.length>=8;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.textContent = pw ? (ok ? '✅ 사용 가능' : '❌ 영문+숫자 8자 이상') : '';
}

function saveProfileAll(){
  var email = document.getElementById('set-prof-email-input').value.trim();
  var phone = document.getElementById('set-prof-phone-input').value.trim();
  var curPw = document.getElementById('set-prof-cur-pw').value;
  var newPw = document.getElementById('set-prof-new-pw').value;
  var newPw2 = document.getElementById('set-prof-new-pw2').value;
  var msg = document.getElementById('set-prof-save-msg');

  if(!email){ msg.style.color='var(--red)'; msg.textContent='이메일을 입력하세요'; return; }

  // 비밀번호 변경 체크 (입력된 경우만)
  var changePw = !!(newPw || newPw2);
  if(changePw){
    if(!curPw){ msg.style.color='var(--red)'; msg.textContent='현재 비밀번호를 입력하세요'; return; }
    if(newPw !== newPw2){ msg.style.color='var(--red)'; msg.textContent='새 비밀번호가 일치하지 않아요'; return; }
    if(!/[a-zA-Z]/.test(newPw)||!/[0-9]/.test(newPw)||newPw.length<8){
      msg.style.color='var(--red)'; msg.textContent='새 비밀번호: 영문+숫자 8자 이상'; return;
    }
  }

  msg.style.color='var(--text2)'; msg.textContent='저장 중...';

  var doSave = function(){
    var updates = {email:email, phone:phone};
    var promises = [db.ref('users/'+currentUser.uid+'/profile').update(updates)];
    // 이메일 변경 시 인증 메일 발송
    if(email !== currentUser.email){
      promises.push(currentUser.verifyBeforeUpdateEmail(email));
    }
    // 비밀번호 변경
    if(changePw){
      promises.push(currentUser.updatePassword(newPw));
    }
    Promise.all(promises).then(function(){
      var notice = '';
      if(email !== currentUser.email) notice = ' 새 이메일로 인증 메일을 보냈어요.';
      if(changePw) notice += ' 비밀번호가 변경되었어요.';
      msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료.' + notice;
      renderProfileSummary();
      renderProfileFullInfo();
      // 비밀번호 필드 초기화
      document.getElementById('set-prof-cur-pw').value='';
      document.getElementById('set-prof-new-pw').value='';
      document.getElementById('set-prof-new-pw2').value='';
      document.getElementById('set-prof-pw-strength').textContent='';
    }).catch(function(e){
      msg.style.color='var(--red)';
      if(e.code==='auth/requires-recent-login') msg.textContent='보안을 위해 다시 로그인 후 시도해주세요';
      else if(e.code==='auth/invalid-email') msg.textContent='이메일 형식이 올바르지 않아요';
      else if(e.code==='auth/email-already-in-use') msg.textContent='이미 사용 중인 이메일이에요';
      else if(e.code==='auth/wrong-password') msg.textContent='현재 비밀번호가 올바르지 않아요';
      else if(e.code==='auth/weak-password') msg.textContent='비밀번호가 너무 약해요';
      else msg.textContent='저장 실패: '+e.message;
    });
  };

  // 비밀번호 변경 시 재인증 필요
  if(changePw){
    var cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, curPw);
    currentUser.reauthenticateWithCredential(cred).then(doSave).catch(function(){
      msg.style.color='var(--red)'; msg.textContent='현재 비밀번호가 올바르지 않아요';
    });
  } else {
    doSave();
  }
}

// ─── 2. 메뉴 토글 ──────────────────────────────────────────────────────────────
function toggleSettingsMenu(section){
  var menu = document.getElementById('set-menu-'+section);
  var arrow = document.getElementById('set-arrow-'+section);
  if(!menu) return;
  var isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if(arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
  // 섹션별 초기화
  if(!isOpen){
    if(section==='security') initSecuritySection();
    if(section==='machines') renderMachinesList();
  }
}

function toggleSettingsSub(sub){
  var el = document.getElementById('set-sub-'+sub);
  var arrow = document.getElementById('set-arrow-'+sub);
  if(!el) return;
  var isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'block';
  if(arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
  if(!isOpen && sub==='machine-manage') renderMachinesList();
}

// ─── 계정 수정 통합 모달 (VMMS / 쿠팡) ──────────────────────────────────────
var _acctEditType = '';

function openAccountEditModal(type){
  _acctEditType = type;
  document.getElementById('acct-lock').style.display = 'block';
  document.getElementById('acct-form').style.display = 'none';
  document.getElementById('acct-lock-pw').value = '';
  document.getElementById('acct-lock-msg').textContent = '';
  document.getElementById('acct-id').value = '';
  document.getElementById('acct-pw').value = '';
  document.getElementById('acct-pw').type = 'password';
  document.getElementById('acct-pw-eye').textContent = '👁';
  document.getElementById('acct-msg').textContent = '';
  if(type==='vmms'){
    document.getElementById('acct-modal-title').textContent = '🔗 VMMS 계정 설정';
    document.getElementById('acct-id-label').textContent = 'VMMS 아이디';
    document.getElementById('acct-pw-label').textContent = 'VMMS 비밀번호';
    document.getElementById('acct-id').placeholder = 'VMMS 로그인 아이디';
    document.getElementById('acct-pw').placeholder = 'VMMS 로그인 비밀번호';
  } else {
    document.getElementById('acct-modal-title').textContent = '🛒 쿠팡 계정 설정';
    document.getElementById('acct-id-label').textContent = '쿠팡 이메일';
    document.getElementById('acct-pw-label').textContent = '쿠팡 비밀번호';
    document.getElementById('acct-id').placeholder = '쿠팡 로그인 이메일';
    document.getElementById('acct-pw').placeholder = '쿠팡 로그인 비밀번호';
  }
  openModal('account-edit-modal');
}

function unlockAccountEdit(){
  verifyPin(function(){
    document.getElementById('acct-lock').style.display = 'none';
    document.getElementById('acct-form').style.display = 'block';
    _loadAccountData();
  });
}

function _loadAccountData(){
  if(_acctEditType==='vmms'){
    db.ref('users/'+currentUser.uid+'/vmms').once('value').then(function(snap){
      var v = snap.val()||{};
      if(v.id && v.pw){
        Promise.all([decryptAES(v.id, currentUser.uid), decryptAES(v.pw, currentUser.uid)]).then(function(r){
          document.getElementById('acct-id').value = r[0]||'';
          document.getElementById('acct-pw').value = r[1]||'';
        });
      }
    });
  } else {
    db.ref('users/'+currentUser.uid+'/coupangAccount').once('value').then(function(snap){
      var v = snap.val()||{};
      if(v.email && v.pw){
        try {
          document.getElementById('acct-id').value = atob(v.email);
          document.getElementById('acct-pw').value = atob(v.pw);
        } catch(e){}
      }
    });
  }
}

function toggleAcctPwVisible(){
  var inp = document.getElementById('acct-pw');
  var eye = document.getElementById('acct-pw-eye');
  if(inp.type==='password'){ inp.type='text'; eye.textContent='🙈'; }
  else { inp.type='password'; eye.textContent='👁'; }
}

function saveAccountEdit(){
  var id = document.getElementById('acct-id').value.trim();
  var pw = document.getElementById('acct-pw').value;
  var msg = document.getElementById('acct-msg');
  if(!id||!pw){ msg.style.color='var(--red)'; msg.textContent='아이디와 비밀번호를 입력하세요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='암호화 저장 중...';
  if(_acctEditType==='vmms'){
    Promise.all([encryptAES(id, currentUser.uid), encryptAES(pw, currentUser.uid)]).then(function(r){
      return db.ref('users/'+currentUser.uid+'/vmms').set({id:r[0], pw:r[1], updatedAt:new Date().toISOString()});
    }).then(function(){
      msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료';
      setTimeout(function(){ closeModal('account-edit-modal'); renderVmmsAccountStatus(); }, 1000);
    }).catch(function(){ msg.style.color='var(--red)'; msg.textContent='저장 실패'; });
  } else {
    db.ref('users/'+currentUser.uid+'/coupangAccount').set({
      email: btoa(id), pw: btoa(pw), updatedAt: new Date().toISOString()
    }).then(function(){
      msg.style.color='var(--green)'; msg.textContent='✅ 저장 완료';
      setTimeout(function(){ closeModal('account-edit-modal'); renderCoupangAccountStatus(); }, 1000);
    }).catch(function(){ msg.style.color='var(--red)'; msg.textContent='저장 실패'; });
  }
}

function initSecuritySection(){
  renderVmmsAccountStatus();
  renderMailForwardStatus();
}

function renderVmmsAccountStatus(){
  var el = document.getElementById('vmms-account-status');
  var btn = document.getElementById('vmms-account-btn');
  if(!el || !currentUser) return;
  db.ref('users/'+currentUser.uid+'/vmms').once('value').then(function(snap){
    var v = snap.val()||{};
    if(v.id){
      decryptAES(v.id, currentUser.uid).then(function(decId){
        var masked = decId ? decId.slice(0,3)+'••••••' : '등록됨';
        el.textContent = '등록됨: '+masked;
        if(btn) btn.textContent = 'VMMS 계정 변경';
      }).catch(function(){
        // 복호화 실패해도 데이터가 있으면 등록됨으로 표시
        el.textContent = '등록됨';
        if(btn) btn.textContent = 'VMMS 계정 변경';
      });
    } else {
      el.textContent = '미등록 · VMMS 계정을 등록하면 판매 데이터가 자동 수집됩니다';
      if(btn) btn.textContent = 'VMMS 계정 등록';
    }
  }).catch(function(){
    // DB 읽기 실패 시 기본값 유지
  });
}

function renderCoupangAccountStatus(){
  // 기존 쿠팡 계정 UI 는 제거됨 — 대신 메일 연동 상태 표시
  renderMailForwardStatus();
}

function renderMailForwardStatus(){
  var el = document.getElementById('mail-forward-status');
  var btn = document.getElementById('mail-forward-settings-btn');
  if(!el || !currentUser) return;
  // DB 직접 읽기가 보안 규칙에 막힐 수 있으므로 Cloud Function 경유
  var fn = firebase.app().functions('asia-northeast3').httpsCallable('getMailForwardAddress', {timeout:15000});
  fn({}).then(function(result){
    var d = (result && result.data) || {};
    if(d.address){
      var lastAt = d.last_received_at || '';
      if(lastAt){
        el.innerHTML = '<span style="color:var(--green)">✅ 연동됨</span> · 마지막 수신: '+lastAt;
      } else {
        el.innerHTML = '<span style="color:#FF9800">⏳ 주소 발급됨</span> · 아직 수신 기록 없음';
      }
      if(btn) btn.textContent = '메일 연동 설정 변경';
    } else {
      el.textContent = '미설정 · 쿠팡 메일 연동을 하면 주문이 자동 수집됩니다';
      if(btn) btn.textContent = '메일 연동 설정';
    }
  }).catch(function(){
    // 실패 시 기본값 유지
  });
}

function resetVmmsLock(){}

function saveGithubPat(){
  var pat = document.getElementById('ev-github-pat').value.trim();
  if(!pat){showToast('❌ 토큰을 입력하세요');return;}
  db.ref('users/'+currentUser.uid+'/settings/githubPat').set(pat).then(function(){
    showToast('✅ GitHub 토큰 저장 완료');
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
  else { if(typeof loadVmmsProductData==='function') loadVmmsProductData(); }
}

// ─── 데이터 이전 (하위호환) ──────────────────────────────────────────────────
function checkMigrationV2(){
  if(!currentUser) return;
  var dismissed = localStorage.getItem('migrateDismissed_v2_' + currentUser.uid);
  if(dismissed) return;
  Promise.all([
    db.ref('users/'+currentUser.uid+'/appData').once('value'),
    db.ref('users/'+currentUser.uid+'/machines').once('value')
  ]).then(function(results){
    var appSnap = results[0], machSnap = results[1];
    var hasAppData = appSnap.exists() && appSnap.val() && appSnap.val().products && appSnap.val().products.length;
    var hasMachines = machSnap.exists() && machSnap.val() && Object.keys(machSnap.val()).length;
    if(!hasAppData && !hasMachines) return;
    var sources = [];
    if(hasAppData) sources.push({type:'appData', label:'공통 데이터', ref:'appData'});
    if(hasMachines){
      machSnap.forEach(function(child){
        var m = child.val();
        if(m && m.name) sources.push({type:'machine', label:'🏪 '+m.name, ref:child.key, data:m});
      });
    }
    db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(locSnap){
      var sel = document.getElementById('migrate-target');
      if(!sel) return;
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
  var srcPath = srcType==='machine'
    ? db.ref('users/'+currentUser.uid+'/machines/'+srcRef)
    : db.ref('users/'+currentUser.uid+'/appData');
  srcPath.once('value').then(function(snap){
    var val = snap.val();
    if(srcType==='machine' && val && val.appData) val = val.appData;
    if(!val||!val.products||!val.products.length){
      showToast('❌ 이전할 데이터가 없어요'); return;
    }
    var destPath = db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+machineId+'/appData');
    return destPath.set({
      products: val.products||[], inventory: val.inventory||[],
      inventoryLogs: val.inventoryLogs||[], salesData: val.salesData||[]
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

// ─── 비밀번호 변경 (하위호환 - 모달용) ───────────────────────────────────────
function checkNewPw(){
  var pw = document.getElementById('cp-new').value;
  var el = document.getElementById('cp-strength');
  if(!el) return;
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
  }).catch(function(e){ msg.style.color='var(--red)'; msg.textContent=e.message; });
}

// 하위호환: 모달 프로필 함수들
function openEditProfileModal(){ toggleProfileDetail(); }
function closeEditProfileModal(){}
function switchEpTab(){}
function unlockEditProfile(){}
function loadProfileForEdit(){}
function initEpBirthSelects(){}
function saveProfile(){}

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

// ─── 4. 초기화 ──────────────────────────────────────────────────────────────────
var _resetDescriptions = {
  inventory: {title:'📦 재고 초기화', desc:'모든 자판기의 재고 수량과 재고 기록(입출고 로그)이 삭제됩니다.'},
  products:  {title:'🏷️ 제품 초기화', desc:'등록된 모든 제품과 컬럼 매칭이 삭제됩니다. VMMS에서 다시 수집하면 복구할 수 있습니다.'},
  sales:     {title:'📊 판매 내역 초기화', desc:'모든 자판기의 판매 내역이 삭제됩니다.'},
  coupang:   {title:'🛒 쿠팡 입고 데이터 초기화', desc:'쿠팡 주문 데이터, 구매 내역(미입고 포함), 제품 매핑이 삭제됩니다. 메일 연동 설정은 유지됩니다.'},
  all:       {title:'🗑️ 전체 초기화', desc:'재고, 제품, 판매내역, 자판기 위치, 자판기 단말기, VMMS 계정, 쿠팡 데이터가 모두 삭제됩니다. 내 정보와 메일 연동 설정은 유지됩니다.'}
};

function openResetConfirm(type){
  var info = _resetDescriptions[type];
  if(!info) return;
  document.getElementById('reset-modal-title').textContent='⚠️ '+info.title;
  document.getElementById('reset-modal-desc').textContent=info.desc;
  document.getElementById('reset-type').value=type;
  document.getElementById('reset-msg').textContent='';
  openModal('reset-confirm-modal');
}

function executeReset(){
  var type = document.getElementById('reset-type').value;
  var msg = document.getElementById('reset-msg');
  verifyPin(function(){
    msg.style.color='var(--text2)'; msg.textContent='초기화 중...';
    db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
  }).then(function(snap){
    var locations = snap.val()||{};
    var updates = {};

    if(type==='inventory' || type==='all'){
      // 모든 자판기의 재고 관련 데이터 삭제
      Object.keys(locations).forEach(function(locId){
        var machines = locations[locId].machines||{};
        Object.keys(machines).forEach(function(mid){
          updates['locations/'+locId+'/machines/'+mid+'/appData/inventory'] = null;
          updates['locations/'+locId+'/machines/'+mid+'/appData/inventoryLogs'] = null;
          updates['locations/'+locId+'/machines/'+mid+'/appData/stockIn'] = null;
          updates['locations/'+locId+'/machines/'+mid+'/appData/stockDeductions'] = null;
          updates['locations/'+locId+'/machines/'+mid+'/appData/salesCost'] = null;
        });
      });
    }

    if(type==='products' || type==='all'){
      // 모든 자판기의 products 삭제
      Object.keys(locations).forEach(function(locId){
        var machines = locations[locId].machines||{};
        Object.keys(machines).forEach(function(mid){
          updates['locations/'+locId+'/machines/'+mid+'/appData/products'] = null;
        });
      });
      // vmmsColumns 삭제 (컬럼 매칭) + vmmsProducts (제품 마스터) + doubleColumns (2칸 설정)
      updates['vmmsColumns'] = null;
      updates['vmmsProducts'] = null;
      updates['doubleColumns'] = null;
    }

    if(type==='sales' || type==='all'){
      // 모든 자판기의 salesData 삭제
      Object.keys(locations).forEach(function(locId){
        var machines = locations[locId].machines||{};
        Object.keys(machines).forEach(function(mid){
          updates['locations/'+locId+'/machines/'+mid+'/appData/salesData'] = null;
        });
      });
    }

    if(type==='coupang' || type==='all'){
      // 쿠팡 관련 데이터 삭제 (메일 연동 설정은 유지)
      updates['purchases'] = null;
      updates['coupangOrders'] = null;
      updates['productMapping'] = null;
      updates['coupangAccount'] = null;
    }

    if(type==='all'){
      // 자판기 위치/단말기 전부 삭제
      updates['locations'] = null;
      updates['mainLocationId'] = null;
      // VMMS 삭제
      updates['vmms'] = null;
      updates['vmmsMachines'] = null;
      updates['vmmsColumns'] = null;
      updates['doubleColumns'] = null;
      // 재고 부족 기준 기본값
      updates['settings/lowStock'] = {mode:'fixed', fixedQty:10};
    }

    return db.ref('users/'+currentUser.uid).update(updates);
  }).then(function(){
    msg.style.color='var(--green)'; msg.textContent='✅ 초기화 완료';
    // 현재 데이터 초기화
    if(type==='inventory' || type==='all'){
      D.inventory=[]; D.inventoryLogs=[]; D.stockIn=[]; D.stockDeductions=[]; D.salesCost=[];
    }
    if(type==='products' || type==='all'){
      D.products=[];
      // VMMS 메모리 데이터도 초기화
      if(typeof _vmmsProducts !== 'undefined') _vmmsProducts = [];
      if(typeof _vmmsColumns !== 'undefined') _vmmsColumns = {};
      if(typeof _vmmsMachines !== 'undefined') _vmmsMachines = [];
    }
    if(type==='sales' || type==='all'){
      D.salesData=[];
    }
    if(type==='coupang' || type==='all'){
      if(typeof _productMappings !== 'undefined') _productMappings = [];
    }
    if(type==='all'){
      currentLocationId=null; currentMachineId=null;
      _lowStockThreshold=10;
    }
    renderAll();
    if(type==='all') loadLocationDropdown();
    setTimeout(function(){ closeModal('reset-confirm-modal'); showToast('✅ 초기화 완료'); }, 1200);
    }).catch(function(e){
      msg.style.color='var(--red)'; msg.textContent='오류: '+e.message;
    });
  });
}
