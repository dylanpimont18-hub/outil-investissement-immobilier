// Verdict de l'Analyse (audit 2026-11-18, F4 ; règles choisies par l'utilisateur le 2026-11-19) :
// l'économie d'abord (« Économie défavorable »), puis les vrais défauts du bien (« Offre non
// recevable » / « Validation bloquée »), puis le simple manque d'information (« Dossier à documenter »).
// Le score n'est pas modifié par ce classement.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeAnalysisViewModel } from '../calculs.js';

// Valeurs par défaut réelles du formulaire (VARIABLE_DEFAULTS de main.js, qui ne s'importe pas
// sous Node car il touche au DOM) : relues dans le source pour rester alignées.
const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const DEFAULTS = eval('(' + src.match(/const VARIABLE_DEFAULTS = (\{[\s\S]*?\n\});/)[1] + ')');
const FOYER = { revenus: 48000, adults: 1, children: 0 };
const verdict = (patch) => computeAnalysisViewModel({ ...DEFAULTS, ...FOYER, ...patch }).acquisitionDecision;
const VERIFIE = { 'source-loyer': 'verified', 'source-charges': 'verified', 'source-travaux': 'verified', 'source-documents': 'verified' };
// Bien rentable : prix bas, loyer élevé, taxe foncière raisonnable.
const RENTABLE = { prix: 60000, loyer: 750, 'loyer-marche': 750, fonciere: 500, apport: 10000 };

// 1. Exemple de l'audit : 150 000 € / 750 € (CF ≈ −445 €/mois) → l'économie ne tient pas.
const a = verdict({ prix: 150000, loyer: 750 });
assert.equal(a.label, 'Économie défavorable');
assert.equal(a.verdictKind, 'economie-defavorable');
assert.match(a.reason, /de baisse \(prix autour de [\d\s  ]+ €\) pour atteindre le seuil minimal/);
assert.notEqual(a.label, 'Offre non recevable');
console.log(`Test 1 OK — 150 000 € / 750 € : « ${a.label} » — ${a.reason}`);

// 2. Économie tenable, hypothèses encore estimées (seule la fiabilité bloque) → à documenter.
const b = verdict(RENTABLE);
assert.equal(b.economicTone === 'excellent' || b.economicTone === 'positive', true, `économie attendue tenable, obtenu ${b.economicLabel}`);
assert.equal(b.label, 'Dossier à documenter');
assert.equal(b.verdictKind, 'documenter');
assert.equal(b.tone, 'watch');
assert.match(b.reason, /à confirmer : fiabilité des hypothèses/);
console.log(`Test 2 OK — économie tenable + hypothèses estimées : « ${b.label} » — ${b.reason}`);

// 3. Même bien, mais vrai défaut (DPE G avec blocage des passoires) → le défaut l'emporte sur l'information.
const c = verdict({ ...RENTABLE, dpe: 'G', 'blocage-passoire': 'yes' });
assert.equal(c.verdictKind, 'defaut');
assert.ok(['Offre non recevable', 'Validation bloquée'].includes(c.label), c.label);
assert.match(c.reason, /point bloquant : .*diagnostic énergie/);
console.log(`Test 3 OK — DPE G : « ${c.label} » — ${c.reason}`);

// 4. Même bien, hypothèses vérifiées → ni défaut ni information : le verdict économique reste.
const d = verdict({ ...RENTABLE, ...VERIFIE });
assert.ok(!['Dossier à documenter', 'Offre non recevable', 'Validation bloquée', 'Économie défavorable'].includes(d.label), d.label);
console.log(`Test 4 OK — hypothèses vérifiées : « ${d.label} »`);

// 5. Le score ne dépend pas du libellé : même calcul qu'avant (blocages comptés comme avant).
assert.ok(b.score < d.score, `score documenté (${d.score}) > score estimé (${b.score})`);
console.log(`Test 5 OK — score inchangé dans son principe : estimé ${b.score}/100, vérifié ${d.score}/100`);

console.log('\nTous les tests du verdict de l’Analyse passent.');
