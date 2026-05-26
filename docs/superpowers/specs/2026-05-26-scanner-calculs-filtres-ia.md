# Spec — Scanner : corrections calculs, prompt IA, filtres complets

**Date :** 2026-05-26  
**Périmètre :** `scanner/calculs.py`, `scanner/scanner.py`, `scanner/ai_enrichir.py`, `index.html`, `scanner.js`

---

## Contexte

Le scanner Spark.exe analyse des annonces LeBonCoin et calcule leur rentabilité. Trois problèmes ont été identifiés :

1. Le calcul fiscal micro-foncier oublie les prélèvements sociaux (CSG/CRDS 17,2 %).
2. Le dict `stats` dans `scanner.py` ne calcule pas `meilleur_cf_apres_impot` ni `score_moyen`, pourtant attendus dans `scanner.js`.
3. Le score est plafonné à 80/100 par construction (3 composantes → 80 pts max).
4. Le prompt IA manque de champs utiles (nb pièces, meublé, loyer actuel, parking, chauffage).
5. Les filtres ne couvrent pas les critères numériques (prix, surface, renta, CF, DSCR, score).

---

## Approche retenue

**Couche 1 → Couche 2 → Couche 3** : bugs critiques d'abord, enrichissement IA ensuite, filtres en dernier. Chaque couche est indépendante et testable.

---

## Couche 1 — Corrections critiques

### 1.1 Bug fiscal CSG/CRDS — `scanner/calculs.py:92`

**Actuel (faux) :**
```python
impot_mensuel = loyer * 0.70 * (TMI / 100)
```

**Corrigé :**
```python
# Micro-foncier : 70 % imposable × (TMI + prélèvements sociaux 17,2 %)
impot_mensuel = loyer * 0.70 * (TMI / 100 + 0.172)
```

Impact : avec TMI 30 %, l'impôt réel passe de 21 % à 32,74 % du loyer brut.  
`cf_apres_impot` et `renta_nette_nette` se recalculent automatiquement depuis cette valeur.

### 1.2 Score sur 100 réel — `scanner/calculs.py:26-40`

Ajout d'une 4e composante **prix au m²** (20 pts) pour porter le total à 100 pts max :

```python
# Prix au m² (20 pts) — calibré marché Vierzon / petites villes
if surface and surface > 0:
    prix_m2 = prix / surface
    if prix_m2 < 800:
        pm2_score = 20.0
    elif prix_m2 < 1200:
        pm2_score = 15.0
    elif prix_m2 < 1800:
        pm2_score = 10.0
    elif prix_m2 < 2500:
        pm2_score = 5.0
    else:
        pm2_score = 0.0
else:
    pm2_score = 0.0
```

Nouveau total max : `30 + 25 + 25 + 20 = 100`.  
La signature de `_score()` reçoit `prix` et `surface` en plus des paramètres actuels.

### 1.3 Stats manquantes — `scanner/scanner.py:131-140`

Ajout dans le dict `stats` :

```python
"meilleur_cf_apres_impot": max(r["cf_apres_impot"] for r in resultats if r.get("cf_apres_impot") is not None),
"score_moyen": round(sum(r["score"] for r in resultats if r.get("score") is not None) / max(1, sum(1 for r in resultats if r.get("score") is not None))),
```

Ces deux valeurs sont déjà référencées dans `scanner.js:173-186` mais jamais renseignées.

---

## Couche 2 — Prompt IA enrichi

### 2.1 Nouveaux champs JSON — `scanner/ai_enrichir.py:21-47`

Ajout de 5 champs dans le JSON attendu par Claude Haiku :

```json
"nb_pieces": <nombre entier ou null>,
"meuble": <true|false|null>,
"loyer_actuel": <nombre euros/mois si déjà loué et mentionné, sinon null>,
"parking_garage": <true|false>,
"chauffage": "<electrique|gaz|fioul|pompe_chaleur|poele|autre|null>"
```

Le prompt doit préciser que `loyer_actuel` ne doit être renseigné que si le montant est explicitement mentionné dans l'annonce, pas estimé.

### 2.2 Exploitation dans `scanner/ai_enrichir.py:85-116`

```python
result["nb_pieces"] = data.get("nb_pieces")
result["meuble"] = data.get("meuble")  # None = inconnu
result["loyer_actuel"] = data.get("loyer_actuel")
result["parking_garage"] = bool(data.get("parking_garage"))
result["chauffage"] = data.get("chauffage")
```

### 2.3 Priorité loyer actuel — `scanner/calculs.py:63-69`

Si le bien est déjà loué et que `loyer_actuel` est renseigné, on l'utilise à la place de l'estimation marché :

```python
if annonce.get("loyer_actuel") and annonce.get("deja_loue"):
    loyer = float(annonce["loyer_actuel"])
    annonce["loyer_source"] = "annonce"
elif loyer_marche:
    loyer = float(loyer_marche)
    annonce["loyer_source"] = "marche"
else:
    loyer = _loyer_fallback(surface, type_bien)
    annonce["loyer_source"] = "taux_fixe"
```

### 2.4 Badges dans le tableau — `scanner.js:414-431`

Ajout de badges :
- Parking/garage : badge bleu `Parking ✓`
- Meublé : badge violet `Meublé`
- Chauffage électrique : badge orange `Chauf. élec.` (signal négatif pour les locataires)
- Loyer source `annonce` : indicateur vert `loyer annonce` (plus fiable que marché)

---

## Couche 3 — Filtres complets

### 3.1 Nouvelles chips — `index.html`

