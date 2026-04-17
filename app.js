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
    const dbg = document.getElementById('loginError');
    const step = (msg) => { if (dbg) { dbg.hidden = false; dbg.textContent = '⏳ ' + msg; } console.log('[APP]', msg); };

    step('Démarrage...');
    try {
      step('Auth.init() en cours...');
      await Auth.init();
      step(`Auth.init() terminé — connecté: ${Auth.isLoggedIn()} — erreur: ${Auth.initError?.errorCode || 'non'}`);

      this._msalAccounts = Auth.msal?.getAllAccounts()?.map(a => a.username) || [];

      if (Auth.isLoggedIn()) {
        step('Connecté ! Chargement de l\'application...');
        await this._onLoginSuccess();
      } else {
        this._showDebug();
      }
    } catch (err) {
      if (dbg) { dbg.hidden = false; dbg.style.background = '#fff0f0'; dbg.textContent = '❌ ERREUR JS: ' + err.message; }
      console.error('[APP] init error:', err);
      this._fatalError('Erreur d\'initialisation: ' + err.message);
    }
  },

  _showLoginError(html) {
    const el = document.getElementById('loginError');
    if (el) { el.innerHTML = html; el.hidden = false; }
  },

  _showDebug() {
    const params  = Object.fromEntries(new URLSearchParams(window.location.search));
    const hash    = window.location.hash;
    const lsAll   = Object.keys(localStorage);
    const ssAll   = Object.keys(sessionStorage);
    const errInfo = Auth.initError
      ? `${Auth.initError.errorCode}: ${Auth.initError.errorMessage}`
      : '(aucune)';
    const el = document.getElementById('loginError');
    if (!el) return;
    el.hidden = false;
    el.style.textAlign = 'left';
    el.innerHTML = `
      <strong>Debug MSAL — copiez ce bloc</strong><br><br>
      Erreur init: <code>${errInfo}</code><br>
      URL params: <code>${JSON.stringify(params)}</code><br>
      Hash: <code>${hash || '(vide)'}</code><br>
      Comptes MSAL: <code>${JSON.stringify(this._msalAccounts)}</code><br>
      localStorage (${lsAll.length} clés): <code style="word-break:break-all">${lsAll.join(' | ') || '(vide)'}</code><br>
      sessionStorage (${ssAll.length} clés): <code style="word-break:break-all">${ssAll.join(' | ') || '(vide)'}</code><br>
      Cookies activés: <code>${navigator.cookieEnabled}</code>
    `;
  },

  async _onLoginSuccess() {
    this.user = Auth.getUser();
    console.log('[APP] _onLoginSuccess user:', this.user);

    try {
      const profile        = await Graph.getProfile();
      this.user.department = profile.department  || 'Non défini';
      this.user.jobTitle   = profile.jobTitle    || '';
      this.user.email      = profile.mail        || this.user.email;
      this.user.name       = profile.displayName || this.user.name;
      console.log('[APP] profil Graph OK:', this.user.name);
    } catch (err) {
      this.user.department = 'Non défini';
      console.warn('[APP] Graph.getProfile() échec:', err.message);
    }

    this._checkAdmin();
    this._showApp();
    this._renderHeader();

    await this.loadTab('statut');
  },

  _checkAdmin() {
    // Admins : département Direction ou liste explicite
    const adminEmails = ['admin@blackip360.com', 'tech@blackip360.com', 'tfournier@blackip360.com', 'sstemarie@blackip360.com'];
    this.isAdmin =
      adminEmails.includes(this.user.email?.toLowerCase()) ||
      this.user.department === 'Direction';

    document.querySelectorAll('[data-admin]').forEach(el => {
      el.style.display = this.isAdmin ? '' : 'none';
    });
  },

  _showApp() {
    const ls = document.getElementById('loginScreen');
    if (ls) { ls.hidden = true; ls.style.display = 'none'; }
    const app = document.getElementById('app');
    if (app) { app.hidden = false; app.style.display = ''; }
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

        ${history.length ? `
          <h3>Historique récent</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date / Heure</th><th>Statut</th><th>Note</th></tr></thead>
              <tbody>
                ${history.slice(0, 15).map(p => `
                  <tr>
                    <td>${this._fmtDateTime(p.HeurePointage)}</td>
                    <td>${p.StatutActuel}</td>
                    <td>${p.Notes || ''}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
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
            <h3>📋 Mes demandes récentes</h3>
            <div id="demMesListe">
              ${this._renderDemandesListe(mesDemandes, false)}
            </div>
          </div>
        </div>

        ${this.isAdmin ? `
          <h2 style="margin-top:28px">👥 Gestion des demandes — Admin</h2>
          <div class="dem-list-card">
            <h3>⏳ Demandes en attente (${attente.length})</h3>
            <div id="demAdminListe">
              ${this._renderDemandesListe(attente, true)}
            </div>
          </div>

          <div class="dem-list-card" style="margin-top:16px">
            <h3>📜 Historique de toutes les demandes</h3>
            <div id="demAdminHistorique">
              ${this._renderDemandesListe(toutesDemandes.filter(d => d.Statut !== 'En attente'), false)}
            </div>
          </div>

          <h2 style="margin-top:28px">💰 Gestion des soldes</h2>
          <div class="dem-list-card">
            <h3>Modifier les soldes de vacances et de maladie</h3>
            <div id="soldesAdminWrap"><div class="loading">Chargement…</div></div>
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
        this._renderSoldesAdmin();
      }
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
            email: dem.EmployeEmail,
            nom: dem.EmployeNom || solde.nom,
            vacances: newVac,
            maladie: newMal,
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

      // Construire la liste unique d'employés depuis les présences
      const empMap = {};
      for (const p of allPresences) {
        const k = p.EmployeEmail?.toLowerCase();
        if (k && !empMap[k]) {
          empMap[k] = { email: p.EmployeEmail, nom: p.EmployeNom || p.EmployeEmail };
        }
      }
      // Ajouter aussi ceux qui ont un solde mais pas de présence
      for (const s of allSoldes) {
        const k = s.email?.toLowerCase();
        if (k && !empMap[k]) {
          empMap[k] = { email: s.email, nom: s.nom || s.email };
        }
      }

      const soldeMap = Object.fromEntries(allSoldes.map(s => [s.email?.toLowerCase(), s]));
      const rows = Object.values(empMap).map(e => ({
        email:    e.email,
        nom:      e.nom,
        vacances: soldeMap[e.email.toLowerCase()]?.vacances || 0,
        maladie:  soldeMap[e.email.toLowerCase()]?.maladie  || 0,
      })).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));

      const inpStyle = 'width:100px;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--mono);font-size:.88rem';

      wrap.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employé</th>
                <th>🌴 Vacances (h)</th>
                <th>🤒 Maladie (h)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(emp => `
                <tr data-email="${emp.email}" data-nom="${(emp.nom || '').replace(/"/g, '&quot;')}">
                  <td>
                    <strong>${emp.nom}</strong><br>
                    <span class="muted" style="font-size:.75rem">${emp.email}</span>
                  </td>
                  <td><input type="number" class="solde-vac" value="${emp.vacances}" step="0.5" min="0" style="${inpStyle}"></td>
                  <td><input type="number" class="solde-mal" value="${emp.maladie}"  step="0.5" min="0" style="${inpStyle}"></td>
                  <td><button class="btn-primary solde-save">💾 Enregistrer</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      wrap.querySelectorAll('.solde-save').forEach(btn => {
        btn.onclick = async () => {
          const tr = btn.closest('tr');
          const email    = tr.dataset.email;
          const nom      = tr.dataset.nom;
          const vacances = parseFloat(tr.querySelector('.solde-vac').value) || 0;
          const maladie  = parseFloat(tr.querySelector('.solde-mal').value) || 0;
          btn.disabled = true;
          const orig = btn.textContent;
          btn.textContent = '⏳';
          try {
            await Graph.upsertSolde({ email, nom, vacances, maladie });
            btn.textContent = '✓ Sauvé';
            this.showToast('Solde mis à jour', 'success');
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

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  async _loadAdmin() {
    const el = document.getElementById('tab-admin');
    el.innerHTML = '<div class="loading">Chargement des présences…</div>';
    try {
      this.currentStatuses = await Graph.getCurrentStatuses();
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
    const wrap = document.querySelector('#tab-tv .tv-clock');
    if (!wrap) return;
    const now = new Date();
    const est = now.toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).replace(/^(\d+):(\d+):(\d+)$/, '$1 h $2 min $3 s');
    const jp  = now.toLocaleTimeString('fr-CA', { timeZone: 'Asia/Tokyo', hour:'2-digit', minute:'2-digit', hour12:false });
    const dt  = now.toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const estEl = wrap.querySelector('.time-est');
    const dEl   = wrap.querySelector('.date');
    const jpEl  = wrap.querySelector('.time-jp');
    if (estEl) estEl.textContent = est;
    if (dEl)   dEl.textContent = dt + ' • EST';
    if (jpEl)  jpEl.textContent = '🇯🇵 Tokyo ' + jp;
  },

  async _refreshTV() {
    const el = document.getElementById('tab-tv');
    try {
      const statuses = await Graph.getCurrentStatuses();
      el.innerHTML   = this._renderTV(statuses);
    } catch (err) {
      el.innerHTML = `<div class="error tv-error">Erreur : ${err.message}</div>`;
    }
  },

  _renderTV(statuses) {
    const presents = statuses.filter(p => CONFIG.STATUTS.find(s => s.label === p.StatutActuel)?.category === 'present');
    const absents  = statuses.filter(p => CONFIG.STATUTS.find(s => s.label === p.StatutActuel)?.category === 'absent');

    const tvClockHtml = `
          <div class="tv-clock">
            <div class="time-est">--</div>
            <div class="date">—</div>
            <div class="time-jp">🇯🇵 Tokyo --:--</div>
          </div>`;

    setTimeout(() => this._updateTVClock(), 0);

    return `
      <div class="tv-wrap">
        <div class="tv-hdr">
          <span class="tv-logo">BlackIP360</span>
          ${tvClockHtml}
          <span class="tv-totals">${presents.length} présents · ${absents.length} absents · ${statuses.length} total</span>
        </div>

        <div class="tv-cols">
          <div class="tv-col">
            <div class="tv-col-hdr present-hdr">✅ Au travail (${presents.length})</div>
            <div class="tv-grid">${presents.map(p => this._renderTVCard(p)).join('')}</div>
          </div>
          <div class="tv-col">
            <div class="tv-col-hdr absent-hdr">🔴 Absents (${absents.length})</div>
            <div class="tv-grid">${absents.map(p => this._renderTVCard(p)).join('')}</div>
          </div>
        </div>

        <div class="tv-ftr">Actualisation automatique toutes les ${CONFIG.TV_REFRESH_MS / 1000} s</div>
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
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = d => d.toISOString().slice(0, 10);

    el.innerHTML = `
      <div class="paye-header">
        <div class="paye-title">
          <h2>💰 Rapport de paie</h2>
          <div class="sub">Générez les données de paie pour la période choisie</div>
        </div>
        <div class="paye-actions">
          <button class="btn-primary" id="payeExport">⬇ Exporter CSV</button>
          <button class="btn-secondary" id="payePrint">🖨 Imprimer</button>
        </div>
      </div>

      <div class="paye-filters">
        <div class="field">
          <label>Du</label>
          <input type="date" id="payeDateFrom" value="${fmt(monday)}">
        </div>
        <div class="field">
          <label>Au</label>
          <input type="date" id="payeDateTo" value="${fmt(sunday)}">
        </div>
        <div class="field">
          <label>Département</label>
          <select id="payeDept">
            ${CONFIG.DEPARTEMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Action</label>
          <button class="btn-primary" id="payeCalc">Générer le rapport</button>
        </div>
      </div>

      <div id="payeResult"></div>
    `;

    document.getElementById('payeCalc').onclick   = () => this._computePaye();
    document.getElementById('payeExport').onclick = () => this.exportPayeCSV();
    document.getElementById('payePrint').onclick = () => window.print();

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
      const all = await Graph.getAllPresences();
      const filtered = all.filter(p => {
        if (!p.HeurePointage) return false;
        const d = new Date(p.HeurePointage);
        if (d < from || d > to) return false;
        if (dept !== 'Tous' && p.Departement !== dept) return false;
        return true;
      });

      const byEmp = {};
      for (const p of filtered) {
        const k = p.EmployeEmail || 'inconnu';
        if (!byEmp[k]) byEmp[k] = { nom: p.EmployeNom, email: k, dept: p.Departement, entries: [] };
        byEmp[k].entries.push(p);
      }
      this._payeData = byEmp;

      // Générer colonnes pour chaque jour de la période
      const days = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
      }
      const dayLabels = days.map(d => d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric' }));

      // Calculer les heures par employé par jour
      const rows = Object.values(byEmp).map(emp => {
        const byDay = {};
        for (const e of emp.entries) {
          const dateKey = e.HeurePointage.slice(0, 10);
          if (!byDay[dateKey]) byDay[dateKey] = [];
          byDay[dateKey].push(e);
        }
        const dayHours = days.map(d => {
          const key = d.toISOString().slice(0, 10);
          const entries = byDay[key] || [];
          const hasPresent = entries.some(e => CONFIG.STATUTS.find(s => s.label === e.StatutActuel)?.category === 'present');
          return hasPresent ? 8 : 0;
        });
        const total = dayHours.reduce((a,b) => a+b, 0);
        return { emp, dayHours, total };
      });

      rows.sort((a, b) => (a.emp.nom || '').localeCompare(b.emp.nom || ''));

      // Totaux par jour
      const totByDay = days.map((_, i) => rows.reduce((s, r) => s + r.dayHours[i], 0));
      const grandTotal = totByDay.reduce((a,b) => a+b, 0);

      const soldes = await Graph.getAllSoldes();
      const soldeMap = Object.fromEntries(soldes.map(s => [s.email?.toLowerCase(), s]));

      result.innerHTML = `
        <div class="table-wrap">
          <table class="paye-table">
            <thead>
              <tr>
                <th>Employé</th><th>Dept</th>
                ${dayLabels.map(l => `<th class="day">${l}</th>`).join('')}
                <th class="day">Total</th>
                <th class="day">🌴 Vac.</th>
                <th class="day">🤒 Mal.</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const so = soldeMap[r.emp.email?.toLowerCase()] || { vacances: 0, maladie: 0 };
                return `
                <tr>
                  <td><strong>${r.emp.nom || '—'}</strong><br><span class="muted" style="font-size:.75rem">${r.emp.email}</span></td>
                  <td>${r.emp.dept || '—'}</td>
                  ${r.dayHours.map(h => `<td class="day">${h || 0}</td>`).join('')}
                  <td class="day tot-cell">${r.total}</td>
                  <td class="day">${so.vacances} h</td>
                  <td class="day">${so.maladie} h</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td>TOTAL</td><td></td>
                ${totByDay.map(t => `<td class="day">${t}</td>`).join('')}
                <td class="day">${grandTotal} h</td>
                <td></td><td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    } catch (err) {
      result.innerHTML = `<div class="error">Erreur : ${err.message}</div>`;
    }
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
        const hasPresent = entries.some(e => CONFIG.STATUTS.find(s => s.label === e.StatutActuel)?.category === 'present');
        return hasPresent ? 8 : 0;
      });
      const total = dayHours.reduce((a,b) => a+b, 0);
      rows.push([emp.nom, emp.email, emp.dept, ...dayHours, total]);
    }
    this._downloadCSV(rows, `paye_${fromStr}_${toStr}.csv`);
  },

  // ── ACCÈS ─────────────────────────────────────────────────────────────────
  _loadAcces() {
    const configOk = id => id && id !== 'VOTRE_CLIENT_ID' && id !== 'VOTRE_TENANT_ID';
    const sp = `https://${CONFIG.SHAREPOINT_HOST}${CONFIG.SHAREPOINT_SITE_PATH}`;

    document.getElementById('tab-acces').innerHTML = `
      <div class="acces-wrap" style="max-width:860px">

        <h2>Configuration &amp; Guide d'administration</h2>

        <!-- État actuel -->
        <div class="acces-card">
          <h3>État de la configuration</h3>
          <table>
            <tr><td>Client ID Azure AD</td><td><code>${CONFIG.CLIENT_ID}</code></td></tr>
            <tr><td>Tenant ID</td>         <td><code>${CONFIG.TENANT_ID}</code></td></tr>
            <tr><td>Site SharePoint</td>   <td><code>${CONFIG.SHAREPOINT_HOST}${CONFIG.SHAREPOINT_SITE_PATH}</code></td></tr>
            <tr><td>Liste</td>             <td><code>${CONFIG.SHAREPOINT_LIST}</code></td></tr>
            <tr><td>URL de l'app</td>      <td><code>${CONFIG.APP_URL}</code></td></tr>
            <tr><td>Utilisateur connecté</td><td><code>${this.user?.email || '—'}</code></td></tr>
            <tr><td>Accès admin</td>       <td>${this.isAdmin ? '✅ Oui' : '❌ Non'}</td></tr>
          </table>
        </div>

        <!-- Checklist déploiement -->
        <div class="acces-card">
          <h3>Checklist de déploiement</h3>
          <ol class="checklist">
            <li class="${configOk(CONFIG.CLIENT_ID) ? 'done' : 'todo'}">App Azure AD enregistrée (CLIENT_ID dans config.js)</li>
            <li class="done">Permissions Graph API accordées (User.Read + Sites.ReadWrite.All)</li>
            <li class="done">Liste SharePoint <code>${CONFIG.SHAREPOINT_LIST}</code> créée avec les bonnes colonnes</li>
            <li class="${CONFIG.APP_URL.includes('YOUR_GITHUB') ? 'todo' : 'done'}">GitHub Pages déployé — <code>${CONFIG.APP_URL}</code></li>
            <li class="todo">Manifest Teams mis à jour et déployé (onglet dans Teams)</li>
          </ol>
        </div>

        <!-- Ajouter un utilisateur -->
        <div class="acces-card">
          <h3>➕ Ajouter un utilisateur</h3>
          <p style="font-size:.9rem;line-height:1.7;margin-bottom:12px">
            <strong>Aucune configuration requise.</strong> Tout employé avec un compte <code>@blackip360.com</code> dans Azure AD peut se connecter automatiquement.
          </p>
          <p style="font-size:.9rem;line-height:1.7">
            Leur premier pointage crée automatiquement leur entrée dans la liste SharePoint.
          </p>
        </div>

        <!-- Accès admin -->
        <div class="acces-card">
          <h3>🔑 Donner l'accès administrateur</h3>
          <p style="font-size:.9rem;line-height:1.7;margin-bottom:12px">
            Deux façons de rendre un utilisateur admin :
          </p>
          <ol style="font-size:.9rem;line-height:2;padding-left:20px">
            <li>
              <strong>Par email (immédiat)</strong> — Ajouter l'adresse dans <code>app.js</code>, fonction <code>_checkAdmin()</code> :
              <br><code>const adminEmails = ['admin@blackip360.com', 'tech@blackip360.com', 'tfournier@blackip360.com', 'nouveau@blackip360.com'];</code>
            </li>
            <li>
              <strong>Par département Azure AD</strong> — Définir le département de l'utilisateur à <code>Direction</code> dans Azure AD (portail Azure → Utilisateurs → Profil).
              La détection est automatique à la prochaine connexion.
            </li>
          </ol>
        </div>

        <!-- Statuts -->
        <div class="acces-card">
          <h3>🎨 Modifier les statuts</h3>
          <p style="font-size:.9rem;line-height:1.7;margin-bottom:12px">
            Les statuts sont définis dans <code>config.js</code>, tableau <code>STATUTS</code>. Chaque statut a :
          </p>
          <table>
            <thead><tr><th>Propriété</th><th>Description</th><th>Exemple</th></tr></thead>
            <tbody>
              <tr><td><code>id</code></td>      <td>Identifiant unique</td>      <td><code>bureau</code></td></tr>
              <tr><td><code>label</code></td>   <td>Texte affiché</td>           <td><code>Je suis là au bureau</code></td></tr>
              <tr><td><code>icon</code></td>    <td>Emoji</td>                   <td><code>🏢</code></td></tr>
              <tr><td><code>color</code></td>   <td>Couleur hex du bouton</td>   <td><code>#198754</code></td></tr>
              <tr><td><code>category</code></td><td><code>present</code> ou <code>absent</code></td><td><code>present</code></td></tr>
            </tbody>
          </table>
          <p style="font-size:.85rem;color:var(--muted);margin-top:10px">⚠️ Le <code>label</code> est la valeur enregistrée dans SharePoint. Ne pas le modifier sans mettre à jour les données existantes.</p>
        </div>

        <!-- Colonnes SharePoint -->
        <div class="acces-card">
          <h3>📋 Colonnes SharePoint requises</h3>
          <table>
            <thead><tr><th>Nom interne</th><th>Type</th><th>Obligatoire</th></tr></thead>
            <tbody>
              <tr><td><code>EmployeNom</code></td>    <td>Ligne de texte</td>  <td>✅</td></tr>
              <tr><td><code>EmployeEmail</code></td>  <td>Ligne de texte</td>  <td>✅ (indexer pour perf.)</td></tr>
              <tr><td><code>Departement</code></td>   <td>Ligne de texte</td>  <td>✅</td></tr>
              <tr><td><code>StatutActuel</code></td>  <td>Ligne de texte</td>  <td>✅</td></tr>
              <tr><td><code>HeurePointage</code></td> <td>Date et heure</td>   <td>✅</td></tr>
              <tr><td><code>Notes</code></td>         <td>Ligne de texte</td>  <td>Non</td></tr>
            </tbody>
          </table>
          <div class="link-row" style="margin-top:14px">
            <a class="ext-link" href="${sp}/Lists/${CONFIG.SHAREPOINT_LIST}" target="_blank">📋 Ouvrir la liste</a>
            <a class="ext-link" href="${sp}/_layouts/15/listedit.aspx?List=${CONFIG.SHAREPOINT_LIST}" target="_blank">⚙️ Paramètres de la liste</a>
          </div>
        </div>

        <!-- Départements -->
        <div class="acces-card">
          <h3>🏢 Modifier les départements</h3>
          <p style="font-size:.9rem;line-height:1.7">
            La liste des départements est dans <code>config.js</code>, tableau <code>DEPARTEMENTS</code> :<br>
            <code>DEPARTEMENTS: ['Tous', 'Direction', 'Développement', 'Infrastructure', 'Support', 'Administration']</code><br>
            Ajouter ou retirer des entrées selon votre organisation. Le premier élément doit rester <code>'Tous'</code>.
          </p>
        </div>

        <!-- Liens -->
        <div class="acces-card">
          <h3>🔗 Raccourcis portail</h3>
          <div class="link-row">
            <a class="ext-link" href="https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps" target="_blank">🔐 Azure AD — App</a>
            <a class="ext-link" href="${sp}" target="_blank">📁 Site SharePoint</a>
            <a class="ext-link" href="https://admin.microsoft.com" target="_blank">⚙️ M365 Admin</a>
            <a class="ext-link" href="https://github.com/Blackip360tech/presences-blackip360-dev/actions" target="_blank">🚀 GitHub Actions (DEV)</a>
          </div>
        </div>

      </div>`;
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
    const tick = () => {
      const now = new Date();
      const est = now.toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const jp  = now.toLocaleTimeString('fr-CA', { timeZone: 'Asia/Tokyo',     hour: '2-digit', minute: '2-digit', hour12: false });
      const dt  = now.toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const estEl = el.querySelector('.est');
      const dEl   = el.querySelector('.date');
      const jpEl  = el.querySelector('.jp');
      if (estEl) estEl.textContent = est.replace(/:/g, ' : ').replace(/^(\d+) : (\d+) : (\d+)$/, '$1 h $2 min $3 s');
      if (dEl)   dEl.textContent = dt + ' • EST';
      if (jpEl)  jpEl.textContent = '🇯🇵 Tokyo ' + jp;
    };
    tick();
    setInterval(tick, 1000);
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
