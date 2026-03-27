function handleSalesFile(input){
  var file = input.files[0]; if(!file) return;
  var ext = file.name.split('.').pop().toLowerCase();
  if(ext==='xlsx'||ext==='xls'){
    var reader = new FileReader();
    reader.onload = function(e){
      var data = new Uint8Array(e.target.result);
      var wb = XLSX.read(data, {type:'array', cellDates:false});
      var ws = wb.Sheets[wb.SheetNames[0]];
      // raw:true → 숫자는 숫자로, 문자열은 문자열로 읽음 (금액 정확도 유지)
      var rawRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:true});
      // 날짜 컬럼은 문자열로 변환, 숫자는 그대로 유지
      var rows = rawRows.map(function(row){
        return row.map(function(cell){
          if(cell === null || cell === undefined) return '';
          if(typeof cell === 'number') return cell; // 숫자 그대로
          return String(cell);
        });
      });
      parseSalesRows(rows);
    };
    reader.readAsArrayBuffer(file);
  } else {
    var reader2 = new FileReader();
    reader2.onload = function(e){
      var text = e.target.result;
      if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
      text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
      var rows = text.trim().split('\n').map(function(l){ return parseCSVLine(l); });
      parseSalesRows(rows);
    };
    reader2.readAsText(file,'utf-8');
  }
}


function openCsvModal(){
  // 현재 선택 자판기 필터 안내 표시
  var el = document.getElementById('csv-machine-filter-info');
  if(el){
    if(currentMachineId){
      db.ref('users/'+currentUser.uid+'/machines/'+currentMachineId).once('value').then(function(snap){
        var m = snap.val();
        if(m){
          el.innerHTML = '🏪 <b style="color:var(--gold)">'+m.name+'</b> 데이터만 가져와요<br/>'+
            '<span style="color:var(--text3)">단말기명: '+m.name+' · 단말기번호: '+m.deviceNo+'</span>';
        }
      });
    } else {
      el.innerHTML = '⚠️ <span style="color:var(--text3)">자판기가 선택되지 않았어요. 전체 데이터를 가져와요.</span>';
    }
  }
  openModal('csv-modal');
}

function getCurrentMachineFilter(){
  if(!currentLocationId||!currentMachineId) return Promise.resolve(null);
  return db.ref('users/'+currentUser.uid+'/locations/'+currentLocationId+'/machines/'+currentMachineId).once('value').then(function(snap){
    var m=snap.val();
    if(!m) return null;
    var devnos=Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
    return {name:m.name, deviceNos:devnos, deviceNo:devnos[0]||''};
  });
}

function parseSalesRows(rows){
  var headerIdx = -1;
  for(var i=0;i<Math.min(10,rows.length);i++){
    var r = rows[i].map(function(v){return String(v||'').trim();});
    if(r.indexOf('거래일시')>=0 || r.indexOf('컬럼')>=0){ headerIdx=i; break; }
  }
  if(headerIdx<0){ showToast('❌ 헤더를 찾을 수 없어요 (거래일시/컬럼 컬럼 필요)'); return; }

  var headers = rows[headerIdx].map(function(v){return String(v||'').trim();});
  var colDate        = headers.indexOf('거래일시');
  var colItem        = headers.indexOf('판매항목');
  var colNum         = headers.indexOf('컬럼');
  var colState       = headers.indexOf('진행상태');
  if(colState<0) colState = headers.indexOf('상태');
  var colTxId        = headers.indexOf('거래고유번호');
  if(colTxId<0) colTxId = headers.indexOf('거래일련번호');
  var colMachine     = headers.indexOf('단말기명');
  var colMachineCode = headers.indexOf('머신기코드');
  var colDevno       = headers.indexOf('단말기번호');
  var colAmt         = headers.indexOf('금액');
  if(colAmt<0) colAmt = headers.indexOf('판매가');
  var colCancel      = headers.indexOf('취소일');  // 취소일 컬럼

  if(colDate<0){ showToast('❌ 거래일시 컬럼이 없어요'); return; }
  if(colItem<0){ showToast('❌ 판매항목 컬럼이 없어요'); return; }

  // 등록된 모든 위치/자판기 + 각 appData(products) 로드
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    var flatMachines = {};
    var appDataPromises = [];
    if(snap.exists() && snap.val()){
      Object.keys(snap.val()).forEach(function(locId){
        var loc = snap.val()[locId];
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m = loc.machines[mid];
          var key = locId+'|'+mid;
          flatMachines[key] = {
            name: m.name,
            deviceNos: Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]),
            locId: locId, machineId: mid,
            products: [] // 나중에 채워짐
          };
          // 각 자판기 products 로드
          appDataPromises.push(
            db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+mid+'/appData/products').once('value').then(function(ps){
              var prods = ps.val();
              if(prods){
                // Firebase 배열 → JS 배열
                if(!Array.isArray(prods)) prods = Object.keys(prods).sort(function(a,b){return parseInt(a)-parseInt(b);}).map(function(k){return prods[k];});
                flatMachines[key].products = prods;
              }
            })
          );
        });
      });
    }
    Promise.all(appDataPromises).then(function(){
      _doParseSalesRows(rows, headers, colDate, colItem, colNum, colState, colTxId, colMachine, colMachineCode, flatMachines, colDevno, colAmt, colCancel);
    });
  });
}

