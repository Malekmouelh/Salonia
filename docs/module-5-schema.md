# Module 5 — Matériel et stock : schéma de données (document de relecture)

Statut : **IMPLÉMENTÉ** (octobre 2026) : modèles, services, actions serveur, interface (`/dashboard/stock/*`) et bac à sable de vérification existent ; ce document décrit l'état réel du code. À relire par le Membre 4 (cahier des charges : « le schéma de données du Module 5 est relu par le Membre 4 »). Ce qui reste à faire est listé au §9 (consommation automatique des rendez-vous, rattrapage, transferts, IA).

## 0. Décisions de cadrage intégrées

| Point | Décision |
|---|---|
| D1 | Identifiant du matériel = `_id` MongoDB. Aucun compteur. |
| D2 | Alerte quand `quantité <= seuil`. |
| D3 | Quantités **entières**, unités de base `PIECE`, `ML`, `G`. 1 litre = 1 000 ML (conversion à la saisie ou à l'affichage, jamais stockée autrement). |
| D4 | Trois états du matériel : en service, en maintenance, hors service (`IN_SERVICE`, `IN_MAINTENANCE`, `OUT_OF_SERVICE`). |
| D5 | Produits définis au niveau de l'organisation ; niveaux de stock distincts par centre. |
| D6 | **Option 2 (journal ordonné sans transaction) retenue pour le prototype, de façon CONDITIONNELLE (§5).** `StockMovement` = source de vérité, `StockLevel` = projection réparable. **NON GARANTI** tant que les tests de §5.7 ne sont pas écrits et exécutés avec des résultats concluants. Si les garanties ne peuvent pas être établies simplement : arrêt et présentation des éléments justifiant les transactions. `scripts/local-db.ts` n'est pas modifié sans autorisation explicite. Aucune intégration aux Modules 3 et 6 avant ces résultats. |
| D7 | OWNER : définitions communes des produits et recettes. MANAGER : matériel, quantités, seuils, mouvements dans ses centres autorisés. STAFF et CLIENT : aucun accès à l'administration du stock (MVP). |
| D8 | Archivage par `active: false` ; historiques préservés. |
| D9 | Rattrapage : seuls les RDV `COMPLETED` dont la fin est postérieure à la création de la recette applicable sont éligibles. Aucun rattrapage pour `NO_SHOW`, annulés ou non terminés. Pas de limite en jours. Toute consommation reste idempotente (§5.6). |
| D10 | Détection et réparation contrôlée de la projection à l'ouverture de la page (sans nouveau mouvement, sans blocage inutile de l'affichage, sans réparations concurrentes sur un même niveau) et lors des écritures. Pas de cron (§5.6 bis). |
| D11 | Un MANAGER peut activer un produit existant dans un centre autorisé : création du niveau, seuil et stock initial. Le stock initial est tracé par un mouvement d'entrée initial. L'unité vient de la définition globale et n'est pas modifiable par le MANAGER (§5.5). |
| Q2/Q3 | Ne jamais bloquer la clôture d'un RDV ; jamais de stock négatif ; manquant enregistré à part ; `NO_SHOW` ne consomme rien ; pas de restitution automatique au retour `COMPLETED → CONFIRMED` (correction par mouvement explicite) ; aucune double consommation. Intégration aux Modules 3 et 6 : étape dédiée, **pas avant validation du schéma et des tests**. |

## 1. Exigences couvertes

| ID | Exigence | Priorité | Entités |
|---|---|---|---|
| F5.1 | Inventaire du matériel par centre | E | `Equipment` |
| F5.2 | Consommables avec seuil d'alerte | E | `StockProduct`, `StockLevel` |
| F5.3 | Entrées et sorties liées aux prestations | I (requis par la recette) | `StockMovement`, `ServiceRecipe` |
| F5.4 | Maintenance : dates, historique, rappels | I | `MaintenanceRecord` (+ `Equipment.nextMaintenanceAt`) |
| F5.5 | Fournisseurs et bons de commande | I | `Supplier`, `PurchaseOrder` |
| F5.6 | Transferts entre centres | O | nouveaux types de mouvement (aucune collection de stock en plus) |

Sections 2 à 5 : étapes 1 à 9. Section 6 : esquisse des étapes ultérieures, **pas à coder maintenant**.

## 2. Conventions (alignées sur le projet)

