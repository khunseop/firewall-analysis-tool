const fs = require('fs');
const path = require('path');

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw);
  const { fileNodes, importEdges, allEdges } = data;

  const nodeById = new Map();
  for (const n of fileNodes) nodeById.set(n.id, n);

  // A. Directory grouping
  const filePaths = fileNodes.map(n => n.filePath || n.name || '');
  function commonPrefix(paths) {
    if (paths.length === 0) return '';
    let prefix = paths[0].split('/');
    for (const p of paths.slice(1)) {
      const parts = p.split('/');
      let i = 0;
      while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) i++;
      prefix = prefix.slice(0, i);
      if (prefix.length === 0) break;
    }
    return prefix.length ? prefix.join('/') + '/' : '';
  }
  const prefix = commonPrefix(filePaths);

  function groupOf(filePath) {
    let rest = filePath;
    if (prefix && rest.startsWith(prefix)) rest = rest.slice(prefix.length);
    const parts = rest.split('/');
    if (parts.length > 1) return parts[0];
    // flat structure: group by file type/extension pattern
    const base = parts[0];
    if (/\.test\.|\.spec\.|^test_|_test\.go$|Test\.java$|_spec\.rb$|Test\.php$|Tests\.cs$/.test(base)) return 'test';
    if (/\.config\./.test(base)) return 'config';
    const ext = base.includes('.') ? base.split('.').pop() : 'root';
    return ext || 'root';
  }

  const directoryGroups = {};
  for (const n of fileNodes) {
    const g = groupOf(n.filePath || n.name || '');
    if (!directoryGroups[g]) directoryGroups[g] = [];
    directoryGroups[g].push(n.id);
  }

  // B. Node type grouping
  const nodeTypeGroups = {};
  for (const n of fileNodes) {
    const t = n.type || 'file';
    if (!nodeTypeGroups[t]) nodeTypeGroups[t] = [];
    nodeTypeGroups[t].push(n.id);
  }

  // C. Import adjacency matrix
  const fileFanOut = {};
  const fileFanIn = {};
  for (const n of fileNodes) { fileFanOut[n.id] = 0; fileFanIn[n.id] = 0; }
  for (const e of importEdges) {
    if (fileFanOut[e.source] !== undefined) fileFanOut[e.source]++;
    if (fileFanIn[e.target] !== undefined) fileFanIn[e.target]++;
  }

  function idToGroup(id) {
    const n = nodeById.get(id);
    if (!n) return undefined;
    return groupOf(n.filePath || n.name || '');
  }

  // D. Cross-category dependency analysis (using allEdges, non-import types)
  const crossCategoryMap = new Map();
  for (const e of allEdges) {
    if (e.type === 'imports') continue;
    const sn = nodeById.get(e.source);
    const tn = nodeById.get(e.target);
    if (!sn || !tn) continue;
    if (sn.type === tn.type) continue;
    const key = `${sn.type}|${tn.type}|${e.type}`;
    crossCategoryMap.set(key, (crossCategoryMap.get(key) || 0) + 1);
  }
  const crossCategoryEdges = [];
  for (const [key, count] of crossCategoryMap) {
    const [fromType, toType, edgeType] = key.split('|');
    crossCategoryEdges.push({ fromType, toType, edgeType, count });
  }

  // E. Inter-group import frequency
  const interGroupMap = new Map();
  for (const e of importEdges) {
    const sg = idToGroup(e.source);
    const tg = idToGroup(e.target);
    if (!sg || !tg || sg === tg) continue;
    const key = `${sg}|${tg}`;
    interGroupMap.set(key, (interGroupMap.get(key) || 0) + 1);
  }
  const interGroupImports = [];
  for (const [key, count] of interGroupMap) {
    const [from, to] = key.split('|');
    interGroupImports.push({ from, to, count });
  }

  // F. Intra-group import density
  const intraGroupDensity = {};
  for (const g of Object.keys(directoryGroups)) {
    let internal = 0;
    let total = 0;
    for (const e of importEdges) {
      const sg = idToGroup(e.source);
      const tg = idToGroup(e.target);
      if (sg === g || tg === g) {
        total++;
        if (sg === g && tg === g) internal++;
      }
    }
    intraGroupDensity[g] = { internalEdges: internal, totalEdges: total, density: total ? +(internal / total).toFixed(3) : 0 };
  }

  // G. Directory pattern matching
  const patternTable = [
    [['routes', 'api', 'controllers', 'endpoints', 'handlers', 'controller', 'routers', 'blueprints', 'serializers'], 'api'],
    [['services', 'core', 'lib', 'domain', 'logic', 'signals', 'composables', 'internal', 'mailers', 'jobs', 'channels'], 'service'],
    [['models', 'db', 'data', 'persistence', 'repository', 'entities', 'migrations', 'entity', 'sql', 'database', 'schema'], 'data'],
    [['components', 'views', 'pages', 'ui', 'layouts', 'screens'], 'ui'],
    [['middleware', 'plugins', 'interceptors', 'guards'], 'middleware'],
    [['utils', 'helpers', 'common', 'shared', 'tools', 'templatetags', 'pkg'], 'utility'],
    [['config', 'constants', 'env', 'settings', 'management', 'commands'], 'config'],
    [['__tests__', 'test', 'tests', 'spec', 'specs'], 'test'],
    [['types', 'interfaces', 'schemas', 'contracts', 'dtos', 'dto', 'request', 'response'], 'types'],
    [['hooks'], 'hooks'],
    [['store', 'state', 'reducers', 'actions', 'slices'], 'state'],
    [['assets', 'static', 'public'], 'assets'],
    [['cmd'], 'entry'],
    [['bin'], 'entry'],
    [['docs', 'documentation', 'wiki'], 'documentation'],
    [['deploy', 'deployment', 'infra', 'infrastructure', 'k8s', 'kubernetes', 'helm', 'charts', 'terraform', 'tf', 'docker'], 'infrastructure'],
    [['.github', '.gitlab', '.circleci'], 'ci-cd'],
  ];
  function matchPattern(dirName) {
    const lower = dirName.toLowerCase();
    for (const [names, label] of patternTable) {
      if (names.includes(lower)) return label;
    }
    return null;
  }
  const patternMatches = {};
  for (const g of Object.keys(directoryGroups)) {
    const m = matchPattern(g);
    if (m) patternMatches[g] = m;
  }

  // H. Deployment topology detection
  const infraFiles = [];
  let hasDockerfile = false, hasCompose = false, hasK8s = false, hasTerraform = false, hasCI = false;
  for (const n of fileNodes) {
    const fp = n.filePath || n.name || '';
    const base = path.basename(fp);
    if (/^Dockerfile/.test(base)) { hasDockerfile = true; infraFiles.push(fp); }
    if (/docker-compose/.test(base)) { hasCompose = true; infraFiles.push(fp); }
    if (/\.ya?ml$/.test(base) && /k8s|kubernetes/i.test(fp)) { hasK8s = true; infraFiles.push(fp); }
    if (/\.tf$|\.tfvars$/.test(base)) { hasTerraform = true; infraFiles.push(fp); }
    if (/\.github\/workflows\//.test(fp) || /\.gitlab-ci\.yml/.test(base) || base === 'Jenkinsfile') { hasCI = true; infraFiles.push(fp); }
    if (base === 'Makefile') infraFiles.push(fp);
  }
  const deploymentTopology = {
    hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI,
    infraFiles: [...new Set(infraFiles)],
  };

  // I. Data pipeline detection
  const schemaFiles = [];
  const migrationFiles = [];
  const dataModelFiles = [];
  const apiHandlerFiles = [];
  for (const n of fileNodes) {
    const fp = n.filePath || n.name || '';
    if (/\.sql$/.test(fp) || /\.graphql$|\.gql$|\.proto$/.test(fp)) schemaFiles.push(fp);
    if (/migrations\//.test(fp)) migrationFiles.push(fp);
    if (/models\//.test(fp) || /\/models\.py$/.test(fp)) dataModelFiles.push(fp);
    if (/api\/|routes\/|endpoints\//.test(fp)) apiHandlerFiles.push(fp);
  }
  const dataPipeline = { schemaFiles, migrationFiles, dataModelFiles, apiHandlerFiles };

  // J. Documentation coverage
  const docFiles = fileNodes.filter(n => n.type === 'document' || /\.md$|\.rst$/.test(n.filePath || ''));
  const groupsWithDocsSet = new Set();
  for (const d of docFiles) {
    const g = groupOf(d.filePath || d.name || '');
    groupsWithDocsSet.add(g);
  }
  const totalGroups = Object.keys(directoryGroups).length;
  const groupsWithDocs = [...groupsWithDocsSet].filter(g => directoryGroups[g]).length;
  const undocumentedGroups = Object.keys(directoryGroups).filter(g => !groupsWithDocsSet.has(g));
  const docCoverage = {
    groupsWithDocs,
    totalGroups,
    coverageRatio: totalGroups ? +(groupsWithDocs / totalGroups).toFixed(2) : 0,
    undocumentedGroups,
  };

  // K. Dependency direction
  const dependencyDirection = [];
  const seenPairs = new Set();
  for (const { from, to, count } of interGroupImports) {
    const pairKey = [from, to].sort().join('|');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const reverse = interGroupImports.find(x => x.from === to && x.to === from);
    const reverseCount = reverse ? reverse.count : 0;
    if (count > reverseCount) {
      dependencyDirection.push({ dependent: from, dependsOn: to });
    } else if (reverseCount > count) {
      dependencyDirection.push({ dependent: to, dependsOn: from });
    }
  }

  // fileStats
  const filesPerGroup = {};
  for (const g of Object.keys(directoryGroups)) filesPerGroup[g] = directoryGroups[g].length;
  const nodeTypeCounts = {};
  for (const t of Object.keys(nodeTypeGroups)) nodeTypeCounts[t] = nodeTypeGroups[t].length;

  const result = {
    scriptCompleted: true,
    directoryGroups,
    nodeTypeGroups,
    crossCategoryEdges,
    interGroupImports,
    intraGroupDensity,
    patternMatches,
    deploymentTopology,
    dataPipeline,
    docCoverage,
    dependencyDirection,
    fileStats: {
      totalFileNodes: fileNodes.length,
      filesPerGroup,
      nodeTypeCounts,
    },
    fileFanIn,
    fileFanOut,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log('Analysis complete. Output written to', outputPath);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('Fatal error:', err.stack || err.message);
  process.exit(1);
}
