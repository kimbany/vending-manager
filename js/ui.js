// ─── UI ───────────────────────────────────────────────────────────────────────
function switchTab(name,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='settings') renderProfileInfo();
  else resetVmmsLock();
  if(name==='machine') switchVmSub('status');
  // URL 해시에 현재 탭 저장
  history.replaceState(null, '', '#'+name);
}

// 페이지 로드 시 해시에서 탭 복원
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

// ─── 스크롤 최상단 버튼 (위로 스크롤할 때만 표시) ─────────────────────────
(function(){
  var content = document.getElementById('content');
  var btn = document.getElementById('scroll-top-btn');
  if(!content || !btn) return;
  var lastScrollTop = 0;
  var hideTimer = null;

  content.addEventListener('scroll', function(){
    var st = content.scrollTop;
    // 스크롤 위치가 200px 미만이면 항상 숨김
    if(st < 200){
      btn.style.display = 'none';
      lastScrollTop = st;
      return;
    }
    // 위로 스크롤 중일 때만 표시
    if(st < lastScrollTop){
      btn.style.display = 'flex';
      // 3초 후 자동 숨김
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function(){ btn.style.display = 'none'; }, 3000);
    } else {
      btn.style.display = 'none';
    }
    lastScrollTop = st;
  });
})();

// ─── Pull-to-Refresh (모바일/패드) ───────────────────────────────────────────
(function(){
  var content = document.getElementById('content');
  var indicator = document.getElementById('ptr-indicator');
  if(!content || !indicator) return;

  var startY = 0;
  var pulling = false;
  var threshold = 80; // 새로고침 트리거 거리(px)

  content.addEventListener('touchstart', function(e){
    if(content.scrollTop <= 0){
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, {passive: true});

  content.addEventListener('touchmove', function(e){
    if(!pulling) return;
    var dy = e.touches[0].clientY - startY;
    if(dy < 0){ pulling = false; return; }
    if(content.scrollTop > 0){ pulling = false; return; }

    if(dy > 10){
      var progress = Math.min(dy / threshold, 1);
      indicator.style.height = Math.round(50 * progress) + 'px';
      indicator.style.padding = progress > 0.3 ? '12px 0' : '0';
      indicator.textContent = dy >= threshold ? '↑ 놓으면 새로고침' : '↓ 당겨서 새로고침';
    }
  }, {passive: true});

  content.addEventListener('touchend', function(){
    if(!pulling) return;
    pulling = false;

    var h = parseInt(indicator.style.height) || 0;
    if(h >= 45){
      // 새로고침 실행
      indicator.textContent = '새로고침 중...';
      indicator.classList.add('refreshing');

      // 데이터 리로드
      if(typeof loadMachineData === 'function' && currentLocationId && currentMachineId){
        loadMachineData(currentLocationId, currentMachineId);
      } else if(typeof renderAll === 'function'){
        renderAll();
      }

      setTimeout(function(){
        indicator.classList.remove('refreshing');
        indicator.style.height = '0';
        indicator.style.padding = '0';
        indicator.textContent = '↓ 당겨서 새로고침';
        showToast('✅ 새로고침 완료');
      }, 800);
    } else {
      indicator.style.height = '0';
      indicator.style.padding = '0';
    }
  });
})();

// load()는 onAuthStateChanged에서 자동 호출됨
