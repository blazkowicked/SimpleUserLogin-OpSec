// Email format check (F4). Catches obvious typos in the browser so the user gets an
// instant message instead of a round trip. The server still runs its own stricter check,
// and the emailed code is what proves the address is real.
(function () {
  const MESSAGE = "Enter a valid email, like name@example.com";

  function looksLikeEmail(value) {
    return value.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
  }

  // Shows an inline error under the input when the user leaves the field with a bad address.
  // Returns { check } so the form can run the same check on submit.
  function attach(input) {
    if (!input) return null;
    const error = document.createElement("div");
    error.id = `${input.id}-error`;
    error.className = "field-error";
    error.setAttribute("aria-live", "polite");
    const field = input.closest(".field");
    if (field) field.append(error);
    else input.after(error);
    const described = input.getAttribute("aria-describedby");
    input.setAttribute("aria-describedby", described ? `${described} ${error.id}` : error.id);
    const wrap = input.closest(".input-wrap");

    function check() {
      const value = input.value.trim();
      const bad = value !== "" && !looksLikeEmail(value);
      error.textContent = bad ? MESSAGE : "";
      if (wrap) wrap.classList.toggle("is-invalid", bad);
      input.setAttribute("aria-invalid", bad ? "true" : "false");
      return !bad;
    }

    input.addEventListener("blur", check);
    // Once an error is showing, clear it as soon as the address is fixed
    input.addEventListener("input", () => {
      if (error.textContent) check();
    });
    return { check };
  }

  window.EmailCheck = { looksLikeEmail, attach };
})();
