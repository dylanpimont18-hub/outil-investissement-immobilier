// Migration unique « stockage local de l'exe → cloud ». Seul l'exe (origine http://127.0.0.1:8080)
// peut lire son propre localStorage et les dossiers exports/ et documents/ servis par server.py :
// main.js ne charge ce module que là (ou avec ?migration-locale=1 pour les tests), après connexion,
// et il ne fait rien si users/{uid}/settings/migration existe déjà. Il pousse, puis RELIT TOUT et
// compare : le marqueur n'est écrit que si tout correspond. Il ne supprime rien en local. À
// supprimer avec son chargement en fin de chantier (spec, point 6).
// Voir docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md, point 5.
import { escapeHtml } from './utils.js';
import { cloudGetMeta, cloudSaveMeta, cloudGetAllAssets, cloudDocumentExists, cloudUploadDocumentAs } from './owned-cloud.js';
import { cloudGetAllStudies, cloudSetStudy, cloudGetSetting, cloudSetSetting, cloudArchiveMeta, cloudUploadArchive } from './cloud-store.js';
import {
    choisirEtude, comparerProfond, normaliserPourFirestore,
    lireEtudesLocales, lireAnalyseLocale, lirePrefsLocales, lireProfilLocal, lireMetaLocale
} from './migration-regles.js';

const URL_WEB = 'https://spark-investissement.web.app';
const MODAL_ID = 'migration-locale-modal';
const getItem = key => { try { return localStorage.getItem(key); } catch { return null; } };

export async function runLocalMigration({ sanitizeAssetRecord, normaliserVariables }) {
    if (await cloudGetSetting('migration')) return { skipped: true };
    const modale = _ouvrirModale();
    let bilan;
    try {
        for (;;) {
            modale.reset();
            try {
                bilan = await _migrer({ sanitizeAssetRecord, normaliserVariables }, modale);
            } catch (err) {
                // Une panne (réseau, Storage, déconnexion…) ne doit jamais laisser la modale sans bouton :
                // bilan en échec (jamais de marqueur) avec Réessayer / Ignorer.
                console.error('[Spark] migration locale :', err);
                modale.etape(modale.etapeCourante, 'erreur', 'interrompue');
                bilan = { ok: false, counts: { etudes: 0, archives: 0, documents: 0 }, ecarts: [`erreur pendant la migration : ${err?.message || err}`], avertissements: [] };
            }
            _afficherBilan(modale, bilan);
            const choix = await modale.attendreChoix(); // 'close' | 'retry' | 'skip'
            if (choix !== 'retry') break;
        }
    } finally {
        modale.fermer();
    }
    return bilan;
}

