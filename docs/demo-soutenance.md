# Démonstration SalonEscrow + MetaMask — guide pour la soutenance

Durée : environ 15 minutes. Tout tourne sur le PC, en local : blockchain Hardhat, MongoDB local, Salonia.
Aucune base partagée, aucun vrai argent. Détails techniques : [`salonescrow.md`](salonescrow.md).

---

## A. La veille : préparer MetaMask (une seule fois)

1. Dans **Chrome**, installer l'extension **MetaMask** (https://metamask.io/download/), créer un portefeuille
   **réservé aux tests** (noter la phrase de récupération sur papier ; ne jamais y mettre de vrais fonds).
2. Épingler MetaMask dans la barre de Chrome (icône puzzle → épingle), pour que le jury voie les fenêtres.
3. Dans MetaMask, créer un deuxième compte (« Compte 2 ») : il servira à montrer qu'un wallet déjà relié est refusé.

## B. Le jour J : démarrer l'environnement (PowerShell, 3 terminaux)

Dans VS Code, ouvrir le dossier `projetnext`, puis le panneau Terminal. Une commande à la fois.

**Terminal 1 — blockchain locale** (laisser ouvert) :

```powershell
cd ..\SalonEscrow
```
```powershell
npx hardhat node
```

**Terminal 2 — base MongoDB locale** (bouton **+**, laisser ouvert) :

```powershell
npm run db:local
```

**Terminal 3 — préparation et serveur** (bouton **+**) :

```powershell
$env:MONGODB_URI="mongodb://127.0.0.1:27017"; $env:MONGODB_DB="salonia_demo"
```
```powershell
npm run db:seed
```
```powershell
npx tsx --conditions=react-server scripts/escrow-dev.ts salon-yasmine 30
```
```powershell
Get-Content .env.escrow.local | ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "env:$k" $v.Trim('"') }
```
```powershell
npm run dev
```

Ouvrir **http://localhost:3000** dans Chrome. Comptes de démonstration (mot de passe `Demo1234`) :
`client@salonia.tn` (cliente), `staff@salonia.tn` (praticienne Amira), `owner@salonia.tn` (propriétaire).

> La blockchain locale repart de zéro à chaque `npx hardhat node`. Après un redémarrage :
> refaire les commandes 3 à 5 du terminal 3, et dans MetaMask : Paramètres → Avancé → « Effacer les données d'activité ».

**Pour la démo du staff (étape 7)** : 30 minutes avant de passer, réserver (cliente, Amira) un créneau qui
commencera pendant la soutenance. On ne peut réserver qu'au moins 30 minutes à l'avance.

---

## C. Déroulé devant le prof

### 1. Le problème et l'architecture (1 min)
Le rendez-vous manqué : le salon perd un créneau et l'acompte est contesté. Le contrat joue le tiers neutre.
Montrer le schéma de `salonescrow.md` : MetaMask (navigateur) → Salonia (serveur Next.js, viem) → contrat
`BookingEscrow` = `SlotBooking` (Membre 1) + `DepositVault` (Membre 2) + jeton `MockTND`.

### 2. Relier MetaMask au compte (1 min)
1. Se connecter par e-mail avec `client@salonia.tn`.
2. Tableau de bord → carte **« Mon wallet MetaMask »** → **Relier MetaMask**.
3. MetaMask propose d'**ajouter le réseau Hardhat** (31337) : accepter.
4. MetaMask affiche un **message à signer** : montrer qu'il contient le site, l'adresse, le réseau et un nonce,
   et **qu'il n'y a aucun frais**. Signer.

> À dire : « Salonia ne voit jamais la clé privée. Le serveur vérifie la signature, le site (anti-hameçonnage),
> le réseau et un nonce à usage unique (anti-rejeu). Le lien adresse ↔ compte est rangé dans une base séparée. »

### 3. Se connecter avec MetaMask (30 s)
Se déconnecter → page de connexion → **« Se connecter avec MetaMask »** → signer. On arrive sur le tableau de bord
sans mot de passe : c'est **NextAuth** qui pose la session, comme pour l'e-mail.

### 4. Gérer la monnaie de test (1 min)
Carte « Mon wallet » : **Recevoir 100 MockTND de test** (MetaMask → Confirmer), puis
**Afficher MockTND dans MetaMask** : le jeton apparaît dans MetaMask avec son solde.

### 5. Réserver avec acompte (2 min)
1. **Réserver** → Coupe homme → Amira → un jour **dans 3 jours ou plus** → une heure pile ou à la demie.
2. Montrer : acompte **fixé par le salon** (30 TND), règle des 24 h, « Créneau libre sur la blockchain ».
3. **Confirmer et payer l'acompte avec MetaMask** : MetaMask demande **l'autorisation** (approve) puis la
   **réservation** (createBooking). Montrer les étapes affichées par Salonia.
4. Écran final : « Acompte bloqué sur la blockchain », n° de réservation, hash de transaction.
5. Montrer le **terminal 1** : les lignes `BookingEscrow#createBooking` prouvent la transaction sur la blockchain.

