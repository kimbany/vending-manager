import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDKgGwpAwmeZLiIHRyTIz87JvRaGM_G240",
  authDomain: "vending-manager-2d64e.firebaseapp.com",
  databaseURL: "https://vending-manager-2d64e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "vending-manager-2d64e",
  storageBucket: "vending-manager-2d64e.firebasestorage.app",
  messagingSenderId: "840768320205",
  appId: "1:840768320205:web:9cf171935ef01de8852f84",
  measurementId: "G-BK8MS8EPD5",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
