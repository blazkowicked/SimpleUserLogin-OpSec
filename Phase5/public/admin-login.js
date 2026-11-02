document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("adminLoginForm");
  const errorEl = document.getElementById("adminLoginError");
  const ADMIN_TOKEN_KEY = "adminToken";
  const ADMIN_USER_KEY = "adminUser";

  function showError(msg) {
    if (errorEl) errorEl.textContent = msg || "";
  }
  function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.dataset.orig ||= btn.textContent;
    btn.textContent = loading ? "Please wait..." : btn.dataset.orig;
  }
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const { headers: _h, ...rest } = opts;
    const res = await fetch(path, { ...rest, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  }

  const eyeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3.2"/></svg>`;
  const eyeOffSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.93 10.93 0 0 1 12 19c-7 0-11-7-11-7a20.77 20.77 0 0 1 5.06-5.94"/><path d="M9.59 9.59A3.2 3.2 0 0 0 12 15.2a3.2 3.2 0 0 0 3.2-3.2 3.18 3.18 0 0 0-.59-1.81"/><path d="M1 1l22 22"/><path d="M10.58 10.58A3.2 3.2 0 0 0 14.42 14.42"/><path d="M14.12 14.12A3.2 3.2 0 0 1 9.88 9.88"/></svg>`;
  document.querySelectorAll(".eye-btn[data-eye]").forEach((btn) => {
    const input = document.getElementById(btn.getAttribute("data-eye"));
    if (!input) return;
    btn.innerHTML = eyeSvg;
    btn.addEventListener("click", () => {
      const isPw = input.type === "password";
      input.type = isPw ? "text" : "password";
      btn.innerHTML = isPw ? eyeOffSvg : eyeSvg;
    });
  });

  // Already signed in as admin on this device? Skip to the dashboard. The server confirms
  // the session first, so an expired or revoked token just gets cleared and the form stays.
  const existing = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (existing) {
    fetch("/api/admin/me", { headers: { Authorization: `Bearer ${existing}` } })
      .then((res) => {
        if (res.ok) {
          window.location.replace("AdminDashboard.html");
        } else if (res.status === 401 || res.status === 403) {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          localStorage.removeItem(ADMIN_USER_KEY);
        }
      })
      .catch(() => {});
  }

  const adminEmailInput = document.getElementById("adminEmail");
  const adminEmailCheck = window.EmailCheck ? EmailCheck.attach(adminEmailInput) : null;

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("");
      const email = document.getElementById("adminEmail").value.trim();
      const password = document.getElementById("adminPassword").value;
      if (!email || !password) {
        showError("Email and password are required");
        return;
      }
      if (adminEmailCheck && !adminEmailCheck.check()) {
        adminEmailInput.focus();
        return;
      }
      const btn = form.querySelector("button[type=submit]");
      setLoading(btn, true);
      try {
        const data = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        sessionStorage.setItem("otpPending", JSON.stringify({ pendingToken: data.pendingToken, maskedEmail: data.maskedEmail, flow: "admin" }));
        window.location.href = "OtpPage.html";
      } catch (err) {
        showError(err.message);
      } finally {
        setLoading(btn, false);
      }
    });
  }
});