- Helper `model()` comme `lib/models/*` ; fichier prévu `lib/models/stock.ts`.
- Constantes dans `lib/enums.ts` au format `NOM_PLURIEL` en majuscules, valeurs en anglais MAJUSCULES (comme `BOOKING_STATUSES`, `PAYMENT_KINDS`) ; libellés français dans `lib/stock/labels.ts` (comme `lib/finance/labels.ts`), arabe dans `lib/i18n-ar.ts`.
  `EQUIPMENT_STATUSES = ["IN_SERVICE", "IN_MAINTENANCE", "OUT_OF_SERVICE"]` · `STOCK_UNITS = ["PIECE", "ML", "G"]` · `STOCK_MOVEMENT_KINDS = ["OPENING", "IN", "OUT", "ADJUSTMENT", "CONSUMPTION", "RECEIPT"]` (`TRANSFER_IN` / `TRANSFER_OUT` : F5.6, non fait) · `PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]`.
- Champ d'état nommé `status` (comme `Booking`, `Invoice`), champ de nature nommé `kind` (comme `Payment`, `StaffTimeOff`), archivage `active: Boolean` (comme `Service`, `Pack`).
- `organizationId` obligatoire et présent dans **chaque** requête ; `centerId` sur toute donnée de centre. Aucun identifiant, rôle ou organisation lu depuis le client.

## 3. Entités des étapes 1 à 9

### 3.1 `Equipment` — F5.1 (une fiche par appareil physique)
| Champ | Type | Règle |
|---|---|---|
| `_id` | ObjectId | identifiant généré (D1) |
| `organizationId` | ObjectId → Organization | obligatoire |
| `centerId` | ObjectId → Center | obligatoire |
| `name` | String | obligatoire, trim |
| `category` | String | obligatoire, trim (texte libre avec suggestions : séchoir, fauteuil, appareil…) |
| `status` | enum `EQUIPMENT_STATUSES` | défaut `IN_SERVICE` |
| `acquiredAt` | Date | facultatif |
| `nextMaintenanceAt` | Date \| null | prochaine échéance ; mise à jour à l'enregistrement d'une maintenance (F5.4) |
| `active` | Boolean | défaut `true` (D8) |

Index : `{organizationId, centerId, active}` ; `{organizationId, nextMaintenanceAt}`. L'historique de maintenance est dans `MaintenanceRecord` (§6).

### 3.2 `StockProduct` — F5.2 (définition commune, niveau organisation, gérée par OWNER)
| Champ | Type | Règle |
|---|---|---|
| `organizationId` | ObjectId | obligatoire |
| `name` | String | obligatoire, trim |
| `unit` | enum `STOCK_UNITS` | **non modifiable dès qu'un mouvement existe** (sinon l'historique change de sens) ; **jamais modifiable par un MANAGER** (D7/D11) |
| `active` | Boolean | défaut `true` |

Index : unique `{organizationId, name}`, collation insensible à la casse, filtre partiel `active: true`.

