# Salonia — Plateforme PWA de gestion de salons

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · **MongoDB Atlas (Mongoose)** · Zod · Claude (IA)

- **Socle** (travail de groupe) : comptes, rôles, multi-centres, journal de sécurité, FR/AR, PWA.
- **Module 2 — Catalogue et prestations (Maya)** : catalogue complet (services, packs, offres promotionnelles),
  options avec suppléments prix/durée, tarification différenciée par centre, codes promo avec validation interactive,
  galerie photos WebP, et IA : rédaction marketing de prestations, suggestion de forfaits intelligents, audit tarifaire.
- **Module 3 — Calendrier et réservations (Malek)** : calendrier jour/semaine/mois, disponibilités,
  réservation en ligne en 4 étapes, rappels, annulations, reports, liste d'attente, fiches clients,
  et IA : prédiction des absences, créneaux à remplir, chatbot de réservation.
- **Module 4 — Équipe (Amine)** : liste du personnel, création de comptes STAFF, horaires individuels, congés et
  absences, planning personnel hebdomadaire. Ces données sont **enregistrées et consultables**, mais ne modifient pas
  encore les créneaux de réservation (voir « Module 4 » ci-dessous).
- **Module 6 — Paiements, factures et pilotage financier (Salsabil)** : caisse (espèces, carte, mobile,
  paiement fractionné, acomptes), paiement en ligne, factures et reçus PDF numérotés, dépenses,
  tableau de bord multi-centres, exports PDF/CSV, et IA : assistant d'analyse, détection d'anomalies,
  prévision du chiffre d'affaires.

## Démarrage

```bash
npm install
cp .env.example .env      # puis renseigner MONGODB_URI (Atlas) et AUTH_SECRET
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
| `AUTH_SECRET` | clé de signature des sessions NextAuth (`npx auth secret`) ; `SESSION_SECRET` reste accepté |
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

## Module 2 — Catalogue et prestations

| Exigence | Où |
|---|---|
| F2.1 Gestion des services (catégories, durée, tarif de base, description, photos) | `/dashboard/catalogue` (onglet Services) |
| F2.2 Options de services (variantes avec suppléments de prix et de durée) | Dans le formulaire de service (`ServiceModal`) |
| F2.3 Tarification différenciée par centre | Surcharge de prix par centre dans `ServiceModal` et `PackModal` |
| F2.4 Forfaits & Packs multi-services avec calcul automatique des économies | `/dashboard/catalogue` (onglet Packs) |
| F2.5 Compétences requises et matériels nécessaires par prestation | `ServiceModal` (liaison Staff & Équipements) |
| F2.6 Importation automatique du catalogue initial généré par IA | Bannière interactive sur `/dashboard/catalogue` |
| F2.7 Offres promotionnelles & Codes promo (pourcentages, montants fixes, validité, plafonds) | `/dashboard/catalogue` (onglet Promotions) |
| F2.8 Galerie photos et compression WebP côté client | `ImageUploader` intégré dans chaque modal |
| F2.9 Application dynamique dans le parcours de réservation client | `/reserver/[slug]` (`BookingWizard`) |

**IA du module 2** (cahier des charges §6) :
- **Rédaction marketing de prestations** : Génération de descriptions professionnelles et valorisantes par Claude via le bouton `✨ Générer avec l'IA` dans `ServiceModal` (`lib/ai/catalog-ai.ts`). Repli par templates contextuels hors-ligne.
- **Suggestion intelligente de packs** : Analyse automatisée des prestations actives pour concevoir des offres groupées cohérentes et attractives, calcul des réductions optimales et pré-remplissage en 1 clic dans `PackModal`.
- **Audit & recommandations tarifaires** : Évaluation globale de la grille tarifaire (prix moyen, rendement horaire DT/h, diversité des univers de beauté, benchmark selon la localisation géographique en Tunisie) avec synthèse et opportunités d'optimisation du panier moyen.

**Règles métier & intégration** :
- **Calcul précis des réservations** : `resolveItems()` calcule la durée cumulée exacte (durée de base + suppléments d'options) et le prix unitaire ajusté (prix spécifique au centre + suppléments d'options).
- **Validation serveur des codes promo** : Vérification de la période de validité, du centre éligible, du plafond d'utilisations (`maxUses`), et incrémentation atomique du compteur `usedCount`.
- **Traductions complètes** : Expérience 100% bilingue français / arabe (RTL natif).

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

**Compte client obligatoire pour confirmer** : le parcours `/reserver/[slug]` est ouvert à tous (prestations,
praticien, créneau), mais la confirmation demande un compte client (`/register?type=client`). La réservation en
cours est gardée dans l'adresse (`?reprise=…`, `lib/booking/draft.ts`) pendant la connexion ou l'inscription.
Le nom et le téléphone viennent du compte (jamais du formulaire) ; la fiche client du salon est reliée au compte
(`userId`). Après confirmation, le client peut payer l'acompte (30 %) ou la totalité en ligne (page `/paiement`
du Module 6) ; « Mes rendez-vous » sur son tableau de bord affiche ses rendez-vous de tous les salons et le reste à payer.

