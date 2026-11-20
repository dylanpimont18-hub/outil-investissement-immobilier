// Connexion du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : grille de connexion (compte unique
// Firebase, PC + iPhone) affichée à la place du portefeuille tant que personne n'est connecté. Déplacé tel quel.

import { escapeHtml } from './utils.js';
import { cloudSignIn } from './owned-cloud.js';

// ─── CONNEXION (compte unique PC + iPhone) ───────────────────────────────────

// Formulaire de connexion (compte unique PC + iPhone). Sert deux conteneurs : #owned-auth-gate dans
// le panneau Portefeuille (owned.html, et index.html hors onglet actif) et #app-auth-gate, le gate
// plein écran d'index.html géré par main.js — connexion obligatoire pour toute l'app depuis le
// passage au tout-web. Câblé une seule fois par conteneur (data-wired).
export function renderAuthGateInto(gate, { title = 'Connexion' } = {}) {
    if (!gate) return;
    if (!gate.innerHTML.trim()) {
        gate.innerHTML = `
            <div class="owned-auth-gate">
                <h2>${escapeHtml(title)}</h2>
                <p class="owned-auth-gate__hint">Un seul compte, partagé entre le PC et l'iPhone.</p>
                <form id="owned-auth-form" novalidate>
                    <label class="variables-field">
                        <span class="variables-label">Email</span>
                        <input class="variables-input" type="email" name="email" required autocomplete="username">
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Mot de passe</span>
                        <input class="variables-input" type="password" name="password" required autocomplete="current-password">
                    </label>
                    <div id="owned-auth-error" class="owned-auth-gate__error" hidden></div>
                    <button type="submit" class="btn btn--primary">Se connecter</button>
                </form>
            </div>`;
    }
    if (gate.dataset.wired) return;
    gate.dataset.wired = '1';
    gate.querySelector('#owned-auth-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = gate.querySelector('#owned-auth-error');
        const btn = e.target.querySelector('button[type="submit"]');
        if (errEl) errEl.hidden = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
        try {
            await cloudSignIn(String(fd.get('email') || '').trim(), String(fd.get('password') || ''));
        } catch {
            if (errEl) { errEl.textContent = 'Email ou mot de passe incorrect.'; errEl.hidden = false; }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
        }
    });
}

export function _renderAuthGate() {
    renderAuthGateInto(document.getElementById('owned-auth-gate'), { title: 'Portefeuille — Connexion' });
}
