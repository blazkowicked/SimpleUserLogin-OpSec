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

  const otpForm = document.getElementById("otpForm");
  const forgotForm = document.getElementById("forgotForm");
  const resetForm = document.getElementById("resetForm");
  const forceChangeForm = document.getElementById("forceChangeForm");

  const TOKEN_KEY = "token";
  const USER_KEY = "currentUser";
  const OTP_KEY = "otpPending";
  const CHANGE_KEY = "passwordChangeToken";

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

  function startOtp(data, flow) {
    sessionStorage.setItem(OTP_KEY, JSON.stringify({ pendingToken: data.pendingToken, maskedEmail: data.maskedEmail, flow }));
    window.location.href = "OtpPage.html";
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

  // Live password checklist (F3). The server enforces the same rules.
  if (window.PasswordRules) {
    ["signupPassword", "resetPassword", "changePassword"].forEach((id) => {
      const input = document.getElementById(id);
      if (input) PasswordRules.attach(input);
    });
  }

  // Already signed in on this device? Skip the login and signup forms. The server confirms
  // the session first, so an expired or revoked token just gets cleared and the form stays.
  if (loginForm || signupForm) {
    const existingToken = getToken();
    if (existingToken) {
      api("/api/auth/me", { method: "GET", headers: { Authorization: `Bearer ${existingToken}` } })
        .then(() => window.location.replace("LandingPage.html"))
        .catch((err) => {
          if (err.status === 401) clearSession();
        });
    }
  }

  if (loginForm) {
    const loginHint = document.getElementById("loginHint");
    const loginEmailInput = document.getElementById("loginEmail");
    const loginEmailCheck = window.EmailCheck ? EmailCheck.attach(loginEmailInput) : null;
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError(loginError, "");
      showHint(loginHint, "");
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      if (!email || !password) {
        showError(loginError, "Email and password are required");
        return;
      }
      if (loginEmailCheck && !loginEmailCheck.check()) {
        loginEmailInput.focus();
        return;
      }
      const btn = loginForm.querySelector("button[type=submit]");
      setLoading(btn, true);
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        startOtp(data, "user");
      } catch (err) {
        showError(loginError, err.message);
        showHint(loginHint, "");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // Privacy policy popup for signed-out pages (the signed-in pages use app.js)
  const privacyModal = document.getElementById("privacyModal");
  if (privacyModal) {
    let lastFocus = null;
    const setPrivacy = (open) => {
      privacyModal.hidden = !open;
      if (open) {
        lastFocus = document.activeElement;
        privacyModal.querySelector(".policy-close")?.focus();
      } else lastFocus?.focus();
    };
    document.querySelectorAll("[data-open-privacy]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        setPrivacy(true);
      }),
    );
    privacyModal.querySelectorAll("[data-close-privacy]").forEach((b) => b.addEventListener("click", () => setPrivacy(false)));
    privacyModal.addEventListener("click", (e) => {
      if (e.target === privacyModal) setPrivacy(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !privacyModal.hidden) setPrivacy(false);
    });
  }

  if (signupForm) {
    const signupEmailInput = document.getElementById("signupEmail");
    const consentBox = document.getElementById("signupConsent");
    const consentError = document.getElementById("signupConsentError");
    consentBox?.addEventListener("change", () => {
      if (consentBox.checked && consentError) consentError.textContent = "";
    });
    // Email format check (F4), shared with login and forgot password
    const signupEmailCheck = window.EmailCheck ? EmailCheck.attach(signupEmailInput) : null;

    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError(signupError, "");
      const confirmWrap = document.getElementById("signupConfirmPassword").closest(".input-wrap");
      if (confirmWrap) confirmWrap.classList.remove("is-invalid");
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPassword").value;
      const confirmPassword = document.getElementById("signupConfirmPassword").value;

      if (!email || !password || !confirmPassword) {
        showError(signupError, "All fields are required");
        return;
      }
      if (signupEmailCheck && !signupEmailCheck.check()) {
        signupEmailInput.focus();
        return;
      }
      if (consentBox && !consentBox.checked) {
        if (consentError) consentError.textContent = "Please confirm you've read the privacy policy";
        consentBox.focus();
        return;
      }
      if (password !== confirmPassword) {
        if (confirmWrap) confirmWrap.classList.add("is-invalid");
        showError(signupError, "Passwords do not match");
        return;
      }
      const signupProblem = window.PasswordRules ? PasswordRules.problem(password) : null;
      if (signupProblem) {
        showError(signupError, signupProblem);
        return;
      }

      const btn = signupForm.querySelector("button[type=submit]");
      setLoading(btn, true);
      try {
        const data = await api("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, password, confirmPassword, acceptedPrivacy: !!consentBox?.checked }),
        });
        startOtp(data, "signup");
      } catch (err) {
        showError(signupError, err.message);
      } finally {
        setLoading(btn, false);
      }
    });
  }

  if (otpForm) {
    const pending = JSON.parse(sessionStorage.getItem(OTP_KEY) || "null");
    const startPages = { admin: "AdminLoginPage.html", signup: "SignupPage.html", user: "LoginPage.html" };
    if (!pending) {
      window.location.href = "LoginPage.html";
    } else {
      const otpError = document.getElementById("otpError");
      const otpHint = document.getElementById("otpHint");
      const resendLink = document.getElementById("otpResend");
      const apiBase = pending.flow === "admin" ? "/api/admin" : "/api/auth";
      let cooldownUntil = 0;

      document.getElementById("otpSubtitle").textContent = `Enter the 6-digit code we sent to ${pending.maskedEmail}`;

      function restart(message) {
        sessionStorage.removeItem(OTP_KEY);
        showError(otpError, message);
        setTimeout(() => (window.location.href = startPages[pending.flow] || "LoginPage.html"), 1800);
      }
      function startCooldown(seconds) {
        cooldownUntil = Date.now() + seconds * 1000;
        const tick = () => {
          const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
          resendLink.textContent = left > 0 ? `Resend code (${left}s)` : "Resend code";
          if (left > 0) setTimeout(tick, 1000);
        };
        tick();
      }
      startCooldown(60);

      // One box per digit. Takes digits only, never more than the code length,
      // and handles typing, backspace, arrow keys, paste and phone autofill.
      const boxesEl = document.getElementById("otpBoxes");
      const CODE_LENGTH = Number(boxesEl.dataset.length) || 6;
      const boxes = [];
      for (let i = 0; i < CODE_LENGTH; i++) {
        const box = document.createElement("input");
        box.type = "text";
        box.inputMode = "numeric";
        box.className = "otp-digit";
        box.setAttribute("pattern", "[0-9]*");
        box.setAttribute("aria-label", `Digit ${i + 1} of ${CODE_LENGTH}`);
        // Only the first box offers the phone's "code from Messages/Mail" autofill
        box.autocomplete = i === 0 ? "one-time-code" : "off";
        boxesEl.append(box);
        boxes.push(box);
      }

      function getCode() {
        return boxes.map((b) => b.value).join("");
      }
      function clearBoxes() {
        boxes.forEach((b) => (b.value = ""));
        boxes[0].focus();
      }
      // Writes digits starting at a box, spilling into the following boxes
      function fillFrom(index, digits) {
        let i = index;
        for (const d of digits) {
          if (i >= CODE_LENGTH) break;
          boxes[i].value = d;
          i++;
        }
        const next = boxes[Math.min(i, CODE_LENGTH - 1)];
        if (getCode().length === CODE_LENGTH) otpForm.querySelector("button[type=submit]").focus();
        else next.focus();
      }

      boxes.forEach((box, i) => {
        box.addEventListener("input", () => {
          const digits = box.value.replace(/\D/g, "");
          box.value = "";
          if (digits) fillFrom(i, digits);
          if (otpError.textContent) showError(otpError, "");
        });
        box.addEventListener("keydown", (e) => {
          if (e.key === "Backspace" && !box.value && i > 0) {
            e.preventDefault();
            boxes[i - 1].value = "";
            boxes[i - 1].focus();
          } else if (e.key === "ArrowLeft" && i > 0) {
            e.preventDefault();
            boxes[i - 1].focus();
          } else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) {
            e.preventDefault();
            boxes[i + 1].focus();
          }
        });
        box.addEventListener("paste", (e) => {
          e.preventDefault();
          const digits = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
          if (digits) fillFrom(i, digits);
        });
        box.addEventListener("focus", () => box.select());
      });
      boxes[0].focus();

      otpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showError(otpError, "");
        showHint(otpHint, "");
        const code = getCode();
        if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) {
          showError(otpError, `Enter all ${CODE_LENGTH} digits`);
          const firstEmpty = boxes.find((b) => !b.value);
          if (firstEmpty) firstEmpty.focus();
          return;
        }
        const btn = otpForm.querySelector("button[type=submit]");
        setLoading(btn, true);
        try {
          const data = await api(`${apiBase}/verify-otp`, {
            method: "POST",
            body: JSON.stringify({ pendingToken: pending.pendingToken, code }),
          });
          sessionStorage.removeItem(OTP_KEY);
          if (data.passwordChangeRequired) {
            sessionStorage.setItem(CHANGE_KEY, data.changeToken);
            window.location.href = "ForceChangePasswordPage.html";
          } else if (pending.flow === "admin") {
            localStorage.setItem("adminToken", data.token);
            localStorage.setItem("adminUser", data.admin.email);
            window.location.href = "AdminDashboard.html";
          } else {
            setSession(data.token, data.user.email);
            window.location.href = "LandingPage.html";
          }
        } catch (err) {
          if (err.data?.restart) restart(err.message);
          else {
            showError(otpError, err.message);
            clearBoxes();
          }
        } finally {
          setLoading(btn, false);
        }
      });

      resendLink.addEventListener("click", async (e) => {
        e.preventDefault();
        if (Date.now() < cooldownUntil) return;
        showError(otpError, "");
        cooldownUntil = Date.now() + 5000;
        try {
          await api(`${apiBase}/resend-otp`, {
            method: "POST",
            body: JSON.stringify({ pendingToken: pending.pendingToken }),
          });
          showHint(otpHint, "We sent you a new code.");
          startCooldown(60);
        } catch (err) {
          if (err.data?.restart) restart(err.message);
          else {
            showError(otpError, err.message);
            startCooldown(err.data?.retryAfter || 5);
          }
        }
      });
    }
  }

  if (forceChangeForm) {
    const changeToken = sessionStorage.getItem(CHANGE_KEY);
    if (!changeToken) {
      window.location.href = "LoginPage.html";
    } else {
      const changeError = document.getElementById("changeError");
      forceChangeForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showError(changeError, "");
        const password = document.getElementById("changePassword").value;
        const confirmPassword = document.getElementById("changeConfirmPassword").value;
        if (password !== confirmPassword) {
          showError(changeError, "Passwords do not match");
          return;
        }
        const changeProblem = window.PasswordRules ? PasswordRules.problem(password) : null;
        if (changeProblem) {
          showError(changeError, changeProblem);
          return;
        }
        const btn = forceChangeForm.querySelector("button[type=submit]");
        setLoading(btn, true);
        try {
          const data = await api("/api/auth/force-change-password", {
            method: "POST",
            body: JSON.stringify({ changeToken, password, confirmPassword }),
          });
          sessionStorage.removeItem(CHANGE_KEY);
          setSession(data.token, data.user.email);
          window.location.href = "LandingPage.html";
        } catch (err) {
          showError(changeError, err.message);
          if (err.data?.restart) {
            sessionStorage.removeItem(CHANGE_KEY);
            setTimeout(() => (window.location.href = "LoginPage.html"), 1800);
          }
        } finally {
          setLoading(btn, false);
        }
      });
    }
  }

  if (forgotForm) {
    const forgotError = document.getElementById("forgotError");
    const forgotHint = document.getElementById("forgotHint");
    const forgotEmailInput = document.getElementById("forgotEmail");
    const forgotEmailCheck = window.EmailCheck ? EmailCheck.attach(forgotEmailInput) : null;
    forgotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError(forgotError, "");
      showHint(forgotHint, "");
      const email = document.getElementById("forgotEmail").value.trim();
      if (!email) {
        showError(forgotError, "Email is required");
        return;
      }
      if (forgotEmailCheck && !forgotEmailCheck.check()) {
        forgotEmailInput.focus();
        return;
      }
      const btn = forgotForm.querySelector("button[type=submit]");
      setLoading(btn, true);
      try {
        const data = await api("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        showHint(forgotHint, data.message);
      } catch (err) {
        showError(forgotError, err.message);
      } finally {
        setLoading(btn, false);
      }
    });
  }

  if (resetForm) {
    const resetError = document.getElementById("resetError");
    const resetHint = document.getElementById("resetHint");
    const resetToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
    history.replaceState(null, "", window.location.pathname);
    if (!resetToken) showError(resetError, "This reset link is invalid or has expired.");

    resetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError(resetError, "");
      const password = document.getElementById("resetPassword").value;
      const confirmPassword = document.getElementById("resetConfirmPassword").value;
      if (password !== confirmPassword) {
        showError(resetError, "Passwords do not match");
        return;
      }
      const resetProblem = window.PasswordRules ? PasswordRules.problem(password) : null;
      if (resetProblem) {
        showError(resetError, resetProblem);
        return;
      }
      const btn = resetForm.querySelector("button[type=submit]");
      setLoading(btn, true);
      try {
        const data = await api("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token: resetToken, password, confirmPassword }),
        });
        clearSession();
        showHint(resetHint, data.message);
        setTimeout(() => (window.location.href = "LoginPage.html"), 1500);
      } catch (err) {
        showError(resetError, err.message);
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
        welcomeTitle.textContent = "You're signed in";
        if (welcomeSub) welcomeSub.hidden = false;
        const details = document.getElementById("accountDetails");
        const emailEl = document.getElementById("accountEmail");
        const sinceEl = document.getElementById("accountSince");
        const sinceRow = document.getElementById("accountSinceRow");
        const d = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "";
        if (emailEl) emailEl.textContent = user.email;
        if (sinceEl) sinceEl.textContent = d;
        if (sinceRow) sinceRow.hidden = !d;
        if (details) details.hidden = false;
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
