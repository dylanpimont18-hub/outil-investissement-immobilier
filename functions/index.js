const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

const mammouthApiKey = defineSecret('MAMMOUTH_API_KEY');

// Uniquement des images : Mammouth AI (proxy vers gpt-4o) n'accepte pas les PDF sur ce plan/cette
// region ('image_url' rejette tout MIME hors image/*, et le mode 'file' natif OpenAI renvoie "File
// input is not supported in this region") — voir le changement de fournisseur du 2026-08-04
// (credit Anthropic epuise, cf. memoire projet_portfolio_audit).
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const ALLOWED_TAGS = ['deductible', 'non-deductible', 'a-classifier'];
const ALLOWED_CONFIANCE = ['haute', 'moyenne', 'basse'];

// Limite le crédit Mammouth AI consommable par un compte compromis/abusif : pas de
// persistance nécessaire (usage familial, faux négatifs après redémarrage acceptables),
// une fenêtre glissante en mémoire suffit et évite une dépendance Firestore/admin SDK.
// Partagée entre extraireFraisFacture et extraireDossierBien (même Map, même plafond) :
// un dossier de 15-20 documents s'ajoute à l'usage Travaux normal, d'où le plafond à 30
// (relevé depuis 10 le 2026-09-22 avec l'accord explicite de l'utilisateur).
const RATE_LIMIT_MAX_CALLS = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 heure
const MAX_BASE64_LENGTH = 7_000_000; // ~5 Mo de fichier source (base64 gonfle de ~33%)
const _callTimestampsByUid = new Map();

// Diagnostic IA + Assistant chat : plafond séparé (Map distincte) pour qu'une conversation de chat
// ne consomme pas le quota d'extraction de factures, et inversement.
const TEXT_RATE_LIMIT_MAX_CALLS = 60;
const _textCallTimestampsByUid = new Map();

function _checkRateLimit(uid, store = _callTimestampsByUid, max = RATE_LIMIT_MAX_CALLS) {
    const now = Date.now();
    const timestamps = (store.get(uid) || []).filter(
        (t) => now - t < RATE_LIMIT_WINDOW_MS
    );
    if (timestamps.length >= max) {
        throw new HttpsError('resource-exhausted', 'Trop de requêtes, réessayez plus tard');
    }
    timestamps.push(now);
    store.set(uid, timestamps);
}

// Appel Mammouth AI partagé (chat/completions) : factorise le fetch/User-Agent/gestion d'erreur
// communs à toutes les fonctions. Renvoie le `message` brut du premier choix.
async function _callMammouth({ messages, tools, jsonMode, logLabel }) {
    let response;
    try {
        response = await fetch('https://api.mammouth.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${mammouthApiKey.value()}`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
                ...(tools ? { tools } : {}),
                messages
            })
        });
    } catch (err) {
        logger.error(`${logLabel}: fetch failed`, { message: err?.message, stack: err?.stack });
        throw new HttpsError('unavailable', 'Impossible de contacter le service IA');
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '<unreadable>');
        logger.error(`${logLabel}: Mammouth API error`, { status: response.status, body: errorBody });
        throw new HttpsError('internal', `Erreur IA (${response.status})`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message || {};
}

function _parseJsonMessage(message, logLabel) {
    const raw = (message.content || '').trim();
    try {
        return JSON.parse(raw);
    } catch (err) {
        logger.error(`${logLabel}: unparseable response`, { raw, message: err?.message });
        throw new HttpsError('internal', 'Réponse IA non exploitable');
    }
}

// Image unique + prompt système (extraireFraisFacture, extraireDossierBien).
async function _callMammouthVision({ systemPrompt, userText, base64, mimeType, logLabel }) {
    const message = await _callMammouth({
        jsonMode: true,
        logLabel,
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                    { type: 'text', text: userText }
                ]
            }
        ]
    });
    return _parseJsonMessage(message, logLabel);
}

