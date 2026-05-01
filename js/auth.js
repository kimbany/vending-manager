// ─── Google Auth Provider ─────────────────────────────────────────────────────
var googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
var _pendingGoogleCred = null;

// ─── Auth 상태 감지 ──────────────────────────────────────────────────────────
var _lastUid = null;
var _adminSyncRefs = {}, _adminSyncHandlers = {};
function detachAdminSync(){
  Object.keys(_adminSyncRefs).forEach(function(k){
    try{ _adminSyncRefs[k].off('value', _adminSyncHandlers[k]); }catch(e){}
  });
  _adminSyncRefs = {}; _adminSyncHandlers = {};
}
auth.onAuthStateChanged(function(user){
  document.getElementById('loading').style.display='none';
  if(!user){
    // 이전에 로그인된 상태였다면 새로고침 (DOM 캐시 제거)
    if(_lastUid){ location.reload(); return; }
    showAuthScreen();
    return;
  }
  // 다른 유저로 변경된 경우 새로고침
  if(_lastUid && _lastUid !== user.uid){ location.reload(); return; }
  // 탈퇴 후 재가입 차단 기간 확인
  checkWithdrawalBlock(user).then(function(blocked){
    if(blocked) return; // 차단된 경우 signOut 처리 됨
    _lastUid = user.uid;
    currentUser = user;
    REF = db.ref('users/' + user.uid + '/appData');
    CRAWL_REF = db.ref('users/' + user.uid + '/crawledSales');
    _continueAuth(user);
  }).catch(function(e){
    console.warn('탈퇴 차단 확인 실패:', e);
    // 확인 실패 시에도 진행 (서비스 가용성 우선)
    _lastUid = user.uid;
    currentUser = user;
    REF = db.ref('users/' + user.uid + '/appData');
    CRAWL_REF = db.ref('users/' + user.uid + '/crawledSales');
    _continueAuth(user);
  });
});

function _continueAuth(user){
  db.ref('users/' + user.uid).once('value').then(function(snap){
    var val = snap.val()||{};
    var profile = val.profile||{};
    var pin = val.settings && val.settings.securityPin;
    if(!profile.name && !profile.email){
      db.ref('users/' + user.uid + '/profile').set({
        name: user.displayName || '',
        email: user.email || '',
        createdAt: new Date().toISOString()
      });
    }
    // 관리자 페이지용: 사용자 요약 정보 저장 (로그인 시 1회)
    db.ref('adminUsers/' + user.uid).update({
      name: profile.name || user.displayName || '',
      email: profile.email || user.email || '',
      phone: profile.phone || '',
      createdAt: profile.createdAt || new Date().toISOString(),
      lastLogin: new Date().toISOString()
    }).catch(function(e){ console.warn('adminUsers profile update failed:', e); });

    // 위치/자판기/VMMS/프로필 변경 시 자동 동기화 (실시간)
    detachAdminSync();
    _adminSyncRefs.profile = db.ref('users/' + user.uid + '/profile');
    _adminSyncHandlers.profile = function(s){
      var p = s.val() || {};
      db.ref('adminUsers/' + user.uid).update({
        name: p.name || user.displayName || '',
        email: p.email || user.email || '',
        phone: p.phone || ''
      }).catch(function(e){ console.warn('adminUsers profile sync failed:', e); });
    };
    _adminSyncRefs.profile.on('value', _adminSyncHandlers.profile);

    var uid = user.uid;
    var state = {
      locs: null, vmms: null, vmmsProds: null, legacy: null,
      locsLoaded: false, vmmsLoaded: false, vmmsProdsLoaded: false, legacyLoaded: false
    };
    var pushAdminPayload = function(){
      if(!state.locsLoaded || !state.vmmsLoaded || !state.vmmsProdsLoaded || !state.legacyLoaded) return;
      var payload = buildAdminMachinesPayload(state.locs, state.vmms, state.vmmsProds, state.legacy);
      db.ref('adminUsers/' + uid).update(payload)
        .catch(function(e){ console.warn('adminUsers machines sync failed:', e); });
    };
    _adminSyncRefs.locs = db.ref('users/' + uid + '/locations');
    _adminSyncHandlers.locs = function(s){ state.locs = s.val(); state.locsLoaded = true; pushAdminPayload(); };
    _adminSyncRefs.locs.on('value', _adminSyncHandlers.locs);

    _adminSyncRefs.vmms = db.ref('users/' + uid + '/vmmsColumns');
    _adminSyncHandlers.vmms = function(s){
      var v = s.val() || {};
      state.vmms = (v && v.machines) ? v.machines : {};
      state.vmmsLoaded = true; pushAdminPayload();
    };
    _adminSyncRefs.vmms.on('value', _adminSyncHandlers.vmms);

    _adminSyncRefs.vmmsProds = db.ref('users/' + uid + '/vmmsProducts/items');
    _adminSyncHandlers.vmmsProds = function(s){
      var v = s.val();
      state.vmmsProds = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
      state.vmmsProdsLoaded = true; pushAdminPayload();
    };
    _adminSyncRefs.vmmsProds.on('value', _adminSyncHandlers.vmmsProds);

    _adminSyncRefs.legacy = db.ref('users/' + uid + '/appData/products');
    _adminSyncHandlers.legacy = function(s){
      var v = s.val();
      state.legacy = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
      state.legacyLoaded = true; pushAdminPayload();
    };
    _adminSyncRefs.legacy.on('value', _adminSyncHandlers.legacy);

    if(!pin){
      showOnboarding(profile);
      return;
    }
    loadUserData();
  });
}

