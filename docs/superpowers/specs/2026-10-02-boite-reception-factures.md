# Boîte de réception factures — dépôt sans choisir le bien, extraction IA, rattachement différé

## Contexte

Le Portefeuille sait déjà lire une facture par IA (`extraireFraisFacture`, `functions/index.js`) et pré-remplir un frais : zone de dépôt dans l'onglet « Frais & justificatifs » d'un bien (1 fichier, ou 2+ via `openTravauxBatchModal`), rail « Ajouter une facture » sur PC (`initOwnedQuickRail`) et bouton flottant 📄 sur iPhone (`initOwnedQuickFab`), ces deux derniers partageant `_wireQuickFactureForm`.

Trois limites constatées le 2026-10-02 :

1. **Il faut toujours choisir le bien avant de déposer** (sélecteur « Bien concerné » en tête du formulaire rapide, ou être déjà dans la fiche du bien). Impossible de photographier cinq factures d'affilée sur le téléphone et de trier plus tard.
2. **Rien n'est conservé tant que le formulaire n'est pas validé** : fermer la page perd le dépôt. Pas de passage iPhone → PC.
3. **Bug réel** : les trois flux factures (`owned-portfolio.js:2717`, `:3745`, `:3935`) envoient `file.type` tel quel à la Cloud Function, qui refuse `application/pdf` depuis le passage à Mammouth AI (2026-08-04, `ALLOWED_MIME_TYPES = ['image/jpeg','image/png']`). La conversion PDF→PNG côté client (`_pdfFirstPageToPngFile`) n'est utilisée que par l'import de dossier bien. Toute facture PDF déposée échoue donc silencieusement (« extraction impossible, remplis à la main »).

## Objectif

Un seul endroit, **l'onglet « Factures »** du Portefeuille (PC et iPhone), où déposer des factures — fichiers, photos ou un dossier entier — sans rien saisir. Chaque facture est stockée immédiatement, lue par l'IA (**fournisseur, résumé court, montant, date**, bien suggéré) et reste dans la boîte jusqu'à son rattachement à un bien, en un clic. La boîte est synchronisée entre appareils comme le reste du portefeuille.

Principe directeur demandé par l'utilisateur : **ultra simple et intuitif**. Conséquence : les deux formulaires rapides existants (rail PC, modale iPhone) disparaissent au profit de la boîte, pour ne laisser qu'une seule logique. La zone de dépôt **dans** la fiche d'un bien est conservée (le bien est déjà connu, la boîte n'apporterait rien).

## Hors périmètre

- Dossier Windows surveillé par l'application de bureau (ne couvre ni le web ni l'iPhone).
- Nouveau champ `fournisseur` sur le modèle `travail` : au rattachement, la description du frais devient `Fournisseur — résumé` (visible et éditable partout sans toucher aux rendus Travaux/PDF/rapport/Assistant). Un champ dédié n'est justifié que si un besoin de filtre par fournisseur apparaît.
- Lecture multi-pages d'un PDF (première page uniquement, comme l'import de dossier).
- Modification du quota IA (30 lectures image/heure/uid, décision de sécurité du 2026-09-22 inchangée).

## Parcours utilisateur

### Dépôt

- **PC** : glisser-déposer sur la zone en tête de l'onglet (fichiers **ou dossiers**, parcours récursif), ou bouton « Choisir des fichiers » (`multiple`), ou bouton « Choisir un dossier » (`webkitdirectory`, masqué sur iOS qui ne le supporte pas).
- **iPhone** : le bouton flottant 📄 (`#owned-quickfab`) ouvre **directement** le sélecteur natif (« Prendre une photo / Galerie / Parcourir », `accept="application/pdf,image/*"`, `multiple`) puis bascule sur l'onglet Factures. Plus de modale-formulaire.
- **Rail PC « Ajouter une facture »** : bascule sur l'onglet Factures et met la zone de dépôt en évidence (focus + léger surlignage 1 s). Le panneau inline `data-quickpanel="add-facture"` est supprimé.
- Formats : `.pdf`, `.jpg`, `.jpeg`, `.png` (filtrage par extension pour les dossiers, par MIME pour les fichiers isolés). Les autres sont ignorés avec un toast récapitulatif (« 3 fichiers ignorés : format non supporté »). Fichiers cachés (`.DS_Store`, préfixe `.`) ignorés silencieusement.
- Taille : 8 Mo max par fichier (`TRAVAUX_MAX_FILE_SIZE`, inchangé). Garde-fou : 50 fichiers max par dépôt, toast « Seuls les 50 premiers fichiers ont été pris ».