function _doParseSalesRows(rows, headers, colDate, colItem, colNum, colState, colTxId, colMachine, colMachineCode, machines, colDevno, colAmt, colCancel){
  colDevno = colDevno || -1;
  colAmt = (colAmt !== undefined && colAmt >= 0) ? colAmt : (function(){ var i=headers.indexOf('금액'); return i>=0?i:headers.indexOf('판매가'); })();
  colCancel = colCancel !== undefined ? colCancel : headers.indexOf('취소일');
  // machines: {machineId: {name, deviceNo, ...}} 전체 자판기 맵
  var headerIdx = 0;
  for(var i=0;i<Math.min(10,rows.length);i++){
    var r = rows[i].map(function(v){return String(v||'').trim();});
    if(r.indexOf('거래일시')>=0){ headerIdx=i; break; }
  }
  if(colNum<0){ showToast('❌ 컬럼 필드가 없어요'); return; }

  // 자판기 맵: {단말기명 → key, 단말기번호 → key}
  var machineByName = {}, machineByCode = {};
  Object.keys(machines||{}).forEach(function(key){
    var m = machines[key];
    if(m.name) machineByName[m.name] = key;
    var devnos = m.deviceNos || (m.deviceNo?[m.deviceNo]:[]);
    devnos.forEach(function(d){ if(d) machineByCode[d] = key; });
  });

  function makeDupKey(dateRaw, itemName, amt){
    var dt = dateRaw.length>=19 ? dateRaw.slice(0,19) : dateRaw;
    return dt + '|' + (itemName||'').trim() + '|' + (amt||0);
  }

  // 현재 자판기 기존 중복키
  var existingKeys = {};
  D.salesData.forEach(function(s){ if(s.dupKey) existingKeys[s.dupKey]=true; });

  salesPreviewRows = [];
  var matched=0, unmatched=[], dupCount=0, noMachine=0;
  var seenKeys = {};
  // 자판기별 미리보기 카운트
  var machineCount = {}; // {machineId: count}

  for(var i=headerIdx+1;i<rows.length;i++){
    var row = rows[i];
    var dateRaw    = String(row[colDate]||'').trim();
    var itemName   = String(row[colItem]||'').trim();
    var colVal     = String(row[colNum] ||'').trim();
    var state      = colState>=0 ? String(row[colState]||'').trim() : '';
    var txId       = colTxId>=0  ? String(row[colTxId] ||'').trim() : '';
    var amt        = colAmt>=0    ? (typeof row[colAmt]==='number' ? row[colAmt] : parseFloat(String(row[colAmt]||0).replace(/,/g,''))||0) : 0;
    var cancelDate = colCancel>=0 ? String(row[colCancel]||'').trim() : '';
    var isCancelled = cancelDate && cancelDate !== '-' && cancelDate !== 'null';
    var rowMachine = colMachine>=0 ? String(row[colMachine]||'').trim() : '';
    // 단말기번호(D열) 우선, 없으면 머신기코드에서 괄호 제거
    var rowCodeRaw = colDevno>=0 ? String(row[colDevno]||'').trim()
                   : colMachineCode>=0 ? String(row[colMachineCode]||'').trim() : '';
    var rowCode = rowCodeRaw.replace(/\(.*\)/, '').trim();
    var rowCodeClean = rowCode;

    if(!dateRaw) continue;
    // 취소 여부: 진행상태 또는 취소일로 판단
    var isThisCancel = isCancelled || (state && (state==='취소'||state==='취소완료'||state==='환불'));

    // 이 행이 어느 자판기 데이터인지 판별 (locId|machineId 형태)
    var targetMachineId = machineByName[rowMachine] || machineByCode[rowCode] || machineByCode[rowCodeClean] || (currentLocationId&&currentMachineId ? currentLocationId+'|'+currentMachineId : null);

    var dupKey = makeDupKey(dateRaw, itemName, amt);
    if(existingKeys[dupKey] || seenKeys[dupKey]){ dupCount++; continue; }
    seenKeys[dupKey] = true;

    var dateStr = dateRaw.length>=10 ? dateRaw.slice(0,10) : dateRaw;
    // 해당 자판기 products에서 상품명+컬럼 복합 매칭
    var prod = null;
    var mProds = (targetMachineId && machines[targetMachineId] && machines[targetMachineId].products)
      ? machines[targetMachineId].products : D.products;
    prod = findProduct(colVal, itemName, mProds);
    var hour = dateRaw.length>=13 ? parseInt(dateRaw.slice(11,13)) : -1;
    var minute = dateRaw.length>=16 ? parseInt(dateRaw.slice(14,16)) : -1;

    // targetMachineId 포함해서 저장
    salesPreviewRows.push({
      date:dateStr, hour:hour, minute:minute, itemName:itemName, colVal:colVal,
      prod:prod, qty:1, txId:txId, dupKey:dupKey, amt:amt,
      machineId: targetMachineId, machineName: rowMachine || '',
      cancelled: isThisCancel, cancelDate: cancelDate||''
    });

    if(targetMachineId){
      machineCount[targetMachineId] = (machineCount[targetMachineId]||0)+1;
    }
    if(prod) matched++;
    else if(unmatched.indexOf(colVal)<0) unmatched.push(colVal);
  }

  // 자판기별 건수 안내
  var machineInfo = Object.keys(machineCount).map(function(mid){
    var m = machines[mid];
    return (m?m.name:mid)+' '+machineCount[mid]+'건';
  }).join(' / ');
  if(machineInfo) showToast('📋 자판기별 분류: '+machineInfo);

  showSalesPreview(matched, unmatched, dupCount);
}

