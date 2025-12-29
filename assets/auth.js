const AUTH_KEY = "dd_auth_ok_v1";

const SITE_USERNAME = "durand";

const LOGIN_ENDPOINT = "/api/site/login";

function getPrefix() {
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

function requireAuth() {
  if (isAuthed()) return;

  const prefix = getPrefix();
  const dest = window.location.pathname + window.location.search + window.location.hash;

  window.location.replace(prefix + "login.html?redirect=" + encodeURIComponent(dest));
}

function loginWith(pwd) {
  return fetch(LOGIN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: String(pwd || "") })
  })
    .then(res => {
      if (res.ok) {
        setAuthed();
        return true;
      }
      return false;
    })
    .catch(() => false);
}

function logout() {
  clearAuthed();
  window.location.href = getPrefix() + "login.html";
}

function getRedirectTarget() {
  const qs = new URLSearchParams(window.location.search || "");
  const r = qs.get("redirect");
  if (!r) return null;
  if (/^https?:\/\//i.test(r)) return null;
  return r;
}

function goAfterLogin() {
  const prefix = getPrefix();
  const target = getRedirectTarget();
  if (target) {
    window.location.href = target;
  } else {
    window.location.href = prefix + "index.html";
  }
}

function wireLoginForm(options = {}) {
  const {
    formId = "loginForm",
    usernameId = "username",
    passwordId = "password",
    errorId = "loginError",
    forceUsername = SITE_USERNAME,
  } = options;

  const form = document.getElementById(formId);
  if (!form) return;

  const pass = document.getElementById(passwordId);
  const user = document.getElementById(usernameId);
  const err  = document.getElementById(errorId);

  form.setAttribute("autocomplete", "on");

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (err) err.textContent = "";

    const pwd = pass ? String(pass.value || "") : "";
    const ok = await loginWith(pwd);
    if (ok) {
      goAfterLogin();
    } else {
      if (err) err.textContent = "Mot de passe incorrect.";
      if (pass) pass.focus();
    }
  });
}

window.requireAuth = requireAuth;
window.loginWith = loginWith;
window.logout = logout;
window.wireLoginForm = wireLoginForm;