Règles métier : pas de double réservation (revérification à l'enregistrement), fuseau Africa/Tunis,
annulation/report en ligne jusqu'à 2 h avant, rappels uniquement avec consentement.

## Module 4 — Équipe

Périmètre réalisé (d'après le résumé du cahier des charges ; le texte intégral n'a pas été relu exigence par exigence) :

| Exigence | Où | État |
|---|---|---|
| F4.1 Fiches employés : poste, compétences, centres d'affectation | `/dashboard/equipe` (liste, filtre par centre) ; « Ajouter un membre » | Implémenté. La modification du poste et des compétences d'un employé existant n'est pas encore proposée |
| F4.2 Horaires de travail, congés, absences | Bouton « Horaires » (modal à trois états par jour) ; bouton « Absences » (liste, création, modification, suppression) | Implémenté **en enregistrement seul**. Jours fériés : non |
| F4.3 Affectation des services aux praticiens selon leurs compétences | Compétences enregistrées (texte libre, suggestions tirées de `Service.requiredSkills`) | **Non** : aucun filtrage dans les créneaux ni dans `getPractitioners` |
| F4.4 Pointage et suivi des heures · F4.5 Commissions et performance | — | Non réalisés (priorité I) |
| F4.6 Vue personnelle du staff : planning et rendez-vous | `/dashboard/planning` (« Mon planning ») ; bouton « Planning » sur les cartes pour OWNER/MANAGER | Implémenté, lecture seule |

**Pages et actions**
- `/dashboard/equipe` : cartes du personnel (poste, compétences, centres, horaires personnalisés, absence en cours ou prochaine, sans motif).
- Création d'un compte STAFF : prénom, nom, e-mail et/ou téléphone (au moins un), mot de passe temporaire saisi par le créateur
  (règles de l'inscription : 8 caractères, une lettre, un chiffre, 72 octets UTF-8 au plus ; haché bcrypt, coût 12), poste, compétences,
  au moins un centre. Le rôle est toujours `STAFF` et l'organisation celle du créateur ; toute autre valeur envoyée est ignorée.
- Horaires individuels (`User.workingHours`) : par jour, trois états. Jour **absent** = comme le centre ; `null` = repos ;
  `"09:00-17:00"` = plage (jamais au-delà de minuit). `workingHours: null` = tous les jours comme le centre.
- Congés et absences (`StaffTimeOff`) : types congé (`LEAVE`) et absence exceptionnelle (`ABSENCE`), journée(s) complète(s) ou plage
  horaire d'un seul jour, motif facultatif (120 caractères). Bornes : début au plus 365 jours dans le passé, fin au plus 730 jours
  dans le futur, durée au plus 366 jours. Deux absences d'un même employé ne se chevauchent pas (contrôle applicatif, **non atomique**).
  Le nombre de rendez-vous actifs concernés est affiché ; ils ne sont jamais modifiés ni annulés.
- Planning (`lib/data/planning.ts`) : semaine du lundi au dimanche (heure de Tunis, `?week=YYYY-MM-DD`), rendez-vous de tous statuts
  (annulés estompés), absences, pauses et fermetures, horaires du jour. Ni téléphone, ni notes, ni prix, ni motif.

**Droits**

| Action | OWNER | MANAGER | STAFF |
|---|---|---|---|
| Voir la liste de l'équipe | tous les employés de l'organisation | employés affectés à au moins un de ses centres | non |
| Créer un compte STAFF | centres de l'organisation | uniquement ses centres | non |
| Horaires et absences (voir, créer, modifier, supprimer) | tout employé de l'organisation | **uniquement si tous les centres de l'employé sont dans son périmètre** (sinon : bouton désactivé et explication) | non |
| Planning | tout employé | rendez-vous limités à ses centres, même pour un employé partagé | le sien seulement (`?staff=` ignoré) |

Un employé inconnu, d'une autre organisation, qui n'est pas un STAFF ou hors périmètre reçoit toujours le même message (« Employé introuvable. »).
Les droits sont vérifiés côté serveur (`lib/team/scope.ts`, `lib/team/service.ts`, `lib/data/planning.ts`), pas seulement dans la navigation.

**Données et audit** : champs optionnels `jobTitle`, `skills`, `workingHours` sur `User` ; collection `stafftimeoffs` (modèle `StaffTimeOff`,
`lib/models/team.ts`). Événements du journal de sécurité : `STAFF_CREATED`, `STAFF_HOURS_UPDATED`, `STAFF_TIMEOFF_CREATED`,
`STAFF_TIMEOFF_UPDATED`, `STAFF_TIMEOFF_DELETED` (employé, type et dates ; **jamais** le mot de passe ni le motif). Une modification sans
changement réel ne produit ni écriture ni événement. Le motif d'une absence n'apparaît que dans le modal « Absences » des utilisateurs autorisés.

**Limites connues**
- **Les horaires individuels, les absences et les compétences n'influencent pas les créneaux de réservation** (`lib/booking/` ne les lit pas).
  Un compte STAFF créé devient **immédiatement réservable** dans ses centres, avec les horaires du centre.
- Pas de changement de mot de passe : l'employé garde le mot de passe temporaire. Il n'y a ni invitation par e-mail ni envoi automatique ;
  le lien « mot de passe oublié » n'est affiché qu'en développement ou avec `DEMO_MODE`.
- Pas de désactivation ni de suppression d'un employé ; pas de modification du poste, des compétences ou des centres d'un employé existant.
- Une absence dont le début dépasse 365 jours dans le passé ne peut plus changer de dates (type et motif restent modifiables ; suppression possible).
- Un employé affecté à plusieurs centres : ses horaires et ses absences valent pour tous ses centres (seul le propriétaire les modifie
  si l'un des centres n'est pas celui du gérant). La disponibilité calculée par `lib/booking/` reste, elle, centre par centre.

**Vérifications réalisées** (octobre 2026)
- Tests automatiques : `npm test` (voir `lib/team/*.test.ts` et `lib/booking/*.test.ts`) avec une base MongoDB en mémoire ; commande et résultats
  du dernier passage dans le compte rendu de l'étape 7. Les tests de `lib/booking/` fixent le comportement actuel de la réservation (dont ses limites)
  avant toute intégration.
- Navigateur, base de développement, sans écriture : liste de l'équipe (FR/AR, propriétaire, gérant, staff), formulaire de création (validation,
  e-mail déjà utilisé), modal des horaires (validation, enregistrement sans changement).
- Navigateur, base MongoDB en mémoire isolée (données jetables, serveur sur un autre port) : création, modification, suppression, chevauchements,
  rendez-vous concernés, résumés sur les cartes et événements d'audit des absences ; planning (STAFF, OWNER, MANAGER, CLIENT, URL falsifiée,
  semaines voisines, état vide, français et arabe RTL) ; aucun motif ni donnée client sensible dans les pages ni dans l'audit.

