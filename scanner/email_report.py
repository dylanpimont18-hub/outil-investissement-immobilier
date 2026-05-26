import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

from config import (
    EMAIL_EXPEDITEUR, EMAIL_MOT_DE_PASSE_APP, EMAIL_DESTINATAIRE,
    CODE_POSTAL, TAUX_CREDIT, ASSURANCE, DUREE_MOIS,
    LOYER_M2_APPARTEMENT, LOYER_M2_MAISON,
)

DPE_COLORS = {
    "a": "#00a550", "b": "#51b845", "c": "#c8d200",
    "d": "#ffcc00", "e": "#f4a623", "f": "#e3720c", "g": "#cc0000",
}
DPE_BADGE_INFO = {
    "g": ("DPE G — ILLÉGAL", "#cc0000"),
    "f": ("DPE F — Interdit 2028", "#e3720c"),
    "e": ("DPE E — Interdit 2034", "#f4a623"),
}


SCORE_TONE = [
    (80, "excellent", "#16a34a"),
    (60, "positif",   "#22c55e"),
    (40, "neutre",    "#f59e0b"),
    (20, "watch",     "#e3720c"),
    (0,  "négatif",   "#dc2626"),
]


def _score_badge(score):
    if score is None:
        return ""
    label, color = next(
        ((t[1], t[2]) for t in SCORE_TONE if score >= t[0]),
        ("négatif", "#dc2626"),
    )
    return (
        f'<span style="display:inline-block;padding:3px 8px;border-radius:4px;'
        f'font-size:11px;font-weight:700;background:{color};color:#fff">'
        f'{score}/100 {label}</span>'
    )


def _fmt_eur(val):
    return f"{val:,.0f} €".replace(",", " ")


def _fmt_pct(val):
    return f"{val:.1f} %"


def _badge(label, color, text_color="#fff"):
    return (
        f'<span style="display:inline-block;padding:2px 6px;border-radius:4px;'
        f'font-size:10px;font-weight:700;background:{color};color:{text_color};margin:1px 2px">'
        f'{label}</span>'
    )


def _dpe_pill(dpe):
    if not dpe:
        return ""
    color = DPE_COLORS.get(dpe, "#888")
    return _badge(f"DPE {dpe.upper()}", color)


def _occupation_badge(r):
    """Badge occupation : déjà loué, immeuble X/Y lots loués, libre."""
    if r.get("immeuble_rapport"):
        loues = r.get("lots_loues")
        total = r.get("lots_total")
        if loues is not None and total:
            pct = loues / total * 100
            color = "#16a34a" if pct >= 50 else "#f59e0b"
            return _badge(f"Immeuble {loues}/{total} loués", color)
        return _badge("Immeuble de rapport", "#0369a1")
    if r.get("deja_loue"):
        return _badge("Déjà loué ✓", "#16a34a")
    if r.get("deja_loue") is False:
        return _badge("Libre", "#64748b")
    return ""  # inconnu


