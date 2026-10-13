# Salonia — Plateforme PWA de gestion de salons

Module 1 (Noyau) : comptes, rôles, multi-centres, plus les extras de démonstration :
assistant IA de configuration, interface français / arabe (RTL), PWA installable, journal de sécurité.

## Démarrage

```bash
npm install
npm run db:local      # PostgreSQL local (laisser tourner) — ou mettre une URL Neon dans .env
npm run db:setup      # crée les tables + comptes de démo (mot de passe : Demo1234)
npm run dev
```

Copier `.env.example` vers `.env` puis renseigner :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | PostgreSQL (local `prisma dev` ou Neon) |
| `SESSION_SECRET` | clé de signature des sessions (`openssl rand -base64 32`) |
| `DEMO_MODE` | `"true"` : comptes de démo sur /login et lien de réinitialisation affiché |
| `ANTHROPIC_API_KEY` | assistant IA (Claude). Vide : mode hors ligne par mots-clés |

> Base locale `prisma dev` : elle ne gère qu'une seule base, `prisma migrate dev` échoue (base « shadow »).
> En local, utiliser `npm run db:setup`. Sur Neon, `npm run db:migrate` fonctionne normalement.

## Comptes de démo

| Rôle | Identifiant |
|---|---|
| Propriétaire (3 centres) | owner@salonia.tn |
| Gérant (Sousse) | manager@salonia.tn |
| Staff (Tunis) | staff@salonia.tn ou 22 345 678 |
| Client | client@salonia.tn |
| Super admin | admin@salonia.tn |

## Fonctionnalités

- **Authentification** (F1.1) : e-mail ou téléphone tunisien, inscription en 2 étapes, mot de passe oublié,
  bcrypt, session JWT en cookie httpOnly, blocage après 5 échecs.
- **Multi-centres** (F1.2, F1.4) : ajout de centres par gouvernorat, sélecteur de centre, vue consolidée,
  isolation par organisation et par rôle (le staff ne voit que ses centres).
- **Assistant IA** (§6, Module 1) : description libre (FR / AR) → centres, horaires, catalogue et équipe
  proposés par Claude (sortie JSON structurée), modifiables avant validation. Repli sans IA intégré.
- **Français / العربية** (F2.6) : bascule animée, affichage de droite à gauche, polices arabes.
- **PWA** (§7) : manifeste, icônes, service worker (production uniquement), page hors ligne,
  bandeau « hors ligne », bouton d'installation.
- **Journal de sécurité** (§7) : connexions, échecs, blocages, réinitialisations, centres ajoutés.

## Architecture

- `app/actions/` — Server Actions : `auth.ts`, `centers.ts`, `assistant.ts`
- `lib/session.ts` — session JWT (jose) · `lib/dal.ts` — Data Access Layer (`getCurrentUser`, `requireRole`)
- `lib/data/organization.ts` — centres visibles et journal, filtrés par rôle
- `lib/audit.ts` — journal des actions sensibles · `lib/ai/` — schéma et repli de l'assistant
- `lib/i18n-ar.ts` — traductions arabes (clé = texte français) · `components/i18n/` — langue et RTL
- `proxy.ts` — redirections optimistes (ex-middleware, Next.js 16) · `public/sw.js` — service worker
