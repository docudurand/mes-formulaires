// Simple "mot de passe site" côté navigateur (comme Wix) via sessionStorage.
// IMPORTANT: barrière légère (pas une sécurité forte). Pour une vraie sécurité: auth serveur.
const AUTH_KEY = "dd_auth_ok_v1";

// ⚠️ Mets ton vrai mot de passe ici
const SITE_PASSWORD = "test";

// (optionnel) un identifiant fixe (permet d’aider les gestionnaires de mots de passe)
const SITE_USERNAME = "durand";

/* ---------------- helpers ---------------- */

function getPrefix() {
  // Chaque page définit window.__SITE_PREFIX__ à "" (racine) ou "../" (sous-dossier)
  return (window.__SITE_PREFIX__ !== undefined) ? String(window.__SITE_PREFIX__) : "";
}

function isAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === "1";
}

function setAuthed() {
  sessionStorage.setItem(AUTH_KEY, "1");
}

function clearAuthed() {
  sessionStorage.removeItem(AUTH_KEY);
}

/* ---------------- core ---------------- */

function requireAuth() {
  if (isAuthed()) return;

  const prefix = getPrefix();
  const dest = window.location.pathname + window.location.search + window.location.hash;

  // redirige vers login.html en gardant la destination
  window.location.replace(prefix + "login.html?redirect=" + encodeURIComponent(dest));
}

function loginWith(pwd) {
  if (pwd === SITE_PASSWORD) {
    setAuthed();
    return true;
  }
  return false;
}

function logout() {
  clearAuthed();
  window.location.href = getPrefix() + "login.html";
}

/* ---------------- Password-manager friendly login binding ----------------
   Sur login.html, utilise un vrai <form> avec :
   - input name="username" autocomplete="username"
   - input type="password" name="password" autocomplete="current-password"
   - button type="submit"
   Ça déclenche la proposition d’enregistrement du navigateur.
-------------------------------------------------------------------------- */

function getRedirectTarget() {
  const qs = new URLSearchParams(window.location.search || "");
  const r = qs.get("redirect");
  // sécurité basique: on n’accepte que des chemins internes
  if (!r) return null;
  if (/^https?:\/\//i.test(r)) return null;
  return r;
}

function goAfterLogin() {
  const prefix = getPrefix();
  const target = getRedirectTarget();
  if (target) {
    // target est un pathname complet (ex: /utilitaire/xxx.html)
    window.location.href = target;
  } else {
    window.location.href = prefix + "index.html";
  }
}

/**
 * À appeler sur login.html :
 * - si tu as un <form id="loginForm"> avec #username + #password
 * - ou si tu as juste <form id="loginForm"> avec #password
 */
function wireLoginForm(options = {}) {
  const {
    formId = "loginForm",
    usernameId = "username",
    passwordId = "password",
    errorId = "loginError",
    forceUsername = SITE_USERNAME, // si pas de champ username, on le remplit en cache
  } = options;

  const form = document.getElementById(formId);
  if (!form) return;

  const pass = document.getElementById(passwordId);
  const user = document.getElementById(usernameId);
  const err  = document.getElementById(errorId);

  // ✅ Important pour déclencher l’enregistrement navigateur
  form.setAttribute("autocomplete", "on");

  // Si pas de champ username dans ton HTML, on en crée un caché (aide le password manager)
  if (!user) {
    const hiddenUser = document.createElement("input");
    hiddenUser.type = "text";
    hiddenUser.name = "username";
    hiddenUser.autocomplete = "username";
    hiddenUser.value = String(forceUsername || "user");
    hiddenUser.style.position = "absolute";
    hiddenUser.style.left = "-9999px";
    hiddenUser.style.width = "1px";
    hiddenUser.style.height = "1px";
    hiddenUser.tabIndex = -1;
    form.prepend(hiddenUser);
  } else {
    user.name = user.name || "username";
    user.autocomplete = "username";
    if (!user.value) user.value = String(forceUsername || "");
  }

  if (pass) {
    pass.name = pass.name || "password";
    pass.type = "password";
    pass.autocomplete = "current-password";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (err) err.textContent = "";

    const pwd = pass ? String(pass.value || "") : "";

    if (loginWith(pwd)) {
      // ✅ laisse le formulaire être “réel” pour le navigateur,
      // mais on gère la navigation nous-mêmes.
      goAfterLogin();
    } else {
      if (err) err.textContent = "Mot de passe incorrect.";
      if (pass) pass.focus();
    }
  });
}

// Expose pour usage inline si besoin
window.requireAuth = requireAuth;
window.loginWith = loginWith;
window.logout = logout;
window.wireLoginForm = wireLoginForm;
