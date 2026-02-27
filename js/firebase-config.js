import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBul_frK1GnyAzTuLSKQCJso5XwgjAnn9k",
  authDomain: "linha-eletro.firebaseapp.com",
  projectId: "linha-eletro",
  storageBucket: "linha-eletro.firebasestorage.app",
  messagingSenderId: "366258439760",
  appId: "1:366258439760:web:90e92c63ab22e3b7c4f355"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
