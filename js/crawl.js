// ─── 자동/수동 판매 데이터 수집 (Cloud Function 실시간 크롤링 + Firebase 연동) ──
// 버튼 클릭: Cloud Function으로 실시간 VMMS 크롤링 → Firebase 저장 → 데이터 반영
// 자동수집: 매일 12:00, 19:00에 Cloud Function 호출

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
  updateAutoCollectStatus();
}

function updateAutoCollectStatus(){
  var el = document.getElementById('auto-collect-status');
  if(!el) return;
  var last = localStorage.getItem('lastAutoCollect');
  el.textContent = '자동수집: 매일 12:00 · 19:00' + (last ? ' · 마지막: '+last : '');
}

var _fetchInProgress = false;

// ─── 실시간 판매 데이터 수집 (Cloud Function 호출 → Firebase 반영) ──────────
function fetchTodaySales(isAuto){
  if(_fetchInProgress){
    if(!isAuto) showToast('⏳ 수집이 이미 진행 중이에요');
    return;
  }
  _fetchInProgress = true;
  var btn = document.getElementById('crawl-btn');
  if(btn){ btn.textContent='⏳ 데이터 확인 중...'; btn.disabled=true; }

  if(!currentUser){
    if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    showToast('❌ 로그인 후 사용해주세요');
    return;
  }

  if(!CRAWL_REF){
    if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    showToast('❌ 로그인 후 사용해주세요');
    return;
  }

  var today = td();

  // 1단계: Firebase에 이미 크롤링된 데이터가 있는지 먼저 확인
  CRAWL_REF.child(today).once('value').then(function(snap){
    var val = snap.val();
    if(val && val.rows){
      // 이미 데이터 있음 → 바로 반영 시도, 동시에 실시간 크롤링도 시도
      console.log('[수집] 기존 데이터 발견 (total:'+val.total_count+'), 먼저 반영 후 실시간 업데이트');
      if(!isAuto) showToast('📦 기존 데이터 반영 중... 실시간 업데이트도 시도합니다');
      if(btn){ btn.textContent='⏳ 데이터 반영 중...'; }
      // 기존 데이터 반영
      _fetchInProgress = false;
      applyTodaySalesFromFirebase(isAuto);
      // 백그라운드로 실시간 크롤링 시도 (결과가 오면 다시 반영)
      _triggerRealtimeCrawl(isAuto);
    } else {
      // 데이터 없음 → 실시간 크롤링 시도
      console.log('[수집] 기존 데이터 없음, 실시간 크롤링 시도');
      if(btn){ btn.textContent='⏳ VMMS에서 실시간 수집 중...'; }
      if(!isAuto) showToast('⏳ VMMS에서 실시간 판매 데이터를 수집하고 있어요... (1~2분 소요)');
      _doRealtimeCrawlAndApply(isAuto);
    }
  }).catch(function(e){
    console.log('[수집] Firebase 확인 실패:', e.message);
    if(btn){ btn.textContent='⏳ VMMS에서 실시간 수집 중...'; }
    _doRealtimeCrawlAndApply(isAuto);
  });
}

// Cloud Function으로 실시간 크롤링 후 반영
function _doRealtimeCrawlAndApply(isAuto){
  var btn = document.getElementById('crawl-btn');
  var crawlFn;
  try {
    crawlFn = firebase.app().functions('asia-northeast3').httpsCallable('crawlVmmsSales', {timeout: 300000});
  } catch(e){
    console.log('[실시간수집] Cloud Function 초기화 실패:', e);
    if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    if(!isAuto) showToast('⚠️ 실시간 크롤링을 사용할 수 없어요.\nCloud Function 배포가 필요합니다.');
    return;
  }

  crawlFn().then(function(result){
    var d = result.data;
    console.log('[실시간수집] Cloud Function 완료:', d.message);
    if(!isAuto) showToast('✅ ' + d.message + '\n데이터를 반영하고 있어요...');
    if(btn){ btn.textContent='⏳ 데이터 반영 중...'; }
    return applyTodaySalesFromFirebase(isAuto);
  }).catch(function(e){
    console.log('[실시간수집] Cloud Function 실패:', e.code, e.message);
    if(e.code === 'functions/failed-precondition'){
      if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
      showToast('⚠️ ' + e.message);
      return;
    }
    if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    if(!isAuto) showToast('⚠️ 실시간 수집 실패: Cloud Function 배포가 필요합니다.\n터미널에서 firebase deploy --only functions 를 실행해주세요.');
  });
}

