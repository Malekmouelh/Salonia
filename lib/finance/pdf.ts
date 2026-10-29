// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/pdf.ts — LA GÉNÉRATION DES DOCUMENTS PDF
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Fabrique trois documents PDF avec la bibliothèque `pdf-lib` : la FACTURE, le REÇU et le
//   RAPPORT FINANCIER. Le PDF est construit « à la main » : on dessine des rectangles, des
//   lignes et du texte à des coordonnées précises, comme sur une feuille quadrillée.
//
// SYSTÈME DE COORDONNÉES PDF (à connaître)
//   • L'unité est le « point » (1/72 de pouce). Une page A4 = 595,28 × 841,89 points.
//   • L'origine (0, 0) est en BAS à GAUCHE (et non en haut comme sur une page web) :
//     x augmente vers la droite, y augmente vers le HAUT. Pour « descendre » dans la page, on
//     DIMINUE y. C'est pourquoi on voit partout `ctx.y -= …`.
//
// COMMENT ÇA MARCHE
//   Un petit « contexte » (ctx) mémorise la page courante, les polices et la position verticale y
//   (le « curseur »). Chaque fonction dessine à la position courante puis fait descendre le curseur.
//
// LES 3 DOCUMENTS ONT UNE STRUCTURE EN 3 ÉTAPES : (1) on prépare les DONNÉES (types *PdfData,
// remplis par documents.ts) ; (2) on dessine ; (3) `doc.save()` renvoie les octets du PDF.
// ═══════════════════════════════════════════════════════════════════════════
import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { METHOD_LABELS, KIND_LABELS } from "./labels";
import { plainTnd, vatBreakdown } from "./money";

// F6.3 / F6.6 — Factures, reçus et rapport financier en PDF (A4), générés côté serveur.
// Polices standard PDF (jeu de caractères latin) : les caractères non latins sont remplacés.

// Palette de la charte graphique (valeurs rouge/vert/bleu entre 0 et 1) : prune, rose doré, gris, gris clair.
const PLUM = rgb(0.165, 0.059, 0.145);
const ROSE = rgb(0.91, 0.706, 0.627);
const GREY = rgb(0.42, 0.4, 0.43);
const LIGHT = rgb(0.96, 0.94, 0.95);
// Dimensions d'une page A4 en points, et marge de 48 points sur les 4 côtés.
const A4: [number, number] = [595.28, 841.89];
const M = 48;

// Caractères encodables en WinAnsi (polices standard PDF).
// Les polices intégrées à tout lecteur PDF (Helvetica…) ne connaissent que l'alphabet latin : un
// caractère arabe ferait planter la génération. `safe` prépare donc le texte :
//   1) normalize("NFC") assemble les lettres accentuées ;
//   2) les espaces « insécables » (U+202F et U+00A0, produites par le formatage français des nombres)
//      deviennent des espaces simples ;
//   3) tout caractère hors de l'alphabet latin autorisé est remplacé par « ? ».
const safe = (text: string) =>
  text
    .normalize("NFC")
    .replace(/[  ]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF—–‘’“”•…€]/g, "?");

