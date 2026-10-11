# Prompt — Passage de Spark au tout-web (pour Claude Fable 5.1)

> Spec validée avec l'utilisateur le 2026-10-11, rédigée comme un prompt autonome à coller dans une
> nouvelle session Claude Code ouverte à la racine du projet `Investissement_web`.

---

<contexte>
Spark est une application française d'analyse d'investissement immobilier, utilisée par une seule
personne (l'utilisateur) sur PC et sur iPhone. Elle existe aujourd'hui sous deux formes qui partagent
les mêmes fichiers front (`index.html`, `owned.html`, `main.js`, `owned-portfolio.js`, `calculs.js`…) :

1. **Un exe de bureau** (`app.py` + `server.py` Flask sur `127.0.0.1:8080` + PyWebView, empaqueté par
   `build.bat` / `spark.spec` en `Spark/Spark-x.y.z.exe`).
2. **Une version web** hébergée sur Firebase Hosting (projet `spark-investissement`), avec Firebase Auth,
   Firestore, Storage et des Cloud Functions IA (`functions/index.js`, région `europe-west1`).

Le portefeuille de biens détenus, le profil fiscal (`portfolioMeta/main.profile`), l'IA, les factures et
le géocodage fonctionnent déjà sans serveur local. Le reste dépend encore de l'exe.

Déclencheur : le port 8080 est désormais pris par Revit (plugin MCP), l'exe affiche
`ERR_INVALID_HTTP_RESPONSE`. L'utilisateur a décidé d'abandonner l'exe : **toute l'application devient
web, ouverte depuis un favori du navigateur, et plus aucune donnée n'est stockée en local.**

Lis `CLAUDE.md` et `CODEBASE_MAP.md` avant de commencer : ils décrivent l'architecture, les conventions
(texte utilisateur en français, `escapeHtml()` sur tout contenu injecté, `calculs.js` pur) et la méthode
de test Playwright (stub de `owned-cloud.js`).
</contexte>

<objectif>
Livrer une application 100 % web, sans aucune perte de données, où :
- toutes les données (études du comparateur, étude en cours, préférences, portefeuille) vivent
  uniquement dans Firestore/Storage, sous `users/{uid}/…` ;
- aucun code applicatif ne lit ni n'écrit `localStorage` / `sessionStorage` (seule exception tolérée :
  la session Firebase Auth, gérée par le SDK) ;
- chaque fonction qui passait par `server.py` a un équivalent navigateur qui marche sur PC et iPhone ;
- l'exe, le serveur Flask et la chaîne de build ont disparu du projet.
</objectif>

<etat_actuel>
Données encore uniquement locales (stockage WebView2 de l'exe, origine `http://127.0.0.1:8080`,
dossier `%APPDATA%\pywebview\EBWebView`). Clés `localStorage` (voir `STORAGE_KEYS`, `main.js:36`) :
- `investissementWebAssetRecords` — études du comparateur (tableau) ; `investissementWebActiveAssetId`
- `investissementWebVariablesData` — étude en cours de saisie
- `investissementWebTheme`, `investissementWebScreens`, `investissementWebGuidedMode`,
  `investissementWebSparkMode`, `investissementWebOwnedCompact`, `investissementWebOwnedSort`,
  `investissementWebOwnedOrder`, `investissementWebOwnedYearFilters`, `investissementWebOwnedPieYear`,
  `investissementWebOwnedPieMonth`, `investissementWebOwnedRegime`, `investissementWebAnalysisView`,
  `sparkTutoStep`, la clé `FM_LAST_ASSET_KEY` de `owned-portfolio.js`
- `investissementWebProfile*` — profil : déjà synchronisé via `portfolioMeta.profile`, à ne lire
  localement que si le cloud est vide
- legacy : `investissementWebOwnedAssets`, `investissementWebPortfolioGoals` (ancienne migration
  portefeuille, `owned-portfolio.js` ~l.6360-6395)

Fais un `grep -n "localStorage\|sessionStorage"` sur tous les `.js` racine pour la liste exhaustive :
celle-ci peut être incomplète.

Fichiers locaux à migrer : `exports/portefeuille-2026-06-14.json`, `exports/portefeuille-2026-07-29.json`,
`documents/oa-1785100792197-r76ie/c1d67d7a3d7648c8bbc009d520baf3bd.pdf`.