// 백그라운드 실시간 크롤링 (기존 데이터 반영 후 최신화)
function _triggerRealtimeCrawl(isAuto){
  var btn = document.getElementById('crawl-btn');
  var crawlFn;
  try {
    crawlFn = firebase.app().functions('asia-northeast3').httpsCallable('crawlVmmsSales', {timeout: 300000});
  } catch(e){ return; }

  crawlFn().then(function(result){
    var d = result.data;
    console.log('[백그라운드수집] Cloud Function 완료:', d.message);
    // 새로운 데이터로 다시 반영
    applyTodaySalesFromFirebase(isAuto);
    if(!isAuto) showToast('🔄 실시간 데이터로 업데이트 완료! ' + d.message);
  }).catch(function(e){
    console.log('[백그라운드수집] Cloud Function 실패 (무시):', e.code, e.message);
    // 백그라운드이므로 실패해도 무시 (기존 데이터는 이미 반영됨)
  });
}

// ─── Firebase에서 크롤링 데이터 가져와 반영 (기존 로직) ────────────────────
function applyTodaySalesFromFirebase(isAuto){
  var btn = document.getElementById('crawl-btn');
  var today = td();

  if(!CRAWL_REF){
    if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    if(!isAuto) showToast('❌ 로그인 후 사용해주세요');
    return;
  }

  CRAWL_REF.child(today).once('value').then(function(snap){
    var val = snap.val();
    console.log('[수집] 최종 val:', val ? '있음 total='+val.total_count : 'null');
    if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    if(!val){
      if(!isAuto) showToast('📭 오늘('+today+') 수집 데이터 없음');
      return;
    }
    // rows가 Firebase에서 객체로 변환된 경우 배열로 변환
    var rows = val.rows;
    if(rows && !Array.isArray(rows)){
      rows = Object.keys(rows).sort(function(a,b){return parseInt(a)-parseInt(b);}).map(function(k){return rows[k];});
    }
    console.log('[수집] rows 수:', rows ? rows.length : 0);
    if(!rows || !rows.length){
      if(!isAuto) showToast('📭 오늘 수집된 데이터 없음 (total:'+val.total_count+')');
      return;
    }
    val.rows = rows;

    // 헤더 인덱스 찾기
    var headers = val.headers || [];
    if(headers && !Array.isArray(headers)){
      headers = Object.keys(headers).sort(function(a,b){return parseInt(a)-parseInt(b);}).map(function(k){return headers[k];});
      val.headers = headers;
    }
    console.log('[수집] headers:', headers);

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
    if(val.rows && val.rows.length > 0){
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
    console.log('[수집] 컬럼인덱스 재확인 - 날짜:'+colDate+' 항목:'+colItem+' 컬럼:'+colNum+' 단말기번호:'+colDevno+' 머신기코드:'+colMachineCode+' 금액:'+colAmt);
    if(val.rows && val.rows.length > 1) console.log('[수집] 첫행 샘플 - 판매가raw:', val.rows[1][colAmt], 'type:', typeof val.rows[1][colAmt]);

    // 헤더-rows 불일치 자동 보정
    if(val.rows && val.rows.length > 0){
      var sampleRow = val.rows[0];
      for(var ci=0; ci<sampleRow.length; ci++){
        var v = String(sampleRow[ci]||'').trim();
        if(/^\d{1,2}$/.test(v) && parseInt(v) >= 1 && parseInt(v) <= 99){
          if(Math.abs(ci - colNum) <= 2){
            console.log('컬럼번호 위치 보정:', colNum, '→', ci);
            colNum = ci;
            break;
          }
        }
      }
    }

    console.log('헤더:', headers);
    console.log('컬럼인덱스 - 날짜:'+colDate+' 컬럼:'+colNum+' 상태:'+colState+' txId:'+colTxId);

    if(colNum<0){ showToast('❌ 수집 데이터에 컬럼 필드 없음'); return; }

    // 날짜+시간초+상품명 기준 중복키 Set
    var existingKeys = {};
    D.salesData.forEach(function(s){ if(s.dupKey) existingKeys[s.dupKey]=true; });

    var added=0, dup=0, filtered=0;

    // 모든 위치/자판기 로드 → 단말기번호 기준으로 행 분배
    db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(locSnap){
      var machineByCode = {}, machineByName = {};
      var machineDataMap = {};

      if(!locSnap.exists()){
        if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
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
      console.log('[수집] machineByCode:', JSON.stringify(machineByCode));
      console.log('[수집] machineByName:', JSON.stringify(machineByName));

      // 행을 자판기별로 분류
      var rowsByMachine = {};
      var noMatchCount = 0;
      val.rows.forEach(function(row, ri){
        var rowMach = colMachine>=0 ? String(row[colMachine]||'').trim() : '';
        var rowCode = colMachineCode>=0 ? String(row[colMachineCode]||'').trim() : '';
        var rowCodeClean = rowCode.replace(/\(.*\)/, '').trim();
        if(colDevno>=0 && row[colDevno]) rowCodeClean = String(row[colDevno]).trim();
        var key = machineByCode[rowCodeClean] || machineByCode[rowCode] || machineByName[rowMach] || (currentLocationId&&currentMachineId ? currentLocationId+'|'+currentMachineId : null);
        if(!key){
          noMatchCount++;
          console.log('[매칭실패] row'+ri+' 단말기:'+rowCodeClean+' 이름:'+rowMach+' 항목:'+String(row[colItem]||'').trim());
          return;
        }
        if(!rowsByMachine[key]) rowsByMachine[key]=[];
        rowsByMachine[key].push(row);
      });
      if(noMatchCount) console.log('[수집] 단말기 매칭 실패: '+noMatchCount+'건');

      // rows 내부 중복 체크
      var globalSeen = {};
      Object.keys(rowsByMachine).forEach(function(k){
        var deduped = [];
        rowsByMachine[k].forEach(function(row){
          var dateRaw = String(row[colDate]||'').trim();
          if(!dateRaw) return;
          var dk = row.map(function(c){return String(c||'').trim();}).join('|');
          if(globalSeen[dk]) return;
          globalSeen[dk] = true;
          deduped.push(row);
        });
        rowsByMachine[k] = deduped;
      });
      var totalAfterDedup = Object.values(rowsByMachine).reduce(function(s,r){return s+r.length;},0);
      console.log('[수집] 중복제거 후 rows:', totalAfterDedup, '/ 원본:', val.rows.length);

      var keys = Object.keys(rowsByMachine);
      if(!keys.length){
        if(currentLocationId && currentMachineId){
          rowsByMachine[currentLocationId+'|'+currentMachineId] = val.rows;
          keys = [currentLocationId+'|'+currentMachineId];
          if(!isAuto) showToast('⚠️ 단말기번호 미매칭 → 현재 자판기에 저장');
        } else {
          if(!isAuto) showToast('📭 등록된 자판기와 일치하는 데이터 없음\n설정에서 단말기번호를 확인해주세요');
          if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
          return;
        }
      }

      // 자판기별 appData 로드 후 저장
      var promises = keys.map(function(key){
        var parts = key.split('|');
        var locId=parts[0], machineId=parts[1];
        var appRef = db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+machineId+'/appData');
        return appRef.once('value').then(function(snap){
          var mData = snap.val()||{};
          var mProds = mData.products||[], mInv = mData.inventory||[];
          var mLogs = mData.inventoryLogs||[], mSales = mData.salesData||[];
          var isCurrentMachine = (locId===currentLocationId && machineId===currentMachineId);

          var existingKeysM = {};
          mSales.forEach(function(s){ if(s.dupKey) existingKeysM[s.dupKey]=true; });
          console.log('[수집] 기존 salesData 수:', mSales.length, '/ 중복키 수:', Object.keys(existingKeysM).length, '/ 자판기:', machineId.slice(-6));

          var qtyMap = {};
          var machineAdded = 0;
          var skipReasons = {header:0, noDate:0, noCol:0, cancel:0, dup:0};

          function findProd(colVal, name){ return findProduct(colVal, name, mProds); }

          (rowsByMachine[key]||[]).forEach(function(row, ri){
            if(String(row[colDate]||'').trim() === '거래일시'){ skipReasons.header++; return; }
            var dateRaw = String(row[colDate]||'').trim();
            var itemName = String(row[colItem]||'').trim();
            var colVal = String(row[colNum]||'').trim();
            var state = colState>=0 ? String(row[colState]||'').trim() : '';
            var txId = colTxId>=0 ? String(row[colTxId]||'').trim() : '';
            var amt = colAmt>=0 ? (typeof row[colAmt]==='number' ? row[colAmt] : parseFloat(String(row[colAmt]||0).replace(/,/g,''))||0) : 0;

            if(!dateRaw){ skipReasons.noDate++; console.log('[스킵-날짜없음] row'+ri+':', JSON.stringify(row)); return; }
            var cancelDateVal = colCancelDate>=0 ? String(row[colCancelDate]||'').trim() : '';
            var isCancelled = (state&&(state==='취소'||state==='취소완료'||state==='환불')) || (cancelDateVal && cancelDateVal!=='-' && cancelDateVal!=='null');
            if(isCancelled) skipReasons.cancel++;

            var dt = dateRaw.length>=19 ? dateRaw.slice(0,19) : dateRaw;
            var dupKey = dt+'|'+itemName.trim()+'|'+amt;
            if(existingKeysM[dupKey]){
              dup++;
              skipReasons.dup++;
              return;
            }
            existingKeysM[dupKey]=true;

            var dateStr = dateRaw.length>=10 ? dateRaw.slice(0,10) : dateRaw;
            var hour = dateRaw.length>=13 ? parseInt(dateRaw.slice(11,13)) : -1;
            var minute = dateRaw.length>=16 ? parseInt(dateRaw.slice(14,16)) : -1;
            var prod = findProd(colVal, itemName);

            mSales.push({id:Date.now().toString()+Math.random(), txId:txId, dupKey:dupKey, date:dateStr, hour:hour, minute:minute, productId:prod?prod.id:null, itemName:itemName, colVal:colVal, qty:1, amt:amt, cancelled:isCancelled});
            if(prod && !isCancelled) qtyMap[prod.id]=(qtyMap[prod.id]||0)+1;
            machineAdded++;
            added++;
          });

          // 재고 차감
          Object.keys(qtyMap).forEach(function(pid){
            var idx=mInv.findIndex(function(i){return i.productId===pid;});
            var qty=qtyMap[pid];
            if(idx>=0) mInv[idx].qty=Math.max(0,mInv[idx].qty-qty);
            else mInv.push({productId:pid,qty:0});
            mLogs.push({id:Date.now().toString()+Math.random(),productId:pid,delta:-qty,memo:'자동수집 차감 '+today,date:today});
          });

          console.log('[수집결과-자판기] key:'+key+' 입력rows:'+((rowsByMachine[key]||[]).length)+' 추가:'+machineAdded+' 스킵:', JSON.stringify(skipReasons));
          var saveData={products:mProds,inventory:mInv,inventoryLogs:mLogs,salesData:mSales};
          if(isCurrentMachine){
            D.salesData=mSales; D.inventory=mInv; D.inventoryLogs=mLogs;
          }
          return appRef.set(saveData);
        });
      });

      Promise.all(promises).then(function(){
        if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
        if(added>0 || dup>0 || noMatchCount>0){
          var totalRows = val.rows ? val.rows.length : 0;
          var details = [];
          if(added>0) details.push('반영:'+added);
          if(dup>0) details.push('중복:'+dup);
          if(noMatchCount>0) details.push('미매칭:'+noMatchCount);
          var msg=(isAuto?'🤖 자동수집':'✅ 수집완료')+' 원본 '+totalRows+'건 → '+details.join(' · ');
          console.log('[수집결과] 전체rows:'+(val.rows?val.rows.length:0)+' 반영:'+added+' 중복:'+dup+' 매칭실패:'+noMatchCount);
          showToast(msg);
          localStorage.setItem('lastAutoCollect', today+' '+new Date().toTimeString().slice(0,5));
          updateAutoCollectStatus();
          renderAll();
          if(typeof checkNewProducts === 'function') setTimeout(checkNewProducts, 500);
        } else {
          if(!isAuto) showToast(dup>0?'이미 모두 반영된 데이터예요 ('+dup+'건 중복)':'📭 새 데이터가 없어요');
        }
      });
    });
  }).catch(function(e){
    if(btn){ btn.textContent='🔄 오늘 판매 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    if(!isAuto) showToast('❌ 수집 실패: '+e.message);
  });
}
