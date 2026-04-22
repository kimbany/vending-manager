// ─── Google Auth Provider ─────────────────────────────────────────────────────
var googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
var _pendingGoogleCred = null;

// ─── Auth 상태 감지 ──────────────────────────────────────────────────────────
var _lastUid = null;
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
  _lastUid = user.uid;
  currentUser = user;
  REF = db.ref('users/' + user.uid + '/appData');
  CRAWL_REF = db.ref('users/' + user.uid + '/crawledSales');
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
    if(!pin){
      showOnboarding(profile);
      return;
    }
    loadUserData();
  });
});

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
