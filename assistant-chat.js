// Module Assistant IA — chat libre dédié à l'investissement immobilier locatif (ex. rédiger un
// email à un banquier, expliquer une situation de cash-flow). Contexte = résumé du portefeuille
// entier (buildPortfolioSummaryForAI, owned-portfolio.js), envoyé à chaque message pour que
// l'assistant reste à jour même si l'utilisateur modifie ses biens entre deux messages.
//
// Historique de conversation volontairement NON persisté (perdu à la fermeture/rechargement) —
// choix produit assumé, contrairement à l'historique des diagnostics IA (owned-portfolio.js) qui
// est sauvegardé par bien. Interface : initAssistantChat(deps) avec { state, nodes }, appelée une
// fois depuis main.js avant le premier accès à l'onglet Assistant.
//
// Actions (function calling) : le serveur (server.py, ASSISTANT_TOOLS) expose à l'IA un schéma de
// 4 outils correspondant à des mutations du portefeuille/profil. Quand l'IA choisit d'en appeler
// un, le serveur relaie le tool_call brut (jamais exécuté côté serveur) ; ce module l'affiche comme
// une carte de confirmation inline dans le fil de chat et n'exécute la mutation réelle qu'au clic
// explicite sur "Confirmer" — jamais automatiquement. Le résultat de l'action n'est PAS renvoyé à
// l'IA pour un nouveau tour (pas de round-trip tool → assistant) : un message système confirme
// l'action dans le fil, ce qui suffit pour ce cas d'usage et évite la complexité d'un vrai protocole
// multi-tours function-calling côté serveur.

import { escapeHtml, showToast } from './utils.js';
import { buildPortfolioSummaryForAI, addOwnedNote, addOwnedTravail, addOwnedAutreCredit, patchProfileData, renderCollections, getOwnedAsset, findSimilarTravail } from './owned-portfolio.js';

let nodes;
let _messages = []; // { role: 'user'|'assistant', content: string, toolCalls?: [...], toolCallsStatus?: 'pending'|'done'|'cancelled' }
let _pending = false;

// Registre des actions exposées à l'IA — nom d'outil (doit correspondre à ASSISTANT_TOOLS côté
// serveur) → { describe(args): résumé lisible pour la carte de confirmation, run(args): exécute la
// mutation réelle et retourne un message de succès affiché dans le fil après confirmation }.
const ACTION_HANDLERS = {
    ajouter_credit_hors_immo: {
        describe: args => `Ajouter le crédit « ${args.libelle || 'Sans nom'} » — ${_formatEuros(args.mensualite)}/mois`,
        run: args => {
            addOwnedAutreCredit({ libelle: String(args.libelle || 'Crédit'), mensualite: args.mensualite });
            return `Crédit « ${args.libelle} » ajouté (${_formatEuros(args.mensualite)}/mois).`;
        }
    },
    ajouter_note_bien: {
        describe: (args, ctx) => `Ajouter une note sur « ${_nomBien(args.assetId, ctx)} » : « ${args.text || ''} »`,
        validate: _validateAssetId,
        run: args => {
            addOwnedNote(args.assetId, args.text);
            return `Note ajoutée sur le bien.`;
        }
    },
    modifier_profil_foyer: {
        describe: args => {
            const parts = [];
            if (args.income !== undefined) parts.push(`Revenu du foyer → ${_formatEuros(args.income)}/an`);
            if (args.objectifCF !== undefined) parts.push(`Objectif de CF mensuel → ${_formatEuros(args.objectifCF)}/mois`);
            return parts.join(' · ') || 'Modifier le profil du foyer';
        },
        run: args => {
            patchProfileData(args);
            return `Profil du foyer mis à jour.`;
        }
    },
    ajouter_frais_bien: {
        describe: (args, ctx) => `Ajouter une dépense sur « ${_nomBien(args.assetId, ctx)} » : ${args.description || ''} — ${_formatEuros(args.montant)}`,
        warn: args => {
            const asset = getOwnedAsset(args.assetId);
            const doublon = asset ? findSimilarTravail(asset, { montant: args.montant, date: args.date }) : null;
            return doublon
                ? `Une dépense très proche existe déjà sur ce bien : « ${doublon.description || 'sans description'} » du ${doublon.date} (${_formatEuros(doublon.montant)}). Vérifiez qu'il ne s'agit pas d'un doublon avant de confirmer.`
                : null;
        },
        validate: _validateAssetId,
        run: args => {
            addOwnedTravail(args.assetId, {
                description: args.description,
                montant: args.montant,
                date: args.date || new Date().toISOString().slice(0, 10),
                tag: args.tag
            });
            return `Dépense ajoutée sur le bien.`;
        }
    }
};

function _formatEuros(v) {
    const n = Number(v);
    return Number.isFinite(n) ? `${Math.round(n).toLocaleString('fr-FR')} €` : '—';
}

function _nomBien(assetId, ctx) {
    const bien = ctx?.biens?.find(b => b.id === assetId);
    return bien ? bien.nom : (assetId || 'bien inconnu');
}

// L'IA peut halluciner un assetId qui n'existe pas (ou plus, si le bien a été supprimé entre le
// moment où le contexte a été envoyé et le clic sur Confirmer) — addOwnedNote/addOwnedTravail
// échouent silencieusement dans ce cas (pas d'exception, pas de retour), donc sans cette vérification
// explicite l'utilisateur verrait "Confirmé" alors que rien n'a réellement été écrit.
function _validateAssetId(args, ctx) {
    if (!ctx?.biens?.some(b => b.id === args.assetId)) {
        return `Bien introuvable (le portefeuille a peut-être changé depuis ce message) — relancez la demande.`;
    }
    return null;
}