Routes `server.py` utilisées par le front :
- `/api/generate-pdf` (+ `/api/pdf-preview/<token>`) — `utils.js openPrintDocument()`, appelée par
  `main.js:1770` (PDF décision), `owned-portfolio.js:1429` (dossier bancaire), `:1483` (rapport d'un bien).
  **Déjà cassée sur la version web** pour la décision et le dossier bancaire (404).
- `/api/save-markdown` — `owned-portfolio.js:1524` (rapport `.md`, branche `IS_LOCAL_APP`)
- `/api/portfolio/export`, `/api/portfolio/import`, `/api/portfolio/import/list` — `owned-portfolio.js`
  ~l.2323, 2370, 2511
- `/api/documents/<bien>/<fichier>` — lecture seule pour l'ancienne migration
- `/api/version` — `main.js:2961` (affichage `vN` dans la topbar)

Firestore : règles `users/{uid}/{document=**}` réservées au propriétaire (`firestore.rules`), idem
Storage (`storage.rules`) : **aucune règle à modifier**. Firestore est initialisé en cache mémoire
(`firebase-init.js`, `getFirestore` sans persistance) : garde-le ainsi.
</etat_actuel>

<conception_validee>
**1. Modèle de données (Firestore, sous `users/{uid}/`)**
- `studies/{id}` : une étude du comparateur par document, avec son `id` d'origine et un `updatedAt`.
- `settings/analysis` : `{ variablesData, activeAssetId }`.
- `settings/prefs` : toutes les préférences d'interface listées plus haut.
- `settings/migration` : `{ doneAt, counts, appVersion }`, marqueur de migration réussie.
- Le portefeuille garde `ownedAssets/` et `portfolioMeta/main` existants ; les préférences portefeuille
  qui sont des données (ordre, régime, objectifs) restent dans `portfolioMeta`.

Ajoute les fonctions d'accès dans `owned-cloud.js` (ou un nouveau module `cloud-store.js` si c'est plus
lisible, à importer depuis `main.js` et `owned-portfolio.js`), sur le modèle de `watchOwnedAssets` /
`cloudSaveMeta` : abonnements `onSnapshot` en temps réel, écritures `setDoc(..., { merge: true })`.

**2. Synchronisation**
- Firestore est la seule source de vérité ; pas de cache `localStorage`. Au chargement, afficher un
  indicateur discret (≈ 0,5 s) jusqu'au premier snapshot, sans flash de valeurs par défaut.
- `computeAnalysisViewModel` reste appelé à chaque frappe (synchrone, rapide) ; seule l'écriture
  Firestore de `settings/analysis` est **débouncée à 1,5 s** d'inactivité, plus un flush sur
  `visibilitychange`/`pagehide`.
- **Ne jamais écrire de valeurs par défaut dans le cloud au simple chargement** d'un document vide :
  on n'écrit que sur action de l'utilisateur. (Sinon la première ouverture écraserait les données
  avant la migration.)
- Conflits : dernière écriture gagnante, comme pour le portefeuille.
- Le mode deux fenêtres (`?panel=analysis`) doit continuer à marcher : remplacer la synchro
  `localStorage` (`syncTick`, `STORAGE_SYNC_KEYS`) par `BroadcastChannel` seul et/ou les snapshots
  Firestore, qui synchronisent déjà les deux fenêtres.
- Pas d'usage hors-ligne demandé.

**3. Connexion obligatoire pour toute l'app**
L'écran `owned-auth-gate` existant (`owned-portfolio.js` ~l.6311) protège désormais aussi l'outil
d'analyse dans `index.html`. Session Firebase Auth persistante (comportement par défaut du SDK).