def _row(r, rank):
    cf = r["cf_net"]
    cf_cls = "cf-pos" if cf >= 0 else "cf-neg"
    cf_sign = "+" if cf >= 0 else ""

    cf_ai = r.get("cf_apres_impot")
    cf_ai_cls = "cf-pos" if cf_ai is not None and cf_ai >= 0 else "cf-neg"
    cf_ai_sign = "+" if cf_ai is not None and cf_ai >= 0 else ""

    dscr = r.get("dscr")
    dscr_color = "#22c55e" if dscr and dscr >= 1.2 else ("#f59e0b" if dscr and dscr >= 1.0 else "#ef4444")

    # Badges
    badges = []
    dpe_alerte = r.get("dpe_alerte")
    if dpe_alerte:
        info = DPE_BADGE_INFO.get(r.get("dpe"), ("", "#888"))
        badges.append(_badge(info[0], info[1]))
    elif r.get("dpe"):
        badges.append(_dpe_pill(r["dpe"]))

    occ = _occupation_badge(r)
    if occ:
        badges.append(occ)

    if r.get("travaux"):
        montant = r.get("travaux_montant")
        label = f"Travaux ~{_fmt_eur(montant)}" if montant else "Travaux"
        badges.append(_badge(label, "#7c3aed"))

    # Surface
    surface_label = f"{r['surface']:.0f} m²"
    if r.get("surface_source") == "ia":
        surface_label += "<sup style='color:#C5A059;font-size:9px'> IA</sup>"

    # Loyer source
    loyer_note = ""
    if r.get("loyer_source") == "marche":
        loyer_note = "<sup style='color:#22c55e;font-size:9px'> marché</sup>"
    elif r.get("loyer_source") == "taux_fixe":
        loyer_note = "<sup style='color:#f59e0b;font-size:9px'> estimé</sup>"

    # Points forts / faibles IA
    points = ""
    for p in (r.get("points_forts") or [])[:2]:
        points += f'<span style="color:#22c55e;font-size:10px">✓ {p}</span><br>'
    for p in (r.get("points_faibles") or [])[:2]:
        points += f'<span style="color:#ef4444;font-size:10px">✗ {p}</span><br>'

    resume = r.get("resume_ia", "")

    cf_ai_cell = (
        f'<span class="{cf_ai_cls}">{cf_ai_sign}{_fmt_eur(cf_ai)}</span>'
        f'<br><span style="color:#888;font-size:10px">/mois (net impôt)</span>'
        if cf_ai is not None else "—"
    )
    dscr_cell = (
        f'<span style="color:{dscr_color};font-weight:700">{dscr:.2f}</span>'
        if dscr is not None else "—"
    )

    return f"""
    <tr>
      <td style="color:#888;font-size:11px;text-align:center">{rank}</td>
      <td>
        <strong style="font-size:13px">{r["titre"]}</strong><br>
        <span style="color:#888;font-size:11px">{r["ville"]} · {surface_label} · {(r.get("type_bien") or "").capitalize()}</span><br>
        {"".join(badges)}
        {"<br><em style='color:#999;font-size:11px'>" + resume + "</em>" if resume else ""}
        {"<br>" + points if points else ""}
      </td>
      <td style="white-space:nowrap">{_fmt_eur(r["prix"])}</td>
      <td style="white-space:nowrap">{_fmt_eur(r["loyer_estime"])}{loyer_note}<br><span style="color:#888;font-size:10px">/mois</span></td>
      <td style="white-space:nowrap">{_fmt_eur(r["mensualite"])}<br><span style="color:#888;font-size:10px">/mois</span></td>
      <td style="white-space:nowrap" class="{cf_cls}">{cf_sign}{_fmt_eur(cf)}<br><span style="font-size:10px">/mois</span></td>
      <td style="white-space:nowrap">{cf_ai_cell}</td>
      <td style="white-space:nowrap;text-align:center">{dscr_cell}</td>
      <td style="white-space:nowrap">{_fmt_pct(r["renta_brute"])}</td>
      <td style="white-space:nowrap">{_score_badge(r.get("score"))}</td>
      <td><a href="{r["url"]}" style="color:#C5A059;text-decoration:none;font-size:12px">Voir ↗</a></td>
    </tr>"""


