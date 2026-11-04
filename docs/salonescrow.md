# SalonEscrow dans Salonia — acompte sécurisé par la blockchain (Module 3, Membre 1)

Contrats : dépôt séparé [`Salsabil-23/SalonEscrow`](https://github.com/Salsabil-23/SalonEscrow)
(`SlotBooking.sol` Membre 1, `DepositVault.sol` + `MockTND.sol` Membre 2, assemblés dans `BookingEscrow.sol`).
Ce document décrit l'intégration côté Salonia : où est le code, comment le lancer, ce qui est vérifié.

> Testnet uniquement. MockTND n'a aucune valeur. Les clés des wallets sont gérées par le serveur.

## Principe

- **Le navigateur ne signe rien.** Le serveur Next.js est le seul à envoyer des transactions (viem). Le client n'a
  ni wallet ni crypto à gérer.
- **Un wallet par compte Salonia**, dérivé d'une phrase HD serveur (`ESCROW_HD_MNEMONIC`) :
  `m/44'/60'/0'/0/{User.walletIndex}`. Les trésoreries des centres : `m/44'/60'/1'/0/{Center.chainId}`.
  Seul l'index est en base, jamais une clé. L'administrateur (`ESCROW_ADMIN_PRIVATE_KEY`, propriétaire du contrat)
  configure les centres, nomme le staff au besoin et envoie un peu de gaz de test aux wallets.
- **Identifiants de chaîne** : `Center.chainId` et `User.chainId` (praticien) sont des `uint32` attribués une seule
  fois (`lib/escrow/ids.ts`, compteur atomique). Aucune donnée personnelle sur la chaîne.
- **La base reste juge des chevauchements** (durées de prestation variables) ; la chaîne verrouille l'heure de début
  du créneau et l'argent. Le statut de l'acompte est **relu sur la chaîne** (`getBooking`) à l'affichage.
- Un centre utilise l'acompte sécurisé dès qu'il a un `chainId` (configuré par l'administrateur). Sans variables
  `ESCROW_*`, la fonctionnalité est désactivée et Salonia fonctionne comme avant.

## Parcours

| Écran | Lectures | Écritures (wallet) | Code |
|---|---|---|---|
| Réservation `/reserver/[slug]` | `depositOf`, `isSlotFree` | `faucet` (si besoin), `approve`, `createBooking` (client) | `app/actions/public-booking.ts`, `components/booking/escrow-deposit.tsx` |
| Mes rendez-vous `/dashboard` (client) | `getBooking` | `cancelBooking` (client) | `app/actions/client.ts`, `components/booking/escrow-booking-status.tsx` |
| Calendrier `/dashboard/calendar` | `getBooking`, `isStaff` | `setStaff` (admin, si besoin), `markCompleted` / `markNoShow` (staff) | `app/actions/bookings.ts`, `components/calendar/escrow-panel.tsx` |

Règles appliquées (vérifiées par Salonia **et** par le contrat) :
- créneaux alignés sur 30 minutes (seuls ceux-ci sont proposés pour un centre à acompte sécurisé) ;
- annulation par le client seulement, avant le début : remboursée si 24 h ou plus avant, sinon acompte au salon —
  l'issue est annoncée avant de confirmer ;
- « Prestation réalisée » dès l'heure de début, « Client absent » 15 minutes après ;
- un rendez-vous à acompte ne peut être ni déplacé, ni annulé par le salon, ni changé de statut à la main
  (lien SMS et calendrier refusent, côté serveur) ;
- si la transaction de réservation échoue, le rendez-vous Salonia est retiré (`rollbackUnpaidBooking`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/escrow/chain.ts` | Service viem : lectures, écritures simulées puis envoyées, attente de confirmation, gaz de test |
| `lib/escrow/service.ts` | Lien base ↔ chaîne : droits, verrouillage, annulation client, règlement staff, retour arrière |
| `lib/escrow/config.ts` | Variables `ESCROW_*` (serveur uniquement), wallets dérivés ; refuse tout réseau autre que hardhat/sepolia |
| `lib/escrow/errors.ts` | Erreurs du contrat traduites en messages clairs (aucun détail technique vers le navigateur) |
| `lib/escrow/rules.ts` | Règles du contrat recopiées (30 min, 15 min, 24 h), pour annoncer l'issue à l'avance |
| `lib/escrow/ids.ts` | Attribution des `chainId` et `walletIndex` |
| `lib/escrow/abi.ts` | ABI générées (`npx tsx scripts/escrow-abi.ts ../SalonEscrow`) |
| `lib/models/booking.ts` (`Booking.escrow`) | Copie locale : n° de réservation sur la chaîne, montant, wallet, statut, hash des transactions |
| `scripts/escrow-dev.ts` | Démo locale : déploie sur le nœud Hardhat, configure les centres d'un salon |
| `scripts/escrow-smoke.ts` | Essai de bout en bout du service sur un nœud local (13 étapes) |

## Lancer en local

```bash
# 1. Dépôt SalonEscrow (à côté de Salonia)
cd ../SalonEscrow && npm install && npx hardhat compile && npx hardhat node
# 2. Salonia : base LOCALE uniquement (jamais la base partagée)
MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB=salonia_demo npx tsx --conditions=react-server scripts/escrow-dev.ts salon-yasmine 30
# 3. Démarrer avec les variables écrites dans .env.escrow.local (ignoré par Git)
set -a && . ./.env.escrow.local && set +a && MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB=salonia_demo npm run dev
```

## Préparation Sepolia (non déployé)

Rien n'a été déployé sur un réseau public : à faire seulement après accord, avec le script de déploiement du
Membre 2 (dépôt SalonEscrow). Liste de contrôle :

1. Déployer `MockTND` puis `BookingEscrow(admin, token)` sur Sepolia ; noter les adresses (fichier deployments du dépôt).
2. Copier les ABI si les contrats ont changé : `npx tsx scripts/escrow-abi.ts ../SalonEscrow`.
3. Variables serveur (Vercel ou `.env`, jamais commitées) :
   `ESCROW_NETWORK=sepolia`, `ESCROW_RPC_URL` (Alchemy/Infura), `ESCROW_CONTRACT_ADDRESS`, `ESCROW_TOKEN_ADDRESS`,
   `ESCROW_ADMIN_PRIVATE_KEY` (clé du déploiement, **testnet uniquement**), `ESCROW_HD_MNEMONIC` (phrase **neuve**).
4. Alimenter l'administrateur en ETH Sepolia (faucet) : il paie le gaz de test des wallets (0,01 ETH par recharge).
5. Configurer les centres de démonstration : `setTreasury` + `setDeposit` et `Center.chainId`
   (équivalent de `scripts/escrow-dev.ts`, sur la base de démonstration, jamais la base partagée).
6. Les reçus affichent alors un lien Etherscan Sepolia.

Points d'attention : une réservation enchaîne jusqu'à 4 transactions (gaz, jetons, approve, createBooking), soit
quelques dizaines de secondes sur Sepolia ; les écrans affichent l'attente. L'administrateur doit garder de l'ETH de test.

## Vérifié

- Contrats (dépôt SalonEscrow) : 159 tests Hardhat, couverture 100 % des lignes des contrats déployés.
- Salonia : tests `lib/escrow/*.test.ts` (règles, configuration, erreurs, attribution des numéros, contrôles du service).
- Navigateur, base en mémoire + nœud Hardhat local : réservation avec acompte, annulation remboursée (> 24 h),
  annulation versée au salon (< 24 h), validation par le staff et absence ; état de la chaîne comparé à la base.

## À coordonner

- **Module 6** : `lib/finance/service.ts` passe un rendez-vous entièrement payé en caisse à « Terminé » dans la base.
  Pour un rendez-vous à acompte, ajouter `&& !booking.escrow` à cette condition : c'est le staff qui valide sur la chaîne.
- **Module 6** : retrait des soldes (`withdraw`) et tableau de bord des paiements (Membre 2).
- **Module 4** : champs `User.chainId` et `User.walletIndex` ajoutés au modèle `User` (facultatifs).
- Le calendrier mensuel public compte encore les créneaux de 15 minutes pour un centre à acompte sécurisé.
