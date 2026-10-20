// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button answers, errors).
// Errors thrown to Gladys are English (one language per message, like the
// core's); the statuses and button answers are { en, fr }. No text ever holds
// the user name or the password.
// -----------------------------------------------------------------------------

import { CODES } from './lhm/errors.js';

const plural = (n, one, many) => (n === 1 ? one : many);
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/** Why Libre Hardware Monitor failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.TLS_UNTRUSTED:
      return { en: 'certificate not trusted', fr: 'certificat non reconnu' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const RETRY = (delay) => ({
  en: `Retried in ${minutes(delay)} min.`,
  fr: `Nouvel essai dans ${minutes(delay)} min.`,
});

const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ computer, version, hardware, sensors }) => ({
      en: `Libre Hardware Monitor${version ? ` ${version}` : ''} answers: ${computer}, ${hardware} ${plural(hardware, 'piece', 'pieces')} of hardware, ${sensors} ${plural(sensors, 'sensor', 'sensors')}.`,
      fr: `Libre Hardware Monitor${version ? ` ${version}` : ''} répond : ${computer}, ${hardware} ${plural(hardware, 'matériel', 'matériels')}, ${sensors} ${plural(sensors, 'capteur', 'capteurs')}.`,
    }),
    noSensor: ({ computer }) => ({
      en: `Libre Hardware Monitor answers (${computer}), but shows no sensor: run it as administrator, and check the hardware ticked in its Options menu.`,
      fr: `Libre Hardware Monitor répond (${computer}), mais ne montre aucun capteur : lancez-le en administrateur, et vérifiez le matériel coché dans son menu Options.`,
    }),
    urlEmpty: {
      en: 'Type the address of the PC running Libre Hardware Monitor (e.g. 192.168.1.20:8085).',
      fr: 'Saisissez l’adresse du PC où tourne Libre Hardware Monitor (ex. 192.168.1.20:8085).',
    },
    urlInvalid: {
      en: 'The address is not valid: type host:port (e.g. 192.168.1.20:8085) or http://host:port, without a query.',
      fr: 'L’adresse n’est pas valide : saisissez hôte:port (ex. 192.168.1.20:8085) ou http://hôte:port, sans paramètres.',
    },
    urlCredentials: {
      en: 'Remove the user name and password from the address: type them in their own fields.',
      fr: 'Retirez l’identifiant et le mot de passe de l’adresse : saisissez-les dans leurs propres champs.',
    },
    credentialsIncomplete: {
      en: 'Type both the user name and the password of the web server of Libre Hardware Monitor, or leave both empty when it asks for none.',
      fr: 'Saisissez à la fois l’identifiant et le mot de passe du serveur web de Libre Hardware Monitor, ou laissez les deux vides s’il n’en demande pas.',
    },
    credentialsInvalid: {
      en: 'The user name may not hold a colon, and neither field a control character: type them again.',
      fr: 'L’identifiant ne peut pas contenir de deux-points, ni aucun champ de caractère de contrôle : saisissez-les de nouveau.',
    },
    authRequired: {
      en: 'Libre Hardware Monitor asks for a user name and a password (HTTP 401): type those of its web server (Options, Remote Web Server, Authentication) and save. Gladys does not try again by itself.',
      fr: 'Libre Hardware Monitor demande un identifiant et un mot de passe (HTTP 401) : saisissez ceux de son serveur web (Options, Remote Web Server, Authentication) et enregistrez. Gladys ne réessaie pas seul.',
    },
    authRefused: {
      en: 'Libre Hardware Monitor refused the user name or the password (HTTP 401). Gladys does not try again by itself: type them again and save, or press "Test the connection".',
      fr: 'Libre Hardware Monitor a refusé l’identifiant ou le mot de passe (HTTP 401). Gladys ne réessaie pas seul : saisissez-les de nouveau et enregistrez, ou appuyez sur « Tester la connexion ».',
    },
    forbidden: (delay) =>
      join(
        {
          en: 'The address refuses the reading (HTTP 403): check the reverse proxy in front of Libre Hardware Monitor, if any.',
          fr: 'L’adresse refuse la lecture (HTTP 403) : vérifiez le proxy inverse devant Libre Hardware Monitor, s’il y en a un.',
        },
        RETRY(delay),
      ),
    tlsUntrusted: (delay) =>
      join(
        {
          en: 'The certificate of this https address is not trusted: use the http address of Libre Hardware Monitor on your network, or a certificate from a known authority on the reverse proxy.',
          fr: 'Le certificat de cette adresse https n’est pas reconnu : utilisez l’adresse http de Libre Hardware Monitor sur votre réseau, ou un certificat d’une autorité reconnue sur le proxy inverse.',
        },
        RETRY(delay),
      ),
    notLhm: (delay) =>
      join(
        {
          en: 'This address does not answer like the web server of Libre Hardware Monitor (/data.json): check the port (8085 by default) and that the web server is started (Options, Remote Web Server, Run).',
          fr: 'Cette adresse ne répond pas comme le serveur web de Libre Hardware Monitor (/data.json) : vérifiez le port (8085 par défaut) et que le serveur web est lancé (Options, Remote Web Server, Run).',
        },
        RETRY(delay),
      ),
    busy: (delay) =>
      join(
        {
          en: 'The address asks Gladys to slow down (HTTP 429): every reading is paused.',
          fr: 'L’adresse demande à Gladys de ralentir (HTTP 429) : toutes les lectures sont suspendues.',
        },
        RETRY(delay),
      ),
    serverError: (status, delay) =>
      join(
        {
          en: `The address answers with a server error (HTTP ${status}).`,
          fr: `L’adresse répond par une erreur serveur (HTTP ${status}).`,
        },
        RETRY(delay),
      ),
    unreachable: (err, delay) =>
      join(
        {
          en: 'Libre Hardware Monitor does not answer (is the PC on, Libre Hardware Monitor running with its web server started, port open in the firewall?):',
          fr: 'Libre Hardware Monitor ne répond pas (le PC est-il allumé, Libre Hardware Monitor lancé avec son serveur web démarré, le port ouvert dans le pare-feu ?) :',
        },
        reasonOf(err),
        { en: '—', fr: '—' },
        RETRY(delay),
      ),
  },
  test: {
    ok: ({ computer, hardware, sensors }) => ({
      en: `Connected: ${computer}, ${hardware} ${plural(hardware, 'piece', 'pieces')} of hardware, ${sensors} ${plural(sensors, 'sensor', 'sensors')}.`,
      fr: `Connecté : ${computer}, ${hardware} ${plural(hardware, 'matériel', 'matériels')}, ${sensors} ${plural(sensors, 'capteur', 'capteurs')}.`,
    }),
  },
  errors: {
    notConnected:
      'Libre Hardware Monitor is not connected: see the configuration of the integration',
    testTooLong:
      'Libre Hardware Monitor has not answered yet: see the connection status in a moment (nothing else to do)',
  },
};
