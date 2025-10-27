const routes = {};

export function addRoute(path, render) {
  routes[path] = render;
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

export function render() {
  const { path } = getCurrentPath();
  const app = document.getElementById("app");
  const page = routes[path] || routes["#/dashboard"];
  app.innerHTML = page ? page() : "";
  // Activate current nav item
  document.querySelectorAll('.navbar-item[href^="#/"]').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('is-active');
    else a.classList.remove('is-active');
  });
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  render();
}


