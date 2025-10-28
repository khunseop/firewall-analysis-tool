let noticeQueue = [];
let noticeTimer = null;

export function pushNotice(message, level = "info", ttlMs = 4000) {
  noticeQueue.push({ message, level, ttlMs });
  renderNextNotice();
}

function renderNextNotice(){
  if (noticeTimer) return; // currently showing
  const next = noticeQueue.shift();
  if (!next) return;
  const host = document.getElementById('navbar-notices');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `notice-item ${next.level}`;
  el.textContent = next.message;
  host.appendChild(el);
  noticeTimer = setTimeout(()=>{
    try { host.removeChild(el); } catch {}
    noticeTimer = null;
    renderNextNotice();
  }, next.ttlMs);
}

export function Navbar() {
  return `
    <div class="page-title">Firewall Analysis Tool</div>
    <div id="navbar-notices" class="navbar-notices"></div>
  `;
}


