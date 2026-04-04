var CACHE_VERSION = 6;
var CACHE_NAME = 'invedory-v' + CACHE_VERSION;
var STATIC_FILES = [
  './',
  './index.html',
  './css/style.css',
  './img/logo.png',
  './img/icon-192.png',
  './manifest.json'
];
var JS_FILES = [
  './js/security.js',
  './js/firebase-config.js',
  './js/data.js',
  './js/auth.js',
  './js/home.js',
  './js/settings.js',
  './js/machines.js',
  './js/inventory.js',
  './js/sales.js',
  './js/csv.js',
  './js/machine-view.js',
  './js/products.js',
  './js/vmms-products.js',
  './js/bulk.js',
  './js/crawl.js',
  './js/coupang.js',
  './js/lock.js',
  './js/ui.js'
];

// 설치 - 정적 파일 + JS 캐싱
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(STATIC_FILES.concat(JS_FILES));
    })
  );
  self.skipWaiting();
});

// 활성화 - 이전 버전 캐시 삭제
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k.startsWith('invedory-') && k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Stale-While-Revalidate 전략
// 캐시 먼저 반환 (빠른 로딩) + 백그라운드에서 네트워크 업데이트
self.addEventListener('fetch', function(e){
  var url = e.request.url;

  // Firebase/외부 API 요청은 캐싱하지 않음
  if(url.indexOf('firebasedatabase') >= 0 ||
     url.indexOf('googleapis.com') >= 0 ||
     url.indexOf('gstatic.com/firebasejs') >= 0 ||
     url.indexOf('api-gateway.coupang') >= 0){
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function(cached){
      // 백그라운드에서 네트워크 업데이트
      var fetchPromise = fetch(e.request).then(function(res){
        if(res.ok){
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(e.request, clone);
          });
        }
        return res;
      }).catch(function(){ return cached; });

      // 캐시가 있으면 즉시 반환, 없으면 네트워크 대기
      return cached || fetchPromise;
    })
  );
});