Dès le dépôt, chaque fichier apparaît comme une carte « Lecture… » **puis** est envoyé — pas d'attente avant feedback.

### Carte d'une facture

```
┌ Leroy Merlin ─────────────────────────────  1 240 € ──┐
│ Peinture + enduits salon                 12/09/2026   │
│ Bien : [ Rue des Lilas ▾ ] suggéré    [ Rattacher ]  🗑 │
└───────────────────────────────────────────────────────┘
```

- Ligne 1 : **fournisseur** (gras) · **montant** (droite, Plex Mono). Ligne 2 : **résumé court** · **date**. Ligne 3 : sélecteur **Bien** · bouton **Rattacher** · corbeille.
- Vignette : miniature de l'image (ou icône PDF) à gauche, cliquable → ouvre l'original dans un nouvel onglet (`getDownloadURL`).
- **Chaque valeur est éditable d'un clic** (fournisseur, résumé, montant, date, tag fiscal replié derrière un petit lien « déductible ▾ »). Enregistrement à la sortie du champ (`change`), synchronisé immédiatement.
- **Bien suggéré** par l'IA : pré-sélectionné avec badge « suggéré » (même code visuel que le badge « suggéré » du tag dans l'onglet Travaux). Le badge disparaît dès que l'utilisateur change la sélection.
- **Doublon probable** (`findSimilarTravail` sur le bien sélectionné, ±2 € / ±5 jours, ré-évalué à chaque changement de bien/montant/date) : bandeau d'avertissement non bloquant sur la carte, même convention visuelle que `.owned-batch-duplicate`.
- États :
  - `Lecture…` — extraction en cours (spinner texte, champs grisés mais pas vides si déjà saisis).
  - `À rattacher` — extraction faite (état normal, pas de libellé affiché).
  - `Quota IA atteint — réessaie dans une heure` + bouton **Relire** (erreur `resource-exhausted`).
  - `Lecture impossible — complète à la main` + bouton **Relire** (toute autre erreur, PDF non convertible compris).
  Dans tous les états d'erreur, la carte reste éditable et rattachable manuellement.

### Rattacher

- **Rattacher** (par carte) : exige bien + date + description + montant (sinon toast négatif, comme les formulaires existants). Si doublon signalé → `window.confirm` (même texte que le formulaire Travaux). Crée le frais sur le bien, déplace le justificatif, retire la carte. Toast « Frais ajouté à <nom du bien> ».
- **Tout rattacher (N)** (bouton sous la liste, visible dès 2 cartes éligibles) : traite en séquence toutes les cartes complètes **avec** un bien sélectionné et **sans** doublon signalé. N mis à jour en direct. Les cartes exclues (sans bien, incomplètes, doublon) restent dans la boîte — pas de confirmation en rafale.
- 🗑 : supprime la facture et son fichier, après `window.confirm` court (« Supprimer cette facture ? »). Pas de corbeille/annulation.

### Onglet et compteur

Bouton `data-tab="factures"` ajouté aux `.owned-list-tabs` d'`index.html` (après « Vue d'ensemble », avant « Impôt ») et d'`owned.html` (après « Vue d'ensemble »). Libellé « Factures » suivi d'une pastille compteur `.owned-tab__count` quand la boîte n'est pas vide. État vide : illustration légère + « Aucune facture en attente — dépose-en ci-dessus ».

## Modèle de données

### Firestore — `users/{uid}/factures/{id}`