### 3.3 `StockLevel` — F5.2 (niveau par centre, géré par MANAGER dans ses centres et par OWNER)
| Champ | Type | Règle |
|---|---|---|
| `organizationId`, `productId`, `centerId` | ObjectId | obligatoires |
| `alertThreshold` | Number entier ≥ 0 | modifiable directement (ce n'est pas un mouvement) |
| `quantity` | Number entier ≥ 0 | **projection** du journal (voir §5) : jamais modifiée directement, jamais saisie par l'utilisateur |
| `seq` | Number entier ≥ 0 | numéro du dernier mouvement projeté (0 = aucun) |

Index : **unique** `{productId, centerId}` ; `{organizationId, centerId}`.
Alerte calculée à la lecture : `quantity <= alertThreshold` (D2). Jamais stockée.

### 3.4 `ServiceRecipe` — F5.3 (gérée par OWNER)
| Champ | Type | Règle |
|---|---|---|
| `organizationId` | ObjectId | obligatoire |
| `serviceId` | ObjectId → Service | doit appartenir à l'organisation (lecture seule de `Service`) |
| `productId` | ObjectId → StockProduct | idem |
| `quantityPerService` | Number entier > 0 | dans l'unité du produit |

Index : **unique** `{serviceId, productId}` ; `{organizationId, serviceId}`. `timestamps` activés (`createdAt` sert à la règle de rattrapage, §5.6).
`Service` n'est pas modifié ; `Service.requiredEquipment` reste un texte libre inchangé. Limite : la recette ne tient pas compte des options choisies par le client.

### 3.5 `StockMovement` — F5.3 (journal **ajouté-seulement** : source de vérité)
| Champ | Type | Règle |
|---|---|---|
| `organizationId`, `centerId`, `productId` | ObjectId | obligatoires |
| `kind` | enum `STOCK_MOVEMENT_KINDS` | `OPENING` (stock initial, rang 1), `IN`, `OUT`, `ADJUSTMENT`, `CONSUMPTION` (modèle et validation prêts, **aucun code ne la crée encore**), `RECEIPT` (réception d'une commande d'achat) |
| `purchaseOrderId` | ObjectId → PurchaseOrder | `RECEIPT` seulement (obligatoire pour ce type, interdit pour les autres) ; immuable. Index unique partiel `{purchaseOrderId, productId}` pour `kind = RECEIPT` : une seule réception par commande et produit |
| `seq` | Number entier ≥ 1 | rang du mouvement dans le journal de (produit, centre) |
| `delta` | Number entier | variation **réellement appliquée** (négative pour une sortie) |
| `balanceAfter` | Number entier ≥ 0 | solde après ce mouvement (= solde précédent + `delta`) |
| `requested` | Number entier > 0 | `CONSUMPTION` seulement : quantité demandée par la recette (agrégée par produit sur le RDV) |
| `shortfall` | Number entier ≥ 0 | `CONSUMPTION` seulement : quantité manquante. Invariant : `requested = -delta + shortfall` |
| `bookingId` | ObjectId → Booking | `CONSUMPTION` ; facultatif pour une correction liée à un RDV |
| `note` | String ≤ 120 | **obligatoire** pour `ADJUSTMENT` |
| `createdBy` | ObjectId → User | utilisateur à l'origine (consommation : celui qui a clos le RDV) |
| `createdAt` | Date | `timestamps` |

Un mouvement est **complet dès son insertion** (plus de statut « en attente » ni de règlement ultérieur) et n'est jamais modifié ni supprimé. Toute erreur se corrige par un nouveau mouvement `ADJUSTMENT`. Les services concernés se retrouvent par `bookingId`.

Index :
- **Rang unique** : unique `{productId, centerId, seq}` (sert aussi à lire la fin du journal).
- **Idempotence de la consommation** : unique partiel `{bookingId, productId}`, filtre `{kind: "CONSUMPTION"}`.
- Historique d'un produit : `{organizationId, centerId, productId, createdAt: -1}`.
- Série de consommation pour la prévision : `{productId, centerId, kind, createdAt}`.

## 4. Relations

```
Organization 1─* Center 1─* Equipment                       (Equipment 1─* MaintenanceRecord, étape 10)
Organization 1─* StockProduct 1─* StockLevel *─1 Center
StockLevel(produit, centre) 1─* StockMovement                (journal = vérité ; StockLevel = projection)
Service *─* StockProduct   via ServiceRecipe(quantityPerService)
Booking.items[].serviceId → ServiceRecipe → StockMovement(CONSUMPTION, centre du RDV, produit)
Supplier 1─* PurchaseOrder 1─* lignes → StockMovement(RECEIPT) (une réception par commande et produit)
```
Lectures seules sur `Center`, `User`, `Service`, `Booking`. Aucun modèle d'un autre module n'est modifié.

## 5. D6 — Cohérence des mouvements, interruption et reprise

### 5.1 Problème de la version précédente (reconnu)
Le schéma précédent faisait : (1) insérer un mouvement « en attente », (2) débiter le niveau, (3) régler le mouvement. L'index unique évitait les doublons de **mouvements**, mais après une interruption on ne pouvait pas savoir si l'étape 2 avait eu lieu :
- reprendre l'étape 2 = **risque de double débit** ;
- ne pas la reprendre = **perte silencieuse** du débit.
Ce mécanisme est donc **abandonné**.

### 5.2 Option 1 — Transactions MongoDB
Principe : insertion du mouvement et mise à jour du niveau dans une transaction ; en cas d'interruption, tout est annulé ; une reprise est sûre grâce à l'index unique d'idempotence.
- **Pour** : atomicité fournie par la base ; raisonnement simple ; s'étend naturellement aux réceptions de commandes (F5.5) et transferts (F5.6).
- **Contre / faits vérifiés dans le dépôt** :
  - Aucune transaction n'est utilisée ailleurs dans le code (aucun `startSession` ni `withTransaction`).
  - `npm run db:local` (`scripts/local-db.ts`) lance un `MongoMemoryServer` **autonome** : les transactions y sont impossibles. Les adopter oblige à changer cet outil de développement partagé (hors périmètre du Module 5, accord nécessaire).
  - Les tests actuels (`lib/booking/test-support.ts`) utilisent aussi un serveur autonome. Il faudrait un support de test à jeu de réplicas. `MongoMemoryReplSet` est présent dans la bibliothèque installée (vérifié par recherche dans `node_modules`), mais je **n'ai pas vérifié** qu'il démarre avec le binaire `mongod` déjà en cache, sans téléchargement.
  - Atlas (cible de production selon le README) fournit un jeu de réplicas ; non vérifié pour le palier utilisé par l'équipe.
  - Conflits d'écriture sur un produit très sollicité : relances à gérer.
  - Reste vrai avec cette option : la transaction ne couvre que le stock. Si le processus s'arrête **avant** d'appeler la consommation (après le passage du RDV à `COMPLETED`), la consommation manque. Ce cas exige de toute façon le rattrapage de §5.6.

### 5.3 Option 2 — Sans transaction : journal ordonné (recommandée, sous conditions)
Principe : **le journal est la source de vérité** ; `StockLevel.quantity` n'en est qu'une projection **affectée** (jamais incrémentée). Le point de validité d'un mouvement est **une seule insertion atomique d'un seul document**, complète (delta, solde après, manquant).

Écriture d'un mouvement (fonction unique `commitMovement`) :
1. Lire la fin du journal de (produit, centre) : `seq` et `balanceAfter` du plus grand rang (aucun mouvement : rang 0, solde 0). Lecture **sur le primaire**.
2. Calculer : `OUT` ou `ADJUSTMENT` négatif supérieur au solde = **refus** (jamais plafonné en silence). `CONSUMPTION` : `appliqué = min(demandé, solde)`, `manquant = demandé - appliqué` ; `delta = -appliqué` ; `balanceAfter = solde + delta`.
3. **Insérer** le mouvement avec `seq = rang précédent + 1`. C'est le **point de validation**.
   - Clé dupliquée sur `{productId, centerId, seq}` : un autre écrivain a gagné → recommencer en 1 (nombre de relances borné, puis erreur explicite).
   - Clé dupliquée sur `{bookingId, productId}` (consommation) : déjà consommé → ne rien écrire, charger le mouvement existant et passer à l'étape 4. (Les deux erreurs de clé dupliquée se distinguent par l'index en cause ; à tester explicitement.)
