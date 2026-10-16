import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Booking } from "@/lib/models/booking";
import { toLocal } from "./time";

// IA Module 3 — Prédiction des absences (no-show).
// Régression logistique entraînée sur l'historique du salon (rendez-vous terminés ou manqués).
// Les données d'un salon ne servent jamais à un autre salon : un modèle par organisation.

export const FEATURES = [
  { key: "pastNoShowRate", label: "Absences passées du client" },
  { key: "firstVisit", label: "Première visite" },
  { key: "leadTime", label: "Réservé longtemps à l'avance" },
  { key: "lastMinute", label: "Réservé à la dernière minute" },
  { key: "earlyMorning", label: "Rendez-vous tôt le matin" },
  { key: "saturday", label: "Rendez-vous le samedi" },
  { key: "noReminderConsent", label: "Rappels refusés" },
  { key: "onlineBooking", label: "Réservé en ligne" },
  { key: "highTicket", label: "Prestation coûteuse" },
] as const;
type FeatureKey = (typeof FEATURES)[number]["key"];

// Poids de départ (connaissances du métier) utilisés tant que l'historique est trop court.
const PRIOR: { bias: number; weights: Record<FeatureKey, number> } = {
  bias: -2.6,
  weights: {
    pastNoShowRate: 3.2,
    firstVisit: 0.7,
    leadTime: 0.6,
    lastMinute: -0.4,
    earlyMorning: 0.35,
    saturday: 0.25,
    noReminderConsent: 0.9,
    onlineBooking: 0.3,
    highTicket: -0.5,
  },
};

export type BookingForScore = {
  start: Date;
  createdAt: Date;
  source: string;
  totalTnd: number;
  customer: { visits: number; noShows: number; remindersConsent: boolean };
};

