// ─── Firebase 초기화 ──────────────────────────────────────────────────────────
firebase.initializeApp({
  apiKey:"AIzaSyDKgGwpAwmeZLiIHRyTIz87JvRaGM_G240",
  authDomain:"vending-manager-2d64e.firebaseapp.com",
  databaseURL:"https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:"vending-manager-2d64e",
  storageBucket:"vending-manager-2d64e.firebasestorage.app",
  messagingSenderId:"840768320205",
  appId:"1:840768320205:web:9cf171935ef01de8852f84"
});
var db   = firebase.database();
var auth = firebase.auth();
if(firebase.functions) firebase.functions().useEmulator && firebase.functions().region || (function(){ /* functions region은 Cloud Function 배포 시 자동 설정 */ })();
var currentUser = null;
var REF = null;
var CRAWL_REF = null;

// ─── 전역 상태 ────────────────────────────────────────────────────────────────
var D = {products:[],inventory:[],inventoryLogs:[],salesData:[]};
var salesSort='date', csvH=[], csvR=[], invDir='plus';
