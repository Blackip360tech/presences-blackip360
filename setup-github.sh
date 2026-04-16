#!/usr/bin/env bash
# BlackIP360 Présences — Script de création des repos GitHub
# Lancer APRÈS : gh auth login
# Usage : bash setup-github.sh VOTRE_GITHUB_USERNAME

set -e

USERNAME="${1:-}"
if [ -z "$USERNAME" ]; then
  echo "Usage: bash setup-github.sh VOTRE_USERNAME_GITHUB"
  exit 1
fi

GH="$(which gh 2>/dev/null || echo '/c/Program Files/GitHub CLI/gh')"
PROD_REPO="presences-blackip360"
DEV_REPO="presences-blackip360-dev"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  BlackIP360 Présences — Création des repos GitHub"
echo "  Utilisateur : $USERNAME"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── 1. Repo PROD ─────────────────────────────────────────────────────────────
echo "📦 Création du repo PRODUCTION : $USERNAME/$PROD_REPO ..."
"$GH" repo create "$PROD_REPO" \
  --private \
  --description "BlackIP360 - Système de présences (PRODUCTION)" \
  --homepage "https://$USERNAME.github.io/$PROD_REPO"

echo "🔗 Ajout du remote 'origin' (prod)..."
git remote add origin "https://github.com/$USERNAME/$PROD_REPO.git" 2>/dev/null \
  || git remote set-url origin "https://github.com/$USERNAME/$PROD_REPO.git"

echo "⬆️  Push branche main → prod..."
git checkout main
git push -u origin main

echo "✅ Pages GitHub (prod) activation..."
"$GH" api "repos/$USERNAME/$PROD_REPO/pages" \
  --method POST \
  --field build_type=workflow \
  2>/dev/null || echo "   (Pages sera activé automatiquement au 1er déploiement)"

# ── 2. Repo DEV ───────────────────────────────────────────────────────────────
echo ""
echo "📦 Création du repo DÉVELOPPEMENT : $USERNAME/$DEV_REPO ..."
"$GH" repo create "$DEV_REPO" \
  --private \
  --description "BlackIP360 - Système de présences (DEV)" \
  --homepage "https://$USERNAME.github.io/$DEV_REPO"

echo "🔗 Ajout du remote 'dev-origin' ..."
git remote add dev-origin "https://github.com/$USERNAME/$DEV_REPO.git" 2>/dev/null \
  || git remote set-url dev-origin "https://github.com/$USERNAME/$DEV_REPO.git"

echo "⬆️  Push branche dev → dev repo (comme main)..."
git checkout dev
git push -u dev-origin dev:main

echo "✅ Pages GitHub (dev) activation..."
"$GH" api "repos/$USERNAME/$DEV_REPO/pages" \
  --method POST \
  --field build_type=workflow \
  2>/dev/null || echo "   (Pages sera activé automatiquement au 1er déploiement)"

# ── 3. Résumé ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ TERMINÉ !"
echo ""
echo "  PROD  → https://github.com/$USERNAME/$PROD_REPO"
echo "          https://$USERNAME.github.io/$PROD_REPO"
echo ""
echo "  DEV   → https://github.com/$USERNAME/$DEV_REPO"
echo "          https://$USERNAME.github.io/$DEV_REPO"
echo ""
echo "  ⚠️  PROCHAINES ÉTAPES :"
echo "  1. Mettre à jour APP_URL dans config.js (branche main → prod URL)"
echo "  2. Mettre à jour APP_URL dans config.js (branche dev  → dev URL)"
echo "  3. Enregistrer l'app Azure AD et remplir CLIENT_ID + TENANT_ID"
echo "  4. Ajouter les 2 redirect URIs dans Azure AD :"
echo "     https://$USERNAME.github.io/$PROD_REPO/"
echo "     https://$USERNAME.github.io/$DEV_REPO/"
echo "═══════════════════════════════════════════════════════"
