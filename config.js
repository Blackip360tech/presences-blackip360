// BlackIP360 Présences — Configuration DEV

const CONFIG = {

  // ── Azure AD ──────────────────────────────────────────────────────────────
  CLIENT_ID: 'bfd6cf51-c194-4541-aa4d-2f9328b1c88a',  // BIP360-Presences_Employes
  TENANT_ID: '3f3b2d7b-6be5-45ab-bb9b-05c1a7e11c38',  // Les Solutions Blackip360 Inc.

  // ── Hébergement ───────────────────────────────────────────────────────────
  APP_URL: 'https://blackip360tech.github.io/presences-blackip360-dev',

  // ── SharePoint ────────────────────────────────────────────────────────────
  SHAREPOINT_HOST:      'blackip360.sharepoint.com',
  SHAREPOINT_SITE_PATH: '/sites/PlanificationTI',
  SHAREPOINT_LIST:      'Presences_Employes',

  // ── Graph API ─────────────────────────────────────────────────────────────
  GRAPH_BASE: 'https://graph.microsoft.com/v1.0',
  SCOPES: ['User.Read', 'Sites.ReadWrite.All'],

  SHAREPOINT_LIST_SOLDES:    'Soldes_Conges',
  SHAREPOINT_LIST_DEMANDES:  'Demandes_Conges',

  // Types de congé
  TYPES_CONGE: [
    { id: 'vacances',   label: 'Vacances',   icon: '🌴', color: '#fdd13a' },
    { id: 'sans_solde', label: 'Sans solde', icon: '📋', color: '#7d8590' },
    { id: 'maladie',    label: 'Maladie',    icon: '🤒', color: '#f85149' },
  ],

  // ── Teams ─────────────────────────────────────────────────────────────────
  TEAMS_ID: '667ef628-228c-4459-93fa-73fce99a58f7',

  // ── UI ────────────────────────────────────────────────────────────────────
  TV_REFRESH_MS: 30000,

  DEPARTEMENTS: [
    'Tous',
    'Direction',
    'Développement',
    'Infrastructure',
    'Support',
    'Administration',
  ],

  // 11 statuts personnalisés BlackIP360
  STATUTS: [
    { id: 'bureau',      label: 'Je suis là au bureau',                      icon: '🏢', color: '#198754', category: 'present' },
    { id: 'teletravail', label: 'Je suis là en télétravail',                 icon: '🏠', color: '#0dcaf0', category: 'present' },
    { id: 'route_bip',   label: 'Client BlackIP360 - Je suis sur la route',  icon: '🚗', color: '#fd7e14', category: 'present' },
    { id: 'route_cv247', label: 'Client CV247/EMG - Je suis sur la route',   icon: '🛣️', color: '#d63384', category: 'present' },
    { id: 'formation',   label: 'En formation 👩🏻‍💻🎧👨🏻‍🎓',                  icon: '📚', color: '#6f42c1', category: 'present' },
    { id: 'quart_fini',  label: 'Quart de travail terminé',                  icon: '✅', color: '#6c757d', category: 'absent'  },
    { id: 'rdv_perso',   label: 'Parti pour un rendez-vous personnel',       icon: '📅', color: '#20c997', category: 'absent'  },
    { id: 'pause',       label: 'Parti en pause ☕',                         icon: '☕', color: '#795548', category: 'absent'  },
    { id: 'diner',       label: 'Parti en dîner 🍽️',                        icon: '🍽️', color: '#ff9800', category: 'absent'  },
    { id: 'vacances',    label: 'Parti en vacance 🌞🍺🍹😎',                icon: '🌞', color: '#ffc107', category: 'absent'  },
    { id: 'malade',      label: 'Je suis Malade 🤒🤧😷',                    icon: '🤒', color: '#dc3545', category: 'absent'  },
  ],
};
