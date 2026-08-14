const fs = require('fs');
const { fileNodes } = JSON.parse(fs.readFileSync('/Users/hoon/Code/firewall-analysis-tool/.ua/tmp/ua-arch-input.json', 'utf8'));

function classify(n) {
  const fp = n.filePath;
  const t = n.type;

  if (t === 'document') return 'documentation';

  // config
  if (t === 'config') return 'config';

  // backend
  if (fp.startsWith('backend/app/api/')) return 'api';
  if (fp.startsWith('backend/app/services/')) return 'service';
  if (fp.startsWith('backend/app/crud/')) return 'data';
  if (fp.startsWith('backend/app/models/')) return 'data';
  if (fp.startsWith('backend/app/db/')) return 'data';
  if (fp.startsWith('backend/alembic/')) return 'data';
  if (fp === 'backend/migrate.py') return 'data';
  if (fp.startsWith('backend/app/schemas/')) return 'types';
  if (fp.startsWith('backend/app/core/')) return 'config';
  if (fp.startsWith('backend/app/static/')) return 'ui';
  if (fp.startsWith('backend/scripts/')) return 'scripts';
  if (fp === 'backend/app/main.py') return 'api';
  if (fp === 'backend/app/__init__.py') return 'config';
  if (fp.startsWith('backend/') && /^backend\/(cleanup_|reindex_device|debug_|smoke_test|create_admin)/.test(fp)) return 'scripts';
  if (fp === 'backend/create_admin.py') return 'scripts';

  // frontend
  if (fp.startsWith('frontend/src/api/')) return 'api';
  if (fp.startsWith('frontend/src/components/')) return 'ui';
  if (fp.startsWith('frontend/src/hooks/')) return 'ui';
  if (fp.startsWith('frontend/src/lib/')) return 'ui';
  if (fp.startsWith('frontend/src/store/')) return 'ui';
  if (fp.startsWith('frontend/src/types/')) return 'types';
  if (fp === 'frontend/src/App.tsx' || fp === 'frontend/src/App.css' || fp === 'frontend/src/main.tsx' || fp === 'frontend/src/index.css') return 'ui';
  if (fp === 'frontend/index.html') return 'ui';
  if (/^frontend\/(package\.json|tsconfig|vite\.config|eslint\.config|postcss\.config|tailwind\.config|components\.json)/.test(fp)) return 'config';

  // root
  if (/^(deploy\.bat|run_prod\.bat)$/.test(fp)) return 'config';
  if (fp.startsWith('scripts/')) return 'scripts';
  if (fp.startsWith('.ua/')) return 'config';

  return 'UNCLASSIFIED';
}

const groups = {};
for (const n of fileNodes) {
  const c = classify(n);
  if (!groups[c]) groups[c] = [];
  groups[c].push(n.id);
}
for (const [k, v] of Object.entries(groups)) console.log(k, v.length);
console.log('total', fileNodes.length);
fs.writeFileSync('/Users/hoon/Code/firewall-analysis-tool/.ua/tmp/classified.json', JSON.stringify(groups, null, 2));