```js
{
  createdAt: '2026-10-02T18:42:11.000Z',   // ISO, tri décroissant
  fichier: { filename, nomOrigine, mimeType, taille },  // filename = nom dans Storage
  statut: 'nouveau' | 'lu' | 'erreur',
  erreur: null | 'quota' | 'illisible',
  // Valeurs affichées/éditées (pré-remplies par l'IA, écrasées par l'utilisateur)
  fournisseur: '', description: '', montant: 0, date: '', tag: 'a-classifier',
  bienId: null,            // sélection courante (suggestion IA ou choix utilisateur)
  bienSuggere: false,      // true tant que bienId vient de l'IA et n'a pas été modifié
  confiance: 'basse'
}
```

Couvert par la règle Firestore existante (`/users/{uid}/{document=**}`), aucun changement de règles. Un document par facture (comme `ownedAssets`), écriture `setDoc(..., { merge: true })` pour les éditions champ par champ.

### Storage — `users/{uid}/documents/_inbox/{filename}`

Même schéma de nom que `cloudUploadDocument` (`${Date.now()}-${rand}${ext}`), même règle Storage existante. `_inbox` ne peut pas entrer en collision avec un id de bien (ids générés sans underscore initial).

### Rattachement = déplacement

Ordre, pour qu'un échec laisse toujours un état cohérent :

1. `getBlob(_inbox/filename)` → `uploadBytes(documents/{assetId}/{filename})` (même `filename`, conservé).
2. `addOwnedTravail(assetId, { date, description: 'Fournisseur — résumé', montant, tag, pdfFilename: filename, financeParCredit: false })`.
3. `deleteDoc(factures/{id})`.
4. `deleteObject(_inbox/filename)` — meilleur effort, erreur ignorée.

Échec en 1 → toast, rien n'a changé. Échec en 3 ou 4 → le frais existe, une carte orpheline peut rester : la corbeille la supprime (tolérable, rare).

Si `fournisseur` est vide, la description reste le résumé seul (pas de « — » orphelin).

## Extraction IA

### Pipeline client (partagé par les 4 flux)

Nouvelle fonction `prepareFactureImage(fileOrBlob, mimeType)` dans `utils.js` : PDF → `pdfFirstPageToPngFile` (déplacé de `owned-portfolio.js` vers `utils.js`, avec `loadPdfjs`), JPG/PNG → tel quel ; retourne `{ base64, mimeType }` prêt pour la Cloud Function. **Les deux flux conservés** (onglet Travaux 1 fichier — `handleFile` dans `renderOwnedTravauxTab` — et `openTravauxBatchModal`) l'adoptent, en plus de la boîte : correction du bug PDF. Le troisième flux fautif (`_wireQuickFactureForm`) est supprimé. L'original (PDF compris) reste le justificatif stocké ; seule la copie envoyée à l'IA est rasterisée.

`fileToBase64` et `runWithConcurrencyLimit` migrent aussi dans `utils.js` (génériques, sans `state`/`nodes`), exportés sans underscore ; `owned-portfolio.js` les importe.

### Déclenchement et auto-réparation

- L'appareil qui dépose lance l'extraction juste après l'upload (concurrence 3 via `runWithConcurrencyLimit`), à partir du `File` encore en mémoire.
- À chaque snapshot Firestore, toute facture `statut === 'nouveau'` âgée de plus de 90 s et absente de l'ensemble local « en cours » est reprise par l'appareil courant : téléchargement du fichier (`getBlob`), conversion si PDF, extraction. Couvre la page fermée en pleine lecture. L'ensemble « en cours » (module-level `Set` d'ids) évite le double envoi sur un même appareil ; deux appareils ouverts simultanément peuvent, rarement, lire deux fois la même facture — coût accepté (une lecture de quota), résultat identique.
- Bouton **Relire** : remet `statut: 'nouveau'`, `erreur: null`, relance immédiatement.

### Cloud Function `extraireFraisFacture` (étendue, rétrocompatible)

Entrée : `{ base64, mimeType, biens?: [{ id, label }] }`. `biens` optionnel, nettoyé côté serveur : tableau de 30 entrées max, `id` chaîne ≤ 64 caractères, `label` chaîne ≤ 160 caractères (le client y concatène `nom · adresse · code postal ville`). Tout élément mal formé est ignoré.

Prompt système complété :

