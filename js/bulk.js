// ─── 일괄 등록 ────────────────────────────────────────────────────────────────
var bulkRows = [];

function downloadBulkTemplate(){
  // 등록된 단말기번호 목록 가져와서 양식에 반영
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(snap){
    var devnoExample = '2000107965';
    if(snap.exists()){
      snap.forEach(function(locSnap){
        var loc=locSnap.val();
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m=loc.machines[mid];
          var devnos=Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
          if(devnos.length) devnoExample=devnos[0];
        });
      });
    }
    var csv = '유의사항,,,,,\n';
    csv += '1. 구매가는 제품을 구매한 원가를 기입해주세요.,,,,,\n';
    csv += '2. 판매가는 자판기에서 판매할 금액을 기입해주세요.,,,,,\n';
    csv += '3. 초기 총수량은 현재 보유 중인 재고 수량을 기입해주세요.,,,,,\n';
    csv += '4. 컬럼위치는 자판기에서 제품이 배치된 칸 번호를 기입해주세요.,,,,,\n';
    csv += '"   · 같은 제품이 여러 칸에 들어가 있다면 콤마(,)로 구분해주세요.  예) 11,12",,,,,\n';
    csv += '"   · 제품이 두 칸을 차지하고 있다면 물결(~)로 구분해주세요.  예) 11~12",,,,,\n';
    csv += ',,,,,\n';
    csv += '제품명,구매가,초기총수량,판매가,단말기번호,컬럼위치\n';
    csv += '콜라,15000,30,800,'+devnoExample+',"47,31"\n';
    csv += '사이다,14000,30,800,'+devnoExample+',52\n';
    csv += '물,8000,24,500,'+devnoExample+',"11,12,13"\n';
    var blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '제품일괄등록_양식.csv';
    a.click();
  });
}

