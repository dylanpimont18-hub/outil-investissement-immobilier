# Spec — Redesign GitHub SaaS Style

**Date :** 2026-05-10
**Approche :** C — Réécriture complète de `styles.css`
**Périmètre :** `styles.css` (réécriture) + `index.html` (fonts uniquement)

---

## 1. Objectif

Remplacer la charte graphique actuelle (Cormorant Garamond / IBM Plex Mono / Manrope, fond bleu nuit propriétaire, or éditorial) par un design system inspiré du style GitHub SaaS : Inter + Space Grotesk, bleu primaire (#3B82F6) pour les actions, or (#C9A84C) pour les métriques clés, fonds GitHub (#0D1117 dark / #F6F8FA light).

---

## 2. Tokens de design

### Typographie

| Rôle | Police | Graisses |
|---|---|---|
| Headings H1–H3, KPIs, scores | Space Grotesk | 500, 600, 700 |
| Body, labels, descriptions, inputs | Inter | 400, 500, 600, 700 |

Chargement Google Fonts dans `index.html` :
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
```
Supprimer les imports de Cormorant Garamond, IBM Plex Mono, Manrope.

Variables CSS :
```css
--font-heading: 'Space Grotesk', system-ui, sans-serif;
--font-body: 'Inter', system-ui, sans-serif;
/* --font-display supprimé (ancien IBM Plex Mono) */
```

### Couleurs — Dark Mode (`html[data-theme='dark']`)

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#0D1117` | Fond principal |
| `--surface` | `#161B22` | Cards, panels |
| `--surface-2` | `#21262D` | Inputs, zones imbriquées |
| `--border` | `#30363D` | Bordures standard |
| `--border-subtle` | `#21262D` | Séparateurs |
| `--text` | `#E6EDF3` | Texte principal |
| `--muted` | `#8B949E` | Texte secondaire |
| `--primary` | `#3B82F6` | Actions, focus, tabs actifs |
| `--primary-soft` | `rgba(59,130,246,0.12)` | Focus ring, hover subtil |
| `--gold` | `#C9A84C` | KPIs, prix plafond, premium |
| `--gold-soft` | `rgba(201,168,76,0.12)` | Fond badge gold |
| `--gold-border` | `rgba(201,168,76,0.30)` | Bordure badge gold |
| `--success` | `#3FB950` | CF positif, verdict positif |
| `--danger` | `#F85149` | Alerte, CF négatif |
| `--watch` | `#E3B341` | Vigilance |
| `--neutral` | `#8B949E` | Neutre |
| `--shadow` | `0 4px 12px rgba(0,0,0,0.4)` | Cards |
| `--shadow-panel` | `0 8px 32px rgba(0,0,0,0.6)` | Panels, modales |

### Couleurs — Light Mode (`html[data-theme='light']`)

| Token | Valeur |
|---|---|
| `--bg` | `#F6F8FA` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F6F8FA` |
| `--border` | `#D0D7DE` |
| `--border-subtle` | `#E8EDF3` |
| `--text` | `#1C2128` |
| `--muted` | `#57606A` |
| `--primary` | `#3B82F6` |
| `--primary-soft` | `rgba(59,130,246,0.10)` |
| `--gold` | `#A8832A` | (légèrement assombri pour contraste sur blanc) |
| `--gold-soft` | `rgba(168,131,42,0.10)` |
| `--gold-border` | `rgba(168,131,42,0.25)` |
| `--success` | `#2DA44E` |
| `--danger` | `#CF222E` |
| `--watch` | `#9A6700` |
| `--neutral` | `#57606A` |
| `--shadow` | `0 4px 12px rgba(0,0,0,0.06)` |
| `--shadow-panel` | `0 8px 24px rgba(0,0,0,0.10)` |

### Radius & Spacing

```css
--radius-sm: 6px;   /* badges, petits éléments */
--radius-md: 8px;   /* inputs, boutons */
--radius-lg: 12px;  /* cards, panels */
--radius-pill: 20px; /* tabs pill, badges ronds */
```

Espacement : multiples de 4px — valeurs courantes : 8, 12, 16, 20, 24, 32px.

---

## 3. Composants

### Boutons

```
.btn-primary    → fond --primary, texte #fff, radius --radius-md
.btn-secondary  → transparent, bordure --primary, texte --primary
.btn-gold       → transparent, bordure --gold, texte --gold
.btn-gold-filled → fond --gold, texte #0D1117 (dark) / #1C2128 (light)
.btn-ghost      → transparent, bordure --border, texte --muted
```
Hover : `opacity: 0.85` sur tous.

### Cards

```
.card → background --surface, border 1px solid --border, radius --radius-lg, shadow
.card--gold → border-left: 3px solid --gold
.card--primary → border-left: 3px solid --primary
.card--success → border-left: 3px solid --success
.card--danger → border-left: 3px solid --danger
```

### Verdict Banner

Structure : conteneur flex avec `border-left: 3px solid <tone>`, fond gradient semi-transparent de la couleur du tone.
- Score : `Space Grotesk` 700, 40–48px, couleur du tone
- Titre : `Space Grotesk` 600, `--text`
- Sous-titre : `Inter` 13px, `--muted`
- Badge pill : fond `<tone>-soft`, bordure `<tone>-border`, texte `<tone>`

Tones mappés : `excellent/positive → --success`, `watch → --watch`, `negative → --danger`, `neutral → --muted`.

### Tabs

```
.tabs → fond --surface, bordure --border, radius --radius-pill, padding 4px, display flex, gap 4px
.tab → padding 8px 16px, radius calc(--radius-pill - 4px), texte --muted, Inter 500 13px
.tab.active → fond --primary, texte #fff, Inter 600
```

### Inputs

```
input, select, textarea →
  background: --surface-2
  border: 1px solid --border
  border-radius: --radius-md
  color: --text
  font-family: --font-body
  font-size: 14px
  padding: 10px 14px

:focus →
  border-color: --primary
  box-shadow: 0 0 0 3px var(--primary-soft)
  outline: none
```
Labels : `Inter` 11px, uppercase, `--muted`, letter-spacing 0.5px.

### Tables (projection, fiscalité, revente)

- Header : `Space Grotesk` 600, `--muted`, fond `--surface-2`
- Lignes : alternance `--surface` / `--surface-2` (zebrastripes légères)
- Valeurs positives : `--success` ; négatives : `--danger`
- Ligne active/survolée : `border-left: 2px solid --primary`

---

## 4. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `styles.css` | Réécriture complète |
| `index.html` | Remplacement du `<link>` Google Fonts (1 ligne) |
| `main.js` | Aucun |
| `calculs.js` | Aucun |
| `ui.js` | Aucun |
| `pdf.js` | Aucun |

Les noms de classes CSS existants sont conservés. Seuls les styles changent.

---

## 5. Risques & points d'attention

- **Classes custom inline** : si `main.js` ou `ui.js` injectent des `style=""` inline avec des couleurs hardcodées (ex. `color: #F0B429`), ces valeurs ne seront pas affectées par le redesign — à vérifier lors de l'implémentation.
- **`--font-display`** : des occurrences dans `main.js` / `ui.js` peuvent référencer cette variable. La remplacer par `--font-heading` (Space Grotesk) ou `--font-body` selon le contexte.
- **PDF** : `pdf.js` génère un HTML standalone avec ses propres styles — hors périmètre de cette spec, à traiter séparément si nécessaire.
- **Taille de styles.css** : la réécriture doit viser ≤ taille actuelle. Supprimer les règles mortes en même temps.
