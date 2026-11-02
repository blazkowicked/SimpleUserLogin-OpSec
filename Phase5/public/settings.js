// Account settings: change password and signed-in devices
(() => {
  if (!window.OpSec) return;
  const { api, renderDevices } = window.OpSec;

  // ---------- change password ----------
  const form = document.getElementById("changePasswordForm");
  const current = document.getElementById("currentPassword");
  const next = document.getElementById("newPassword");
  const confirm = document.getElementById("confirmNewPassword");
  const err = document.getElementById("changePasswordError");
  const ok = document.getElementById("changePasswordSuccess");
  const checklist = window.PasswordRules ? PasswordRules.attach(next) : null;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    ok.textContent = "";
    if (!current.value || !next.value || !confirm.value) return (err.textContent = "Fill in all three fields");
    if (next.value !== confirm.value) return (err.textContent = "Passwords do not match");
    const problem = window.PasswordRules ? PasswordRules.problem(next.value) : null;
    if (problem) return (err.textContent = problem);
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      const data = await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current.value, password: next.value, confirmPassword: confirm.value }),
      });
      form.reset();
      if (checklist) checklist.update();
      const n = data.signedOut || 0;
      ok.textContent = n ? `Password updated. ${n} other ${n === 1 ? "device was" : "devices were"} signed out.` : "Password updated";
      loadDevices();
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Update password";
    }
  });

  // ---------- devices ----------
  const list = document.getElementById("deviceList");
  const devErr = document.getElementById("devicesError");
  const devOk = document.getElementById("devicesSuccess");
  const revokeOthers = document.getElementById("revokeOthers");

  async function logoutOne(session, btn) {
    btn.disabled = true;
    devErr.textContent = "";
    try {
      await api(`/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      devOk.textContent = `${session.device} was logged out`;
      loadDevices();
    } catch (e) {
      devErr.textContent = e.message;
      btn.disabled = false;
    }
  }

  async function loadDevices() {
    try {
      const { sessions } = await api("/api/auth/sessions");
      renderDevices(list, sessions, logoutOne);
      revokeOthers.disabled = sessions.filter((s) => !s.current).length === 0;
    } catch (e) {
      devErr.textContent = e.message;
    }
  }

  revokeOthers.addEventListener("click", async () => {
    devErr.textContent = "";
    devOk.textContent = "";
    revokeOthers.disabled = true;
    try {
      const data = await api("/api/auth/sessions/revoke-others", { method: "POST" });
      const n = data.signedOut || 0;
      devOk.textContent = n ? `${n} other ${n === 1 ? "device was" : "devices were"} logged out` : "No other devices were signed in";
    } catch (e) {
      devErr.textContent = e.message;
    }
    loadDevices();
  });

  loadDevices();
})();