// 위치 데이터 + VMMS → adminUsers 자판기 페이로드 변환
// 제품수: appData.products ∪ vmmsColumns 컬럼 (이름 기준 합집합).
// 자판기에 매칭되는 vmmsColumns가 없고 자판기가 1대뿐이면 vmmsProducts 마스터 / legacy appData/products 까지 fallback.
function buildAdminMachinesPayload(locs, vmmsCols, vmmsProds, legacyProds){
  locs = locs || {};
  vmmsCols = vmmsCols || {};
  vmmsProds = Array.isArray(vmmsProds) ? vmmsProds : [];
  legacyProds = Array.isArray(legacyProds) ? legacyProds : [];

  var machines = [];
  var locKeys = Object.keys(locs);
  var totalMachineCount = 0;
  locKeys.forEach(function(lid){
    var loc = locs[lid];
    if(!loc || typeof loc !== 'object') return;
    totalMachineCount += Object.keys(loc.machines || {}).length;
  });

  locKeys.forEach(function(lid){
    var loc = locs[lid];
    if(!loc || typeof loc !== 'object') return;
    var locName = loc.name || lid;
    var ms = loc.machines || {};
    Object.keys(ms).forEach(function(mid){
      var m = ms[mid] || {};
      var seen = {};
      var sources = [];

      // (1) appData.products 수동 등록 제품
      var appData = m.appData || {};
      var prods = appData.products || [];
      if(!Array.isArray(prods) && prods && typeof prods === 'object') prods = Object.values(prods);
      var addedFromApp = 0;
      if(Array.isArray(prods)){
        prods.forEach(function(p){
          if(!p) return;
          var key = (p.name || p.id || '').toString().trim().toLowerCase();
          if(key && !seen[key]){ seen[key] = true; addedFromApp++; }
        });
      }
      if(addedFromApp) sources.push('app');

      // (2) vmmsColumns 매칭 (deviceNos 기준)
      var devnos = Array.isArray(m.deviceNos) ? m.deviceNos : (m.deviceNo ? [m.deviceNo] : []);
      var addedFromCols = 0;
      devnos.forEach(function(dn){
        var colData = vmmsCols[dn];
        if(!colData) return;
        var cols = colData.columns || [];
        if(!Array.isArray(cols) && cols && typeof cols === 'object') cols = Object.values(cols);
        cols.forEach(function(c){
          if(!c || !c.productName) return;
          var key = String(c.productName).trim().toLowerCase();
          if(key && !seen[key]){ seen[key] = true; addedFromCols++; }
        });
      });
      if(addedFromCols) sources.push('vmmsColumns');

      // (3) Fallback: 위 두 소스로 0개이고 자판기가 1대뿐이면 사용자 전체 VMMS/legacy 제품 사용
      if(Object.keys(seen).length === 0 && totalMachineCount === 1){
        var addedFromMaster = 0;
        vmmsProds.forEach(function(p){
          if(!p) return;
          var name = (p.productName || p.name || '').toString().trim().toLowerCase();
          if(name && !seen[name]){ seen[name] = true; addedFromMaster++; }
        });
        if(addedFromMaster) sources.push('vmmsProducts');

        var addedFromLegacy = 0;
        legacyProds.forEach(function(p){
          if(!p) return;
          var name = (p.name || p.id || '').toString().trim().toLowerCase();
          if(name && !seen[name]){ seen[name] = true; addedFromLegacy++; }
        });
        if(addedFromLegacy) sources.push('legacy');
      }

      machines.push({
        locationName: locName,
        machineName: m.name || mid,
        model: m.model || '',
        productCount: Object.keys(seen).length,
        deviceNos: devnos.join(','),
        productSources: sources.join('+') || 'none'
      });
    });
  });
  return { machines: machines, machineCount: machines.length };
}

