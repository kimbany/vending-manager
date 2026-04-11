// 설정 로드
chrome.storage.local.get(['invendoryUid', 'autoSync'], function(cfg) {
  if (cfg.invendoryUid) document.getElementById('uid').value = cfg.invendoryUid;
  document.getElementById('autoSync').checked = cfg.autoSync !== false;
});

// 저장
document.getElementById('saveBtn').addEventListener('click', function() {
  var uid = document.getElementById('uid').value.trim();
  var autoSync = document.getElementById('autoSync').checked;
  if (!uid) {
    showStatus('❌ UID를 입력하세요', 'err');
    return;
  }
  chrome.storage.local.set({ invendoryUid: uid, autoSync: autoSync }, function() {
    showStatus('✅ 저장 완료', 'ok');
  });
});

// 수동 동기화
document.getElementById('syncBtn').addEventListener('click', function() {
  chrome.tabs.query({ url: 'https://mc.coupang.com/*' }, function(tabs) {
    if (tabs.length === 0) {
      // 쿠팡 주문내역 페이지 열기
      chrome.tabs.create({ url: 'https://mc.coupang.com/ssr/desktop/order/list' });
      showStatus('📄 쿠팡 주문내역 페이지를 열었습니다', 'ok');
    } else {
      // 이미 열려있으면 새로고침
      chrome.tabs.reload(tabs[0].id);
      showStatus('🔄 동기화 중...', 'ok');
    }
  });
});

function showStatus(msg, cls) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (cls || '');
}