4. **Projeter** (fonction séparée `projectLevel`) :
   `StockLevel.updateOne({productId, centerId, seq: {$lt: m.seq}}, {$set: {quantity: m.balanceAfter, seq: m.seq}})`.
   Idempotent (réappliquer donne le même résultat) et monotone (une projection en retard ne peut pas écraser une plus récente).

Le niveau est calculé par **affectation** à partir du journal : il n'existe aucun « débit » qu'on pourrait appliquer deux fois.

### 5.4 Comportement en cas d'interruption, étape par étape (Option 2)
| Interruption | État laissé | Reprise | Double débit ? | Perte silencieuse ? |
|---|---|---|---|---|
| Avant l'étape 3 (rien d'écrit) | journal et niveau inchangés | relancer la consommation du RDV (ou rattrapage §5.6) : refait 1 à 4 | non | **non pour le stock** ; si la consommation n'est jamais relancée, voir §5.6 |
| Pendant l'étape 3 | l'insertion d'un document est atomique : mouvement entièrement présent ou absent | selon le cas ci-dessus ou ci-dessous | non | non |
| Entre 3 et 4 | mouvement validé ; `StockLevel.quantity`/`seq` en retard | relancer l'opération : clé dupliquée → on retrouve le mouvement → `projectLevel` ; ou le prochain écrivain lit la fin du journal (vérité) et projette son propre rang | **non** : la projection est une affectation | non : le retard est détectable (`StockLevel.seq < dernier seq du journal`) et réparable |
| Après l'étape 4 | tout est cohérent | rien | non | non |
| Deux appels simultanés sur le même RDV | un seul passe l'index d'idempotence | le second charge le mouvement existant | non | non |
| Deux consommations simultanées d'un même niveau | l'un obtient le rang n, l'autre échoue et recalcule au rang n+1 sur le solde réel | automatique (relance) | non | non |