def _tableau_deja_loues(resultats):
    """Second tableau : biens déjà loués (revenu immédiat garanti)."""
    loues = [
        r for r in resultats
        if r.get("calculable") and (r.get("deja_loue") or r.get("lots_loues"))
    ]
    if not loues:
        return ""

    rows = ""
    for r in loues:
        cf = r["cf_net"]
        cf_cls = "cf-pos" if cf >= 0 else "cf-neg"
        cf_sign = "+" if cf >= 0 else ""

        # Statut occupation
        if r.get("immeuble_rapport") and r.get("lots_total"):
            loues_n = r.get("lots_loues", "?")
            total_n = r.get("lots_total")
            occupation = f'{loues_n}/{total_n} lots loués'
            occ_color = "#16a34a" if (r.get("lots_loues") or 0) >= (total_n or 1) / 2 else "#f59e0b"
        else:
            occupation = "Déjà loué"
            occ_color = "#16a34a"

        surface_label = f"{r['surface']:.0f} m²" if r.get("surface") else "—"

        rows += f"""
        <tr>
          <td><strong style="font-size:13px">{r["titre"]}</strong><br>
            <span style="color:#888;font-size:11px">{r["ville"]} · {surface_label} · {(r.get("type_bien") or "").capitalize()}</span><br>
            {"<em style='color:#999;font-size:11px'>" + r.get("resume_ia","") + "</em>" if r.get("resume_ia") else ""}
          </td>
          <td style="white-space:nowrap">{_fmt_eur(r["prix"])}</td>
          <td style="white-space:nowrap">{_fmt_eur(r["loyer_estime"])}<br><span style="color:#888;font-size:10px">/mois</span></td>
          <td style="white-space:nowrap">{_fmt_eur(r["mensualite"])}<br><span style="color:#888;font-size:10px">/mois</span></td>
          <td style="white-space:nowrap" class="{cf_cls}">{cf_sign}{_fmt_eur(cf)}<br><span style="font-size:10px">/mois</span></td>
          <td style="white-space:nowrap">{_fmt_pct(r["renta_brute"])}</td>
          <td><span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;background:{occ_color};color:#fff">{occupation}</span></td>
          <td><a href="{r["url"]}" style="color:#C5A059;text-decoration:none;font-size:12px">Voir ↗</a></td>
        </tr>"""

    return f"""
    <div style="padding:0 0 0 0;border-top:1px solid #eae8e2">
      <div class="sec" style="padding:16px 32px 8px;font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:1px">
        Biens déjà loués — revenu locatif immédiat ({len(loues)} bien{"s" if len(loues) > 1 else ""})
      </div>
      <table class="main">
        <thead>
          <tr>
            <th>Bien</th>
            <th>Prix</th>
            <th>Loyer estimé</th>
            <th>Mensualité</th>
            <th>CF net</th>
            <th>Renta brute</th>
            <th>Occupation</th>
            <th>Lien</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>"""


def _tableau_marche(marche):
    """Génère la section HTML du tableau d'analyse du marché locatif."""
    if not marche:
        return ""

    def _section(type_bien, label):
        if type_bien not in marche:
            return ""
        data = marche[type_bien]
        g = data["global"]
        tranches = data["tranches"]

        rows = ""
        for t in tranches:
            if t["n"] == 0:
                rows += f'<tr><td>{t["label"]}</td><td colspan="4" style="color:#ccc;text-align:center">— aucune donnée —</td></tr>'
            else:
                rows += (
                    f'<tr>'
                    f'<td>{t["label"]}</td>'
                    f'<td style="text-align:center">{t["n"]}</td>'
                    f'<td style="text-align:right">{_fmt_eur(t["loyer_median"])}</td>'
                    f'<td style="text-align:right">{t["loyer_m2_median"]:.2f} €/m²</td>'
                    f'<td style="text-align:right;color:#888;font-size:11px">{_fmt_eur(t["loyer_min"])} – {_fmt_eur(t["loyer_max"])}</td>'
                    f'</tr>'
                )

        return f"""
        <div style="margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:#C5A059;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">{label}</div>
          <div style="font-size:11px;color:#888;margin-bottom:8px">{g["n"]} annonces analysées · loyer médian global : <strong>{_fmt_eur(g["loyer_median"])}/mois</strong> · <strong>{g["loyer_m2_median"]:.2f} €/m²</strong></div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f0ede7">
                <th style="padding:6px 10px;text-align:left;color:#444">Tranche surface</th>
                <th style="padding:6px 10px;text-align:center;color:#444">N</th>
                <th style="padding:6px 10px;text-align:right;color:#444">Loyer médian</th>
                <th style="padding:6px 10px;text-align:right;color:#444">€/m² médian</th>
                <th style="padding:6px 10px;text-align:right;color:#444">Fourchette</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>"""

    total = marche.get("_total_annonces", "?")
    filtres = marche.get("_total_apres_filtre", "?")

    return f"""
    <div style="padding:16px 32px;background:#faf9f5;border-top:1px solid #eae8e2">
      <div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">
        Analyse du marché locatif — CP {CODE_POSTAL}
        <span style="font-weight:400;color:#bbb;margin-left:8px">{total} annonces · {filtres} après filtre</span>
      </div>
      {_section("appartement", "Appartements")}
      {_section("maison", "Maisons")}
    </div>"""