- `"fournisseur"` : nom de l'entreprise émettrice de la facture, `""` si illisible.
- `"description"` : résumé **très court** de la prestation (3 à 8 mots), **sans** répéter le fournisseur.
- `"bienId"` : si la liste des biens est fournie et que l'adresse d'intervention/livraison/facturation correspond clairement à l'un d'eux, son `id` ; sinon `null`. Ne jamais deviner sur la seule ville.

La liste est injectée dans le message utilisateur (« Biens du portefeuille : - id … : label »). Sortie nettoyée comme aujourd'hui, avec en plus : `fournisseur` (chaîne, 120 caractères max), `bienId` conservé **uniquement** s'il figure dans les ids envoyés, sinon `null`. Appelants existants sans `biens` : réponse identique à avant, plus `fournisseur` et `bienId: null`.

Quota, taille, auth, User-Agent : inchangés (`_validateImageInput`, bucket image partagé 30/h).

## Architecture

### Nouveau module `owned-factures.js`

`owned-portfolio.js` dépasse 5 000 lignes ; la boîte vit dans son propre fichier, sur le même modèle d'injection que `initOwnedPortfolio(deps)` pour éviter l'import circulaire :

```js
initOwnedFactures({
  state, nodes, IS_MOBILE_PAGE,
  getOwnedAsset, listOwnedAssets, addOwnedTravail, findSimilarTravail,
  showOwnedListView,              // retour à la vue liste (depuis une fiche bien, cas du FAB iPhone)
  onCountChange                   // rafraîchit la pastille de l'onglet
})
```

