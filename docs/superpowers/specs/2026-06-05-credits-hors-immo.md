# Spec — Crédits hors immobilier

**Date :** 2026-06-05
**Statut :** approuvé

## Contexte

Le taux d'endettement affiché dans le portefeuille ne tient compte que des mensualités immobilières. L'utilisateur a d'autres crédits en cours (auto, conso, personnel…) qui doivent être inclus pour obtenir un taux d'endettement total fiable et une capacité d'emprunt correcte.

## Objectif

Permettre la saisie de crédits hors immobilier (liste détaillée par crédit) et les intégrer dans le calcul du taux d'endettement total et de la capacité d'emprunt restante.

---

## Structure des données

Nouveau tableau `autresCredits[]` dans `profileData`, persisté dans `localStorage` avec le reste du profil.

```js
// Entrée unique
{
  id: string,                          // identifiant court unique (ex: Date.now().toString(36))
  libelle: string,                     // ex: "Crédit auto" — obligatoire
  mensualite: number,                  // mensualité totale assurance incluse — obligatoire
  mensualiteHorsAssurance: number | null,  // optionnel
  dateDebut: string | null,            // "YYYY-MM" — optionnel
  dateFin: string | null,              // "YYYY-MM" — optionnel
  capitalRestantDu: number | null      // saisi manuellement — optionnel
}
```

`mensualite` (assurance incluse) est la valeur utilisée dans tous les calculs.

---

## Interface

### Section portefeuille — "Crédits en cours"

On ajoute un sous-bloc **"Crédits hors immobilier"** à la suite du tableau des crédits immo existant.

**Tableau de la liste :**
| Libellé | Mensualité (avec assurance) | Date de fin | CRD |
|---|---|---|---|
| Crédit auto | 320 €/mois | 06/2028 | 8 400 € |
| …  | … | … | … |
| **Total** | **320 €/mois** | | **8 400 €** |

- Chaque ligne a un bouton d'édition (clic ouvre le drawer pré-rempli) et un bouton de suppression.
- Le total CRD ne s'affiche que si au moins un CRD est renseigné.
- Bouton **"+ Ajouter un crédit"** sous le tableau.

### Drawer "Crédit hors immobilier"

Même pattern que le `credit-drawer` existant (overlay + aside).

Champs :
- **Libellé** — `<input type="text">` — obligatoire
- **Mensualité totale (assurance incluse)** — `<input type="number">` — obligatoire
- **Mensualité hors assurance** — `<input type="number">` — optionnel, hint "laisser vide si pas d'assurance"
- **Date de début** — `<input type="month">` — optionnel
- **Date de fin** — `<input type="month">` — optionnel
- **Capital restant dû** — `<input type="number">` — optionnel
- Actions : Annuler / Enregistrer

Un crédit existant peut être édité (clic sur la ligne) : le drawer s'ouvre pré-rempli avec les valeurs existantes.

---

## Impact sur les calculs

### `computeDebtRatios` (calculs.js)

La signature évolue pour recevoir la somme mensuelle des crédits hors immo :

```js
function computeDebtRatios(mensualitesImmo, autresMensualites, totalRentMonthly, income)
```

`mensualitesTotales = mensualitesImmo + autresMensualites` est utilisé pour :
- Le ratio HCSF : `mensualitesTotales / (revenuMensuel + 0.7 × loyersMensuels)`
- Le taux d'effort différentiel : `max(0, mensualitesTotales − loyersMensuels) / revenuMensuel`

Le bloc retourné ajoute un champ `autresMensualites` pour l'affichage.

### `computePortfolioViewModel` (calculs.js)

```js
const autresMensualites = (householdProfile.autresCredits || [])
  .reduce((sum, c) => sum + (c.mensualite || 0), 0);

const remainingMonthlyCapacity = Math.max(
  0,
  maxMonthlyDebt - dashboard.totalDebtMonthly - autresMensualites
);
```

`autresMensualites` est transmis à `computeDebtRatios`.

### Affichage "Taux d'endettement bancaire"

Le bloc affiche deux lignes de contexte :
- Crédits immo seuls : `X €/mois`
- Crédits hors immo : `Y €/mois`
- **Total mensuel dettes** : `X + Y €/mois`

Le ratio HCSF et le taux différentiel sont calculés sur le total.

---

## Persistance

`profileData.autresCredits` est sauvegardé dans `localStorage` via la même logique que les autres champs du profil (`saveProfile` / `loadProfile` dans `main.js`).

Valeur par défaut : `[]` (tableau vide).

---

## Fichiers impactés

| Fichier | Changement |
|---|---|
| `index.html` | Sous-bloc + drawer "Crédit hors immobilier" |
| `main.js` | Gestion du drawer, CRUD `autresCredits`, rendu tableau, transmission à `computePortfolioViewModel` |
| `calculs.js` | `computeDebtRatios` + `computePortfolioViewModel` acceptent `autresMensualites` |
| `styles.css` | Aucun nouveau composant nécessaire (réutilise classes existantes) |

---

## Hors périmètre

- Export PDF des crédits hors immo
- Calcul automatique du CRD (reste manuel)
- Historique ou évolution des crédits dans le temps
