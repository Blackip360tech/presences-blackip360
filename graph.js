// BlackIP360 Présences — Microsoft Graph API
class GraphAPI {
  constructor() {
    this._siteId = null;
    this._listId = null;
  }

  // ── Requête générique authentifiée ────────────────────────────────────────
  async _call(path, options = {}) {
    const token = await Auth.getToken();
    const res   = await fetch(CONFIG.GRAPH_BASE + path, {
      ...options,
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer':       'HonorNonIndexedQueriesWarningMayFailRandomly',
        ...options.headers,
      },
    });

    if (res.status === 204) return null;

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data;
  }

  // ── Identifiants SharePoint (mis en cache) ────────────────────────────────
  async _siteIdCached() {
    if (this._siteId) return this._siteId;
    const d = await this._call(
      `/sites/${CONFIG.SHAREPOINT_HOST}:${CONFIG.SHAREPOINT_SITE_PATH}`
    );
    this._siteId = d.id;
    return d.id;
  }

  async _listIdForName(listName) {
    this._listCache = this._listCache || {};
    if (this._listCache[listName]) return this._listCache[listName];
    const sid = await this._siteIdCached();
    const d   = await this._call(`/sites/${sid}/lists/${listName}`);
    this._listCache[listName] = d.id;
    return d.id;
  }

  async _listIdCached() {
    return this._listIdForName(CONFIG.SHAREPOINT_LIST);
  }

  // ── Profil de l'utilisateur connecté ─────────────────────────────────────
  async getProfile() {
    return this._call('/me?$select=displayName,mail,jobTitle,department');
  }

  // ── Toutes les présences (500 max, triées par heure desc) ─────────────────
  async getAllPresences() {
    const sid = await this._siteIdCached();
    const lid = await this._listIdCached();
    const url = `/sites/${sid}/lists/${lid}/items`
      + `?$expand=fields`
      + `&$orderby=fields/HeurePointage desc`
      + `&$top=500`;
    const d = await this._call(url);
    return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
  }

  // ── Présences d'un employé spécifique ─────────────────────────────────────
  async getMyPresences(email) {
    const sid    = await this._siteIdCached();
    const lid    = await this._listIdCached();
    const filter = encodeURIComponent(`fields/EmployeEmail eq '${email}'`);
    const url    = `/sites/${sid}/lists/${lid}/items`
      + `?$filter=${filter}`
      + `&$expand=fields`
      + `&$orderby=fields/HeurePointage desc`
      + `&$top=100`;
    const d = await this._call(url);
    return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
  }

  // ── Statut actuel de chaque employé (entrée la plus récente par email) ────
  async getCurrentStatuses() {
    const all = await this.getAllPresences();
    const map = {};
    for (const p of all) {
      const key = p.EmployeEmail;
      if (!map[key] || new Date(p.HeurePointage) > new Date(map[key].HeurePointage)) {
        map[key] = p;
      }
    }
    return Object.values(map);
  }

  // ── Créer un pointage ─────────────────────────────────────────────────────
  async pointage({ nom, email, departement, statut, notes }) {
    const sid  = await this._siteIdCached();
    const lid  = await this._listIdCached();
    return this._call(`/sites/${sid}/lists/${lid}/items`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          EmployeNom:    nom,
          EmployeEmail:  email,
          Departement:   departement,
          StatutActuel:  statut,
          HeurePointage: new Date().toISOString(),
          Notes:         notes || '',
        },
      }),
    });
  }

  // ── SOLDES DE CONGÉS ──────────────────────────────────────────────────────
  async getSolde(email) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_SOLDES);
    const filter = encodeURIComponent(`fields/EmployeEmail eq '${email}'`);
    const d = await this._call(`/sites/${sid}/lists/${lid}/items?$filter=${filter}&$expand=fields&$top=1`);
    const item = d.value?.[0];
    if (!item) return { vacances: 0, maladie: 0, departement: '', email, canAdmin: false, canTV: false, canPaye: false, canAcces: false, canApprouver: false };
    return {
      id:           item.id,
      email:        item.fields.EmployeEmail,
      nom:          item.fields.EmployeNom,
      departement:  item.fields.Departement || '',
      vacances:     Number(item.fields.SoldeVacancesHeures) || 0,
      maladie:      Number(item.fields.SoldeMaladieHeures)  || 0,
      canAdmin:     !!item.fields.CanAdmin,
      canTV:        !!item.fields.CanTV,
      canPaye:      !!item.fields.CanPaye,
      canAcces:     !!item.fields.CanAcces,
      canApprouver: !!item.fields.CanApprouver,
    };
  }

  async getAllSoldes() {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_SOLDES);
    const d = await this._call(`/sites/${sid}/lists/${lid}/items?$expand=fields&$top=500`);
    return (d.value || []).map(i => ({
      id:           i.id,
      email:        i.fields.EmployeEmail,
      nom:          i.fields.EmployeNom,
      departement:  i.fields.Departement || '',
      vacances:     Number(i.fields.SoldeVacancesHeures) || 0,
      maladie:      Number(i.fields.SoldeMaladieHeures)  || 0,
      canAdmin:     !!i.fields.CanAdmin,
      canTV:        !!i.fields.CanTV,
      canPaye:      !!i.fields.CanPaye,
      canAcces:     !!i.fields.CanAcces,
      canApprouver: !!i.fields.CanApprouver,
    }));
  }

  async upsertSolde({ email, nom, departement, vacances, maladie, canAdmin, canTV, canPaye, canAcces, canApprouver }) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_SOLDES);
    const existing = await this.getSolde(email);
    const fields = {
      EmployeEmail:         email,
      EmployeNom:           nom || '',
      Departement:          departement || '',
      SoldeVacancesHeures:  Number(vacances) || 0,
      SoldeMaladieHeures:   Number(maladie)  || 0,
      CanAdmin:             !!canAdmin,
      CanTV:                !!canTV,
      CanPaye:              !!canPaye,
      CanAcces:             !!canAcces,
      CanApprouver:         !!canApprouver,
    };
    if (existing.id) {
      return this._call(`/sites/${sid}/lists/${lid}/items/${existing.id}/fields`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
    }
    return this._call(`/sites/${sid}/lists/${lid}/items`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  }

  // ── DEMANDES DE CONGÉ ─────────────────────────────────────────────────────
  async createDemande({ email, nom, type, dateDebut, dateFin, heures, motif }) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
    return this._call(`/sites/${sid}/lists/${lid}/items`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          EmployeEmail:  email,
          EmployeNom:    nom,
          TypeConge:     type,
          DateDebut:     new Date(dateDebut).toISOString(),
          DateFin:       new Date(dateFin).toISOString(),
          NombreHeures:  Number(heures) || 0,
          Motif:         motif || '',
          Statut:        'En attente',
        },
      }),
    });
  }

  async getMesDemandes(email) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
    const filter = encodeURIComponent(`fields/EmployeEmail eq '${email}'`);
    const d = await this._call(`/sites/${sid}/lists/${lid}/items?$filter=${filter}&$expand=fields&$orderby=fields/DateDebut desc&$top=200`);
    return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
  }

  async getAllDemandes() {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
    const d = await this._call(`/sites/${sid}/lists/${lid}/items?$expand=fields&$orderby=fields/DateDebut desc&$top=500`);
    return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
  }

  async updateDemandeStatut(id, { statut, approbateur, notes }) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
    return this._call(`/sites/${sid}/lists/${lid}/items/${id}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({
        Statut:           statut,
        DateDecision:     new Date().toISOString(),
        Approbateur:      approbateur || '',
        NotesApprobateur: notes || '',
      }),
    });
  }
}

const Graph = new GraphAPI();
