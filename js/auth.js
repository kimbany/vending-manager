// ─── Auth 상태 감지 ──────────────────────────────────────────────────────────
auth.onAuthStateChanged(function(user){
  document.getElementById('loading').style.display='none';
  if(!user){
    // 로그아웃 상태 → 로그인 화면
    showAuthScreen();
    return;
  }
  currentUser = user;
  if(!user.emailVerified){
    // 이메일 미인증 → 인증 안내 화면
    showVerifyScreen(user.email);
    return;
  }
  // 로그인 + 인증 완료 → 앱 시작
  REF = db.ref('users/' + user.uid + '/appData');
  CRAWL_REF = db.ref('users/' + (currentUser ? currentUser.uid : 'anonymous') + '/crawledSales');
  loadUserData();
});

// ─── Auth 화면 제어 ───────────────────────────────────────────────────────────
function showAuthScreen(){
  document.getElementById('auth-screen').style.display='block';
  document.getElementById('verify-screen').style.display='none';
  document.getElementById('app').style.display='none';
}

function showVerifyScreen(email){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('verify-screen').style.display='flex';
  document.getElementById('app').style.display='none';
  document.getElementById('verify-email-msg').innerHTML =
    '<b>' + email + '</b> 으로 인증 링크를 보냈어요.<br/>이메일을 확인하고 링크를 클릭해주세요.';
}

function switchAuthTab(tab){
  document.getElementById('auth-login-form').style.display   = 'none';
  document.getElementById('auth-signup-form').style.display  = 'none';
  document.getElementById('auth-find-id-form').style.display = 'none';
  document.getElementById('auth-find-pw-form').style.display = 'none';

  // 선택한 폼 보이기
  if(tab==='login')   document.getElementById('auth-login-form').style.display   = 'block';
  if(tab==='signup'){
    document.getElementById('auth-signup-form').style.display  = 'block';
    initBirthSelects(); // 생년월일 드롭다운 초기화
  }
  if(tab==='find-id') document.getElementById('auth-find-id-form').style.display = 'block';
  if(tab==='find-pw') document.getElementById('auth-find-pw-form').style.display = 'block';

  // 탭 버튼 스타일
  var isLogin  = tab === 'login';
  var isSignup = tab === 'signup';
  document.getElementById('auth-tab-login').style.background  = isLogin  ? 'var(--blue)' : 'transparent';
  document.getElementById('auth-tab-login').style.color       = isLogin  ? '#1a1208' : 'var(--text2)';
  document.getElementById('auth-tab-signup').style.background = isSignup ? 'var(--blue)' : 'transparent';
  document.getElementById('auth-tab-signup').style.color      = isSignup ? '#1a1208' : 'var(--text2)';
}

