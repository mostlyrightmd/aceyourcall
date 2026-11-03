/* Shared, pre-paint theme state for React and standalone legal pages. */
(() => {
  const key = "mp.theme.v1",
    root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  let choice = "system";
  try {
    const saved = localStorage.getItem(key);
    if (["light", "dark"].includes(saved)) choice = saved;
  } catch {}
  let timer;
  const resolved = () =>
    choice === "system" ? (system.matches ? "dark" : "light") : choice;
  function apply(animate = false) {
    if (animate) {
      root.classList.add("theme-changing");
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove("theme-changing"), 300);
    }
    root.dataset.theme = resolved();
    root.style.colorScheme = resolved();
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved() === "dark" ? "#080808" : "#f7f7f5");
    window.dispatchEvent(new Event("mp-theme-change"));
  }
  window.mpTheme = {
    get choice() {
      return choice;
    },
    get resolved() {
      return resolved();
    },
    set(value) {
      if (!["system", "light", "dark"].includes(value)) return;
      choice = value;
      try {
        if (value === "system") localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {}
      apply(true);
    },
  };
  system.addEventListener("change", () => {
    if (choice === "system") apply(true);
  });
  window.addEventListener("storage", (e) => {
    if (e.key === key || e.key === null) {
      choice = ["light", "dark"].includes(e.newValue) ? e.newValue : "system";
      apply(true);
    }
  });
  apply();
  // SVG markup exported unchanged from @tabler/icons-react (IconSun / IconMoon).
  const icons = {
    sun: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-sun" aria-hidden="true"><path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"></path><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"></path></svg>',
    moon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-moon" aria-hidden="true"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"></path></svg>',
  };
  class ThemeToggle extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `<button type="button" class="theme-toggle"><span class="theme-sun">${icons.sun}</span><span class="theme-moon">${icons.moon}</span></button>`;
      this.button = this.querySelector("button");
      this.update = () => {
        const label = `Switch to ${resolved() === "dark" ? "light" : "dark"} theme`;
        this.button.setAttribute("aria-label", label);
        this.button.title = label;
      };
      this.button.onclick = () =>
        window.mpTheme.set(resolved() === "dark" ? "light" : "dark");
      window.addEventListener("mp-theme-change", this.update);
      this.update();
    }
    disconnectedCallback() {
      window.removeEventListener("mp-theme-change", this.update);
    }
  }
  customElements.define("theme-toggle", ThemeToggle);
})();
