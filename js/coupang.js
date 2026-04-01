// ─── 쿠팡 파트너스 API 연동 (앱 관리자 키 사용) ──────────────────────────────

// 앱 관리자의 쿠팡 파트너스 API 키 (모든 사용자 공통)
var COUPANG_ACCESS_KEY = '0eeed60d-84a0-4e5f-9daa-30108a82f257';
var COUPANG_SECRET_KEY = 'e4a7520273d6f2f2219a0cc513d1563fe60662a2';
var COUPANG_SUB_ID = 'vending-manager';

// 쿠팡 파트너스 키가 설정되었는지 확인
function hasCoupangKeys(){
  return COUPANG_ACCESS_KEY && COUPANG_SECRET_KEY;
}

// 설정 탭용 더미 함수 (호환성)
function resetCoupangLock(){}

// ─── HMAC-SHA256 서명 생성 (Web Crypto API) ──────────────────────────────────
function generateHmac(secretKey, message){
  var enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw', enc.encode(secretKey), {name:'HMAC', hash:'SHA-256'}, false, ['sign']
  ).then(function(key){
    return crypto.subtle.sign('HMAC', key, enc.encode(message));
  }).then(function(sig){
    return Array.from(new Uint8Array(sig)).map(function(b){
      return ('0'+b.toString(16)).slice(-2);
    }).join('');
  });
}

// ─── API 요청 서명 생성 ───────────────────────────────────────────────────────
function generateCoupangAuth(method, path){
  var datetime = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  var message = datetime + method + path;
  return generateHmac(COUPANG_SECRET_KEY, message).then(function(signature){
    return 'CEA algorithm=HmacSHA256, access-key='+COUPANG_ACCESS_KEY+', signed-date='+datetime+', signature='+signature;
  });
}

// ─── 상품 검색 API ────────────────────────────────────────────────────────────
function searchCoupangProducts(keyword){
  if(!keyword){
    keyword = document.getElementById('csm-keyword').value.trim();
  }
  if(!keyword){ showToast('검색어를 입력하세요'); return; }

  var loading = document.getElementById('csm-loading');
  var results = document.getElementById('csm-results');
  var msgEl   = document.getElementById('csm-msg');
  loading.style.display = 'block';
  results.innerHTML = '';
  msgEl.textContent = '';

  if(!hasCoupangKeys()){
    // API 키 미설정 - 바로 쿠팡 검색 폴백
    loading.style.display = 'none';
    renderCoupangFallbackUI(results, keyword, 'https://www.coupang.com/np/search?q=' + encodeURIComponent(keyword));
    msgEl.style.color='var(--text3)';
    msgEl.textContent='쿠팡에서 직접 검색할 수 있어요.';
    return;
  }

  var path = '/v2/providers/affiliate_open_api/apis/openapi/v1/productSearch?keyword='+encodeURIComponent(keyword)+'&limit=10&subId='+encodeURIComponent(COUPANG_SUB_ID);

  generateCoupangAuth('GET', path).then(function(auth){
    return fetch('https://api-gateway.coupang.com'+path, {
      method: 'GET',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json'
      }
    });
  }).then(function(res){
    return res.json();
  }).then(function(data){
    loading.style.display = 'none';

    if(data.rCode !== 200 && data.rCode !== '200'){
      msgEl.style.color='var(--red)';
      msgEl.textContent='API 오류: '+(data.rMessage||'알 수 없는 오류');
      return;
    }

    var products = data.data && data.data.productData ? data.data.productData : [];
    if(!products.length){
      msgEl.style.color='var(--text3)';
      msgEl.textContent='검색 결과가 없어요.';
      return;
    }

    results.innerHTML = products.map(function(p){
      var price = p.productPrice ? fmt(p.productPrice) : '-';
      var img = p.productImage || '';
      var name = p.productName || '';
      var url = p.productUrl || '';
      var isRocket = p.isRocket ? '<span style="background:var(--blue);color:#fff;font-size:10px;border-radius:4px;padding:1px 5px;font-weight:700;margin-left:4px">로켓배송</span>' : '';
      var isFreeShipping = p.isFreeShipping ? '<span style="background:var(--green);color:#fff;font-size:10px;border-radius:4px;padding:1px 5px;font-weight:700;margin-left:4px">무료배송</span>' : '';

      return '<div onclick="window.open(\''+url.replace(/'/g,"\\'") +'\',\'_blank\')" style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer">'+
        (img ? '<img src="'+img+'" style="width:60px;height:60px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--bg3)"/>' : '')+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:600;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">'+name+'</div>'+
          '<div style="margin-top:4px">'+isRocket+isFreeShipping+'</div>'+
          '<div style="font-size:14px;font-weight:800;color:var(--blue);margin-top:4px">'+price+'원</div>'+
        '</div>'+
        '<div style="flex-shrink:0;display:flex;align-items:center">'+
          '<span style="font-size:11px;background:rgba(232,184,109,.2);color:var(--blue);border:1px solid rgba(232,184,109,.4);border-radius:6px;padding:3px 8px;white-space:nowrap">구매 &#8594;</span>'+
        '</div>'+
      '</div>';
    }).join('');

    msgEl.style.color='var(--text3)';
    msgEl.textContent='파트너스 링크가 적용된 결과예요.';
  }).catch(function(e){
    loading.style.display = 'none';
    console.error('Coupang API error:', e);
    // CORS 실패 시 폴백
    showCoupangFallback(keyword);
  });
}