// Format français : 28 906,750 DT (espaces fines remplacées par des espaces simples dans safe()).
// `Intl.NumberFormat("fr-FR")` met les espaces de milliers et la virgule décimale ; toujours 3 décimales (millimes).
const money = (v: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(plainTnd(v)))} DT`;

// Date au format JJ/MM/AAAA (+ heure si demandé), toujours en heure de Tunis.
const dateFmt = (d: Date, withTime = false) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    // `...(condition ? {…} : {})` : n'ajoute les options d'heure que si `withTime` est vrai.
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    timeZone: "Africa/Tunis",
  }).format(d);

// Le « contexte » de dessin : le document, la page courante, les deux polices et le curseur vertical y.
type Ctx = { doc: PDFDocument; page: PDFPage; font: PDFFont; bold: PDFFont; y: number };

// Crée un document vide avec sa première page et place le curseur en haut (sous la marge).
async function start(): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setProducer("Salonia"); // métadonnées visibles dans les propriétés du PDF
  doc.setCreator("Salonia");
  const page = doc.addPage(A4);
  return { doc, page, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), y: A4[1] - M };
}

// Écrit une ligne de texte à la position (x, y courant). Options : taille, gras, couleur, alignement
// (« left » = x est le bord gauche ; « right » = x est le bord DROIT du texte) et un y imposé.
function text(ctx: Ctx, value: string, x: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right"; y?: number } = {}) {
  const font = opts.bold ? ctx.bold : ctx.font;
  const size = opts.size ?? 10;
  const s = safe(value);
  // Largeur réelle du texte avec cette police : nécessaire pour l'alignement à droite (x − largeur).
  const width = font.widthOfTextAtSize(s, size);
  ctx.page.drawText(s, { x: opts.align === "right" ? x - width : x, y: opts.y ?? ctx.y, size, font, color: opts.color ?? PLUM });
}

// Tronque un texte pour qu'il tienne dans une largeur donnée.
// Tant que le texte est trop large, on retire 4 caractères et on ajoute « ... ».
function fit(ctx: Ctx, value: string, width: number, size = 10) {
  let s = safe(value);
  while (s.length > 3 && ctx.font.widthOfTextAtSize(s, size) > width) s = `${s.slice(0, -4)}...`;
  return s;
}

// Saut de page automatique : s'il ne reste pas assez de place (`needed` points) avant le bas de page
// (marge + 30 pour le pied de page), on ajoute une page et on remet le curseur en haut.
function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed > M + 30) return;
  ctx.page = ctx.doc.addPage(A4);
  ctx.y = A4[1] - M;
}

// En-tête commun à la facture et au reçu : bandeau rose, nom du salon, titre du document,
// nom/adresse/téléphone du centre, numéro et date.
function header(ctx: Ctx, org: { name: string }, center: { name: string; address?: string | null; phone?: string | null }, title: string, number: string, date: Date) {
  ctx.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: ROSE }); // bandeau en haut de page
  text(ctx, org.name, M, { size: 20, bold: true }); // à gauche
  text(ctx, title, A4[0] - M, { size: 18, bold: true, align: "right" }); // à droite (même ligne)
  ctx.y -= 18; // on descend d'une ligne
  text(ctx, center.name, M, { color: GREY });
  text(ctx, `N° ${number}`, A4[0] - M, { bold: true, align: "right" });
  ctx.y -= 14;
  if (center.address) text(ctx, center.address, M, { color: GREY });
  text(ctx, `Date : ${dateFmt(date, true)}`, A4[0] - M, { align: "right", color: GREY });
  ctx.y -= center.address ? 14 : 0; // on ne descend que si une ligne « adresse » a été écrite
  if (center.phone) {
    text(ctx, `Tél. : ${center.phone}`, M, { color: GREY });
    ctx.y -= 14;
  }
  ctx.y -= 18;
}

// Pied de page dessiné sur TOUTES les pages à la fin (ligne fine + phrase de mention).
// `extra` : texte libre facultatif (mentions légales du salon, voir les paramètres financiers), coupé en
// lignes d'environ 120 caractères et placé sous la ligne principale (2 lignes maximum).
function footer(ctx: Ctx, note: string, extra?: string | null) {
  const extraLines = wrap(safe(extra ?? ""), 120).slice(0, 2);
  for (const page of ctx.doc.getPages()) {
    page.drawLine({ start: { x: M, y: M }, end: { x: A4[0] - M, y: M }, thickness: 0.5, color: ROSE });
    const s = safe(note);
    page.drawText(s, { x: M, y: M - 14, size: 8, font: ctx.font, color: GREY });
    extraLines.forEach((line, i) => page.drawText(line, { x: M, y: M - 25 - i * 10, size: 7.5, font: ctx.font, color: GREY }));
  }
}

// Coupe un texte en lignes de `max` caractères au plus, en ne coupant qu'entre deux mots.
function wrap(value: string, max: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > max) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ═════════════════════════ 1) LA FACTURE ═════════════════════════

// Toutes les données nécessaires à une facture (remplies par loadInvoicePdf dans documents.ts).
export type InvoicePdfData = {
  organization: { name: string };
  center: { name: string; address?: string | null; phone?: string | null };
  number: string;
  issuedAt: Date;
  status: string;
  customerName: string;
  customerPhone?: string | null;
  lines: { label: string; quantity: number; unitPriceTnd: number; totalTnd: number }[];
  subtotalTnd: number;
  discountTnd: number;
  totalTnd: number;
  vatRate: number;
  paidTnd: number;
  payments: { paidAt: Date; method: string; kind: string; amountTnd: number; receiptNumber: string | null }[];
  cancelReason?: string | null;
  // Mentions légales configurées par le salon (paramètres financiers) : matricule fiscal et pied de facture.
  taxId?: string | null;
  footerNote?: string | null;
};

// Dessine la facture et renvoie les octets du PDF (Uint8Array).
export async function invoicePdf(data: InvoicePdfData) {
  const ctx = await start();
  ctx.doc.setTitle(`Facture ${data.number}`);
  header(ctx, data.organization, data.center, "FACTURE", data.number, data.issuedAt);

  // Encadré « Facturé à » (rectangle gris clair + nom et téléphone du client).
  ctx.page.drawRectangle({ x: M, y: ctx.y - 34, width: 240, height: 46, color: LIGHT });
  text(ctx, "Facturé à", M + 10, { size: 8, color: GREY });
  ctx.y -= 14;
  text(ctx, data.customerName, M + 10, { bold: true, size: 11 });
  ctx.y -= 13;
  if (data.customerPhone) text(ctx, `+216 ${data.customerPhone}`, M + 10, { color: GREY, size: 9 });
  // Facture annulée : mention rouge « FACTURE ANNULÉE » + motif, à droite de l'encadré.
  if (data.status === "CANCELLED") {
    text(ctx, "FACTURE ANNULÉE", A4[0] - M, { bold: true, size: 14, color: rgb(0.75, 0.15, 0.2), align: "right", y: ctx.y + 13 });
    if (data.cancelReason) text(ctx, `Motif : ${data.cancelReason}`, A4[0] - M, { size: 9, color: GREY, align: "right" });
  }
  ctx.y -= 36;

  // ── Tableau des lignes ──
  // Position horizontale de chaque colonne (x). Les colonnes numériques sont alignées à droite.
  const cols = { label: M + 8, qty: 360, unit: 450, total: A4[0] - M - 8 };
  // Ligne d'en-tête du tableau : bandeau prune avec texte blanc.
  ctx.page.drawRectangle({ x: M, y: ctx.y - 6, width: A4[0] - 2 * M, height: 22, color: PLUM });
  const white = rgb(1, 1, 1);
  text(ctx, "Prestation", cols.label, { bold: true, color: white, size: 9 });
  text(ctx, "Qté", cols.qty, { bold: true, color: white, size: 9, align: "right" });
  text(ctx, "Prix unitaire TTC", cols.unit, { bold: true, color: white, size: 9, align: "right" });
  text(ctx, "Total TTC", cols.total, { bold: true, color: white, size: 9, align: "right" });
  ctx.y -= 24;
  // Une ligne de tableau par ligne de facture (avec saut de page si besoin).
  for (const line of data.lines) {
    ensureSpace(ctx, 20);
    text(ctx, fit(ctx, line.label, 270), cols.label); // libellé tronqué s'il est trop long
    text(ctx, String(line.quantity), cols.qty, { align: "right" });
    text(ctx, money(line.unitPriceTnd), cols.unit, { align: "right" });
    text(ctx, money(line.totalTnd), cols.total, { align: "right" });
    ctx.y -= 8;
    // Filet fin de séparation sous la ligne.
    ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: A4[0] - M, y: ctx.y }, thickness: 0.4, color: LIGHT });
    ctx.y -= 12;
  }

  // ── Bloc des totaux ──
  ensureSpace(ctx, 120);
  ctx.y -= 6;
  // Détail HT / TVA déduit du TTC (voir vatBreakdown dans money.ts).
  const vat = vatBreakdown(data.totalTnd, data.vatRate);
  // Chaque ligne : [libellé, valeur, mise en valeur ?]. Le 3e élément (optionnel) met la ligne en gras sur fond gris.
  const rows: [string, string, boolean?][] = [["Sous-total", money(data.subtotalTnd)]];
  if (data.discountTnd > 0) rows.push(["Remise", `- ${money(data.discountTnd)}`]); // ligne « Remise » seulement s'il y en a une
  rows.push(
    ["Total HT", money(vat.ht)],
    [`TVA ${Math.round(data.vatRate * 100)} % (incluse)`, money(vat.vat)],
    ["Total TTC", money(data.totalTnd), true],
    ["Déjà réglé", money(data.paidTnd)],
    ["Reste à payer", money(Math.max(0, data.totalTnd - data.paidTnd)), true],
  );
  for (const [label, value, strong] of rows) {
    // Fond gris derrière les lignes importantes.
    if (strong) ctx.page.drawRectangle({ x: 330, y: ctx.y - 5, width: A4[0] - M - 330, height: 18, color: LIGHT });
    text(ctx, label, 340, { bold: strong, size: strong ? 11 : 10 });
    text(ctx, value, cols.total, { bold: strong, size: strong ? 11 : 10, align: "right" });
    ctx.y -= 18;
  }

  // ── Liste des règlements (paiements rattachés à la facture) ──
  if (data.payments.length) {
    ensureSpace(ctx, 40 + data.payments.length * 14);
    ctx.y -= 14;
    text(ctx, "Règlements", M, { bold: true, size: 11 });
    ctx.y -= 16;
    for (const p of data.payments) {
      // Un remboursement est affiché avec un signe « - » devant le montant.
      const sign = p.kind === "REFUND" ? "- " : "";
      text(ctx, `${dateFmt(p.paidAt, true)} · ${KIND_LABELS[p.kind as keyof typeof KIND_LABELS] ?? p.kind} · ${METHOD_LABELS[p.method as keyof typeof METHOD_LABELS] ?? p.method}${p.receiptNumber ? ` · reçu ${p.receiptNumber}` : ""}`, M, { size: 9, color: GREY });
      text(ctx, `${sign}${money(p.amountTnd)}`, cols.total, { size: 9, align: "right" });
      ctx.y -= 14;
    }
  }

  footer(
    ctx,
    `${data.organization.name}${data.taxId ? ` · MF ${data.taxId}` : ""} · Montants en dinars tunisiens (TTC) · Merci de votre visite · Généré par Salonia`,
    data.footerNote,
  );
  return ctx.doc.save(); // sérialise le document en octets
}

// ═════════════════════════ 2) LE REÇU ═════════════════════════

// Données d'un reçu (une preuve de paiement : encaissement, acompte ou remboursement).
export type ReceiptPdfData = {
  organization: { name: string };
  center: { name: string; address?: string | null; phone?: string | null };
  receiptNumber: string;
  paidAt: Date;
  kind: string;
  method: string;
  amountTnd: number;
  reference?: string | null;
  customerName: string;
  services?: string | null;
  bookingStart?: Date | null;
  invoiceNumber?: string | null;
  remainingTnd?: number | null;
  note?: string | null;
};

export async function receiptPdf(data: ReceiptPdfData) {
  const ctx = await start();
  ctx.doc.setTitle(`Reçu ${data.receiptNumber}`);
  // Le titre dépend de la nature du paiement.
  const title = data.kind === "REFUND" ? "REMBOURSEMENT" : data.kind === "DEPOSIT" ? "REÇU D'ACOMPTE" : "REÇU";
  header(ctx, data.organization, data.center, title, data.receiptNumber, data.paidAt);

  // Grand encadré avec le montant en gros caractères et le moyen de paiement.
  ctx.page.drawRectangle({ x: M, y: ctx.y - 60, width: A4[0] - 2 * M, height: 78, color: LIGHT });
  text(ctx, data.kind === "REFUND" ? "Montant remboursé" : "Montant reçu", M + 16, { size: 9, color: GREY });
  ctx.y -= 34;
  text(ctx, money(data.amountTnd), M + 16, { size: 28, bold: true });
  ctx.y -= 18;
  text(ctx, METHOD_LABELS[data.method as keyof typeof METHOD_LABELS] ?? data.method, M + 16, { color: GREY });
  ctx.y -= 40;

  // Liste « libellé → valeur » : on n'ajoute que les informations disponibles.
  const rows: [string, string][] = [["Client", data.customerName]];
  if (data.services) rows.push(["Prestation", data.services]);
  if (data.bookingStart) rows.push(["Rendez-vous", dateFmt(data.bookingStart, true)]);
  if (data.reference) rows.push(["Référence", data.reference]);
  if (data.invoiceNumber) rows.push(["Facture", data.invoiceNumber]);
  if (data.remainingTnd != null) rows.push(["Reste à payer", money(data.remainingTnd)]);
  if (data.note) rows.push(["Motif", data.note]);
  for (const [label, value] of rows) {
    text(ctx, label, M, { color: GREY });
    text(ctx, fit(ctx, value, 330), 200);
    ctx.y -= 18;
  }
  footer(ctx, `${data.organization.name} · Ce reçu atteste du paiement indiqué · Généré par Salonia`);
  return ctx.doc.save();
}

// ═════════════════════════ 3) LE RAPPORT FINANCIER ═════════════════════════

// Données du rapport : indicateurs, comparaison des centres et trois classements.
export type ReportPdfData = {
  organization: { name: string };
  scopeLabel: string;
  periodLabel: string;
  generatedAt: Date;
  summary: { revenue: number; expenses: number; profit: number; margin: number | null; sales: number; averageBasket: number; refunds: number; deposits: number };
  centers: { name: string; revenue: number; expenses: number; profit: number; sales: number; averageBasket: number }[];
  services: { label: string; count: number; amount: number }[];
  expenses: { label: string; amount: number }[];
  methods: { label: string; amount: number }[];
};

// F6.6 — Rapport financier PDF de la période.
export async function reportPdf(data: ReportPdfData) {
  const ctx = await start();
  ctx.doc.setTitle(`Rapport financier ${data.periodLabel}`);
  // En-tête (différent de celui de la facture : pas de numéro).
  ctx.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: ROSE });
  text(ctx, data.organization.name, M, { size: 20, bold: true });
  text(ctx, "RAPPORT FINANCIER", A4[0] - M, { size: 16, bold: true, align: "right" });
  ctx.y -= 18;
  text(ctx, `${data.scopeLabel} · ${data.periodLabel}`, M, { color: GREY });
  text(ctx, `Généré le ${dateFmt(data.generatedAt, true)}`, A4[0] - M, { color: GREY, align: "right" });
  ctx.y -= 32;

  // ── 6 « cartes » d'indicateurs, en grille de 3 colonnes × 2 lignes ──
  const s = data.summary;
  const kpis: [string, string][] = [
    ["Chiffre d'affaires encaissé", money(s.revenue)],
    ["Dépenses", money(s.expenses)],
    ["Résultat", money(s.profit)],
    ["Marge", s.margin == null ? "—" : `${Math.round(s.margin * 100)} %`],
    ["Ventes facturées", String(s.sales)],
    ["Panier moyen", money(s.averageBasket)],
  ];
  const w = (A4[0] - 2 * M - 20) / 3; // largeur d'une carte : (largeur utile − 2 espaces de 10) ÷ 3
  kpis.forEach(([label, value], i) => {
    // i % 3 = numéro de colonne (0, 1, 2) ; Math.floor(i / 3) = numéro de ligne (0 ou 1).
    const x = M + (i % 3) * (w + 10);
    const y = ctx.y - Math.floor(i / 3) * 56;
    ctx.page.drawRectangle({ x, y: y - 34, width: w, height: 48, color: LIGHT });
    text(ctx, label, x + 10, { size: 8, color: GREY, y: y });
    text(ctx, value, x + 10, { size: 14, bold: true, y: y - 22 });
  });
  ctx.y -= 128; // on descend sous les 2 rangées de cartes

  // ── Fonction locale « table » : dessine un tableau générique ──
  // title = titre ; headers = en-têtes de colonnes ; rows = lignes (tableau de textes) ;
  // widths = largeur de chaque colonne en points (la 1re colonne est alignée à gauche, les autres à droite).
  const table = (title: string, headers: string[], rows: string[][], widths: number[]) => {
    ensureSpace(ctx, 60);
    text(ctx, title, M, { bold: true, size: 12 });
    ctx.y -= 18;
    ctx.page.drawRectangle({ x: M, y: ctx.y - 5, width: A4[0] - 2 * M, height: 18, color: PLUM });
    // x avance colonne par colonne : on écrit chaque en-tête à gauche (1re colonne) ou à droite de sa colonne.
    let x = M;
    headers.forEach((h, i) => {
      text(ctx, h, i === 0 ? x + 8 : x + widths[i] - 8, { bold: true, size: 8, color: rgb(1, 1, 1), align: i === 0 ? "left" : "right" });
      x += widths[i];
    });
    ctx.y -= 20;
    for (const row of rows) {
      ensureSpace(ctx, 16);
      let cx = M;
      row.forEach((cell, i) => {
        // 1re colonne : texte tronqué pour ne pas empiéter sur la colonne suivante.
        text(ctx, i === 0 ? fit(ctx, cell, widths[0] - 16, 9) : cell, i === 0 ? cx + 8 : cx + widths[i] - 8, { size: 9, align: i === 0 ? "left" : "right" });
        cx += widths[i];
      });
      ctx.y -= 15;
    }
    if (rows.length === 0) {
      text(ctx, "Aucune donnée sur la période.", M + 8, { size: 9, color: GREY });
      ctx.y -= 15;
    }
    ctx.y -= 16;
  };

  // Les 4 tableaux du rapport. `full` = largeur utile de la page ; la 1re colonne prend « le reste »
  // (full − somme des autres colonnes) pour que le tableau remplisse exactement la largeur.
  const full = A4[0] - 2 * M;
  // La comparaison entre centres n'a de sens que s'il y a plusieurs centres.
  if (data.centers.length > 1) {
    table(
      "Comparaison entre centres",
      ["Centre", "CA", "Dépenses", "Résultat", "Ventes", "Panier moyen"],
      data.centers.map((c) => [c.name, money(c.revenue), money(c.expenses), money(c.profit), String(c.sales), money(c.averageBasket)]),
      [full - 324, 70, 70, 70, 44, 70],
    );
  }
  table("Prestations les plus vendues", ["Prestation", "Quantité", "Montant"], data.services.map((r) => [r.label, String(r.count), money(r.amount)]), [full - 180, 80, 100]);
  table("Dépenses par catégorie", ["Catégorie", "Montant"], data.expenses.map((r) => [r.label, money(r.amount)]), [full - 120, 120]);
  table("Encaissements par moyen de paiement", ["Moyen", "Montant"], data.methods.map((r) => [r.label, money(r.amount)]), [full - 120, 120]);
  ensureSpace(ctx, 30);
  text(ctx, `Acomptes encaissés : ${money(s.deposits)} · Remboursements : ${money(s.refunds)}`, M, { size: 9, color: GREY });

  footer(ctx, `${data.organization.name} · Rapport généré par Salonia · Montants en dinars tunisiens`);
  return ctx.doc.save();
}

// ═════════════════════════ 4) LE RAPPORT DE CLÔTURE DE CAISSE ═════════════════════════

// Données du rapport de clôture (équivalent du « ticket Z » d'une caisse enregistreuse).
export type ClosingPdfData = {
  organization: { name: string };
  center: { name: string; address?: string | null; phone?: string | null };
  day: string;
  closedAt: Date;
  closedBy: string;
  expected: { method: string; amountTnd: number }[];
  expectedCashTnd: number;
  countedCashTnd: number;
  varianceTnd: number;
  note?: string | null;
};

// Dessine le rapport : les montants attendus par moyen, puis le comparatif espèces attendues / comptées / écart.
export async function closingPdf(data: ClosingPdfData) {
  const ctx = await start();
  ctx.doc.setTitle(`Clôture de caisse ${data.day}`);
  header(ctx, data.organization, data.center, "CLÔTURE DE CAISSE", data.day, data.closedAt);

  // Encadré de l'écart (rouge s'il y a un écart, vert si tout est juste).
  const ok = Math.abs(data.varianceTnd) < 0.0005;
  const color = ok ? rgb(0.1, 0.55, 0.35) : rgb(0.75, 0.15, 0.2);
  ctx.page.drawRectangle({ x: M, y: ctx.y - 60, width: A4[0] - 2 * M, height: 78, color: LIGHT });
  text(ctx, "Écart de caisse (compté moins attendu)", M + 16, { size: 9, color: GREY });
  ctx.y -= 34;
  text(ctx, `${data.varianceTnd > 0 ? "+" : ""}${money(data.varianceTnd)}`, M + 16, { size: 28, bold: true, color });
  ctx.y -= 18;
  text(ctx, ok ? "Caisse juste" : data.varianceTnd < 0 ? "Il manque de l'argent dans le tiroir" : "Excédent dans le tiroir", M + 16, { color: GREY });
  ctx.y -= 44;

  // Encaissements attendus par moyen de paiement (remboursements déduits).
  text(ctx, "Encaissements attendus du jour", M, { bold: true, size: 11 });
  ctx.y -= 18;
  for (const e of data.expected) {
    text(ctx, METHOD_LABELS[e.method as keyof typeof METHOD_LABELS] ?? e.method, M + 8);
    text(ctx, money(e.amountTnd), A4[0] - M - 8, { align: "right" });
    ctx.y -= 16;
  }
  if (data.expected.length === 0) {
    text(ctx, "Aucun encaissement ce jour-là.", M + 8, { color: GREY });
    ctx.y -= 16;
  }
  ctx.y -= 12;

  // Comparatif des espèces.
  const rows: [string, string, boolean?][] = [
    ["Espèces attendues", money(data.expectedCashTnd)],
    ["Espèces comptées", money(data.countedCashTnd)],
    ["Écart", `${data.varianceTnd > 0 ? "+" : ""}${money(data.varianceTnd)}`, true],
  ];
  for (const [label, value, strong] of rows) {
    if (strong) ctx.page.drawRectangle({ x: M, y: ctx.y - 5, width: A4[0] - 2 * M, height: 18, color: LIGHT });
    text(ctx, label, M + 8, { bold: strong });
    text(ctx, value, A4[0] - M - 8, { bold: strong, align: "right" });
    ctx.y -= 20;
  }
  ctx.y -= 10;
  text(ctx, `Clôturée par ${data.closedBy} le ${dateFmt(data.closedAt, true)}`, M, { size: 9, color: GREY });
  if (data.note) {
    ctx.y -= 14;
    text(ctx, `Note : ${fit(ctx, data.note, A4[0] - 2 * M - 40, 9)}`, M, { size: 9, color: GREY });
  }
  footer(ctx, `${data.organization.name} · Rapport de clôture de caisse · Généré par Salonia`);
  return ctx.doc.save();
}