Exporte : `initOwnedFactures(deps)`, `renderOwnedFacturesTab()`, `addFilesToInbox(files)`, `openOwnedFacturesTab()`, `startFacturesSync()` / `stopFacturesSync()` (appelés par `_initCloudSync` d'`owned-portfolio.js` dans la même branche que `watchOwnedAssets`/`watchPortfolioMeta`).

Importe directement `owned-cloud.js` (nouvelles fonctions ci-dessous) et `utils.js`.

### `owned-cloud.js` — ajouts

- `watchFactures(onChange, onError)` — `onSnapshot` sur la collection, renvoie `{ id → data }`.
- `cloudSetFacture(id, patch)` — `setDoc(..., { merge: true })`.
- `cloudDeleteFacture(id)`.
- `cloudUploadInboxFile(file)` → `filename` ; `cloudInboxFileUrl(filename)` ; `cloudInboxFileBlob(filename)` (`getBlob`, SDK 12.16) ; `cloudDeleteInboxFile(filename)` ; `cloudMoveInboxFileToAsset(filename, assetId)` (étapes 1 et 4 du rattachement).
- `cloudExtraireFraisFacture(base64, mimeType, biens = null)` — troisième argument transmis à la callable.

### Rendu et édition en place

`renderOwnedFacturesTab()` injecte les cartes par `innerHTML` dans `#owned-factures-content` (tri `createdAt` décroissant, `escapeHtml` sur toute donnée). **Garde-fou édition** : si `document.activeElement` est un champ de la boîte, le re-rendu déclenché par un snapshot est différé jusqu'au `blur` de ce champ (sinon la saisie serait perdue à chaque synchro). Les éditions écrivent en `change`, pas en `input`.

Les miniatures image utilisent `cloudInboxFileUrl` résolu paresseusement après rendu (`IntersectionObserver` inutile : rarement plus d'une dizaine de cartes ; simple `Promise.all` après `innerHTML`, `src` posé quand l'URL arrive). PDF → icône statique.

### Parcours récursif d'un dossier déposé

`collectDroppedFiles(dataTransfer)` dans `owned-factures.js` : pour chaque `DataTransferItem`, `webkitGetAsEntry()` ; fichier → `entry.file()`, dossier → `createReader().readEntries` **en boucle jusqu'à un lot vide** (le navigateur rend par paquets de 100). Repli sur `dataTransfer.files` si `webkitGetAsEntry` est absent. Filtrage par extension, exclusion des noms commençant par `.`.

### Suppression du formulaire rapide

- `owned-portfolio.js` : suppression de `_populateQuickAssetSelect`, `_refreshAfterQuickFacture`, `_wireQuickFactureForm`. `initOwnedQuickRail` : l'action `add-facture` appelle `openOwnedFacturesTab()`. `initOwnedQuickFab` : clic → `input[type=file]` caché → `addFilesToInbox` + `openOwnedFacturesTab`.
- `index.html` : panneau `data-quickpanel="add-facture"` retiré (le bouton reste). `owned.html` : `#owned-quickfab-modal` retiré, `<input type="file" id="owned-quickfab-input" multiple accept="application/pdf,image/*" hidden>` ajouté.
- `styles.css` : nettoyage des règles devenues orphelines, ajout des classes `.owned-inbox*` (dropzone pleine largeur réutilisant les tokens de `.owned-travaux-dropzone`, carte, pastille compteur, états). Mobile : cartes empilées, sélecteur et bouton Rattacher pleine largeur, cibles tactiles ≥ 44 px (règle `@media`, pas `.shell--owned`).

### `CODEBASE_MAP.md`

Nouvelle entrée `owned-factures.js`, mises à jour `owned-cloud.js`, `utils.js`, `owned-portfolio.js` (fonctions supprimées / déplacées), `functions/index.js`, `index.html`, `owned.html`, `styles.css`.

## Gestion des erreurs

| Situation | Comportement |
|---|---|
| Upload Storage échoue | Toast négatif par fichier, aucune carte créée |
| Fichier > 8 Mo | Ignoré avec toast récapitulatif |
| Conversion PDF impossible | Carte `erreur: 'illisible'`, fichier bien stocké, édition manuelle |
| Quota IA (`resource-exhausted`) | Carte `erreur: 'quota'`, message dédié, bouton Relire |
| Autre erreur IA / réseau | Carte `erreur: 'illisible'`, bouton Relire |
| Bien supprimé entre temps | Sélecteur revient à « Choisir… », `bienId` remis à `null` au prochain rendu |
| Perte de connexion | Firestore met en file les écritures (comportement SDK existant), toast de `watchFactures` identique à celui de `watchOwnedAssets` |
| Rattachement : upload copie échoue | Toast, carte intacte |

## Vérification

- `npm test` (aucune modification de `calculs.js`, suite doit rester verte — `build.bat` l'exige).
- `node -e "require('./functions/index.js')"` puis `firebase deploy --only functions` (validation + mise en prod de la fonction étendue).
- **Playwright**, serveur `python server.py`, stub `owned-cloud.js` enrichi des nouvelles fonctions (`watchFactures` alimenté par un tableau en mémoire que `cloudSetFacture`/`cloudDeleteFacture` mutent et re-notifient ; `cloudExtraireFraisFacture` renvoyant une réponse fixe après 50 ms, ou rejetant avec `code: 'functions/resource-exhausted'` selon un drapeau) :
  - PC `index.html` : dépôt de 3 fichiers (dont 1 PDF généré) → 3 cartes « Lecture… » → valeurs remplies, bien suggéré pré-sélectionné ; édition du montant → persisté ; rattacher une carte → frais présent dans l'onglet Travaux du bien avec `pdfFilename` ; doublon signalé sur la seconde ; « Tout rattacher » n'en prend que les éligibles ; corbeille ; erreur quota → message + Relire.
  - iPhone `owned.html` (393×852) : FAB ouvre l'input (vérifier l'événement `click` sur l'input), cartes lisibles sans débordement horizontal, boutons ≥ 44 px, bascule d'onglet depuis une fiche bien.
  - `page.on('pageerror')` / `console` vides sur les deux.
  - Non-régression : onglet Travaux d'un bien, dépôt d'un PDF → extraction appelée avec `image/png`.
- Test réel après déploiement : l'utilisateur dépose une vraie facture (PDF et photo) — seule validation possible du prompt étendu (`fournisseur`, `bienId`).

## Livraison

1. Commit de la spec, puis commit(s) de la fonctionnalité (`VERSION` déjà à 1.0.17 en attente, inclus).
2. `git push` (demandé explicitement).
3. `firebase deploy --only functions,hosting`.
4. `update-and-run.bat` → rebuild de l'exe Windows (auto-bump → 1.0.18), vérifier `ls Spark/*.js` contient `owned-factures.js` (piège connu des fichiers statiques, `build.bat` copie `*.js` depuis 2026-07-27).