// ─── CORS 차단 시 딥링크 폴백 ─────────────────────────────────────────────────
function showCoupangFallback(keyword){
  var results = document.getElementById('csm-results');
  var msgEl = document.getElementById('csm-msg');
  var searchUrl = 'https://www.coupang.com/np/search?q=' + encodeURIComponent(keyword);

  if(hasCoupangKeys()){
    var path = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';
    generateCoupangAuth('POST', path).then(function(auth){
      return fetch('https://api-gateway.coupang.com'+path, {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ coupangUrls: [searchUrl] })
      });
    }).then(function(res){ return res.json(); }).then(function(data){
      if((data.rCode === 200 || data.rCode === '200') && data.data && data.data.length > 0){
        renderCoupangFallbackUI(results, keyword, data.data[0].shortenUrl || data.data[0].landingPageUrl || searchUrl);
      } else {
        renderCoupangFallbackUI(results, keyword, searchUrl);
      }
    }).catch(function(){ renderCoupangFallbackUI(results, keyword, searchUrl); });
  } else {
    renderCoupangFallbackUI(results, keyword, searchUrl);
  }
  if(msgEl){
    msgEl.style.color='var(--red)';
    msgEl.textContent='API 직접 호출이 제한돼요. 쿠팡에서 직접 검색하세요.';
  }
}

function renderCoupangFallbackUI(el, keyword, url){
  el.innerHTML =
    '<div style="text-align:center;padding:20px 10px">'+
      '<div style="font-size:32px;margin-bottom:12px">🛒</div>'+
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px">쿠팡에서 직접 검색하기</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">아래 버튼으로 쿠팡에서 최적가를 검색할 수 있어요.</div>'+
      '<button onclick="window.open(\''+url.replace(/'/g,"\\'")+'\',\'_blank\')" style="background:var(--blue);border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">🔗 쿠팡에서 \''+keyword+'\' 검색</button>'+
    '</div>';
}

// ─── 딥링크 생성 (제품구매 시 사용) ──────────────────────────────────────────
function openCoupangWithAffiliate(name){
  var searchUrl = 'https://www.coupang.com/np/search?q=' + encodeURIComponent(name);

  if(!hasCoupangKeys()){
    window.open(searchUrl, '_blank');
    requestNotification('🛒 쿠팡 검색', name + ' 쿠팡 검색 페이지를 열었어요');
    return;
  }

  var path = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';
  generateCoupangAuth('POST', path).then(function(auth){
    return fetch('https://api-gateway.coupang.com'+path, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coupangUrls: [searchUrl] })
    });
  }).then(function(res){ return res.json(); }).then(function(data){
    var url = searchUrl;
    if((data.rCode === 200 || data.rCode === '200') && data.data && data.data.length > 0){
      url = data.data[0].shortenUrl || data.data[0].landingPageUrl || searchUrl;
    }
    window.open(url, '_blank');
    requestNotification('🛒 쿠팡 파트너스', name + ' 파트너스 링크로 열었어요');
  }).catch(function(){
    window.open(searchUrl, '_blank');
    requestNotification('🛒 쿠팡 검색', name + ' 쿠팡 검색 페이지를 열었어요');
  });
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
