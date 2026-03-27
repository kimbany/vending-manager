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

// ─── 스크롤 최상단 버튼 (위로 스크롤 시 표시) ───────────────────────────────
(function(){
  var content = document.getElementById('content');
  var btn = document.getElementById('scroll-top-btn');
  if(!content || !btn) return;

  var lastST = 0;
  var timer = null;
  var ticking = false;

  content.addEventListener('scroll', function(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      var st = content.scrollTop;
      if(st < 300){
        btn.style.display = 'none';
      } else if(st < lastST - 10){
        // 위로 10px 이상 스크롤 시 표시
        btn.style.display = 'flex';
        clearTimeout(timer);
        timer = setTimeout(function(){ btn.style.display = 'none'; }, 3000);
      } else if(st > lastST + 5){
        // 아래로 스크롤 시 숨김
        btn.style.display = 'none';
        clearTimeout(timer);
      }
      lastST = st;
      ticking = false;
    });
  });
})();

// ─── Pull-to-Refresh (모바일 터치 전용) ──────────────────────────────────────
(function(){
  var content = document.getElementById('content');
  var indicator = document.getElementById('ptr-indicator');
  if(!content || !indicator) return;

  var startY = 0;
  var isPulling = false;
  var threshold = 100;

  content.addEventListener('touchstart', function(e){
    // 스크롤이 최상단일 때만 시작
    if(content.scrollTop === 0){
      startY = e.touches[0].clientY;
      isPulling = true;
    } else {
      isPulling = false;
    }
  }, {passive: true});

  content.addEventListener('touchmove', function(e){
    if(!isPulling) return;
    // 스크롤이 0이 아니면 취소 (위로 스크롤하다가 맨 위에 도달한 경우 방지)
    if(content.scrollTop > 0){
      isPulling = false;
      indicator.style.height = '0';
      indicator.style.padding = '0';
      return;
    }
    var dy = e.touches[0].clientY - startY;
    if(dy <= 0){
      isPulling = false;
      indicator.style.height = '0';
      indicator.style.padding = '0';
      return;
    }
    // 최소 30px 이상 당겨야 표시
    if(dy > 30){
      var progress = Math.min(dy / threshold, 1);
      indicator.style.height = Math.round(50 * progress) + 'px';
      indicator.style.padding = progress > 0.3 ? '12px 0' : '0';
      indicator.textContent = dy >= threshold ? '↑ 놓으면 새로고침' : '↓ 당겨서 새로고침';
    }
  }, {passive: true});

  content.addEventListener('touchend', function(){
    if(!isPulling){ return; }
    isPulling = false;

    var h = parseInt(indicator.style.height) || 0;
    if(h >= 45){
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
