// Password checklist. Mirrors utils/passwordPolicy.js on the server.
// This only helps the user while typing; the server is what enforces the rules.
(function () {
  const MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes

  const RULES = [
    { label: "At least 8 characters", message: "Password must be at least 8 characters", test: (p) => p.length >= 8 },
    { label: "An uppercase letter", message: "Password must contain an uppercase letter", test: (p) => /[A-Z]/.test(p) },
    { label: "A lowercase letter", message: "Password must contain a lowercase letter", test: (p) => /[a-z]/.test(p) },
    { label: "A number", message: "Password must contain a number", test: (p) => /[0-9]/.test(p) },
    { label: "A symbol (like ! @ # ?)", message: "Password must contain a symbol", test: (p) => /[^A-Za-z0-9]/.test(p) },
  ];
  const TOO_LONG = "Password is too long (72 characters max)";

  function byteLength(p) {
    return new TextEncoder().encode(p).length;
  }

  // Same order and messages as the server, so both report the same first problem
  function problem(p) {
    if (!p) return "Password is required";
    const failed = RULES.find((rule) => !rule.test(p));
    if (failed) return failed.message;
    if (byteLength(p) > MAX_BYTES) return TOO_LONG;
    return null;
  }

  function makeRule(label) {
    const li = document.createElement("li");
    li.className = "pw-rule";
    const icon = document.createElement("span");
    icon.className = "pw-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    const state = document.createElement("span");
    state.className = "sr-only";
    li.append(icon, text, state);
    return { li, icon, state };
  }

  function setState(item, status) {
    item.li.classList.toggle("met", status === "met");
    item.li.classList.toggle("unmet", status === "unmet");
    item.icon.textContent = status === "met" ? "✓" : status === "unmet" ? "✕" : "○";
    item.state.textContent = status === "met" ? " (done)" : " (not done)";
  }

  // Adds a live checklist under a password input. Returns { update } so callers can refresh it after clearing the field.
  function attach(input) {
    if (!input) return null;
    const list = document.createElement("ul");
    list.className = "pw-checklist";
    list.id = `${input.id}-rules`;
    list.setAttribute("aria-label", "Password requirements");

    const items = RULES.map((rule) => ({ rule, ...makeRule(rule.label) }));
    const tooLong = makeRule("72 characters or fewer");
    tooLong.li.hidden = true;
    items.forEach((item) => list.append(item.li));
    list.append(tooLong.li);

    // Screen readers hear a short note when a rule is newly met, not the whole list on every keystroke
    const live = document.createElement("div");
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");

    const anchor = input.closest(".field") || input.closest(".password-wrap") || input;
    if (anchor === input.closest(".field")) anchor.append(list, live);
    else anchor.after(list, live);

    const described = input.getAttribute("aria-describedby");
    input.setAttribute("aria-describedby", described ? `${described} ${list.id}` : list.id);

    let previous = items.map(() => false);

    function update() {
      const value = input.value;
      const newlyMet = [];
      items.forEach((item, i) => {
        const met = item.rule.test(value);
        setState(item, met ? "met" : "pending");
        if (met && !previous[i]) newlyMet.push(item.rule.label);
        previous[i] = met;
      });
      const over = byteLength(value) > MAX_BYTES;
      tooLong.li.hidden = !over;
      if (over) setState(tooLong, "unmet");
      live.textContent = over ? TOO_LONG : newlyMet.length ? `${newlyMet.join(", ")}: done` : "";
    }

    input.addEventListener("input", update);
    update();
    return { update };
  }

  window.PasswordRules = { problem, attach };
})();
