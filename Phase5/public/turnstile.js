// Cloudflare Turnstile widget for the public forms. This only draws the check and hands
// over a token; the server verifies that token with Cloudflare before doing anything else.
(function () {
  let apiPromise = null;
  let siteKeyPromise = null;

  function loadApi() {
    if (!apiPromise) {
      apiPromise = new Promise((resolve, reject) => {
        if (window.turnstile) return resolve(window.turnstile);
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile unavailable")));
        script.onerror = () => reject(new Error("Turnstile script failed to load"));
        document.head.append(script);
      });
    }
    return apiPromise;
  }

  function loadSiteKey() {
    if (!siteKeyPromise) {
      siteKeyPromise = fetch("/api/config/turnstile")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Human check is not configured"))))
        .then((data) => data.siteKey);
    }
    return siteKeyPromise;
  }

  // Draws the widget in `container`. Returns { getToken, take } for the form to use.
  function mount(container) {
    if (!container) return null;
    let widgetId = null;
    let token = "";

    Promise.all([loadApi(), loadSiteKey()])
      .then(([turnstile, sitekey]) => {
        // The rectangle needs 300px. Fill the form when there's room, reach into the card's
        // padding when it's a little short, and only fall back to the square on very narrow screens.
        const width = container.clientWidth || 300;
        let size = "flexible";
        if (width < 300 && width >= 252) {
          size = "normal";
          container.classList.add("captcha-bleed");
        } else if (width < 252) {
          size = "compact";
        }
        widgetId = turnstile.render(container, {
          sitekey,
          theme: "dark",
          size,
          callback: (t) => (token = t),
          "expired-callback": () => (token = ""),
          "error-callback": () => (token = ""),
        });
      })
      .catch((err) => {
        console.warn("[turnstile]", err.message);
        container.classList.add("captcha-error");
        container.textContent = "The human check couldn't load. Check your connection or turn off content blockers, then refresh the page.";
      });

    function getToken() {
      if (token) return token;
      if (widgetId !== null && window.turnstile) return window.turnstile.getResponse(widgetId) || "";
      return "";
    }

    // Returns the current token and resets the widget. A token only works once, so every
    // submit needs a fresh one, including a retry after a wrong password.
    function take() {
      const current = getToken();
      token = "";
      if (current && widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
      return current;
    }

    return { getToken, take };
  }

  window.Captcha = { mount };
})();
