// ─── 보안 유틸 (AES-256-GCM + SHA-256) ──────────────────────────────────────

// AES-256-GCM 암호화 키 (유저 UID 기반으로 생성)
function _getEncKey(uid){
  var enc = new TextEncoder();
  return crypto.subtle.importKey('raw',
    enc.encode((uid+'_invedory_secure_key_2026').slice(0,32)),
    {name:'AES-GCM'}, false, ['encrypt','decrypt']
  );
}

// AES 암호화
function encryptAES(text, uid){
  if(!text) return Promise.resolve('');
  var enc = new TextEncoder();
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return _getEncKey(uid).then(function(key){
    return crypto.subtle.encrypt({name:'AES-GCM',iv:iv}, key, enc.encode(text));
  }).then(function(encrypted){
    var combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode.apply(null, combined));
  });
}

// AES 복호화
function decryptAES(encoded, uid){
  if(!encoded) return Promise.resolve('');
  try {
    var raw = atob(encoded);
    var bytes = new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    var iv = bytes.slice(0,12);
    var data = bytes.slice(12);
    return _getEncKey(uid).then(function(key){
      return crypto.subtle.decrypt({name:'AES-GCM',iv:iv}, key, data);
    }).then(function(decrypted){
      return new TextDecoder().decode(decrypted);
    });
  } catch(e){
    // 기존 btoa 형식 호환 (마이그레이션)
    try { return Promise.resolve(atob(encoded)); } catch(e2){ return Promise.resolve(''); }
  }
}

// SHA-256 해시 (PIN용)
function hashSHA256(text){
  var enc = new TextEncoder();
  return crypto.subtle.digest('SHA-256', enc.encode(text)).then(function(hash){
    return Array.from(new Uint8Array(hash)).map(function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
  });
}

// HTML 태그 제거 (XSS 방지)
function sanitize(str){
  if(!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
