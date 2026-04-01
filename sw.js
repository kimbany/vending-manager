var CACHE_NAME = 'invedory-v1';
var STATIC_FILES = [
  './',
  './index.html',
  './css/style.css',
  './img/logo.png',
  './img/icon-192.png',
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
  './js/bulk.js',
  './js/crawl.js',
  './js/coupang.js',
  './js/lock.js',
  './js/ui.js'
];

// 설치 - 정적 파일 캐싱
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting();
});

// 활성화 - 이전 캐시 삭제
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// 네트워크 우선 전략 (온라인이면 네트워크, 실패하면 캐시)
self.addEventListener('fetch', function(e){
  // Firebase API 요청은 캐싱하지 않음
  if(e.request.url.indexOf('firebasedatabase') >= 0 ||
     e.request.url.indexOf('googleapis') >= 0 ||
     e.request.url.indexOf('gstatic') >= 0){
    return;
  }
  e.respondWith(
    fetch(e.request).then(function(res){
      // 성공하면 캐시 업데이트
      var clone = res.clone();
      caches.open(CACHE_NAME).then(function(cache){
        cache.put(e.request, clone);
      });
      return res;
    }).catch(function(){
      // 오프라인이면 캐시에서
      return caches.match(e.request);
    })
  );
});
