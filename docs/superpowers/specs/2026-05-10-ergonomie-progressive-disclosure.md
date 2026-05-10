# Spec — Ergonomie : Progressive Disclosure + Bulles d'aide

**Date :** 2026-05-10
**Périmètre :** `index.html` (structure + textes) + `styles.css` (nouveaux composants CSS)
**Fichiers non modifiés :** `main.js`, `calculs.js`, `ui.js`, `pdf.js`

---

## 1. Objectif

Améliorer l'ergonomie du panneau formulaire par deux mécanismes :

1. **Progressive disclosure** — séparer visuellement les 9 sections accordéon en deux groupes (Essentielles / Avancées) sans masquer aucun champ.
2. **Bulles d'aide** — ajouter un tooltip au survol (`?`) sur chaque champ pour expliquer ce qui est attendu.

---

## 2. Progressive Disclosure

### Groupes

| Groupe | Sections (dans l'ordre actuel) |
|---|---|
| **Essentiel** | Identité du dossier, Acquisition, Financement, Exploitation locative, Fiscalité |
| **Avancé** | Vérifications avant offre, Fiabilité des hypothèses, Seuils de décision, Journal de décision |

### Implémentation HTML

Insérer un séparateur entre les deux groupes dans `index.html`, après la section "Fiscalité" et avant "Vérifications avant offre" :

```html
<div class="form-advanced-sep" aria-hidden="true">
  <span>Paramètres avancés</span>
</div>
```

Ajouter un badge `<span class="accord-badge">Avancé</span>` dans le `.accord-head` des 4 sections avancées, après le `.accord-title` :

```html
<!-- Exemple sur "Vérifications avant offre" -->
<button type="button" class="accord-head" aria-expanded="false">
  <span class="accord-title">Vérifications avant offre</span>
  <span class="accord-badge">Avancé</span>
  <svg class="accord-chevron">...</svg>
</button>
```

### Règles CSS (à ajouter dans `styles.css`)

```css
/* Séparateur avancé */
.form-advanced-sep {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0 8px;
}
.form-advanced-sep::before,
.form-advanced-sep::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-subtle);
}
.form-advanced-sep span {
    font-size: 9px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    white-space: nowrap;
}

/* Badge Avancé */
.accord-badge {
    font-size: 9px;
    font-weight: 600;
    color: var(--muted);
    background: rgba(139, 148, 158, 0.12);
    border: 1px solid rgba(139, 148, 158, 0.20);
    border-radius: var(--radius-pill);
    padding: 2px 7px;
    white-space: nowrap;
}

/* Style atténué des sections avancées */
.accord-section:has(.accord-badge) .accord-head {
    border-color: var(--border-subtle);
}
.accord-section:has(.accord-badge) .accord-title {
    color: var(--muted);
}
```

---

## 3. Bulles d'aide (Tooltips)

### Mécanisme

- Chaque label de champ reçoit un `<button class="field-hint" data-tip="..." aria-label="Aide">?</button>`
- Le tooltip s'affiche au survol via CSS pur (`::after` + `::before` pour la flèche)
- Aucun JavaScript requis
- Compatible clavier (`:focus-within`)

### HTML — pattern par champ

```html
<label class="variables-field" for="prix">
  <span class="status-label">
    Prix vendeur
    <button class="field-hint" type="button" aria-label="Aide sur ce champ"
      data-tip="Prix affiché par le vendeur, avant négociation. Point de départ du calcul du prix d'offre plafond.">?</button>
  </span>
  <input id="prix" name="prix" type="number" ... />
</label>
```

### Règles CSS

```css
/* Icône ? */
.field-hint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 700;
    font-family: var(--font-body);
    cursor: help;
    position: relative;
    vertical-align: middle;
    flex-shrink: 0;
    transition: border-color 120ms, color 120ms;
}

.field-hint:hover,
.field-hint:focus-visible {
    border-color: var(--primary);
    color: var(--primary);
    outline: none;
}

/* Tooltip bulle */
.field-hint::after {
    content: attr(data-tip);
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 7px 10px;
    font-size: 11px;
    font-weight: 400;
    color: var(--text);
    line-height: 1.5;
    width: max-content;
    max-width: 260px;
    white-space: normal;
    box-shadow: var(--shadow-soft);
    z-index: 200;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms;
}

/* Flèche du tooltip */
.field-hint::before {
    content: '';
    position: absolute;
    top: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-bottom-color: var(--border);
    z-index: 201;
    opacity: 0;
    transition: opacity 120ms;
}

.field-hint:hover::after,
.field-hint:hover::before,
.field-hint:focus-visible::after,
.field-hint:focus-visible::before {
    opacity: 1;
}
```

### Textes d'aide par champ

#### Section : Identité du dossier
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `nom-bien` | Nom libre pour identifier ce dossier dans votre comparateur et vos exports PDF. |
| `ville` | Ville où se situe le bien. Utilisée pour contextualiser l'analyse et le rapport. |
| `statut-bien` | Candidat = bien en cours d'étude. Acquis = bien déjà dans votre patrimoine. |

#### Section : Acquisition
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `prix` | Prix affiché par le vendeur, avant négociation. Point de départ du calcul du prix d'offre plafond. |
| `nego` | Décote souhaitée sur le prix vendeur, en %. Le prix d'achat retenu sera prix × (1 − nego/100). |
| `loyer` | Loyer mensuel hors charges prévu. Base de calcul du rendement brut et du cash-flow. |
| `notaire` | Frais de notaire en % du prix. Environ 7–8 % dans l'ancien, 2–3 % dans le neuf. |
| `travaux` | Budget travaux estimé, intégré au coût total d'acquisition et amortissable selon le régime fiscal. |
| `meubles` | Coût du mobilier pour une location meublée. Amortissable en LMNP et SCI IS. |
| `agence` | Honoraires d'agence immobilière à la charge de l'acquéreur. Intégrés au coût total. |

#### Section : Financement
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `apport` | Apport personnel en €. Réduit le capital emprunté et améliore le cash-flow. |
| `taux-input` | Taux d'intérêt annuel du crédit immobilier, hors assurance. Comparer les offres bancaires. |
| `duree` | Durée du prêt en années. Plus longue = mensualité plus faible mais coût total plus élevé. |
| `assurance` | Taux d'assurance emprunteur annuel (ADI), en % du capital emprunté. Environ 0,20–0,40 %. |
| `frais-bancaires` | Frais de dossier bancaire et garantie (hypothèque ou caution). Généralement 1 000–2 000 €. |

#### Section : Exploitation locative
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `vacance` | Taux de vacance locative estimé en %. 5 % = environ 18 jours sans locataire par an. |
| `copro` | Charges de copropriété mensuelles non récupérables sur le locataire, en €. |
| `fonciere` | Taxe foncière annuelle estimée. Vérifier l'avis le plus récent ou demander au vendeur. |
| `pno` | Prime d'assurance propriétaire non occupant (PNO) annuelle. Obligatoire en copropriété. |
| `gestion` | Honoraires de gestion locative, en % des loyers perçus. 0 si gestion en direct. |

#### Section : Vérifications avant offre
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `dpe` | Classe énergétique du bien (DPE). Les passoires thermiques (F, G) seront soumises à restrictions de location d'ici 2025–2028. |
| `loyer-marche` | Loyer de marché constaté dans le secteur pour un bien comparable. Permet de vérifier la cohérence du loyer prévu. |
| `copro-risque` | Niveau de risque de la copropriété : stable = charges maîtrisées, medium = travaux prévisibles, high = situation dégradée. |

#### Section : Fiabilité des hypothèses
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `source-loyer` | Fiabilité de l'estimation du loyer : vérifié = annonces réelles récentes, estimé = approximation, inconnu = à vérifier. |
| `source-charges` | Fiabilité des charges renseignées : vérifié = documents comptables, estimé = approximation, inconnu = à vérifier. |
| `source-travaux` | Fiabilité du budget travaux : vérifié = devis obtenu, estimé = estimation visuelle, inconnu = non évalué. |
| `source-documents` | Qualité des documents fournis par le vendeur (PV AG, charges, diagnostics) : vérifié, estimé ou inconnu. |

#### Section : Seuils de décision
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `seuil-cf-min` | Cash-flow mensuel net minimum acceptable, en €. En dessous de ce seuil, le verdict vire à négatif. |
| `seuil-dscr-min` | DSCR minimum (ratio loyer / mensualité). 1,0 = autofinancement, 1,2 = recommandé pour marge de sécurité. |
| `seuil-vacance-max` | Taux de vacance maximum toléré, en %. Au-delà, le bien est considéré trop risqué. |
| `seuil-ecart-loyer-max` | Écart maximum accepté entre loyer prévu et loyer de marché, en %. Détecte les loyers surévalués. |
| `seuil-effort-max` | Taux d'effort maximum (mensualité / revenus nets), en %. Limite l'endettement personnel. |
| `blocage-passoire` | Si activé, un DPE F ou G bloque automatiquement le verdict à négatif, quelle que soit la rentabilité. |

#### Section : Fiscalité
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `regime` | Régime fiscal de la location : Micro-foncier (abattement 30 %), Réel (déduction charges réelles), SCI IS (imposition société). |

#### Section : Journal de décision
| Champ (`id`) | Texte `data-tip` |
|---|---|
| `decision-thesis` | Résumez en quelques mots pourquoi vous étudiez ce bien. Requis pour enregistrer le dossier (20 caractères min). |
| `decision-next-step` | Prochaine action concrète à mener sur ce dossier (visite, devis, offre…). Requis pour enregistrer (10 caractères min). |

---

## 4. Fichiers modifiés

| Fichier | Changements |
|---|---|
| `index.html` | Ajout du `<div class="form-advanced-sep">` · Ajout de `<span class="accord-badge">Avancé</span>` sur 4 sections · Ajout de `<button class="field-hint" data-tip="...">?</button>` sur 36 champs |
| `styles.css` | Ajout des règles `.form-advanced-sep`, `.accord-badge`, `.field-hint` et tooltip CSS |
| `main.js` | Aucun |
| `calculs.js` | Aucun |
| `ui.js` | Aucun |
| `pdf.js` | Aucun |

---

## 5. Risques & points d'attention

- **`:has()` selector** : `.accord-section:has(.accord-badge)` est supporté par tous les navigateurs modernes (Chrome 105+, Firefox 121+, Safari 15.4+). Si le projet doit supporter d'anciens navigateurs, remplacer par une classe explicite `.accord-section--advanced` ajoutée manuellement dans le HTML.
- **Overflow du tooltip** : les champs en bord de grille à droite peuvent avoir le tooltip coupé. Gérer avec une classe `.field-hint--left` qui inverse `left: auto; right: 0; transform: none` pour les champs en fin de ligne.
- **Mobile/tactile** : le tooltip `:hover` est invisible sur écran tactile. Le `type="button"` et `:focus-visible` permettent l'accès clavier. Sur mobile, le `?` reste visible mais le tooltip ne s'affiche pas — comportement acceptable pour une app principalement desktop.
- **z-index** : le tooltip est positionné en `z-index: 200`. S'assurer qu'il passe au-dessus des cards d'analyse mais reste sous le topbar (`z-index: 100` → à vérifier, topbar est à 100, tooltip à 200, OK).
- **overflow: hidden sur fieldset** : `.accord-body > fieldset` a `overflow: hidden` dans `styles.css`, ce qui clippe les tooltips positionnés en absolu à l'intérieur. Fix : retirer `overflow: hidden` du fieldset et le déplacer sur `.accord-body` lui-même, ou ajouter `overflow: visible` sur le fieldset et gérer le débordement différemment.
