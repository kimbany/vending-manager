// ─── 실시간 판매 데이터 수집 (Cloud Function으로 VMMS 실시간 크롤링) ─────────
// 제품 불러오기(crawlVmmsRealtime)와 동일한 패턴:
// 버튼 클릭 → Cloud Function이 VMMS 접속 → 크롤링 → Firebase 저장 → 클라이언트 반영

var autoCollectTimer = null;

function startAutoCollect(){
  checkAndAutoCollect();
  autoCollectTimer = setInterval(checkAndAutoCollect, 60 * 1000);
}

function checkAndAutoCollect(){
  var now = new Date();
  var h = now.getHours(), m = now.getMinutes();
  if((h===12||h===19) && m===0){
    fetchTodaySales(true);
  }
}

function updateAutoCollectStatus(){
  var el = document.getElementById('auto-collect-status');
  if(!el) return;
  var last = localStorage.getItem('lastAutoCollect');
  el.textContent = '자동수집: 매일 12:00 · 19:00' + (last ? ' · 마지막: '+last : '');
}

var _fetchInProgress = false;

// 선택 날짜 크롤링 (Cloud Function에 날짜 전달)
function triggerCrawlForDate(){
  var dateInput = document.getElementById('crawl-date');
  var date = dateInput ? dateInput.value : '';
  if(!date){showToast('❌ 날짜를 선택하세요');return;}
  if(!currentUser){showToast('❌ 로그인 필요');return;}

  var btn = document.getElementById('trigger-crawl-btn');
  btn.textContent = '⏳ VMMS에서 '+date+' 수집 중...'; btn.disabled = true;

  var crawlFn = firebase.app().functions('asia-northeast3').httpsCallable('crawlVmmsSales', {timeout: 300000});
  crawlFn({date: date}).then(function(result){
    var d = result.data;
    showToast('✅ ' + d.message);
    btn.textContent = '⏳ 데이터 반영 중...';
    return _applyCrawledData(true, date);
  }).then(function(){
    btn.textContent = '⚡ 선택 날짜 크롤링 실행'; btn.disabled = false;
  }).catch(function(e){
    btn.textContent = '⚡ 선택 날짜 크롤링 실행'; btn.disabled = false;
    showToast('❌ 수집 실패: ' + (e.message || '알 수 없는 오류'));
  });
}

// ─── 메인: 버튼 클릭 or 자동수집 ──────────────────────────────────────────
function fetchTodaySales(isAuto){
  if(_fetchInProgress){
    if(!isAuto) showToast('⏳ 수집이 이미 진행 중이에요');
    return;
  }
  _fetchInProgress = true;
  var btn = document.getElementById('crawl-btn');
  if(btn){ btn.textContent='⏳ VMMS에서 실시간 수집 중...'; btn.disabled=true; }

  if(!currentUser){
    _resetBtn(btn); showToast('❌ 로그인 후 사용해주세요');
    return;
  }

  if(!isAuto) showToast('⏳ VMMS에서 실시간 판매 데이터를 수집하고 있어요... (1~2분 소요)');

  // Cloud Function 호출 → VMMS 실시간 크롤링
  var crawlFn = firebase.app().functions('asia-northeast3').httpsCallable('crawlVmmsSales', {timeout: 300000});

  crawlFn().then(function(result){
    var d = result.data;
    console.log('[실시간수집] 완료:', d.message);
    if(!isAuto) showToast('✅ ' + d.message);
    if(btn){ btn.textContent='⏳ 데이터 반영 중...'; }
    // 크롤링 완료 → Firebase에서 데이터 읽어서 반영
    return _applyCrawledData(isAuto);
  }).catch(function(e){
    console.log('[실시간수집] 실패:', e.code, e.message);
    _resetBtn(btn);
    if(e.code === 'functions/failed-precondition'){
      showToast('⚠️ ' + e.message);
    } else if(e.code === 'functions/unauthenticated'){
      showToast('❌ 로그인이 필요합니다');
    } else {
      if(!isAuto) showToast('❌ 실시간 수집 실패: ' + (e.message || '알 수 없는 오류'));
    }
  });
}

function _resetBtn(btn){
  if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; }
  _fetchInProgress = false;
}