function _validateImageInput(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    _checkRateLimit(request.auth.uid);

    const { base64, mimeType } = request.data || {};
    if (!base64 || typeof base64 !== 'string') {
        throw new HttpsError('invalid-argument', 'Fichier manquant');
    }
    if (base64.length > MAX_BASE64_LENGTH) {
        throw new HttpsError('invalid-argument', 'Fichier trop volumineux (5 Mo max)');
    }
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        throw new HttpsError('invalid-argument', 'Format non supporté (JPG ou PNG uniquement)');
    }
    return { base64, mimeType };
}

const SYSTEM_PROMPT = `Tu es un assistant qui extrait les informations d'une facture ou d'un devis de travaux immobiliers français.
Tu réponds uniquement avec du JSON valide, sans markdown ni texte hors JSON, au format exact :
{"fournisseur": "...", "date": "YYYY-MM-DD", "description": "...", "montant": 0, "tagSuggestion": "deductible|non-deductible|a-classifier", "confiance": "haute|moyenne|basse"}

Champs :
- fournisseur : nom de l'entreprise ou de l'artisan qui ÉMET la facture (jamais le client ni le destinataire), "" si illisible.
- date : date d'ÉMISSION de la facture (pas la date d'échéance, de paiement, de devis ni d'intervention).
- description : résumé très court de la prestation, 3 à 8 mots (ex. "Peinture et enduits salon", "Remplacement chauffe-eau"), sans répéter le nom du fournisseur.
- montant : total TTC en euros, nombre sans symbole ni espace.

Règles fiscales françaises pour tagSuggestion (foncier réel) :
- deductible : entretien, réparation, amélioration (peinture, toiture, chauffage, plomberie, électricité...)
- non-deductible : agrandissement, construction, reconstruction (extension, surélévation, création de surface habitable...)
- a-classifier : si le document ne permet pas de trancher avec certitude

Si une information est illisible ou absente, laisse une chaîne vide ("") pour fournisseur/date/description, 0 pour montant, et mets confiance à "basse".`;

// Extraction IA d'une photo de facture/devis pour pré-remplir un frais : modale globale « Ajouter
// des factures » (owned-portfolio.js, openAjoutFacturesModal — bouton flottant PC/mobile, rail,
// dépôt groupé) et onglet Frais d'un bien (renderOwnedTravauxTab). Le client rasterise les PDF en
// PNG avant l'appel. Depuis le 2026-10-02 renvoie aussi `fournisseur` (émetteur de la facture) ;
// `date` est la date d'émission. Appelée à l'identique depuis index.html et owned.html. Passe par
// Mammouth AI (proxy OpenAI-compatible, modèle gpt-4o) plutôt que l'API Anthropic directe depuis
// le 2026-08-04. Le User-Agent explicite est nécessaire : Mammouth est derrière Cloudflare et
// bloque (403 / "error code 1010") les requêtes sans en-tête User-Agent de navigateur.
exports.extraireFraisFacture = onCall({ secrets: [mammouthApiKey], region: 'europe-west1', timeoutSeconds: 60 }, async (request) => {
    const { base64, mimeType } = _validateImageInput(request);

    const parsed = await _callMammouthVision({
        systemPrompt: SYSTEM_PROMPT,
        userText: 'Extrait les informations de cette facture/devis de travaux.',
        base64,
        mimeType,
        logLabel: 'extraireFraisFacture'
    });

    return {
        fournisseur: typeof parsed.fournisseur === 'string' ? parsed.fournisseur.trim().slice(0, 120) : '',
        date: typeof parsed.date === 'string' ? parsed.date : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        montant: Number(parsed.montant) || 0,
        tagSuggestion: ALLOWED_TAGS.includes(parsed.tagSuggestion) ? parsed.tagSuggestion : 'a-classifier',
        confiance: ALLOWED_CONFIANCE.includes(parsed.confiance) ? parsed.confiance : 'basse'
    };
});

