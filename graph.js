// BlackIP360 Présences — Microsoft Graph API
class GraphAPI {
  constructor() {
    this._siteId = null;
    this._listId = null;
    this._dataCache = {};
    this._pendingRequests = {};
    this._CACHE_TTL = 30000; // 30 secondes
  }

  // Cache avec TTL + déduplication de requêtes concurrentes
  async _cached(key, fetcher) {
    const now = Date.now();
    const entry = this._dataCache[key];
    if (entry && now < entry.expires) return entry.data;
    if (this._pendingRequests[key]) return this._pendingRequests[key];

    const promise = fetcher().then(data => {
      this._dataCache[key] = { data, expires: Date.now() + this._CACHE_TTL };
      delete this._pendingRequests[key];
      return data;
    }).catch(err => {
      delete this._pendingRequests[key];
      throw err;
    });
    this._pendingRequests[key] = promise;
    return promise;
  }

  _invalidate(pattern) {
    Object.keys(this._dataCache).forEach(k => {
      if (k.startsWith(pattern)) delete this._dataCache[k];
    });
  }

  clearCache() { this._dataCache = {}; this._pendingRequests = {}; }

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
    return this._cached('allPresences', async () => {
      const sid = await this._siteIdCached();
      const lid = await this._listIdCached();
      const url = `/sites/${sid}/lists/${lid}/items`
        + `?$expand=fields`
        + `&$orderby=fields/HeurePointage desc`
        + `&$top=500`;
      const d = await this._call(url);
      return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
    });
  }

  // ── Présences d'un employé spécifique ─────────────────────────────────────
  async getMyPresences(email) {
    return this._cached(`myPresences:${email}`, async () => {
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
    });
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
    const result = await this._call(`/sites/${sid}/lists/${lid}/items`, {
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
    this._invalidate('allPresences');
    this._invalidate('myPresences:');
    return result;
  }

  // ── SOLDES DE CONGÉS ──────────────────────────────────────────────────────
  async getSolde(email) {
    return this._cached(`solde:${email}`, async () => {
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
    });
  }

  async getAllSoldes() {
    return this._cached('allSoldes', async () => {
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
    });
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
    let result;
    if (existing.id) {
      result = await this._call(`/sites/${sid}/lists/${lid}/items/${existing.id}/fields`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
    } else {
      result = await this._call(`/sites/${sid}/lists/${lid}/items`, {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });
    }
    this._invalidate('allSoldes');
    this._invalidate('solde:');
    return result;
  }

  // ── DEMANDES DE CONGÉ ─────────────────────────────────────────────────────
  async createDemande({ email, nom, type, dateDebut, dateFin, heures, motif }) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
    const result = await this._call(`/sites/${sid}/lists/${lid}/items`, {
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
    this._invalidate('allDemandes');
    this._invalidate('mesDemandes:');
    return result;
  }

  async getMesDemandes(email) {
    return this._cached(`mesDemandes:${email}`, async () => {
      const sid = await this._siteIdCached();
      const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
      const filter = encodeURIComponent(`fields/EmployeEmail eq '${email}'`);
      const d = await this._call(`/sites/${sid}/lists/${lid}/items?$filter=${filter}&$expand=fields&$orderby=fields/DateDebut desc&$top=200`);
      return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
    });
  }

  async getAllDemandes() {
    return this._cached('allDemandes', async () => {
      const sid = await this._siteIdCached();
      const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
      const d = await this._call(`/sites/${sid}/lists/${lid}/items?$expand=fields&$orderby=fields/DateDebut desc&$top=500`);
      return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
    });
  }

  async updateDemandeStatut(id, { statut, approbateur, notes }) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_DEMANDES);
    const result = await this._call(`/sites/${sid}/lists/${lid}/items/${id}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({
        Statut:           statut,
        DateDecision:     new Date().toISOString(),
        Approbateur:      approbateur || '',
        NotesApprobateur: notes || '',
      }),
    });
    this._invalidate('allDemandes');
    this._invalidate('mesDemandes:');
    return result;
  }

  // ── STATUTS DYNAMIQUES ────────────────────────────────────────────────────
  async getStatutsConfig() {
    return this._cached('statutsConfig', async () => {
      const sid = await this._siteIdCached();
      const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_STATUTS);
      const d = await this._call(`/sites/${sid}/lists/${lid}/items?$expand=fields&$top=200`);
      return (d.value || [])
        .map(i => ({
          itemId:   i.id,
          id:       i.fields.StatutId,
          label:    i.fields.Label,
          icon:     i.fields.Icon,
          color:    i.fields.Color,
          category: i.fields.Category,
          ordre:    Number(i.fields.Ordre) || 0,
          actif:    i.fields.Actif !== false,
        }))
        .filter(s => s.actif !== false)
        .sort((a, b) => a.ordre - b.ordre);
    });
  }

  async createStatut(s) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_STATUTS);
    const r = await this._call(`/sites/${sid}/lists/${lid}/items`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          StatutId: s.id,
          Label:    s.label,
          Icon:     s.icon,
          Color:    s.color,
          Category: s.category,
          Ordre:    Number(s.ordre) || 0,
          Actif:    s.actif !== false,
        },
      }),
    });
    this._invalidate('statutsConfig');
    return r;
  }

  async updateStatut(itemId, s) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_STATUTS);
    const r = await this._call(`/sites/${sid}/lists/${lid}/items/${itemId}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({
        StatutId: s.id,
        Label:    s.label,
        Icon:     s.icon,
        Color:    s.color,
        Category: s.category,
        Ordre:    Number(s.ordre) || 0,
        Actif:    s.actif !== false,
      }),
    });
    this._invalidate('statutsConfig');
    return r;
  }

  async deleteStatut(itemId) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_STATUTS);
    const r = await this._call(`/sites/${sid}/lists/${lid}/items/${itemId}`, {
      method: 'DELETE',
    });
    this._invalidate('statutsConfig');
    return r;
  }

  // ── MODIFICATIONS DE POINTAGES ────────────────────────────────────────────
  async createModification(data) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_MODIFICATIONS);
    const r = await this._call(`/sites/${sid}/lists/${lid}/items`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          PointageId:     String(data.pointageId),
          EmployeEmail:   data.email,
          EmployeNom:     data.nom,
          AncienStatut:   data.ancienStatut,
          NouveauStatut:  data.nouveauStatut,
          AncienneHeure:  new Date(data.ancienneHeure).toISOString(),
          NouvelleHeure:  new Date(data.nouvelleHeure).toISOString(),
          Motif:          data.motif || '',
          Statut:         'En attente',
          DateSoumission: new Date().toISOString(),
        },
      }),
    });
    this._invalidate('allMod');
    this._invalidate('mesMod:');
    return r;
  }

  async getMesModifications(email) {
    return this._cached(`mesMod:${email}`, async () => {
      const sid = await this._siteIdCached();
      const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_MODIFICATIONS);
      const filter = encodeURIComponent(`fields/EmployeEmail eq '${email}'`);
      const d = await this._call(`/sites/${sid}/lists/${lid}/items?$filter=${filter}&$expand=fields&$orderby=fields/DateSoumission desc&$top=200`);
      return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
    });
  }

  async getAllModifications() {
    return this._cached('allMod', async () => {
      const sid = await this._siteIdCached();
      const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_MODIFICATIONS);
      const d = await this._call(`/sites/${sid}/lists/${lid}/items?$expand=fields&$orderby=fields/DateSoumission desc&$top=500`);
      return (d.value || []).map(i => ({ id: i.id, ...i.fields }));
    });
  }

  async updateModificationStatut(id, { statut, approbateur, notes }) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdForName(CONFIG.SHAREPOINT_LIST_MODIFICATIONS);
    const r = await this._call(`/sites/${sid}/lists/${lid}/items/${id}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({
        Statut:           statut,
        DateDecision:     new Date().toISOString(),
        Approbateur:      approbateur || '',
        NotesApprobateur: notes || '',
      }),
    });
    this._invalidate('allMod');
    this._invalidate('mesMod:');
    return r;
  }

  async updatePointage(pointageId, fields) {
    const sid = await this._siteIdCached();
    const lid = await this._listIdCached(); // liste principale Presences_Employes
    const r = await this._call(`/sites/${sid}/lists/${lid}/items/${pointageId}/fields`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    this._invalidate('allPresences');
    this._invalidate('myPresences:');
    return r;
  }
}

const Graph = new GraphAPI();