// ─── Firebase에서 크롤링된 데이터 읽어서 salesData에 반영 ──────────────────
function _applyCrawledData(isAuto, customDate){
  var btn = document.getElementById('crawl-btn');
  var today = customDate || td();

  if(!CRAWL_REF){
    _resetBtn(btn);
    return;
  }

  CRAWL_REF.child(today).once('value').then(function(snap){
    var val = snap.val();
    _resetBtn(btn);
    if(!val || !val.rows){
      if(!isAuto) showToast('📭 수집된 데이터가 없어요');
      return;
    }

    // rows가 Firebase에서 객체로 변환된 경우 배열로 변환
    var rows = val.rows;
    if(rows && !Array.isArray(rows)){
      rows = Object.keys(rows).sort(function(a,b){return parseInt(a)-parseInt(b);}).map(function(k){return rows[k];});
    }
    if(!rows || !rows.length){
      if(!isAuto) showToast('📭 수집된 데이터가 없어요 (total:'+val.total_count+')');
      return;
    }
    val.rows = rows;

    // 헤더 인덱스 찾기
    var headers = val.headers || [];
    if(headers && !Array.isArray(headers)){
      headers = Object.keys(headers).sort(function(a,b){return parseInt(a)-parseInt(b);}).map(function(k){return headers[k];});
      val.headers = headers;
    }

    var colDate    = headers.indexOf('거래일시');
    var colItem    = headers.indexOf('판매항목');
    var colNum     = headers.indexOf('컬럼');
    var colState   = headers.indexOf('상태');
    if(colState<0) colState = headers.indexOf('진행상태');
    var colTxId    = headers.indexOf('일련번호');
    if(colTxId<0)  colTxId  = headers.indexOf('거래고유번호');
    var colAmt     = headers.indexOf('판매가');
    if(colAmt<0)   colAmt   = headers.indexOf('금액');
    var colMachine = headers.indexOf('단말기명');
    var colMachineCode = headers.indexOf('머신기코드');
    var colDevno = headers.indexOf('단말기번호');
    var colCancelDate = headers.indexOf('취소일');
    if(colCancelDate<0) colCancelDate = headers.indexOf('취소일시');

    // 헤더가 실제 rows와 불일치하는 경우 rows 첫 행으로 재탐색
    if(val.rows.length > 0){
      var r0 = val.rows[0];
      for(var ci=0; ci<r0.length; ci++){
        var v = String(r0[ci]||'').trim();
        if(v==='거래일시' && colDate<0) colDate=ci;
        if(v==='판매항목' && colItem<0) colItem=ci;
        if(v==='컬럼' && colNum<0) colNum=ci;
        if((v==='상태'||v==='진행상태') && colState<0) colState=ci;
        if((v==='일련번호'||v==='거래고유번호') && colTxId<0) colTxId=ci;
        if((v==='판매가'||v==='금액') && colAmt<0) colAmt=ci;
        if(v==='단말기명' && colMachine<0) colMachine=ci;
        if(v==='머신기코드' && colMachineCode<0) colMachineCode=ci;
        if(v==='단말기번호' && colDevno<0) colDevno=ci;
      }
    }

    // 헤더-rows 불일치 자동 보정
    if(val.rows.length > 0){
      var sampleRow = val.rows[0];
      for(var ci=0; ci<sampleRow.length; ci++){
        var v = String(sampleRow[ci]||'').trim();
        if(/^\d{1,2}$/.test(v) && parseInt(v) >= 1 && parseInt(v) <= 99){
          if(Math.abs(ci - colNum) <= 2){ colNum = ci; break; }
        }
      }
    }

    if(colNum<0){ showToast('❌ 수집 데이터에 컬럼 필드 없음'); return; }

    var added=0, dup=0;

    // VMMS 제품 목록 로드 (상품명 자동 매칭용)
    Promise.all([
      db.ref('users/'+currentUser.uid+'/locations').once('value'),
      db.ref('users/'+currentUser.uid+'/vmmsProducts').once('value')
    ]).then(function(results){
      var locSnap = results[0];
      var vmmsProdSnap = results[1].val();
      var vmmsItems = (vmmsProdSnap && vmmsProdSnap.items) ? vmmsProdSnap.items : [];
      if(!Array.isArray(vmmsItems)) vmmsItems = Object.values(vmmsItems);
      console.log('[수집] VMMS 제품 수:', vmmsItems.length);
      var machineByCode = {}, machineByName = {};

      if(!locSnap.exists()){
        if(!isAuto) showToast('📭 위치/자판기를 먼저 등록해주세요');
        return;
      }

      locSnap.forEach(function(locChild){
        var loc = locChild.val();
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m = loc.machines[mid];
          var key = locChild.key+'|'+mid;
          var devnos = Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
          devnos.forEach(function(d){ machineByCode[d] = key; });
          if(m.name) machineByName[m.name] = key;
        });
      });

      // 행을 자판기별로 분류
      var rowsByMachine = {};
      var noMatchCount = 0;
      val.rows.forEach(function(row, ri){
        var rowMach = colMachine>=0 ? String(row[colMachine]||'').trim() : '';
        var rowCode = colMachineCode>=0 ? String(row[colMachineCode]||'').trim() : '';
        var rowCodeClean = rowCode.replace(/\(.*\)/, '').trim();
        if(colDevno>=0 && row[colDevno]) rowCodeClean = String(row[colDevno]).trim();

        var machineKey = machineByCode[rowCodeClean] || machineByName[rowMach];
        if(!machineKey){
          Object.keys(machineByCode).forEach(function(code){
            if(rowCodeClean && (code.indexOf(rowCodeClean)>=0 || rowCodeClean.indexOf(code)>=0)){
              machineKey = machineByCode[code];
            }
          });
        }
        if(!machineKey){
          noMatchCount++;
          return;
        }
        if(!rowsByMachine[machineKey]) rowsByMachine[machineKey] = [];
        rowsByMachine[machineKey].push(row);
      });

      if(noMatchCount > 0) console.log('[수집] 자판기 미매칭 행:', noMatchCount);

      // 각 자판기별로 데이터 반영
      Object.keys(rowsByMachine).forEach(function(machineKey){
        var parts = machineKey.split('|');
        var locId = parts[0], mid = parts[1];
        var machRows = rowsByMachine[machineKey];
        var ref = db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+mid+'/appData');

        ref.once('value').then(function(machSnap){
          var machVal = machSnap.val() || {};
          var prods = machVal.products || [];
          var inv = machVal.inventory || [];
          var logs = machVal.inventoryLogs || [];
          var sales = machVal.salesData || [];
          if(!Array.isArray(prods)) prods = Object.values(prods);
          if(!Array.isArray(inv)) inv = Object.values(inv);
          if(!Array.isArray(logs)) logs = Object.values(logs);
          if(!Array.isArray(sales)) sales = Object.values(sales);

          // 해당 날짜의 기존 데이터 제거 (재수집 시 중복 방지)
          var targetDate = today;
          sales = sales.filter(function(s){ return s.date !== targetDate; });

          machRows.forEach(function(row){
            var txId = colTxId>=0 ? String(row[colTxId]||'').trim() : '';
            var colNo = String(row[colNum]||'').trim();
            var amt = colAmt>=0 ? parseInt(String(row[colAmt]||'0').replace(/[^0-9]/g,'')) : 0;
            var dateStr = colDate>=0 ? String(row[colDate]||'').trim() : today;
            var state = colState>=0 ? String(row[colState]||'').trim() : '';
            var itemName = colItem>=0 ? String(row[colItem]||'').trim() : '';
            var cancelDate = colCancelDate>=0 ? String(row[colCancelDate]||'').trim() : '';
            var isCancelled = state.indexOf('취소') >= 0 || (cancelDate && cancelDate.length > 2);

            // 중복 체크
            var isDup = sales.some(function(s){
              if(txId && s.txId) return s.txId === txId;
              return s.date === dateStr.slice(0,10) && s.column === colNo && s.amount === amt && s.time === dateStr;
            });
            if(isDup){ dup++; return; }

            // 제품 매칭 (제품명 기준 → 컬럼번호 폴백)
            var pid = '';
            // 1차: 제품명으로 매칭
            if(itemName){
              var nameMatch = prods.find(function(p){ return p.name && p.name.trim() === itemName.trim(); });
              if(nameMatch) pid = nameMatch.id;
            }
            // 2차: 컬럼번호로 폴백
            if(!pid){
              prods.forEach(function(p){
                var cols = Array.isArray(p.column) ? p.column : (p.column ? [p.column] : []);
                cols.forEach(function(c){
                  var cStr = String(c).trim();
                  if(cStr === colNo) pid = p.id;
                  if(cStr.indexOf('~') >= 0){
                    var range = cStr.split('~');
                    var start = parseInt(range[0]), end = parseInt(range[1]);
                    var cn = parseInt(colNo);
                    if(cn >= start && cn <= end) pid = p.id;
                  }
                });
              });
            }

            sales.push({
              productId: pid,
              column: colNo,
              qty: 1,
              amt: amt,
              amount: amt,
              date: dateStr.slice(0,10),
              time: dateStr,
              state: state,
              cancelled: isCancelled,
              txId: txId,
              itemName: itemName,
              source: 'crawl'
            });
            added++;

            // 재고 차감 (취소가 아닌 경우)
            if(!isCancelled && pid){
              var invIdx = inv.findIndex(function(x){ return x.productId === pid; });
              if(invIdx >= 0){
                inv[invIdx].qty = Math.max(0, inv[invIdx].qty - 1);
              }
            }
          });

          // 현재 자판기면 D도 업데이트
          if(locId === currentLocationId && mid === currentMachineId){
            D.salesData = sales;
            D.inventory = inv;
          }

          ref.update({
            salesData: sales,
            inventory: inv
          });
        });
      });

      if(!isAuto) showToast('✅ '+added+'건 반영 (중복 '+dup+'건 제외)');
      localStorage.setItem('lastAutoCollect', new Date().toLocaleString('ko-KR'));
      updateAutoCollectStatus();
      renderAll();
    });
  });
}
