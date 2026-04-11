// ─── Background Service Worker ───────────────────────────────────────────────
// 콘텐츠 스크립트에서 받은 쿠팡 주문 데이터를 Firebase에 저장

const FIREBASE_DB_URL = 'https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app';

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'COUPANG_ORDERS') {
    saveTofirebase(message.uid, message.orders)
      .then(function() {
        sendResponse({ success: true });
      })
      .catch(function(err) {
        console.error('[Invendory] Firebase 저장 실패:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 비동기 응답
  }
});

async function saveTofirebase(uid, orders) {
  var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  var nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(',', '');

  var totalProducts = 0;
  orders.forEach(function(o) { totalProducts += (o.products || []).length; });

  var data = {
    date: today,
    updated_at: nowStr,
    total_orders: orders.length,
    total_products: totalProducts,
    orders: orders,
    source: 'chrome_extension'
  };

  // Firebase에 저장 (인증 없이 - 규칙에서 허용 필요)
  var url = FIREBASE_DB_URL + '/users/' + uid + '/coupangOrders/' + today + '.json';
  var resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (!resp.ok) {
    throw new Error('Firebase 응답: ' + resp.status);
  }

  console.log('[Invendory] Firebase 저장 완료:', totalProducts, '건');

  // 미입고 구매 목록에도 추가
  await savePurchases(uid, orders);
}

async function savePurchases(uid, orders) {
  // 기존 purchases 로드
  var url = FIREBASE_DB_URL + '/users/' + uid + '/purchases.json';
  var resp = await fetch(url);
  var purchases = await resp.json() || [];
  if (!Array.isArray(purchases)) purchases = Object.values(purchases);

  var existingKeys = {};
  purchases.forEach(function(p) {
    existingKeys[p.coupangProductName + '_' + p.purchaseDate] = true;
  });

  var added = 0;
  orders.forEach(function(order) {
    var orderDate = (order.order_date || '').replace(/\./g, '-').replace(/\s/g, '');
    (order.products || []).forEach(function(prod) {
      var key = prod.product_name + '_' + orderDate;
      if (existingKeys[key]) return;
      purchases.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
        coupangProductName: prod.product_name,
        quantity: prod.quantity || 1,
        totalPrice: prod.price || 0,
        unitPrice: prod.price && prod.quantity ? Math.round(prod.price / prod.quantity) : 0,
        purchaseDate: orderDate,
        status: 'pending'
      });
      existingKeys[key] = true;
      added++;
    });
  });

  if (added > 0) {
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(purchases)
    });
    console.log('[Invendory] 미입고 구매', added, '건 추가');
  }
}
