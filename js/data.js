// ─── 데이터 로드 / 저장 ───────────────────────────────────────────────────────
function startApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('verify-screen').style.display='none';
  document.getElementById('loading').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('home-date').value=td();
  var crawlDate = document.getElementById('crawl-date');
  if(crawlDate) crawlDate.value=td();
  if(currentUser){
    var name = currentUser.displayName || currentUser.email;
    document.getElementById('header-user').textContent = name + ' 님';
  }
  D = {products:[], inventory:[], inventoryLogs:[], salesData:[], stockIn:[], stockDeductions:[], salesCost:[]};
  startAutoCollect();
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
  loadMachineDropdown();
  if(typeof loadLowStockThreshold === 'function') loadLowStockThreshold();
  if(typeof loadLowStockSetting === 'function') loadLowStockSetting();
  if(typeof loadPinSettings === 'function') loadPinSettings();
  if(typeof syncDeviceNumberIndex === 'function') syncDeviceNumberIndex();
  // 쿠팡 제품 매핑 + 미입고 목록 자동 로드 (새로고침 후에도 유지)
  if(typeof loadProductMappings === 'function') loadProductMappings();
  if(typeof loadCoupangPending === 'function'){
    setTimeout(function(){ loadCoupangPending(); }, 300);
  }
  // 공지사항 로드
  if(typeof loadNoticesForUser === 'function') setTimeout(loadNoticesForUser, 500);
  // URL 해시에서 이전 탭 복원
  setTimeout(restoreTab, 100);
}

// ─── 공지사항 (사용자용) ────────────────────────────────────────────────────
var _allActiveNotices = [];
var _noticePage = 1;
var _noticePageSize = 10;
var _noticeSearchTerm = '';

function _escapeHtml(s){
  return (s||'').toString().replace(/[<>&]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; });
}
function _formatNoticeKst(iso){
  if(!iso) return '';
  var d = new Date(iso);
  if(isNaN(d.getTime())) return iso;
  var kst = new Date(d.getTime() + 9*3600000);
  var s = kst.toISOString().slice(0,16).replace('T',' ');
  return s;
}
function _isNoticeActive(n, nowMs){
  if(n.startAt){
    var s = new Date(n.startAt).getTime();
    if(!isNaN(s) && nowMs < s) return false;
  }
  if(n.endAt){
    var e = new Date(n.endAt).getTime();
    if(!isNaN(e) && nowMs > e) return false;
  }
  return true;
}

