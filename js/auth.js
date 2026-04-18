// ─── Google Auth Provider ─────────────────────────────────────────────────────
var googleProvider = new firebase.auth.GoogleAuthProvider();
var _pendingGoogleCred = null;

// ─── Auth 상태 감지 ──────────────────────────────────────────────────────────
auth.onAuthStateChanged(function(user){
  document.getElementById('loading').style.display='none';
  if(!user){
    showAuthScreen();
    return;
  }
  currentUser = user;
  REF = db.ref('users/' + user.uid + '/appData');
  CRAWL_REF = db.ref('users/' + user.uid + '/crawledSales');
  // 프로필 없으면 자동 생성 (구글 신규 가입)
  db.ref('users/' + user.uid + '/profile').once('value').then(function(snap){
    if(!snap.exists()){
      db.ref('users/' + user.uid + '/profile').set({
        name: user.displayName || '',
        email: user.email || '',
        createdAt: new Date().toISOString()
      });
    }
  });
  loadUserData();
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

// ─── 구글 재인증 (보안 기능용) ───────────────────────────────────────────────
function reauthWithGoogle(){
  return currentUser.reauthenticateWithPopup(googleProvider);
}

// ─── 로그아웃 ─────────────────────────────────────────────────────────────────
function doLogout(){
  if(!confirm('로그아웃 할까요?')) return;
  auth.signOut();
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
