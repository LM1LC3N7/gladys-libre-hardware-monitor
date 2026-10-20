# Libre Hardware Monitor

Suivez les capteurs d'un PC Windows dans Gladys : températures du CPU et du
GPU, charges, vitesses des ventilateurs, puissance, et, si vous le souhaitez,
fréquences, tensions, mémoire, disques et débits réseau. Gladys les lit par
le serveur web de
[Libre Hardware Monitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor),
un logiciel libre qui tourne sur le PC.

> **Intégration non officielle**, sans lien avec le projet Libre Hardware
> Monitor. Elle n'a **jamais été testée avec un vrai PC** pour l'instant :
> elle a été écrite d'après le format que lit la bibliothèque de référence,
> et testée sur des réponses simulées. Vos retours sont les bienvenus.

## Ce que vous obtenez

- **Un appareil par matériel** (CPU, GPU, carte mère, mémoire, chaque disque,
  chaque carte réseau...), avec une fonction en lecture seule par capteur.
- **Un appareil pour le PC**, dont la fonction « Online » vaut 1 tant que le
  PC répond et 0 quand rien ne répond (PC éteint, en veille, logiciel fermé,
  réseau coupé ; derrière un proxy inverse, ses erreurs 502, 503 et 504) :
  utilisez-la dans une scène, par exemple pour être prévenu
  quand le PC s'éteint. Une réponse en erreur (mot de passe refusé, autre
  logiciel sur le port) la laisse à 1 : le PC est allumé, seuls ses capteurs
  ne sont pas lus.
- **Lecture seule.** Gladys n'envoie rien au PC que la lecture des capteurs :
  aucune commande, aucun arrêt, rien qu'un « tout éteindre » ou un assistant
  vocal pourrait déclencher.

Unités : températures en °C, puissance en W, tensions en V, courants en A,
mémoire en Go ou Mo, débits en Ko/s, durées en secondes. Gladys n'a pas
d'unité pour une charge en %, un ventilateur en tr/min (RPM) ou une
fréquence en MHz sur ces capteurs : l'unité est alors écrite dans le nom de
la fonction (« CPU Total Load (%) »).

## Sur le PC

1. Installez Libre Hardware Monitor (0.9.7 ou plus récent conseillé ; les
   versions plus anciennes fonctionnent, avec des valeurs moins précises).
2. Lancez-le **en administrateur**, sinon la plupart des capteurs restent
   cachés.
3. Menu **Options → Remote Web Server → Run**. Le port par défaut est 8085
   (**Options → Remote Web Server → Port** pour le changer).
4. Laissez le pare-feu de Windows accepter les connexions entrantes sur ce
   port, au moins depuis la machine de Gladys.
5. Donnez au PC une adresse fixe dans votre box, pour que Gladys le trouve
   toujours.
6. Cochez **Options → Run On Windows Startup** si le PC doit être suivi après
   chaque redémarrage.

### Authentification (facultative)

Libre Hardware Monitor peut demander un identifiant et un mot de passe
(**Options → Remote Web Server → Authentication**). Si vous les avez définis,
saisissez les mêmes dans Gladys ; laissez les deux champs vides sinon.

Son serveur web parle en **http** simple : le mot de passe traverse votre
réseau en clair, lisible par tout appareil qui s'y trouve. Utilisez un mot de
passe propre à cet usage, employé nulle part ailleurs. Dans Gladys, le mot de
passe est un champ secret : gardé par Gladys dans sa base, jamais réaffiché,
envoyé seulement à Libre Hardware Monitor (authentification HTTP Basic). Il
n'est jamais écrit dans les journaux ni dans le volume `/data` de
l'intégration.

## Dans Gladys

1. Installez l'intégration depuis le store, puis ouvrez sa configuration.
2. **Adresse du PC** : `192.168.1.20:8085` (une adresse seule est lue en http
   sur le port 8085). Derrière un proxy inverse : `https://hôte/chemin` ; le
   certificat doit alors venir d'une autorité reconnue.
3. **Capteurs proposés** : « L'essentiel » (températures, charges,
   ventilateurs, puissance) ou « Tous les capteurs ». Un PC compte des
   centaines de capteurs : commencez par l'essentiel.
4. **Lecture** : toutes les 30 s, minutes (par défaut), 2 ou 5 minutes.
5. Enregistrez, puis appuyez sur **Tester la connexion** : le PC est lu
   aussitôt, son matériel et ses capteurs comptés.
6. Ouvrez l'onglet **Découverte** et créez les appareils voulus.

Changer « Capteurs proposés » ne retire jamais une fonction déjà créée : un
appareil garde toutes ses fonctions, et les nouvelles sont proposées par
« Mettre à jour ».

## Limites

- **250 valeurs par minute au plus.** Gladys accepte 300 états par minute
  d'une intégration. Seules les valeurs des appareils créés qui ont changé
  sont envoyées (arrondies : 0,1 °C, 1 %, 1 tr/min, 0,1 W...). Sur un gros PC
  lu toutes les 30 secondes, les valeurs au-delà du budget attendent la
  minute suivante, les plus anciennes d'abord : chaque valeur arrive, un peu
  plus tard.
- **Un seul PC par intégration** dans cette version.
- Un appareil propose 200 fonctions au plus ; une lecture est limitée à 64
  matériels et 5 000 capteurs, et à 8 Mo.
- Quand le PC ne répond pas, Gladys réessaie après l'intervalle de lecture,
  puis de plus en plus espacé jusqu'à toutes les 5 minutes : la fonction
  « Online » peut mettre jusqu'à 5 minutes à repasser à 1 après une longue
  coupure.
- Un mot de passe refusé (HTTP 401) arrête les lectures jusqu'à ce que vous
  enregistriez la configuration ou appuyiez sur « Tester la connexion » :
  Gladys ne réessaie jamais seul le même mot de passe.
- Un HTTP 429 (trop de requêtes) ou une erreur serveur (5xx) suspend les
  lectures au moins pendant l'intervalle de lecture (429 : 1 min à 6 h) ; la
  pause est gardée au redémarrage de l'intégration.
- Passer de Libre Hardware Monitor 0.9.4 ou plus ancien à 0.9.5 ou plus récent
  change l'identifiant de la carte mère (sa puce, `lpc-...`, devient
  `motherboard`), comme dans Home Assistant : la carte mère apparaît comme un
  nouvel appareil dans Découverte ; supprimez l'ancien une fois le nouveau créé.

## Dépannage

| État                                      | À vérifier                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ne répond pas                             | PC allumé ? Libre Hardware Monitor lancé, serveur web démarré (Options → Remote Web Server → Run) ? Port ouvert dans le pare-feu de Windows ? Bonne adresse et bon port ? |
| Ne répond pas comme le serveur web        | Le port est celui d'un autre logiciel, ou le serveur web est arrêté. Ouvrez `http://<IP>:8085/data.json` dans un navigateur : vous devez voir du JSON.                    |
| Demande un identifiant et un mot de passe | L'authentification est active dans Libre Hardware Monitor : saisissez le même identifiant et le même mot de passe dans Gladys.                                            |
| A refusé l'identifiant ou le mot de passe | Saisissez-les de nouveau, enregistrez.                                                                                                                                    |
| Aucun capteur                             | Lancez Libre Hardware Monitor en administrateur ; vérifiez le matériel coché dans son menu Options.                                                                       |

## Vie privée

L'intégration ne parle qu'à l'adresse que vous saisissez. Elle lit les noms
du matériel du PC et ceux de ses cartes réseau, qui deviennent des noms
d'appareils et de fonctions Gladys. Rien ne sort de votre réseau.
