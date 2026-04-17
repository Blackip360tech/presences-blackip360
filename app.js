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

    let profileErr = null;
    try {
      const profile        = await Graph.getProfile();
      this.user.department = profile.department  || 'Non défini';
      this.user.jobTitle   = profile.jobTitle    || '';
      this.user.email      = profile.mail        || this.user.email;
      this.user.name       = profile.displayName || this.user.name;
      console.log('[APP] profil Graph OK:', this.user.name);
    } catch (err) {
      profileErr = err.message;
      this.user.department = 'Non défini';
      console.warn('[APP] Graph.getProfile() échec:', err.message);
    }

    this._checkAdmin();
    this._showApp();
    this._renderHeader();

    // Barre de debug temporaire en haut de l'app
    const dbgBar = document.createElement('div');
    dbgBar.style.cssText = 'background:#fff3cd;border-bottom:2px solid #ffc107;padding:8px 16px;font-size:.8rem;font-family:monospace;word-break:break-all';
    dbgBar.innerHTML = `<strong>DEBUG APP</strong> — Connecté: <b>${this.user.email}</b> | Dept: ${this.user.department} | Admin: ${this.isAdmin}${profileErr ? ' | ❌ Graph.getProfile: ' + profileErr : ' | ✅ Graph OK'}`;
    document.body.prepend(dbgBar);

    await this.loadTab('statut');
  },

  _checkAdmin() {
    // Admins : département Direction ou liste explicite
    const adminEmails = ['admin@blackip360.com', 'tech@blackip360.com'];
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

    await this.loadTab(tabId);
  },

  async loadTab(tabId) {
    switch (tabId) {
      case 'statut': return this._loadMonStatut();
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
          <div class="current-label">${current?.StatutActuel || 'Aucun statut enregistré'}</div>
          ${current ? `<div class="current-time">Depuis ${this._fmtTime(current.HeurePointage)}</div>` : ''}
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
        const statut = btn.dataset.statut;
        const notes  = document.getElementById('notesInput')?.value || '';
        await this._setStatut(statut, notes);
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

    return `
      <div class="tv-wrap">
        <div class="tv-hdr">
          <span class="tv-logo">BlackIP360</span>
          <span class="tv-clock">${new Date().toLocaleString('fr-CA')}</span>
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
    const today   = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    document.getElementById('tab-paye').innerHTML = `
      <div class="paye-wrap">
        <h2>Analyse des présences</h2>
        <div class="paye-filters">
          <label>Du&nbsp;: <input type="date" id="payeFrom" value="${weekAgo}" /></label>
          <label>Au&nbsp;: <input type="date" id="payeTo"   value="${today}"   /></label>
          <button class="btn-primary"   onclick="App.computePaye()">📊 Calculer</button>
          <button class="btn-secondary" onclick="App.exportPayeCSV()">📥 Export CSV</button>
        </div>
        <div id="payeResult"><p class="hint">Sélectionnez une période et cliquez sur Calculer.</p></div>
      </div>`;
  },

  async computePaye() {
    const from   = document.getElementById('payeFrom').value;
    const to     = document.getElementById('payeTo').value;
    const result = document.getElementById('payeResult');
    result.innerHTML = '<div class="loading">Calcul en cours…</div>';

    try {
      const all      = await Graph.getAllPresences();
      const filtered = all.filter(p => {
        const d = p.HeurePointage?.slice(0, 10);
        return d >= from && d <= to;
      });

      const byEmployee = {};
      for (const p of filtered) {
        if (!byEmployee[p.EmployeEmail]) {
          byEmployee[p.EmployeEmail] = { nom: p.EmployeNom, dept: p.Departement, entries: [] };
        }
        byEmployee[p.EmployeEmail].entries.push(p);
      }
      this._payeData = byEmployee;

      const rows = Object.entries(byEmployee).map(([email, d]) => {
        const presentN = d.entries.filter(e =>
          CONFIG.STATUTS.find(s => s.label === e.StatutActuel)?.category === 'present'
        ).length;
        const jours = new Set(d.entries.map(e => e.HeurePointage?.slice(0, 10))).size;
        return `<tr>
          <td>${d.nom || email}</td><td>${d.dept || '—'}</td>
          <td>${jours}</td><td>${d.entries.length}</td><td>${presentN}</td>
        </tr>`;
      });

      result.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Employé</th><th>Département</th><th>Jours actifs</th><th>Total pointages</th><th>Pointages « présent »</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>`;
    } catch (err) {
      result.innerHTML = `<div class="error">Erreur : ${err.message}</div>`;
    }
  },

  exportPayeCSV() {
    if (!this._payeData) return this.showToast('Calculez d\'abord la période.', 'error');
    const rows = [['Employé', 'Email', 'Département', 'Jours actifs', 'Total pointages', 'Présents']];
    for (const [email, d] of Object.entries(this._payeData)) {
      const presentN = d.entries.filter(e =>
        CONFIG.STATUTS.find(s => s.label === e.StatutActuel)?.category === 'present'
      ).length;
      const jours = new Set(d.entries.map(e => e.HeurePointage?.slice(0, 10))).size;
      rows.push([d.nom, email, d.dept, jours, d.entries.length, presentN]);
    }
    this._downloadCSV(rows, `paye_${this._today()}.csv`);
  },

  // ── ACCÈS ─────────────────────────────────────────────────────────────────
  _loadAcces() {
    const configOk = id => id !== 'VOTRE_CLIENT_ID' && id !== 'VOTRE_TENANT_ID';

    document.getElementById('tab-acces').innerHTML = `
      <div class="acces-wrap">
        <h2>Gestion des accès et configuration</h2>

        <div class="acces-card">
          <h3>Étapes de déploiement</h3>
          <ol class="checklist">
            <li class="done">Flux Power Automate actif</li>
            <li class="done">Liste SharePoint Presences_Employes créée</li>
            <li class="${configOk(CONFIG.CLIENT_ID) ? 'done' : 'todo'}">
              App Azure AD enregistrée
              ${configOk(CONFIG.CLIENT_ID) ? '' : '→ <a href="https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps" target="_blank">Créer l\'app</a>'}
            </li>
            <li class="${CONFIG.APP_URL.includes('YOUR_GITHUB') ? 'todo' : 'done'}">
              GitHub Pages déployé
              ${CONFIG.APP_URL.includes('YOUR_GITHUB') ? '→ mettre à jour APP_URL dans config.js' : ''}
            </li>
            <li class="todo">Manifest Teams mis à jour avec l\'URL GitHub Pages</li>
            <li class="todo">App Teams déployée pour tous les employés</li>
          </ol>
        </div>

        <div class="acces-card">
          <h3>Configuration actuelle</h3>
          <table>
            <tr><td>Client ID</td>   <td><code>${CONFIG.CLIENT_ID}</code></td></tr>
            <tr><td>Tenant ID</td>   <td><code>${CONFIG.TENANT_ID}</code></td></tr>
            <tr><td>SharePoint</td>  <td><code>${CONFIG.SHAREPOINT_HOST}${CONFIG.SHAREPOINT_SITE_PATH}</code></td></tr>
            <tr><td>Liste</td>       <td><code>${CONFIG.SHAREPOINT_LIST}</code></td></tr>
            <tr><td>App URL</td>     <td><code>${CONFIG.APP_URL}</code></td></tr>
          </table>
        </div>

        <div class="acces-card">
          <h3>Raccourcis portail</h3>
          <div class="link-row">
            <a class="ext-link" href="https://portal.azure.com" target="_blank">🔗 Portail Azure</a>
            <a class="ext-link" href="https://blackip360.sharepoint.com/sites/PlanificationTI" target="_blank">🔗 Site SharePoint</a>
            <a class="ext-link" href="https://make.powerautomate.com" target="_blank">🔗 Power Automate</a>
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
