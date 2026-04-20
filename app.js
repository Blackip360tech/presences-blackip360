// BlackIP360 Présences — Contrôleur principal
const App = {
  user:           null,  // { name, email, department }
  activeTab:      'statut',
  currentStatuses: [],
  tvInterval:     null,
  isAdmin:        false,
  _payeData:      null,

  // ── Initialisation ────────────────────────────────────────────────────────
  async init() {
    try {
      await Auth.init();
      if (Auth.isLoggedIn()) {
        await this._onLoginSuccess();
      } else if (Auth.initError) {
        this._showLoginError('Erreur de connexion : ' + (Auth.initError.errorCode || Auth.initError.message || 'inconnue'));
      }
    } catch (err) {
      this._fatalError('Erreur d\'initialisation : ' + err.message);
    }
  },

  _showLoginError(html) {
    const el = document.getElementById('loginError');
    if (el) { el.innerHTML = html; el.hidden = false; }
  },

  async _onLoginSuccess() {
    this.user = Auth.getUser();

    try {
      const profile        = await Graph.getProfile();
      this.user.department = profile.department  || 'Non défini';
      this.user.jobTitle   = profile.jobTitle    || '';
      this.user.email      = profile.mail        || this.user.email;
      this.user.name       = profile.displayName || this.user.name;
    } catch (err) {
      this.user.department = 'Non défini';
    }

    // Département + permissions depuis Soldes_Conges (source de vérité)
    this._userSolde = null;
    try {
      const solde = await Graph.getSolde(this.user.email);
      this._userSolde = solde;
      if (solde.departement) {
        this.user.department = solde.departement;
      }
    } catch (err) { /* pas bloquant */ }

    this._checkAdmin();
    this._showApp();
    this._renderHeader();

    // Mode TV plein écran si ?tv=1
    const params = new URLSearchParams(window.location.search);
    const tvMode = params.get('tv') === '1';
    const requestedTab = params.get('tab') || 'statut';

    if (tvMode) {
      document.querySelector('header')?.setAttribute('hidden', '');
      document.querySelector('main').style.padding = '0';
      document.querySelector('main').style.maxWidth = '100%';
      await this.switchTab('tv');
    } else {
      await this.loadTab(requestedTab);
      // Activer le bon onglet dans la nav
      document.querySelectorAll('.tab-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tab === requestedTab)
      );
      document.querySelectorAll('.tab-content').forEach(div => {
        div.hidden = div.id !== `tab-${requestedTab}`;
      });
      this.activeTab = requestedTab;
    }
  },

  _checkAdmin() {
    // Super-admins codés en dur (accès total)
    const superAdmins = ['admin@blackip360.com', 'tech@blackip360.com', 'tfournier@blackip360.com', 'sstemarie@blackip360.com'];
    const isSuper = superAdmins.includes(this.user.email?.toLowerCase());
    const s = this._userSolde || {};

    this.perms = {
      canAdmin:     isSuper || !!s.canAdmin,
      canTV:        isSuper || !!s.canTV,
      canPaye:      isSuper || !!s.canPaye,
      canAcces:     isSuper || !!s.canAcces,
      canApprouver: isSuper || !!s.canApprouver,
    };
    // isAdmin = a au moins une permission admin (pour compatibilité)
    this.isAdmin = isSuper || this.perms.canAdmin || this.perms.canTV || this.perms.canPaye || this.perms.canAcces || this.perms.canApprouver;

    // Appliquer les permissions sur les éléments avec data-perm
    document.querySelectorAll('[data-perm]').forEach(el => {
      const p = el.dataset.perm;
      el.style.display = this.perms[p] ? '' : 'none';
    });
    // Compat ascendante pour data-admin
    document.querySelectorAll('[data-admin]').forEach(el => {
      el.style.display = this.isAdmin ? '' : 'none';
    });
  },

  _showApp() {
    const ls = document.getElementById('loginScreen');
    if (ls) { ls.hidden = true; ls.style.display = 'none'; }
    const app = document.getElementById('app');
    if (app) { app.hidden = false; app.style.display = ''; }
    // Badge DEV visible uniquement en env dev
    const badge = document.getElementById('envBadge');
    if (badge && CONFIG.IS_DEV) badge.hidden = false;
    this._startClock();
  },

  _renderHeader() {
    document.getElementById('userNom').textContent   = this.user.name  || '—';
    document.getElementById('userEmail').textContent = this.user.email || '';
    document.getElementById('userDept').textContent  = this.user.department || '';
    const initials = (this.user.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('');
    document.getElementById('userInitials').textContent = initials.toUpperCase();
  },

  // ── Navigation par onglets ────────────────────────────────────────────────
  async switchTab(tabId) {
    this.activeTab = tabId;

    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tab === tabId)
    );
    document.querySelectorAll('.tab-content').forEach(div => {
      div.hidden = div.id !== `tab-${tabId}`;
    });

    if (tabId !== 'tv' && this.tvInterval) {
      clearInterval(this.tvInterval);
      this.tvInterval = null;
    }
    if (tabId !== 'tv' && this.tvClockInterval) {
      clearInterval(this.tvClockInterval);
      this.tvClockInterval = null;
    }

    await this.loadTab(tabId);
  },

  async loadTab(tabId) {
    switch (tabId) {
      case 'statut': return this._loadMonStatut();
      case 'demandes': return this._loadDemandes();
      case 'rapport': return this._loadRapport();
      case 'admin':  return this._loadAdmin();
      case 'tv':     return this._loadTV();
      case 'paye':   return this._loadPaye();
      case 'acces':  return this._loadAcces();
    }
  },

  // ── MON STATUT ────────────────────────────────────────────────────────────
  async _loadMonStatut() {
    const el = document.getElementById('tab-statut');
    el.innerHTML = '<div class="loading">Chargement de votre statut…</div>';
    try {
      const history = await Graph.getMyPresences(this.user.email);
      const current = history[0] || null;
      el.innerHTML = this._renderMonStatut(current, history);
      this._bindStatutBtns();
    } catch (err) {
      el.innerHTML = `<div class="error"><strong>Erreur :</strong> ${err.message}<br>
        Vérifiez que CLIENT_ID et TENANT_ID sont configurés dans config.js.</div>`;
    }
  },

  _renderMonStatut(current, history) {
    const st = current
      ? CONFIG.STATUTS.find(s => s.label === current.StatutActuel)
      : null;

    return `
      <div class="statut-container">

        <div class="current-card ${st?.category || 'none'}">
          <div class="current-icon">${st?.icon || '❓'}</div>
          <div class="current-body">
            <div class="current-sub">Mon statut actuel</div>
            <div class="current-label">${current?.StatutActuel || 'Aucun statut enregistré'}</div>
            ${current ? `<div class="current-time">Depuis ${this._fmtTime(current.HeurePointage)}</div>` : ''}
          </div>
          ${current ? '<div class="current-dot"></div>' : ''}
        </div>

        <div class="notes-row">
          <textarea id="notesInput" placeholder="Note optionnelle (visible par les admins)…" maxlength="200"></textarea>
        </div>

        <h3>Changer mon statut</h3>
        <div class="statuts-grid">
          ${CONFIG.STATUTS.map(s => `
            <button class="statut-btn ${s.category} ${current?.StatutActuel === s.label ? 'selected' : ''}"
                    data-statut="${s.label}"
                    style="--c: ${s.color}">
              <span class="sbtn-icon">${s.icon}</span>
              <span class="sbtn-label">${s.label}</span>
            </button>
          `).join('')}
        </div>

      </div>`;
  },

  _bindStatutBtns() {
    document.querySelectorAll('.statut-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const statutLabel = btn.dataset.statut;
        const statutCfg = CONFIG.STATUTS.find(s => s.label === statutLabel);
        const needsNote = statutCfg && (statutCfg.id === 'route_bip' || statutCfg.id === 'route_cv247');
        const notesEl = document.getElementById('notesInput');
        const notesValue = notesEl?.value?.trim() || '';
        if (needsNote && !notesValue) {
          this.showToast('Une note est obligatoire pour ce statut (indiquer le client).', 'error');
          notesEl?.focus();
          return;
        }
        await this._setStatut(statutLabel, notesValue);
      });
    });
  },

  async _setStatut(statut, notes) {
    const btn = document.querySelector(`[data-statut="${statut}"]`);
    if (btn) btn.disabled = true;
    try {
      await Graph.pointage({
        nom:        this.user.name,
        email:      this.user.email,
        departement: this.user.department,
        statut,
        notes,
      });
      this.showToast(`✅ Statut mis à jour`);
      await this._loadMonStatut();
    } catch (err) {
      this.showToast(`❌ ${err.message}`, 'error');
      if (btn) btn.disabled = false;
    }
  },

  // ── DEMANDES DE CONGÉ ─────────────────────────────────────────────────────
  async _loadDemandes() {
    const el = document.getElementById('tab-demandes');
    el.innerHTML = '<div class="loading">Chargement…</div>';
    try {
      const [solde, mesDemandes, toutesDemandes] = await Promise.all([
        Graph.getSolde(this.user.email),
        Graph.getMesDemandes(this.user.email),
        this.isAdmin ? Graph.getAllDemandes() : Promise.resolve(null),
      ]);

      const attente = toutesDemandes ? toutesDemandes.filter(d => d.Statut === 'En attente') : [];

      el.innerHTML = `
        <h2>🏖️ Mes demandes de congé</h2>

        <div class="solde-row">
          <div class="solde-card vac">
            <div class="n">${solde.vacances} h</div>
            <div class="l">🌴 Solde vacances</div>
          </div>
          <div class="solde-card mal">
            <div class="n">${solde.maladie} h</div>
            <div class="l">🤒 Solde maladie</div>
          </div>
        </div>

        <div class="dem-grid">
          <div class="dem-form-card">
            <h3>➕ Nouvelle demande</h3>
            <div class="dem-field">
              <label>Type de congé</label>
              <select id="demType">
                ${CONFIG.TYPES_CONGE.map(t => `<option value="${t.label}">${t.icon} ${t.label}</option>`).join('')}
              </select>
            </div>
            <div class="dem-field-row">
              <div class="dem-field">
                <label>Date début</label>
                <input type="date" id="demDateDebut" value="${this._today()}">
              </div>
              <div class="dem-field">
                <label>Date fin</label>
                <input type="date" id="demDateFin" value="${this._today()}">
              </div>
            </div>
            <div class="dem-field">
              <label>Nombre d'heures</label>
              <input type="number" id="demHeures" min="1" step="0.5" value="8">
            </div>
            <div class="dem-field">
              <label>Motif (optionnel)</label>
              <textarea id="demMotif" maxlength="500" placeholder="Raison de la demande…"></textarea>
            </div>
            <button class="btn-primary" id="demSubmit">Soumettre la demande</button>
          </div>

          <div class="dem-list-card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
              <h3 style="margin:0">📋 Mes demandes récentes</h3>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <input type="text" id="demFilterType" placeholder="Type…" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.82rem;width:120px" list="demTypesList">
                <datalist id="demTypesList">
                  ${CONFIG.TYPES_CONGE.map(t => `<option value="${t.label}">`).join('')}
                </datalist>
                <input type="date" id="demFilterFrom" class="dem-date-filter" title="Du" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.82rem">
                <input type="date" id="demFilterTo"   class="dem-date-filter" title="Au" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.82rem">
                <button class="btn-secondary" id="demFilterClear" style="padding:6px 10px;font-size:.82rem">Effacer</button>
              </div>
            </div>
            <div id="demMesListe">
              ${this._renderDemandesListe(mesDemandes, false)}
            </div>
          </div>
        </div>

        ${this.isAdmin ? `
          <h2 style="margin-top:28px">👥 Gestion des demandes — Admin</h2>
          <div class="dem-list-card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
              <h3 style="margin:0">⏳ Demandes en attente (${attente.length})</h3>
            </div>
            <div id="demAdminListe">
              ${this._renderDemandesListe(attente, true)}
            </div>
          </div>

          <div class="dem-list-card" style="margin-top:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
              <h3 style="margin:0">📜 Historique de toutes les demandes</h3>
            </div>
            <div id="demAdminHistorique">
              ${this._renderDemandesListe((toutesDemandes || []).filter(d => d.Statut !== 'En attente'), false)}
            </div>
          </div>
        ` : ''}
      `;

      document.getElementById('demSubmit').onclick = () => this._submitDemande();
      if (this.isAdmin) {
        el.querySelectorAll('[data-approve]').forEach(btn =>
          btn.onclick = () => this._decideDemande(btn.dataset.approve, 'Approuvée')
        );
        el.querySelectorAll('[data-refuse]').forEach(btn =>
          btn.onclick = () => this._decideDemande(btn.dataset.refuse, 'Refusée')
        );
      }

      // Filtres demandes
      this._allDemandes = { mes: mesDemandes, admin: attente, hist: (toutesDemandes || []).filter(d => d.Statut !== 'En attente') };
      const applyFilter = () => {
        const ft = document.getElementById('demFilterType')?.value?.toLowerCase().trim() || '';
        const fd = document.getElementById('demFilterFrom')?.value;
        const ft2 = document.getElementById('demFilterTo')?.value;
        const match = (list) => list.filter(d => {
          if (ft && !(d.TypeConge || '').toLowerCase().includes(ft)) return false;
          if (fd && new Date(d.DateFin) < new Date(fd + 'T00:00:00')) return false;
          if (ft2 && new Date(d.DateDebut) > new Date(ft2 + 'T23:59:59')) return false;
          return true;
        });
        const mesEl = document.getElementById('demMesListe');
        if (mesEl) mesEl.innerHTML = this._renderDemandesListe(match(this._allDemandes.mes), false);
        const admEl = document.getElementById('demAdminListe');
        if (admEl) admEl.innerHTML = this._renderDemandesListe(match(this._allDemandes.admin), true);
        const histEl = document.getElementById('demAdminHistorique');
        if (histEl) histEl.innerHTML = this._renderDemandesListe(match(this._allDemandes.hist), false);
        // Re-bind admin actions après rerender
        if (this.isAdmin) {
          document.querySelectorAll('[data-approve]').forEach(btn =>
            btn.onclick = () => this._decideDemande(btn.dataset.approve, 'Approuvée')
          );
          document.querySelectorAll('[data-refuse]').forEach(btn =>
            btn.onclick = () => this._decideDemande(btn.dataset.refuse, 'Refusée')
          );
        }
      };
      ['demFilterType', 'demFilterFrom', 'demFilterTo'].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.oninput = e.onchange = applyFilter;
      });
      document.getElementById('demFilterClear')?.addEventListener('click', () => {
        ['demFilterType', 'demFilterFrom', 'demFilterTo'].forEach(id => {
          const e = document.getElementById(id); if (e) e.value = '';
        });
        applyFilter();
      });
    } catch (err) {
      el.innerHTML = `<div class="error">Erreur : ${err.message}</div>`;
    }
  },

  _renderDemandesListe(demandes, showAdminActions) {
    if (!demandes || !demandes.length) {
      return '<div class="muted" style="padding:20px;text-align:center">Aucune demande</div>';
    }
    return demandes.map(d => {
      const typeCfg = CONFIG.TYPES_CONGE.find(t => t.label === d.TypeConge);
      const statutClass = d.Statut === 'En attente' ? 'attente' : d.Statut === 'Approuvée' ? 'approuvee' : 'refusee';
      return `
        <div class="dem-item">
          <div class="dem-item-hdr">
            <div class="dem-item-type">${typeCfg?.icon || '📅'} ${d.TypeConge} — ${d.NombreHeures || 0} h</div>
            <span class="dem-statut ${statutClass}">${d.Statut}</span>
          </div>
          <div class="dem-item-dates">
            ${showAdminActions ? `<strong>${d.EmployeNom || d.EmployeEmail}</strong> · ` : ''}
            ${this._fmtDate(d.DateDebut)} → ${this._fmtDate(d.DateFin)}
          </div>
          ${d.Motif ? `<div class="dem-item-motif">💬 ${d.Motif}</div>` : ''}
          ${d.NotesApprobateur ? `<div class="dem-item-motif" style="color:#4ade80">✓ ${d.NotesApprobateur}</div>` : ''}
          ${showAdminActions ? `
            <div class="dem-admin-actions">
              <button class="btn-primary" data-approve="${d.id}">✓ Approuver</button>
              <button class="btn-danger" data-refuse="${d.id}">✗ Refuser</button>
            </div>
          ` : ''}
        </div>`;
    }).join('');
  },

  async _submitDemande() {
    const type = document.getElementById('demType').value;
    const dateDebut = document.getElementById('demDateDebut').value;
    const dateFin = document.getElementById('demDateFin').value;
    const heures = parseFloat(document.getElementById('demHeures').value) || 0;
    const motif = document.getElementById('demMotif').value.trim();

    if (!dateDebut || !dateFin) return this.showToast('Dates requises', 'error');
    if (new Date(dateFin) < new Date(dateDebut)) return this.showToast('Date fin avant date début', 'error');
    if (heures <= 0) return this.showToast('Nombre d\'heures invalide', 'error');

    const btn = document.getElementById('demSubmit');
    btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      await Graph.createDemande({
        email: this.user.email,
        nom: this.user.name,
        type,
        dateDebut,
        dateFin,
        heures,
        motif,
      });
      this.showToast('Demande envoyée ✓', 'success');
      await this._loadDemandes();
    } catch (err) {
      this.showToast('Erreur : ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Soumettre la demande';
    }
  },

  async _decideDemande(id, statut) {
    const notes = statut === 'Refusée' ? prompt('Raison du refus (optionnel) :') : prompt('Note pour l\'employé (optionnel) :');
    if (notes === null) return;
    try {
      await Graph.updateDemandeStatut(id, {
        statut,
        approbateur: this.user.email,
        notes: notes || '',
      });

      // Si approuvée et type Vacances/Maladie : déduire du solde
      if (statut === 'Approuvée') {
        const all = await Graph.getAllDemandes();
        const dem = all.find(d => d.id === id);
        if (dem && (dem.TypeConge === 'Vacances' || dem.TypeConge === 'Maladie')) {
          const solde = await Graph.getSolde(dem.EmployeEmail);
          const newVac = dem.TypeConge === 'Vacances' ? Math.max(0, solde.vacances - (dem.NombreHeures || 0)) : solde.vacances;
          const newMal = dem.TypeConge === 'Maladie'  ? Math.max(0, solde.maladie  - (dem.NombreHeures || 0)) : solde.maladie;
          await Graph.upsertSolde({
            email:        dem.EmployeEmail,
            nom:          dem.EmployeNom || solde.nom,
            departement:  solde.departement || dem.Departement || '',
            vacances:     newVac,
            maladie:      newMal,
            canAdmin:     solde.canAdmin,
            canTV:        solde.canTV,
            canPaye:      solde.canPaye,
            canAcces:     solde.canAcces,
            canApprouver: solde.canApprouver,
          });
        }
      }

      this.showToast(`Demande ${statut.toLowerCase()} ✓`, 'success');
      await this._loadDemandes();
    } catch (err) {
      this.showToast('Erreur : ' + err.message, 'error');
    }
  },

  _fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('fr-CA', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  async _renderSoldesAdmin() {
    const wrap = document.getElementById('soldesAdminWrap');
    if (!wrap) return;
    try {
      const [allSoldes, allPresences] = await Promise.all([
        Graph.getAllSoldes(),
        Graph.getAllPresences(),
      ]);

      const empMap = {};
      for (const p of allPresences) {
        const k = p.EmployeEmail?.toLowerCase();
        if (k && !empMap[k]) {
          empMap[k] = { email: p.EmployeEmail, nom: p.EmployeNom || p.EmployeEmail, departement: p.Departement || '' };
        }
      }
      for (const s of allSoldes) {
        const k = s.email?.toLowerCase();
        if (k && !empMap[k]) {
          empMap[k] = { email: s.email, nom: s.nom || s.email, departement: s.departement || '' };
        }
      }

      const soldeMap = Object.fromEntries(allSoldes.map(s => [s.email?.toLowerCase(), s]));
      const rows = Object.values(empMap).map(e => {
        const s = soldeMap[e.email.toLowerCase()] || {};
        return {
          email:        e.email,
          nom:          e.nom,
          departement:  s.departement || e.departement || '',
          vacances:     s.vacances || 0,
          maladie:      s.maladie  || 0,
          canAdmin:     !!s.canAdmin,
          canTV:        !!s.canTV,
          canPaye:      !!s.canPaye,
          canAcces:     !!s.canAcces,
          canApprouver: !!s.canApprouver,
        };
      }).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));

      const selStyle = 'padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:inherit;font-size:.8rem';
      const numStyle = selStyle + ';width:72px;font-family:var(--mono)';
      const cbStyle  = 'width:18px;height:18px;accent-color:var(--primary);cursor:pointer';
      const depts = CONFIG.DEPARTEMENTS.filter(d => d !== 'Tous');

      wrap.innerHTML = `
        <div class="filter-row">
          <input type="text" id="soldeSearch" placeholder="🔍 Rechercher un employé…">
        </div>
        <div class="table-wrap" style="overflow-x:auto">
          <table class="perm-table" style="min-width:1100px">
            <thead>
              <tr>
                <th>Employé</th>
                <th>Département</th>
                <th style="text-align:center" title="Voir l'onglet Admin">👥 Admin</th>
                <th style="text-align:center" title="Voir l'affichage TV">📺 TV</th>
                <th style="text-align:center" title="Voir le rapport paye">💰 Paye</th>
                <th style="text-align:center" title="Gérer les utilisateurs">🔑 Accès</th>
                <th style="text-align:center" title="Approuver demandes de congé">✓ Congés</th>
                <th style="text-align:center">🌴 Vac.</th>
                <th style="text-align:center">🤒 Mal.</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="soldeTbody">
              ${rows.map(emp => `
                <tr data-email="${emp.email}" data-nom="${(emp.nom || '').replace(/"/g, '&quot;')}" data-search="${(emp.nom + ' ' + emp.email).toLowerCase()}">
                  <td>
                    <strong>${emp.nom}</strong><br>
                    <span class="muted" style="font-size:.75rem">${emp.email}</span>
                  </td>
                  <td>
                    <select class="solde-dept" style="${selStyle}">
                      <option value="">— Non défini —</option>
                      ${depts.map(d => `<option value="${d}"${d === emp.departement ? ' selected' : ''}>${d}</option>`).join('')}
                    </select>
                  </td>
                  <td style="text-align:center"><input type="checkbox" class="perm-admin"    ${emp.canAdmin     ? 'checked' : ''} style="${cbStyle}"></td>
                  <td style="text-align:center"><input type="checkbox" class="perm-tv"       ${emp.canTV        ? 'checked' : ''} style="${cbStyle}"></td>
                  <td style="text-align:center"><input type="checkbox" class="perm-paye"     ${emp.canPaye      ? 'checked' : ''} style="${cbStyle}"></td>
                  <td style="text-align:center"><input type="checkbox" class="perm-acces"    ${emp.canAcces     ? 'checked' : ''} style="${cbStyle}"></td>
                  <td style="text-align:center"><input type="checkbox" class="perm-approuver"${emp.canApprouver ? 'checked' : ''} style="${cbStyle}"></td>
                  <td style="text-align:center"><input type="number" class="solde-vac" value="${emp.vacances}" step="0.5" min="0" style="${numStyle}"></td>
                  <td style="text-align:center"><input type="number" class="solde-mal" value="${emp.maladie}"  step="0.5" min="0" style="${numStyle}"></td>
                  <td><button class="btn-primary solde-save">💾</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      const searchEl = document.getElementById('soldeSearch');
      if (searchEl) {
        searchEl.oninput = () => {
          const q = searchEl.value.toLowerCase().trim();
          document.querySelectorAll('#soldeTbody tr').forEach(tr => {
            tr.style.display = !q || tr.dataset.search.includes(q) ? '' : 'none';
          });
        };
      }

      wrap.querySelectorAll('.solde-save').forEach(btn => {
        btn.onclick = async () => {
          const tr = btn.closest('tr');
          const payload = {
            email:        tr.dataset.email,
            nom:          tr.dataset.nom,
            departement:  tr.querySelector('.solde-dept').value,
            vacances:     parseFloat(tr.querySelector('.solde-vac').value) || 0,
            maladie:      parseFloat(tr.querySelector('.solde-mal').value) || 0,
            canAdmin:     tr.querySelector('.perm-admin').checked,
            canTV:        tr.querySelector('.perm-tv').checked,
            canPaye:      tr.querySelector('.perm-paye').checked,
            canAcces:     tr.querySelector('.perm-acces').checked,
            canApprouver: tr.querySelector('.perm-approuver').checked,
          };
          btn.disabled = true;
          const orig = btn.textContent;
          btn.textContent = '⏳';
          try {
            await Graph.upsertSolde(payload);
            btn.textContent = '✓';
            this.showToast('Utilisateur mis à jour', 'success');
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
          } catch (err) {
            btn.textContent = '❌';
            this.showToast('Erreur : ' + err.message, 'error');
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
          }
        };
      });
    } catch (err) {
      wrap.innerHTML = `<div class="error">Erreur : ${err.message}</div>`;
    }
  },

  // ── CALCUL DES HEURES TRAVAILLÉES ─────────────────────────────────────────
  // Règles :
  //  - Statuts "présents" (bureau, télétravail, clients, formation) = temps compté
  //  - Pause = comptée jusqu'à 30 min/jour (2×15 min)
  //  - Dîner = non payé
  //  - Autres absences = non comptées
  //  - Quart_fini ferme la journée
  //  - Un pointage "présent" sans pointage suivant = temps non compté après (employé doit fermer)
  _calculateDayMinutes(entries) {
    if (!entries?.length) return { work: 0, pause: 0, total: 0 };
    const PAUSE_CAP = 30;

    const sorted = [...entries].sort((a, b) => new Date(a.HeurePointage) - new Date(b.HeurePointage));
    let workMin = 0, pauseMin = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      const durMin = Math.max(0, (new Date(next.HeurePointage) - new Date(curr.HeurePointage)) / 60000);
      const st = CONFIG.STATUTS.find(s => s.label === curr.StatutActuel);
      if (!st) continue;
      if (st.category === 'present') workMin += durMin;
      else if (st.id === 'pause')    pauseMin += durMin;
      // diner, rdv, vacances, malade, quart_fini : non comptés
    }

    const paidPause = Math.min(pauseMin, PAUSE_CAP);
    return {
      work:  workMin,
      pause: pauseMin,
      total: workMin + paidPause,
    };
  },

  _calculateDayHours(entries) {
    const m = this._calculateDayMinutes(entries);
    return Math.round(m.total / 6) / 10; // arrondi à 0.1h près
  },

  // Initialise un calendrier Flatpickr sur un champ date
  _initDatePicker(id, onChange) {
    const el = document.getElementById(id);
    if (!el || typeof flatpickr === 'undefined') return;
    flatpickr(el, {
      locale:     'fr',
      dateFormat: 'Y-m-d',
      altInput:   true,
      altFormat:  'D j F Y',
      defaultDate: el.value || undefined,
      onChange:   () => { if (typeof onChange === 'function') onChange(); },
    });
  },

  // ── MON RAPPORT ───────────────────────────────────────────────────────────
  _loadRapport() {
    const el = document.getElementById('tab-rapport');
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const fmt = d => d.toISOString().slice(0, 10);

    el.innerHTML = `
      <div class="paye-header">
        <div class="paye-title">
          <h2>📊 Mon rapport personnel</h2>
          <div class="sub">Consultez votre historique de pointages, vos heures travaillées et vos congés</div>
        </div>
        <div class="paye-actions">
          <button class="btn-primary" id="rapExport">⬇ Exporter CSV</button>
          <button class="btn-secondary" id="rapPrint">🖨 Imprimer</button>
        </div>
      </div>

      <div class="paye-presets">
        <button class="preset-btn" data-preset="today">Aujourd'hui</button>
        <button class="preset-btn" data-preset="week">Cette semaine</button>
        <button class="preset-btn" data-preset="lastweek">Semaine dernière</button>
        <button class="preset-btn" data-preset="2weeks">2 dernières semaines</button>
        <button class="preset-btn active" data-preset="month">Ce mois</button>
        <button class="preset-btn" data-preset="lastmonth">Mois dernier</button>
        <button class="preset-btn" data-preset="year">Cette année</button>
      </div>

      <div class="paye-filters">
        <div class="field">
          <label>📅 Du</label>
          <input type="date" id="rapFrom" value="${fmt(monthStart)}">
        </div>
        <div class="field">
          <label>📅 Au</label>
          <input type="date" id="rapTo" value="${fmt(today)}">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn-primary" id="rapCalc">Générer</button>
        </div>
      </div>

      <div id="rapResult"></div>
    `;

    document.getElementById('rapCalc').onclick   = () => this._computeRapport();
    document.getElementById('rapExport').onclick = () => this._exportRapport();
    document.getElementById('rapPrint').onclick  = () => window.print();

    // Presets de période
    el.querySelectorAll('.preset-btn').forEach(btn => {
      btn.onclick = () => {
        const preset = btn.dataset.preset;
        let from, to;
        const n = new Date();
        if (preset === 'today') {
          from = new Date(n); to = new Date(n);
        } else if (preset === 'week') {
          from = new Date(n); from.setDate(n.getDate() - ((n.getDay() + 6) % 7));
          to = new Date(from); to.setDate(from.getDate() + 6);
        } else if (preset === 'lastweek') {
          from = new Date(n); from.setDate(n.getDate() - ((n.getDay() + 6) % 7) - 7);
          to = new Date(from); to.setDate(from.getDate() + 6);
        } else if (preset === '2weeks') {
          to = new Date(n);
          from = new Date(n); from.setDate(n.getDate() - 13);
        } else if (preset === 'month') {
          from = new Date(n.getFullYear(), n.getMonth(), 1);
          to   = new Date(n.getFullYear(), n.getMonth() + 1, 0);
        } else if (preset === 'lastmonth') {
          from = new Date(n.getFullYear(), n.getMonth() - 1, 1);
          to   = new Date(n.getFullYear(), n.getMonth(), 0);
        } else if (preset === 'year') {
          from = new Date(n.getFullYear(), 0, 1);
          to   = new Date(n.getFullYear(), 11, 31);
        }
        document.getElementById('rapFrom').value = fmt(from);
        document.getElementById('rapTo').value   = fmt(to);
        el.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._computeRapport();
      };
    });

    // Calendriers Flatpickr + auto-deselect des presets au changement manuel
    const onDateChange = () => {
      el.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      this._computeRapport();
    };
    this._initDatePicker('rapFrom', onDateChange);
    this._initDatePicker('rapTo',   onDateChange);

    this._computeRapport();
  },

  async _computeRapport() {
    const result = document.getElementById('rapResult');
    result.innerHTML = '<div class="loading">Chargement de votre rapport…</div>';

    const fromStr = document.getElementById('rapFrom').value;
    const toStr   = document.getElementById('rapTo').value;
    const from = new Date(fromStr + 'T00:00:00');
    const to   = new Date(toStr   + 'T23:59:59');

    try {
      const [history, solde, demandes] = await Promise.all([
        Graph.getMyPresences(this.user.email),
        Graph.getSolde(this.user.email).catch(() => ({ vacances: 0, maladie: 0 })),
        Graph.getMesDemandes(this.user.email).catch(() => []),
      ]);

      const filtered = history.filter(p => {
        if (!p.HeurePointage) return false;
        const d = new Date(p.HeurePointage);
        return d >= from && d <= to;
      });

      const byDay = {};
      for (const p of filtered) {
        const key = p.HeurePointage.slice(0, 10);
        if (!byDay[key]) byDay[key] = [];
        byDay[key].push(p);
      }

      const daysWithPresent = Object.entries(byDay).filter(([_, entries]) =>
        entries.some(e => CONFIG.STATUTS.find(s => s.label === e.StatutActuel)?.category === 'present')
      ).length;
      const heuresEstimees = Object.values(byDay).reduce((s, entries) => s + this._calculateDayHours(entries), 0).toFixed(1);

      const demandesApprouvees = demandes.filter(d => {
        if (d.Statut !== 'Approuvée') return false;
        const dStart = new Date(d.DateDebut);
        const dEnd   = new Date(d.DateFin);
        return dEnd >= from && dStart <= to;
      });
      const hVac = demandesApprouvees.filter(d => d.TypeConge === 'Vacances').reduce((s, d) => s + (d.NombreHeures || 0), 0);
      const hMal = demandesApprouvees.filter(d => d.TypeConge === 'Maladie').reduce((s, d) => s + (d.NombreHeures || 0), 0);

      const days = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days.push(new Date(d));

      this._rapData = { from, to, byDay, days, solde, demandesApprouvees };

      result.innerHTML = `
        <div class="stat-row" style="margin-bottom:20px">
          <div class="stat-card blue"><div class="stat-l">Jours travaillés</div><div class="stat-n">${daysWithPresent}</div></div>
          <div class="stat-card green"><div class="stat-l">Heures estimées</div><div class="stat-n">${heuresEstimees}</div></div>
          <div class="stat-card yellow"><div class="stat-l">🌴 Solde vacances</div><div class="stat-n">${solde.vacances} h</div></div>
          <div class="stat-card red"><div class="stat-l">🤒 Solde maladie</div><div class="stat-n">${solde.maladie} h</div></div>
          <div class="stat-card purple"><div class="stat-l">Vacances prises</div><div class="stat-n">${hVac} h</div></div>
        </div>

        <h3>📅 Détail par jour</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Pointages</th>
                <th style="text-align:center">Heures</th>
              </tr>
            </thead>
            <tbody>
              ${days.map(d => {
                const key = d.toISOString().slice(0, 10);
                const entries = (byDay[key] || []).slice().sort((a,b) => new Date(a.HeurePointage) - new Date(b.HeurePointage));
                const hours = this._calculateDayHours(entries);
                const dayLabel = d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short' });
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return `
                  <tr${isWeekend ? ' style="opacity:.55"' : ''}>
                    <td><strong>${dayLabel}</strong></td>
                    <td>${entries.length ? entries.map(e => {
                      const st = CONFIG.STATUTS.find(s => s.label === e.StatutActuel);
                      return `<span class="status-pill" style="margin-right:6px;margin-bottom:4px;display:inline-flex">${st?.icon || '❓'} ${e.StatutActuel} <span class="muted" style="margin-left:6px">${this._fmtTime(e.HeurePointage)}</span></span>`;
                    }).join('') : '<span class="muted">—</span>'}</td>
                    <td style="text-align:center;font-family:var(--mono);font-weight:700;color:${hours ? 'var(--primary)' : 'var(--muted)'}">${hours}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        ${demandesApprouvees.length ? `
          <h3 style="margin-top:24px">🏖️ Mes congés approuvés dans cette période</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Du</th><th>Au</th><th style="text-align:center">Heures</th></tr></thead>
              <tbody>
                ${demandesApprouvees.map(d => {
                  const tc = CONFIG.TYPES_CONGE.find(t => t.label === d.TypeConge);
                  return `
                    <tr>
                      <td>${tc?.icon || ''} <strong>${d.TypeConge}</strong></td>
                      <td>${this._fmtDate(d.DateDebut)}</td>
                      <td>${this._fmtDate(d.DateFin)}</td>
                      <td style="text-align:center;font-family:var(--mono)">${d.NombreHeures || 0}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
      `;
    } catch (err) {
      result.innerHTML = `<div class="error">Erreur : ${err.message}</div>`;
    }
  },

  _exportRapport() {
    if (!this._rapData) return this.showToast('Générez d\'abord le rapport.', 'error');
    const { days, byDay, demandesApprouvees, solde } = this._rapData;
    const rows = [
      ['Rapport personnel — ' + (this.user.name || this.user.email)],
      ['Période', document.getElementById('rapFrom').value + ' au ' + document.getElementById('rapTo').value],
      ['Solde vacances', solde.vacances + ' h'],
      ['Solde maladie',  solde.maladie  + ' h'],
      [],
      ['Date', 'Jour', 'Statut', 'Heure pointage', 'Heures estimées'],
    ];
    for (const d of days) {
      const key = d.toISOString().slice(0, 10);
      const entries = (byDay[key] || []).slice().sort((a,b) => new Date(a.HeurePointage) - new Date(b.HeurePointage));
      const hours = this._calculateDayHours(entries);
      const dayName = d.toLocaleDateString('fr-CA', { weekday: 'long' });
      if (!entries.length) {
        rows.push([key, dayName, '', '', hours]);
      } else {
        entries.forEach((e, i) => {
          rows.push([key, dayName, e.StatutActuel, this._fmtTime(e.HeurePointage), i === 0 ? hours : '']);
        });
      }
    }
    if (demandesApprouvees.length) {
      rows.push([]);
      rows.push(['Congés approuvés dans la période']);
      rows.push(['Type', 'Du', 'Au', 'Heures']);
      for (const d of demandesApprouvees) {
        rows.push([d.TypeConge, this._fmtDate(d.DateDebut), this._fmtDate(d.DateFin), d.NombreHeures || 0]);
      }
    }
    this._downloadCSV(rows, `mon_rapport_${this._today()}.csv`);
  },

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  async _loadAdmin() {
    const el = document.getElementById('tab-admin');
    el.innerHTML = '<div class="loading">Chargement des présences…</div>';
    try {
      const [statuses, soldes] = await Promise.all([
        Graph.getCurrentStatuses(),
        Graph.getAllSoldes().catch(() => []),
      ]);
      const soldeMap = Object.fromEntries(soldes.map(s => [s.email?.toLowerCase(), s]));
      this.currentStatuses = statuses.map(p => ({
        ...p,
        Departement: soldeMap[p.EmployeEmail?.toLowerCase()]?.departement || p.Departement,
      }));
      el.innerHTML = this._renderAdmin(this.currentStatuses);
      this._bindAdminFilters();
    } catch (err) {
      el.innerHTML = `<div class="error"><strong>Erreur :</strong> ${err.message}</div>`;
    }
  },

  _renderAdmin(statuses) {
    const presents = statuses.filter(p =>
      CONFIG.STATUTS.find(s => s.label === p.StatutActuel)?.category === 'present'
    );
    const absents = statuses.filter(p =>
      CONFIG.STATUTS.find(s => s.label === p.StatutActuel)?.category === 'absent'
    );

    return `
      <div class="admin-wrap">
        <div class="stat-row">
          <div class="stat-card green"><div class="stat-n">${presents.length}</div><div class="stat-l">Présents</div></div>
          <div class="stat-card red">  <div class="stat-n">${absents.length}</div> <div class="stat-l">Absents</div></div>
          <div class="stat-card blue"> <div class="stat-n">${statuses.length}</div><div class="stat-l">Total</div></div>
        </div>

        <div class="filter-row">
          <input type="text" id="searchInput" placeholder="🔍 Rechercher un employé…" />
          <select id="deptFilter">
            ${CONFIG.DEPARTEMENTS.map(d => `<option>${d}</option>`).join('')}
          </select>
          <select id="catFilter">
            <option value="tous">Tous les statuts</option>
            <option value="present">Présents</option>
            <option value="absent">Absents</option>
          </select>
          <button class="btn-primary" onclick="App.exportCSV()">📥 Export CSV</button>
          <button class="btn-secondary" onclick="App._loadAdmin()">🔄 Actualiser</button>
        </div>

        <div class="table-wrap">
          <table id="adminTable">
            <thead>
              <tr><th>Employé</th><th>Département</th><th>Statut actuel</th><th>Depuis</th><th>Note</th></tr>
            </thead>
            <tbody>
              ${statuses.map(p => this._renderAdminRow(p)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  _renderAdminRow(p) {
    const st    = CONFIG.STATUTS.find(s => s.label === p.StatutActuel);
    const color = st?.color || '#6c757d';
    const cat   = st?.category || '';
    return `
      <tr class="admin-row" data-email="${p.EmployeEmail}" data-dept="${p.Departement || ''}" data-cat="${cat}">
        <td><strong>${p.EmployeNom || '—'}</strong><br><small class="muted">${p.EmployeEmail}</small></td>
        <td>${p.Departement || '—'}</td>
        <td><span class="badge" style="background:${color}">${st?.icon || ''} ${p.StatutActuel}</span></td>
        <td>${this._fmtDateTime(p.HeurePointage)}</td>
        <td class="muted">${p.Notes || ''}</td>
      </tr>`;
  },

  _bindAdminFilters() {
    const run = () => {
      const q    = (document.getElementById('searchInput')?.value || '').toLowerCase();
      const dept = document.getElementById('deptFilter')?.value || 'Tous';
      const cat  = document.getElementById('catFilter')?.value  || 'tous';

      document.querySelectorAll('.admin-row').forEach(row => {
        const name    = row.querySelector('td')?.textContent.toLowerCase() || '';
        const matchQ  = !q    || name.includes(q);
        const matchD  = dept === 'Tous'  || row.dataset.dept === dept;
        const matchC  = cat  === 'tous'  || row.dataset.cat  === cat;
        row.hidden = !(matchQ && matchD && matchC);
      });
    };
    document.getElementById('searchInput')?.addEventListener('input',  run);
    document.getElementById('deptFilter')?.addEventListener('change', run);
    document.getElementById('catFilter')?.addEventListener('change',  run);
  },

  exportCSV() {
    const rows = [['Employé', 'Email', 'Département', 'Statut', 'Heure', 'Note']];
    this.currentStatuses.forEach(p =>
      rows.push([p.EmployeNom, p.EmployeEmail, p.Departement, p.StatutActuel, p.HeurePointage, p.Notes || ''])
    );
    this._downloadCSV(rows, `presences_${this._today()}.csv`);
  },

  // ── AFFICHAGE TV ──────────────────────────────────────────────────────────
  async _loadTV() {
    await this._refreshTV();
    this.tvInterval = setInterval(() => this._refreshTV(), CONFIG.TV_REFRESH_MS);
    if (this.tvClockInterval) clearInterval(this.tvClockInterval);
    this.tvClockInterval = setInterval(() => this._updateTVClock(), 1000);
  },

  _updateTVClock() {
    const el = document.querySelector('.tv-clock');
    if (!el) return;
    const now = new Date();
    const mtrT = now.toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
    const mtrD = now.toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const jpT  = now.toLocaleTimeString('fr-CA', { timeZone: 'Asia/Tokyo',     hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
    const jpD  = now.toLocaleDateString('fr-CA', { timeZone: 'Asia/Tokyo',     weekday:'long', day:'numeric', month:'long', year:'numeric' });
    el.innerHTML = `
      <div class="line-mtr"><span class="city"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f1e8-1f1e6.png" class="flag flag-lg" alt="CA"> Montréal</span> <span class="time">${mtrT}</span> <span class="date">${mtrD}</span></div>
      <div class="line-jp"><span class="city"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f1ef-1f1f5.png" class="flag flag-lg" alt="JP"> Tokyo</span> <span class="time">${jpT}</span> <span class="date">${jpD}</span></div>
    `;
  },

  async _refreshTV() {
    const el = document.getElementById('tab-tv');
    try {
      const [statuses, soldes] = await Promise.all([
        Graph.getCurrentStatuses(),
        Graph.getAllSoldes().catch(() => []),
      ]);
      const soldeMap = Object.fromEntries(soldes.map(s => [s.email?.toLowerCase(), s]));
      const enriched = statuses.map(p => ({
        ...p,
        Departement: soldeMap[p.EmployeEmail?.toLowerCase()]?.departement || p.Departement,
      }));
      el.innerHTML   = this._renderTV(enriched);
    } catch (err) {
      el.innerHTML = `<div class="error tv-error">Erreur : ${err.message}</div>`;
    }
  },

  _renderTV(statuses) {
    // Mapper chaque statut à un groupe
    const GROUPES = [
      { id: 'travail',   label: '🏢 Au bureau',      ids: ['bureau', 'teletravail'],                 color: 'var(--success)' },
      { id: 'clients',   label: '🚗 Chez clients',   ids: ['route_bip', 'route_cv247'],              color: '#c084fc' },
      { id: 'formation', label: '📚 Formation',      ids: ['formation'],                              color: 'var(--info)' },
      { id: 'courte',    label: '☕ Pause / RDV',    ids: ['pause', 'diner', 'rdv_perso', 'quart_fini'], color: 'var(--warning)' },
      { id: 'conges',    label: '🏖️ Congés',         ids: ['vacances', 'malade'],                    color: 'var(--danger)' },
    ];

    // Grouper les employés
    const byGroup = {};
    GROUPES.forEach(g => byGroup[g.id] = []);
    for (const p of statuses) {
      const st = CONFIG.STATUTS.find(s => s.label === p.StatutActuel);
      if (!st) continue;
      const groupe = GROUPES.find(g => g.ids.includes(st.id));
      if (groupe) byGroup[groupe.id].push({ ...p, st });
    }

    const totalPresents = byGroup.travail.length + byGroup.clients.length + byGroup.formation.length;
    const totalAbsents  = byGroup.courte.length + byGroup.conges.length;
    const total = totalPresents + totalAbsents;

    setTimeout(() => this._updateTVClock(), 0);

    return `
      <div class="tv-wrap">
        <div class="tv-hdr">
          <div class="tv-logo-wrap">
            <img src="Logo.png" alt="BlackIP360" style="height:50px;width:auto;max-width:220px" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="tv-logo-fallback" style="display:none;align-items:center;gap:14px">
              <div class="tv-logo-box">B</div>
              <div class="tv-logo-txt"><div class="t1">BlackIP360</div><div class="t2">Présences</div></div>
            </div>
          </div>
          <div class="tv-clock"></div>
        </div>

        <div class="tv-totals">
          <div class="col-present"><div class="tv-n">${totalPresents}</div><div class="tv-l">Au travail</div></div>
          <div class="col-clients"><div class="tv-n">${byGroup.clients.length}</div><div class="tv-l">Chez clients</div></div>
          <div class="col-absent"><div class="tv-n">${totalAbsents}</div><div class="tv-l">Absents</div></div>
          <div class="col-total"><div class="tv-n">${total}</div><div class="tv-l">Total</div></div>
        </div>

        ${GROUPES.map(g => byGroup[g.id].length ? `
          <div class="tv-group">
            <h3 class="tv-group-hdr" style="color:${g.color}">${g.label} (${byGroup[g.id].length})</h3>
            <div class="tv-grid">
              ${byGroup[g.id].map(p => {
                const initials = (p.EmployeNom || '?').split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase();
                return `
                  <div class="tv-card" style="border-top-color:${g.color}">
                    <div class="tv-card-top">
                      <div class="tv-avatar">${initials}</div>
                      <div class="tv-name-wrap">
                        <div class="tv-name">${p.EmployeNom || '—'}</div>
                        <div class="tv-dept">${p.Departement || ''}</div>
                      </div>
                    </div>
                    <div class="tv-statut-pill">${p.st.icon} ${p.StatutActuel}</div>
                    <div class="tv-time">Depuis ${this._fmtTime(p.HeurePointage)}</div>
                  </div>`;
              }).join('')}
            </div>
          </div>
        ` : '').join('')}
      </div>`;
  },

  _renderTVCard(p) {
    const st = CONFIG.STATUTS.find(s => s.label === p.StatutActuel);
    return `
      <div class="tv-card" style="border-color:${st?.color || '#444'}">
        <div class="tv-icon">${st?.icon || '❓'}</div>
        <div class="tv-name">${p.EmployeNom || p.EmployeEmail}</div>
        <div class="tv-statut" style="color:${st?.color || '#aaa'}">${p.StatutActuel}</div>
        <div class="tv-time">${this._fmtTime(p.HeurePointage)}</div>
      </div>`;
  },

  // ── PAYE ──────────────────────────────────────────────────────────────────
  _loadPaye() {
    const el = document.getElementById('tab-paye');
    const now = new Date();
    const fmt = d => d.toISOString().slice(0, 10);

    // Presets de période
    const today = new Date(now);
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

    el.innerHTML = `
      <div class="paye-header">
        <div class="paye-title">
          <h2>💰 Rapport de paie</h2>
          <div class="sub">Consultez les heures travaillées et les congés par employé</div>
        </div>
        <div class="paye-actions">
          <button class="btn-primary" id="payeExport">⬇ Exporter CSV</button>
          <button class="btn-secondary" id="payePrint">🖨 Imprimer</button>
        </div>
      </div>

      <div class="paye-presets">
        <button class="preset-btn" data-preset="today">Aujourd'hui</button>
        <button class="preset-btn active" data-preset="week">Cette semaine</button>
        <button class="preset-btn" data-preset="lastweek">Semaine dernière</button>
        <button class="preset-btn" data-preset="2weeks">2 dernières semaines</button>
        <button class="preset-btn" data-preset="month">Ce mois</button>
        <button class="preset-btn" data-preset="lastmonth">Mois dernier</button>
        <button class="preset-btn" data-preset="year">Cette année</button>
      </div>

      <div class="paye-filters">
        <div class="field">
          <label>📅 Du</label>
          <input type="date" id="payeDateFrom" value="${fmt(monday)}">
        </div>
        <div class="field">
          <label>📅 Au</label>
          <input type="date" id="payeDateTo" value="${fmt(sunday)}">
        </div>
        <div class="field">
          <label>Département</label>
          <select id="payeDept">
            ${CONFIG.DEPARTEMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>🔍 Rechercher</label>
          <input type="text" id="payeSearch" placeholder="Nom ou email…">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn-primary" id="payeCalc">Générer</button>
        </div>
      </div>

      <div id="payeResult"></div>
    `;

    document.getElementById('payeCalc').onclick   = () => this._computePaye();
    document.getElementById('payeExport').onclick = () => this.exportPayeCSV();
    document.getElementById('payePrint').onclick  = () => window.print();
    document.getElementById('payeSearch').oninput = () => this._filterPayeRows();
    document.getElementById('payeDept').onchange  = () => this._computePaye();

    el.querySelectorAll('.preset-btn').forEach(btn => {
      btn.onclick = () => {
        const preset = btn.dataset.preset;
        let from, to;
        const n = new Date();
        if (preset === 'today') {
          from = new Date(n); to = new Date(n);
        } else if (preset === 'week') {
          from = new Date(n); from.setDate(n.getDate() - ((n.getDay() + 6) % 7));
          to = new Date(from); to.setDate(from.getDate() + 6);
        } else if (preset === 'lastweek') {
          from = new Date(n); from.setDate(n.getDate() - ((n.getDay() + 6) % 7) - 7);
          to = new Date(from); to.setDate(from.getDate() + 6);
        } else if (preset === '2weeks') {
          to = new Date(n);
          from = new Date(n); from.setDate(n.getDate() - 13);
        } else if (preset === 'month') {
          from = new Date(n.getFullYear(), n.getMonth(), 1);
          to   = new Date(n.getFullYear(), n.getMonth() + 1, 0);
        } else if (preset === 'lastmonth') {
          from = new Date(n.getFullYear(), n.getMonth() - 1, 1);
          to   = new Date(n.getFullYear(), n.getMonth(), 0);
        } else if (preset === 'year') {
          from = new Date(n.getFullYear(), 0, 1);
          to   = new Date(n.getFullYear(), 11, 31);
        }
        document.getElementById('payeDateFrom').value = fmt(from);
        document.getElementById('payeDateTo').value   = fmt(to);
        el.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._computePaye();
      };
    });

    // Calendriers Flatpickr + auto-deselect des presets au changement manuel
    const onDateChange = () => {
      el.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      this._computePaye();
    };
    this._initDatePicker('payeDateFrom', onDateChange);
    this._initDatePicker('payeDateTo',   onDateChange);

    this._computePaye();
  },

  async _computePaye() {
    const result = document.getElementById('payeResult');
    result.innerHTML = '<div class="loading">Calcul en cours…</div>';

    const fromStr = document.getElementById('payeDateFrom').value;
    const toStr   = document.getElementById('payeDateTo').value;
    const dept    = document.getElementById('payeDept').value;
    const from = new Date(fromStr + 'T00:00:00');
    const to   = new Date(toStr   + 'T23:59:59');

    try {
      const [all, soldes, allDemandes] = await Promise.all([
        Graph.getAllPresences(),
        Graph.getAllSoldes().catch(() => []),
        Graph.getAllDemandes().catch(() => []),
      ]);
      const soldeMap = Object.fromEntries(soldes.map(s => [s.email?.toLowerCase(), s]));

      const filtered = all.filter(p => {
        if (!p.HeurePointage) return false;
        const d = new Date(p.HeurePointage);
        if (d < from || d > to) return false;
        // Dept via soldes (source de vérité)
        const effDept = soldeMap[p.EmployeEmail?.toLowerCase()]?.departement || p.Departement;
        if (dept !== 'Tous' && effDept !== dept) return false;
        return true;
      });

      // Grouper par employé
      const byEmp = {};
      for (const p of filtered) {
        const k = p.EmployeEmail || 'inconnu';
        if (!byEmp[k]) {
          const s = soldeMap[k.toLowerCase()] || {};
          byEmp[k] = { nom: p.EmployeNom, email: k, dept: s.departement || p.Departement, entries: [] };
        }
        byEmp[k].entries.push(p);
      }

      // Ajouter aussi les employés qui ont un solde mais pas de pointage dans la période (s'ils matchent le dept)
      for (const s of soldes) {
        const k = s.email;
        if (k && !byEmp[k]) {
          if (dept !== 'Tous' && s.departement !== dept) continue;
          byEmp[k] = { nom: s.nom, email: k, dept: s.departement, entries: [] };
        }
      }

      this._payeData = byEmp;

      // Jours de la période
      const days = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days.push(new Date(d));
      const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

      // Calculer par employé
      const rows = Object.values(byEmp).map(emp => {
        const byDay = {};
        for (const e of emp.entries) {
          const k = e.HeurePointage.slice(0, 10);
          if (!byDay[k]) byDay[k] = [];
          byDay[k].push(e);
        }
        const dayStates = days.map(d => {
          const key = d.toISOString().slice(0, 10);
          const entries = byDay[key] || [];
          const hasPresent = entries.some(e => CONFIG.STATUTS.find(s => s.label === e.StatutActuel)?.category === 'present');
          const hasAbsent  = entries.some(e => CONFIG.STATUTS.find(s => s.label === e.StatutActuel)?.category === 'absent');
          if (isWeekend(d) && !hasPresent) return { type: 'weekend', hours: 0 };
          const hours = this._calculateDayHours(entries);
          if (hasPresent) return { type: 'present', hours };
          if (hasAbsent)  return { type: 'absent',  hours: 0 };
          return { type: 'none', hours: 0 };
        });
        const total = Math.round(dayStates.reduce((s, x) => s + x.hours, 0) * 10) / 10;

        // Congés pris dans la période (approuvés)
        const congesApprouves = allDemandes.filter(d =>
          d.EmployeEmail?.toLowerCase() === emp.email.toLowerCase() &&
          d.Statut === 'Approuvée' &&
          new Date(d.DateFin) >= from &&
          new Date(d.DateDebut) <= to
        );
        const hVacPrises = congesApprouves.filter(d => d.TypeConge === 'Vacances').reduce((s, d) => s + (d.NombreHeures || 0), 0);
        const hMalPrises = congesApprouves.filter(d => d.TypeConge === 'Maladie').reduce((s, d) => s + (d.NombreHeures || 0), 0);

        const solde = soldeMap[emp.email.toLowerCase()] || { vacances: 0, maladie: 0 };

        return { emp, dayStates, total, hVacPrises, hMalPrises, soldeVac: solde.vacances, soldeMal: solde.maladie };
      }).sort((a, b) => (a.emp.nom || '').localeCompare(b.emp.nom || ''));

      // Résumé global
      const totalEmployes = rows.filter(r => r.total > 0).length;
      const totalJours = rows.reduce((s, r) => s + r.dayStates.filter(x => x.type === 'present').length, 0);
      const totalHeures = rows.reduce((s, r) => s + r.total, 0);
      const totalCongesPris = rows.reduce((s, r) => s + r.hVacPrises + r.hMalPrises, 0);

      // Header dates (pour la table)
      const dayHeaders = days.map(d => {
        const ws = d.toLocaleDateString('fr-CA', { weekday: 'short' }).replace('.', '');
        const num = d.getDate();
        return `<th class="day${isWeekend(d) ? ' day-we' : ''}"><div class="dh-ws">${ws}</div><div class="dh-num">${num}</div></th>`;
      }).join('');

      const rowsHTML = rows.map(r => {
        const initials = (r.emp.nom || '?').split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase();
        const pills = r.dayStates.map(s => {
          const cls = 'day-pill day-' + s.type;
          let txt;
          if (s.type === 'present') txt = s.hours > 0 ? (s.hours % 1 === 0 ? String(s.hours) : s.hours.toFixed(1)) : '…';
          else if (s.type === 'absent')  txt = '·';
          else if (s.type === 'weekend') txt = '';
          else txt = '—';
          return `<td class="day${s.type === 'weekend' ? ' day-we' : ''}"><span class="${cls}">${txt}</span></td>`;
        }).join('');
        return `
          <tr data-search="${(r.emp.nom + ' ' + r.emp.email).toLowerCase()}">
            <td class="emp-cell">
              <div class="emp-avatar">${initials}</div>
              <div>
                <div class="emp-nom">${r.emp.nom || '—'}</div>
                <div class="emp-dept muted">${r.emp.dept || '—'}</div>
              </div>
            </td>
            ${pills}
            <td class="day tot-cell">${r.total}<span class="muted" style="font-size:.72rem"> h</span></td>
            <td class="day conge-cell">
              <div class="conge-pris" title="Vacances prises">${r.hVacPrises}h</div>
              <div class="conge-reste muted" title="Solde restant">reste ${r.soldeVac}h</div>
            </td>
            <td class="day conge-cell">
              <div class="conge-pris" title="Maladie prises">${r.hMalPrises}h</div>
              <div class="conge-reste muted" title="Solde restant">reste ${r.soldeMal}h</div>
            </td>
          </tr>`;
      }).join('');

      // Totaux par jour
      const totByDay = days.map((_, i) => rows.reduce((s, r) => s + r.dayStates[i].hours, 0));
      const grandTotal = totByDay.reduce((a,b) => a+b, 0);

      result.innerHTML = `
        <div class="stat-row" style="margin-bottom:20px">
          <div class="stat-card blue"><div class="stat-l">Employés actifs</div><div class="stat-n">${totalEmployes}</div></div>
          <div class="stat-card green"><div class="stat-l">Jours travaillés</div><div class="stat-n">${totalJours}</div></div>
          <div class="stat-card yellow"><div class="stat-l">Heures totales</div><div class="stat-n">${totalHeures}</div></div>
          <div class="stat-card purple"><div class="stat-l">Congés pris (h)</div><div class="stat-n">${totalCongesPris}</div></div>
        </div>

        <div class="table-wrap paye-table-wrap">
          <table class="paye-table">
            <thead>
              <tr>
                <th class="emp-col">Employé</th>
                ${dayHeaders}
                <th class="day">Total</th>
                <th class="day">🌴 Vac.</th>
                <th class="day">🤒 Mal.</th>
              </tr>
            </thead>
            <tbody id="payeTbody">
              ${rowsHTML || `<tr><td colspan="${days.length + 4}" class="muted" style="text-align:center;padding:40px">Aucune donnée pour cette période.</td></tr>`}
            </tbody>
            <tfoot>
              <tr>
                <td class="emp-col"><strong>TOTAL</strong></td>
                ${totByDay.map((t, i) => `<td class="day${isWeekend(days[i]) ? ' day-we' : ''}">${t || ''}</td>`).join('')}
                <td class="day tot-cell">${grandTotal} h</td>
                <td class="day"></td>
                <td class="day"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="paye-legend">
          <span><span class="day-pill day-present">7.5</span> Heures travaillées</span>
          <span><span class="day-pill day-present">…</span> Journée en cours (pas fermée)</span>
          <span><span class="day-pill day-absent">·</span> Absent</span>
          <span><span class="day-pill day-none">—</span> Aucune donnée</span>
          <span><span class="day-pill day-weekend"></span> Fin de semaine</span>
        </div>
      `;
    } catch (err) {
      result.innerHTML = `<div class="error">Erreur : ${err.message}</div>`;
    }
  },

  _filterPayeRows() {
    const q = document.getElementById('payeSearch')?.value.toLowerCase().trim() || '';
    document.querySelectorAll('#payeTbody tr').forEach(tr => {
      tr.style.display = !q || (tr.dataset.search || '').includes(q) ? '' : 'none';
    });
  },

  exportPayeCSV() {
    if (!this._payeData) return this.showToast('Générez d\'abord le rapport.', 'error');
    const fromStr = document.getElementById('payeDateFrom').value;
    const toStr   = document.getElementById('payeDateTo').value;
    const from = new Date(fromStr + 'T00:00:00');
    const to   = new Date(toStr + 'T23:59:59');
    const days = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    const dayLabels = days.map(d => d.toLocaleDateString('fr-CA', { day: '2-digit', month: '2-digit' }));
    const rows = [['Employé', 'Email', 'Département', ...dayLabels, 'Total']];
    for (const emp of Object.values(this._payeData)) {
      const byDay = {};
      for (const e of emp.entries) {
        const k = e.HeurePointage.slice(0, 10);
        if (!byDay[k]) byDay[k] = [];
        byDay[k].push(e);
      }
      const dayHours = days.map(d => {
        const key = d.toISOString().slice(0, 10);
        const entries = byDay[key] || [];
        return this._calculateDayHours(entries);
      });
      const total = Math.round(dayHours.reduce((a,b) => a+b, 0) * 10) / 10;
      rows.push([emp.nom, emp.email, emp.dept, ...dayHours, total]);
    }
    this._downloadCSV(rows, `paye_${fromStr}_${toStr}.csv`);
  },

  // ── ACCÈS ─────────────────────────────────────────────────────────────────
  async _loadAcces() {
    document.getElementById('tab-acces').innerHTML = `
      <div class="acces-wrap" style="max-width:1200px">
        <h2>🔑 Gestion des accès</h2>

        ${this.isAdmin ? `
          <div class="acces-card">
            <h3>👥 Gestion des utilisateurs</h3>
            <p class="muted" style="margin-bottom:14px;font-size:.85rem">
              Assigner un département et gérer les soldes de congés pour chaque employé.
              Les employés apparaissent automatiquement dès leur premier pointage.
            </p>
            <div id="accesSoldesWrap"><div class="loading">Chargement…</div></div>
          </div>

          <div class="acces-card">
            <h3>📚 Documentation</h3>
            <p class="muted" style="margin-bottom:14px;font-size:.85rem">
              Consultez le guide d'administration complet pour la configuration, l'ajout d'utilisateurs, les statuts et les départements.
            </p>
            <div class="link-row">
              <a class="ext-link" href="GUIDE_ADMIN.html" target="_blank">📄 Ouvrir le guide admin (HTML)</a>
              <a class="ext-link" href="GUIDE_ADMIN.html" target="_blank" onclick="setTimeout(()=>window.print(),500)">🖨 Imprimer en PDF</a>
            </div>
          </div>
        ` : `
          <div class="acces-card">
            <p class="muted">Cette section est réservée aux administrateurs.</p>
          </div>
        `}
      </div>`;

    if (this.isAdmin) {
      const newWrap = document.getElementById('accesSoldesWrap');
      if (newWrap) {
        newWrap.id = 'soldesAdminWrap';
        await this._renderSoldesAdmin();
        newWrap.id = 'accesSoldesWrap';
      }
    }
  },

  // ── Utilitaires ───────────────────────────────────────────────────────────
  _fmtTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  },

  _fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('fr-CA', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },

  _today() { return new Date().toISOString().slice(0, 10); },

  _downloadCSV(rows, filename) {
    const csv  = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a    = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: filename,
    });
    a.click();
  },

  showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = `toast show ${type}`;
    setTimeout(() => t.classList.remove('show'), 3500);
  },

  _startClock() {
    const el = document.getElementById('hdrClock');
    if (!el) return;
    const pad = n => String(n).padStart(2, '0');
    const tick = () => {
      const now = new Date();
      const mtrT = now.toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
      const mtrD = now.toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', weekday:'short', day:'numeric', month:'short' });
      const jpT  = now.toLocaleTimeString('fr-CA', { timeZone: 'Asia/Tokyo',     hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
      const jpD  = now.toLocaleDateString('fr-CA', { timeZone: 'Asia/Tokyo',     weekday:'short', day:'numeric', month:'short' });
      el.innerHTML = `
        <div class="mtr"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f1e8-1f1e6.png" class="flag" alt="CA"> Montréal · <b>${mtrT}</b> · ${mtrD}</div>
        <div class="jp"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f1ef-1f1f5.png" class="flag" alt="JP"> Tokyo · <b>${jpT}</b> · ${jpD}</div>
      `;
    };
    tick();
    if (this._clockInterval) clearInterval(this._clockInterval);
    this._clockInterval = setInterval(tick, 1000);
  },

  _fatalError(msg) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#0078d4;color:white">
        <div style="background:white;color:#333;padding:40px;border-radius:12px;max-width:480px;text-align:center">
          <h2 style="color:#c53030">Erreur critique</h2>
          <p style="margin-top:12px">${msg}</p>
        </div>
      </div>`;
  },
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init();

  document.getElementById('loginBtn')?.addEventListener('click', async () => {
    try {
      await Auth.login();
      await App._onLoginSuccess();
    } catch (err) {
      App.showToast('Erreur de connexion : ' + err.message, 'error');
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await Auth.logout();
    location.reload();
  });

  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => App.switchTab(btn.dataset.tab))
  );
});
