// ─── 쿠팡 파트너스 API 연동 ───────────────────────────────────────────────────

// ─── 잠금/해제 ────────────────────────────────────────────────────────────────
function resetCoupangLock(){
  var el = document.getElementById('coupang-lock-pw');
  if(el) el.value = '';
  var msg = document.getElementById('coupang-lock-msg');
  if(msg) msg.textContent = '';
  var locked = document.getElementById('coupang-locked');
  var panel  = document.getElementById('coupang-panel');
  if(locked) locked.style.display = 'block';
  if(panel)  panel.style.display  = 'none';
}

function unlockCoupang(){
  var pw  = document.getElementById('coupang-lock-pw').value;
  var msg = document.getElementById('coupang-lock-msg');
  if(!pw){ msg.textContent='비밀번호를 입력하세요'; return; }
  var cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, pw);
  currentUser.reauthenticateWithCredential(cred).then(function(){
    document.getElementById('coupang-locked').style.display='none';
    document.getElementById('coupang-panel').style.display='block';
    renderCoupangInfo();
  }).catch(function(){
    msg.textContent='비밀번호가 올바르지 않아요';
  });
}

// ─── 정보 표시 ────────────────────────────────────────────────────────────────
function renderCoupangInfo(){
  db.ref('users/'+currentUser.uid+'/coupang').once('value').then(function(snap){
    var v = snap.val()||{};
    var el = document.getElementById('coupang-info');
    if(v.accessKey){
      var ak = atob(v.accessKey);
      var masked = ak.substring(0,6) + '••••••••';
      el.innerHTML = '<div style="padding:10px 0">'+
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--text2)">Access Key</span><span style="font-weight:600">'+masked+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--text2)">Secret Key</span><span style="font-weight:600">••••••••</span></div>'+
        '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px"><span style="color:var(--text2)">Sub ID</span><span style="font-weight:600">'+(v.subId?atob(v.subId):'미설정')+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border);font-size:13px"><span style="color:var(--text2)">등록일</span><span style="font-weight:600">'+(v.updatedAt?v.updatedAt.slice(0,10):'-')+'</span></div>'+
      '</div>';
    } else {
      el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">쿠팡 파트너스 API 키를 등록해주세요</div>';
    }
  });
}

// ─── 저장 ─────────────────────────────────────────────────────────────────────
function saveCoupangKeys(){
  var accessKey = document.getElementById('cp-access-key').value.trim();
  var secretKey = document.getElementById('cp-secret-key').value.trim();
  var subId     = document.getElementById('cp-sub-id').value.trim();
  var msg       = document.getElementById('cp-msg');
  if(!accessKey||!secretKey){
    msg.style.color='var(--red)'; msg.textContent='Access Key와 Secret Key를 입력하세요'; return;
  }
  db.ref('users/'+currentUser.uid+'/coupang').set({
    accessKey: btoa(accessKey),
    secretKey: btoa(secretKey),
    subId: subId ? btoa(subId) : '',
    updatedAt: new Date().toISOString()
  }).then(function(){
    msg.style.color='var(--green)'; msg.textContent='저장 완료';
    setTimeout(function(){ closeModal('edit-coupang-modal'); renderCoupangInfo(); }, 1000);
  }).catch(function(e){
    msg.style.color='var(--red)'; msg.textContent=e.message;
  });
}

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
function generateCoupangAuth(method, path, accessKey, secretKey){
  var datetime = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  var message = datetime + method + path;
  return generateHmac(secretKey, message).then(function(signature){
    return 'CEA algorithm=HmacSHA256, access-key='+accessKey+', signed-date='+datetime+', signature='+signature;
  });
}

// ─── 쿠팡 파트너스 API 호출 ──────────────────────────────────────────────────
function getCoupangKeys(){
  return db.ref('users/'+currentUser.uid+'/coupang').once('value').then(function(snap){
    var v = snap.val();
    if(!v || !v.accessKey || !v.secretKey) return null;
    return {
      accessKey: atob(v.accessKey),
      secretKey: atob(v.secretKey),
      subId: v.subId ? atob(v.subId) : ''
    };
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

  getCoupangKeys().then(function(keys){
    if(!keys){
      loading.style.display = 'none';
      msgEl.style.color='var(--red)';
      msgEl.textContent='쿠팡 파트너스 API 키가 등록되지 않았어요. 설정에서 등록해주세요.';
      return;
    }

    var subId = keys.subId || 'vending-manager';
    var path = '/v2/providers/affiliate_open_api/apis/openapi/v1/productSearch?keyword='+encodeURIComponent(keyword)+'&limit=10&subId='+encodeURIComponent(subId);

    return generateCoupangAuth('GET', path, keys.accessKey, keys.secretKey).then(function(auth){
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
        msgEl.textContent='API 오류: '+(data.rMessage||'알 수 없는 오류')+' (코드: '+data.rCode+')';
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
            '<div style="font-size:14px;font-weight:800;color:var(--gold);margin-top:4px">'+price+'원</div>'+
          '</div>'+
          '<div style="flex-shrink:0;display:flex;align-items:center">'+
            '<span style="font-size:11px;background:rgba(232,184,109,.2);color:var(--gold);border:1px solid rgba(232,184,109,.4);border-radius:6px;padding:3px 8px;white-space:nowrap">구매 &#8594;</span>'+
          '</div>'+
        '</div>';
      }).join('');

      msgEl.style.color='var(--text3)';
      msgEl.textContent='파트너스 링크가 적용된 결과예요. 클릭 시 수익이 발생해요.';
    });
  }).catch(function(e){
    loading.style.display = 'none';
    console.error('Coupang API error:', e);
    msgEl.style.color='var(--red)';
    msgEl.textContent='API 호출 실패: '+(e.message||'네트워크 오류')+' (CORS 정책으로 인해 직접 호출이 제한될 수 있어요)';
    // CORS 실패 시 딥링크 방식으로 폴백
    showCoupangFallback(document.getElementById('csm-keyword').value.trim());
  });
}

