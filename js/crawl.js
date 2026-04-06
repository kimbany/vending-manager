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
  updateAutoCollectStatus();
}

function updateAutoCollectStatus(){
  var el = document.getElementById('auto-collect-status');
  if(!el) return;
  var last = localStorage.getItem('lastAutoCollect');
  el.textContent = '자동수집: 매일 12:00 · 19:00' + (last ? ' · 마지막: '+last : '');
}

var _fetchInProgress = false;

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
function _applyCrawledData(isAuto){
  var btn = document.getElementById('crawl-btn');
  var today = td();

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
        var key = machineByCode[rowCodeClean] || machineByCode[rowCode] || machineByName[rowMach] || (currentLocationId&&currentMachineId ? currentLocationId+'|'+currentMachineId : null);
        if(!key){ noMatchCount++; return; }
        if(!rowsByMachine[key]) rowsByMachine[key]=[];
        rowsByMachine[key].push(row);
      });

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

      var keys = Object.keys(rowsByMachine);
      if(!keys.length){
        if(currentLocationId && currentMachineId){
          rowsByMachine[currentLocationId+'|'+currentMachineId] = val.rows;
          keys = [currentLocationId+'|'+currentMachineId];
        } else {
          if(!isAuto) showToast('📭 등록된 자판기와 일치하는 데이터 없음\n설정에서 단말기번호를 확인해주세요');
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

          // VMMS 제품 목록으로 자동 매칭용 맵 생성 (상품명 → VMMS 제품정보)
          var vmmsNameMap = {};
          vmmsItems.forEach(function(vp){
            if(vp.productName){
              var name = vp.productName.trim();
              vmmsNameMap[name] = vp;
              // 쉼표 있는/없는 버전 모두 등록 (VMMS와 판매데이터 간 쉼표 차이 대응)
              vmmsNameMap[name.replace(/,\s*/g, ' ')] = vp;
              vmmsNameMap[name.replace(/\s+(\d)/g, ', $1')] = vp;
              // 괄호 차이 대응: [] ↔ ()
              vmmsNameMap[name.replace(/\[/g,'(').replace(/\]/g,')')] = vp;
              vmmsNameMap[name.replace(/\(/g,'[').replace(/\)/g,']')] = vp;
            }
          });

          var qtyMap = {};
          var machineAdded = 0;
          var autoRegistered = 0;

          (rowsByMachine[key]||[]).forEach(function(row){
            if(String(row[colDate]||'').trim() === '거래일시') return;
            var dateRaw = String(row[colDate]||'').trim();
            var itemName = String(row[colItem]||'').trim();
            var colVal = String(row[colNum]||'').trim();
            var state = colState>=0 ? String(row[colState]||'').trim() : '';
            var txId = colTxId>=0 ? String(row[colTxId]||'').trim() : '';
            var amt = colAmt>=0 ? (typeof row[colAmt]==='number' ? row[colAmt] : parseFloat(String(row[colAmt]||0).replace(/,/g,''))||0) : 0;

            if(!dateRaw) return;
            var cancelDateVal = colCancelDate>=0 ? String(row[colCancelDate]||'').trim() : '';
            var isCancelled = (state&&(state==='취소'||state==='취소완료'||state==='환불')) || (cancelDateVal && cancelDateVal!=='-' && cancelDateVal!=='null');

            var dt = dateRaw.length>=19 ? dateRaw.slice(0,19) : dateRaw;
            var dupKey = dt+'|'+itemName.trim()+'|'+amt;
            if(existingKeysM[dupKey]){ dup++; return; }
            existingKeysM[dupKey]=true;

            var dateStr = dateRaw.length>=10 ? dateRaw.slice(0,10) : dateRaw;
            var hour = dateRaw.length>=13 ? parseInt(dateRaw.slice(11,13)) : -1;
            var minute = dateRaw.length>=16 ? parseInt(dateRaw.slice(14,16)) : -1;
            var prod = findProduct(colVal, itemName, mProds);

            // VMMS 제품 목록에서 상품명 매칭 → 자동 제품 등록
            var normalizedName = itemName.replace(/,\s*/g, ' ').replace(/\[/g,'(').replace(/\]/g,')');
            if(!prod && itemName && (vmmsNameMap[itemName] || vmmsNameMap[normalizedName])){
              var vp = vmmsNameMap[itemName] || vmmsNameMap[normalizedName];
              var newId = Date.now().toString() + Math.random().toString(36).slice(2,6);
              prod = {
                id: newId,
                name: vp.productName,
                colNo: colVal || '',
                sellPrice: amt || 0,
                buyPrice: 0,
                totalQty: 1,
                productCode: vp.productCode || '',
                barcode: vp.barcode || ''
              };
              mProds.push(prod);
              mInv.push({productId: newId, qty: 0});
              autoRegistered++;
              console.log('[자동등록] VMMS 매칭:', itemName, '→ 제품등록 (code:'+vp.productCode+')');
            }

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

          // 기존 미매칭 판매 데이터 소급 매칭 (productId가 null인 건 재매칭)
          var retroMatched = 0;
          mSales.forEach(function(s){
            if(!s.productId && s.itemName){
              var name = s.itemName.trim();
              var normalized = name.replace(/,\s*/g, ' ').replace(/\[/g,'(').replace(/\]/g,')');
              var existProd = findProduct('', name, mProds);
              if(existProd){
                s.productId = existProd.id;
                retroMatched++;
              } else if(vmmsNameMap[name] || vmmsNameMap[normalized]){
                var vp = vmmsNameMap[name] || vmmsNameMap[normalized];
                // 이미 같은 이름으로 등록된 제품이 있는지 확인
                var already = mProds.find(function(p){ return (p.name||'').trim() === vp.productName.trim(); });
                if(already){
                  s.productId = already.id;
                  retroMatched++;
                } else {
                  var newId = Date.now().toString() + Math.random().toString(36).slice(2,6);
                  var newProd = {id:newId, name:vp.productName, colNo:s.colVal||'', sellPrice:s.amt||0, buyPrice:0, totalQty:1, productCode:vp.productCode||'', barcode:vp.barcode||''};
                  mProds.push(newProd);
                  mInv.push({productId:newId, qty:0});
                  s.productId = newId;
                  retroMatched++;
                  autoRegistered++;
                }
              }
            }
          });
          if(retroMatched) console.log('[수집] 기존 미매칭 소급 매칭:', retroMatched, '건');
          if(autoRegistered) console.log('[수집] VMMS 매칭 자동등록:', autoRegistered, '건');
          var saveData={products:mProds,inventory:mInv,inventoryLogs:mLogs,salesData:mSales};
          if(isCurrentMachine){
            D.products=mProds; D.salesData=mSales; D.inventory=mInv; D.inventoryLogs=mLogs;
          }
          return appRef.set(saveData);
        });
      });

      Promise.all(promises).then(function(){
        if(added>0 || dup>0 || noMatchCount>0){
          var totalRows = val.rows ? val.rows.length : 0;
          var details = [];
          if(added>0) details.push('반영:'+added);
          if(dup>0) details.push('중복:'+dup);
          if(noMatchCount>0) details.push('미매칭:'+noMatchCount);
          var msg=(isAuto?'🤖 자동수집':'✅ 수집완료')+' 원본 '+totalRows+'건 → '+details.join(' · ');
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
    _resetBtn(btn);
    if(!isAuto) showToast('❌ 데이터 반영 실패: '+e.message);
  });
}
