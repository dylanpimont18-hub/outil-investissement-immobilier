# Factures décortiquées par corps d'état — conception

Date : 2026-10-27 · Statut : relu (builder check), à valider par l'utilisateur

## 1. Intention

Aujourd'hui une facture de travaux est une seule ligne dans l'onglet Travaux d'un bien (date,
description, montant TTC, nature fiscale, justificatif). L'utilisateur veut **voir le détail de
ses factures, corps d'état par corps d'état** : pour l'électricité, la gaine, le fil, les
interrupteurs… avec quantités et prix, et le total de chaque corps d'état sur le bien.

But : savoir où est parti l'argent des travaux d'un bien, et en quoi. C'est une **vue de
lecture analytique**, pas un outil fiscal.

## 2. Décisions de l'utilisateur

1. **Granularité : chaque article** de chaque facture (désignation, quantité, prix unitaire,
   total), extrait par l'IA.
2. **Périmètre : par bien** (pas de vue consolidée portefeuille).
3. **Factures déjà enregistrées : ré-analysées** pour être décortiquées, pas seulement les
   nouvelles.
4. **Emplacement : sous-vue de l'onglet Travaux** (bascule « Liste des frais » / « Par corps
   d'état »).
5. **Correction manuelle** : l'utilisateur peut changer le corps d'état d'un article mal classé.
6. **Mise en page retenue : « C »** (maquette du brainstorming) — un seul grand tableau de tous
   les articles du bien, regroupés sous un en-tête par corps d'état (nom + total), avec des
   pastilles de filtre en haut (« Tous », puis une par corps d'état présent).
7. **Main-d'œuvre** : rangée dans le corps d'état concerné (« pose des prises » → Électricité),
   avec une étiquette « MO » sur la ligne (pas de groupe « Main-d'œuvre » séparé).
8. **Liste des corps d'état** : liste fixe ci-dessous, mais l'IA peut en proposer un autre si
   aucun ne convient vraiment.
   Électricité · Plomberie / sanitaires · Chauffage / ventilation · Plâtrerie / isolation ·
   Peinture / murs · Sols (carrelage, parquet) · Menuiserie (portes, fenêtres) · Cuisine /
   électroménager · Maçonnerie / gros œuvre · Toiture · Outillage / consommables · Divers
9. **Plafond d'appels IA relevé** (actuellement 30/heure, partagé entre `extraireFraisFacture`
   et `extraireDossierBien`).
10. **Écart articles / montant de la facture : option « b »**. Les prix des articles restent
    ceux imprimés sur la facture (HT ou TTC selon la facture, mélange accepté dans un même corps
    d'état). Chaque facture dont la somme des articles diffère de son montant reçoit une ligne
    « Écart (TVA / remise) » égale à la différence, pour que le total de la vue égale le total
    des frais du bien. Pas de répartition au prorata.
11. **Décorticage automatique à chaque nouvel ajout** de facture avec justificatif (en plus du
    bouton pour les factures existantes).
12. **Une même facture couvre souvent plusieurs corps d'état** : ses articles se répartissent
    dans plusieurs groupes (le tableau regroupe par article, pas par facture).

## 3. Suppositions validées par l'utilisateur (« Parfait »)

- La vue **ne modifie aucun calcul** (cash-flow, impôts, 2044, rapports). La nature fiscale reste
  portée par le frais entier, comme aujourd'hui.
- Les frais **sans justificatif** ne peuvent pas être décortiqués : ils apparaissent dans un
  groupe « Non détaillé » (une ligne par frais, montant du frais), pour que le total de la vue
  égale le total des frais du bien.
- La ré-analyse des anciennes factures se lance **par un bouton**, jamais automatiquement
  (règle du projet : aucune écriture cloud sans action utilisateur ; et l'IA coûte).
- Si la somme des articles d'une facture diffère de son montant (TVA, remise, port, lecture
  partielle), **l'écart est affiché**, pas masqué.

## 4. Non-objectifs / anti-objectifs

- Pas de vue consolidée multi-biens.
- Pas d'impact fiscal ni de ventilation de la nature fiscale par article.
- Pas d'édition des articles eux-mêmes (désignation, quantité, prix) dans cette version : seule
  la **reclassification du corps d'état** est demandée. (Appel du concepteur, voir §8.)
- Anti-objectif : que le décorticage change silencieusement le montant d'un frais existant, ou
  qu'une ré-analyse écrase une correction manuelle de l'utilisateur.
- Anti-objectif : des doublons de corps d'état (« Élec », « Électricité », « Électricien »).

## 5. Existant à connaître

- Frais : `asset.postAchat.travaux[]` (`id, date, description, montant, tag, commentaire,
  pdfFilename, credit, financeParCredit`), CRUD dans `owned-portfolio.js`
  (`addOwnedTravail` liste ses champs explicitement : `detail` doit y être ajouté ;
  `updateOwnedTravail` part de `...current`, donc `detail` survit à une modification — mais
  quand la modale d'édition remplace ou retire le justificatif, `detail` doit être remis à zéro).
- Stockage : un document Firestore par bien (`users/{uid}/ownedAssets/{id}`, limite 1 Mio par
  document). Justificatifs dans Storage `users/{uid}/documents/{assetId}/{pdfFilename}`, URL via
  `cloudDocumentUrl` ; lecture des octets par `fetch` (CORS du bucket réglé le 2026-10-23,
  voir `factures-pdf.js` / impression groupée pour le chargement existant).
- Rendu de l'onglet : `renderOwnedTravauxTab(asset)` (`owned-portfolio.js`).
- Extraction IA : Cloud Function `extraireFraisFacture` (`functions/index.js`), Mammouth AI
  (`gpt-4o`), **images JPG/PNG uniquement**, une image par appel. Côté client les PDF sont
  rasterisés **en première page seulement** (`_pdfFirstPageToPngFile`, `_prepareFactureImage`).
  Limite 5 Mo base64 par appel. Concurrence client plafonnée à 3 (`_runWithConcurrencyLimit`).
- Plafond : `RATE_LIMIT_MAX_CALLS = 30` par heure et par uid, fenêtre glissante en mémoire.
- Ajout de factures : modale globale `openAjoutFacturesModal` (PC et iPhone), formulaire et zone
  de dépôt de l'onglet Travaux, import de dossier (`_extractDossierTravaux`).
- Tests : unitaires purs `tests/*.mjs` ; Playwright `tests/playwright/*` avec stubs
  `owned-cloud.js` (le stub doit exporter **toutes** les fonctions du module réel).

## 6. Conception

### 6.1 Données

Chaque frais gagne un champ optionnel, par exemple :

```
detail: {
  statut: 'ok' | 'partiel' | 'echec',
  analyseLe: 'AAAA-MM-JJ',
  pages: <nombre de pages lues>,
  articles: [
    { d: 'Gaine ICTA Ø20 100 m', q: 2, pu: 38, t: 76, ce: 'electricite', mo: false, ceManuel: false }
  ]
}
```

- `ce` : clé du corps d'état (liste fixe) ou libellé libre proposé par l'IA (normalisé : trim,
  casse de phrase ; une proposition qui correspond, sans accents ni casse, à un corps d'état
  existant est rabattue sur celui-ci).
- `ceManuel: true` quand l'utilisateur a reclassé : une ré-analyse conserve ces corrections
  (rapprochement par désignation normalisée ; à défaut, la correction est perdue mais l'article
  reste visible).
- Clés courtes pour limiter la taille du document Firestore. Ordre de grandeur : 50 factures ×
  30 articles × ~120 octets ≈ 180 Ko, sous la limite de 1 Mio.
- `addOwnedTravail` et `updateOwnedTravail` doivent transporter `detail`.
- Les montants des articles sont ceux de la facture (TTC si la facture donne du TTC par ligne,
  sinon HT). Le total affiché d'un corps d'état est la somme des `t`. L'écart entre la somme des
  articles d'un frais et son `montant` est calculé à l'affichage (décision 10), jamais stocké.
- Un même justificatif (`pdfFilename`) rattaché à plusieurs frais (acompte + solde, par
  exemple) : *choix de Claude* — il est décortiqué une seule fois et ses articles n'apparaissent
  qu'une fois ; l'écart se calcule alors contre la somme des montants des frais qui le
  partagent. Hypothèse : cas rare, l'utilisateur n'a pas signalé ce cas.

### 6.2 Extraction IA

- Nouvelle Cloud Function (ex. `decortiquerFacture`) ou extension de `extraireFraisFacture` :
  **au choix du concepteur**, mais l'ajout de facture existant ne doit pas devenir plus lent ou
  plus fragile. Recommandation : fonction séparée, qui accepte **plusieurs images** (une par
  page) dans un seul appel, et renvoie `{ articles: [...], confiance }`.
- Prompt : liste fixe des corps d'état fournie avec leurs clés ; consigne d'utiliser la liste en
  priorité et de ne proposer un nouveau libellé que si aucun ne convient ; main-d'œuvre rangée
  dans le corps d'état concerné avec `mo: true` ; une ligne par article, montants numériques.
- Validation serveur des sorties (types, bornes, longueur des désignations, nombre maximal
  d'articles) comme les fonctions existantes.
- **Toutes les pages** d'un PDF sont rasterisées (nouvelle fonction côté client à côté de
  `_pdfFirstPageToPngFile`), avec un plafond de pages raisonnable et le respect de la limite de
  taille par appel (réduire l'échelle ou découper en plusieurs appels si besoin). Si des pages
  n'ont pas pu être lues, `statut: 'partiel'`.
- Plafond d'appels : passer de 30 à **100 par heure** (choix du concepteur, l'utilisateur a
  demandé de relever le plafond sans chiffre). Le plafond reste partagé avec
  `extraireFraisFacture` / `extraireDossierBien`, ou une Map dédiée : au choix du concepteur.

### 6.3 Quand décortiquer

- **Nouvelles factures** : après l'enregistrement d'un frais avec justificatif (modale globale,
  onglet Travaux, import de dossier), le décorticage tourne en arrière-plan et met à jour
  `detail` du frais. Un échec n'empêche jamais l'enregistrement du frais (statut `echec`,
  réessayable).
- **Factures existantes** : bouton « Décortiquer les factures » dans la sous-vue « Par corps
  d'état », qui traite les frais du bien ayant un justificatif et pas encore de `detail` (ou en
  `echec`). Progression visible (« 7 / 23 »), concurrence 3, arrêt propre sur
  `resource-exhausted` avec un message clair (« reprends plus tard, les factures déjà traitées
  sont gardées »). Chaque frais traité est enregistré au fil de l'eau.
- Relancer l'analyse d'**une** facture (ex. résultat mauvais) : action par facture, qui
  conserve les reclassements manuels (§6.1).

### 6.4 Interface (sous-vue de l'onglet Travaux)

- Bascule en haut de l'onglet : « Liste des frais » (vue actuelle, inchangée) / « Par corps
  d'état ».
- Vue « Par corps d'état », mise en page C :
  - Pastilles de filtre : « Tous » + une par corps d'état présent (ordre : montant décroissant).
  - Tableau : pour chaque corps d'état, une ligne d'en-tête (nom, total, nombre d'articles), puis
    ses articles : désignation (+ étiquette « MO »), quantité, prix unitaire, total, facture
    d'origine (fournisseur/description + date ; clic = ouvrir le justificatif comme le bouton 📄
    existant), et un menu pour **changer le corps d'état** (liste fixe + corps d'état libres déjà
    présents sur le bien). Le changement est enregistré immédiatement (action utilisateur).
  - Groupe « Non détaillé » en fin de tableau : frais sans justificatif, ou pas encore
    décortiqués, ou en échec (avec la raison et un bouton pour relancer quand c'est possible).
  - Écart par facture (décision 10) : si |somme des articles − montant du frais| dépasse un
    seuil (à fixer par le concepteur, ex. 1 €), un groupe « Écart (TVA / remise) » en fin de
    tableau contient une ligne par facture concernée (facture d'origine, montant de l'écart,
    positif ou négatif). Ce groupe a sa pastille de filtre comme les autres.
  - Total général de la vue = total des frais du bien.
- iPhone (`owned.html`, `IS_MOBILE_PAGE`) : la sous-vue doit exister aussi (vue par bien,
  l'onglet Travaux y est présent). *Choix de Claude* : sur iPhone, consultation + reclassement ;
  le bouton « Décortiquer les factures » et la relance par facture sont réservés au PC (comme
  l'import de dossier) ; le décorticage automatique d'une facture ajoutée depuis l'iPhone tourne
  quand même (décision 11), mais une page à la fois, sans concurrence, avec un plafond de pages
  plus bas (mémoire de l'iPhone) ; une facture qui dépasse ce plafond reste « Non détaillé — à
  décortiquer depuis le PC ». Tableau adapté à 393 px (pas de défilement horizontal de la
  page ; lignes sur deux rangées comme `.owned-travaux-row` sur mobile). **Attention au piège
  connu** : un `if (IS_MOBILE_PAGE) { …; return; }` préexistant peut sauter le code ajouté après
  lui — vérifier dans le navigateur.
- Charte : `styles.css`, accent or, chiffres en IBM Plex Mono, pas d'emoji décoratifs nouveaux
  (cohérence avec le nettoyage du 2026-08-05), thèmes clair et sombre.
- Tout texte utilisateur passé par `escapeHtml()`.

## 7. Contraintes

- Aucun `localStorage`/`sessionStorage`.
- Aucune écriture cloud au chargement ; écritures seulement sur action (enregistrement d'un frais,
  bouton de décorticage, reclassement).
- Logique pure (regroupement par corps d'état, totaux, écarts, normalisation des libellés,
  fusion des reclassements manuels lors d'une ré-analyse) dans un module pur testable par
  `tests/*.mjs` (`calculs.js` ou un nouveau module, au choix du concepteur), sans DOM.
- Tests : unitaires pour la logique pure ; Playwright (stub d'extraction) pour la sous-vue PC et
  iPhone, le reclassement, le bouton de décorticage et l'arrêt sur plafond atteint.
- Déploiement : `firebase deploy --only functions` puis `--only hosting` (sur demande de
  l'utilisateur), montée de `VERSION`, mise à jour de `CODEBASE_MAP.md`.

## 8. Choix laissés au concepteur (ou faits par Claude, marqués comme tels)

- *Choix de Claude* : plafond à 100 appels/heure.
- *Choix de Claude* : pas d'édition des articles (désignation/quantité/prix) en v1.
- *Choix de Claude* : justificatif partagé par plusieurs frais décortiqué une seule fois (§6.1).
- *Choix de Claude* : iPhone en consultation + reclassement, décorticage auto allégé (§6.4).
- *Choix de Claude* : `detail` remis à zéro quand le justificatif d'un frais est remplacé ou retiré.
- Le résultat du décorticage en arrière-plan doit être fusionné dans l'état courant du bien au
  moment de l'écriture (l'utilisateur a pu modifier le bien entre-temps).
- Fonction séparée ou extension de `extraireFraisFacture`, plafond partagé ou séparé.
- Forme exacte du champ `detail`, seuil d'écart, emplacement de l'indication d'écart.
- Plafond du nombre de pages par facture et stratégie de découpage si la taille dépasse 5 Mo.
