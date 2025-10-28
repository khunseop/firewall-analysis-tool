import { startRouter, addRoute } from "./router.js";
import { initDevices } from "./pages/devices.js";
import { initPolicies } from "./pages/policies.js";
import { initObjects } from "./pages/objects.js";

addRoute("#/dashboard", { template: "dashboard.html" });
addRoute("#/devices", { template: "devices.html", init: initDevices });
addRoute("#/policies", { template: "policies.html", init: initPolicies });
addRoute("#/objects", { template: "objects.html", init: initObjects });
addRoute("#/analysis", { template: "analysis.html" });

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