**Vérifiable** par une fonction de contrôle `verifyLedger(produit, centre)` (lecture seule) qui doit établir :
- I1 : rangs 1..n contigus, sans trou ni doublon ;
- I2 : `balanceAfter(k) = balanceAfter(k-1) + delta(k)` et `balanceAfter(k) >= 0` ;
- I3 : `StockLevel.quantity = balanceAfter(dernier)` quand `StockLevel.seq` = dernier rang (sinon : retard signalé, pas une erreur de données) ;
- I4 : pour toute consommation, `requested = -delta + shortfall` ;
- I5 : au plus une consommation par (RDV, produit).

### 5.5 Activation d'un produit dans un centre et stock initial (D11)
Acteurs : OWNER, ou MANAGER dans un centre autorisé, pour un produit **existant et actif** de l'organisation. L'unité est celle de la définition globale ; elle n'est ni saisie ni modifiable à l'activation.
1. Création du niveau avec `quantity: 0`, `seq: 0`, `alertThreshold` saisi (création idempotente grâce à l'index unique `{productId, centerId}`).
2. Si un stock initial > 0 est saisi : mouvement `OPENING` **inséré au rang fixe `seq = 1`** (et non « fin du journal + 1 »), `note` « Stock initial » posée par le serveur, puis `projectLevel`.
   - Clé dupliquée sur `{productId, centerId, seq}` au rang 1 : le stock initial a déjà été enregistré → ne rien ajouter. Une relance de l'activation ne peut donc **jamais** compter deux fois le stock initial.
   - Si un autre mouvement existe déjà (niveau déjà utilisé), l'activation ne crée rien et l'utilisateur passe par un mouvement manuel.
3. Aucune quantité n'est écrite hors journal. Une interruption entre 1 et 2 laisse un niveau à 0 ; la relance de l'activation le complète sans risque de doublon.
Un MANAGER ne peut activer que dans ses centres ; il ne peut ni créer ni modifier la définition du produit.

### 5.6 Consommation manquante (appel jamais effectué) — rattrapage (D9)
Aucun des deux mécanismes ne détecte, de lui-même, un RDV passé à `COMPLETED` dont la consommation n'a jamais été demandée (arrêt du processus entre la mise à jour du RDV du Module 3/6 et l'appel au stock). Règles décidées :
- **Éligibilité** : RDV au statut `COMPLETED`, dont la fin (`end`) est **postérieure à la création de la recette applicable** (`ServiceRecipe.createdAt`), et pour lequel il n'existe pas de mouvement `CONSUMPTION` (RDV, produit). `NO_SHOW`, annulés, en attente, confirmés non terminés : jamais rattrapés. Aucune limite en jours.
- **Application** par la **même fonction idempotente** que la consommation immédiate (`commitMovement`) : l'index unique `{bookingId, productId}` empêche tout doublon, relancer le rattrapage ne change rien.
- **Déclenchement** : action manuelle « Régulariser » (OWNER, MANAGER dans ses centres uniquement). **Pas de cron** pour le MVP.
- Si le niveau est insuffisant, le rattrapage enregistre le manquant comme une consommation normale (jamais de stock négatif).
- Précision : un RDV passé à `COMPLETED` puis ramené à `CONFIRMED` n'est pas annulé côté stock (pas de restitution automatique) ; un RDV redevenu `COMPLETED` retrouve son mouvement existant et ne consomme pas une seconde fois.
- Limite connue : la requête n'a pas de date de clôture du RDV (`Booking` n'a pas de `completedAt`), d'où le critère sur `end` et `ServiceRecipe.createdAt`.

### 5.6 bis Détection et réparation de la projection (D10)
La projection `StockLevel` est réparée **à partir du journal uniquement, sans jamais créer de mouvement**.
- **À l'ouverture de la page de stock** : pour les niveaux affichés seulement (borné), une lecture du rang et du solde de fin de journal est comparée à `StockLevel.seq`. Si le niveau est en retard :
  - l'affichage utilise immédiatement le solde du journal (vérité), sans attendre la réparation ;
  - la réparation (`projectLevel`) est déclenchée sans bloquer le rendu. Le mécanisme d'exécution après la réponse est **à vérifier dans la documentation Next.js installée** avant l'étape concernée ; à défaut, réparation synchrone bornée.
