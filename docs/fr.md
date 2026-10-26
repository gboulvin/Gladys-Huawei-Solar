# Huawei Solar pour Gladys Assistant

Supervisez et pilotez votre installation solaire Huawei depuis Gladys :
onduleurs **SUN2000**, batteries **LUNA2000** et compteur **DTSU666-H /
DDSU666-H** raccordé à l'onduleur.

Deux connexions sont disponibles, seules ou ensemble :

| Connexion  | Comment                                                      | Rafraîchissement          | Commandes |
| ---------- | ------------------------------------------------------------ | ------------------------- | --------- |
| **Locale** | Modbus TCP via le SDongle, un EMMA ou le Wi-Fi de l'onduleur | toutes les 30 s ou plus   | oui       |
| **Cloud**  | API Northbound de FusionSolar                                | toutes les 5 min au mieux | non       |

Avec les deux, l'interrupteur **Préférer la connexion locale** choisit la
connexion préférée ; si elle échoue, l'autre prend le relais et le badge des
appareils affiche un point orange.

Nécessite **Gladys 5.3.0** ou plus récent.

## 1. Connexion locale (recommandée)

1. Dans l'**application FusionSolar**, ouvrez la _Mise en service_ de votre
   onduleur (connexion installateur), puis _Paramètres > Configuration de la
   communication > Paramètres du Dongle > Modbus TCP_ et choisissez
   **Activer (sans restriction)**.
2. Donnez une adresse IP fixe au SDongle dans votre box.
3. Dans Gladys, renseignez :
   - **Adresse de l'onduleur / SDongle** : l'IP du SDongle, ex. `192.168.1.50` ;
   - **Port Modbus** : `502` (SDongle / EMMA), `6607` (Wi-Fi de l'onduleur) ;
   - **Unit id Modbus** : généralement `1` (SDongle), `0` (Wi-Fi de l'onduleur).
4. Cliquez sur **Tester la connexion**.

Bon à savoir :

- le SDongle n'accepte que quelques clients Modbus simultanés : si une autre
  domotique le lit déjà, gardez un intervalle de rafraîchissement de 60 s ou
  plus ;
- certaines commandes (limitation d'injection, démarrage / arrêt de
  l'onduleur) peuvent nécessiter des droits installateur selon le firmware :
  l'action de scène répond alors `success: false` avec le message de
  l'onduleur.

## 2. Connexion cloud (FusionSolar)

Le cloud utilise l'**API Northbound** de FusionSolar, qui nécessite un compte
API dédié : vos identifiants habituels de l'application **ne fonctionnent
pas**.

1. Demandez à votre installateur de créer un compte API dans FusionSolar
   (_Système > Gestion de l'entreprise > Gestion Northbound_), avec accès à
   votre centrale.
2. Dans Gladys, renseignez :
   - **Serveur FusionSolar** : l'adresse utilisée dans un navigateur, ex.
     `https://eu5.fusionsolar.huawei.com` ;
   - **Nom d'utilisateur API** et **Mot de passe API (system code)**.
3. Cliquez sur **Tester la connexion**.

Huawei limite le nombre d'appels à l'API : le cloud est lu toutes les
5 minutes au mieux, quel que soit l'intervalle de rafraîchissement.

## 3. Créer les appareils

Ouvrez l'onglet **Découverte** de l'intégration et créez les appareils trouvés :

- **Huawei SUN2000…** (onduleur) : production solaire (W), production totale
  (kWh), production du jour (kWh), puissance d'entrée PV (W), température
  interne, état ;
- **Huawei power meter** (compteur) : puissance réseau (W, positive en
  soutirage, négative en injection), puissances (W) et index (kWh) de
  soutirage / d'injection, consommation de la maison (W), tension, courant ;
- **Huawei LUNA2000 battery** (batterie) : niveau (%), puissance de charge /
  décharge (W), total chargé / déchargé (kWh, en local), énergie restante
  (kWh, en local), état, **mode de fonctionnement** (modifiable depuis Gladys
  avec la connexion locale : autoconsommation maximale, heures creuses /
  pleines, injection totale au réseau).

Les index de production et de réseau alimentent le suivi d'énergie de Gladys.

## 4. Scènes

**Déclencheurs** (catégorie _Intégrations_) :

- **L'état de l'onduleur change** : la production démarre, s'arrête,
  l'onduleur passe en défaut… Variables : `status`, `previous_status`,
  `production_power`.
- **L'échange réseau change** : la maison commence à **injecter** un surplus,
  à **soutirer** sur le réseau, ou est **équilibrée** (zone morte réglable
  dans la configuration, 100 W par défaut). Idéal pour lancer un chauffe-eau
  ou une recharge de voiture sur surplus. Variables : `flow`,
  `previous_flow`, `grid_power`.
- **Seuil de batterie franchi** : la batterie passe au-dessus ou en dessous
  d'un seuil, par pas de 10 %. Variables : `direction`, `level`,
  `battery_level`.

**Actions** (connexion locale, sauf la dernière) :

- forcer la **charge** ou la **décharge** de la batterie (puissance, durée),
  **arrêter** le forçage ;
- changer le **mode de fonctionnement** de la batterie ;
- **limiter l'injection réseau** : sans limite, injection zéro, ou limite en
  watts ;
- **démarrer ou arrêter** l'onduleur ;
- **lire l'installation solaire** : expose `production_power`,
  `daily_production`, `house_power`, `grid_power`, `battery_level`,
  `battery_power` et `inverter_status` aux actions suivantes.

Chaque commande renvoie `success` et `message` : utilisez une condition sur
`success` pour réagir à un échec.

## 5. Widgets du tableau de bord

- **Vue solaire** : production, maison, réseau et batterie en direct, courbe
  du jour, état de l'onduleur, production du jour, échange réseau et
  connexion.
- **Pilotage batterie** : niveau, puissance de charge et de décharge, mode de
  fonctionnement, et boutons pour forcer une charge ou une décharge, l'arrêter
  ou changer de mode.

## Dépannage

- _Cannot connect to …:502_ : Modbus TCP n'est pas activé sur le dongle, l'IP
  est fausse, ou le dongle est occupé par un autre client.
- _illegal data address_ : le registre n'existe pas sur votre modèle (ex. pas
  de batterie) : l'intégration l'ignore à la lecture.
- _FusionSolar login refused_ : vérifiez l'adresse du serveur, le nom
  d'utilisateur API et le system code ; un compte ordinaire ne fonctionne pas.
- _rate limit reached_ : patientez quelques minutes, et n'utilisez ce compte
  API que depuis une seule intégration.