function showSalesPreview(matched, unmatched, dupCount){
  var total = salesPreviewRows.length;
  var cancelledRows = salesPreviewRows.filter(function(r){ return r.cancelled; });
  var normalRows = salesPreviewRows.filter(function(r){ return !r.cancelled; });
  var unm = normalRows.length - matched;
  var html = '';

  // 취소 건수 배너
  if(cancelledRows.length > 0){
    html += '<div style="background:rgba(224,88,88,.1);border:1px solid rgba(224,88,88,.3);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:12px">';
    html += '↩️ <b style="color:var(--red)">취소 '+cancelledRows.length+'건</b> 포함 → 매출에서 제외됩니다';
    html += '</div>';
  }

  // 컬럼별 집계 (정상건만)
  var summary = {};
  normalRows.forEach(function(r){
    var key = r.colVal;
    if(!summary[key]) summary[key]={colVal:key, prod:r.prod, itemName:r.itemName, qty:0};
    summary[key].qty++;
  });

  // 중복 제거 안내 배너
  if(dupCount>0){
    html += '<div style="background:rgba(232,184,109,.1);border:1px solid rgba(232,184,109,.4);border-radius:8px;padding:9px 12px;margin-bottom:10px;font-size:12px;color:var(--gold)">'+
      '⚠️ 이미 등록된 중복 거래 <b>'+dupCount+'건</b>은 자동으로 제외했어요.</div>';
  }

  Object.keys(summary).sort(function(a,b){return parseInt(a)-parseInt(b);}).forEach(function(k){
    var s = summary[k];
    var hasMatch = !!s.prod;
    html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;margin-bottom:5px;background:'+(hasMatch?'rgba(122,218,154,.06)':'rgba(224,88,88,.08)')+';border:1px solid '+(hasMatch?'rgba(122,218,154,.2)':'rgba(224,88,88,.3)')+'">';
    html += '<span style="font-size:11px;font-weight:700;color:var(--gold);min-width:28px">'+s.colVal+'번</span>';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:12px;font-weight:600">'+(hasMatch?s.prod.name:s.itemName)+'</div>';
    if(!hasMatch) html += '<div style="font-size:10px;color:var(--red)">⚠️ 등록된 제품 없음</div>';
    html += '</div>';
    html += '<span style="font-size:13px;font-weight:700;color:var(--blue)">'+s.qty+'개</span>';
    html += '</div>';
  });

  if(!total){
    html += '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">신규 등록할 데이터가 없어요<br/>(전체 중복)</div>';
  }

  document.getElementById('csv-preview-title').innerHTML =
    '신규 <b>'+total+'건</b> · '+
    '<span style="color:var(--green)">매칭 '+matched+'건</span> · '+
    (unm>0?'<span style="color:var(--red)">미매칭 '+unm+'건 (컬럼: '+unmatched.join(', ')+')</span>':'<span style="color:var(--text3)">미매칭 없음</span>')+
    (dupCount>0?' · <span style="color:var(--gold)">중복제외 '+dupCount+'건</span>':'');
  document.getElementById('csv-preview').innerHTML = html;
  document.getElementById('csv-s1').style.display='none';
  document.getElementById('csv-s2').style.display='block';
}

