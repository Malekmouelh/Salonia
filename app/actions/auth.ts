"use server";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { logEvent } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import {
  ForgotPasswordSchema,
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  isPhone,
  normalizePhone,
  type FormState,
} from "@/lib/definitions";
import type { Role } from "@/lib/enums";
import { Center, Organization, PasswordResetToken, User } from "@/lib/models/core";
import { createSession, deleteSession, readSession } from "@/lib/session";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

// Hash factice : on compare toujours un mot de passe, même si le compte n'existe pas,
// pour ne pas révéler par le temps de réponse quels comptes existent.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

// Limitation simple des tentatives (mémoire du serveur, suffisant pour le MVP).
const attempts = new Map<string, { count: number; lockedUntil: number }>();

async function findByIdentifier(identifier: string) {
  await connectDB();
  return isPhone(identifier)
    ? User.findOne({ phone: normalizePhone(identifier) }).lean()
    : User.findOne({ email: identifier.toLowerCase() }).lean();
}

const ids = (user: { _id: unknown; organizationId?: unknown }) => ({
  userId: String(user._id),
  organizationId: user.organizationId ? String(user.organizationId) : null,
});

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function login(_state: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    identifier: String(formData.get("identifier") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values: { identifier: raw.identifier } };
  }

  const { identifier, password } = parsed.data;
  const key = identifier.toLowerCase();
  const entry = attempts.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    return {
      message: "Trop de tentatives. Réessayez dans quelques minutes.",
      values: { identifier },
    };
  }

  const user = await findByIdentifier(identifier);
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) {
    const count = (entry?.count ?? 0) + 1;
    const locked = count >= MAX_ATTEMPTS;
    attempts.set(key, { count: locked ? 0 : count, lockedUntil: locked ? Date.now() + LOCK_MS : 0 });
    if (user) await logEvent(locked ? "LOGIN_LOCKED" : "LOGIN_FAILED", ids(user));
    return { message: "Identifiant ou mot de passe incorrect.", values: { identifier } };
  }

  attempts.delete(key);
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  await logEvent("LOGIN_SUCCESS", { ...ids(user), detail: isPhone(identifier) ? "phone" : "email" });
  await createSession({ ...ids(user), role: user.role as Role }, formData.get("remember") === "on");

  // Retour à la page demandée avant la connexion (chemins internes uniquement).
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "salon"
  );
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await Organization.exists({ slug }); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

export async function register(_state: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(
    ["firstName", "lastName", "salonName", "governorate", "email", "phone", "password", "confirmPassword"].map(
      (k) => [k, String(formData.get(k) ?? "")],
    ),
  );
  // Valeurs renvoyées au formulaire en cas d'erreur (jamais les mots de passe).
  const values = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.toLowerCase().includes("password")));

  const parsed = RegisterSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values };
  }

  const data = parsed.data;
  const phone = data.phone ? normalizePhone(data.phone) : null;

  await connectDB();
  const existing = await User.findOne({ $or: [{ email: data.email }, ...(phone ? [{ phone }] : [])] })
    .select("email")
    .lean();
  if (existing) {
    return {
      errors:
        existing.email === data.email
          ? { email: ["Cet e-mail est déjà utilisé."] }
          : { phone: ["Ce numéro est déjà utilisé."] },
      values,
    };
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const slug = await uniqueSlug(data.salonName);

  // Le propriétaire, sa marque et son premier centre sont créés ensemble.
  const organization = await Organization.create({ name: data.salonName, slug });
  const center = await Center.create({
    organizationId: organization._id,
    name: data.salonName,
    governorate: data.governorate,
  });
  const user = await User.create({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    phone: phone ?? undefined,
    passwordHash,
    role: "OWNER",
    organizationId: organization._id,
    centerIds: [center._id],
    lastLoginAt: new Date(),
  });

  await logEvent("REGISTER", ids(user));
  await createSession({ ...ids(user), role: "OWNER" });
  redirect("/dashboard?welcome=1");
}

export async function forgotPassword(_state: FormState, formData: FormData): Promise<FormState> {
  const identifier = String(formData.get("identifier") ?? "");
  const parsed = ForgotPasswordSchema.safeParse({ identifier });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values: { identifier } };
  }

  // Même réponse que le compte existe ou non (pas d'énumération des comptes).
  const response: FormState = {
    success: "Si un compte correspond, un lien de réinitialisation vient d'être envoyé.",
  };

  const user = await findByIdentifier(parsed.data.identifier);
  if (!user) return response;

  const token = randomBytes(32).toString("base64url");
  await PasswordResetToken.create({
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  await logEvent("PASSWORD_RESET_REQUEST", ids(user));

  const link = `/reset-password?token=${token}`;
  // TODO (F0.6) : envoyer le lien par e-mail / SMS via le service de notifications.
  console.log(`\n🔑 Lien de réinitialisation pour ${user.email ?? user.phone} : http://localhost:3000${link}\n`);

  const demo = process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true";
  return demo ? { ...response, devLink: link } : response;
}

export async function resetPassword(_state: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  };
  const parsed = ResetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const invalid = { message: "Ce lien est invalide ou a expiré. Demandez-en un nouveau." };
  await connectDB();
  const record = await PasswordResetToken.findOne({ tokenHash: hashToken(parsed.data.token) }).lean();
  if (!record || record.usedAt || record.expiresAt < new Date()) return invalid;

  // Le jeton est marqué utilisé d'abord : un double clic sur le lien ne peut pas le réutiliser.
  const used = await PasswordResetToken.updateOne({ _id: record._id, usedAt: null }, { usedAt: new Date() });
  if (used.modifiedCount === 0) return invalid;

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await User.updateOne({ _id: record.userId }, { passwordHash });

  await logEvent("PASSWORD_RESET", { userId: String(record.userId) });
  redirect("/login?reset=1");
}

export async function logout() {
  const session = await readSession();
  if (session) await logEvent("LOGOUT", { userId: session.userId, organizationId: session.organizationId });
  await deleteSession();
  redirect("/login");
}