// ─── 로그인 (아이디 → 이메일 조회 → Firebase 로그인) ─────────────────────────
function doLogin(){
  var uid = document.getElementById('login-uid').value.trim();
  var pw  = document.getElementById('login-pw').value;
  var msg = document.getElementById('login-msg');
  if(!uid||!pw){ msg.style.color='var(--red)'; msg.textContent='아이디와 비밀번호를 입력하세요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='로그인 중...';
  // 아이디로 UID 조회 → UID로 이메일 조회 → 로그인
  db.ref('usernames/' + uid).once('value').then(function(snap){
    if(!snap.exists()){ msg.style.color='var(--red)'; msg.textContent='존재하지 않는 아이디예요'; return; }
    var firebaseUid = snap.val();
    return db.ref('users/' + firebaseUid + '/profile/email').once('value');
  }).then(function(snap){
    if(!snap || !snap.exists()){ msg.style.color='var(--red)'; msg.textContent='계정 정보를 찾을 수 없어요'; return; }
    var email = snap.val();
    return auth.signInWithEmailAndPassword(email, pw);
  }).catch(function(e){
    msg.style.color='var(--red)';
    if(e.code==='auth/wrong-password'||e.code==='auth/invalid-credential')
      msg.textContent='비밀번호가 올바르지 않아요';
    else if(e.code==='auth/too-many-requests')
      msg.textContent='로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요';
    else msg.textContent = e.message || '로그인 실패';
  });
}

// ─── 아이디 찾기 ──────────────────────────────────────────────────────────────
function doFindId(){
  var name  = document.getElementById('fi-name').value.trim();
  var email = document.getElementById('fi-email').value.trim();
  var birth = document.getElementById('fi-birth').value;
  var msg   = document.getElementById('find-id-msg');
  if(!name||!email||!birth){ msg.style.color='var(--red)'; msg.textContent='모든 항목을 입력하세요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='찾는 중...';

  // users 전체에서 이름+이메일+생년월일 일치하는 유저 찾기
  db.ref('users').once('value').then(function(snap){
    var found = null;
    snap.forEach(function(child){
      var p = child.val().profile;
      if(p && p.name===name && p.email===email && p.birth===birth){
        found = p.username;
      }
    });
    if(found){
      msg.style.color='var(--green)';
      msg.innerHTML = '✅ 아이디: <b style="font-size:16px;color:var(--blue)">' + found + '</b>';
    } else {
      msg.style.color='var(--red)'; msg.textContent='일치하는 계정을 찾을 수 없어요';
    }
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent='조회 실패: ' + e.message;
  });
}

// ─── 비밀번호 찾기 (아이디 + 이메일 확인 후 재설정 메일) ──────────────────────
function doFindPw(){
  var uid   = document.getElementById('fp-uid').value.trim();
  var email = document.getElementById('fp-email').value.trim();
  var msg   = document.getElementById('find-pw-msg');
  if(!uid||!email){ msg.style.color='var(--red)'; msg.textContent='아이디와 이메일을 입력하세요'; return; }
  msg.style.color='var(--text2)'; msg.textContent='확인 중...';

  // 아이디로 UID 조회 후 이메일 일치 확인
  db.ref('usernames/' + uid).once('value').then(function(snap){
    if(!snap.exists()){ msg.style.color='var(--red)'; msg.textContent='존재하지 않는 아이디예요'; return Promise.reject('no-user'); }
    return db.ref('users/' + snap.val() + '/profile/email').once('value');
  }).then(function(snap){
    if(!snap||!snap.exists()){ return Promise.reject('no-email'); }
    if(snap.val() !== email){ msg.style.color='var(--red)'; msg.textContent='아이디와 이메일이 일치하지 않아요'; return Promise.reject('mismatch'); }
    return auth.sendPasswordResetEmail(email);
  }).then(function(){
    msg.style.color='var(--green)';
    msg.textContent='✅ 비밀번호 재설정 메일을 보냈어요. 이메일을 확인해주세요!';
  }).catch(function(e){
    if(e==='no-user'||e==='no-email'||e==='mismatch') return;
    msg.style.color='var(--red)'; msg.textContent='전송 실패: ' + e.message;
  });
}

// ─── 회원가입 ─────────────────────────────────────────────────────────────────
var uidChecked = false;

function initBirthSelects(){
  var yEl = document.getElementById('su-birth-y');
  var mEl = document.getElementById('su-birth-m');
  var dEl = document.getElementById('su-birth-d');
  if(!yEl || yEl.options.length > 1) return; // 이미 초기화됨
  var now = new Date().getFullYear();
  for(var y = now; y >= 1920; y--){
    var o = document.createElement('option'); o.value = y; o.textContent = y + '년'; yEl.appendChild(o);
  }
  for(var m = 1; m <= 12; m++){
    var o = document.createElement('option'); o.value = String(m).padStart(2,'0'); o.textContent = m + '월'; mEl.appendChild(o);
  }
  for(var d = 1; d <= 31; d++){
    var o = document.createElement('option'); o.value = String(d).padStart(2,'0'); o.textContent = d + '일'; dEl.appendChild(o);
  }
}

function toggleEmailDomain(){
  var sel = document.getElementById('su-email-domain');
  var custom = document.getElementById('su-email-domain-custom');
  if(sel.value === 'direct'){
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
  }
}

function getSignupEmail(){
  var id = document.getElementById('su-email-id').value.trim();
  var domain = document.getElementById('su-email-domain').value;
  if(domain === 'direct') domain = document.getElementById('su-email-domain-custom').value.trim();
  if(!id || !domain) return '';
  return id + '@' + domain;
}

function getSignupBirth(){
  var y = document.getElementById('su-birth-y').value;
  var m = document.getElementById('su-birth-m').value;
  var d = document.getElementById('su-birth-d').value;
  if(!y || !m || !d) return '';
  return y + '-' + m + '-' + d;
}

function formatPhone(el){
  var v = el.value.replace(/[^0-9]/g, '');
  if(v.length > 3 && v.length <= 7) v = v.slice(0,3) + '-' + v.slice(3);
  else if(v.length > 7) v = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7,11);
  el.value = v;
}

function checkPwStrength(){
  var pw = document.getElementById('su-pw').value;
  var el = document.getElementById('pw-strength');
  var hasLetter = /[a-zA-Z]/.test(pw);
  var hasNum    = /[0-9]/.test(pw);
  var long      = pw.length >= 8;
  if(!pw){ el.textContent=''; return; }
  if(long && hasLetter && hasNum){
    el.style.color='var(--green)'; el.textContent='✅ 사용 가능한 비밀번호예요';
  } else {
    el.style.color='var(--red)';
    var hints=[];
    if(!long) hints.push('8자 이상');
    if(!hasLetter) hints.push('영문 포함');
    if(!hasNum) hints.push('숫자 포함');
    el.textContent='❌ ' + hints.join(', ') + ' 필요';
  }
}

function checkUid(){
  var uid = document.getElementById('su-uid').value.trim();
  var el  = document.getElementById('uid-msg');
  if(!uid){ el.style.color='var(--red)'; el.textContent='아이디를 입력하세요'; return; }
  if(!/^[a-zA-Z0-9]{4,16}$/.test(uid)){
    el.style.color='var(--red)'; el.textContent='영문+숫자 4~16자만 가능해요'; uidChecked=false; return;
  }
  el.style.color='var(--text2)'; el.textContent='확인 중...';
  db.ref('usernames/' + uid).once('value').then(function(snap){
    if(snap.exists()){
      el.style.color='var(--red)'; el.textContent='❌ 이미 사용 중인 아이디예요'; uidChecked=false;
    } else {
      el.style.color='var(--green)'; el.textContent='✅ 사용 가능한 아이디예요'; uidChecked=true;
    }
  });
}

function doSignup(){
  var name  = document.getElementById('su-name').value.trim();
  var uid   = document.getElementById('su-uid').value.trim();
  var email = getSignupEmail();
  var phone = document.getElementById('su-phone').value.trim();
  var pw    = document.getElementById('su-pw').value;
  var pw2   = document.getElementById('su-pw2').value;
  var birth = getSignupBirth();
  var msg   = document.getElementById('signup-msg');

  if(!name){ msg.style.color='var(--red)'; msg.textContent='이름을 입력하세요'; return; }
  if(!uid){ msg.style.color='var(--red)'; msg.textContent='아이디를 입력하세요'; return; }
  if(!uidChecked){ msg.style.color='var(--red)'; msg.textContent='아이디 중복확인을 해주세요'; return; }
  if(!email){ msg.style.color='var(--red)'; msg.textContent='이메일을 입력하세요'; return; }
  if(!/[a-zA-Z]/.test(pw)||!/[0-9]/.test(pw)||pw.length<8){
    msg.style.color='var(--red)'; msg.textContent='비밀번호는 영문+숫자 포함 8자 이상이어야 해요'; return;
  }
  if(pw !== pw2){ msg.style.color='var(--red)'; msg.textContent='비밀번호가 일치하지 않아요'; return; }
  if(!birth){ msg.style.color='var(--red)'; msg.textContent='생년월일을 선택해주세요'; return; }

  var today = new Date();
  var birthDate = new Date(birth);
  var age = today.getFullYear() - birthDate.getFullYear();
  var mo = today.getMonth() - birthDate.getMonth();
  if(mo < 0 || (mo===0 && today.getDate() < birthDate.getDate())) age--;
  if(age < 14){ msg.style.color='var(--red)'; msg.textContent='14세 이상만 가입할 수 있어요'; return; }

  msg.style.color='var(--text2)'; msg.textContent='가입 처리 중...';

  auth.createUserWithEmailAndPassword(email, pw).then(function(cred){
    var user = cred.user;
    var userInfo = {name:name, username:uid, email:email, phone:phone, birth:birth, createdAt:new Date().toISOString()};
    return Promise.all([
      db.ref('users/' + user.uid + '/profile').set(userInfo),
      db.ref('usernames/' + uid).set(user.uid),
      user.updateProfile({displayName: name}),
      user.sendEmailVerification()
    ]);
  }).then(function(){
    msg.style.color='var(--green)';
    msg.textContent='✅ 가입 완료! 이메일 인증을 해주세요';
  }).catch(function(e){
    msg.style.color='var(--red)';
    if(e.code==='auth/email-already-in-use') msg.textContent='이미 사용 중인 이메일이에요';
    else msg.textContent = e.message;
  });
}

// ─── 이메일 인증 ──────────────────────────────────────────────────────────────
function checkVerified(){
  var user = auth.currentUser;
  if(!user){ return; }
  user.reload().then(function(){
    if(auth.currentUser.emailVerified){
      REF = db.ref('users/' + auth.currentUser.uid + '/appData');
      CRAWL_REF = db.ref('users/' + (currentUser ? currentUser.uid : 'anonymous') + '/crawledSales');
      loadUserData();
    } else {
      showToast('❌ 아직 인증이 완료되지 않았어요');
    }
  });
}

function resendVerify(){
  var user = auth.currentUser;
  if(!user) return;
  user.sendEmailVerification().then(function(){
    showToast('✅ 인증 메일을 다시 보냈어요');
  });
}

// ─── 로그아웃 ─────────────────────────────────────────────────────────────────
function doLogout(){
  if(!confirm('로그아웃 할까요?')) return;
  auth.signOut();
}