// --- extraireDossierBien : extraction multi-documents pour pré-remplir une fiche bien ---
// (acte de vente, offre de prêt, tableau d'amortissement, avis de taxe foncière, appel de
// charges copro, attestation PNO, facture de travaux...). Appelée une fois par document ; la
// fusion entre documents (résolution de conflits par confiance) se fait côté client
// (owned-portfolio.js), cette fonction ne fait qu'extraire un document à la fois — voir
// docs/superpowers/specs/2026-09-22-import-dossier-bien.md.
const DOSSIER_DOCUMENT_TYPES = [
    'acte_vente', 'offre_pret', 'tableau_amortissement', 'taxe_fonciere',
    'charges_copro', 'assurance_pno', 'facture_travaux', 'autre'
];
const DOSSIER_TYPE_BIEN = ['appartement', 'maison', 'immeuble'];

const DOSSIER_SYSTEM_PROMPT = `Tu es un assistant qui extrait les informations d'un document lié à l'achat ou la gestion d'un bien immobilier locatif français (acte de vente, offre de prêt, tableau d'amortissement, avis de taxe foncière, appel de charges de copropriété, attestation d'assurance PNO, facture de travaux, etc.).

Analyse le document fourni et retourne UNIQUEMENT un objet JSON valide (sans markdown, sans texte avant/après), avec cette structure exacte — inclus uniquement les champs que tu peux lire avec certitude dans ce document précis, omets tous les autres (ne mets jamais 0 ou une valeur inventée par défaut) :

{
  "documentType": "acte_vente | offre_pret | tableau_amortissement | taxe_fonciere | charges_copro | assurance_pno | facture_travaux | autre",
  "bien": {
    "adresse": "adresse complète du bien si présente",
    "ville": "ville",
    "codePostal": "code postal à 5 chiffres",
    "surface": nombre en m² (uniquement le nombre),
    "typeBien": "appartement | maison | immeuble"
  },
  "acquisition": {
    "prix": nombre en euros (prix net vendeur, hors frais de notaire/agence),
    "fraisNotaire": nombre en euros,
    "fraisAgence": nombre en euros,
    "dateAchat": "AAAA-MM" (mois et année de signature/acte),
    "valeurEstimee": nombre en euros (si le document mentionne une valeur estimée actuelle, différente du prix d'achat),
    "dateEstimation": "AAAA-MM"
  },
  "credit": {
    "montant": nombre en euros (capital emprunté),
    "duree": nombre en années,
    "taux": nombre en pourcentage (taux nominal hors assurance, ex: 3.2),
    "assurance": nombre en pourcentage (taux annuel assurance emprunteur, ex: 0.30)
  },
  "charges": {
    "taxeFonciere": nombre en euros PAR AN,
    "chargesCopro": nombre en euros PAR MOIS,
    "assurancePNO": nombre en euros PAR AN,
    "gestionLocative": nombre en pourcentage du loyer si mentionné
  },
  "travail": {
    "date": "AAAA-MM-JJ",
    "description": "résumé court des travaux/prestation",
    "montant": nombre en euros TTC,
    "tagSuggestion": "deductible | non-deductible | a-classifier"
  },
  "confiance": "haute | moyenne | basse"
}

Règles strictes :
- N'invente aucune valeur. Un champ absent du document ne doit PAS apparaître dans le JSON (ne mets pas null ni 0).
- Les montants sont des nombres purs (pas de symbole €, pas d'espaces, pas de virgule comme séparateur de milliers — utilise le point si décimal).
- Les dates suivent strictement le format AAAA-MM ou AAAA-MM-JJ.
- Ne remplis "acquisition"/"credit" que si le document est bien un acte de vente ou une offre de prêt — n'essaie pas de deviner un prix d'achat depuis un simple avis de taxe foncière.
- Ne remplis "travail" que si le document est une facture ou un devis de travaux (pas une charge récurrente).
- "confiance" reflète ta certitude globale sur les valeurs extraites de CE document (basse si le document est flou, partiel, ou ambigu).
- Réponds uniquement avec le JSON, sans aucun texte d'accompagnement.`;

