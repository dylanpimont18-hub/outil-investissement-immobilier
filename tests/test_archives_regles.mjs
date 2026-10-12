// Tests de la règle de nommage des archives d'export du portefeuille (archives-regles.js).
import assert from 'node:assert/strict';
import { nomArchiveUnique } from '../archives-regles.js';

// nomArchiveUnique : même règle que l'ancien server.py (suffixe -1, -2…)
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', []), 'portefeuille-2026-10-11.json');
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', ['portefeuille-2026-10-11.json']), 'portefeuille-2026-10-11-1.json');
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', ['portefeuille-2026-10-11.json', 'portefeuille-2026-10-11-1.json']), 'portefeuille-2026-10-11-2.json');

console.log('test_archives_regles: OK');