function loadNoticesForUser(){
  db.ref('notices').orderByChild('createdAt').once('value').then(function(snap){
    var notices = [];
    snap.forEach(function(child){
      var n = child.val();
      n._id = child.key;
      notices.push(n);
    });
    notices.reverse();

    // 스케줄 적용 — 현재 시점에 활성인 공지만
    var nowMs = Date.now();
    _allActiveNotices = notices.filter(function(n){ return _isNoticeActive(n, nowMs); });

    // 배지: 활성 공지 수
    var badge = document.getElementById('notice-badge');
    if(badge){
      if(_allActiveNotices.length > 0){
        badge.textContent = _allActiveNotices.length;
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    }

    // 검색/페이지 초기화
    _noticeSearchTerm = '';
    _noticePage = 1;
    var searchEl = document.getElementById('notice-search');
    if(searchEl) searchEl.value = '';
    renderNoticeModal();

    // 팝업 공지 (활성 + popup 플래그 + 미열람만)
    var popupNotices = _allActiveNotices.filter(function(n){ return n.popup; });
    if(popupNotices.length > 0){
      var lastSeen = localStorage.getItem('lastNoticeId') || '';
      var newest = popupNotices[0];
      if(newest._id !== lastSeen){
        var body = document.getElementById('notice-popup-body');
        if(body){
          body.innerHTML = '<div style="padding:8px 0">'+
            '<div style="font-size:16px;font-weight:700;margin-bottom:4px">'+_escapeHtml(newest.title)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">🕒 '+_formatNoticeKst(newest.createdAt)+'</div>'+
            '<div style="font-size:13px;color:var(--text2);line-height:1.6;white-space:pre-wrap">'+_escapeHtml(newest.content)+'</div>'+
          '</div>';
          openModal('notice-popup-modal');
        }
      }
    }
  });
}

function onNoticeSearch(){
  var el = document.getElementById('notice-search');
  _noticeSearchTerm = (el ? el.value : '').trim().toLowerCase();
  _noticePage = 1;
  renderNoticeModal();
}

function changeNoticePage(p){
  _noticePage = p;
  renderNoticeModal();
  var listEl = document.getElementById('notice-modal-list');
  if(listEl) listEl.scrollTop = 0;
}

function renderNoticeModal(){
  var listEl = document.getElementById('notice-modal-list');
  var pagerEl = document.getElementById('notice-modal-pager');
  if(!listEl) return;

  var filtered = _noticeSearchTerm
    ? _allActiveNotices.filter(function(n){
        return (n.title||'').toLowerCase().indexOf(_noticeSearchTerm) >= 0;
      })
    : _allActiveNotices.slice();

  if(!filtered.length){
    listEl.innerHTML = '<div style="text-align:center;padding:30px 16px;color:var(--text3);font-size:13px">'+
      (_noticeSearchTerm ? '🔍 검색 결과가 없습니다' : '📭 공지사항이 없습니다')+'</div>';
    if(pagerEl) pagerEl.innerHTML = '';
    return;
  }

  var totalPages = Math.max(1, Math.ceil(filtered.length / _noticePageSize));
  if(_noticePage > totalPages) _noticePage = totalPages;
  var start = (_noticePage - 1) * _noticePageSize;
  var pageItems = filtered.slice(start, start + _noticePageSize);

  listEl.innerHTML = pageItems.map(function(n){
    var schedNote = '';
    if(n.endAt){
      var endStr = _formatNoticeKst(n.endAt);
      schedNote = '<span style="color:var(--text3)"> · ⏳ '+endStr+'까지</span>';
    }
    return '<div style="padding:12px 0;border-bottom:1px solid var(--border)">'+
      '<div style="font-size:15px;font-weight:700;margin-bottom:4px">'+_escapeHtml(n.title)+
        (n.popup?' <span style="display:inline-block;background:rgba(224,88,88,.15);color:#c0392b;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;vertical-align:middle">📢 팝업</span>':'')+
      '</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">🕒 '+_formatNoticeKst(n.createdAt)+schedNote+'</div>'+
      '<div style="font-size:13px;color:var(--text2);line-height:1.6;white-space:pre-wrap">'+_escapeHtml(n.content)+'</div>'+
    '</div>';
  }).join('');

  // 페이지네이션
  if(pagerEl){
    if(totalPages <= 1){
      pagerEl.innerHTML = '';
    } else {
      var html = '';
      var btnStyle = 'min-width:32px;height:32px;padding:0 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text2);font-size:12px;cursor:pointer;font-family:inherit';
      var activeStyle = btnStyle + ';background:var(--blue);color:#fff;border-color:var(--blue);font-weight:700';
      var disabledStyle = btnStyle + ';opacity:0.4;cursor:not-allowed';

      html += '<button style="'+(_noticePage===1?disabledStyle:btnStyle)+'" '+
        (_noticePage===1?'disabled':'onclick="changeNoticePage('+(_noticePage-1)+')"')+'>‹</button>';

      // 페이지 번호 (현재 ±2 표시)
      var pages = [];
      for(var p=1; p<=totalPages; p++){
        if(p===1 || p===totalPages || (p>=_noticePage-2 && p<=_noticePage+2)) pages.push(p);
      }
      var lastP = 0;
      pages.forEach(function(p){
        if(lastP && p > lastP + 1) html += '<span style="padding:0 4px;color:var(--text3)">…</span>';
        html += '<button style="'+(p===_noticePage?activeStyle:btnStyle)+'" onclick="changeNoticePage('+p+')">'+p+'</button>';
        lastP = p;
      });

      html += '<button style="'+(_noticePage===totalPages?disabledStyle:btnStyle)+'" '+
        (_noticePage===totalPages?'disabled':'onclick="changeNoticePage('+(_noticePage+1)+')"')+'>›</button>';

      pagerEl.innerHTML = html;
    }
  }
}

function closeNoticePopup(){
  // 팝업으로 띄운 가장 최신 공지를 읽음 처리
  if(_allActiveNotices && _allActiveNotices.length){
    var newest = _allActiveNotices.filter(function(n){ return n.popup; })[0];
    if(newest && newest._id) localStorage.setItem('lastNoticeId', newest._id);
  }
  closeModal('notice-popup-modal');
}

function loadUserData(){
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    if(snap.exists() && snap.val() && Object.keys(snap.val()).length > 0){
      D = {products:[], inventory:[], inventoryLogs:[], salesData:[], stockIn:[], stockDeductions:[], salesCost:[]};
      startApp();
      return;
    }
    if(!REF){ startApp(); return; }
    var done = false;
    var timer = setTimeout(function(){
      if(done) return; done = true;
      startApp();
      showToast('⚠️ 데이터 로드 실패 - 빈 상태로 시작');
    }, 8000);
    REF.once('value').then(function(snap){
      if(done) return; done = true;
      clearTimeout(timer);
      var val = snap.val();
      if(val){
        D.products      = val.products      || [];
        D.inventory     = val.inventory     || [];
        D.inventoryLogs = val.inventoryLogs || [];
        D.salesData     = val.salesData     || [];
      }
      startApp();
    }).catch(function(e){
      if(done) return; done = true;
      clearTimeout(timer);
      startApp();
    });
  });
}