async function _migrer({ sanitizeAssetRecord, normaliserVariables }, modale) {
    const ecarts = [];
    const avertissements = [];
    const attendu = { etudes: {}, analysis: null, prefs: {}, archives: [], documents: [] };

    // 1. Études : fusion avec le cloud, la plus récente gagne (à défaut la locale).
    modale.etape('etudes', 'en cours', 'Lecture des études…');
    const cloudEtudes = await cloudGetAllStudies();
    const locales = lireEtudesLocales(getItem).map(sanitizeAssetRecord).filter(Boolean);
    for (const locale of locales) {
        const gardee = choisirEtude(locale, cloudEtudes[locale.id] || null);
        if (gardee === locale) await cloudSetStudy(locale.id, normaliserPourFirestore(locale));
        attendu.etudes[locale.id] = normaliserPourFirestore(gardee);
    }
    for (const [id, etude] of Object.entries(cloudEtudes)) if (!attendu.etudes[id]) attendu.etudes[id] = etude;
    modale.etape('etudes', 'ok', `${locales.length} étude(s) locale(s) fusionnée(s)`);

    // 2. Réglages : étude en cours + préférences (le cloud, s'il a déjà quelque chose, est plus récent).
    modale.etape('reglages', 'en cours', 'Étude en cours et préférences…');
    const analyseLocale = lireAnalyseLocale(getItem);
    const analyseCloud = await cloudGetSetting('analysis');
    if (analyseLocale && !analyseCloud) {
        attendu.analysis = normaliserPourFirestore({ variablesData: normaliserVariables(analyseLocale.variablesData), activeAssetId: analyseLocale.activeAssetId, updatedAt: Date.now() });
        await cloudSetSetting('analysis', attendu.analysis);
    }
    const prefsLocales = lirePrefsLocales(getItem);
    const prefsCloud = (await cloudGetSetting('prefs')) || {};
    const prefsManquantes = Object.fromEntries(Object.entries(prefsLocales).filter(([k]) => !(k in prefsCloud)));
    if (Object.keys(prefsManquantes).length) await cloudSetSetting('prefs', prefsManquantes);
    attendu.prefs = prefsManquantes;
    // Profil et anciens réglages du portefeuille : seulement si le cloud n'en a pas.
    const meta = await cloudGetMeta();
    const { profil } = lireProfilLocal(getItem);
    const metaLocale = lireMetaLocale(getItem);
    const patchMeta = {};
    if (profil && !meta.profile) patchMeta.profile = normaliserPourFirestore(profil);
    for (const k of ['regime', 'order', 'goals']) if (metaLocale[k] !== undefined && meta[k] === undefined) patchMeta[k] = metaLocale[k];
    if (Object.keys(patchMeta).length) await cloudSaveMeta(patchMeta);
    modale.etape('reglages', 'ok', `${Object.keys(prefsManquantes).length} préférence(s)${patchMeta.profile ? ', profil' : ''} poussé(e)s`);

    // 3. Archives JSON (dossier exports/) → Storage, octets bruts tels quels.
    modale.etape('archives', 'en cours', 'Archives du portefeuille…');
    const fichiers = await _lireListeExports();
    if (fichiers === null) ecarts.push('liste des archives locales illisible (/api/portfolio/import/list)');
    for (const nom of fichiers || []) {
        const existante = await cloudArchiveMeta(nom);
        const blob = await _lireFichierLocal(`/exports/${encodeURIComponent(nom)}`);
        if (!blob) {
            // Listée mais illisible : seul un exemplaire déjà au cloud la rend acceptable (relue plus bas).
            if (existante) attendu.archives.push({ nom, taille: existante.size });
            else ecarts.push(`archive ${nom} listée mais illisible localement (/exports/${nom})`);
            continue;
        }
        if (!existante) await cloudUploadArchive(nom, blob);
        attendu.archives.push({ nom, taille: blob.size });
    }
    modale.etape('archives', fichiers === null ? 'erreur' : 'ok', fichiers === null ? 'liste illisible' : `${attendu.archives.length} archive(s)`);

    // 4. Justificatifs PDF manquants dans Storage, relus via l'ancienne route /api/documents.
    modale.etape('documents', 'en cours', 'Justificatifs…');
    const biens = await cloudGetAllAssets();
    for (const [assetId, bien] of Object.entries(biens)) {
        for (const t of (bien.postAchat?.travaux || [])) {
            if (!t.pdfFilename) continue;
            if (!(await cloudDocumentExists(assetId, t.pdfFilename))) {
                const blob = await _lireFichierLocal(`/api/documents/${encodeURIComponent(assetId)}/${encodeURIComponent(t.pdfFilename)}`);
                if (!blob) { avertissements.push(`${bien.nom || assetId} : ${t.pdfFilename} introuvable localement et absent du cloud`); continue; }
                await cloudUploadDocumentAs(assetId, t.pdfFilename, blob);
            }
            attendu.documents.push({ assetId, filename: t.pdfFilename });
        }
    }
    modale.etape('documents', 'ok', `${attendu.documents.length} document(s)`);

    // 5. Relecture complète et comparaison : le marqueur n'est écrit que si tout correspond.
    modale.etape('controle', 'en cours', 'Relecture et comparaison…');
    const relu = await cloudGetAllStudies();
    if (Object.keys(relu).length !== Object.keys(attendu.etudes).length) ecarts.push(`nombre d'études : ${Object.keys(relu).length} relues pour ${Object.keys(attendu.etudes).length} attendues`);
    for (const [id, etude] of Object.entries(attendu.etudes)) {
        if (!comparerProfond(etude, relu[id])) ecarts.push(`étude ${id} : contenu relu différent`);
    }
    if (attendu.analysis && !comparerProfond(attendu.analysis, await cloudGetSetting('analysis'))) ecarts.push('settings/analysis : contenu relu différent');
    const prefsRelues = (await cloudGetSetting('prefs')) || {};
    for (const [k, v] of Object.entries(attendu.prefs)) if (!comparerProfond(v, prefsRelues[k])) ecarts.push(`préférence ${k} : valeur relue différente`);
    for (const a of attendu.archives) {
        const m = await cloudArchiveMeta(a.nom);
        if (!m) ecarts.push(`archive ${a.nom} absente du cloud`);
        else if (m.size !== a.taille) ecarts.push(`archive ${a.nom} : ${m.size} octets relus pour ${a.taille}`);
    }
    for (const d of attendu.documents) {
        if (!(await cloudDocumentExists(d.assetId, d.filename))) ecarts.push(`document ${d.filename} (${d.assetId}) absent du cloud`);
    }
    const counts = { etudes: Object.keys(attendu.etudes).length, archives: attendu.archives.length, documents: attendu.documents.length };
    if (!ecarts.length) {
        const appVersion = await fetch('VERSION', { cache: 'no-store' }).then(r => (r.ok ? r.text() : 'dev')).then(t => t.trim()).catch(() => 'dev');
        await cloudSetSetting('migration', { doneAt: new Date().toISOString(), counts, appVersion }, { merge: false });
        modale.etape('controle', 'ok', 'Tout correspond');
    } else {
        modale.etape('controle', 'erreur', `${ecarts.length} écart(s)`);
    }
    return { ok: !ecarts.length, counts, ecarts, avertissements };
}

