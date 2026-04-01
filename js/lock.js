// ─── 화면 잠금 (PIN) ──────────────────────────────────────────────────────────
var _lockPin = '';       // 입력 중인 PIN
var _lockAttempts = 0;   // 틀린 횟수
var _lockTimer = null;   // 비활동 타이머
var _lockTimeout = 60;   // 기본 60분
var _savedPinHash = '';  // 저장된 PIN 해시 (SHA-256)

// ─── 비활동 감지 ──────────────────────────────────────────────────────────────
function resetLockTimer(){
  clearTimeout(_lockTimer);
  if(!_savedPinHash || _lockTimeout <= 0) return;
  _lockTimer = setTimeout(function(){
    showLockScreen();
  }, _lockTimeout * 60 * 1000);
}

function initLockTimer(){
  ['click','touchstart','scroll','keydown'].forEach(function(evt){
    document.addEventListener(evt, resetLockTimer, {passive:true});
  });
  // 탭 포커스 복귀 시 마지막 활동 체크
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden) resetLockTimer();
  });
}

// ─── 잠금 화면 표시 ──────────────────────────────────────────────────────────
function showLockScreen(){
  if(!_savedPinHash) return;
  _lockPin = '';
  _updateLockDots();
  document.getElementById('lock-msg').textContent = '';
  document.getElementById('lock-screen').classList.add('active');
}

function _updateLockDots(){
  var dots = document.querySelectorAll('#lock-dots .lock-dot');
  dots.forEach(function(d, i){
    d.classList.toggle('filled', i < _lockPin.length);
  });
}

// ─── PIN 입력 (잠금 해제) ─────────────────────────────────────────────────────
function pinInput(n){
  if(_lockPin.length >= 4) return;
  _lockPin += String(n);
  _updateLockDots();
  if(_lockPin.length === 4){
    setTimeout(checkLockPin, 200);
  }
}

function pinDelete(){
  _lockPin = _lockPin.slice(0, -1);
  _updateLockDots();
  document.getElementById('lock-msg').textContent = '';
}

function checkLockPin(){
  hashSHA256(_lockPin).then(function(h){
  if(h === _savedPinHash){
    _lockAttempts = 0;
    document.getElementById('lock-screen').classList.remove('active');
    resetLockTimer();
  } else {
    _lockAttempts++;
    _lockPin = '';
    _updateLockDots();
    if(_lockAttempts >= 5){
      document.getElementById('lock-msg').textContent = '5회 실패 - 로그아웃됩니다';
      setTimeout(function(){ doLogout(); }, 1500);
    } else {
      document.getElementById('lock-msg').textContent = 'PIN이 올바르지 않아요 ('+_lockAttempts+'/5)';
    }
  }
  });
}

// ─── PIN 설정 ─────────────────────────────────────────────────────────────────
var _pinSetupStep = 'new'; // 'new' or 'confirm'
var _pinSetupNew = '';
var _pinSetupCurrent = '';

function openPinSetup(){
  document.getElementById('pin-step1').style.display = 'block';
  document.getElementById('pin-step2').style.display = 'none';
  document.getElementById('pin-verify-pw').value = '';
  document.getElementById('pin-verify-msg').textContent = '';
  openModal('pin-setup-modal');
}

function verifyForPin(){
  var pw = document.getElementById('pin-verify-pw').value;
  var msg = document.getElementById('pin-verify-msg');
  if(!pw){ msg.style.color='var(--red)'; msg.textContent='비밀번호를 입력하세요'; return; }
  var cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, pw);
  currentUser.reauthenticateWithCredential(cred).then(function(){
    document.getElementById('pin-step1').style.display = 'none';
    document.getElementById('pin-step2').style.display = 'block';
    _pinSetupStep = 'new';
    _pinSetupNew = '';
    _pinSetupCurrent = '';
    _updateSetupDots();
    document.getElementById('pin-step2-label').textContent = '새 PIN 4자리를 입력하세요';
    document.getElementById('pin-setup-msg').textContent = '';
  }).catch(function(){
    msg.style.color='var(--red)'; msg.textContent='비밀번호가 올바르지 않아요';
  });
}