function load(){ loadUserData(); } // 하위 호환

function save(){
  if(!REF){ return; }
  invalidateLocationsCache();
  REF.set(JSON.parse(JSON.stringify(D))).catch(function(e){
    console.error(e);
    showToast('⚠️ 저장 실패');
  });
}

// ─── locations 캐시 (성능 개선) ───────────────────────────────────────────────
var _locationsCache = null;
var _locationsCacheTime = 0;
function getLocationsData(callback){
  if(!currentUser){ callback(null); return; }
  // 10초 이내 캐시 사용
  if(_locationsCache && (Date.now() - _locationsCacheTime < 10000)){
    callback(_locationsCache);
    return;
  }
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    _locationsCache = snap.exists() ? snap.val() : null;
    _locationsCacheTime = Date.now();
    callback(_locationsCache);
  });
}
function invalidateLocationsCache(){ _locationsCache=null; _locationsCacheTime=0; }

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function td(){ var d=new Date(Date.now()+9*3600000); return d.toISOString().slice(0,10); }
function fmt(n){ return (Number(n)||0).toLocaleString('ko-KR'); }

// ─── 제품명 정규화 (공백/대소문자 무시) ──────────────────────────────────────
function normName(s){ return (s||'').toString().trim().toLowerCase().replace(/\s+/g,' '); }

// ─── 공통 제품 매칭 함수 (제품명 기준, 단일 소스 오브 트루스) ──────────────
// 어떤 소스(이름/ID/코드)든 받아서 D.products의 제품을 반환
function findProductById(identifier){
  if(!identifier || !D.products) return null;
  var id = String(identifier).trim();
  var key = normName(id);
  // 1차: id 직접 매칭
  var p = D.products.find(function(x){return x.id===id;});
  if(p) return p;
  // 2차: 제품명 매칭 (공백/대소문자 무시)
  p = D.products.find(function(x){return x.name && normName(x.name)===key;});
  if(p) return p;
  // 3차: productCode 매칭 (문자열 변환 + trim)
  p = D.products.find(function(x){return x.productCode && String(x.productCode).trim()===id;});
  if(p) return p;
  return null;
}

// ─── 판매 데이터 1건에서 제품 찾기 (itemName 우선, 제품번호 폴백) ──────────
function findProductForSale(sale){
  if(!sale) return null;
  // 1순위: itemName (제품명)
  if(sale.itemName){
    var p = findProductById(sale.itemName);
    if(p) return p;
  }
  // 2순위: productId
  if(sale.productId){
    var p2 = findProductById(sale.productId);
    if(p2) return p2;
  }
  return null;
}