// ─── Auth 화면 제어 ───────────────────────────────────────────────────────────
function showAuthScreen(){
  document.getElementById('auth-screen').style.display='block';
  document.getElementById('verify-screen').style.display='none';
  document.getElementById('app').style.display='none';
  var loginForm = document.getElementById('auth-login-form');
  var migrateForm = document.getElementById('auth-migrate-form');
  if(loginForm) loginForm.style.display='block';
  if(migrateForm) migrateForm.style.display='none';
}

function showVerifyScreen(){ showAuthScreen(); }

// ─── 구글 로그인 ─────────────────────────────────────────────────────────────
function doGoogleLogin(){
  var msg = document.getElementById('login-msg');
  msg.style.color='var(--text2)'; msg.textContent='로그인 중...';

  auth.signInWithPopup(googleProvider).then(function(result){
    msg.textContent='';
  }).catch(function(e){
    if(e.code === 'auth/account-exists-with-different-credential'){
      _pendingGoogleCred = e.credential;
      var email = e.email || '';
      msg.textContent='';
      document.getElementById('auth-login-form').style.display='none';
      document.getElementById('auth-migrate-form').style.display='block';
      document.getElementById('migrate-email-display').textContent = email;
      document.getElementById('migrate-pw').value='';
      document.getElementById('migrate-msg').textContent='';
    } else if(e.code === 'auth/popup-closed-by-user'){
      msg.textContent='';
    } else if(e.code === 'auth/cancelled-popup-request'){
      msg.textContent='';
    } else {
      msg.style.color='var(--red)';
      msg.textContent='로그인 실패: ' + (e.message||'');
    }
  });
}

