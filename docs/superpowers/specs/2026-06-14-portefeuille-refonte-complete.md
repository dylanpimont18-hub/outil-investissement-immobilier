# Portefeuille — Refonte complète

**Date :** 2026-06-14  
**Priorités utilisateur :** A (suivi performance) > B (fiscal/comptable) > C (décision future)

---

## 1. Module Profil Financier — Crédits hors immo

**Où :** panneau dans le modal profil existant (`profileData`), nouvelle section "Crédits en cours".

**Données saisies par bien crédit :**
- `type` : enum `immo | auto | perso | autre`
- `label` : texte libre (ex: "Crédit auto Renault")
- `mensualite` : €/mois
- `moisRestants` : nombre entier

**Stockage :** `profileData.creditsHorsImmo` (array), persisté dans `localStorage`.

**Impact :** le calcul du taux d'endettement dans `computeEndettementGlobal` intègre la somme des mensualités hors-immo. La capacité résiduelle affichée dans le dashboard devient exacte.

---

## 2. Vue liste enrichie

### Donut chart par bien
- Mini donut SVG dans chaque ligne de la table (ou colonne dédiée)
- Segments : Recettes (loyers après vacance) vs Dépenses (crédit + charges + impôts)
- Anneau extérieur coloré : vert si CF net-net ≥ 0, rouge si négatif

### Sélecteur d'année global
- Sélecteur : Année 1 / 3 / 5 / 10
- Toutes les métriques de la liste (CF, Rdt, DSCR, statut) se recalculent sur l'année choisie via `computeOwnedAssetTimeline`
- Corrige le biais "année 1 surévalue la défiscalisation"

### Alerte régime
- Comparaison du CF net-net micro-foncier vs réel en année 5
- Si le régime optimal change → badge `⚠ Régime` sur la ligne du bien

---

## 3. Vue détail enrichie

### Décomposition CF (onglet Exploitation)
Cascade visuelle :
```
Loyer brut
- Vacance locative
= Loyers encaissés
- Charges (copro, gestion, assurance, taxe foncière)
- Mensualité crédit
- Impôts (régime actuel)
= CF net-net
```

### Comparatif régimes (onglet Projection)
Tableau : années 1 / 3 / 5 / 10 × régimes micro-foncier / réel / SCI-IS  
→ CF net-net par cellule + pastille "optimal" sur le meilleur par ligne.  
Alerte si régime optimal change entre année 1 et année 5 (durée minimale foncier réel = 3 ans).

### Verdict par année
Les 4 KPIs en haut (CF net, Rdt brut, DSCR, Effort épargne) lisent l'année du sélecteur global.

---

## 4. Import / Export — dossier projet

**Dossier :** `exports/` à côté du `.exe` (en dev : `./exports/` à la racine du projet).

**Export :**
- Appel `POST /api/portfolio/export` → Flask crée `exports/portefeuille-YYYY-MM-DD.json`
- Réponse : `{ path, filename }`
- Le bouton "↓ Export" appelle cette route au lieu du download client-side

**Import :**
- `GET /api/portfolio/import/list` → liste les `.json` dans `exports/`
- `POST /api/portfolio/import` avec `{ filename }` → lit le fichier, retourne le JSON
- UI : modal avec liste des fichiers disponibles + bouton "Charger"
- Fusion : les biens du fichier sont ajoutés (pas d'écrasement si `id` déjà présent)

---

## Fichiers impactés

| Fichier | Changement |
|---|---|
| `main.js` | Profil crédits hors-immo, sélecteur d'année, donut SVG, décomposition CF, comparatif régimes, modal import |
| `calculs.js` | `computeEndettementGlobal` prend `creditsHorsImmo`, helper `computeRegimeComparison(asset, tmi, years)` |
| `index.html` | Section crédits hors-immo dans modal profil, bouton Import |
| `server.py` | Routes `/api/portfolio/export` et `/api/portfolio/import/*` |
| `styles.css` | Donut SVG, cascade CF, table comparatif régimes |
