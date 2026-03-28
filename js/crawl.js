// ─── 자동/수동 판매 데이터 수집 (Firebase Realtime DB 크롤러 연동) ──────────
// 크롤러가 vendingApp/crawledSales/{날짜} 에 저장한 데이터를 읽어서 반영

// CRAWL_REF는 Auth 상태에서 설정됨
var autoCollectTimer = null;

function startAutoCollect(){
  // 오후 12:00, 19:00 자동 수집
  checkAndAutoCollect();
  autoCollectTimer = setInterval(checkAndAutoCollect, 60 * 1000); // 1분마다 체크
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

var _fetchInProgress = false; // 중복 실행 방지

function fetchTodaySales(isAuto){
  if(_fetchInProgress){
    if(!isAuto) showToast('⏳ 수집이 이미 진행 중이에요');
    return;
  }
  _fetchInProgress = true;
  var btn = document.getElementById('crawl-btn');
  if(btn){ btn.textContent='⏳ 수집 중...'; btn.disabled=true; }

  var today = td();
  console.log('[수집] 시작, today='+today+', CRAWL_REF=', CRAWL_REF ? CRAWL_REF.toString() : 'null');

  if(!CRAWL_REF){
    if(btn){ btn.textContent='🔄 오늘 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    showToast('❌ 로그인 후 사용해주세요');
    return;
  }

  CRAWL_REF.child(today).once('value').then(function(snap){
    var snapVal = snap.val();
    console.log('[수집] 개인경로 snap exists:', snap.exists(), 'keys:', snapVal ? Object.keys(snapVal) : 'null', 'total_count:', snapVal ? snapVal.total_count : '-');
    if(snap.exists() && snapVal && (snapVal.rows || snapVal.total_count > 0)) return snap;
    console.log('[수집] 공용경로 fallback');
    return db.ref('vendingApp/crawledSales/'+today).once('value');
  }).then(function(snap){
    var val = snap.val();
    console.log('[수집] 최종 val:', val ? '있음 total='+val.total_count : 'null');
    if(btn){ btn.textContent='🔄 오늘 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    if(!val){
      if(!isAuto) showToast('📭 오늘('+today+') 수집 데이터 없음. 크롤러를 실행해주세요');
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

    // 헤더가 실제 rows와 불일치하는 경우 rows 첫 행으로 재탐색
    if(val.rows && val.rows.length > 0){
      var r0 = val.rows[0];
      // rows에서 직접 헤더 필드 위치 찾기
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

    // 헤더-rows 불일치 자동 보정:
    // 첫 번째 row로 컬럼 번호 위치를 실제로 찾기
    if(val.rows && val.rows.length > 0){
      var sampleRow = val.rows[0];
      // 숫자만 있는 짧은 값(컬럼번호)을 찾아서 실제 인덱스 보정
      for(var ci=0; ci<sampleRow.length; ci++){
        var v = String(sampleRow[ci]||'').trim();
        // 1~2자리 숫자면 컬럼번호 후보
        if(/^\d{1,2}$/.test(v) && parseInt(v) >= 1 && parseInt(v) <= 99){
          // 해당 위치가 헤더에서 '컬럼' 또는 '판매항목' 근처인지 확인
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
      // 단말기번호 → {locId, machineId, products, inventory, inventoryLogs, salesData} 맵
      var machineByCode = {}, machineByName = {};
      var machineDataMap = {}; // key = locId+'|'+machineId

      if(!locSnap.exists()){
        // locations 없으면 현재 자판기에 직접 저장 (fallback)
        if(btn){ btn.textContent='🔄 오늘 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
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
      var rowsByMachine = {}; // key = locId+'|'+machineId
      val.rows.forEach(function(row){
        var rowMach = colMachine>=0 ? String(row[colMachine]||'').trim() : '';
        var rowCode = colMachineCode>=0 ? String(row[colMachineCode]||'').trim() : '';
        var rowCodeClean = rowCode.replace(/\(.*\)/, '').trim();
        // 단말기번호 D열 우선
        if(colDevno>=0 && row[colDevno]) rowCodeClean = String(row[colDevno]).trim();
        var key = machineByCode[rowCodeClean] || machineByCode[rowCode] || machineByName[rowMach] || (currentLocationId&&currentMachineId ? currentLocationId+'|'+currentMachineId : null);
        if(!key) return;
        if(!rowsByMachine[key]) rowsByMachine[key]=[];
        rowsByMachine[key].push(row);
      });

      // rows 내부 중복 체크 (크롤러 중복 수집 감지)
      // 정확히 같은 행(모든 셀이 동일)만 중복으로 판단
      var globalSeen = {};
      Object.keys(rowsByMachine).forEach(function(k){
        var deduped = [];
        rowsByMachine[k].forEach(function(row){
          var dateRaw = String(row[colDate]||'').trim();
          if(!dateRaw) return;
          // 모든 셀을 합쳐서 정확한 중복키 생성
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
        // 매칭된 자판기 없음 → 현재 선택 자판기에 저장 (fallback)
        if(currentLocationId && currentMachineId){
          rowsByMachine[currentLocationId+'|'+currentMachineId] = val.rows;
          keys = [currentLocationId+'|'+currentMachineId];
          if(!isAuto) showToast('⚠️ 단말기번호 미매칭 → 현재 자판기에 저장');
        } else {
          if(!isAuto) showToast('📭 등록된 자판기와 일치하는 데이터 없음\n설정에서 단말기번호를 확인해주세요');
          if(btn){ btn.textContent='🔄 오늘 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
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

          // 기존 중복키
          var existingKeysM = {};
          mSales.forEach(function(s){ if(s.dupKey) existingKeysM[s.dupKey]=true; });
          console.log('[수집] 기존 salesData 수:', mSales.length, '/ 중복키 수:', Object.keys(existingKeysM).length, '/ 자판기:', machineId.slice(-6));

          var qtyMap = {};
          var machineAdded = 0;
          var skipReasons = {header:0, noDate:0, noCol:0, cancel:0, dup:0};

          function findProd(colVal, name){ return findProduct(colVal, name, mProds); }

          (rowsByMachine[key]||[]).forEach(function(row, ri){
            // 헤더 행 건너뛰기
            if(String(row[colDate]||'').trim() === '거래일시'){ skipReasons.header++; return; }
            var dateRaw = String(row[colDate]||'').trim();
            var itemName = String(row[colItem]||'').trim();
            var colVal = String(row[colNum]||'').trim();
            var state = colState>=0 ? String(row[colState]||'').trim() : '';
            var txId = colTxId>=0 ? String(row[colTxId]||'').trim() : '';
            var amt = colAmt>=0 ? (typeof row[colAmt]==='number' ? row[colAmt] : parseFloat(String(row[colAmt]||0).replace(/,/g,''))||0) : 0;

            if(!dateRaw){ skipReasons.noDate++; console.log('[스킵-날짜없음] row'+ri+':', JSON.stringify(row)); return; }
            if(!colVal){ skipReasons.noCol++; console.log('[스킵-컬럼없음] row'+ri+':', JSON.stringify(row)); return; }
            if(state&&(state==='취소'||state==='취소완료'||state==='환불')){ skipReasons.cancel++; return; }

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
            // 미매칭도 저장 (itemName, amt 보존)

            mSales.push({id:Date.now().toString()+Math.random(), txId:txId, dupKey:dupKey, date:dateStr, hour:hour, minute:minute, productId:prod?prod.id:null, itemName:itemName, colVal:colVal, qty:1, amt:amt, cancelled:false});
            if(prod) qtyMap[prod.id]=(qtyMap[prod.id]||0)+1;
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
        if(btn){ btn.textContent='🔄 오늘 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
        if(added>0){
          var msg=(isAuto?'🤖 자동수집':'✅ 수집')+' '+added+'건 반영';
          // 중복은 내부에서 자동 제거됨 - 토스트에 표시 안 함
          console.log('[수집결과] 전체rows:'+(val.rows?val.rows.length:0)+' 반영:'+added+' 중복:'+dup);
          showToast(msg);
          localStorage.setItem('lastAutoCollect', today+' '+new Date().toTimeString().slice(0,5));
          updateAutoCollectStatus();
          renderAll();
          // 신규 상품 감지
          if(typeof checkNewProducts === 'function') setTimeout(checkNewProducts, 500);
        } else {
          if(!isAuto) showToast(dup>0?'이미 모두 반영된 데이터예요 ('+dup+'건 중복)':'📭 새 데이터가 없어요');
        }
      });
    });
  }).catch(function(e){
    if(btn){ btn.textContent='🔄 오늘 데이터 수집'; btn.disabled=false; } _fetchInProgress=false;
    if(!isAuto) showToast('❌ 수집 실패: '+e.message);
  });
}
