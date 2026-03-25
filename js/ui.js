// ─── UI ───────────────────────────────────────────────────────────────────────
function switchTab(name,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='settings') renderProfileInfo();
  else resetVmmsLock();
  if(name==='machine') switchVmSub('status'); // 설정 탭 벗어날 때 VMMS 잠금
}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.querySelectorAll('.modal-bg').forEach(function(bg){
  bg.addEventListener('click',function(e){if(e.target===bg)bg.classList.remove('open');});
});

// load()는 onAuthStateChanged에서 자동 호출됨