function _cleanNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
function _cleanString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function _cleanEnum(v, allowed) {
    return allowed.includes(v) ? v : undefined;
}
function _cleanSubObject(obj, cleaners) {
    if (!obj || typeof obj !== 'object') return undefined;
    const out = {};
    for (const [key, clean] of Object.entries(cleaners)) {
        const v = clean(obj[key]);
        if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

// Nettoie/valide la réponse Mammouth champ par champ (jamais de confiance aveugle dans le JSON
// renvoyé par le modèle) : chaque sous-objet est omis entièrement si vide après nettoyage, pour
// que la fusion côté client ne voie que des valeurs réellement lues dans le document.
function _sanitizeDossierResult(parsed) {
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const out = {
        documentType: _cleanEnum(parsed.documentType, DOSSIER_DOCUMENT_TYPES) || 'autre',
        confiance: ALLOWED_CONFIANCE.includes(parsed.confiance) ? parsed.confiance : 'basse'
    };
    const bien = _cleanSubObject(parsed.bien, {
        adresse: _cleanString, ville: _cleanString, codePostal: _cleanString,
        surface: _cleanNumber, typeBien: (v) => _cleanEnum(v, DOSSIER_TYPE_BIEN)
    });
    if (bien) out.bien = bien;

    const acquisition = _cleanSubObject(parsed.acquisition, {
        prix: _cleanNumber, fraisNotaire: _cleanNumber, fraisAgence: _cleanNumber,
        dateAchat: _cleanString, valeurEstimee: _cleanNumber, dateEstimation: _cleanString
    });
    if (acquisition) out.acquisition = acquisition;

    const credit = _cleanSubObject(parsed.credit, {
        montant: _cleanNumber, duree: _cleanNumber, taux: _cleanNumber, assurance: _cleanNumber
    });
    if (credit) out.credit = credit;

    const charges = _cleanSubObject(parsed.charges, {
        taxeFonciere: _cleanNumber, chargesCopro: _cleanNumber,
        assurancePNO: _cleanNumber, gestionLocative: _cleanNumber
    });
    if (charges) out.charges = charges;

    const travail = _cleanSubObject(parsed.travail, {
        date: _cleanString, description: _cleanString, montant: _cleanNumber,
        tagSuggestion: (v) => _cleanEnum(v, ALLOWED_TAGS)
    });
    if (travail) out.travail = travail;

    return out;
}

exports.extraireDossierBien = onCall({ secrets: [mammouthApiKey], region: 'europe-west1', timeoutSeconds: 60 }, async (request) => {
    const { base64, mimeType } = _validateImageInput(request);

    const parsed = await _callMammouthVision({
        systemPrompt: DOSSIER_SYSTEM_PROMPT,
        userText: "Extrait les informations de ce document lié à l'achat ou la gestion d'un bien immobilier locatif.",
        base64,
        mimeType,
        logLabel: 'extraireDossierBien'
    });

    return _sanitizeDossierResult(parsed);
});

// --- IA texte : Diagnostic d'un bien + Assistant chat ---------------------------------------
// Déplacés depuis server.py (routes Flask /api/portfolio-diagnostic et /api/portfolio-chat) le
// 2026-10-01 pour fonctionner aussi sur la version web (Firebase Hosting, sans serveur local).
// Appelées à l'identique depuis le logiciel PC, index.html en ligne et owned.html (iPhone).
const MAX_CONTEXT_JSON_LENGTH = 200_000; // garde-fou contre un payload démesuré (crédit Mammouth)

function _requireTextCaller(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Connectez-vous au portefeuille pour utiliser l\'IA');
    }
    _checkRateLimit(request.auth.uid, _textCallTimestampsByUid, TEXT_RATE_LIMIT_MAX_CALLS);
}

