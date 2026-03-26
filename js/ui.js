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

// load()는 onAuthStateChanged에서 자동 호출됨
