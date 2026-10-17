import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { METHOD_LABELS, KIND_LABELS } from "./labels";
import { plainTnd, vatBreakdown } from "./money";

// F6.3 / F6.6 — Factures, reçus et rapport financier en PDF (A4), générés côté serveur.
// Polices standard PDF (jeu de caractères latin) : les caractères non latins sont remplacés.

const PLUM = rgb(0.165, 0.059, 0.145);
const ROSE = rgb(0.91, 0.706, 0.627);
const GREY = rgb(0.42, 0.4, 0.43);
const LIGHT = rgb(0.96, 0.94, 0.95);
const A4: [number, number] = [595.28, 841.89];
const M = 48;

// Caractères encodables en WinAnsi (polices standard PDF).
const safe = (text: string) =>
  text
    .normalize("NFC")
    .replace(/[  ]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF—–‘’“”•…€]/g, "?");

// Format français : 28 906,750 DT (espaces fines remplacées par des espaces simples dans safe()).
const money = (v: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(plainTnd(v)))} DT`;

const dateFmt = (d: Date, withTime = false) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    timeZone: "Africa/Tunis",
  }).format(d);

type Ctx = { doc: PDFDocument; page: PDFPage; font: PDFFont; bold: PDFFont; y: number };

async function start(): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setProducer("Salonia");
  doc.setCreator("Salonia");
  const page = doc.addPage(A4);
  return { doc, page, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), y: A4[1] - M };
}

function text(ctx: Ctx, value: string, x: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right"; y?: number } = {}) {
  const font = opts.bold ? ctx.bold : ctx.font;
  const size = opts.size ?? 10;
  const s = safe(value);
  const width = font.widthOfTextAtSize(s, size);
  ctx.page.drawText(s, { x: opts.align === "right" ? x - width : x, y: opts.y ?? ctx.y, size, font, color: opts.color ?? PLUM });
}

// Tronque un texte pour qu'il tienne dans une largeur donnée.
function fit(ctx: Ctx, value: string, width: number, size = 10) {
  let s = safe(value);
  while (s.length > 3 && ctx.font.widthOfTextAtSize(s, size) > width) s = `${s.slice(0, -4)}...`;
  return s;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed > M + 30) return;
  ctx.page = ctx.doc.addPage(A4);
  ctx.y = A4[1] - M;
}

function header(ctx: Ctx, org: { name: string }, center: { name: string; address?: string | null; phone?: string | null }, title: string, number: string, date: Date) {
  ctx.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: ROSE });
  text(ctx, org.name, M, { size: 20, bold: true });
  text(ctx, title, A4[0] - M, { size: 18, bold: true, align: "right" });
  ctx.y -= 18;
  text(ctx, center.name, M, { color: GREY });
  text(ctx, `N° ${number}`, A4[0] - M, { bold: true, align: "right" });
  ctx.y -= 14;
  if (center.address) text(ctx, center.address, M, { color: GREY });
  text(ctx, `Date : ${dateFmt(date, true)}`, A4[0] - M, { align: "right", color: GREY });
  ctx.y -= center.address ? 14 : 0;
  if (center.phone) {
    text(ctx, `Tél. : ${center.phone}`, M, { color: GREY });
    ctx.y -= 14;
  }
  ctx.y -= 18;
}

function footer(ctx: Ctx, note: string) {
  for (const page of ctx.doc.getPages()) {
    page.drawLine({ start: { x: M, y: M }, end: { x: A4[0] - M, y: M }, thickness: 0.5, color: ROSE });
    const s = safe(note);
    page.drawText(s, { x: M, y: M - 14, size: 8, font: ctx.font, color: GREY });
  }
}

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
};

export async function invoicePdf(data: InvoicePdfData) {
  const ctx = await start();
  ctx.doc.setTitle(`Facture ${data.number}`);
  header(ctx, data.organization, data.center, "FACTURE", data.number, data.issuedAt);

  // Client
  ctx.page.drawRectangle({ x: M, y: ctx.y - 34, width: 240, height: 46, color: LIGHT });
  text(ctx, "Facturé à", M + 10, { size: 8, color: GREY });
  ctx.y -= 14;
  text(ctx, data.customerName, M + 10, { bold: true, size: 11 });
  ctx.y -= 13;
  if (data.customerPhone) text(ctx, `+216 ${data.customerPhone}`, M + 10, { color: GREY, size: 9 });
  if (data.status === "CANCELLED") {
    text(ctx, "FACTURE ANNULÉE", A4[0] - M, { bold: true, size: 14, color: rgb(0.75, 0.15, 0.2), align: "right", y: ctx.y + 13 });
    if (data.cancelReason) text(ctx, `Motif : ${data.cancelReason}`, A4[0] - M, { size: 9, color: GREY, align: "right" });
  }
  ctx.y -= 36;

  // Lignes
  const cols = { label: M + 8, qty: 360, unit: 450, total: A4[0] - M - 8 };
  ctx.page.drawRectangle({ x: M, y: ctx.y - 6, width: A4[0] - 2 * M, height: 22, color: PLUM });
  const white = rgb(1, 1, 1);
  text(ctx, "Prestation", cols.label, { bold: true, color: white, size: 9 });
  text(ctx, "Qté", cols.qty, { bold: true, color: white, size: 9, align: "right" });
  text(ctx, "Prix unitaire TTC", cols.unit, { bold: true, color: white, size: 9, align: "right" });
  text(ctx, "Total TTC", cols.total, { bold: true, color: white, size: 9, align: "right" });
  ctx.y -= 24;
  for (const line of data.lines) {
    ensureSpace(ctx, 20);
    text(ctx, fit(ctx, line.label, 270), cols.label);
    text(ctx, String(line.quantity), cols.qty, { align: "right" });
    text(ctx, money(line.unitPriceTnd), cols.unit, { align: "right" });
    text(ctx, money(line.totalTnd), cols.total, { align: "right" });
    ctx.y -= 8;
    ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: A4[0] - M, y: ctx.y }, thickness: 0.4, color: LIGHT });
    ctx.y -= 12;
  }

  // Totaux
  ensureSpace(ctx, 120);
  ctx.y -= 6;
  const vat = vatBreakdown(data.totalTnd, data.vatRate);
  const rows: [string, string, boolean?][] = [["Sous-total", money(data.subtotalTnd)]];
  if (data.discountTnd > 0) rows.push(["Remise", `- ${money(data.discountTnd)}`]);
  rows.push(
    ["Total HT", money(vat.ht)],
    [`TVA ${Math.round(data.vatRate * 100)} % (incluse)`, money(vat.vat)],
    ["Total TTC", money(data.totalTnd), true],
    ["Déjà réglé", money(data.paidTnd)],
    ["Reste à payer", money(Math.max(0, data.totalTnd - data.paidTnd)), true],
  );
  for (const [label, value, strong] of rows) {
    if (strong) ctx.page.drawRectangle({ x: 330, y: ctx.y - 5, width: A4[0] - M - 330, height: 18, color: LIGHT });
    text(ctx, label, 340, { bold: strong, size: strong ? 11 : 10 });
    text(ctx, value, cols.total, { bold: strong, size: strong ? 11 : 10, align: "right" });
    ctx.y -= 18;
  }

  // Règlements
  if (data.payments.length) {
    ensureSpace(ctx, 40 + data.payments.length * 14);
    ctx.y -= 14;
    text(ctx, "Règlements", M, { bold: true, size: 11 });
    ctx.y -= 16;
    for (const p of data.payments) {
      const sign = p.kind === "REFUND" ? "- " : "";
      text(ctx, `${dateFmt(p.paidAt, true)} · ${KIND_LABELS[p.kind as keyof typeof KIND_LABELS] ?? p.kind} · ${METHOD_LABELS[p.method as keyof typeof METHOD_LABELS] ?? p.method}${p.receiptNumber ? ` · reçu ${p.receiptNumber}` : ""}`, M, { size: 9, color: GREY });
      text(ctx, `${sign}${money(p.amountTnd)}`, cols.total, { size: 9, align: "right" });
      ctx.y -= 14;
    }
  }

  footer(ctx, `${data.organization.name} · Montants en dinars tunisiens (TTC) · Merci de votre visite · Généré par Salonia`);
  return ctx.doc.save();
}

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
  const title = data.kind === "REFUND" ? "REMBOURSEMENT" : data.kind === "DEPOSIT" ? "REÇU D'ACOMPTE" : "REÇU";
  header(ctx, data.organization, data.center, title, data.receiptNumber, data.paidAt);

  ctx.page.drawRectangle({ x: M, y: ctx.y - 60, width: A4[0] - 2 * M, height: 78, color: LIGHT });
  text(ctx, data.kind === "REFUND" ? "Montant remboursé" : "Montant reçu", M + 16, { size: 9, color: GREY });
  ctx.y -= 34;
  text(ctx, money(data.amountTnd), M + 16, { size: 28, bold: true });
  ctx.y -= 18;
  text(ctx, METHOD_LABELS[data.method as keyof typeof METHOD_LABELS] ?? data.method, M + 16, { color: GREY });
  ctx.y -= 40;

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
  ctx.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: ROSE });
  text(ctx, data.organization.name, M, { size: 20, bold: true });
  text(ctx, "RAPPORT FINANCIER", A4[0] - M, { size: 16, bold: true, align: "right" });
  ctx.y -= 18;
  text(ctx, `${data.scopeLabel} · ${data.periodLabel}`, M, { color: GREY });
  text(ctx, `Généré le ${dateFmt(data.generatedAt, true)}`, A4[0] - M, { color: GREY, align: "right" });
  ctx.y -= 32;

  const s = data.summary;
  const kpis: [string, string][] = [
    ["Chiffre d'affaires encaissé", money(s.revenue)],
    ["Dépenses", money(s.expenses)],
    ["Résultat", money(s.profit)],
    ["Marge", s.margin == null ? "—" : `${Math.round(s.margin * 100)} %`],
    ["Ventes facturées", String(s.sales)],
    ["Panier moyen", money(s.averageBasket)],
  ];
  const w = (A4[0] - 2 * M - 20) / 3;
  kpis.forEach(([label, value], i) => {
    const x = M + (i % 3) * (w + 10);
    const y = ctx.y - Math.floor(i / 3) * 56;
    ctx.page.drawRectangle({ x, y: y - 34, width: w, height: 48, color: LIGHT });
    text(ctx, label, x + 10, { size: 8, color: GREY, y: y });
    text(ctx, value, x + 10, { size: 14, bold: true, y: y - 22 });
  });
  ctx.y -= 128;

  const table = (title: string, headers: string[], rows: string[][], widths: number[]) => {
    ensureSpace(ctx, 60);
    text(ctx, title, M, { bold: true, size: 12 });
    ctx.y -= 18;
    ctx.page.drawRectangle({ x: M, y: ctx.y - 5, width: A4[0] - 2 * M, height: 18, color: PLUM });
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

  const full = A4[0] - 2 * M;
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
