// Simple "mot de passe site" côté navigateur (comme Wix) via sessionStorage.
// IMPORTANT: c'est une barrière légère (pas une sécurité forte). Pour une vraie sécurité: auth serveur.
const AUTH_KEY = "dd_auth_ok_v1";
const SITE_PASSWORD = "test"; // <-- remplace par ton mot de passe

function getPrefix(){
  // Chaque page définit window.__SITE_PREFIX__ à "" (racine) ou "../" (sous-dossier)
  return (window.__SITE_PREFIX__ !== undefined) ? String(window.__SITE_PREFIX__) : "";
}

function isAuthed(){
  return sessionStorage.getItem(AUTH_KEY) === "1";
}

function requireAuth(){
  if(isAuthed()) return;

  const prefix = getPrefix();
  const dest = window.location.pathname + window.location.search + window.location.hash;

  // redirige vers login.html en gardant la destination
  window.location.replace(prefix + "login.html?redirect=" + encodeURIComponent(dest));
}

function loginWith(pwd){
  if(pwd === SITE_PASSWORD){
    sessionStorage.setItem(AUTH_KEY, "1");
    return true;
  }
  return false;
}

function logout(){
  sessionStorage.removeItem(AUTH_KEY);
  window.location.href = getPrefix() + "login.html";
}