function pinSetupInput(n){
  _pinSetupCurrent += String(n);
  _updateSetupDots();
  if(_pinSetupCurrent.length === 4){
    setTimeout(function(){
      if(_pinSetupStep === 'new'){
        _pinSetupNew = _pinSetupCurrent;
        _pinSetupCurrent = '';
        _pinSetupStep = 'confirm';
        _updateSetupDots();
        document.getElementById('pin-step2-label').textContent = 'PIN을 한번 더 입력하세요';
        document.getElementById('pin-setup-msg').textContent = '';
      } else {
        if(_pinSetupCurrent === _pinSetupNew){
          // 저장
          hashSHA256(_pinSetupNew).then(function(hash){
          _savedPinHash = hash;
          return db.ref('users/'+currentUser.uid+'/settings/pin').set(hash);
          }).then(function(){
            closeModal('pin-setup-modal');
            showToast('✅ PIN 설정 완료');
            renderPinStatus();
            resetLockTimer();
          });
        } else {
          document.getElementById('pin-setup-msg').textContent = 'PIN이 일치하지 않아요. 다시 입력하세요';
          _pinSetupStep = 'new';
          _pinSetupCurrent = '';
          _pinSetupNew = '';
          _updateSetupDots();
          document.getElementById('pin-step2-label').textContent = '새 PIN 4자리를 입력하세요';
        }
      }
    }, 200);
  }
}

function pinSetupDelete(){
  _pinSetupCurrent = _pinSetupCurrent.slice(0, -1);
  _updateSetupDots();
  document.getElementById('pin-setup-msg').textContent = '';
}

function _updateSetupDots(){
  var dots = document.querySelectorAll('#pin-setup-dots .lock-dot');
  dots.forEach(function(d, i){
    d.classList.toggle('filled', i < _pinSetupCurrent.length);
  });
}

// ─── PIN 삭제 ─────────────────────────────────────────────────────────────────
function removePinSetup(){
  if(!confirm('PIN을 삭제하면 화면 잠금이 비활성화됩니다.\n삭제할까요?')) return;
  _savedPinHash = '';
  clearTimeout(_lockTimer);
  db.ref('users/'+currentUser.uid+'/settings/pin').remove().then(function(){
    showToast('✅ PIN 삭제 완료');
    renderPinStatus();
  });
}

// ─── 잠금 시간 저장 ──────────────────────────────────────────────────────────
function saveLockTimeout(){
  var sel = document.getElementById('lock-timeout');
  _lockTimeout = parseInt(sel.value) || 0;
  if(currentUser){
    db.ref('users/'+currentUser.uid+'/settings/lockTimeout').set(_lockTimeout);
  }
  resetLockTimer();
}

// ─── 상태 표시 ────────────────────────────────────────────────────────────────
function renderPinStatus(){
  var el = document.getElementById('pin-status');
  var btn = document.getElementById('pin-setup-btn');
  var rmBtn = document.getElementById('pin-remove-btn');
  if(_savedPinHash){
    el.textContent = 'PIN 설정됨 · '+(_lockTimeout>0?_lockTimeout+'분 후 자동 잠금':'자동 잠금 사용 안함');
    btn.textContent = 'PIN 변경';
    rmBtn.style.display = 'block';
  } else {
    el.textContent = 'PIN 미설정 · 화면 잠금 비활성화';
    btn.textContent = 'PIN 설정';
    rmBtn.style.display = 'none';
  }
}

// ─── 로드 ─────────────────────────────────────────────────────────────────────
function loadPinSettings(){
  if(!currentUser) return;
  db.ref('users/'+currentUser.uid+'/settings').once('value').then(function(snap){
    var v = snap.val() || {};
    if(v.pin){
      _savedPinHash = v.pin || '';
    }
    if(v.lockTimeout !== undefined) _lockTimeout = parseInt(v.lockTimeout) || 0;
    var sel = document.getElementById('lock-timeout');
    if(sel) sel.value = String(_lockTimeout);
    renderPinStatus();
    resetLockTimer();
    initLockTimer();
  });
}
