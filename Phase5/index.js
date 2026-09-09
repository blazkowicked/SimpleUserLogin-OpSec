// Frontend — Express + MongoDB Atlas, auth via /api/auth/*, JWT in localStorage
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const logoutBtn = document.getElementById("logoutBtn");
  const welcomeTitle = document.getElementById("welcomeTitle");
  const welcomeSub = document.getElementById("welcomeSub");
  const loginError = document.getElementById("loginError");
  const signupError = document.getElementById("signupError");
  const landingError = document.getElementById("landingError");

  const TOKEN_KEY = "token";
  const USER_KEY = "currentUser";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function setSession(token, email) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (email) localStorage.setItem(USER_KEY, email);
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem("currentUser");
    localStorage.removeItem("users");
    localStorage.removeItem("fakeLoggedInUser");
    localStorage.removeItem("fakeUsers");
  }
  function showError(el, msg) {
    if (el) el.textContent = msg || "";
  }
  function showHint(el, msg, warn) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("warn", !!warn);
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
    if (!res.ok) {
      const err = new Error(data.message || `Request failed (${res.status})`);
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const eyeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3.2"/></svg>`;
  const eyeOffSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.93 10.93 0 0 1 12 19c-7 0-11-7-11-7a20.77 20.77 0 0 1 5.06-5.94"/><path d="M9.59 9.59A3.2 3.2 0 0 0 12 15.2a3.2 3.2 0 0 0 3.2-3.2 3.18 3.18 0 0 0-.59-1.81"/><path d="M1 1l22 22"/><path d="M10.58 10.58A3.2 3.2 0 0 0 14.42 14.42"/><path d="M14.12 14.12A3.2 3.2 0 0 1 9.88 9.88"/></svg>`;

  function attachEyeToggles() {
    document.querySelectorAll(".eye-btn[data-eye]").forEach((btn) => {
      const targetId = btn.getAttribute("data-eye");
      const input = document.getElementById(targetId);
      if (!input) return;
      btn.innerHTML = eyeSvg;
      btn.setAttribute("aria-label", "Show password");
      btn.addEventListener("click", () => {
        const isPw = input.type === "password";
        input.type = isPw ? "text" : "password";
        btn.innerHTML = isPw ? eyeOffSvg : eyeSvg;
        btn.setAttribute("aria-label", isPw ? "Hide password" : "Show password");
      });
    });
  }
  attachEyeToggles();

  if (loginForm) {
    const loginHint = document.getElementById("loginHint");
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError(loginError, "");
      showHint(loginHint, "");
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      if (!email || !password) {
        showError(loginError, "Email and password are required.");
        return;
      }
      const btn = loginForm.querySelector("button[type=submit]");
      setLoading(btn, true);
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setSession(data.token, data.user?.email || email);
        window.location.href = "LandingPage.html";
      } catch (err) {
        showError(loginError, err.message);
        showHint(loginHint, "");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError(signupError, "");
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPassword").value;
      const confirmPassword = document.getElementById("signupConfirmPassword").value;

      if (!email || !password || !confirmPassword) {
        showError(signupError, "All fields are required.");
        return;
      }
      if (password !== confirmPassword) {
        showError(signupError, "Passwords do not match.");
        return;
      }
      if (password.length < 8) {
        showError(signupError, "Password must be at least 8 characters.");
        return;
      }

      const btn = signupForm.querySelector("button[type=submit]");
      setLoading(btn, true);
      try {
        const data = await api("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, password, confirmPassword }),
        });
        setSession(data.token, data.user?.email || email);
        window.location.href = "LandingPage.html";
      } catch (err) {
        showError(signupError, err.message);
      } finally {
        setLoading(btn, false);
      }
    });
  }

  if (welcomeTitle) {
    (async () => {
      const token = getToken();
      if (!token) {
        window.location.href = "LoginPage.html";
        return;
      }
      try {
        const user = await api("/api/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        welcomeTitle.textContent = `Welcome, ${user.email}! You are logged in.`;
        if (welcomeSub) {
          welcomeSub.style.display = "block";
          const d = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "";
          welcomeSub.textContent = d ? `Member since ${d}` : "";
        }
      } catch (err) {
        showError(landingError, err.message);
        if (err.message.toLowerCase().includes("token") || err.message.includes("401") || err.message.includes("authorization")) {
          clearSession();
          setTimeout(() => (window.location.href = "LoginPage.html"), 1200);
        }
      }
    })();
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearSession();
      window.location.href = "LoginPage.html";
    });
  }
});
