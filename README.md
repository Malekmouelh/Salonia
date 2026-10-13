# Salonia — Plateforme PWA de gestion de salons

Module 1 (Noyau) : inscription, connexion par e-mail ou téléphone, mot de passe oublié, rôles et multi-centres.

## Démarrage

```bash
npm install
npm run db:local      # PostgreSQL local (laisser tourner) — ou mettre une URL Neon dans .env
npm run db:migrate    # crée les tables
npm run db:seed       # comptes de démo (mot de passe : Demo1234)
npm run dev
```

Copier `.env.example` vers `.env` et renseigner `DATABASE_URL` et `SESSION_SECRET`.

## Comptes de démo

| Rôle | Identifiant |
|---|---|
| Propriétaire (3 centres) | owner@salonia.tn |
| Gérant (Sousse) | manager@salonia.tn |
| Staff (Tunis) | staff@salonia.tn ou 22 345 678 |
| Client | client@salonia.tn |
| Super admin | admin@salonia.tn |

## Architecture de l'authentification

- `app/actions/auth.ts` — Server Actions : login, register, forgotPassword, resetPassword, logout (validation Zod, bcrypt, anti-bruteforce)
- `lib/session.ts` — session JWT signée (jose) dans un cookie httpOnly
- `lib/dal.ts` — Data Access Layer : `verifySession`, `getCurrentUser`, `requireRole`
- `proxy.ts` — redirections optimistes (ex-middleware, Next.js 16)
- `prisma/schema.prisma` — Organization, Center, User (5 rôles), CenterMember, PasswordResetToken
