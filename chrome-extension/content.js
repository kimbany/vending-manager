// ─── 쿠팡 주문내역 페이지에서 데이터 추출 ─────────────────────────────────────
// mc.coupang.com/ssr/desktop/order/list 에서 자동 실행

(function() {
  'use strict';

  // 설정 로드
  chrome.storage.local.get(['invendoryUid', 'autoSync'], function(cfg) {
    if (!cfg.invendoryUid) {
      console.log('[Invendory] UID 미설정 - 팝업에서 설정해주세요');
      return;
    }
    if (cfg.autoSync === false) return;

    console.log('[Invendory] 쿠팡 주문내역 수집 시작');

    // 페이지 완전 로딩 대기
    waitForOrders(function() {
      var orders = extractOrders();
      if (orders.length > 0) {
        chrome.runtime.sendMessage({
          type: 'COUPANG_ORDERS',
          uid: cfg.invendoryUid,
          orders: orders
        }, function(resp) {
          if (resp && resp.success) {
            showBadge('✅ ' + orders.length + '건 동기화 완료');
          }
        });
      } else {
        console.log('[Invendory] 주문 데이터 없음');
      }
    });
  });

  // 주문 데이터가 로드될 때까지 대기
  function waitForOrders(callback) {
    var attempts = 0;
    var maxAttempts = 20;
    var timer = setInterval(function() {
      attempts++;
      var text = document.body.innerText || '';
      // 주문 데이터가 로드되면 (날짜 패턴이 보이면)
      if (text.match(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*주문/) || attempts >= maxAttempts) {
        clearInterval(timer);
        // 추가 대기 (렌더링 완료)
        setTimeout(callback, 2000);
      }
    }, 1000);
  }

  // 주문 데이터 추출
  function extractOrders() {
    var orders = [];

    // 방법 1: DOM 기반 추출 (CSS 셀렉터)
    var orderBlocks = document.querySelectorAll(
      '.myorder-list .order-list-item, ' +
      '[class*="order-list"] [class*="order-item"], ' +
      '.my-order-list__order, ' +
      'section[class*="order"]'
    );

    if (orderBlocks.length > 0) {
      orderBlocks.forEach(function(block) {
        var order = parseOrderBlock(block);
        if (order) orders.push(order);
      });
    }

    // 방법 2: 텍스트 기반 추출 (DOM 실패 시 폴백)
    if (orders.length === 0) {
      orders = parseOrdersFromText(document.body.innerText);
    }

    console.log('[Invendory] 추출된 주문:', orders.length, '건');
    return orders;
  }

  // DOM 블록에서 주문 파싱
  function parseOrderBlock(block) {
    var text = block.innerText || '';
    var dateMatch = text.match(/(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.\s*주문/);
    if (!dateMatch) return null;

    var orderDate = dateMatch[1].replace(/\s/g, '');
    var products = parseProductsFromText(text);

    if (products.length === 0) return null;
    return { order_date: orderDate, products: products };
  }

  // 텍스트에서 주문 파싱
  function parseOrdersFromText(text) {
    var orders = [];
    var blocks = text.split(/(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*주문)/);

    for (var i = 0; i < blocks.length; i++) {
      var dateMatch = blocks[i].match(/(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.\s*주문/);
      if (dateMatch && i + 1 < blocks.length) {
        var orderDate = dateMatch[1].replace(/\s/g, '');
        var products = parseProductsFromText(blocks[i + 1]);
        if (products.length > 0) {
          orders.push({ order_date: orderDate, products: products });
        }
      }
    }
    return orders;
  }

  // 텍스트에서 상품 정보 추출
  function parseProductsFromText(text) {
    var products = [];
    var lines = text.split('\n');

    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      if (!line) continue;

      // "상품명, 옵션, N개" 패턴
      var qtyMatch = line.match(/(\d+)\s*개\s*$/);
      if (qtyMatch && line.length > 5) {
        var qty = parseInt(qtyMatch[1]);
        var name = line.slice(0, qtyMatch.index).trim().replace(/,\s*$/, '');
        if (name && name.length > 2) {
          products.push({ product_name: name, quantity: qty });
        }
      }

      // 금액 패턴
      var priceMatch = line.match(/^([\d,]+)\s*원$/);
      if (priceMatch && products.length > 0 && !products[products.length - 1].price) {
        products[products.length - 1].price = parseInt(priceMatch[1].replace(/,/g, ''));
      }
    }
    return products;
  }

  // 페이지에 알림 배지 표시
  function showBadge(msg) {
    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;top:20px;right:20px;background:#4CAF50;color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:700;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,.2);font-family:sans-serif';
    badge.textContent = msg;
    document.body.appendChild(badge);
    setTimeout(function() { badge.remove(); }, 5000);
  }

  // 무한 스크롤/페이지네이션 처리
  function loadAllPages(callback) {
    // 스크롤 다운으로 더 많은 주문 로드
    var scrollCount = 0;
    var maxScrolls = 10;
    var timer = setInterval(function() {
      window.scrollTo(0, document.body.scrollHeight);
      scrollCount++;
      if (scrollCount >= maxScrolls) {
        clearInterval(timer);
        window.scrollTo(0, 0);
        callback();
      }
    }, 1500);
  }
})();
