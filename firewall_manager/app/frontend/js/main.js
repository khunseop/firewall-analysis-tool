import { startRouter, addRoute } from "./router.js";
import { initDashboard, cleanupDashboard } from "./pages/dashboard.js";
import { initDevices, cleanupDevices } from "./pages/devices.js";
import { initPolicies } from "./pages/policies.js";
import { initObjects } from "./pages/objects.js";
import { initAnalysis } from "./pages/analysis.js";
import { initSchedules, cleanupSchedules } from "./pages/schedules.js";

addRoute("#/dashboard", { template: "dashboard.html", init: initDashboard, cleanup: cleanupDashboard });
addRoute("#/devices", { template: "devices.html", init: initDevices, cleanup: cleanupDevices });
addRoute("#/policies", { template: "policies.html", init: initPolicies });
addRoute("#/objects", { template: "objects.html", init: initObjects });
addRoute("#/analysis", { template: "analysis.html", init: initAnalysis });
addRoute("#/schedules", { template: "schedules.html", init: initSchedules, cleanup: cleanupSchedules });

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


