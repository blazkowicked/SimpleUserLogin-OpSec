// About: Contact an admin form
(() => {
  if (!window.OpSec) return;
  const { api } = window.OpSec;
  const form = document.getElementById("contactForm");
  const topic = document.getElementById("contactTopic");
  const message = document.getElementById("contactMessage");
  const err = document.getElementById("contactError");
  const ok = document.getElementById("contactSuccess");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    ok.textContent = "";
    if (!message.value.trim()) return (err.textContent = "Write a message so the admin knows what you need");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      // The server uses the signed-in account's email, not anything typed here
      const data = await api("/api/auth/contact", { method: "POST", body: JSON.stringify({ topic: topic.value, message: message.value }) });
      ok.textContent = data.message;
      message.value = "";
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Send request";
    }
  });
})();
