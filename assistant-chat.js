// Module Assistant IA — chat libre dédié à l'investissement immobilier locatif (ex. rédiger un
// email à un banquier, expliquer une situation de cash-flow). Contexte = résumé du portefeuille
// entier (buildPortfolioSummaryForAI, owned-portfolio.js), envoyé à chaque message pour que
// l'assistant reste à jour même si l'utilisateur modifie ses biens entre deux messages.
//
// Historique de conversation volontairement NON persisté (perdu à la fermeture/rechargement) —
// choix produit assumé, contrairement à l'historique des diagnostics IA (owned-portfolio.js) qui
// est sauvegardé par bien. Interface : initAssistantChat(deps) avec { state, nodes }, appelée une
// fois depuis main.js avant le premier accès à l'onglet Assistant.

import { escapeHtml } from './utils.js';
import { buildPortfolioSummaryForAI } from './owned-portfolio.js';

let nodes;
let _messages = []; // { role: 'user'|'assistant', content: string }
let _pending = false;

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
}

function _renderMessages() {
    const wrap = document.getElementById('assistant-chat-messages');
    if (!wrap) return;
    if (!_messages.length) {
        wrap.innerHTML = `<p class="assistant-chat__empty">Posez votre première question — par exemple « Rédige un email à mon banquier pour expliquer un cash-flow négatif temporaire ».</p>`;
        return;
    }
    wrap.innerHTML = _messages.map(m => `
        <div class="assistant-chat__bubble assistant-chat__bubble--${m.role}">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
    `).join('') + (_pending ? `<div class="assistant-chat__bubble assistant-chat__bubble--assistant assistant-chat__bubble--pending">…</div>` : '');
    wrap.scrollTop = wrap.scrollHeight;
}

async function _sendMessage(text) {
    _messages.push({ role: 'user', content: text });
    _pending = true;
    _renderMessages();

    try {
        const resp = await fetch('/api/portfolio-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: _messages,
                contextePortefeuille: buildPortfolioSummaryForAI()
            })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            _messages.push({ role: 'assistant', content: `Erreur : ${data.error || 'réponse invalide'}` });
        } else {
            _messages.push({ role: 'assistant', content: data.reply });
        }
    } catch (err) {
        _messages.push({ role: 'assistant', content: `Erreur réseau : ${err.message}` });
    } finally {
        _pending = false;
        _renderMessages();
    }
}
