# Spec — Scanner "→ Analyser" : UX améliorée

**Date :** 2026-05-26
**Statut :** approuvée

## Contexte

L'onglet Scanner affiche un tableau de biens LeBonCoin enrichis par IA. Un bouton "→ Analyser" sur chaque ligne pré-remplit le formulaire "Saisie & Analyse" et bascule l'onglet. Cette spec améliore l'UX de ce bouton : protection des données en cours, retour visuel, et modale soignée.

## Fonctionnalité

### Flux de déclenchement

Au clic sur "→ Analyser" :

1. Afficher le modal de confirmation (voir §Modal).
2. **[Sauvegarder]** → appelle `saveCurrentStudy()` depuis `main.js`, puis charge le bien.
3. **[Ignorer]** → charge le bien directement sans sauvegarder.
4. **[Annuler]** → ferme le modal, rien ne change.

Le modal s'affiche **toujours**, quel que soit l'état du formulaire.

Après chargement du bien :
- Basculer sur l'onglet "Saisie & Analyse" (clic sur `[data-target="workspace-panel"]`).
- Surligner les champs remplis (voir §Surlignage).
- Dispatcher `new Event('input', { bubbles: true })` sur `#variables-form` pour déclencher le recalcul.

### Modal de confirmation

Créé dynamiquement dans `document.body` par `scanner.js`, détruit à la fermeture.

**Structure HTML :**
- Fond plein écran `rgba(0,0,0,0.6)`, fermeture au clic sur le fond.
- Carte centrée : `border-radius: 12px`, fond `var(--surface-2)` (light/dark automatique).
- Titre : "Sauvegarder l'étude en cours ?"
- Sous-titre : valeur actuelle de `#nom-bien` pour identifier l'étude.
- Trois boutons :
  - **Sauvegarder** — fond `#C5A059`, texte sombre, action principale.
  - **Ignorer** — fond transparent, bordure grise, continue sans sauvegarder.
  - **Annuler** — lien texte, ferme le modal sans rien faire.

### Export `saveCurrentStudy()` dans `main.js`

Nouvelle fonction exportée. Clone la logique de `createOrUpdateCurrentAsset` avec deux différences :

- Pas de `validateDecisionJournalBeforeSave()` — l'auto-sauvegarde ne bloque pas sur les champs journal.
- Pas de `render()` — le rendu sera déclenché par le chargement du nouveau bien.

```js
export function saveCurrentStudy() {
    const existingIndex = state.assetRecords.findIndex(a => a.id === state.activeAssetId);
    const now = Date.now();
    const base = existingIndex >= 0 ? state.assetRecords[existingIndex] : null;
    const id = base?.id || createAssetId();
    const record = {
        id,
        variablesData: sanitizeVariablesData(state.variablesData),
        inComparison: Boolean(base?.inComparison),
        inPortfolio: Boolean(base?.inPortfolio),
        createdAt: base?.createdAt || now,
        updatedAt: now,
    };
    if (existingIndex >= 0) state.assetRecords.splice(existingIndex, 1, record);
    else state.assetRecords.push(record);
    state.activeAssetId = id;
    saveAssetRecords();
    saveActiveAssetId();
    emitStateUpdate();
}
```

`scanner.js` l'importe via son import existant de `main.js`.

### Surlignage des champs remplis

Après injection des valeurs, `scanner.js` ajoute `field--scanner-highlight` sur chaque `<input>` / `<select>` modifié. Classe retirée après 1 800 ms.

CSS dans `styles.css` :

```css
.field--scanner-highlight {
    transition: box-shadow 0.3s, background-color 0.3s;
    box-shadow: 0 0 0 2px #C5A059;
    background-color: #C5A05912;
}
```

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `main.js` | Exporter `saveCurrentStudy()` |
| `scanner.js` | Importer `saveCurrentStudy`, remplacer `_analyserBien` par version avec modal + surlignage |
| `styles.css` | Ajouter `.field--scanner-highlight` |

## Hors périmètre

- Modification de `calculs.js`.
- Pré-remplissage de la surface (pas un champ du formulaire principal).
- Toast de confirmation post-chargement (le surlignage suffit).
