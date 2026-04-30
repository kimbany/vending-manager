// ─── 쿠팡 파트너스 연동 (딥링크 URL 방식) ────────────────────────────────────

// 쿠팡 파트너스 Sub ID (수수료 추적용)
var COUPANG_SUB_ID = 'AF1423505';

// 쿠팡 파트너스 검색 딥링크 생성
function getCoupangAffiliateUrl(keyword){
  return 'https://link.coupang.com/re/AFFSRP?lptag=' + COUPANG_SUB_ID + '&subid=invendory&pageKey=' + encodeURIComponent(keyword);
}

// ─── 쿠팡 검색 (파트너스 링크로 바로 이동) ──────────────────────────────────
function openCoupangWithAffiliate(name){
  var url = getCoupangAffiliateUrl(name);
  window.open(url, '_blank');
}

// ─── 쿠팡 검색 모달 열기 ──────────────────────────────────────────────────────
function openCoupangSearch(keyword){
  // 모달 없이 바로 쿠팡 파트너스 링크로 이동
  if(keyword){
    window.open(getCoupangAffiliateUrl(keyword), '_blank');
  }
}

// ─── 상품 검색 (바로 쿠팡 이동) ──────────────────────────────────────────────
function searchCoupangProducts(keyword){
  if(!keyword){
    keyword = document.getElementById('csm-keyword').value.trim();
  }
  if(!keyword){ showToast('검색어를 입력하세요'); return; }
  window.open(getCoupangAffiliateUrl(keyword), '_blank');
}