**Parcours à vérifier encore** : création **réussie** d'un compte STAFF dans l'interface (puis connexion avec ce compte) ; enregistrement **réussi**
des horaires dans l'interface ; mise en page sur grand écran ; intégration aux créneaux (à concevoir avec ses propres tests de non-régression).

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
un jour sans saisie de caisse à Djerba et un achat de produits exceptionnel à Sousse.

## Contrats avec les autres modules

| Module | Ce que le Module 3 utilise | Fichier |
|---|---|---|
| 2 — Catalogue (Maya) | collections `services` et `packs` (nom, catégorie, durée, prix, centres) | `lib/models/catalog.ts` |
| 4 — Équipe (Amine) | praticiens = utilisateurs `STAFF` affectés au centre (`centerIds`) ; les horaires, absences et compétences du Module 4 ne sont **pas encore lus** | `lib/booking/availability.ts` |
| 6 — Finances (Salsabil) | `bookings` (statut `COMPLETED`, `totalTnd`, `items`) ; le Module 6 passe un RDV réglé à `COMPLETED` | `lib/models/booking.ts`, `lib/finance/service.ts` |
| Socle — Notifications | boîte d'envoi `notifications` (statut `QUEUED`) à brancher sur SMS/WhatsApp | `lib/models/booking.ts` |

## Authentification (NextAuth)

**NextAuth v5 (Auth.js)**, fournisseur `credentials` : connexion par e-mail **ou** téléphone + mot de passe (bcrypt).
- `auth.config.ts` : configuration sans base (session JWT dans un cookie httpOnly, rôle et organisation dans le jeton,
  7 jours avec « Se souvenir de moi », 12 h sinon) — utilisée par `proxy.ts`.
- `auth.ts` : `NextAuth()` avec la vérification du mot de passe dans MongoDB → `auth`, `signIn`, `signOut`, `handlers`.
- `app/api/auth/[...nextauth]/route.ts` : routes NextAuth.
- `app/actions/auth.ts` : connexion (`signIn`), blocage après 5 échecs, inscription propriétaire ou client, déconnexion
  (`signOut`), mot de passe oublié ; chaque événement est inscrit au journal de sécurité.
- `lib/dal.ts` : `getCurrentUser()` / `requireRole()` relisent la session (`auth()`) et l'utilisateur en base à chaque requête.

## Architecture

- `lib/models/` — schémas Mongoose (`core`, `catalog`, `booking`, `finance`, `team`) · `lib/db.ts` — connexion unique
- `lib/team/` — Module 4 : droits et centres, services d'écriture, validation, horaires, absences, planning, tests
- `lib/finance/` — Module 6 : règles métier, rapports, IA, PDF, passerelle de paiement, tests
- `lib/dal.ts` — Data Access Layer (`getCurrentUser`, `requireRole`, centres accessibles)
- `lib/booking/` — disponibilités, création, rappels, prédiction, chatbot, fuseau horaire
- `lib/data/` — lectures pour les pages (calendrier, clients, vitrine publique)
- `app/actions/` — Server Actions (toujours revérifiées côté serveur)
- `scripts/seed.ts` — jeu de démonstration · `scripts/local-db.ts` — MongoDB local