function handleBulkCSV(input){
  var file = input.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    var text = e.target.result;
    // BOM 제거
    if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    // 윈도우 줄바꿈(\r\n), 맥 줄바꿈(\r) 모두 \n으로 통일
    text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var lines = text.trim().split('\n');
    if(lines.length < 2){ showToast('❌ 데이터가 없어요'); return; }
    // 헤더 행 자동 탐색 (유의사항 등 앞 줄 건너뜀)
    var headerLineIdx = 0;
    for(var hi=0; hi<lines.length; hi++){
      var hl = lines[hi].replace(/["\r]/g,'');
      if(hl.indexOf('제품명')>=0 && hl.indexOf('구매가')>=0){ headerLineIdx=hi; break; }
    }
    var headers = lines[headerLineIdx].split(',').map(function(h){return h.trim().replace(/["\r]/g,'');});
    var required = ['제품명','구매가','초기총수량','판매가'];
    if(headers.indexOf('초기총수량')<0 && headers.indexOf('총수량')>=0) headers=headers.map(function(h){return h==='총수량'?'초기총수량':h;});
    var missing = required.filter(function(r){return headers.indexOf(r)<0;});
    if(missing.length){ showToast('❌ 필수 컬럼 없음: '+missing.join(', ')); return; }
    bulkRows = [];
    for(var i=headerLineIdx+1;i<lines.length;i++){
      var line = lines[i].trim().replace(/\r/g,''); if(!line) continue;
      var cells = parseCSVLine(line);
      var row = {};
      // 각 셀 값의 따옴표·공백·\r 제거
      headers.forEach(function(h,idx){
        row[h] = (cells[idx]||'').replace(/["\r]/g,'').trim();
      });
      bulkRows.push(row);
    }
    showBulkPreview();
    document.getElementById('bulk-s1').style.display='none';
    document.getElementById('bulk-s2').style.display='block';
  };
  // 인코딩 자동 감지 위해 UTF-8 먼저, 실패시 EUC-KR
  reader.readAsText(file, 'utf-8');
}

function parseCSVLine(line){
  var result=[], cur='', inQ=false;
  for(var i=0;i<line.length;i++){
    var ch=line[i];
    if(ch==='"'){ inQ=!inQ; }
    else if(ch===','&&!inQ){ result.push(cur); cur=''; }
    else { cur+=ch; }
  }
  result.push(cur);
  return result;
}

function showBulkPreview(){
  var html = '';
  var okCount = 0, errCount = 0;
  bulkRows.forEach(function(row){
    var name = row['제품명']||'';
    var buy = parseFloat(row['구매가'])||0;
    var total = parseFloat(row['초기총수량']||row['총수량'])||0;
    var sell = parseFloat(row['판매가'])||0;
    var devno = (row['단말기번호']||'').trim();
    var colRaw = row['컬럼위치']||'';
    var cols = colRaw.split(',').map(function(c){return c.trim();}).filter(function(c){return c;});
    var errors = [];
    if(!name) errors.push('제품명 없음');
    if(!buy) errors.push('구매가 없음');
    if(!total) errors.push('총수량 없음');
    if(!sell) errors.push('판매가 없음');
    var dupConflicts = [];
    cols.forEach(function(c){
      D.products.forEach(function(p){
        var pCols = Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
        if(pCols.indexOf(c)>=0) dupConflicts.push(c+'번('+p.name+')');
      });
    });
    if(dupConflicts.length) errors.push('중복 컬럼: '+dupConflicts.join(', '));
    var hasErr = errors.length > 0;
    if(hasErr) errCount++; else okCount++;
    var unit = total>0?Math.round(buy/total):0;
    var mr = sell>0?Math.round((sell-unit)/sell*100):0;
    html += '<div style="background:'+(hasErr?'rgba(224,88,88,.08)':'rgba(122,218,154,.06)')+';border:1px solid '+(hasErr?'rgba(224,88,88,.3)':'rgba(122,218,154,.2)')+';border-radius:8px;padding:10px 12px;margin-bottom:8px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
    html += '<span style="font-size:13px;font-weight:700">'+(name||'(이름없음)')+'</span>';
    html += '<span style="font-size:11px;color:'+(hasErr?'var(--red)':'var(--green)')+'">'+( hasErr ? '⚠️ 오류' : '✅ 정상')+'</span>';
    html += '</div>';
    if(devno) html += '<div style="font-size:11px;color:var(--text3);margin-bottom:3px">단말기: '+devno+'</div>';
    if(cols.length) html += '<div style="font-size:11px;color:var(--text3);margin-bottom:3px">컬럼: '+cols.join(', ')+'</div>';
    html += '<div style="font-size:11px;color:var(--text2)">구매가 '+fmt(buy)+'원 / 총'+total+'개 / 판매가 '+fmt(sell)+'원 / 마진 '+mr+'%</div>';
    if(hasErr) html += '<div style="font-size:11px;color:var(--red);margin-top:4px">❌ '+errors.join(' · ')+'</div>';
    html += '</div>';
  });
  document.getElementById('bulk-preview-title').innerHTML =
    '총 <b>'+bulkRows.length+'개</b> 제품 · <span style="color:var(--green)">정상 '+okCount+'개</span> · <span style="color:var(--red)">오류 '+errCount+'개</span>';
  document.getElementById('bulk-preview').innerHTML = html;
}

function cleanNum(v){ return parseFloat((v||'').replace(/[^0-9.\-]/g,'')); }

function confirmBulk(){
  var added=0, skipped=[];

  // 단말기번호별로 행 분류
  var byDevno = {}; // {devno: [rows]}
  var noDevno = [];
  bulkRows.forEach(function(row){
    var devno = (row['단말기번호']||'').trim();
    if(devno){ if(!byDevno[devno]) byDevno[devno]=[]; byDevno[devno].push(row); }
    else noDevno.push(row);
  });

  // 단말기번호 → locId|machineId 맵 (locations에서 조회)
  db.ref('users/'+currentUser.uid+'/locations').once('value').then(function(locSnap){
    var devnoToKey = {}; // {devno: 'locId|machineId'}
    if(locSnap.exists()){
      locSnap.forEach(function(locChild){
        var loc=locChild.val();
        Object.keys(loc.machines||{}).forEach(function(mid){
          var m=loc.machines[mid];
          var devnos=Array.isArray(m.deviceNos)?m.deviceNos:(m.deviceNo?[m.deviceNo]:[]);
          devnos.forEach(function(d){ devnoToKey[d]=locChild.key+'|'+mid; });
        });
      });
    }

    function makeProduct(row){
      var name=(row['제품명']||'').trim();
      var buy=cleanNum(row['구매가']);
      var total=cleanNum(row['초기총수량']||row['총수량']);
      var sell=cleanNum(row['판매가']);
      var devno=(row['단말기번호']||'').trim();
      var colRaw=(row['컬럼위치']||'').trim();
      var cols=colRaw?colRaw.split(/[,\/]/).map(function(c){return c.trim();}).filter(function(c){return c;}) : [];
      if(!name||!buy||!total||!sell){ skipped.push(name||'(이름없음)'); return null; }
      var unit=total>0?Math.round(buy/total):0;
      var ma=sell-unit, mr=sell>0?Math.round(ma/sell*100):0;
      var pid=Date.now().toString()+Math.random();
      return {prod:{id:pid,name:name,buyPrice:buy,totalQty:total,unitPrice:unit,sellPrice:sell,marginAmt:ma,marginRate:mr,column:cols,deviceNo:devno}, total:total, pid:pid};
    }

    // 단말기번호별 저장
    var promises = [];
    var devnos = Object.keys(byDevno);

    devnos.forEach(function(devno){
      var key = devnoToKey[devno];
      var rows = byDevno[devno];
      var isCurrentMachine = key && (key === currentLocationId+'|'+currentMachineId);
      var appRef = key
        ? (isCurrentMachine ? REF : db.ref('users/'+currentUser.uid+'/locations/'+key.split('|')[0]+'/machines/'+key.split('|')[1]+'/appData'))
        : REF;

      promises.push(appRef.once('value').then(function(snap){
        var mData=snap.val()||{};
        var mProds=mData.products||[], mInv=mData.inventory||[], mLogs=mData.inventoryLogs||[];
        rows.forEach(function(row){
          var r=makeProduct(row); if(!r) return;
          mProds.push(r.prod);
          if(r.total>0){
            mInv.push({productId:r.pid, qty:r.total});
            mLogs.push({id:Date.now().toString()+Math.random(), productId:r.pid, delta:r.total, memo:'초기 재고 설정 (일괄등록)', date:td()});
          }
          added++;
        });
        var saveData={products:mProds, inventory:mInv, inventoryLogs:mLogs, salesData:mData.salesData||[]};
        if(isCurrentMachine){ D.products=mProds; D.inventory=mInv; D.inventoryLogs=mLogs; }
        return appRef.set(saveData);
      }));
    });

    // 단말기번호 없는 것 → 현재 자판기
    if(noDevno.length){
      noDevno.forEach(function(row){
        var r=makeProduct(row); if(!r) return;
        D.products.push(r.prod);
        if(r.total>0){
          D.inventory.push({productId:r.pid, qty:r.total});
          D.inventoryLogs.push({id:Date.now().toString()+Math.random(), productId:r.pid, delta:r.total, memo:'초기 재고 설정 (일괄등록)', date:td()});
        }
        added++;
      });
      promises.push(Promise.resolve(save()));
    }

    Promise.all(promises).then(function(){
      closeModal('bulk-modal');
      resetBulk();
      var msg='✅ '+added+'개 등록 완료';
      if(skipped.length) msg+=' (⚠️ '+skipped.length+'개 스킵)';
      showToast(msg);
      renderAll();
    }).catch(function(e){ showToast('❌ 저장 실패: '+e.message); });
  });
}

function resetBulk(){
  bulkRows=[];
  document.getElementById('bulk-s1').style.display='block';
  document.getElementById('bulk-s2').style.display='none';
  document.getElementById('bulk-file').value='';
}



// ─── 일괄 재고 입력 ──────────────────────────────────────────────────────────
var bulkInvRows = [];

function downloadInvTemplate(){
  var csv = '\uFEFF제품명,컬럼번호,+입고,-출고,메모\n';
  D.products.forEach(function(p){
    var cols = Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
    csv += p.name+','+(cols[0]||'')+',,,' +'\n';
  });
  if(!D.products.length){
    csv += '콜라,25,30,,최초입고\n';
    csv += '사이다,24,,2,판매차감\n';
  }
  var blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
  var a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='재고일괄입력_양식.csv'; a.click();
}

function handleBulkInvCSV(input){
  var file = input.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    var text = e.target.result;
    if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var lines = text.trim().split('\n');
    if(lines.length<2){showToast('❌ 데이터가 없어요');return;}
    var headers = lines[0].split(',').map(function(h){return h.trim().replace(/"/g,'');});

    bulkInvRows = [];
    for(var i=1;i<lines.length;i++){
      var line=lines[i].trim().replace(/\r/g,''); if(!line) continue;
      var cells=parseCSVLine(line);
      var row={};
      headers.forEach(function(h,idx){row[h]=(cells[idx]||'').replace(/"/g,'').trim();});

      var name   = row['제품명']||'';
      var colNum = row['컬럼번호']||'';
      var plus   = cleanNum(row['+입고'])||0;
      var minus  = cleanNum(row['-출고'])||0;
      var memo   = row['메모']||'';

      if(!name && !colNum) continue;
      if(!plus && !minus) continue; // 둘 다 0이면 스킵

      // 제품 찾기: 이름 우선, 없으면 컬럼 번호로
      var prod = D.products.find(function(p){return p.name===name;});
      if(!prod && colNum) prod = findProductByColumn(colNum);

      var delta = plus>0 ? plus : -minus;
      bulkInvRows.push({name:name, colNum:colNum, prod:prod, delta:delta, memo:memo});
    }

    showBulkInvPreview();
    document.getElementById('bulk-inv-s1').style.display='none';
    document.getElementById('bulk-inv-s2').style.display='block';
  };
  reader.readAsText(file,'utf-8');
}

function showBulkInvPreview(){
  var ok=0, err=0, html='';
  bulkInvRows.forEach(function(row){
    var hasErr = !row.prod;
    if(hasErr) err++; else ok++;
    var isPlus = row.delta>0;
    html += '<div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;margin-bottom:5px;background:'+(hasErr?'rgba(224,88,88,.08)':'rgba(122,218,154,.06)')+';border:1px solid '+(hasErr?'rgba(224,88,88,.3)':'rgba(122,218,154,.2)') +'">';
    html += '<span style="font-size:18px;font-weight:800;color:'+(isPlus?'var(--green)':'var(--red)')+'">'+( isPlus?'+':'')+row.delta+'</span>';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:13px;font-weight:600">'+(row.prod?row.prod.name:row.name||('컬럼 '+row.colNum))+'</div>';
    if(row.memo) html += '<div style="font-size:11px;color:var(--text2)">'+row.memo+'</div>';
    if(hasErr) html += '<div style="font-size:11px;color:var(--red)">⚠️ 제품을 찾을 수 없어요</div>';
    html += '</div>';
    html += '<span style="font-size:10px;background:var(--bg3);padding:2px 7px;border-radius:4px;color:var(--text2)">'+(isPlus?'입고':'출고')+'</span>';
    html += '</div>';
  });
  document.getElementById('bulk-inv-summary').innerHTML =
    '총 <b>'+bulkInvRows.length+'건</b> · <span style="color:var(--green)">정상 '+ok+'건</span> · <span style="color:var(--red)">오류 '+err+'건</span>';
  document.getElementById('bulk-inv-preview').innerHTML = html;
}

function confirmBulkInv(){
  var done=0, skipped=0;
  bulkInvRows.forEach(function(row){
    if(!row.prod){skipped++;return;}
    applyInventoryChange(row.prod.id, row.delta, row.memo||'일괄입력');
    done++;
  });
  save();
  closeModal('bulk-inv-modal');
  resetBulkInv();
  var msg='✅ '+done+'건 처리 완료';
  if(skipped) msg+=' (⚠️ '+skipped+'건 스킵)';
  showToast(msg);
  renderAll();
}

function resetBulkInv(){
  bulkInvRows=[];
  document.getElementById('bulk-inv-s1').style.display='block';
  document.getElementById('bulk-inv-s2').style.display='none';
  document.getElementById('bulk-inv-file').value='';
}

// ─── 일괄 수정 ────────────────────────────────────────────────────────────────
var bulkEditChanges = [];

function getSelectedIds(){
  return Array.from(document.querySelectorAll('.prod-cb:checked')).map(function(cb){return cb.value;});
}

function downloadSelectedCSV(){
  var ids = getSelectedIds();
  if(!ids.length){ showToast('❌ 선택된 제품이 없어요'); return; }
  var prods = D.products.filter(function(p){ return ids.indexOf(p.id) >= 0; });
  var csv = '\uFEFF제품ID,제품명,구매가,총수량,판매가,컬럼위치\n';
  prods.forEach(function(p){
    var cols = Array.isArray(p.column) ? p.column : (p.column ? [p.column] : []);
    var colStr = cols.join('/');
    // 쉼표 포함 필드는 따옴표로 감싸기
    csv += [p.id, p.name, p.buyPrice, p.totalQty, p.sellPrice, '"'+colStr+'"'].join(',') + '\n';
  });
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '제품수정_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  showToast('✅ '+prods.length+'개 제품 다운로드');
}

function handleBulkEditCSV(input){
  var file = input.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    var text = e.target.result;
    if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    var lines = text.trim().split('\n');
    if(lines.length < 2){ showToast('❌ 데이터가 없어요'); return; }
    var headers = lines[0].split(',').map(function(h){return h.trim().replace(/"/g,'');});
    var idIdx = headers.indexOf('제품ID');
    if(idIdx < 0){ showToast('❌ 제품ID 컬럼이 없어요 (양식 파일을 사용해주세요)'); return; }

    bulkEditChanges = [];
    for(var i=1;i<lines.length;i++){
      var line = lines[i].trim(); if(!line) continue;
      var cells = parseCSVLine(line);
      var row = {};
      headers.forEach(function(h,idx){ row[h] = (cells[idx]||'').trim().replace(/^"|"$/g,''); });
      var orig = D.products.find(function(p){ return p.id === row['제품ID']; });
      if(!orig) continue;

      // 변경된 필드 찾기
      var changes = [];
      var newName = row['제품명']||orig.name;
      var newBuy = parseFloat(row['구매가'])||orig.buyPrice;
      var newTotal = parseFloat(row['총수량'])||orig.totalQty;
      var newSell = parseFloat(row['판매가'])||orig.sellPrice;
      var newColRaw = row['컬럼위치']||'';
      var newCols = newColRaw ? newColRaw.split('/').map(function(c){return c.trim();}).filter(function(c){return c;}) : (Array.isArray(orig.column)?orig.column:(orig.column?[orig.column]:[]));

      if(newName !== orig.name) changes.push({field:'제품명', before:orig.name, after:newName});
      if(newBuy !== orig.buyPrice) changes.push({field:'구매가', before:orig.buyPrice+'원', after:newBuy+'원'});
      if(newTotal !== orig.totalQty) changes.push({field:'총수량', before:orig.totalQty+'개', after:newTotal+'개'});
      if(newSell !== orig.sellPrice) changes.push({field:'판매가', before:orig.sellPrice+'원', after:newSell+'원'});
      var origColStr = (Array.isArray(orig.column)?orig.column:(orig.column?[orig.column]:[])).join('/');
      if(newCols.join('/') !== origColStr) changes.push({field:'컬럼위치', before:origColStr||'미배정', after:newCols.join(', ')||'미배정'});

      if(changes.length){
        var unit = newTotal>0 ? Math.round(newBuy/newTotal) : 0;
        var ma = newSell - unit;
        var mr = newSell>0 ? Math.round(ma/newSell*100) : 0;
        bulkEditChanges.push({
          id: orig.id,
          name: orig.name,
          changes: changes,
          newProd: {id:orig.id, name:newName, buyPrice:newBuy, totalQty:newTotal, unitPrice:unit, sellPrice:newSell, marginAmt:ma, marginRate:mr, column:newCols}
        });
      }
    }

    showBulkEditPreview();
    input.value='';
  };
  reader.readAsText(file, 'utf-8');
}

function showBulkEditPreview(){
  if(!bulkEditChanges.length){
    showToast('변경된 내용이 없어요');
    return;
  }
  var html = '';
  bulkEditChanges.forEach(function(item){
    html += '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--gold);margin-bottom:7px">'+item.name+'</div>';
    item.changes.forEach(function(c){
      html += '<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px">';
      html += '<span style="color:var(--text3);min-width:44px">'+c.field+'</span>';
      html += '<span style="color:var(--red);text-decoration:line-through">'+c.before+'</span>';
      html += '<span style="color:var(--text3)">→</span>';
      html += '<span style="color:var(--green);font-weight:700">'+c.after+'</span>';
      html += '</div>';
    });
    html += '</div>';
  });
  document.getElementById('bulk-edit-summary').innerHTML =
    '<b>'+bulkEditChanges.length+'개</b> 제품에 변경 사항이 있어요. 확인 후 적용하세요.';
  document.getElementById('bulk-edit-preview').innerHTML = html;
  openModal('bulk-edit-modal');
}

function confirmBulkEdit(){
  bulkEditChanges.forEach(function(item){
    D.products = D.products.map(function(p){ return p.id===item.id ? item.newProd : p; });
  });
  save();
  closeModal('bulk-edit-modal');
  showToast('✅ '+bulkEditChanges.length+'개 제품 수정 완료');
  bulkEditChanges = [];
  renderAll();
}



// ─── 판매 편집 ────────────────────────────────────────────────────────────────

// 날짜별 삭제 미리보기
function getDelRange(){
  var from = document.getElementById('sales-del-from').value;
  var to   = document.getElementById('sales-del-to').value;
  if(!from){ showToast('❌ 시작 날짜를 선택하세요'); return null; }
  if(!to) to = from; // to 없으면 하루만
  if(from > to){ showToast('❌ 시작 날짜가 종료 날짜보다 늦어요'); return null; }
  return {from:from, to:to};
}

function previewSalesDel(){
  var range = getDelRange(); if(!range) return;
  var rows = D.salesData.filter(function(s){ return s.date>=range.from && s.date<=range.to && !s.cancelled; });
  var el = document.getElementById('sales-del-preview');
  if(!rows.length){
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);text-align:center;padding:8px">해당 기간 판매 데이터 없음</div>';
    return;
  }
  var pm = {};
  rows.forEach(function(s){
    var p = gp(s.productId); if(!p) return;
    pm[p.id] = pm[p.id] || {name:p.name, qty:0, amt:0};
    pm[p.id].qty += s.qty;
    pm[p.id].amt += s.qty * p.sellPrice;
  });
  var totalQty=0, totalAmt=0, html='';
  // 기간 표시
  var rangeLabel = range.from===range.to ? range.from : range.from+' ~ '+range.to;
  html += '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">'+rangeLabel+' · 총 '+rows.length+'건</div>';
  Object.values(pm).forEach(function(item){
    totalQty += item.qty; totalAmt += item.amt;
    html += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">';
    html += '<span>'+item.name+'</span>';
    html += '<span style="color:var(--red)">'+item.qty+'개 · '+fmt(item.amt)+'원</span></div>';
  });
  html += '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:6px 0;color:var(--gold)">';
  html += '<span>합계</span><span>'+totalQty+'개 · '+fmt(totalAmt)+'원</span></div>';
  el.innerHTML = html;
}

// 기간 삭제 + 재고 원복 (위치의 모든 자판기)
function confirmSalesDel(){
  var range = getDelRange(); if(!range) return;
  var rangeLabel = range.from===range.to ? range.from : range.from+' ~ '+range.to;

  if(!currentUser || !currentLocationId){
    // fallback: 현재 D만 삭제
    var rows = D.salesData.filter(function(s){ return s.date>=range.from && s.date<=range.to && !s.cancelled; });
    if(!rows.length){ showToast('❌ 삭제할 데이터가 없어요'); return; }
    if(!confirm(rangeLabel+' '+rows.length+'건 삭제할까요?')) return;
    D.salesData = D.salesData.filter(function(s){ return !(s.date>=range.from && s.date<=range.to); });
    save(); renderAll(); closeModal('sales-edit-modal');
    showToast('✅ '+rows.length+'건 삭제 완료'); return;
  }

  db.ref('users/'+currentUser.uid+'/locations/'+currentLocationId+'/machines').once('value').then(function(snap){
    if(!snap.exists()){ showToast('❌ 자판기 없음'); return; }
    var machines = snap.val();
    var totalRows = 0;

    // 먼저 전체 카운트
    var promises = Object.keys(machines).map(function(mid){
      return db.ref('users/'+currentUser.uid+'/locations/'+currentLocationId+'/machines/'+mid+'/appData').once('value').then(function(as){
        var val = as.val()||{};
        var sales = val.salesData||[];
        var rows = sales.filter(function(s){ return s.date>=range.from && s.date<=range.to; });
        totalRows += rows.length;
        return {mid:mid, val:val, rows:rows};
      });
    });

    Promise.all(promises).then(function(results){
      if(!totalRows){ showToast('❌ 삭제할 데이터가 없어요'); return; }
      if(!confirm(rangeLabel+' 전체 '+totalRows+'건을 삭제할까요?')) return;

      // 오늘 날짜가 포함된 경우 재고 복구 여부 확인
      var today = td();
      var hasTodayData = (today >= range.from && today <= range.to);
      var doRestore = false;
      if(hasTodayData){
        doRestore = confirm('오늘('+today+') 데이터가 포함되어 있어요.\n\n오늘 판매분의 재고를 복구할까요?\n\n[확인] 재고 복구   [취소] 재고 유지');
      }

      var savePromises = results.map(function(r){
        if(!r.rows.length) return Promise.resolve();
        var mInv = r.val.inventory||[];
        var mLogs = r.val.inventoryLogs||[];
        var mProds = r.val.products||[];

        // 오늘 데이터 재고 복구
        if(doRestore){
          var todayRows = r.rows.filter(function(s){ return s.date===today && !s.cancelled; });
          var restoreMap = {};
          todayRows.forEach(function(s){
            if(s.productId) restoreMap[s.productId] = (restoreMap[s.productId]||0) + (s.qty||1);
          });
          Object.keys(restoreMap).forEach(function(pid){
            var qty = restoreMap[pid];
            var idx = mInv.findIndex(function(i){return i.productId===pid;});
            if(idx>=0) mInv[idx].qty += qty;
            mLogs.push({id:Date.now().toString()+Math.random(), productId:pid, delta:qty, memo:'판매삭제 재고복구 '+today, date:today});
          });
        }

        var newSales = (r.val.salesData||[]).filter(function(s){ return !(s.date>=range.from && s.date<=range.to); });
        var appRef = db.ref('users/'+currentUser.uid+'/locations/'+currentLocationId+'/machines/'+r.mid+'/appData');
        // 현재 자판기면 D도 업데이트
        if(r.mid === currentMachineId){
          D.salesData = newSales;
          if(doRestore){ D.inventory = mInv; D.inventoryLogs = mLogs; }
        }
        var updateData = {salesData: newSales};
        if(doRestore){ updateData.inventory = mInv; updateData.inventoryLogs = mLogs; }
        return appRef.update(updateData);
      });

      Promise.all(savePromises).then(function(){
        closeModal('sales-edit-modal');
        document.getElementById('sales-del-preview').innerHTML='';
        showToast('✅ '+totalRows+'건 삭제 완료'+(doRestore?' · 오늘 재고 복구됨':''));
        renderAll();
      });
    });
  });
}

// 건별 환불/복구 토글
function toggleSaleCancel(id, locId, machineId){
  // 현재 자판기 데이터에서 먼저 찾기
  var idx = D.salesData.findIndex(function(s){ return s.id===id; });
  if(idx>=0){
    var s = D.salesData[idx];
    var p = gp(s.productId); if(!p) return;
    var action = s.cancelled ? '복구' : '환불';
    if(!confirm(p.name+' '+s.date+'\n\n'+action+' 처리할까요?')) return;
    if(!s.cancelled){
      D.salesData[idx].cancelled = true;
      applyInventoryChange(s.productId, s.qty, s.date+' 환불처리 재고원복');
      showToast('↩️ '+p.name+' 환불 처리 · 재고 +'+s.qty);
    } else {
      D.salesData[idx].cancelled = false;
      applyInventoryChange(s.productId, -s.qty, s.date+' 환불취소 재고차감');
      showToast('✅ '+p.name+' 복구 완료 · 재고 -'+s.qty);
    }
    save();
    renderSalesStats();
    renderInv();
    return;
  }
  // 다른 자판기 데이터인 경우 Firebase에서 직접 수정
  if(!locId || !machineId || !currentUser) return;
  var appRef = db.ref('users/'+currentUser.uid+'/locations/'+locId+'/machines/'+machineId+'/appData');
  appRef.once('value').then(function(snap){
    var val = snap.val()||{};
    var mSales = val.salesData||[];
    var mInv = val.inventory||[];
    var mLogs = val.inventoryLogs||[];
    var si = mSales.findIndex(function(s){ return s.id===id; });
    if(si<0){ showToast('❌ 데이터를 찾을 수 없어요'); return; }
    var s = mSales[si];
    var mProds = val.products||[];
    var p = mProds.find(function(x){return x.id===s.productId;});
    var action2 = s.cancelled ? '복구' : '환불';
    if(!confirm((p?p.name:'제품')+' '+s.date+'\n\n'+action2+' 처리할까요?')) return;
    if(!s.cancelled){
      mSales[si].cancelled = true;
      if(p){
        var ii = mInv.findIndex(function(i){return i.productId===s.productId;});
        if(ii>=0) mInv[ii].qty = Math.max(0, mInv[ii].qty + s.qty);
        mLogs.push({id:Date.now().toString()+Math.random(), productId:s.productId, delta:s.qty, memo:s.date+' 환불처리 재고원복', date:s.date});
      }
      showToast('↩️ '+(p?p.name:'제품')+' 환불 처리');
    } else {
      mSales[si].cancelled = false;
      if(p){
        var ii2 = mInv.findIndex(function(i){return i.productId===s.productId;});
        if(ii2>=0) mInv[ii2].qty = Math.max(0, mInv[ii2].qty - s.qty);
        mLogs.push({id:Date.now().toString()+Math.random(), productId:s.productId, delta:-s.qty, memo:s.date+' 환불취소 재고차감', date:s.date});
      }
      showToast('✅ '+(p?p.name:'제품')+' 복구 완료');
    }
    appRef.set({products:mProds, inventory:mInv, inventoryLogs:mLogs, salesData:mSales}).then(function(){
      renderSalesStats();
    });
  });
}

// ─── 제품 상세 팝업 ────────────────────────────────────────────────────────────
function openProdDetail(el){
  var id = (typeof el === 'string') ? el : el.dataset.pid;
  var p = D.products.find(function(x){return x.id===id;});
  if(!p) return;
  var q = gq(id);
  var cols = Array.isArray(p.column)?p.column:(p.column?[p.column]:[]);
  var colLabels = cols.map(function(c){return String(c).trim();});

  // 최근 판매 내역 (최근 5건)
  var sales = D.salesData.filter(function(s){return s.productId===id;})
    .sort(function(a,b){return b.date.localeCompare(a.date);}).slice(0,5);

  var html = '';
  // 컬럼 태그
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">';
  colLabels.forEach(function(l){
    html += '<span style="background:rgba(232,184,109,.15);border:1px solid rgba(232,184,109,.4);border-radius:6px;padding:3px 10px;font-size:12px;font-weight:700;color:var(--gold)">'+l+'</span>';
  });
  html += '</div>';

  // 재고 현황
  html += '<div style="background:'+(q<=5?'rgba(224,88,88,.08)':'rgba(122,218,154,.06)')+';border:1px solid '+(q<=5?'rgba(224,88,88,.3)':'rgba(122,218,154,.2)')+';border-radius:10px;padding:12px 14px;margin-bottom:14px">';
  html += '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">현재 재고</div>';
  html += '<div style="font-size:28px;font-weight:800;color:'+(q<=5?'var(--red)':'var(--green)')+'">'+q+'<span style="font-size:14px;font-weight:500;color:var(--text2);margin-left:4px">개</span></div>';
  html += '</div>';

  // 가격 정보 그리드
  html += '<div class="pm" style="background:var(--bg3);border-radius:10px;margin-bottom:14px">';
  [['구매가',fmt(p.buyPrice)+'원'],['낱개가',fmt(p.unitPrice)+'원'],['판매가',fmt(p.sellPrice)+'원'],['마진가',fmt(p.marginAmt)+'원'],['마진율',(p.marginRate||0)+'%'],['총수량',p.totalQty+'개']].forEach(function(lv){
    html += '<div class="pmb"><div class="pml">'+lv[0]+'</div><div class="pmv">'+lv[1]+'</div></div>';
  });
  html += '</div>';

  // 최근 판매
  if(sales.length){
    html += '<div style="font-size:12px;color:var(--text2);font-weight:600;margin-bottom:8px">📊 최근 판매</div>';
    sales.forEach(function(s){
      html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">';
      html += '<span style="color:var(--text2)">'+s.date+'</span>';
      html += '<span style="font-weight:700;color:var(--blue)">'+s.qty+'개</span>';
      html += '</div>';
    });
  }

  document.getElementById('pdm-title').textContent = p.name;
  document.getElementById('pdm-body').innerHTML = html;
  openModal('prod-detail-modal');
}