**Cash-flow (extension) :**
```html
<label class="scanner-chip"><input type="checkbox" id="filter-cfai-positif"><span>CF après impôt positif</span></label>
```

**DPE (extension) :**
```html
<label class="scanner-chip"><input type="checkbox" id="filter-dpe-safe"><span>Sans risque DPE</span></label>
```
→ Exclut les biens DPE E, F, G (équivalent à cocher A+B+C+D).

**État (extension) :**
```html
<label class="scanner-chip"><input type="checkbox" id="filter-sans-travaux"><span>Sans travaux</span></label>
<label class="scanner-chip"><input type="checkbox" id="filter-meuble"><span>Meublé</span></label>
```

**Source loyer (nouvelle section) :**
```html
<label class="scanner-chip"><input type="checkbox" id="filter-loyer-marche"><span>Loyer marché réel</span></label>
<label class="scanner-chip"><input type="checkbox" id="filter-loyer-annonce"><span>Loyer issu annonce</span></label>
```

### 3.2 Filtres numériques (sliders + inputs) — `index.html`

Nouvelle section `scanner-filter-ranges` sous les chips. Chaque critère : un slider `<input type="range">` double-poignet (simulé avec 2 ranges superposés pour min/max) ou simple, plus deux `<input type="number">` synchronisés.

| ID slider | Critère | Type | Unité | Valeur par défaut |
|---|---|---|---|---|
| `range-prix` | Prix | double (min/max) | € | 0 – max annonces |
| `range-surface` | Surface | double (min/max) | m² | 0 – max annonces |
| `range-renta` | Renta brute min | simple | % | 0 |
| `range-cf` | CF net min | simple | €/mois | min annonces |
| `range-dscr` | DSCR min | simple | — | 0 |
| `range-score` | Score min | simple | /100 | 0 |

Structure HTML d'un filtre numérique double :
```html
<div class="scanner-range-group">
  <span class="scanner-filter-title">Prix (€)</span>
  <div class="scanner-range-row">
    <input type="number" id="prix-min" class="scanner-range-input" placeholder="Min">
    <input type="range" id="range-prix-min" class="scanner-range-slider">
    <input type="range" id="range-prix-max" class="scanner-range-slider">
    <input type="number" id="prix-max" class="scanner-range-input" placeholder="Max">
  </div>
</div>
```

Structure HTML d'un filtre numérique simple (min uniquement) :
```html
<div class="scanner-range-group">
  <span class="scanner-filter-title">Renta brute min (%)</span>
  <div class="scanner-range-row">
    <input type="range" id="range-renta" min="0" max="20" step="0.5" value="0" class="scanner-range-slider">
    <input type="number" id="renta-min" class="scanner-range-input" placeholder="0" step="0.5">
    <span class="scanner-range-unit">%</span>
  </div>
</div>
```

### 3.3 Initialisation des sliders — `scanner.js`

Fonction `_initRangeFilters(resultats)` appelée une fois après chargement des résultats :
- Calcule les bornes réelles (min/max) depuis `_allResultats`
- Initialise les attributs `min`, `max`, `value` de chaque slider
- Bind les événements `input` pour synchroniser slider ↔ input number ↔ `_applyTable()`

### 3.4 Extension `_matchFilters` — `scanner.js`

```javascript
// CF après impôt positif
if (document.getElementById('filter-cfai-positif')?.checked && (r.cf_apres_impot == null || r.cf_apres_impot < 0)) return false;

// DPE sans risque (exclut e, f, g)
if (document.getElementById('filter-dpe-safe')?.checked && ['e','f','g'].includes((r.dpe||'').toLowerCase())) return false;

// Sans travaux
if (document.getElementById('filter-sans-travaux')?.checked && r.travaux) return false;

// Meublé
if (document.getElementById('filter-meuble')?.checked && r.meuble !== true) return false;

// Source loyer
if (document.getElementById('filter-loyer-marche')?.checked && r.loyer_source !== 'marche') return false;
if (document.getElementById('filter-loyer-annonce')?.checked && r.loyer_source !== 'annonce') return false;

// Filtres numériques
const prixMin = parseFloat(document.getElementById('prix-min')?.value) || 0;
const prixMax = parseFloat(document.getElementById('prix-max')?.value) || Infinity;
if (r.prix < prixMin || r.prix > prixMax) return false;
// ... idem surface, renta, cf, dscr, score
```

---

## CSS — `styles.css`

Nouvelles classes :
- `.scanner-range-group` — groupe label + contrôles
- `.scanner-range-row` — flexbox alignant slider(s) et input(s)
- `.scanner-range-input` — input number compact (80px, style cohérent avec les chips)
- `.scanner-range-slider` — range custom (couleur accent `#C5A059`)
- `.scanner-range-unit` — label unité (%, €, /100)

---

## Ordre d'implémentation

1. `scanner/calculs.py` — fix CSG, fix score (+ passer prix/surface à `_score`)
2. `scanner/scanner.py` — ajouter stats manquantes
3. `scanner/ai_enrichir.py` — nouveaux champs prompt + mapping résultat
4. `styles.css` — classes range filters
5. `index.html` — nouvelles chips + section filtres numériques
6. `scanner.js` — `_initRangeFilters`, extension `_matchFilters`, nouveaux badges

---

## Ce qui n'est PAS dans cette spec

- Régimes fiscaux réel et SCI IS dans le scanner (déjà dans la web app, hors périmètre)
- PNO et frais de gestion (variables utilisateur, pas de config globale prévue)
- Multi-code postal (hors périmètre)
