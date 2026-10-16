# Salonia — Plateforme PWA de gestion de salons

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · **MongoDB Atlas (Mongoose)** · Zod · Claude (IA)

- **Socle** (travail de groupe) : comptes, rôles, multi-centres, journal de sécurité, FR/AR, PWA.
- **Module 3 — Calendrier et réservations (Malek)** : calendrier jour/semaine/mois, disponibilités,
  réservation en ligne en 4 étapes, rappels, annulations, reports, liste d'attente, fiches clients,
  et IA : prédiction des absences, créneaux à remplir, chatbot de réservation.

## Démarrage

```bash
npm install
cp .env.example .env      # puis renseigner MONGODB_URI (Atlas) et SESSION_SECRET
npm run db:seed           # données de démo (mot de passe : Demo1234)
npm run dev
```

Sans Atlas (hors ligne), une base MongoDB locale sans installation :

```bash
npm run db:local          # dans un terminal séparé (laisser tourner)
```

puis `MONGODB_URI="mongodb://127.0.0.1:27017"` dans `.env`.

| Variable | Rôle |
|---|---|
| `MONGODB_URI` | Atlas : `mongodb+srv://…` · local : `mongodb://127.0.0.1:27017` |
| `MONGODB_DB` | nom de la base (`salonia`, ou une base par membre : `salonia_malek`…) |
| `SESSION_SECRET` | clé de signature des sessions (`openssl rand -base64 32`) |
| `DEMO_MODE` | `"true"` : comptes de démo sur /login et lien de réinitialisation affiché |
| `ANTHROPIC_API_KEY` | IA (assistant de configuration, chatbot). Vide : modes hors ligne |
| `CRON_SECRET` | protège `/api/cron/reminders` (rappels automatiques) |

## Comptes de démo

| Rôle | Identifiant |
|---|---|
| Propriétaire (3 centres) | owner@salonia.tn |
| Gérant (Sousse) | manager@salonia.tn |
| Staff (Tunis) | staff@salonia.tn ou 22 345 678 |
| Client | client@salonia.tn |
| Super admin | admin@salonia.tn |

Page de réservation publique : `/reserver/salon-yasmine`

## Module 3 — Calendrier et réservations

| Exigence | Où |
|---|---|
| F3.1 Calendrier par centre et par praticien (jour, semaine, mois) | `/dashboard/calendar` |
| F3.2 Horaires, pauses, fermetures, blocage de créneaux | `/dashboard/availability`, « Bloquer du temps » |
| F3.3 Réservation en ligne (service ou pack, praticien, créneau) en 4 étapes | `/reserver/[slug]` |
| F3.4 Rappels automatiques 24 h avant | `/api/cron/reminders` (Vercel Cron) + bouton manuel |
| F3.5 Annulations, reports, liste d'attente | calendrier, lien client `/reservation/[token]` |
| F3.6 Fiche client avec historique | `/dashboard/clients` |

**IA du module 3** (cahier des charges §6) :
- **Prédiction des absences** : régression logistique entraînée sur l'historique du salon
  (`lib/booking/noshow.ts`), score + facteurs explicatifs, qualité mesurée par l'AUC sur les 20 % les plus récents.
- **Créneaux à remplir** : trous ≥ 45 min sur 7 jours, associés à la liste d'attente et aux habitués à relancer.
- **Chatbot de réservation** : Claude avec deux outils (`find_slots`, `propose_booking`), repli par mots-clés FR/AR.
  L'IA propose, le client confirme.

Règles métier : pas de double réservation (revérification à l'enregistrement), fuseau Africa/Tunis,
annulation/report en ligne jusqu'à 2 h avant, rappels uniquement avec consentement.

## Contrats avec les autres modules

| Module | Ce que le Module 3 utilise | Fichier |
|---|---|---|
| 2 — Catalogue (Maya) | collections `services` et `packs` (nom, catégorie, durée, prix, centres) | `lib/models/catalog.ts` |
| 4 — Équipe (Amine) | praticiens = utilisateurs `STAFF` affectés au centre (`centerIds`) | `lib/booking/availability.ts` |
| 6 — Finances (Salsabil) | `bookings` (statut `COMPLETED`, `totalTnd`, `items`) | `lib/models/booking.ts` |
| Socle — Notifications | boîte d'envoi `notifications` (statut `QUEUED`) à brancher sur SMS/WhatsApp | `lib/models/booking.ts` |

## Architecture

- `lib/models/` — schémas Mongoose (`core`, `catalog`, `booking`) · `lib/db.ts` — connexion unique
- `lib/dal.ts` — Data Access Layer (`getCurrentUser`, `requireRole`, centres accessibles)
- `lib/booking/` — disponibilités, création, rappels, prédiction, chatbot, fuseau horaire
- `lib/data/` — lectures pour les pages (calendrier, clients, vitrine publique)
- `app/actions/` — Server Actions (toujours revérifiées côté serveur)
- `scripts/seed.ts` — jeu de démonstration · `scripts/local-db.ts` — MongoDB local