// ─── 기존 계정 마이그레이션 (구글 provider 연결) ──────────────────────────────
function doMigrateLink(){
  var pw = document.getElementById('migrate-pw').value;
  var msg = document.getElementById('migrate-msg');
  var email = document.getElementById('migrate-email-display').textContent;
  if(!pw){ msg.style.color='var(--red)'; msg.textContent='비밀번호를 입력하세요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='계정 연결 중...';

  auth.signInWithEmailAndPassword(email, pw).then(function(cred){
    if(_pendingGoogleCred){
      return cred.user.linkWithCredential(
        firebase.auth.GoogleAuthProvider.credential(_pendingGoogleCred.idToken)
      );
    }
    return cred;
  }).then(function(){
    _pendingGoogleCred = null;
    msg.style.color='var(--green)'; msg.textContent='✅ 구글 계정 연결 완료!';
  }).catch(function(e){
    if(e.code==='auth/wrong-password'||e.code==='auth/invalid-credential')
      msg.textContent='비밀번호가 올바르지 않아요';
    else if(e.code==='auth/provider-already-linked')
      msg.textContent='이미 구글 계정이 연결되어 있어요. 다시 로그인해주세요.';
    else
      msg.textContent='연결 실패: '+(e.message||'');
    msg.style.color='var(--red)';
  });
}

function cancelMigrate(){
  _pendingGoogleCred = null;
  showAuthScreen();
}

// ─── 온보딩 (첫 로그인 시 이름/연락처/PIN 설정) ─────────────────────────────
function showOnboarding(profile){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('verify-screen').style.display='none';
  document.getElementById('app').style.display='none';
  var el = document.getElementById('onboarding-screen');
  el.style.display='flex';
  var nameEl = document.getElementById('ob-name');
  var phoneEl = document.getElementById('ob-phone');
  if(nameEl) nameEl.value = profile.name || currentUser.displayName || '';
  if(phoneEl) phoneEl.value = profile.phone || '';
  document.getElementById('ob-pin').value='';
  document.getElementById('ob-pin2').value='';
  document.getElementById('ob-msg').textContent='';
}

function toggleObPinEye(n){
  var id = n===2 ? 'ob-pin2' : 'ob-pin';
  var eyeId = n===2 ? 'ob-pin2-eye' : 'ob-pin-eye';
  var inp = document.getElementById(id);
  var eye = document.getElementById(eyeId);
  if(inp.type==='password'){ inp.type='text'; eye.textContent='🙈'; }
  else { inp.type='password'; eye.textContent='👁'; }
}

function completeOnboarding(){
  var name = document.getElementById('ob-name').value.trim();
  var phone = document.getElementById('ob-phone').value.trim();
  var pin = document.getElementById('ob-pin').value.trim();
  var pin2 = document.getElementById('ob-pin2').value.trim();
  var msg = document.getElementById('ob-msg');
  if(!name){ msg.style.color='var(--red)'; msg.textContent='이름을 입력하세요'; return; }
  if(!pin || pin.length < 4){ msg.style.color='var(--red)'; msg.textContent='보안 PIN 4자리 이상 입력하세요'; return; }
  if(pin !== pin2){ msg.style.color='var(--red)'; msg.textContent='PIN이 일치하지 않아요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='설정 중...';
  hashSHA256(pin).then(function(hash){
    return db.ref('users/'+currentUser.uid).update({
      'profile/name': name,
      'profile/phone': phone,
      'profile/email': currentUser.email||'',
      'settings/securityPin': hash
    });
  }).then(function(){
    document.getElementById('onboarding-screen').style.display='none';
    if(currentUser.displayName !== name) currentUser.updateProfile({displayName: name});
    loadUserData();
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent='설정 실패: '+e.message;
  });
}

// ─── PIN 인증 (커스텀 모달) ──────────────────────────────────────────────────
var _pinVerifyCallback = null;

function verifyPin(callback){
  _pinVerifyCallback = callback;
  document.getElementById('pin-verify-input').value = '';
  document.getElementById('pin-verify-input').type = 'password';
  document.getElementById('pin-verify-eye').textContent = '👁';
  document.getElementById('pin-verify-msg').textContent = '';
  openModal('pin-verify-modal');
  setTimeout(function(){ document.getElementById('pin-verify-input').focus(); }, 100);
}

function togglePinVerifyEye(){
  var inp = document.getElementById('pin-verify-input');
  var eye = document.getElementById('pin-verify-eye');
  if(inp.type==='password'){ inp.type='text'; eye.textContent='🙈'; }
  else { inp.type='password'; eye.textContent='👁'; }
}

function submitPinVerify(){
  var pin = document.getElementById('pin-verify-input').value.trim();
  var msg = document.getElementById('pin-verify-msg');
  if(!pin){ msg.textContent='PIN을 입력하세요'; return; }
  hashSHA256(pin).then(function(hash){
    db.ref('users/'+currentUser.uid+'/settings/securityPin').once('value').then(function(snap){
      if(snap.val() === hash){
        closeModal('pin-verify-modal');
        if(_pinVerifyCallback){ var cb = _pinVerifyCallback; _pinVerifyCallback = null; cb(); }
      } else {
        msg.textContent='PIN이 올바르지 않아요';
      }
    });
  });
}

function reauthWithGoogle(){ return Promise.resolve(); }

// ─── 재가입 제한 (탈퇴 후 30일) ────────────────────────────────────────────
var REJOIN_BLOCK_DAYS = 30;
function _emailHashKey(email){
  return hashSHA256((email||'').toString().toLowerCase().trim());
}
// 로그인 직후, 이 계정 이메일이 탈퇴 차단 중인지 확인. 차단이면 즉시 로그아웃.
function checkWithdrawalBlock(user){
  if(!user || !user.email) return Promise.resolve(false);
  return _emailHashKey(user.email).then(function(hash){
    return db.ref('withdrawnEmails/'+hash).once('value');
  }).then(function(snap){
    var v = snap.val();
    if(!v || !v.blockedUntil) return false;
    var untilMs = new Date(v.blockedUntil).getTime();
    if(isNaN(untilMs) || Date.now() >= untilMs){
      // 만료 — 정리
      _emailHashKey(user.email).then(function(hash){
        db.ref('withdrawnEmails/'+hash).remove().catch(function(){});
      });
      return false;
    }
    // 차단 — 사용자에게 알리고 로그아웃
    var d = new Date(untilMs);
    var dStr = (d.getMonth()+1)+'월 '+d.getDate()+'일';
    alert('탈퇴 후 30일이 지나야 재가입할 수 있습니다.\n재가입 가능일: '+dStr+'\n('+v.blockedUntil.slice(0,10)+' 이후)');
    return auth.signOut().then(function(){ return true; });
  });
}

// ─── 회원 탈퇴 ─────────────────────────────────────────────────────────────
function openWithdrawModal(){
  if(!currentUser) return;
  var inp = document.getElementById('withdraw-confirm-input');
  var msg = document.getElementById('withdraw-msg');
  if(inp) inp.value = '';
  if(msg) msg.textContent = '';
  openModal('withdraw-modal');
}

function confirmWithdraw(){
  var inp = document.getElementById('withdraw-confirm-input');
  var msg = document.getElementById('withdraw-msg');
  var typed = (inp ? inp.value : '').trim();
  if(typed !== '회원탈퇴'){
    if(msg) msg.textContent = '"회원탈퇴" 를 정확히 입력해주세요';
    return;
  }
  // PIN 인증 통과해야 진행
  closeModal('withdraw-modal');
  verifyPin(function(){
    _doWithdraw();
  });
}

function _doWithdraw(){
  if(!currentUser) return;
  var uid = currentUser.uid;
  var email = currentUser.email || '';
  // 중요: 탈퇴 직후 리스너가 다시 데이터를 쓰지 않도록 분리
  if(typeof detachAdminSync === 'function') detachAdminSync();

  showToast('🔄 데이터 삭제 중...');

  var blockedUntilIso = new Date(Date.now() + REJOIN_BLOCK_DAYS*86400000).toISOString();

  // 1) 이메일 해시 + 데이터 삭제 + 재가입 차단 기록
  _emailHashKey(email).then(function(emailHash){
    return db.ref('deviceNumbers').once('value').then(function(snap){
      var devs = snap.val() || {};
      var updates = {};
      Object.keys(devs).forEach(function(d){
        if(devs[d] === uid) updates['deviceNumbers/'+d] = null;
      });
      updates['users/'+uid] = null;
      updates['adminUsers/'+uid] = null;
      // 30일 재가입 차단
      if(emailHash){
        updates['withdrawnEmails/'+emailHash] = {
          blockedUntil: blockedUntilIso,
          withdrawnAt: new Date().toISOString()
        };
      }
      return db.ref().update(updates);
    });
  }).then(function(){
    // 2) Firebase Auth 계정 삭제 (재인증 필요 시 구글 재로그인)
    return currentUser.delete().catch(function(e){
      if(e && e.code === 'auth/requires-recent-login'){
        return currentUser.reauthenticateWithPopup(googleProvider).then(function(){
          return currentUser.delete();
        });
      }
      throw e;
    });
  }).then(function(){
    alert('회원 탈퇴가 완료되었습니다.\n같은 계정으로는 30일 후부터 재가입 가능합니다.');
    location.reload();
  }).catch(function(e){
    if(e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')){
      alert('재인증이 취소되어 탈퇴를 완료하지 못했습니다.\n다시 로그인 후 시도해주세요.');
      location.reload();
      return;
    }
    alert('탈퇴 실패: '+((e && (e.message||e.code)) || '알 수 없는 오류'));
  });
}

// ─── 로그아웃 ─────────────────────────────────────────────────────────────────
function doLogout(){
  if(!confirm('로그아웃 할까요?')) return;
  // 로그아웃 후 페이지 완전 새로고침 (이전 유저의 DOM 캐시 제거)
  auth.signOut().then(function(){
    location.reload();
  }).catch(function(){
    location.reload();
  });
}

// ─── 하위호환 (사용하지 않지만 참조 에러 방지) ───────────────────────────────
function doLogin(){}
function doSignup(){}
function doFindId(){}
function doFindPw(){}
function switchAuthTab(){}
function checkVerified(){}
function resendVerify(){}
function formatPhone(el){
  var v = el.value.replace(/[^0-9]/g, '');
  if(v.length > 3 && v.length <= 7) v = v.slice(0,3) + '-' + v.slice(3);
  else if(v.length > 7) v = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7,11);
  el.value = v;
}
