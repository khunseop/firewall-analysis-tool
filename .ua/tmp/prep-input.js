const fs = require('fs');
const d = JSON.parse(fs.readFileSync('/Users/hoon/Code/firewall-analysis-tool/.ua/intermediate/assembled-graph.json', 'utf8'));

const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
const fileNodes = d.nodes.filter(n => fileLevelTypes.has(n.type));
const fileIds = new Set(fileNodes.map(n => n.id));

const allEdges = d.edges.filter(e => fileIds.has(e.source) && fileIds.has(e.target));
const importEdges = allEdges.filter(e => e.type === 'imports');

const out = { fileNodes, importEdges, allEdges };
fs.writeFileSync('/Users/hoon/Code/firewall-analysis-tool/.ua/tmp/ua-arch-input.json', JSON.stringify(out));
console.log('fileNodes', fileNodes.length, 'importEdges', importEdges.length, 'allEdges', allEdges.length);
