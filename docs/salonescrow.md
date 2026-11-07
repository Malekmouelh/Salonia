# SalonEscrow dans Salonia — acompte sécurisé par la blockchain (Module 3, Membre 1)

Contrats : dépôt séparé [`Salsabil-23/SalonEscrow`](https://github.com/Salsabil-23/SalonEscrow)
(`SlotBooking.sol` Membre 1, `DepositVault.sol` + `MockTND.sol` Membre 2, assemblés dans `BookingEscrow.sol`).
Ce document décrit l'intégration côté Salonia : où est le code, comment le lancer, ce qui est vérifié.

> Testnet uniquement. MockTND n'a aucune valeur. Les clients signent avec **MetaMask** (Salonia ne voit jamais leur clé) ;
> le staff et l'administrateur utilisent des wallets gérés par le serveur.

## Principe

- **MetaMask obligatoire pour les clients.** Le navigateur signe les transactions du client (`approve`, `createBooking`,
  `cancelBooking`, faucet, `withdraw`) ; MetaMask garde la clé privée. **Le serveur ne croit jamais le navigateur** :
  il relit chaque transaction sur la chaîne (reçu réussi, bon contrat, événement `BookingCreated` / `BookingCancelled`,
  bon client, bon centre, bon praticien, bonne heure) avant d'écrire dans la base.
  Écart assumé et validé avec le cahier des charges, qui prévoyait des wallets gérés par le serveur.
- **Connexion MetaMask dans NextAuth** (fournisseur `wallet`, `auth.ts`) : « Sign-In With Ethereum » (EIP-4361).
  MetaMask signe un message lisible (site, adresse, réseau, nonce) ; le serveur vérifie la signature, le site
  (anti-hameçonnage), le réseau, la fraîcheur et consomme le nonce (anti-rejeu). La connexion e-mail reste disponible.
- **Base blockchain séparée** (`<MONGODB_DB>_chain`, ou `CHAIN_MONGODB_DB`) : `walletaccounts` (adresse ↔ `userId`
  Salonia, un wallet par compte, un compte par wallet) et `walletnonces` (nonces à usage unique, expiration automatique).
  **Aucune clé privée n'est stockée**, nulle part. Le lien avec Salonia se fait par `userId`.
- **Staff et administrateur** : wallets gérés par le serveur, dérivés de `ESCROW_HD_MNEMONIC`
  (`m/44'/60'/0'/0/{User.walletIndex}`) ; trésoreries `m/44'/60'/1'/0/{Center.chainId}`. L'administrateur
  (`ESCROW_ADMIN_PRIVATE_KEY`) configure les centres, nomme le staff au besoin et envoie du gaz de test.
- **Identifiants de chaîne** : `Center.chainId` et `User.chainId` (praticien), `uint32` attribués une seule fois
  (`lib/escrow/ids.ts`). Aucune donnée personnelle sur la chaîne.
- **La base reste juge des chevauchements** ; la chaîne verrouille l'heure de début et l'argent. Le statut de
  l'acompte est **relu sur la chaîne** (`getBooking`) à l'affichage.
- Sans variables `ESCROW_*`, tout est désactivé (ni acompte, ni MetaMask) et Salonia fonctionne comme avant.

### Réservation avec MetaMask

1. Salonia enregistre le rendez-vous **en attente** (`PENDING`) : le créneau est tenu 15 minutes (`escrowHoldUntil`).
2. Le navigateur reçoit ce qu'il doit signer (centre, praticien, heure, montant fixé par le centre).
3. MetaMask : jetons de test si besoin (`faucet`), `approve` du montant exact, `createBooking`.
4. Le serveur relit la transaction et confirme le rendez-vous (`confirmEscrowFromTx`).
5. Refus dans MetaMask ou échec : le créneau est rendu aussitôt ; sans réponse, il est libéré après 15 minutes
   (`releaseExpiredHolds`).

## Parcours

| Écran | Lectures | Écritures (wallet) | Code |
|---|---|---|---|
| Connexion `/login` | — | signature EIP-4361 (MetaMask) | `auth.ts`, `app/actions/wallet.ts`, `components/wallet/metamask.tsx` |
| Réservation `/reserver/[slug]` | `depositOf`, `isSlotFree` | **MetaMask** : `faucet` (si besoin), `approve`, `createBooking` | `app/actions/public-booking.ts`, `components/booking/booking-wizard.tsx` |
| Mes rendez-vous `/dashboard` (client) | `getBooking` | **MetaMask** : `cancelBooking` | `app/actions/client.ts`, `components/booking/escrow-booking-status.tsx` |
| Mon wallet `/dashboard` (client) | soldes ETH, MockTND, `balanceOf` | **MetaMask** : `faucet`, `withdraw` ; liaison / retrait du wallet | `app/actions/wallet.ts`, `components/wallet/metamask.tsx` |
| Calendrier `/dashboard/calendar` | `getBooking`, `isStaff` | `setStaff` (admin, si besoin), `markCompleted` / `markNoShow` (staff) | `app/actions/bookings.ts`, `components/calendar/escrow-panel.tsx` |

Règles appliquées (vérifiées par Salonia **et** par le contrat) :
- créneaux alignés sur 30 minutes (seuls ceux-ci sont proposés pour un centre à acompte sécurisé) ;
- annulation par le client seulement, avant le début : remboursée si 24 h ou plus avant, sinon acompte au salon —
  l'issue est annoncée avant de confirmer ;
- « Prestation réalisée » dès l'heure de début, « Client absent » 15 minutes après ;
- un rendez-vous à acompte ne peut être ni déplacé, ni annulé par le salon, ni changé de statut à la main
  (lien SMS et calendrier refusent, côté serveur) ;
- si la transaction de réservation échoue ou est refusée, le rendez-vous Salonia est retiré (`rollbackUnpaidBooking`) ;
- un wallet qui garde des acomptes bloqués ne peut être ni retiré ni remplacé (seul lui peut les annuler).

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/escrow/chain.ts` | Service viem serveur : lectures, vérification des transactions MetaMask, écritures du staff et de l'admin, gaz de test |
| `lib/escrow/service.ts` | Lien base ↔ chaîne : droits, attente / confirmation / annulation vérifiées, règlement staff, retour arrière |
| `lib/wallet/siwe.ts` | « Sign-In With Ethereum » : nonces, vérification de signature, site, réseau, anti-rejeu |
| `lib/wallet/service.ts` | Comptes MetaMask ↔ comptes Salonia (liaison, retrait, connexion) |
| `lib/wallet/browser.ts` | Côté navigateur : MetaMask via viem (réseau, signature, transactions) |
| `lib/models/chain.ts` | Base blockchain séparée : `WalletAccount`, `WalletNonce` |
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

**MetaMask en local** (navigateur Chrome avec l'extension MetaMask) :
1. MetaMask ajoute le réseau « Hardhat » (chainId 31337, http://127.0.0.1:8545) à la première demande ; accepter.
2. Utiliser un compte MetaMask **de test** : un nouveau compte suffit (Salonia lui envoie de l'ETH de test à la
   liaison), ou importer un compte affiché par `npx hardhat node` (clés publiques, réservées au développement).
   Ne jamais utiliser un compte qui contient de vrais fonds.
3. Se connecter par e-mail une première fois, puis « Relier MetaMask » dans l'espace client ; ensuite « Se connecter
   avec MetaMask » fonctionne depuis /login.
4. Après un redémarrage du nœud Hardhat, MetaMask peut garder d'anciens nonces : Paramètres → Avancé →
   « Effacer les données d'activité ».

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
- Salonia : tests `lib/escrow/*.test.ts` et `lib/wallet/wallet.test.ts` (règles, configuration, erreurs, numéros,
  contrôles du service, « Sign-In With Ethereum » avec de vraies signatures, liaison des wallets dans la base séparée).
- MetaMask simulé par un compte de test sur le nœud local (vrai code serveur) : liaison, connexion, réservation
  vérifiée, transaction d'un autre client ou d'un autre créneau refusée, annulation remboursée, retrait.
  L'extension MetaMask elle-même se teste à la main dans Chrome (voir « MetaMask en local »).
- Navigateur, base en mémoire + nœud Hardhat local : réservation avec acompte, annulation remboursée (> 24 h),
  annulation versée au salon (< 24 h), validation par le staff et absence ; état de la chaîne comparé à la base.

## À coordonner

- **Module 6** : `lib/finance/service.ts` passe un rendez-vous entièrement payé en caisse à « Terminé » dans la base.
  Pour un rendez-vous à acompte, ajouter `&& !booking.escrow` à cette condition : c'est le staff qui valide sur la chaîne.
- **Module 6** : tableau de bord des paiements du salon (Membre 2) ; côté client, le retrait (`withdraw`) est dans « Mon wallet ».
- **Module 4** : champs `User.chainId` et `User.walletIndex` ajoutés au modèle `User` (facultatifs).
- Le calendrier mensuel public compte encore les créneaux de 15 minutes pour un centre à acompte sécurisé.
