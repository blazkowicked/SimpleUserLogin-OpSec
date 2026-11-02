// Show/hide toggle for password fields on pages that don't load index.js
(() => {
  const eye = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.93 10.93 0 0 1 12 19c-7 0-11-7-11-7a20.77 20.77 0 0 1 5.06-5.94"/><path d="M9.59 9.59A3.2 3.2 0 0 0 12 15.2a3.2 3.2 0 0 0 3.2-3.2 3.18 3.18 0 0 0-.59-1.81"/><path d="M1 1l22 22"/><path d="M10.58 10.58A3.2 3.2 0 0 0 14.42 14.42"/><path d="M14.12 14.12A3.2 3.2 0 0 1 9.88 9.88"/></svg>';
  document.querySelectorAll(".eye-btn[data-eye]").forEach((btn) => {
    const input = document.getElementById(btn.getAttribute("data-eye"));
    if (!input) return;
    btn.innerHTML = eye;
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? eyeOff : eye;
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
})();