// null = liste illisible (route absente, erreur, JSON invalide) ≠ [] = liste lue et vraiment vide.
async function _lireListeExports() {
    try {
        const res = await fetch('/api/portfolio/import/list');
        if (!res.ok) return null;
        const { files } = await res.json();
        return Array.isArray(files) ? files.filter(f => typeof f === 'string' && f.endsWith('.json')) : null;
    } catch {
        return null;
    }
}

async function _lireFichierLocal(url) {
    try {
        const res = await fetch(url);
        return res.ok ? await res.blob() : null;
    } catch {
        return null;
    }
}

// ─── Modale de progression / bilan (classes .owned-modal-overlay / .owned-modal de styles.css) ──

const ETAPES = [['etudes', 'Études du comparateur'], ['reglages', 'Étude en cours, préférences, profil'], ['archives', 'Archives du portefeuille'], ['documents', 'Justificatifs PDF'], ['controle', 'Relecture et contrôle']];
const SYMBOLE = { attente: '○', 'en cours': '…', ok: '✓', erreur: '✗' };

function _ouvrirModale() {
    document.getElementById(MODAL_ID)?.remove();
    const el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'owned-modal-overlay';
    // #app-cloud-loading (z-index 1500) recouvre l'app pendant la migration : sans ceci la modale
    // resterait cachée dessous et invisible pour l'utilisateur.
    el.style.zIndex = '1600';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Migration vers le cloud');
    document.body.appendChild(el);
    let resoudreChoix = null;
    const modale = {
        reset() {
            el.innerHTML = `
                <div class="owned-modal" style="max-width:560px">
                    <h3>Migration de vos données vers le cloud</h3>
                    <p class="owned-caveat">Dernière étape avant le passage au tout-web. Rien n'est supprimé sur cet ordinateur.</p>
                    <ul data-migration-etapes style="list-style:none;padding:0;margin:12px 0;display:grid;gap:6px">
                        ${ETAPES.map(([id, libelle]) => `<li data-etape="${id}"><span data-symbole>${SYMBOLE.attente}</span> ${libelle} <small data-detail class="owned-caveat"></small></li>`).join('')}
                    </ul>
                    <div data-migration-bilan></div>
                    <div class="owned-modal-actions" data-migration-actions hidden></div>
                </div>`;
        },
        etapeCourante: 'etudes',
        etape(id, statut, detail = '') {
            this.etapeCourante = id;
            const li = el.querySelector(`[data-etape="${id}"]`);
            if (!li) return;
            li.querySelector('[data-symbole]').textContent = SYMBOLE[statut] || SYMBOLE.attente;
            li.querySelector('[data-detail]').textContent = detail;
        },
        attendreChoix() {
            return new Promise(resolve => { resoudreChoix = resolve; });
        },
        choisir(valeur) { resoudreChoix?.(valeur); resoudreChoix = null; },
        fermer() { el.remove(); },
        el
    };
    el.addEventListener('click', e => {
        const btn = e.target.closest('[data-migration-close],[data-migration-retry],[data-migration-skip]');
        if (!btn) return;
        modale.choisir(btn.hasAttribute('data-migration-retry') ? 'retry' : btn.hasAttribute('data-migration-skip') ? 'skip' : 'close');
    });
    return modale;
}

function _afficherBilan(modale, bilan) {
    const { el } = modale;
    const zone = el.querySelector('[data-migration-bilan]');
    const actions = el.querySelector('[data-migration-actions]');
    const c = bilan.counts;
    const avert = bilan.avertissements.length
        ? `<p class="owned-caveat">Avertissements (données déjà absentes avant la migration) :</p><ul>${bilan.avertissements.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
        : '';
    if (bilan.ok) {
        zone.innerHTML = `
            <p><strong>${c.etudes} étude${c.etudes > 1 ? 's' : ''}, ${c.archives} archive${c.archives > 1 ? 's' : ''}, ${c.documents} document${c.documents > 1 ? 's' : ''}</strong> migrés et vérifiés.</p>
            <p>Ouvrez désormais l'application depuis un favori du navigateur, sur PC comme sur iPhone :<br>
            <a style="color:var(--accent-light)" href="${URL_WEB}" target="_blank" rel="noopener">${URL_WEB}</a> (portefeuille seul : <a style="color:var(--accent-light)" href="${URL_WEB}/portefeuille" target="_blank" rel="noopener">${URL_WEB}/portefeuille</a>)</p>
            ${avert}`;
        actions.innerHTML = `<button type="button" class="btn btn--primary" data-migration-close>Continuer</button>`;
    } else {
        zone.innerHTML = `
            <p><strong>La relecture ne correspond pas : rien n'a été marqué comme migré.</strong></p>
            <p>Écarts constatés :</p>
            <ul>${bilan.ecarts.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
            ${avert}`;
        actions.innerHTML = `
            <button type="button" class="btn btn--ghost" data-migration-skip>Ignorer pour cette fois</button>
            <button type="button" class="btn btn--primary" data-migration-retry>Réessayer</button>`;
    }
    actions.hidden = false;
}