function importSalesData(){
  var added=0, noMatch=0;

  // 오늘 데이터만 재고 차감 (과거 데이터는 재고 안 빼기)
  var today = td();

  // 자판기별로 행 분류
  var byMachine = {}; // {machineId: [rows]}
  salesPreviewRows.forEach(function(r){
    var mid = r.machineId || currentMachineId || '__current__';
    if(!byMachine[mid]) byMachine[mid] = [];
    byMachine[mid].push(r);
  });

  var machineIds = Object.keys(byMachine);
  var promises = machineIds.map(function(mid){
    var rows = byMachine[mid];
    // 해당 자판기 appData 경로
    var parts = mid.split('|');
    var isCurrentMachine = (mid === '__current__' || (parts[0]===currentLocationId && parts[1]===currentMachineId));
    var machineREF = isCurrentMachine
      ? REF
      : (parts.length===2
          ? db.ref('users/'+currentUser.uid+'/locations/'+parts[0]+'/machines/'+parts[1]+'/appData')
          : REF);

    return machineREF.once('value').then(function(snap){
      var mData = snap.val() || {};
      var mProds  = mData.products      || [];
      var mInv    = mData.inventory     || [];
      var mLogs   = mData.inventoryLogs || [];
      var mSales  = mData.salesData     || [];

      // 대상 자판기 기존 dupKey로 중복 체크 (직접 업로드 + 데이터 수집 간 중복 방지)
      var targetExistingKeys = {};
      mSales.forEach(function(s){ if(s.dupKey) targetExistingKeys[s.dupKey]=true; });

      // 해당 자판기 제품 찾기
      var qtyMapByDate = {};
      rows.forEach(function(r){
        // 대상 자판기에 이미 있는 데이터면 건너뛰기
        if(r.dupKey && targetExistingKeys[r.dupKey]){ noMatch++; return; }
        var prod = r.prod || findProduct(r.colVal, r.itemName, mProds);
        var saleAmt = (r.amt && r.amt > 0) ? r.amt : (prod ? prod.sellPrice * r.qty : 0);
        var salesEntry = {
          id: Date.now().toString()+Math.random(),
          txId: r.txId, dupKey: r.dupKey||'',
          date: r.date, hour: r.hour||-1, minute: r.minute!==undefined?r.minute:-1,
          productId: prod ? prod.id : null,
          itemName: r.itemName || (prod ? prod.name : ''),
          colVal: r.colVal||'', qty: r.qty, amt: saleAmt,
          cancelled: r.cancelled||false,
          cancelDate: r.cancelDate||''
        };
        mSales.push(salesEntry);
        if(!prod){ noMatch++; return; }
        if(r.cancelled) return; // 취소건 재고 차감 제외
        // 오늘 데이터만 재고 차감 대상
        if(r.date === today){
          if(!qtyMapByDate[prod.id]) qtyMapByDate[prod.id]={};
          qtyMapByDate[prod.id][r.date] = (qtyMapByDate[prod.id][r.date]||0)+r.qty;
        }
        added++;
      });

      // 재고 차감 (오늘 데이터만)
      Object.keys(qtyMapByDate).forEach(function(pid){
        var dateMap = qtyMapByDate[pid];
        var total=0;
        Object.keys(dateMap).sort().forEach(function(date){
          var qty=dateMap[date]; total+=qty;
          mLogs.push({id:Date.now().toString()+Math.random(), productId:pid, delta:-qty, memo:'판매데이터 자동차감', date:date});
        });
        var idx=mInv.findIndex(function(i){return i.productId===pid;});
        if(idx>=0) mInv[idx].qty=Math.max(0,mInv[idx].qty-total);
        else mInv.push({productId:pid,qty:0});
      });

      // 해당 자판기에 저장
      var saveData = {products:mProds, inventory:mInv, inventoryLogs:mLogs, salesData:mSales};
      if(isCurrentMachine){
        // 현재 자판기면 D도 업데이트
        D.salesData     = mSales;
        D.inventory     = mInv;
        D.inventoryLogs = mLogs;
        return REF.set(saveData);
      } else {
        return machineREF.set(saveData);
      }
    });
  });

  Promise.all(promises).then(function(){
    closeModal('csv-modal');
    var msg = '✅ '+added+'건 등록 완료';
    if(noMatch>0) msg += ' · 미매칭 '+noMatch+'건';
    showToast(msg);
    resetCsvModal();
    renderAll();
  }).catch(function(e){
    showToast('❌ 저장 실패: '+e.message);
  });
}

function resetCsvModal(){
  salesPreviewRows=[];
  document.getElementById('csv-s1').style.display='block';
  document.getElementById('csv-s2').style.display='none';
  document.getElementById('csv-file').value='';
}
