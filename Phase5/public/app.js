// Shared behaviour for the signed-in pages (Home, About, Account settings):
// sign-in check, account menu, log out and the privacy policy popup.
(() => {
  const TOKEN_KEY = "token";
  const USER_KEY = "currentUser";
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.replace("LoginPage.html");
    return;
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}`, ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Session ended (logged out elsewhere, expired or revoked)
      clearSession();
      window.location.replace("LoginPage.html");
      throw new Error(data.message || "Signed out");
    }
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  }

  // ---------- who is signed in ----------
  const userReady = api("/api/auth/me").then((user) => {
    document.querySelectorAll("[data-user-email]").forEach((el) => (el.textContent = user.email));
    document.querySelectorAll("[data-user-email-value]").forEach((el) => (el.value = user.email));
    document.querySelectorAll("[data-user-initial]").forEach((el) => (el.textContent = (user.email || "?").charAt(0).toUpperCase()));
    const since = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "";
    document.querySelectorAll("[data-member-since]").forEach((el) => (el.textContent = since));
    return user;
  });

  // ---------- account menu ----------
  const accountBtn = document.getElementById("accountBtn");
  const accountMenu = document.getElementById("accountMenu");
  function setMenu(open) {
    if (!accountBtn || !accountMenu) return;
    accountMenu.hidden = !open;
    accountBtn.setAttribute("aria-expanded", String(open));
    if (open) accountMenu.querySelector("[role=menuitem]")?.focus();
  }
  accountBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(accountMenu.hidden);
  });
  document.addEventListener("click", (e) => {
    if (accountMenu && !accountMenu.hidden && !accountMenu.contains(e.target)) setMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && accountMenu && !accountMenu.hidden) {
      setMenu(false);
      accountBtn.focus();
    }
  });

  // ---------- log out (ends the session on the server too) ----------
  document.getElementById("logoutAction")?.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_) {
      /* already signed out */
    }
    clearSession();
    window.location.replace("LoginPage.html");
  });

  // ---------- privacy policy popup ----------
  const privacy = document.getElementById("privacyModal");
  let lastFocus = null;
  function setPrivacy(open) {
    if (!privacy) return;
    privacy.hidden = !open;
    if (open) {
      lastFocus = document.activeElement;
      privacy.querySelector(".policy-close")?.focus();
    } else lastFocus?.focus();
  }
  document.querySelectorAll("[data-open-privacy]").forEach((b) => b.addEventListener("click", () => setPrivacy(true)));
  privacy?.querySelectorAll("[data-close-privacy]").forEach((b) => b.addEventListener("click", () => setPrivacy(false)));
  privacy?.addEventListener("click", (e) => {
    if (e.target === privacy) setPrivacy(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && privacy && !privacy.hidden) setPrivacy(false);
  });

  // ---------- device list helpers ----------
  const ICONS = {
    monitor: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>',
  };

  function signedInWhen(iso) {
    const d = new Date(iso);
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return `Signed in today, ${time}`;
    if (d.toDateString() === yesterday.toDateString()) return `Signed in yesterday, ${time}`;
    return `Signed in ${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  }

  // Builds the rows with DOM methods, so device labels are always treated as text
  function renderDevices(listEl, sessions, onLogout) {
    listEl.replaceChildren();
    for (const s of sessions) {
      const li = document.createElement("li");
      li.className = "device-row";
      const icon = document.createElement("span");
      icon.className = "device-icon";
      icon.innerHTML = /iPhone|Android/.test(s.device) ? ICONS.phone : ICONS.monitor;
      const text = document.createElement("div");
      text.className = "device-text";
      const name = document.createElement("span");
      name.className = "device-name";
      name.textContent = s.device;
      const when = document.createElement("span");
      when.className = "device-when";
      when.textContent = signedInWhen(s.createdAt);
      text.append(name, when);
      li.append(icon, text);
      if (s.current) {
        const tag = document.createElement("span");
        tag.className = "status status-active";
        tag.textContent = "This device";
        li.append(tag);
      } else if (onLogout) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-small btn-outline";
        btn.textContent = "Log out";
        btn.setAttribute("aria-label", `Log out ${s.device}`);
        btn.addEventListener("click", () => onLogout(s, btn));
        li.append(btn);
      }
      listEl.append(li);
    }
  }

  window.OpSec = { api, userReady, renderDevices, clearSession };
})();
