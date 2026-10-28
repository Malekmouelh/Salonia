# Salonia — Plateforme PWA de gestion de salons

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · **MongoDB Atlas (Mongoose)** · Zod · Claude (IA)

- **Socle** (travail de groupe) : comptes, rôles, multi-centres, journal de sécurité, FR/AR, PWA.
- **Module 3 — Calendrier et réservations (Malek)** : calendrier jour/semaine/mois, disponibilités,
  réservation en ligne en 4 étapes, rappels, annulations, reports, liste d'attente, fiches clients,
  et IA : prédiction des absences, créneaux à remplir, chatbot de réservation.
- **Module 6 — Paiements, factures et pilotage financier (Salsabil)** : caisse (espèces, carte, mobile,
  paiement fractionné, acomptes), paiement en ligne, factures et reçus PDF numérotés, dépenses,
  tableau de bord multi-centres, exports PDF/CSV, et IA : assistant d'analyse, détection d'anomalies,
  prévision du chiffre d'affaires.

## Démarrage

```bash
npm install
cp .env.example .env      # puis renseigner MONGODB_URI (Atlas) et SESSION_SECRET
npm run db:seed           # données de démo (mot de passe : Demo1234)
npm run dev
npm test                  # tests automatisés (Module 6)
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

## Module 6 — Paiements, factures et pilotage financier

| Exigence | Où |
|---|---|
| F6.1 Encaissement (espèces, carte, mobile, paiement fractionné, remise) et acomptes | `/dashboard/finances/caisse` · bouton « Encaisser » du calendrier |
| F6.2 Paiement en ligne (passerelle locale) | « Lien de paiement » en caisse → page client `/paiement/[jeton]` |
| F6.3 Factures et reçus PDF numérotés (`FAC-2026-00001`, `REC-2026-00001`) | `/dashboard/finances/factures`, `/api/finance/invoices/[id]`, `/api/finance/receipts/[id]` |
| F6.4 Suivi des dépenses (loyer, produits, salaires…) | `/dashboard/finances/depenses` |
| F6.5 Tableau de bord : CA, panier moyen, services les plus demandés, comparaison entre centres | `/dashboard/finances` |
| F6.6 Export PDF et Excel/CSV | menu « Exporter » → `/api/finance/export` |

**IA du module 6** (cahier des charges §6) :
- **Assistant d'analyse** : question en langage naturel (FR, AR, derja). Claude ne lit jamais la base : il appelle
  6 outils en lecture seule (synthèse, ventilation, comparaison des centres, CA journalier, anomalies, prévision),
  toujours limités à l'organisation et aux centres de l'utilisateur (`lib/finance/assistant.ts`).
  Sans clé API : moteur par mots-clés FR/AR sur les mêmes requêtes.
- **Détection d'anomalies** : CA journalier comparé aux 8 mêmes jours de la semaine précédents (médiane et écart
  absolu médian, seuils : score > 3 et écart > 40 %), dépenses en forte hausse, dépense isolée inhabituelle,
  remboursements > 5 %, remises > 10 %, centre déficitaire (`lib/finance/analytics.ts`).
- **Prévision du CA du mois** : moyenne par jour de la semaine sur 12 semaines et tendance amortie, fourchette
  ~80 %, erreur mesurée sur les 4 dernières semaines (backtest).
  L'IA propose, le gérant décide : aucune fonction IA ne modifie les données.

**Compléments du module** (CRUD complet et règles de gestion) :

| Fonction | Où |
|---|---|
| Historique des paiements (recherche, filtres, remboursement, annulation d'un lien en attente) | `/dashboard/finances/paiements` |
| Clôture de caisse : comptage des espèces, écart, rapport PDF, verrouillage de la journée, réouverture (propriétaire) | page Caisse + `/api/finance/closings/[id]` |
| Paramètres financiers : TVA, matricule fiscal, mentions de facture, acompte par défaut, droit d'encaisser du staff, paiement en ligne | `/dashboard/finances/parametres` (propriétaire) |
| Espace client : ses factures et ses reçus en PDF (cahier §4) | `/dashboard/mes-paiements` |
| Sécurité du paiement en ligne : 5 essais de carte maximum par lien, puis verrouillage | `lib/finance/service.ts` |

**IA, détection d'anomalies** : en plus du CA, des dépenses, des remboursements et des remises, les **écarts de caisse**
des clôtures sont analysés (écart ≥ 10 DT signalé, ≥ 50 DT important, 3 écarts ou plus sur un centre = alerte
« répétés »). L'assistant dispose d'un outil `get_cash_closings`.

**Règles métier** : montants TTC en dinars (3 décimales), TVA 19 % incluse détaillée sur la facture ; facture émise
automatiquement au règlement complet, et la prestation passe à « Terminé » ; numérotation séquentielle par
organisation et par année (un numéro annulé n'est jamais réutilisé) ; un remboursement ne modifie pas la facture
(ligne négative dans ses règlements).

**Droits** : propriétaire = tout ; gérant = caisse, factures, dépenses et tableau de bord de son centre (pas de
saisie des salaires) ; staff = encaisser ses propres rendez-vous, sans remise ni remboursement ; seul le
propriétaire annule une facture. Chaque encaissement, remboursement, facture, dépense et export est inscrit au
journal de sécurité.

**Paiement en ligne** : la passerelle de démonstration (`lib/finance/gateway.ts`) accepte la carte de test
`4242 4242 4242 4242` (et refuse `4000 0000 0000 0002`). Pour la production, implémenter l'interface
`PaymentGateway` avec le fournisseur retenu (Konnect, Flouci, ClicToPay…).

**Données de démo** : `npm run db:seed` crée aussi ~10 semaines de paiements et factures et 4 mois de dépenses
(`npm run db:seed:finance` pour les régénérer seules), avec deux anomalies à faire détecter par l'IA :
un jour sans saisie de caisse à Djerba, un achat de produits exceptionnel à Sousse, et des écarts de caisse
(3 manques à Tunis, 1 excédent à Sousse).

## Contrats avec les autres modules

| Module | Ce que le Module 3 utilise | Fichier |
|---|---|---|
| 2 — Catalogue (Maya) | collections `services` et `packs` (nom, catégorie, durée, prix, centres) | `lib/models/catalog.ts` |
| 4 — Équipe (Amine) | praticiens = utilisateurs `STAFF` affectés au centre (`centerIds`) | `lib/booking/availability.ts` |
| 6 — Finances (Salsabil) | `bookings` (statut `COMPLETED`, `totalTnd`, `items`) ; le Module 6 passe un RDV réglé à `COMPLETED` | `lib/models/booking.ts`, `lib/finance/service.ts` |
| Socle — Notifications | boîte d'envoi `notifications` (statut `QUEUED`) à brancher sur SMS/WhatsApp | `lib/models/booking.ts` |

## Architecture

- `lib/models/` — schémas Mongoose (`core`, `catalog`, `booking`, `finance`) · `lib/db.ts` — connexion unique
- `lib/finance/` — Module 6 : règles métier, rapports, IA, PDF, passerelle de paiement, tests
- `lib/dal.ts` — Data Access Layer (`getCurrentUser`, `requireRole`, centres accessibles)
- `lib/booking/` — disponibilités, création, rappels, prédiction, chatbot, fuseau horaire
- `lib/data/` — lectures pour les pages (calendrier, clients, vitrine publique)
- `app/actions/` — Server Actions (toujours revérifiées côté serveur)
- `scripts/seed.ts` — jeu de démonstration · `scripts/local-db.ts` — MongoDB local
