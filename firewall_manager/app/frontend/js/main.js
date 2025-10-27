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

startRouter();


