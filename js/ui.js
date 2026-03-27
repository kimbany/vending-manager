// ─── UI ───────────────────────────────────────────────────────────────────────
function switchTab(name,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='settings') renderProfileInfo();
  else resetVmmsLock();
  if(name==='machine') switchVmSub('status');
  history.replaceState(null, '', '#'+name);
}

function restoreTab(){
  var hash = location.hash.replace('#','');
  if(!hash) return;
  var tabNames = ['home','inventory','sales','machine','settings'];
  if(tabNames.indexOf(hash) < 0) return;
  var btns = document.querySelectorAll('.nav-btn');
  var idx = tabNames.indexOf(hash);
  if(btns[idx]) switchTab(hash, btns[idx]);
}

function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-bg').forEach(function(bg){
  bg.addEventListener('click',function(e){if(e.target===bg)bg.classList.remove('open');});
});

// 최상단 버튼은 항상 표시 (CSS에서 제어)

// ─── Pull-to-Refresh (모바일 터치 전용) ──────────────────────────────────────
(function(){
  var content = document.getElementById('content');
  var indicator = document.getElementById('ptr-indicator');
  if(!content || !indicator) return;

  var startY = 0;
  var isPulling = false;
  var wasAtTop = false;
  var movedDown = false;
  var threshold = 120;

  content.addEventListener('touchstart', function(e){
    // 터치 시작할 때 scrollTop이 정확히 0이어야 함
    wasAtTop = (content.scrollTop <= 0);
    if(wasAtTop){
      startY = e.touches[0].clientY;
      isPulling = false;  // 아직 시작 아님 - 첫 움직임 방향 확인 후 결정
      movedDown = false;
    }
  }, {passive: true});

  content.addEventListener('touchmove', function(e){
    if(!wasAtTop) return;

    var dy = e.touches[0].clientY - startY;

    // 스크롤이 0이 아니면 취소 (관성 스크롤로 맨 위 도달한 경우)
    if(content.scrollTop > 0){
      wasAtTop = false;
      isPulling = false;
      _resetPtr();
      return;
    }

    // 첫 움직임이 위쪽이면 일반 스크롤 → 무시
    if(!movedDown && dy < 0){
      wasAtTop = false;
      return;
    }

    // 아래쪽으로 50px 이상 움직여야 PTR 시작
    if(dy > 50){
      movedDown = true;
      isPulling = true;
      var progress = Math.min((dy - 50) / (threshold - 50), 1);
      indicator.style.height = Math.round(50 * progress) + 'px';
      indicator.style.padding = progress > 0.3 ? '12px 0' : '0';
      indicator.textContent = dy >= threshold ? '↑ 놓으면 새로고침' : '↓ 당겨서 새로고침';
    }
  }, {passive: true});

  content.addEventListener('touchend', function(){
    if(!isPulling){
      _resetPtr();
      wasAtTop = false;
      return;
    }

    var h = parseInt(indicator.style.height) || 0;
    isPulling = false;
    wasAtTop = false;

    if(h >= 40){
      indicator.textContent = '새로고침 중...';
      if(typeof loadMachineData === 'function' && currentLocationId && currentMachineId){
        loadMachineData(currentLocationId, currentMachineId);
      } else if(typeof renderAll === 'function'){
        renderAll();
      }
      setTimeout(function(){
        _resetPtr();
        showToast('✅ 새로고침 완료');
      }, 800);
    } else {
      _resetPtr();
    }
  });

  function _resetPtr(){
    indicator.style.height = '0';
    indicator.style.padding = '0';
    indicator.textContent = '↓ 당겨서 새로고침';
  }
})();

// load()는 onAuthStateChanged에서 자동 호출됨