- **Réparations concurrentes** : inoffensives par construction. `projectLevel` est une affectation gardée par `seq: {$lt: ...}` : deux réparations simultanées convergent vers la même valeur, une réparation en retard ne peut pas écraser une plus récente. Aucun verrou nécessaire ; une réparation inutile ne modifie rien (aucune correspondance du filtre).
- **Lors des écritures** : `commitMovement` repart de la fin du journal (vérité) et projette son propre rang, ce qui répare un retard antérieur.
- **Incohérence du journal** (trou de rang, solde incohérent, doublon : I1, I2, I4, I5 en échec) : **aucune réparation automatique**. L'incohérence est signalée aux OWNER (message sur la page), le niveau n'est pas écrasé par un journal douteux. La correction reste un mouvement explicite.
- Les réparations ne produisent pas d'événement d'audit ni de mouvement ; une erreur de réparation est journalisée sur la console serveur et n'empêche pas l'affichage.
- Pas de cron.

### 5.7 Scénarios de panne et de concurrence à tester (preuves exigées avant toute validation)
Aucun test ne sera nommé « garanti » sans exécution et sortie rapportée. Pour simuler une panne **sans point d'injection dans le code de production**, `commitMovement` (étapes 1 à 3) et `projectLevel` (étape 4) sont deux fonctions exportées séparément : un test appelle la première, saute la seconde.
1. Panne avant l'insertion : rien n'est écrit ; une relance produit exactement un mouvement.
2. Panne entre insertion et projection : niveau en retard ; `verifyLedger` le signale (I3) ; relance avec la même clé d'idempotence = aucun nouveau mouvement, niveau réparé.
3. Relance après succès complet : aucun changement (ni mouvement, ni niveau).
4. Deux appels simultanés pour le même RDV et le même produit : un seul mouvement.
5. N consommations simultanées sur un même niveau : solde final = max(0, initial − somme), I1 à I5 vérifiés.
6. Stock insuffisant : `delta` = −solde disponible, `shortfall` exact, solde final 0, jamais négatif, clôture non bloquée.
7. Niveau inexistant pour le centre du RDV : mouvement `delta = 0`, `shortfall = demandé`.
8. Projection en retard qui arrive après une plus récente : ne régresse pas (garde `seq: {$lt}`).
9. Écriture manuelle après un retard de projection : part de la fin du journal, répare le niveau.
10. `OUT` manuel supérieur au solde : refusé, aucun mouvement.
11. Même produit dans deux prestations d'un même RDV : une seule consommation agrégée.
12. `verifyLedger` détecte un trou de rang, un solde incohérent et un doublon forcés dans une base de test.
13. Rattrapage : RDV `COMPLETED` sans mouvement → un mouvement créé ; second passage → aucun. Non éligibles : `NO_SHOW`, annulé, non terminé, fin antérieure à la création de la recette.
13 bis. Activation d'un produit dans un centre (D11) : niveau créé, mouvement `IN` initial au rang 1 ; relance de l'activation = aucun doublon ; unité non modifiable par un MANAGER ; centre hors périmètre refusé.
13 ter. Réparation à l'ouverture (D10) : niveau en retard détecté, affichage basé sur le journal, `projectLevel` appelé deux fois en parallèle = même valeur, aucune création de mouvement ; journal incohérent = signalement sans réparation.
14. Étape 9 seulement : `NO_SHOW` ne consomme pas ; `COMPLETED → CONFIRMED → COMPLETED` ne reconsomme pas ; les deux chemins (calendrier, caisse) sur le même RDV ne consomment qu'une fois.

Ces tests tournent sur le serveur MongoDB autonome en mémoire déjà utilisé (support de test dédié au module, sans toucher `lib/booking/test-support.ts`).

### 5.8 Décision D6 : Option 2 conditionnelle (prototype)
**Option 2 retenue pour le prototype**, parce qu'elle fonctionne sur `db:local`, sur les tests existants et sur Atlas sans modifier d'outil partagé. **Elle n'est pas déclarée garantie** : elle l'est seulement si les tests ci-dessous sont écrits, exécutés et concluants.

**Les tests doivent démontrer** (correspondance avec §5.7) :
| Garantie exigée | Tests |
|---|---|
| Attribution sûre de `seq` sous concurrence | 5, et collisions de rang (relance bornée) |
| Idempotence des consommations simultanées | 3, 4, 11 |
| Absence de régression des projections | 8, 13 ter |
| Réparation après interruption | 1, 2, 9, 13 ter |
| Cohérence journal ↔ projection | 12 (`verifyLedger`), invariants I1 à I5 après chaque scénario |
| Mouvements manuels et stocks insuffisants | 6, 7, 10, 13 bis |