function featurize(b: BookingForScore): Record<FeatureKey, number> {
  const leadDays = (b.start.getTime() - b.createdAt.getTime()) / 86_400_000;
  const local = toLocal(b.start);
  return {
    // Lissage : un client sans historique part d'un taux de 10 %.
    pastNoShowRate: (b.customer.noShows + 0.3) / (b.customer.visits + b.customer.noShows + 3),
    firstVisit: b.customer.visits + b.customer.noShows === 0 ? 1 : 0,
    leadTime: Math.min(Math.max(leadDays, 0), 30) / 30,
    lastMinute: leadDays < 0.5 ? 1 : 0,
    earlyMorning: local.hour < 10 ? 1 : 0,
    saturday: local.weekday === 6 ? 1 : 0,
    noReminderConsent: b.customer.remindersConsent ? 0 : 1,
    onlineBooking: b.source === "ONLINE" || b.source === "CHATBOT" ? 1 : 0,
    highTicket: b.totalTnd >= 120 ? 1 : 0,
  };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

type Model = {
  bias: number;
  weights: Record<FeatureKey, number>;
  trainedOn: number;
  accuracy: number | null;
  baseRate: number;
  source: "trained" | "prior";
};

function predict(model: Pick<Model, "bias" | "weights">, x: Record<FeatureKey, number>) {
  let z = model.bias;
  for (const f of FEATURES) z += model.weights[f.key] * x[f.key];
  return sigmoid(z);
}

// Descente de gradient avec régularisation L2 vers les poids de départ.
function train(samples: { x: Record<FeatureKey, number>; y: number }[]) {
  const model = { bias: PRIOR.bias, weights: { ...PRIOR.weights } };
  const lr = 0.3;
  const l2 = 0.02;
  for (let epoch = 0; epoch < 400; epoch++) {
    let gBias = 0;
    const g = Object.fromEntries(FEATURES.map((f) => [f.key, 0])) as Record<FeatureKey, number>;
    for (const s of samples) {
      const err = predict(model, s.x) - s.y;
      gBias += err;
      for (const f of FEATURES) g[f.key] += err * s.x[f.key];
    }
    const n = samples.length;
    model.bias -= (lr * gBias) / n;
    for (const f of FEATURES) {
      model.weights[f.key] -= lr * (g[f.key] / n + l2 * (model.weights[f.key] - PRIOR.weights[f.key]));
    }
  }
  return model;
}

const cache = new Map<string, { model: Model; at: number }>();
const CACHE_MS = 10 * 60 * 1000;

// Historique d'un client calculé uniquement avec les rendez-vous antérieurs (pas de fuite du futur).
async function trainingSet(organizationId: string) {
  const past = await Booking.find({
    organizationId,
    status: { $in: ["COMPLETED", "NO_SHOW"] },
  })
    .sort({ start: 1 })
    .select("customerId start createdAt source totalTnd status")
    .populate<{ customerId: { _id: Types.ObjectId; remindersConsent: boolean } | null }>("customerId", "remindersConsent")
    .lean();

  const history = new Map<string, { visits: number; noShows: number }>();
  return past.map((b) => {
    const id = String(b.customerId?._id);
    const h = history.get(id) ?? { visits: 0, noShows: 0 };
    const x = featurize({
      start: b.start,
      createdAt: b.createdAt as Date,
      source: b.source,
      totalTnd: b.totalTnd,
      customer: { ...h, remindersConsent: b.customerId?.remindersConsent ?? true },
    });
    const y = b.status === "NO_SHOW" ? 1 : 0;
    history.set(id, { visits: h.visits + (y ? 0 : 1), noShows: h.noShows + y });
    return { x, y };
  });
}

export async function getNoShowModel(organizationId: string): Promise<Model> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.model;

  await connectDB();
  const samples = await trainingSet(organizationId);
  const baseRate = samples.length ? samples.filter((s) => s.y).length / samples.length : 0.1;

  let model: Model;
  if (samples.length < 40) {
    model = { ...PRIOR, trainedOn: samples.length, accuracy: null, baseRate, source: "prior" };
  } else {
    // 80 % pour apprendre, 20 % (les plus récents) pour mesurer la fiabilité.
    const cut = Math.floor(samples.length * 0.8);
    const trained = train(samples.slice(0, cut));
    const test = samples.slice(cut);
    // AUC : probabilité qu'un client absent soit classé plus à risque qu'un client venu (0,5 = hasard).
    const pos = test.filter((s) => s.y === 1).map((s) => predict(trained, s.x));
    const neg = test.filter((s) => s.y === 0).map((s) => predict(trained, s.x));
    let wins = 0;
    for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
    const auc = pos.length && neg.length ? wins / (pos.length * neg.length) : null;
    model = {
      ...train(samples),
      trainedOn: samples.length,
      accuracy: auc,
      baseRate,
      source: "trained",
    };
  }
  cache.set(organizationId, { model, at: Date.now() });
  return model;
}

export type NoShowScore = {
  probability: number;
  level: "low" | "medium" | "high";
  factors: { label: string; impact: number }[];
};

export function scoreBooking(model: Model, b: BookingForScore): NoShowScore {
  const x = featurize(b);
  const probability = predict(model, x);
  const factors = FEATURES.map((f) => ({ label: f.label, impact: model.weights[f.key] * x[f.key] }))
    .filter((f) => Math.abs(f.impact) > 0.15)
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3);
  // Seuils relatifs au taux d'absence habituel du salon.
  const high = Math.max(0.25, model.baseRate * 2.2);
  const medium = Math.max(0.13, model.baseRate * 1.4);
  const level = probability >= high ? "high" : probability >= medium ? "medium" : "low";
  return { probability, level, factors };
}

// Statistiques par client (visites honorées et absences) pour un lot de clients.
export async function customerStats(organizationId: string, customerIds: string[]) {
  if (customerIds.length === 0) return new Map<string, { visits: number; noShows: number }>();
  const rows = await Booking.aggregate<{ _id: Types.ObjectId; visits: number; noShows: number }>([
    {
      $match: {
        organizationId: new Types.ObjectId(organizationId),
        customerId: { $in: customerIds.map((id) => new Types.ObjectId(id)) },
        status: { $in: ["COMPLETED", "NO_SHOW"] },
      },
    },
    {
      $group: {
        _id: "$customerId",
        visits: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        noShows: { $sum: { $cond: [{ $eq: ["$status", "NO_SHOW"] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { visits: r.visits, noShows: r.noShows }]));
}
