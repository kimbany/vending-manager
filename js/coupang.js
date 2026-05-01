// ─── 쿠팡 파트너스 연동 (Deeplink API 경유 — 정식 추적 단축 링크) ──────────
// 클라이언트는 키워드만 보내고, 서버(Cloud Function)에서 HMAC 서명 + Partners
// API 호출 → link.coupang.com/a/XXXXXX 형식의 추적 가능한 단축 링크를 받아옴.
var COUPANG_SUB_ID = 'AF1423505'; // fallback subId (서버 실패 시에만 사용)
var _coupangLinkCache = {}; // {keyword: shortUrl}

function _fallbackCoupangUrl(keyword){
  // 서버 호출 실패 시: 정식 검색 URL + 추적 태그 (추적은 부정확할 수 있음)
  return 'https://www.coupang.com/np/search?q=' + encodeURIComponent(keyword) +
         '&lptag=' + COUPANG_SUB_ID;
}

// 키워드 → 단축 링크. 캐시 사용 (같은 키워드 반복 호출 방지).
function getCoupangAffiliateUrl(keyword){
  return new Promise(function(resolve){
    if(!keyword){ resolve(_fallbackCoupangUrl('')); return; }
    var k = String(keyword).trim();
    if(_coupangLinkCache[k]){ resolve(_coupangLinkCache[k]); return; }
    if(typeof firebase === 'undefined' || !firebase.app){
      resolve(_fallbackCoupangUrl(k)); return;
    }
    try {
      var fn = firebase.app().functions('asia-northeast3').httpsCallable('coupangAffiliateLink');
      fn({ keyword: k }).then(function(res){
        var url = (res && res.data && res.data.shortUrl) || _fallbackCoupangUrl(k);
        _coupangLinkCache[k] = url;
        resolve(url);
      }).catch(function(e){
        console.warn('coupangAffiliateLink 실패, fallback URL 사용:', e && (e.message||e.code));
        resolve(_fallbackCoupangUrl(k));
      });
    } catch(e){
      resolve(_fallbackCoupangUrl(k));
    }
  });
}

// 새 탭으로 쿠팡 검색 — 비동기로 단축 링크를 받아 띄움.
// popup blocker 회피를 위해 빈 창을 먼저 열고 URL 채워넣음.
function _openCoupangByKeyword(keyword){
  if(!keyword) return;
  var w = window.open('about:blank', '_blank');
  getCoupangAffiliateUrl(keyword).then(function(url){
    if(w){ try { w.location.href = url; } catch(e){ window.open(url, '_blank'); } }
    else  { window.open(url, '_blank'); }
  });
}

function openCoupangWithAffiliate(name){ _openCoupangByKeyword(name); }
function openCoupangSearch(keyword){    _openCoupangByKeyword(keyword); }

function searchCoupangProducts(keyword){
  if(!keyword){
    var el = document.getElementById('csm-keyword');
    keyword = el ? el.value.trim() : '';
  }
  if(!keyword){ showToast('검색어를 입력하세요'); return; }
  _openCoupangByKeyword(keyword);
}