**Critères d'arrêt** : s'arrêter et présenter les éléments justifiant les transactions si, après correction raisonnable, l'un de ces cas se produit :
- un invariant I1 à I5 échoue sous concurrence ou après une interruption simulée ;
- une double consommation ou un stock négatif est observé ;
- les garanties ne s'obtiennent qu'en ajoutant des points d'injection ou des verrous dans le code de production ;
- les relances de rang n'aboutissent pas de façon fiable sous charge de test modérée ;
- la reprise exige un état supplémentaire non prévu dans ce schéma.
Le passage aux transactions suppose alors un jeu de réplicas pour les tests et pour `npm run db:local` ; **`scripts/local-db.ts` n'est pas modifié sans autorisation explicite**.

**Porte de décision** : `commitMovement`, `projectLevel`, `verifyLedger` et les tests §5.7 (points 1 à 13 ter) sont réalisés et rapportés, avec leurs sorties exactes, **avant** toute intégration aux Modules 3 et 6 (point 14, étape 9).

## 6. Entités F5.4 à F5.6 : état réel

- **`MaintenanceRecord`** (F5.4, implémenté) : `organizationId`, `centerId`, `equipmentId`, `performedAt` (jour, heure de Tunis, jamais dans le futur), `note` (≤ 200), `nextDueAt` (facultatif, ≥ `performedAt`), `createdBy`. Tous les champs sont immuables ; aucun service de modification ni de suppression. Index `{equipmentId, performedAt: -1}`. L'intervention la plus récente fixe `Equipment.nextMaintenanceAt` (absente = échéance retirée) ; une intervention plus ancienne saisie après coup n'y touche pas. Les échéances (en retard, aujourd'hui, planifiée) sont calculées à la lecture : ni rappel de fond ni cron.
- **`Supplier`** (F5.5, implémenté) : `organizationId`, `name` (unique parmi les actifs, insensible à la casse), `phone` (8 chiffres tunisiens, normalisé), `email` (minuscules), `leadTimeDays` (0 à 365), `active`. Écriture : OWNER ; lecture : OWNER et MANAGER. `StockProduct.supplierId` n'existe pas (non nécessaire à ce stade).
- **`PurchaseOrder`** (F5.5, implémenté) : `organizationId`, `centerId`, `supplierId`, `supplierName` (copie), `status`, `lines[{productId, productName, unit, quantity}]` (1 à 50 lignes, un produit une seule fois, nom et unité recopiés depuis la base), `orderedAt`, `cancelledAt`, `receiptStartedAt`, `receivedAt`, `createdBy`. Transitions : `DRAFT → ORDERED | CANCELLED`, `ORDERED → CANCELLED | RECEIVED` (la réception passe uniquement par `receivePurchaseOrder`). Créer, modifier, passer ou annuler une commande ne modifie jamais le stock. **Réception** : un mouvement `RECEIPT` par ligne via `commitReceipt` (idempotent), projection, vérification que chaque niveau a projeté, puis `RECEIVED` ; `receiptStartedAt` est posé atomiquement au début et interdit alors l'annulation, ce qui rend la reprise sûre.
- **`ServiceRecipe`** (F5.3, implémenté, configuration seule) : voir §3.4 ; gérée par OWNER (écriture et lecture) ; ne crée ni ne modifie aucun mouvement.
- **F5.6** (transferts entre centres) : **non fait**. Prévu : `TRANSFER_OUT` puis `TRANSFER_IN` reliés par un identifiant de transfert (clé d'idempotence par transfert et sens).
- **IA** : **non faite**. Elle lirait les mouvements `CONSUMPTION`, les niveaux et `leadTimeDays` ; toute commande suggérée resterait un brouillon validé par l'utilisateur.

## 7. Isolation et droits (D7)

| Action | OWNER | MANAGER | STAFF / CLIENT |
|---|---|---|---|
| Définitions de produits (`StockProduct`) et recettes (`ServiceRecipe`) : créer, modifier, archiver | oui | **non** | non |
| Matériel (`Equipment`) | tous les centres | ses centres | non |
| Niveaux (`StockLevel`) : activer un produit existant et actif dans un centre (seuil + stock initial tracé par un mouvement `IN`), modifier le seuil. L'unité reste celle de la définition globale | tous les centres | ses centres | non |
| Mouvements manuels, régularisation | tous les centres | ses centres | non |
| Lecture du stock et des alertes | tous les centres | ses centres | non |

- Chaque lecture et écriture filtre sur `organizationId` ; `centerId` est vérifié contre les centres autorisés (fonction pure `lib/stock/scope.ts`, même principe que `lib/team/scope.ts`).
- `productId`, `equipmentId`, `serviceId` fournis par le client sont rechargés avec `organizationId` avant usage. Un identifiant inconnu, d'une autre organisation ou hors périmètre reçoit toujours le même message.
- Droits vérifiés côté serveur dans le service et dans l'action, pas seulement dans la navigation.

## 8. Audit

Types à ajouter à `lib/enums.ts` **et** `components/dashboard/security-log.tsx`, détail sans donnée sensible : `EQUIPMENT_CREATED`, `EQUIPMENT_UPDATED`, `EQUIPMENT_ARCHIVED`, `STOCK_PRODUCT_CREATED`, `STOCK_PRODUCT_UPDATED`, `STOCK_PRODUCT_ARCHIVED`, `STOCK_LEVEL_UPDATED` (seuil, activation d'un produit dans un centre), `STOCK_MOVEMENT_RECORDED` (manuel), `STOCK_RECIPE_UPDATED`. La consommation automatique n'ajoute pas d'événement d'audit : le mouvement `CONSUMPTION` est lui-même la trace.

## 9. Limites restantes

- **D6 est démontré dans un seul processus, sur un serveur MongoDB autonome en mémoire, avec des pannes SIMULÉES** (étapes appelées séparément) : concurrence des rangs, idempotence, réparation, journal corrompu, reprise de la réception. Non observé : processus tué en plein vol, plusieurs instances, jeu de réplicas / Atlas. Le mécanisme est retenu pour le prototype, sans garantie plus large.
- Le niveau (`StockLevel`) peut être **temporairement en retard** sur le journal après une interruption jusqu'à l'ouverture de la page (réparation, D10) ou à la prochaine écriture. Les alertes calculées ailleurs que sur la page de stock (par exemple un bandeau du tableau de bord, si on en ajoute un) liraient la projection et pourraient être en retard.
- Un journal incohérent n'est jamais corrigé automatiquement (§5.6 bis) : il est signalé.
- Lectures du journal à faire **sur le primaire** (jamais sur un secondaire en retard).
- Un code qui écrirait directement `StockLevel.quantity` contournerait le journal : interdit par convention, imposé par le service (aucune action n'expose ce champ) ; Mongoose ne peut pas l'empêcher.
- Un produit très sollicité peut déclencher des relances (nombre borné) ; au-delà, erreur explicite.
- Sans cron, le rattrapage est **manuel** (« Régulariser ») : une consommation manquée reste non appliquée tant que personne ne l'a lancé, et la page doit rendre ce manque visible (nombre de RDV à régulariser) pour qu'il ne soit pas silencieux.
- `Booking` n'a pas de date de clôture : la règle D9 repose sur `end` et `ServiceRecipe.createdAt` ; un RDV terminé tardivement mais dont la fin précède la recette n'est jamais consommé par le rattrapage.
- Le mécanisme d'exécution de la réparation après réponse (D10) dépend de la version de Next.js installée : à lire dans `node_modules/next/dist/docs/` avant l'étape concernée.
- La recette est lue au moment de la consommation (non « figée » sur le RDV) ; elle ignore les options choisies ; une recette modifiée plus tard ne change pas les mouvements passés.
- Les transferts et réceptions (étapes ultérieures) reposent sur le même principe d'idempotence par opération ; leur reprise sera à démontrer au même niveau de preuve.

## 10. Points restants

D6 à D11 sont décidées (§0) et implémentées. Écarts connus entre ce document et l'interface livrée :

- **Consommation automatique** lors du passage d'un rendez-vous à `COMPLETED` : non implémentée (touche les Modules 3 et 6, accord distinct requis). Les recettes sont configurables mais sans effet. Le **rattrapage** (D9) et le compte de rendez-vous à régulariser n'existent donc pas ; la page de stock ne l'affiche pas.
- **Historique des mouvements** : lecteur paginé par rang (`listStockMovementsAction`) et lecteur des mouvements récents (vue d'ensemble) ajoutés ; aucune édition ni suppression d'un mouvement n'est proposée.
