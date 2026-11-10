# Salonia

PWA de gestion de salons (beauté/coiffure, Tunisie) : multi-centres, FR/AR (RTL). Rôles : SUPER_ADMIN, OWNER, MANAGER, STAFF, CLIENT. Un module par membre du groupe.
Lire `README.md` (modules, règles métier, comptes de démo, détail du Module 4) et `AGENTS.md`. Avant tout changement lié au framework, lire la doc Next.js installée (`node_modules/next/dist/docs/`) : cette version n'est pas celle que l'on connaît (`proxy.ts` remplace le middleware, `cacheComponents`).

## Stack (base de travail PROVISOIRE)
Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4, MongoDB/Mongoose, Zod, NextAuth v5 (JWT, credentials : `auth.ts`, `auth.config.ts`), alias `@/*`.
Le cahier des charges annonce PostgreSQL/Prisma/FastAPI : écart NON validé par l'encadrement. Aucune migration ni changement d'auth ou d'architecture sans accord explicite.

## Où va le code
- `app/dashboard/<x>/page.tsx` : page serveur (`<Suspense>` + `requireRole(...)`), qui passe des données sérialisées à un composant client.
- `components/<x>/` : composants client. Navigation par rôle : `components/dashboard/nav.tsx`.
- `lib/data/` : lectures pour les pages. `lib/<domaine>/` : règles métier et tests `*.test.ts`.
- `lib/models/` : schémas Mongoose (helper `model()`). `lib/enums.ts` : valeurs partagées, dont les types du journal d'audit.
- `app/actions/<x>.ts` : Server Actions (`"use server"`), minces. `lib/dal.ts` : `getCurrentUser`, `requireRole`, `accessibleCenterIds`.
- SalonEscrow (acompte blockchain, Module 3) : `lib/escrow/` (`chain.ts` seul envoi de transactions via viem, `service.ts` droits et base, `rules.ts` purs), `Booking.escrow`, `docs/salonescrow.md`. Clés `ESCROW_*` serveur uniquement, testnet uniquement. Clients : MetaMask signe (`lib/wallet/`, connexion SIWE dans `auth.ts`, base séparée `<db>_chain`), le serveur revérifie chaque transaction ; jamais de clé privée côté app.
- F4 : `lib/team/` (`scope.ts` droits et centres, `service.ts` écritures, `schemas.ts` Zod, `hours.ts` / `timeoff.ts` / `planning.ts` purs), `lib/data/team.ts` et `lib/data/planning.ts` (lectures), `lib/models/team.ts` (`StaffTimeOff`), `components/team/`.

## Conventions de code
- Chaque action revérifie la session et le rôle côté serveur ; le client n'est jamais cru sur parole. Mettre droits et écritures dans un service testable (`lib/<domaine>/service.ts`), l'action ne fait qu'appeler, journaliser (`logEvent`) et invalider les caches.
- Isolation : `organizationId` sur toute donnée métier et dans chaque requête ; centres via `resolveCenterId` / `accessibleCenterIds` (F4 : `teamCenters`, même règle réécrite pour rester testable). Un gérant n'agit que sur ses centres, un staff que sur ses propres données. Isolation non auditée dans son ensemble : la contrôler pour tout code touché.
- Entrées validées avec Zod ; clés inconnues ignorées (le rôle, l'organisation et les identifiants viennent du serveur). Actions sensibles : `logEvent(...)` (`lib/audit.ts`), type ajouté à `lib/enums.ts` **et** à `components/dashboard/security-log.tsx`, détail sans donnée sensible (jamais de mot de passe ni de motif d'absence).
- Après mutation : `revalidatePath` / `updateTag`. Fuseau Africa/Tunis ; montants en TND.
- Modèle à suivre : `app/dashboard/availability`, `clients`, `equipe`, `app/actions/team.ts`.

