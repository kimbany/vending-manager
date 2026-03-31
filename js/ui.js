// ─── UI ───────────────────────────────────────────────────────────────────────
function switchTab(name,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='home' && typeof renderHome==='function') renderHome();
  if(name==='inventory' && typeof renderInv==='function') renderInv();
  if(name==='sales' && typeof renderSalesStats==='function') renderSalesStats();
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
  var mouseDownTarget = null;
  bg.addEventListener('mousedown',function(e){ mouseDownTarget = e.target; });
  bg.addEventListener('click',function(e){
    if(e.target===bg && mouseDownTarget===bg) bg.classList.remove('open');
    mouseDownTarget = null;
  });
});

// ─── 새로고침 함수 ───────────────────────────────────────────────────────────
function doRefresh(){
  if(typeof loadMachineData === 'function' && currentLocationId && currentMachineId){
    loadMachineData(currentLocationId, currentMachineId);
  } else if(typeof renderAll === 'function'){
    renderAll();
  }
  showToast('✅ 새로고침 완료');
}

// ─── 맨 위로 가기 ────────────────────────────────────────────────────────────
function goToTop(){
  var c = document.getElementById('content');
  if(c) c.scrollTop = 0;
  window.scrollTo(0, 0);
}

// load()는 onAuthStateChanged에서 자동 호출됨
