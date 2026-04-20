// BlackIP360 Présences — Configuration auto DEV/PROD
// Le suffixe _Dev est ajouté automatiquement aux listes SharePoint si on est sur l'env DEV.

const IS_DEV = typeof window !== 'undefined' && (
  window.location.hostname.includes('-dev') ||
  window.location.pathname.includes('-dev') ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);
const SP_SUFFIX = IS_DEV ? '_Dev' : '';

const CONFIG = {

  // ── Environnement ─────────────────────────────────────────────────────────
  ENV:     IS_DEV ? 'dev' : 'prod',
  IS_DEV:  IS_DEV,

  // ── Azure AD ──────────────────────────────────────────────────────────────
  CLIENT_ID: 'bfd6cf51-c194-4541-aa4d-2f9328b1c88a',  // BIP360-Presences_Employes
  TENANT_ID: '3f3b2d7b-6be5-45ab-bb9b-05c1a7e11c38',  // Les Solutions Blackip360 Inc.

  // ── Hébergement ───────────────────────────────────────────────────────────
  APP_URL: IS_DEV
    ? 'https://blackip360tech.github.io/presences-blackip360-dev'
    : 'https://blackip360tech.github.io/presences-blackip360',

  // ── SharePoint ────────────────────────────────────────────────────────────
  SHAREPOINT_HOST:      'blackip360.sharepoint.com',
  SHAREPOINT_SITE_PATH: '/sites/PlanificationTI',
  SHAREPOINT_LIST:          'Presences_Employes' + SP_SUFFIX,
  SHAREPOINT_LIST_SOLDES:   'Soldes_Conges'      + SP_SUFFIX,
  SHAREPOINT_LIST_DEMANDES: 'Demandes_Conges'    + SP_SUFFIX,

  // ── Graph API ─────────────────────────────────────────────────────────────
  GRAPH_BASE: 'https://graph.microsoft.com/v1.0',
  SCOPES: ['User.Read', 'Sites.ReadWrite.All', 'Presence.Read'],

  // Mapping Teams → libellé + icône
  TEAMS_PRESENCE: {
    Available:              { label: 'Disponible',       icon: '🟢', color: '#2ea043' },
    Busy:                   { label: 'Occupé',           icon: '🔴', color: '#f85149' },
    DoNotDisturb:           { label: 'Ne pas déranger',  icon: '⛔', color: '#f85149' },
    InACall:                { label: 'En appel',         icon: '📞', color: '#c084fc' },
    InAConferenceCall:      { label: 'En conférence',    icon: '🎙️', color: '#c084fc' },
    InAMeeting:             { label: 'En réunion',       icon: '📅', color: '#c084fc' },
    Away:                   { label: 'Absent',           icon: '🌙', color: '#d29922' },
    BeRightBack:            { label: 'Revient',          icon: '↩️', color: '#d29922' },
    Offline:                { label: 'Hors ligne',       icon: '⚫', color: '#7d8590' },
    PresenceUnknown:        { label: 'Inconnu',          icon: '❓', color: '#7d8590' },
    Presenting:             { label: 'En présentation',  icon: '🎬', color: '#c084fc' },
    UrgentInterruptionsOnly:{ label: 'Urgences seulement',icon: '🚨', color: '#f85149' },
    OffWork:                { label: 'Hors travail',     icon: '🏠', color: '#7d8590' },
    OutOfOffice:            { label: 'Hors du bureau',   icon: '✈️', color: '#7d8590' },
  },

  // Types de congé
  TYPES_CONGE: [
    { id: 'vacances',   label: 'Vacances',   icon: '🌴', color: '#293af2' },
    { id: 'sans_solde', label: 'Sans solde', icon: '📋', color: '#7d8590' },
    { id: 'maladie',    label: 'Maladie',    icon: '🤒', color: '#f85149' },
  ],

  // ── Teams ─────────────────────────────────────────────────────────────────
  TEAMS_ID: '667ef628-228c-4459-93fa-73fce99a58f7',

  // ── UI ────────────────────────────────────────────────────────────────────
  TV_REFRESH_MS: 30000,

  DEPARTEMENTS: [
    'Tous',
    'Administration',
    'Support BIP360',
    'Support CV247',
    'Comptabilité',
  ],

  // 11 statuts personnalisés BlackIP360
  STATUTS: [
    { id: 'bureau',      label: 'Je suis là au bureau',                      icon: '🏢', color: '#198754', category: 'present' },
    { id: 'teletravail', label: 'Je suis là en télétravail',                 icon: '🏠', color: '#0dcaf0', category: 'present' },
    { id: 'route_bip',   label: 'Client BlackIP360 - Je suis sur la route',  icon: '🚗', color: '#fd7e14', category: 'present' },
    { id: 'route_cv247', label: 'Client CV247/EMG - Je suis sur la route',   icon: '🛣️', color: '#d63384', category: 'present' },
    { id: 'formation',   label: 'En formation',                              icon: '📚', color: '#6f42c1', category: 'present' },
    { id: 'quart_fini',  label: 'Quart de travail terminé',                  icon: '✅', color: '#6c757d', category: 'absent'  },
    { id: 'rdv_perso',   label: 'Parti pour un rendez-vous personnel',       icon: '📅', color: '#20c997', category: 'absent'  },
    { id: 'pause',       label: 'Parti en pause',                            icon: '☕', color: '#795548', category: 'absent'  },
    { id: 'diner',       label: 'Parti en dîner',                            icon: '🍽️', color: '#ff9800', category: 'absent'  },
    { id: 'vacances',    label: 'Parti en vacance',                          icon: '🌞', color: '#fbbf24', category: 'absent'  },
    { id: 'malade',      label: 'Je suis Malade',                            icon: '🤒', color: '#dc3545', category: 'absent'  },
  ],
};