def build_html(resultats, stats, marche=None):
    date_str = datetime.now().strftime("%d/%m/%Y")
    top10 = resultats[:10]
    rows = "".join(_row(r, i + 1) for i, r in enumerate(top10))
    label_run = "Première analyse complète" if stats["is_first_run"] else "Nouvelles annonces"
    ia_label = " · IA Claude Haiku" if stats.get("ia_active") else ""
    meilleur_cf = stats["meilleur_cf"]
    cf_sign = "+" if meilleur_cf >= 0 else ""

    # Calculs supplémentaires pour les stat cards
    cf_ai_values = [r["cf_apres_impot"] for r in resultats if r.get("cf_apres_impot") is not None]
    meilleur_cf_ai = max(cf_ai_values) if cf_ai_values else None
    cf_ai_sign = "+" if meilleur_cf_ai is not None and meilleur_cf_ai >= 0 else ""
    cf_ai_cls = "cf-pos" if meilleur_cf_ai is not None and meilleur_cf_ai >= 0 else "cf-neg"

    scores = [r["score"] for r in resultats if r.get("score") is not None]
    score_moyen = round(sum(scores) / len(scores)) if scores else None

    dpe_warn = ""
    if stats.get("dpe_risque"):
        dpe_warn = (
            f'<div style="background:#fff3cd;border-left:3px solid #f4a623;padding:10px 16px;'
            f'margin:12px 0;font-size:12px;color:#7c4700">'
            f'⚠️ <strong>{stats["dpe_risque"]} annonce(s)</strong> avec DPE à risque (E/F/G) '
            f'— vérifiez la légalité avant investissement.</div>'
        )

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{margin:0;padding:20px;background:#f0efe9;font-family:Arial,Helvetica,sans-serif}}
  .wrap{{max-width:960px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)}}
  .hd{{background:#13131f;padding:28px 32px}}
  .hd h1{{margin:0 0 6px;font-size:20px;color:#C5A059;letter-spacing:.5px}}
  .hd p{{margin:0;color:#8a8a9a;font-size:13px}}
  .stats{{display:flex;background:#f8f6f1;padding:20px 32px;gap:8px;flex-wrap:wrap;border-bottom:1px solid #eae8e2}}
  .sc{{flex:1;min-width:110px;text-align:center;padding:12px 8px;background:#fff;border-radius:8px;border:1px solid #eae8e2}}
  .sv{{font-size:22px;font-weight:700;color:#13131f}}
  .sl{{font-size:11px;color:#999;margin-top:4px;text-transform:uppercase;letter-spacing:.5px}}
  .warn{{padding:0 32px}}
  .sec{{padding:16px 32px 8px;font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:1px}}
  table.main{{width:100%;border-collapse:collapse}}
  table.main th{{background:#13131f;color:#C5A059;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}}
  table.main td{{padding:10px 12px;border-bottom:1px solid #f0ede7;font-size:13px;vertical-align:top}}
  table.main tr:last-child td{{border-bottom:none}}
  table.main tr:hover td{{background:#faf9f5}}
  .cf-pos{{color:#22c55e;font-weight:700}}
  .cf-neg{{color:#ef4444;font-weight:700}}
  .ft{{padding:16px 32px;background:#f8f6f1;color:#999;font-size:11px;border-top:1px solid #eae8e2}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hd">
    <h1>Spark Scanner · {date_str}</h1>
    <p>{label_run} · CP {CODE_POSTAL} · Crédit {DUREE_MOIS // 12} ans à {TAUX_CREDIT}% + assurance {ASSURANCE}%{ia_label}</p>
  </div>

  <div class="stats">
    <div class="sc"><div class="sv">{stats["nouvelles"]}</div><div class="sl">Annonces analysées</div></div>
    <div class="sc"><div class="sv" style="color:#22c55e">{stats["positifs"]}</div><div class="sl">CF positif</div></div>
    <div class="sc"><div class="sv">{stats["pct_positifs"]:.0f}%</div><div class="sl">Taux positif</div></div>
    <div class="sc"><div class="sv {'cf-pos' if meilleur_cf >= 0 else 'cf-neg'}">{cf_sign}{meilleur_cf:.0f} €</div><div class="sl">Meilleur CF net</div></div>
    {f'<div class="sc"><div class="sv {cf_ai_cls}">{cf_ai_sign}{meilleur_cf_ai:.0f} €</div><div class="sl">Meilleur CF après impôt</div></div>' if meilleur_cf_ai is not None else ""}
    <div class="sc"><div class="sv">{_fmt_pct(stats["meilleur_renta"])}</div><div class="sl">Meilleur renta brute</div></div>
    {f'<div class="sc"><div class="sv" style="color:#C5A059">{score_moyen}/100</div><div class="sl">Score moyen</div></div>' if score_moyen is not None else ""}
    {f'<div class="sc"><div class="sv" style="color:#e3720c">{stats["dpe_risque"]}</div><div class="sl">Alertes DPE</div></div>' if stats.get("dpe_risque") else ""}
  </div>

  <div class="warn">{dpe_warn}</div>

  <div class="sec">Top {len(top10)} opportunités — triées par cash-flow net avant impôt</div>
  <table class="main">
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>Bien</th>
        <th>Prix</th>
        <th>Loyer estimé</th>
        <th>Mensualité</th>
        <th>CF net</th>
        <th>CF après impôt</th>
        <th style="text-align:center">DSCR</th>
        <th>Renta brute</th>
        <th>Score</th>
        <th>Lien</th>
      </tr>
    </thead>
    <tbody>{rows}</tbody>
  </table>

  {_tableau_deja_loues(resultats)}
  {_tableau_marche(marche)}

  <div class="ft">
    Loyers : données marché locatif LeBonCoin du jour (badge <span style="color:#22c55e">marché</span>) ou taux estimés {LOYER_M2_APPARTEMENT} €/m² / {LOYER_M2_MAISON} €/m² (badge <span style="color:#f59e0b">estimé</span>).<br>
    Charges copro : 25 €/mois (appt, si non renseignées). Taxe foncière &amp; vacance : 1 mois/an chacune.<br>
    <sup>IA</sup> Données extraites par Claude Haiku. Vérifiez chaque annonce avant toute décision.
  </div>
</div>
</body>
</html>"""


def envoyer(resultats, stats, marche=None):
    date_str = datetime.now().strftime("%d/%m/%Y")
    meilleur_cf = stats["meilleur_cf"]
    cf_sign = "+" if meilleur_cf >= 0 else ""
    sujet = (
        f"[Spark Scanner] {stats['nouvelles']} annonces — "
        f"meilleur CF : {cf_sign}{meilleur_cf:.0f}€/mois — {date_str}"
    )

    html = build_html(resultats, stats, marche)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = sujet
    msg["From"] = EMAIL_EXPEDITEUR
    msg["To"] = EMAIL_DESTINATAIRE
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as srv:
        srv.login(EMAIL_EXPEDITEUR, EMAIL_MOT_DE_PASSE_APP)
        srv.sendmail(EMAIL_EXPEDITEUR, EMAIL_DESTINATAIRE, msg.as_string())
