# Design — Tuto Mode, renommage Spark Investissement, fix portefeuille

Date : 2026-05-11

## Périmètre

Trois changements indépendants sur l'application Spark Investissement (ex Investissement Web) :

1. **Fix tab portefeuille** — la section collection-panel s'affiche au bas de toutes les pages au chargement initial ; la corriger pour qu'elle soit exclusive à l'onglet Portefeuille.
2. **Renommage** — "Investissement Web" → "Spark Investissement" dans les 3 occurrences.
3. **Tuto Mode** — remplacer le bouton "Guide" par un mode tutoriel pas-à-pas pensé pour les novices.

---

## Fix 1 — Portfolio exclusif à l'onglet Portefeuille

**Cause :** `initWorkspaceTabs()` dans `main.js` n'applique le masquage du `#collection-panel` qu'au clic. Au chargement, les deux panels sont visibles simultanément.

**Correction :** Ajouter `collectionPanel.style.display = 'none'` dans `initWorkspaceTabs()` immédiatement après la déclaration `const collectionPanel`, avant d'attacher les listeners.

---

## Fix 2 — Renommage Spark Investissement

Fichiers à modifier :

| Fichier | Ligne | Ancien | Nouveau |
|---|---|---|---|
| `index.html` | 6 | `Investissement Web \| Décision locative` | `Spark Investissement \| Décision locative` |
| `index.html` | 20 | `Investissement Web` | `Spark Investissement` |
| `pdf.js` | 1690 | `Investissement Web` | `Spark Investissement` |

---

## Fix 3 — Tuto Mode (remplacement du Guide)

### Principe

Un bandeau fixe en bas de l'écran pilote un parcours en 7 étapes (0 = intro, 1-5 = sections, 6 = fin). À chaque étape :
- L'accordéon de la section correspondante s'ouvre automatiquement.
- Les champs clés reçoivent la classe `.tuto-highlight` (outline + glow doré).
- Une bulle d'explication s'affiche au-dessus du premier champ mis en avant.
- Le bandeau affiche le titre, la description courte de l'étape, et les boutons Précédent / Suivant.

L'utilisateur reste libre de remplir les champs et de voir l'analyse se calculer en temps réel pendant le tuto.

### Données — `TUTO_STEPS`

Remplace `GUIDED_FIELDS` pour le pilotage des étapes. Structure :

```js
{
  title: string,
  description: string,          // affiché dans le bandeau
  accordTitle: string | null,   // accordéon à ouvrir (null = étapes 0 et 6)
  fields: [
    { id: string, label: string, exemple: string, explication: string }
  ]
}
```

Étapes :

| # | Titre | accordTitle | Champs (IDs réels) |
|---|---|---|---|
| 0 | Bienvenue | null | — |
| 1 | Identité du dossier | Identité du dossier | nom-bien, ville, statut-bien |
| 2 | Prix & loyer | Acquisition | prix, loyer, nego, notaire, travaux |
| 3 | Financement | Financement | apport, taux-input, duree, assurance |
| 4 | Exploitation locative | Exploitation locative | vacance, fonciere, copro, gestion |
| 5 | Fiscalité | Fiscalité | regime |
| 6 | Analyse disponible | null | — |

Note : il n'y a pas de champ `tmi` dans le formulaire principal — la TMI est gérée via le profil du foyer (modal `#profile-modal`). L'étape 5 se limite au champ `regime`.

### Composants visuels

**Bandeau tuto** (`#tuto-bar`) :
- `position: fixed; bottom: 0; left: 0; right: 0; z-index: 300`
- Fond `var(--surface-2)`, bordure top `2px solid var(--accent)`
- Hauteur environ 80px, padding 12px 24px
- Layout : `[étape N/6] [titre + description] [← Précédent] [Suivant →]`
- Caché (`hidden`) quand le tuto est inactif

**Surbrillance `.tuto-highlight`** (sur le `<label>` parent du champ) :
- `outline: 2px solid var(--accent)`
- `box-shadow: 0 0 0 4px rgba(197, 160, 89, .15)`
- `border-radius: 8px`
- Transition 200ms

**Bulle d'explication** (`#tuto-tooltip`) :
- `position: absolute; z-index: 350`
- Positionnée dynamiquement au-dessus du premier champ mis en avant via `getBoundingClientRect()`
- Contenu : `<strong>label</strong> — exemple — explication`
- Fond `var(--accent)`, texte sombre, `border-radius: 8px`, ombre légère
- Masquée aux étapes 0 et 6

**Bouton** : le `#guided-toggle` existant change de libellé de "Guide" → "Tuto". Même classe, même comportement de toggle (localStorage `guidedMode`).

### Logique JS (`main.js`)

Nouvelles fonctions (remplacent ou complètent les fonctions `guided*`) :

- `getTutoStep()` / `setTutoStep(n)` — lit/écrit l'étape courante dans `localStorage`
- `applyTutoStep(n)` — orchestre : ouvre l'accordéon, applique `.tuto-highlight`, positionne la bulle, met à jour le bandeau
- `removeTutoHighlights()` — retire `.tuto-highlight` de tous les labels
- `renderTutoBar()` — met à jour le contenu du bandeau (étape, titre, description, état des boutons)
- `initTutoBar()` — attache les listeners sur les boutons Précédent / Suivant

Les fonctions `renderGuidedChecklist`, `openSpotlight`, `navigateSpotlight`, `syncSpotlightInputToField` et les nodes `guidedChecklist`, `guidedProgress`, `guidedBar`, `guidedListEssentiel`, `guidedListImportant`, `spotlightOverlay` et assimilés sont **supprimés**.

### HTML

- Supprimer le bloc `#guided-checklist` (lignes 70-81 de `index.html`) et le bloc `.spotlight-overlay` (`#spotlight-overlay`, ligne 643-659 de `index.html`).
- Ajouter `#tuto-bar` juste avant `</body>`.
- Conserver `#guided-toggle` dans la topbar (libellé change seulement).

### CSS (`styles.css`)

- Supprimer les règles `.guided-checklist*` (à partir de la ligne 2211).
- Ajouter `.tuto-highlight`, `#tuto-bar`, `#tuto-tooltip`.
- Conserver `.topbar-btn--guided.is-active`.

---

## Ce qui ne change pas

- Architecture fichiers (pas de nouveau fichier).
- `calculs.js` et `pdf.js` : pas de modification (hors renommage).
- Le système `BroadcastChannel` / deux fenêtres.
- Les autres boutons de la topbar.
