// ─── 쿠팡 파트너스 연동 (딥링크 URL 방식) ────────────────────────────────────

// 쿠팡 파트너스 Sub ID (수수료 추적용)
var COUPANG_SUB_ID = 'AF1423505';

// 쿠팡 파트너스 검색 딥링크 생성
function getCoupangAffiliateUrl(keyword){
  return 'https://link.coupang.com/re/AFFSRP?lptag=AF' + COUPANG_SUB_ID + '&pageKey=' + encodeURIComponent(keyword);
}

// ─── 쿠팡 검색 (파트너스 링크) ────────────────────────────────────────────────
function openCoupangWithAffiliate(name){
  var url = getCoupangAffiliateUrl(name);
  window.open(url, '_blank');
}

// ─── 쿠팡 검색 모달 열기 ──────────────────────────────────────────────────────
function openCoupangSearch(keyword){
  document.getElementById('csm-keyword').value = keyword || '';
  document.getElementById('csm-results').innerHTML = '';
  document.getElementById('csm-msg').textContent = '';
  document.getElementById('csm-loading').style.display = 'none';
  openModal('coupang-search-modal');
  if(keyword) searchCoupangProducts(keyword);
}

// ─── 상품 검색 (파트너스 딥링크로 바로 연결) ──────────────────────────────────
function searchCoupangProducts(keyword){
  if(!keyword){
    keyword = document.getElementById('csm-keyword').value.trim();
  }
  if(!keyword){ showToast('검색어를 입력하세요'); return; }

  var results = document.getElementById('csm-results');
  var msgEl = document.getElementById('csm-msg');
  var affiliateUrl = getCoupangAffiliateUrl(keyword);

  results.innerHTML =
    '<div style="text-align:center;padding:24px 10px">'+
      '<div style="font-size:40px;margin-bottom:14px">🛒</div>'+
      '<div style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--text)">쿠팡에서 "'+keyword+'" 검색</div>'+
      '<div style="font-size:13px;color:var(--text3);margin-bottom:20px;line-height:1.6">파트너스 링크가 적용된 쿠팡 검색 페이지로 이동합니다.<br/>이 링크로 구매하면 앱 운영에 도움이 됩니다.</div>'+
      '<button onclick="window.open(\''+affiliateUrl.replace(/'/g,"\\'")+'\',\'_blank\')" style="width:100%;background:var(--blue);border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px">쿠팡에서 검색하기</button>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:8px">쿠팡 파트너스 제휴 링크입니다</div>'+
    '</div>';

  msgEl.textContent = '';
}