function _jsonWithinLimit(value) {
    const json = JSON.stringify(value ?? null, null, 2);
    if (json.length > MAX_CONTEXT_JSON_LENGTH) {
        throw new HttpsError('invalid-argument', 'Données trop volumineuses');
    }
    return json;
}

const DIAGNOSTIC_SYSTEM_PROMPT = "Tu es un conseiller en investissement immobilier locatif français expert en fiscalité foncière. "
    + "Tu réponds uniquement en JSON valide, sans markdown ni texte hors JSON.";

exports.diagnosticPortefeuille = onCall({ secrets: [mammouthApiKey], region: 'europe-west1', timeoutSeconds: 90 }, async (request) => {
    _requireTextCaller(request);
    const payload = request.data;
    if (!payload || typeof payload !== 'object') {
        throw new HttpsError('invalid-argument', 'Données du bien manquantes');
    }

    const userPrompt = "Voici les données d'un bien immobilier locatif détenu :\n\n"
        + _jsonWithinLimit(payload)
        + "\n\nProduis entre 3 et 5 recommandations priorisées, actionnables, en français naturel. "
        + "Chaque recommandation doit avoir : un titre court, une explication de 2 à 4 phrases qui justifie "
        + "le conseil avec des chiffres précis issus des données, et une action concrète à mener. "
        + "Priorise les sujets fiscaux (régime, travaux déductibles), les risques de cash-flow (CF négatif, DSCR bas), "
        + "et les optimisations. "
        + "Réponds uniquement avec du JSON valide, sans texte avant ou après, au format : "
        + '{"recommendations": [{"title": "...", "explanation": "...", "action": "..."}]}';

    const message = await _callMammouth({
        jsonMode: true,
        logLabel: 'diagnosticPortefeuille',
        messages: [
            { role: 'system', content: DIAGNOSTIC_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
        ]
    });
    const parsed = _parseJsonMessage(message, 'diagnosticPortefeuille');
    const recommendations = (Array.isArray(parsed?.recommendations) ? parsed.recommendations : [])
        .filter((r) => r && typeof r === 'object')
        .map((r) => ({
            title: String(r.title || ''),
            explanation: String(r.explanation || ''),
            action: String(r.action || '')
        }));
    return { recommendations };
});

const ASSISTANT_SYSTEM_PROMPT = "Tu es l'assistant investissement immobilier locatif de Spark Investissement, un conseiller français "
    + "expert en fiscalité foncière, financement bancaire et gestion locative. "
    + "Tu réponds UNIQUEMENT à des questions liées à l'investissement immobilier locatif de l'utilisateur : "
    + "analyse de son portefeuille, fiscalité, financement, négociation bancaire, rédaction de courriers ou "
    + "emails (ex. à un banquier, un notaire, un locataire), stratégie patrimoniale. "
    + "Si une question sort de ce cadre, décline poliment et recentre sur l'investissement immobilier. "
    + "Réponds en français naturel, de façon concise et actionnable, en t'appuyant sur les chiffres précis du "
    + "contexte fourni ci-dessous quand c'est pertinent. Pas de markdown superflu, du texte simple adapté à un "
    + "email ou une explication directe selon la demande. "
    + "Quand l'utilisateur mentionne une information qui correspond à une modification concrète de son "
    + "portefeuille (un crédit, une note sur un bien, un changement de revenu/objectif, une dépense/des "
    + "travaux), propose l'action correspondante via les outils disponibles plutôt que de simplement en "
    + "prendre note dans ta réponse texte — l'utilisateur confirmera ou annulera avant toute écriture. "
    + "N'appelle un outil que si l'utilisateur a donné une information suffisamment précise et actionnable ; "
    + "sinon pose la question manquante en texte normal.";
const ASSISTANT_MAX_MESSAGES = 40;
const ASSISTANT_MAX_MESSAGE_LENGTH = 8000;

// Function calling (OpenAI-compatible "tools") : chaque outil correspond à une action que
// l'utilisateur devra confirmer côté client avant écriture — voir assistant-chat.js. Cette fonction
// ne fait qu'exposer le schéma à Mammouth AI et relayer les tool_calls bruts, elle n'exécute rien.
const ASSISTANT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'ajouter_credit_hors_immo',
            description: 'Ajoute une ligne de crédit hors immobilier (auto, conso, personnel...) au profil du foyer.',
            parameters: {
                type: 'object',
                properties: {
                    libelle: { type: 'string', description: "Nom du crédit, ex. 'Crédit auto'" },
                    mensualite: { type: 'number', description: 'Mensualité en euros' }
                },
                required: ['libelle', 'mensualite']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'ajouter_note_bien',
            description: 'Ajoute une note texte sur un bien détenu précis du portefeuille.',
            parameters: {
                type: 'object',
                properties: {
                    assetId: { type: 'string', description: "Identifiant du bien (champ 'id' dans le contexte portefeuille fourni)" },
                    text: { type: 'string', description: 'Contenu de la note' }
                },
                required: ['assetId', 'text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'modifier_profil_foyer',
            description: 'Modifie un champ du profil du foyer (revenu annuel, objectif de cash-flow mensuel).',
            parameters: {
                type: 'object',
                properties: {
                    income: { type: 'number', description: 'Revenu annuel du foyer en euros' },
                    objectifCF: { type: 'number', description: 'Objectif de cash-flow net-net mensuel en euros' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'ajouter_frais_bien',
            description: 'Ajoute une dépense/des travaux sur un bien détenu précis du portefeuille.',
            parameters: {
                type: 'object',
                properties: {
                    assetId: { type: 'string', description: "Identifiant du bien (champ 'id' dans le contexte portefeuille fourni)" },
                    description: { type: 'string', description: 'Description de la dépense' },
                    montant: { type: 'number', description: 'Montant en euros' },
                    date: { type: 'string', description: "Date au format YYYY-MM-DD, aujourd'hui si non précisée" },
                    tag: { type: 'string', enum: ALLOWED_TAGS, description: 'Statut fiscal si connu, sinon a-classifier' }
                },
                required: ['assetId', 'description', 'montant']
            }
        }
    }
];

exports.chatPortefeuille = onCall({ secrets: [mammouthApiKey], region: 'europe-west1', timeoutSeconds: 90 }, async (request) => {
    _requireTextCaller(request);
    const { messages, contextePortefeuille } = request.data || {};

    if (!Array.isArray(messages) || !messages.length) {
        throw new HttpsError('invalid-argument', 'Historique de conversation manquant');
    }
    if (messages.length > ASSISTANT_MAX_MESSAGES) {
        throw new HttpsError('invalid-argument', 'Conversation trop longue — démarrez une nouvelle conversation');
    }
    for (const m of messages) {
        if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string'
            || m.content.length > ASSISTANT_MAX_MESSAGE_LENGTH) {
            throw new HttpsError('invalid-argument', 'Message invalide');
        }
    }

    let systemContent = ASSISTANT_SYSTEM_PROMPT;
    if (contextePortefeuille) {
        systemContent += "\n\nContexte actuel du portefeuille de l'utilisateur (données à jour, utilise-les pour "
            + "personnaliser tes réponses) :\n" + _jsonWithinLimit(contextePortefeuille);
    }

    const message = await _callMammouth({
        logLabel: 'chatPortefeuille',
        tools: ASSISTANT_TOOLS,
        messages: [
            { role: 'system', content: systemContent },
            ...messages.map((m) => ({ role: m.role, content: m.content }))
        ]
    });

    // tool_calls relayés tels quels (id, function.name, function.arguments en JSON string) :
    // assistant-chat.js parse les arguments et affiche la carte de confirmation.
    return {
        reply: (message.content || '').trim(),
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : []
    };
});