// ─── 구매 데이터 1건에서 제품 찾기 (productMapping 우선) ────────────────────
function findProductForPurchase(purchase){
  if(!purchase) return null;
  // 1순위: productMapping에 저장된 매핑
  if(typeof findMappedProduct === 'function' && purchase.coupangProductName){
    var mapped = findMappedProduct(purchase.coupangProductName);
    if(mapped && mapped.productId){
      var p = D.products.find(function(x){return x.id===mapped.productId;});
      if(p) return p;
    }
  }
  // 2순위: 제품명 자동 매칭
  if(purchase.coupangProductName){
    var p2 = findProductById(purchase.coupangProductName);
    if(p2) return p2;
  }
  return null;
}

// ─── 디버그: 제품 재고 조회 상세 로그 ─────────────────────────────────────
var _gqDebug = false; // window.DEBUG_GQ = true 로 켜기
if(typeof window !== 'undefined'){ window.DEBUG_GQ = function(on){ _gqDebug = !!on; }; }

// ─── 제품의 현재 재고 조회 (제품명 기준) ────────────────────────────────────
// 제품을 찾아서 그 제품의 모든 관련 batch/inventory 합산
function gq(pid){
  if(!pid) return 0;
  // D.products에서 제품 찾기 (id/이름/코드 모두 시도)
  var prod = findProductById(pid);
  if(_gqDebug) console.log('[gq]', pid, '→ prod:', prod ? (prod.name+' ('+prod.id+')') : 'NULL');

  // 제품을 찾았으면 해당 제품과 같은 이름인 모든 batch 합산
  if(prod){
    var total = 0;
    var key = normName(prod.name);

    // stockIn 합산 (제품명 기준 — ID 체계 차이 대응)
    if(D.stockIn && D.stockIn.length){
      D.stockIn.forEach(function(b){
        if(!b || !b.remainingQty) return;
        // 1) batch의 productId 가 이 제품의 id 또는 productCode 면 포함
        if(b.productId === prod.id) { total += b.remainingQty; return; }
        if(prod.productCode && (b.productId === prod.productCode || b.productCode === prod.productCode)) {
          total += b.remainingQty; return;
        }
        // 2) batch의 productId 로 D.products 에서 이름 찾아 비교
        var otherProd = D.products.find(function(x){return x.id===b.productId || x.productCode===b.productId;});
        if(otherProd && otherProd.name && normName(otherProd.name)===key){
          total += b.remainingQty; return;
        }
        // 3) batch의 memo 에서 제품명 포함 여부 (쿠팡 입고: "쿠팡 구매 (제품명)")
        if(b.memo && key && normName(b.memo).indexOf(key) >= 0){
          total += b.remainingQty;
        }
      });
    }
    if(total > 0) return total;

    // inventory 합산 (구 시스템)
    if(D.inventory && D.inventory.length){
      D.inventory.forEach(function(i){
        if(!i) return;
        if(i.productId === prod.id) total += (i.qty||0);
        else if(prod.productCode && i.productId === prod.productCode) total += (i.qty||0);
      });
    }
    return total;
  }

  // 제품을 못 찾은 경우: 원본 ID로 직접 조회 (매칭 실패 대비)
  var siTotal = 0;
  if(D.stockIn){ D.stockIn.forEach(function(b){ if(b && b.productId===pid) siTotal += (b.remainingQty||0); }); }
  if(siTotal > 0) return siTotal;
  if(D.inventory){
    var inv = D.inventory.find(function(x){return x.productId===pid;});
    if(inv) return inv.qty;
  }
  return 0;
}
function gp(id){ return findProductById(id); }
function showToast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  clearTimeout(t._t); t._t=setTimeout(function(){t.style.display='none';},2500);
}
function renderAll(){ renderHome(); renderInv(); renderSales(); renderMachine(); renderProds(); }