export function initAssistantChat(deps) {
    nodes = deps.nodes;
    const form = document.getElementById('assistant-chat-form');
    const input = document.getElementById('assistant-chat-input');
    if (!form || !input) return;

    form.addEventListener('submit', e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || _pending) return;
        input.value = '';
        _sendMessage(text);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.requestSubmit();
        }
    });

    document.getElementById('assistant-chat-messages')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-action-confirm], [data-action-cancel]');
        if (!btn) return;
        const msgIdx = Number(btn.dataset.msgIndex);
        const callIdx = Number(btn.dataset.callIndex);
        const message = _messages[msgIdx];
        if (!message || !message.toolCalls || !message.toolCalls[callIdx]) return;
        if (btn.dataset.actionConfirm !== undefined) {
            _executeToolCall(message, callIdx);
        } else {
            message.toolCalls[callIdx].status = 'cancelled';
            _renderMessages();
        }
    });

    document.getElementById('assistant-chat-new')?.addEventListener('click', () => {
        if (_pending) return;
        _messages = [];
        _renderMessages();
    });
}

function _executeToolCall(message, callIdx) {
    const call = message.toolCalls[callIdx];
    const handler = ACTION_HANDLERS[call.name];
    if (!handler) { call.status = 'cancelled'; _renderMessages(); return; }
    const validationError = handler.validate ? handler.validate(call.args, call.contextSnapshot) : null;
    if (validationError) {
        call.status = 'error';
        call.resultText = validationError;
        showToast(validationError, 'negative');
        _renderMessages();
        return;
    }
    try {
        const resultText = handler.run(call.args);
        call.status = 'done';
        call.resultText = resultText;
        renderCollections();
        showToast(resultText, 'positive');
    } catch (err) {
        call.status = 'error';
        call.resultText = `Échec : ${err.message}`;
        showToast(call.resultText, 'negative');
    }
    _renderMessages();
}

function _renderActionCard(message, msgIndex, call, callIndex) {
    const handler = ACTION_HANDLERS[call.name];
    const description = handler ? handler.describe(call.args, call.contextSnapshot) : call.name;
    const warningText = handler?.warn ? handler.warn(call.args, call.contextSnapshot) : null;
    const status = call.status || 'pending';

    if (status === 'pending') {
        return `
        <div class="assistant-chat__action-card">
            <p class="assistant-chat__action-desc">${escapeHtml(description)}</p>
            ${warningText ? `<p class="assistant-chat__action-warning">⚠ ${escapeHtml(warningText)}</p>` : ''}
            <div class="assistant-chat__action-buttons">
                <button type="button" class="btn btn--ghost btn--sm" data-action-cancel data-msg-index="${msgIndex}" data-call-index="${callIndex}">Annuler</button>
                <button type="button" class="btn btn--primary btn--sm" data-action-confirm data-msg-index="${msgIndex}" data-call-index="${callIndex}">Confirmer</button>
            </div>
        </div>`;
    }
    if (status === 'done') {
        return `<div class="assistant-chat__action-card assistant-chat__action-card--done">✓ ${escapeHtml(call.resultText || description)}</div>`;
    }
    if (status === 'error') {
        return `<div class="assistant-chat__action-card assistant-chat__action-card--error">${escapeHtml(call.resultText || 'Échec de l\'action')}</div>`;
    }
    return `<div class="assistant-chat__action-card assistant-chat__action-card--cancelled">Action annulée : ${escapeHtml(description)}</div>`;
}

function _renderMessages() {
    const wrap = document.getElementById('assistant-chat-messages');
    if (!wrap) return;
    const newBtn = document.getElementById('assistant-chat-new');
    if (newBtn) newBtn.disabled = !_messages.length;
    if (!_messages.length) {
        wrap.innerHTML = `<p class="assistant-chat__empty">Posez votre première question — par exemple « Rédige un email à mon banquier pour expliquer un cash-flow négatif temporaire ».</p>`;
        return;
    }
    wrap.innerHTML = _messages.map((m, msgIndex) => {
        const bubble = m.content
            ? `<div class="assistant-chat__bubble assistant-chat__bubble--${m.role}">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>`
            : '';
        const cards = (m.toolCalls || []).map((call, callIndex) => _renderActionCard(m, msgIndex, call, callIndex)).join('');
        return bubble + cards;
    }).join('') + (_pending ? `<div class="assistant-chat__bubble assistant-chat__bubble--assistant assistant-chat__bubble--pending">…</div>` : '');
    wrap.scrollTop = wrap.scrollHeight;
}

async function _sendMessage(text) {
    _messages.push({ role: 'user', content: text });
    _pending = true;
    _renderMessages();

    try {
        const contexte = buildPortfolioSummaryForAI();
        const resp = await fetch('/api/portfolio-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: _messages.map(m => ({ role: m.role, content: m.content })),
                contextePortefeuille: contexte
            })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            _messages.push({ role: 'assistant', content: `Erreur : ${data.error || 'réponse invalide'}` });
        } else {
            const toolCalls = (data.toolCalls || [])
                .map(tc => {
                    let args = {};
                    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
                    return ACTION_HANDLERS[tc.function?.name]
                        ? { name: tc.function.name, args, status: 'pending', contextSnapshot: contexte }
                        : null;
                })
                .filter(Boolean);
            _messages.push({ role: 'assistant', content: data.reply || '', toolCalls: toolCalls.length ? toolCalls : undefined });
        }
    } catch (err) {
        _messages.push({ role: 'assistant', content: `Erreur réseau : ${err.message}` });
    } finally {
        _pending = false;
        _renderMessages();
    }
}
