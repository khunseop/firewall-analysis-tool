import { startRouter, addRoute } from "./router.js";
import { DashboardPage } from "./pages/dashboard.js";
import { DevicesPage } from "./pages/devices.js";
import { PoliciesPage } from "./pages/policies.js";
import { ObjectsPage } from "./pages/objects.js";
import { AnalysisPage } from "./pages/analysis.js";

addRoute("#/dashboard", DashboardPage);
addRoute("#/devices", DevicesPage);
addRoute("#/policies", PoliciesPage);
addRoute("#/objects", ObjectsPage);
addRoute("#/analysis", AnalysisPage);

// Bulma navbar burger toggle (per docs)
document.addEventListener('DOMContentLoaded', () => {
  const $navbarBurgers = Array.prototype.slice.call(document.querySelectorAll('.navbar-burger'), 0);
  $navbarBurgers.forEach( el => {
    el.addEventListener('click', () => {
      const target = el.dataset.target;
      const $target = document.getElementById(target);
      el.classList.toggle('is-active');
      if ($target) $target.classList.toggle('is-active');
    });
  });
});

startRouter();