> À dire : « Le navigateur signe, mais le serveur ne le croit pas sur parole : il relit la transaction sur la
> chaîne et vérifie client, centre, praticien et heure avant de confirmer le rendez-vous. »

### 6. Annuler : la règle des 24 heures (2 min)
1. Tableau de bord → « Mes rendez-vous » → **Annuler** sur la réservation de l'étape 5 : le message annonce
   **« votre acompte vous sera remboursé »** (plus de 24 h avant). Confirmer, signer dans MetaMask.
2. Carte « Mon wallet » : **À retirer du contrat : 30 TND** → **Retirer mon solde** → MetaMask → le solde MockTND
   remonte dans MetaMask.
3. Réserver un créneau **aujourd'hui** puis l'annuler : le message annonce **« l'acompte sera versé au salon »**.

### 7. Côté salon : valider ou marquer l'absence (2 min)
1. Se connecter avec `staff@salonia.tn` → **Calendrier** → ouvrir le rendez-vous préparé (partie B).
2. Montrer : « Acompte bloqué · lu sur la blockchain », **pas de boutons Reporter / Annuler** (seul le client peut
   annuler), boutons grisés tant que l'heure n'est pas venue.
3. À l'heure du rendez-vous : **Prestation réalisée** (ou **Client absent** 15 minutes après) → « Terminé ».

### 8. Les protections (2 min)
- **Double réservation** : le créneau réservé disparaît pour les autres clients ; dans le contrat, un deuxième
  `createBooking` sur le même créneau échoue (`SlotAlreadyBooked`, scénario 1 des tests).
- **Un wallet = un compte** : créer un deuxième compte client (`/register?type=client`), puis essayer de relier le
  **même** compte MetaMask → refusé (« Ce wallet est déjà relié à un autre compte Salonia »).
- **Base séparée, sans clé** : ouvrir **MongoDB Compass** sur `mongodb://127.0.0.1:27017` → base
  `salonia_demo_chain` → collection `walletaccounts` : adresse, userId, dates… **aucune clé privée**.

### 8 bis. Toutes les transactions de la blockchain (2 min)
Se connecter avec `owner@salonia.tn` → onglet **Blockchain** (explorateur de blocs) :
- toutes les transactions de **tous les comptes**, lues **directement dans les blocs** (pas dans la base Salonia) :
  n° de bloc, heure, réussite, fonction appelée (`createBooking`, `approve`, `cancelBooking`, `withdraw`…), gaz,
  et les **événements émis par le contrat** (« réservation n°1 annulée → remboursée au client ») ;
- bouton **« Adresses brutes »** : retire les noms ajoutés par Salonia et montre exactement ce que contient la
  blockchain (adresses et hash complets) — la chaîne ne connaît aucun nom ;
- filtres Réservations / Jeton MockTND / ETH de test, et **Actualisation auto** pendant qu'on réserve dans un autre onglet.

Équivalent en ligne de commande : `npx tsx scripts/escrow-explorer.ts`.

### 9. Les tests automatisés (1 min)
Dans un terminal (arrêter un serveur n'est pas nécessaire) :

```powershell
cd ..\SalonEscrow
```
```powershell
npx hardhat test
```
→ **159 tests** du contrat (scénarios 1 à 6 : double réservation, 24 h, absence, validation, accès refusé).

```powershell
cd ..\projetnext
```
```powershell
npm test
```
→ **861 tests** Salonia, dont la connexion MetaMask (signatures réelles, anti-rejeu, mauvais site, mauvais réseau).

---

## D. Questions probables du jury

| Question | Réponse courte |
|---|---|
| Pourquoi MetaMask plutôt que des wallets gérés par le serveur ? | Le client garde le contrôle de sa clé : Salonia ne peut ni dépenser ni annuler à sa place. Le serveur reste garde-fou en revérifiant chaque transaction. |
| Où est la clé privée ? | Uniquement dans MetaMask. Salonia ne stocke que l'adresse publique. |
| Comment Salonia sait qui est connecté ? | « Sign-In With Ethereum » : signature d'un message (site, réseau, nonce) vérifiée par le serveur, puis session NextAuth normale. |
| Et si on rejoue une ancienne signature ? | Refusée : le nonce est à usage unique et expire en 10 minutes. |
| Et si un site pirate fait signer le message ? | Refusé : le message contient le nom du site, le serveur vérifie qu'il s'agit du sien. |
| Pourquoi une base séparée ? | Séparer les données blockchain (adresses) des données métier ; le lien se fait par `userId`, aucune donnée personnelle sur la chaîne. |
| Que se passe-t-il si le client ferme MetaMask en pleine réservation ? | Le créneau est tenu 15 minutes puis libéré automatiquement ; un refus le libère aussitôt. |
| Le staff utilise-t-il MetaMask ? | Non : son wallet est géré par le serveur (choix pour la démo) ; c'est une évolution possible. |
| Pourquoi un jeton de test ? | Le projet ne manipule aucun vrai argent : MockTND, 6 décimales, sur une blockchain locale ou Sepolia. |
