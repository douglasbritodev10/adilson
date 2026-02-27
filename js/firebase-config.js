import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWbYc7y0EVsl6iUkk8rYdAxi-fluzt3iI",
  authDomain: "assistencia-sm.firebaseapp.com",
  projectId: "assistencia-sm",
  storageBucket: "assistencia-sm.firebasestorage.app",
  messagingSenderId: "737353763297",
  appId: "1:737353763297:web:7ffa196232f46eb616aaa0"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
