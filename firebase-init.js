// Initialisation Firebase (projet dedie "spark-investissement") — importee par owned-cloud.js.
// La cle apiKey ci-dessous est volontairement publique : Firebase distingue "identification du projet"
// (cette config) et "autorisation d'acces" (regles Firestore/Storage + Auth), contrairement a
// scraper/config.py qui doit lui rester prive.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

const firebaseConfig = {
    apiKey: 'AIzaSyC_7MXThjTONsiMuUCXKBKa3AOz1g2Dryw',
    authDomain: 'spark-investissement.firebaseapp.com',
    projectId: 'spark-investissement',
    storageBucket: 'spark-investissement.firebasestorage.app',
    messagingSenderId: '1012860873206',
    appId: '1:1012860873206:web:00eeb1e967af561fe7ffd7'
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, 'europe-west1');
