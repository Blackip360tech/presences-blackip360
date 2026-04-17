// BlackIP360 Présences — Authentification MSAL.js
class BlackIPAuth {
  constructor() {
    this.msal    = null;
    this.account = null;
  }

  async init() {
    const msalCfg = {
      auth: {
        clientId:    CONFIG.CLIENT_ID,
        authority:   `https://login.microsoftonline.com/${CONFIG.TENANT_ID}`,
        redirectUri: CONFIG.APP_URL + '/',
      },
      cache: {
        cacheLocation:        'sessionStorage',
        storeAuthStateInCookie: false,
      },
    };

    this.msal = new msal.PublicClientApplication(msalCfg);
    await this.msal.initialize();

    // Récupérer le résultat d'un redirect précédent
    const result = await this.msal.handleRedirectPromise();
    if (result?.account) {
      this.account = result.account;
    } else {
      const accounts = this.msal.getAllAccounts();
      if (accounts.length) this.account = accounts[0];
    }
  }

  // Codes d'erreur qui forcent le fallback en redirect plutôt que popup
  _isPopupBlocked(err) {
    return ['popup_window_error', 'block_nested_popups', 'empty_window_error'].includes(err.errorCode);
  }

  async login() {
    const req = { scopes: CONFIG.SCOPES };
    try {
      const r = await this.msal.loginPopup(req);
      this.account = r.account;
      return r.account;
    } catch (err) {
      if (this._isPopupBlocked(err)) {
        await this.msal.loginRedirect(req);
        return;
      }
      throw err;
    }
  }

  async logout() {
    try {
      await this.msal.logoutPopup({ account: this.account });
    } catch (err) {
      if (this._isPopupBlocked(err)) {
        await this.msal.logoutRedirect({ account: this.account });
        return;
      }
      throw err;
    }
    this.account = null;
  }

  async getToken() {
    if (!this.account) throw new Error('Non authentifié — veuillez vous connecter.');
    try {
      const r = await this.msal.acquireTokenSilent({
        scopes:  CONFIG.SCOPES,
        account: this.account,
      });
      return r.accessToken;
    } catch (err) {
      if (err instanceof msal.InteractionRequiredAuthError) {
        try {
          const r = await this.msal.acquireTokenPopup({
            scopes:  CONFIG.SCOPES,
            account: this.account,
          });
          return r.accessToken;
        } catch (popupErr) {
          if (this._isPopupBlocked(popupErr)) {
            await this.msal.acquireTokenRedirect({ scopes: CONFIG.SCOPES, account: this.account });
            return;
          }
          throw popupErr;
        }
      }
      throw err;
    }
  }

  isLoggedIn() { return !!this.account; }

  getUser() {
    if (!this.account) return null;
    return { name: this.account.name, email: this.account.username };
  }
}

const Auth = new BlackIPAuth();
