const routes = {};

export function addRoute(path, config) {
  // config: { template: string, init?: (rootEl: HTMLElement) => void }
  routes[path] = config;
}

export function getCurrentPath() {
  const hash = location.hash || "#/dashboard";
  const [path, query] = hash.split("?");
  return { path, query: new URLSearchParams(query || "") };
}

export function navigate(path) {
  if (location.hash !== `#/${path.replace(/^#\//, "")}`) {
    location.hash = `#/${path}`;
  } else {
    render();
  }
}

export async function render() {
  const { path } = getCurrentPath();
  const app = document.getElementById("app");
  const route = routes[path] || routes["#/dashboard"];
  // Reset container
  app.innerHTML = "";
  if (route && route.template) {
    try {
      const res = await fetch(`/app/templates/${route.template}`);
      const html = await res.text();
      app.innerHTML = html;
      if (typeof route.init === 'function') {
        route.init(app);
      }
    } catch (e) {
      app.innerHTML = `<p class="help is-danger">페이지를 불러오지 못했습니다.</p>`;
    }
  }
  // Activate current nav item
  document.querySelectorAll('.navbar-item[href^="#/"]').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('is-active');
    else a.classList.remove('is-active');
  });
}

export function startRouter() {
  window.addEventListener("hashchange", () => { render(); });
  render();
}