// ─── CORS 차단 시 딥링크 폴백 ─────────────────────────────────────────────────
function showCoupangFallback(keyword){
  var results = document.getElementById('csm-results');
  getCoupangKeys().then(function(keys){
    var subId = (keys && keys.subId) ? keys.subId : '';
    var searchUrl = 'https://www.coupang.com/np/search?q=' + encodeURIComponent(keyword);

    // 파트너스 키가 있으면 딥링크 생성 시도
    if(keys){
      var path = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';
      var body = JSON.stringify({
        coupangUrls: [searchUrl]
      });

      generateCoupangAuth('POST', path, keys.accessKey, keys.secretKey).then(function(auth){
        return fetch('https://api-gateway.coupang.com'+path, {
          method: 'POST',
          headers: {
            'Authorization': auth,
            'Content-Type': 'application/json'
          },
          body: body
        });
      }).then(function(res){
        return res.json();
      }).then(function(data){
        if(data.rCode === 200 || data.rCode === '200'){
          var deepLinks = data.data || [];
          if(deepLinks.length > 0){
            var affiliateUrl = deepLinks[0].shortenUrl || deepLinks[0].landingPageUrl || searchUrl;
            renderCoupangFallbackUI(results, keyword, affiliateUrl);
            return;
          }
        }
        renderCoupangFallbackUI(results, keyword, searchUrl);
      }).catch(function(){
        renderCoupangFallbackUI(results, keyword, searchUrl);
      });
    } else {
      renderCoupangFallbackUI(results, keyword, searchUrl);
    }
  });
}

function renderCoupangFallbackUI(el, keyword, url){
  el.innerHTML =
    '<div style="text-align:center;padding:20px 10px">'+
      '<div style="font-size:32px;margin-bottom:12px">🛒</div>'+
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px">쿠팡에서 직접 검색하기</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">브라우저 보안 정책으로 API 직접 호출이 제한돼요.<br/>아래 버튼으로 쿠팡에서 검색할 수 있어요.</div>'+
      '<button onclick="window.open(\''+url.replace(/'/g,"\\'")+'\',\'_blank\')" style="background:var(--gold);border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;color:#1a1208;cursor:pointer;font-family:inherit">🔗 쿠팡에서 \''+keyword+'\' 검색</button>'+
    '</div>';
}

// ─── 딥링크 생성 (제품구매 시 사용) ──────────────────────────────────────────
function openCoupangWithAffiliate(name){
  var searchUrl = 'https://www.coupang.com/np/search?q=' + encodeURIComponent(name);

  getCoupangKeys().then(function(keys){
    if(!keys){
      // API 키 미등록 - 일반 쿠팡 검색
      window.open(searchUrl, '_blank');
      requestNotification('🛒 쿠팡 검색', name + ' 쿠팡 검색 페이지를 열었어요');
      return;
    }

    // 딥링크 API 호출 시도
    var path = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';
    var body = JSON.stringify({
      coupangUrls: [searchUrl]
    });

    generateCoupangAuth('POST', path, keys.accessKey, keys.secretKey).then(function(auth){
      return fetch('https://api-gateway.coupang.com'+path, {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json'
        },
        body: body
      });
    }).then(function(res){
      return res.json();
    }).then(function(data){
      var url = searchUrl;
      if((data.rCode === 200 || data.rCode === '200') && data.data && data.data.length > 0){
        url = data.data[0].shortenUrl || data.data[0].landingPageUrl || searchUrl;
      }
      window.open(url, '_blank');
      requestNotification('🛒 쿠팡 파트너스', name + ' 파트너스 링크로 열었어요');
    }).catch(function(){
      // API 실패 시 일반 검색으로 폴백
      window.open(searchUrl, '_blank');
      requestNotification('🛒 쿠팡 검색', name + ' 쿠팡 검색 페이지를 열었어요');
    });
  });
}

// ─── API 연동 테스트 ──────────────────────────────────────────────────────────
function testCoupangApi(){
  var resultEl = document.getElementById('coupang-test-result');
  resultEl.style.color='var(--text2)';
  resultEl.textContent='테스트 중...';

  getCoupangKeys().then(function(keys){
    if(!keys){
      resultEl.style.color='var(--red)';
      resultEl.textContent='API 키가 등록되지 않았어요.';
      return;
    }

    var path = '/v2/providers/affiliate_open_api/apis/openapi/v1/productSearch?keyword='+encodeURIComponent('음료수')+'&limit=1&subId='+encodeURIComponent(keys.subId||'test');

    generateCoupangAuth('GET', path, keys.accessKey, keys.secretKey).then(function(auth){
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
      if(data.rCode === 200 || data.rCode === '200'){
        resultEl.style.color='var(--green)';
        resultEl.textContent='API 연동 성공! 상품 검색이 정상 작동해요.';
      } else {
        resultEl.style.color='var(--red)';
        resultEl.textContent='API 오류: '+(data.rMessage||'알 수 없는 오류');
      }
    }).catch(function(e){
      resultEl.style.color='var(--red)';
      resultEl.textContent='연결 실패: CORS 정책으로 브라우저에서 직접 호출이 제한될 수 있어요. 딥링크 방식은 정상 작동해요.';
    });
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
