"use server";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession, deleteSession } from "@/lib/session";
import {
  ForgotPasswordSchema,
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  isPhone,
  normalizePhone,
  type FormState,
} from "@/lib/definitions";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

// Hash factice : on compare toujours un mot de passe, même si le compte n'existe pas,
// pour ne pas révéler par le temps de réponse quels comptes existent.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

// Limitation simple des tentatives (mémoire du serveur, suffisant pour le MVP).
const attempts = new Map<string, { count: number; lockedUntil: number }>();

function findByIdentifier(identifier: string) {
  return isPhone(identifier)
    ? prisma.user.findUnique({ where: { phone: normalizePhone(identifier) } })
    : prisma.user.findUnique({ where: { email: identifier.toLowerCase() } });
}

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
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return {
      message: `Trop de tentatives. Réessayez dans ${minutes} min.`,
      values: { identifier },
    };
  }

  const user = await findByIdentifier(identifier);
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) {
    const count = (entry?.count ?? 0) + 1;
    attempts.set(key, {
      count: count >= MAX_ATTEMPTS ? 0 : count,
      lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0,
    });
    return { message: "Identifiant ou mot de passe incorrect.", values: { identifier } };
  }

  attempts.delete(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(
    { userId: user.id, role: user.role, organizationId: user.organizationId },
    formData.get("remember") === "on",
  );

  // Retour à la page demandée avant la connexion (chemins internes uniquement).
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "salon";
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await prisma.organization.findUnique({ where: { slug } }); i++) {
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

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: data.email }, ...(phone ? [{ phone }] : [])] },
    select: { email: true },
  });
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
  const user = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: data.salonName,
        slug,
        centers: { create: { name: data.salonName, governorate: data.governorate } },
      },
      include: { centers: true },
    });
    return tx.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone,
        passwordHash,
        role: "OWNER",
        organizationId: organization.id,
        lastLoginAt: new Date(),
        centers: { create: { centerId: organization.centers[0].id } },
      },
    });
  });

  await createSession({ userId: user.id, role: user.role, organizationId: user.organizationId });
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
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const link = `/reset-password?token=${token}`;
  // TODO (F1.6) : envoyer le lien par e-mail / SMS via le service de notifications.
  console.log(`\n🔑 Lien de réinitialisation pour ${user.email ?? user.phone} : http://localhost:3000${link}\n`);

  return process.env.NODE_ENV === "production" ? response : { ...response, devLink: link };
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

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { message: "Ce lien est invalide ou a expiré. Demandez-en un nouveau." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  redirect("/login?reset=1");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