## Design system
Thème sombre (`app/globals.css`) : `plum-950/900/800`, `rose-gold`, `blush`, `champagne`, `gold`. Texte Inter, titres `font-display` (Playfair) ; arabe : Cairo/Amiri.
Cartes `.glass`, action principale `.btn-shine`, `.text-gradient`, `.stagger`, fond `<Aurora>`, `DashboardHeader`. Réutiliser `Field`/`SubmitButton`/`Alert` (`components/ui/form.tsx`), `Modal`/`Toast` (`components/ui/modal.tsx`), `icons.tsx`. Pas de tableau partagé : grilles de cartes. Aucune dépendance UI nouvelle.
Tout texte via `t()` / `<T>` avec traduction dans `lib/i18n-ar.ts` (messages d'erreur du serveur compris) ; classes logiques RTL (`ps-`, `start-`, `rtl:`) ; dates et heures isolées avec `<bdi>` (voir `components/team/timeoff-period.tsx`) ; mobile d'abord.

## Commandes et vérifications
`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run dev`. À rapporter tels quels, jamais supposés. `next-auth` est installé ; ne pas relancer `npm install` ni `npm audit fix` sans accord.
⛔ `db:seed` / `db:seed:finance` effacent les données de démo : jamais sans accord ni vérification de la base visée. `db:seed:team` est additif (simulation par défaut, `--apply` pour écrire).
- `npm test` s'exécute avec la condition `react-server` : `react-dom/server` y est désactivé. Les tests de base utilisent `lib/booking/test-support.ts` (MongoDB en mémoire, jamais `.env`, échec explicite si le binaire `mongod` manque, aucun téléchargement).
- Parcours navigateur : jamais sur la base de développement. Utiliser une base en mémoire avec `MONGODB_URI` imposé au processus (une variable d'environnement prime sur `.env`), un port distinct (arrêter d'abord le serveur du port 3000 : verrou de Next), des données jetables, puis tout arrêter. Un serveur de développement doit être **redémarré** après l'ajout d'un type d'audit ou d'un modèle (cache Mongoose).
- Pas d'écriture réelle dans la base de développement pour « essayer » une fonctionnalité.

## Règles à préserver
Staff : voit seulement ses rendez-vous et encaissements. Pas de double réservation. Rappels avec consentement. L'IA propose, l'utilisateur décide.
Sécurité : ne jamais lire, afficher ni committer `.env`, mots de passe ou phrases secrètes.
Méthode : inspecter avant d'agir, changements petits et ciblés, vérifier puis rapporter les résultats exacts, distinguer vérifié / hypothèse. Pas de commit ni de push sans demande.

## F4 Équipe : état (détail et droits dans `README.md`, « Module 4 »)
**Implémenté, avec tests :** liste de l'équipe (`/dashboard/equipe`), création de comptes **gérant** (propriétaire seul) et personnel via des rôles prédéfinis (`lib/team/roles.ts` ; le rôle d'accès est déduit par le serveur ; un gérant ne crée que du personnel dans ses centres ; mot de passe temporaire), liste avec badge de rôle, horaires individuels, congés et absences (collection `StaffTimeOff`, distincte d'`AvailabilityBlock`), planning hebdomadaire en lecture seule (`/dashboard/planning`).
**ENREGISTREMENT SEUL :** horaires individuels, absences et compétences **n'influencent pas** les créneaux ni `getPractitioners` ; un nouveau membre est réservable aussitôt. Ne pas le présenter comme déjà pris en compte.
**IA de l'équipe (Gemini, `GEMINI_API_KEY`) :** « Performance » (`lib/team/performance*.ts`), « Suggérer un praticien » dans le formulaire de rendez-vous (`lib/team/assignment*.ts`), « Prévision de charge » (`lib/team/forecast*.ts`), modèles dans `lib/ai/team-*.ts`. Performance : indicateurs des 30 jours, note 0-100 sur 6 critères pondérés, bornée à ±25 points de la note calculée ; repli sans IA si clé absente ou réponse invalide. Seuls des agrégats anonymes sont envoyés. Rien n'est enregistré (l'IA propose). Vérifié avec un vrai appel Gemini en base isolée.
**Gérants (propriétaire seul) :** affectation aux centres, modification du nom, désactivation (`User.deactivatedAt`, rien n'est supprimé ; connexion et session refusées).
**Non fait :** réactivation d'un gérant, modification/désactivation du **personnel**, changement de rôle d'un membre existant, horaires/absences/planning d'un gérant, filtrage des praticiens par compétences, prise en compte des horaires et absences dans les créneaux (touche `lib/booking/` : analyse d'impact et approbation explicite d'abord), changement de mot de passe, désactivation d'un employé, jours fériés, pointage, commissions.
**Navigateur :** vérifié en base isolée (novembre 2026) : création d'un compte STAFF, horaires, absences, planning, gérants (centres, désactivation), IA Gemini (performance, suggestion de praticien, prévision de charge). Détail dans le README.
**À trancher (ne pas décider seul) :** validation de l'architecture par l'encadrement ; conformité exigence par exigence sur le cahier des charges intégral (seul un résumé a été lu) ; intégration aux créneaux ; limite du plan Starter ; priorités F4.4 / F4.5 / F5.
