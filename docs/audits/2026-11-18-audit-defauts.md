# Audit des défauts — 18/11/2026 (version 1.0.28)

## Méthode

- Balayage automatisé dans Chromium (`tests/playwright/audit-sweep.mjs`) : PC 1440 × 900 sur `index.html` (Analyse vide puis remplie, Portefeuille, Assistant, fiche d'un bien et ses 4 onglets), iPhone 393 × 852 sur `owned.html` (liste et fiche) et sur `index.html`. Données fictives injectées par les stubs du harnais, aucun accès au vrai Firebase. Relevés : débordements horizontaux, textes « NaN/undefined », champs sans libellé, boutons sans nom, identifiants en double, polices réellement utilisées, jetons CSS non définis, erreurs JS, 404.
- Captures pleine page de chaque écran, relues une par une.
- Relecture du code : sécurité (règles Firestore/Storage, Cloud Functions, en-têtes Hosting), poids des ressources, formatage, éléments restés ouverts depuis le bilan du 12/10/2026.

Résultat brut du balayage : **aucune erreur JS, aucune 404, aucun « NaN/undefined » affiché, aucun identifiant en double, aucun jeton CSS orphelin** (B1 d'octobre est bien réglé). Les défauts restants concernent surtout le fonctionnel manquant, la cohérence de l'affichage et quelques points techniques.

Préalable fait le même jour : **suppression du mode 1 écran / 2 écrans** (bouton, fenêtre d'analyse détachée `?panel=analysis`, synchronisation `BroadcastChannel`, préférence `screens`). L'Analyse s'affiche toujours dans la même vue. La clé `screens` éventuellement présente dans `settings/prefs` n'est plus lue (sans effet, rien à migrer).

## 1. Défauts fonctionnels

| # | Gravité | Défaut | Preuve | Correction proposée |
|---|---|---|---|---|
| F1 | **P0** | **Les études enregistrées sont inaccessibles.** « Enregistrer » écrit l'étude dans `studies/{id}`, mais aucune interface ne les liste : impossible de rouvrir, comparer ou supprimer une étude. Signalé en octobre, toujours ouvert. | `loadAssetIntoWorkspace()` (`main.js:1332`) n'est appelée nulle part. | Bloc « Mes études » dans la barre latérale (nom, ville, prix, CF, score, date ; clic = charger ; suppression confirmée), puis comparateur 2-3 études. |
| F2 | P1 | **Les contrôles de l'Analyse restent visibles sur Portefeuille et Assistant** : Guidé/Complet, « Nouvelle étude · pas encore enregistrée », Enregistrer, + Nouvelle étude, Exporter PDF. Dans l'onglet Profil, deux boutons « Enregistrer » s'affichent : l'un enregistre l'étude, l'autre le profil. | Balayage : `save-asset`, `new-asset`, `export-decision-pdf` et `mode-toggle` sont visibles sur les deux autres onglets. Capture `pc-bien-Travaux`. | Masquer ce bloc de la barre latérale hors de l'onglet Analyse. |
| F3 | P1 | **Le bouton flottant recouvre encore des contenus** (B11 d'octobre, pas entièrement réglé). PC : il cache le bouton « + Ajouter » des autres crédits (Profil). iPhone : les deux boutons ✦ et 📄 cachent le total annuel des frais (« 890 € ») et le haut de la liste. | Captures `pc-bien-Travaux` (onglet Profil), `m-bien-Travaux`. | Marge basse égale à la hauteur du bouton + 16 px sous les conteneurs ; sur iPhone, un seul bouton avec menu, ou boutons qui se replient pendant le défilement. |
| F4 | P1 | **Le verdict est trop sévère quand l'étude est vide ou peu renseignée** : avec prix 150 000 € et loyer 750 €, on obtient un score de 0/100 et « Offre non recevable », répétés 4 fois sur le premier écran (bandeau du haut, résumé fixe, carte Verdict, anneau du score). | Capture `pc-analyse-remplie`. | Afficher une seule fois le verdict ; séparer « Dossier à documenter » de « Économie défavorable » (déjà proposé en octobre). |
| F5 | P2 | **Blocs repliés qui paraissent vides** : « Robustesse » et « Scénarios & projections » n'affichent qu'un titre, sans chevron ni texte qui invite à les ouvrir. | Capture `pc-analyse-remplie`. | Chevron visible et résumé d'une ligne dans l'en-tête replié. |
| F6 | P2 | **Deux comparatifs des régimes aux chiffres différents sur le même onglet Calcul** : les cartes « 12 prochains mois » donnent −244 / −174 / −49 €/mois, le tableau « An 1 » donne −211 / −139 / −41 €/mois. Les deux bases sont justes, mais rien n'explique l'écart au lecteur. | Capture `pc-bien-Calcul`. | Titrer chaque bloc par sa période (« 12 prochains mois » / « année civile ») ou n'en garder qu'un. |
| F7 | P2 | **SCI-IS « OPTIMAL » avec un impôt de 0 €** : ce badge pousse à changer de régime alors que les frais de structure et la fiscalité de sortie ne sont pas comptés. La mention existe en petits caractères dans l'alerte, mais pas sur la carte. | Capture `pc-bien-Calcul`. | Reprendre la mention « hors frais de structure » sur la carte, ou inclure un forfait de frais de SCI réglable. |

## 2. Affichage et cohérence

| # | Gravité | Défaut | Preuve | Correction |
|---|---|---|---|---|
| A1 | P1 | **Séparateur décimal anglais** à plusieurs endroits : « DSCR 0.50 » (Analyse) alors que la barre du haut affiche « 0,50 » ; « DSCR 0.92 » dans le Centre d'actions ; liste dépliée d'un bien. | `formatRatio()` (`utils.js:60`) renvoie `toFixed(2)` ; `calculs.js:3046` ; `owned-portfolio.js:3062`. | `formatRatio` au format français, et l'utiliser partout. |
| A2 | P2 | **Le même chiffre apparaît deux fois sur un écran** : sur la vue d'ensemble du portefeuille, « CF net-net / mois · 12 prochains mois −244 € » est affiché dans le dashboard puis juste en dessous. | Capture `pc-bien-Vue_d_ensemble`. | Supprimer la seconde rangée de 3 cartes ou n'y garder que ce qui ne figure pas plus haut. |
| A3 | P2 | **Formats de date mélangés** : ISO « 2026-08-28 » dans la liste des frais, « 03/2024 », « 12/2026 – 11/2027 », sélecteur « dd/mm/yyyy ». | Capture `m-bien-Travaux`. | Un seul format affiché (« 28/08/2026 »). |
| A4 | P2 | **Polices mélangées** : Inter, IBM Plex Mono, Manrope et Cormorant Garamond (titre « Flux de trésorerie annuels », seul titre dans cette police) coexistent ; la charte annoncée dans `CLAUDE.md` (Cormorant / Plex Mono / Manrope) n'est pas celle du code (Inter partout). Sur iPhone, Plex Mono n'est pas encore chargée au premier affichage (`document.fonts.check` = faux), d'où un changement de police visible. | Balayage, champ `fonts`. | Décider d'une charte unique (point resté ouvert en octobre) ; `font-display` et préchargement de Plex Mono. |
| A5 | P2 | **Deux couleurs d'action** : boutons principaux indigo (Enregistrer, Ajouter, onglet actif du régime) et boutons or (Complet, Diagnostic IA, onglets soulignés, bouton flottant). | Toutes les captures. | Une seule couleur d'accent. |
| A6 | P2 | **Grands espaces vides** : la carte du portefeuille occupe ~300 px pour afficher « Aucun bien localisé » ; « Points d'appui » est une carte presque vide ; un espace vide de ~40 px sépare le titre « Régime fiscal du portefeuille » de ses boutons. | Captures `pc-bien-Vue_d_ensemble`, `pc-analyse-remplie`. | Remplacer la carte vide par une ligne d'invite ; resserrer. |
| A7 | P3 | **Icônes de 3 familles** : emoji couleur (🏠 📄 ✏️ 🔍 💡 📊 🔧), glyphes (✦ ✕ ☀), SVG (barre latérale). | Captures. | Icônes SVG partout. |

## 3. Accessibilité

| # | Gravité | Défaut | Preuve | Correction |
|---|---|---|---|---|
| X1 | P1 | **Formulaires sans libellé**, avec un simple texte indicatif qui disparaît dès la saisie : 8 champs dans Exploitation (Année, TF, Copro, Gestion, PNO, Loyer, note…), 6 dans Travaux (date, description, montant, nature, commentaire, recherche), la zone de saisie de l'Assistant, les curseurs taux/durée de l'Analyse. Sur PC comme sur iPhone. | Balayage, champ `noLabel`. | `aria-label` au minimum, libellé visible sur mobile. |
| X2 | P2 | **Aucun titre `<h1>`** sur aucune page : la structure des titres n'est pas exploitable par un lecteur d'écran. | Balayage, `h1 = 0` partout. | Le nom de la vue (ou du bien ouvert) en `<h1>`. |
| X3 | P2 | **Cibles trop petites sur PC** : 41 à 50 éléments cliquables font moins de 44 px par onglet (onglets « An 1 / An 3… » à ~22 px, flèches ‹ ›, croix). Sur `owned.html`, aucune n'est relevée sous 44 px : B12 est réglé côté iPhone. | Balayage, champ `small`. | Acceptable à la souris ; à revoir seulement pour les écrans tactiles PC. |

## 4. Technique, performance, sécurité

| # | Gravité | Défaut | Preuve | Correction |
|---|---|---|---|---|
| T1 | P1 | **Logo de 964 Ko affiché en 24 × 24 px** sur chaque page (et icône d'écran d'accueil iPhone). C'est le plus gros fichier téléchargé au premier chargement, surtout en 4G. | `Logo_site.png` (963 785 octets), `index.html:29`, `owned.html:13/28`. | PNG 48 × 48 (≈ 3 Ko) pour l'en-tête, 180 × 180 pour `apple-touch-icon`. |
| T2 | P2 | **Scripts tiers qui bloquent l'affichage** : Chart.js (jsDelivr) et Leaflet sont chargés dans le `<head>`, sans `defer` et sans empreinte d'intégrité (`integrity`). Si jsDelivr est lent ou indisponible, la page attend ; si le CDN est compromis, le script s'exécute avec les droits du compte. | `index.html:13-14`. | Copier Chart.js dans `vendor/` (comme pdf-lib et Leaflet), `defer`. |
| T3 | P2 | **Pas d'en-têtes de sécurité** sur Hosting : ni `Content-Security-Policy`, ni `X-Frame-Options`/`frame-ancestors` (la page peut être intégrée dans un cadre par un autre site), ni `Referrer-Policy`. | `firebase.json`, section `headers`. | `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP progressive. |
| T4 | P2 | **Fichiers internes publiés** : `package.json`, `package-lock.json`, `firestore.rules`, `storage.rules`, `CHANGELOG`… ne sont pas tous exclus ; `package*.json` et les `.rules` sont servis publiquement. Peu sensible, mais inutile. | `firebase.json` > `ignore`, liste des fichiers à la racine. | Ajouter `package*.json`, `*.rules`, `*.md` à `ignore`. |
| T5 | P2 | **Règles Storage sans limite de taille ni de type** : un utilisateur connecté peut y écrire n'importe quel fichier de n'importe quelle taille. Compte unique, donc risque faible, mais une erreur de code peut remplir le quota. | `storage.rules`. | `request.resource.size < 15 * 1024 * 1024` et type PDF/image/JSON. |
| T6 | P3 | **Limite d'appels IA tenue en mémoire** : `_checkRateLimit` compte par instance de Cloud Function ; plusieurs instances, ou une instance qui redémarre, remettent le compteur à zéro. | `functions/index.js:33`. | Compteur dans Firestore, ou `maxInstances: 1` sur les fonctions IA. |
| T7 | P3 | **Fichiers très volumineux** : `owned-portfolio.js` 409 Ko (6 939 lignes), `styles.css` 267 Ko (8 961 lignes, 83 couleurs en dur, 14 tailles de police en px), `calculs.js` 193 Ko, sans minification. Chaque changement est risqué et le premier chargement pèse ~1,3 Mo de JS + CSS. | `ls -la`. | Découper `owned-portfolio.js` par onglet ; minifier au déploiement si besoin. |
| T8 | P3 | **Documentation périmée** : `RESUME_PROJET.txt` décrit encore l'exe Windows « sans connexion internet » ; `rapport-annuel.js` n'apparaît pas dans le tableau d'architecture de `CLAUDE.md`. | Fichiers concernés. | Supprimer ou réécrire le résumé ; compléter le tableau. |

## 5. Ce qui va bien (vérifié ce jour)

- Aucune erreur JS ni ressource manquante, PC et iPhone, sur tous les écrans visités.
- Aucun débordement horizontal sur `owned.html` (393 px) ; cibles tactiles conformes.
- Règles Firestore et Storage correctement limitées à `users/{uid}`, toutes les Cloud Functions exigent l'authentification et plafonnent la taille des données envoyées.
- Contenu utilisateur échappé (`escapeHtml`) dans les gabarits relus ; aucun accès `localStorage`/`sessionStorage`.
- Calculs cohérents dans la décomposition du CF (7 410 − 920 − 7 076 − 2 342 = −2 928 €, soit −244 €/mois, même chiffre dans la liste, le dashboard et la fiche).

## 6. Ordre de traitement proposé

1. **Rapide (≤ 1 h chacun)** : F2 (masquer les contrôles de l'Analyse), A1 (virgule décimale), T1 (logo), T4 (exclusions de déploiement), T3 (en-têtes), X1 (`aria-label`), F3 (marge sous le bouton flottant).
2. **Court (≤ 1 jour)** : F1 liste des études (puis comparateur), F4 verdict unique et nuancé, F5 chevrons, F6/F7 libellés des comparatifs de régimes, A2/A3/A6.
3. **Chantier** : charte unique (A4, A5, A7), Chart.js vendorisé (T2), découpage d'`owned-portfolio.js` (T7).