**4. Remplacements web de `server.py`**
| Fonction | Remplacement |
|---|---|
| PDF (décision, dossier bancaire, rapport d'un bien) | `openPrintDocument()` réécrite : HTML du document dans une iframe cachée (ou fenêtre dédiée), `document.title` = nom de fichier souhaité, `print()`. Réutilise la logique d'impression déjà écrite pour le rapport d'un bien en version web/iPhone. Même signature pour les appelants |
| Rapport `.md` | Supprimer la branche `IS_LOCAL_APP` ; garder le comportement web existant (téléchargement blob sur PC, feuille de partage sur écran tactile) |
| Export portefeuille JSON | Téléchargement `portefeuille-AAAA-MM-JJ.json` (feuille de partage sur iPhone) **et** copie dans Storage `users/{uid}/archives/` |
| Import portefeuille | Liste des archives Storage + bouton « Choisir un fichier… » (`<input type="file" accept=".json">`) |
| Version | Lire le fichier statique `VERSION` (servi par Hosting) |
| Ancienne migration portefeuille (`#owned-migrate-btn`, `/api/documents`) | Supprimer |

**5. Migration unique via une dernière version de l'exe**
Seul l'exe peut lire son propre `localStorage` (origine `127.0.0.1:8080`) et les dossiers `exports/`,
`documents/`. Écris un module `migration-locale.js`, chargé uniquement quand
`location.hostname` est `127.0.0.1`/`localhost`, qui, après connexion et si `settings/migration`
n'existe pas :
1. pousse chaque étude dans `studies/{id}` ; si un document de même `id` existe déjà, garde le plus
   récent (`updatedAt`, à défaut l'étude locale) ;
2. pousse `settings/analysis` et `settings/prefs` (le profil seulement si `portfolioMeta.profile` est vide) ;
3. lit les deux exports via `/api/portfolio/import/list` + `/api/portfolio/import` et les dépose
   tels quels dans Storage `users/{uid}/archives/<nom d'origine>` ;
4. pour chaque `postAchat.travaux[].pdfFilename` des biens, si le fichier manque dans Storage, le lit
   via `/api/documents/…` et l'envoie avec `cloudUploadDocumentAs` ;
5. **relit tout depuis le cloud et compare** (nombre d'études, égalité profonde de chacune, présence
   de chaque fichier) ; n'écrit `settings/migration` que si tout correspond ;
6. affiche une modale de progression puis le bilan (« N études, 2 archives, 1 document migrés et
   vérifiés ») avec l'URL web à mettre en favori, ou la liste précise des écarts + « Réessayer ».

La migration ne supprime **rien** localement. Elle doit tourner avant que le reste de l'app puisse
écrire dans `settings/*`.

**6. Nettoyage (après migration vérifiée seulement)**
Supprimer : `app.py`, `server.py`, `build.bat`, `spark.spec`, `requirements.txt`, `config.example.py`,
`Lancer.bat`, `update-and-run.bat`, `spark.ico`, `Spark/`, `build/`, `__pycache__/`, `Spark-*.zip`,
`geocache.json`, `tests/test_server_api.py`, `tests/__pycache__/`, `migration-locale.js` et son
chargement. Garder `functions/`, `firebase.json`, les règles, `VERSION`. Mettre à jour `firebase.json`
(entrées `ignore` devenues inutiles), `verify.bat` → script `npm run verify` sans étapes Python/build,
et corriger `npm test` (la boucle bash du `package.json` casse sous cmd.exe : utiliser un petit
`scripts/run-tests.mjs` en Node). Mettre à jour `CLAUDE.md` (l'app n'est plus un exe ; méthode de test
avec serveur statique) et `CODEBASE_MAP.md`. `config.py` est gitignoré : le laisser, l'utilisateur le
supprimera.
</conception_validee>

<deroulement>
Travaille en phases. **Arrête-toi et attends l'utilisateur aux points marqués STOP.**

**Phase 1 — Plan.** Utilise le skill `superpowers:writing-plans` pour produire le plan
d'implémentation à partir de ce document, puis STOP : l'utilisateur choisit le mode d'exécution.

**Phase 2 — Version web + module de migration.** Implémente les points 1 à 5 (sans le nettoyage).
Tests verts (voir `<verification>`). Commits atomiques sur une branche dédiée.

**Phase 3 — Exe de migration.** Monte `VERSION` en `1.0.24`, lance `build.bat`, vérifie que
`Spark/` contient bien tous les `.js` (dont `migration-locale.js` — piège déjà rencontré : le build
était vert mais des `.js` manquaient), puis STOP : indique à l'utilisateur de fermer Revit (ou son
plugin MCP, qui tient le port 8080), de lancer `Spark-1.0.24.exe` une fois, et de te rapporter le bilan.

**Phase 4 — Contrôle.** Une fois la migration annoncée réussie, lis toi-même `settings/migration` et
compte les documents `studies/` (via un script Node avec le SDK client, en demandant à l'utilisateur
de se connecter, ou en lui demandant une capture). STOP : l'utilisateur vérifie la version web servie
localement par un serveur statique.

**Phase 5 — Déploiement.** Sur accord explicite : `firebase deploy --only hosting` (functions et
règles inchangées). STOP : l'utilisateur vérifie sur l'URL Firebase, sur PC et iPhone.

**Phase 6 — Nettoyage.** Point 6. Puis, **seulement sur feu vert explicite**, proposer la suppression
de `%APPDATA%\pywebview`, `exports/`, `documents/`. Commit final ; ne pousse sur GitHub que si
l'utilisateur le demande.
</deroulement>

<verification>
- `calculs.js` n'est pas modifié ; toute la suite `tests/*.mjs` doit rester verte.
- Playwright (`tests/playwright/`, voir `factures-modal.mjs` comme référence) : servir la racine avec
  un serveur statique (`npx http-server -p 8090` ou `python -m http.server 8090`, **jamais sur 8080**),
  stubber `owned-cloud.js` **en exportant toutes ses fonctions** (un stub incomplet casse l'import du
  module sans erreur évidente) et simuler les nouvelles collections en mémoire. Scénarios, en viewport
  PC et iPhone (393×852) :
  - non connecté → écran de connexion sur `index.html` et `owned.html` ;
  - créer/modifier une étude, recharger → elle revient depuis le stub cloud ;
  - préférences (thème, écrans) conservées après rechargement ;
  - les 3 exports PDF déclenchent `window.print` (espionné) sur un document au bon titre ;
  - export JSON (téléchargement + archive) et import depuis un fichier ;
  - mode `?panel=analysis` synchronisé ;
  - **zéro accès `localStorage`/`sessionStorage`** sur toute la session (remplace les getters de
    `window.localStorage`/`sessionStorage` par un espion via `addInitScript` et fais échouer le test
    au moindre appel hors SDK Firebase) ;
  - aucune `pageerror`.
- Test dédié de `migration-locale.js` : `localStorage` pré-rempli + endpoints `/api/*` simulés via
  `page.route` → vérifier les écritures, la règle « le plus récent gagne », et qu'un écart à la
  relecture bloque l'écriture de `settings/migration`.
- Regarde réellement les captures d'écran (`FM_SCREENSHOTS`) : un diff relu ne suffit pas dans ce
  projet. Un `if (IS_MOBILE_PAGE) { …; return; }` préexistant a déjà fait sauter du code ajouté après
  lui sans que la relecture le voie.
</verification>

<contraintes>
- Aucune perte de données : en cas de doute sur une écriture qui pourrait écraser du cloud, n'écris pas
  et demande.
- Ne jamais tuer l'exe ni Revit de l'utilisateur. Si le port 8080 est occupé, ce n'est pas ton serveur.
- Tout texte visible en français ; tout contenu utilisateur injecté passe par `escapeHtml()`.
- Respecte le style existant (modules ES natifs sans bundler, template literals, commentaires en
  français, densité de commentaires équivalente). Pas de framework, pas de dépendance runtime nouvelle.
- Reste dans le périmètre : ne refonds ni l'ergonomie ni les performances (ce seront deux chantiers
  séparés, après celui-ci). Si tu croises un bug hors périmètre, note-le dans ton compte rendu sans le
  corriger.
- Coût : rester dans les quotas gratuits Firebase (le débounce de 1,5 s est là pour ça).
- Dans l'outil Bash de cet environnement, un heredoc contenant des apostrophes françaises plante :
  crée et modifie les fichiers avec Write/Edit.
- Pas de `firebase deploy`, de suppression de fichiers hors du dépôt ou de `git push` sans accord
  explicite de l'utilisateur à ce moment-là.
- Après chaque tâche qui modifie des fichiers, mets à jour `CODEBASE_MAP.md` pour les fichiers touchés.
</contraintes>

<compte_rendu>
À chaque STOP et en fin de chantier, rends compte en français et brièvement : ce qui est fait, ce qui a
été vérifié et comment (tests lancés, captures regardées), ce qui reste, et toute anomalie rencontrée.
Dis franchement si un test a échoué ou si une étape a été sautée.
</compte_rendu>
