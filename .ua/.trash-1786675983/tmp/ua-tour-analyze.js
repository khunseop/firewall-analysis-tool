#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw);
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const layers = data.layers || [];

  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  // Fan-in / Fan-out
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }
  const outEdgesByType = new Map(); // node -> [{target, type}]
  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    fanOut.set(e.source, (fanOut.get(e.source) || 0) + 1);
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
    if (!outEdgesByType.has(e.source)) outEdgesByType.set(e.source, []);
    outEdgesByType.get(e.source).push({ target: e.target, type: e.type });
  }

  const fanInRanking = nodes.map(n => ({ id: n.id, fanIn: fanIn.get(n.id) || 0, name: n.name }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  const fanOutRanking = nodes.map(n => ({ id: n.id, fanOut: fanOut.get(n.id) || 0, name: n.name }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // Entry point candidates
  const entryFilenames = new Set(['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
    'server.ts', 'server.js', 'mod.rs', 'main.go', 'main.py', 'main.rs', 'manage.py', 'app.py',
    'wsgi.py', 'asgi.py', 'run.py', '__main__.py', 'Application.java', 'Main.java', 'Program.cs',
    'config.ru', 'index.php', 'App.swift', 'Application.kt', 'main.cpp', 'main.c']);

  const fanOutValues = nodes.map(n => fanOut.get(n.id) || 0).sort((a, b) => a - b);
  const fanInValues = nodes.map(n => fanIn.get(n.id) || 0).sort((a, b) => a - b);
  function percentileThreshold(sortedArr, percentileFromTop) {
    // top 10% threshold: value at index floor(len*0.9)
    const idx = Math.floor(sortedArr.length * (1 - percentileFromTop));
    return sortedArr[Math.min(idx, sortedArr.length - 1)];
  }
  const fanOutTop10Threshold = percentileThreshold(fanOutValues, 0.10);
  const fanInBottom25Threshold = sortedPercentileBottom(fanInValues, 0.25);

  function sortedPercentileBottom(sortedArr, pct) {
    const idx = Math.floor(sortedArr.length * pct);
    return sortedArr[Math.min(idx, sortedArr.length - 1)];
  }

  const entryPointScores = [];
  for (const n of nodes) {
    let score = 0;
    const filePath = n.filePath || '';
    const name = n.name || '';
    const depth = filePath.split('/').filter(Boolean).length;

    if (n.type === 'document') {
      const isRoot = depth <= 1;
      if (name === 'README.md' && isRoot) score += 5;
      else if (name.endsWith('.md') && isRoot) score += 2;
    } else if (n.type === 'file') {
      if (entryFilenames.has(name)) score += 3;
      if (depth <= 2) score += 1;
      if ((fanOut.get(n.id) || 0) >= fanOutTop10Threshold && fanOutTop10Threshold > 0) score += 1;
      if ((fanIn.get(n.id) || 0) <= fanInBottom25Threshold) score += 1;
    }
    if (score > 0) entryPointScores.push({ id: n.id, score, name: n.name, summary: n.summary || '' });
  }
  entryPointScores.sort((a, b) => b.score - a.score);
  const entryPointCandidates = entryPointScores.slice(0, 5);

  // BFS from top code entry point (skip documents)
  const codeEntryCandidates = entryPointScores.filter(c => {
    const nd = nodeById.get(c.id);
    return nd && nd.type !== 'document';
  });
  let startNode = codeEntryCandidates.length > 0 ? codeEntryCandidates[0].id : null;
  if (!startNode) {
    // fallback: any file node
    const anyFile = nodes.find(n => n.type === 'file');
    startNode = anyFile ? anyFile.id : (nodes[0] ? nodes[0].id : null);
  }

  const bfsOrder = [];
  const depthMap = {};
  const byDepth = {};
  if (startNode) {
    const visited = new Set([startNode]);
    const queue = [[startNode, 0]];
    while (queue.length > 0) {
      const [cur, depth] = queue.shift();
      bfsOrder.push(cur);
      depthMap[cur] = depth;
      if (!byDepth[depth]) byDepth[depth] = [];
      byDepth[depth].push(cur);
      const outs = outEdgesByType.get(cur) || [];
      for (const { target, type } of outs) {
        if ((type === 'imports' || type === 'calls') && !visited.has(target)) {
          visited.add(target);
          queue.push([target, depth + 1]);
        }
      }
    }
  }

  // Non-code file inventory
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) {
    const entry = { id: n.id, name: n.name, type: n.type, summary: n.summary || '' };
    if (n.type === 'document') nonCodeFiles.documentation.push(entry);
    else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push(entry);
    else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push(entry);
    else if (n.type === 'config') nonCodeFiles.config.push(entry);
  }

  // Tightly coupled clusters
  const edgeSet = new Set();
  for (const e of edges) {
    if ((e.type === 'imports' || e.type === 'calls')) {
      edgeSet.add(e.source + '->' + e.target);
    }
  }
  function hasEdge(a, b) { return edgeSet.has(a + '->' + b); }

  const pairClusters = [];
  const seenPairs = new Set();
  for (const e of edges) {
    if (e.type !== 'imports' && e.type !== 'calls') continue;
    const a = e.source, b = e.target;
    const key = [a, b].sort().join('|');
    if (seenPairs.has(key)) continue;
    if (hasEdge(a, b) && hasEdge(b, a)) {
      seenPairs.add(key);
      pairClusters.push(new Set([a, b]));
    }
  }

  // Expand clusters: add nodes connecting to 2+ existing members
  function edgeCountBetween(setNodes) {
    let count = 0;
    for (const e of edges) {
      if ((e.type === 'imports' || e.type === 'calls') && setNodes.has(e.source) && setNodes.has(e.target)) count++;
    }
    return count;
  }

  const expandedClusters = [];
  for (const cluster of pairClusters) {
    let current = new Set(cluster);
    let changed = true;
    while (changed && current.size < 5) {
      changed = false;
      const candidateCounts = new Map();
      for (const e of edges) {
        if (e.type !== 'imports' && e.type !== 'calls') continue;
        if (current.has(e.source) && !current.has(e.target)) {
          candidateCounts.set(e.target, (candidateCounts.get(e.target) || 0) + 1);
        } else if (current.has(e.target) && !current.has(e.source)) {
          candidateCounts.set(e.source, (candidateCounts.get(e.source) || 0) + 1);
        }
      }
      for (const [cand, cnt] of candidateCounts.entries()) {
        if (cnt >= 2 && current.size < 5) {
          current.add(cand);
          changed = true;
        }
      }
    }
    expandedClusters.push(current);
  }

  // Deduplicate clusters (by node set)
  const uniqueClusters = [];
  const seenSets = new Set();
  for (const c of expandedClusters) {
    const key = Array.from(c).sort().join('|');
    if (seenSets.has(key)) continue;
    seenSets.add(key);
    uniqueClusters.push(c);
  }

  const clusters = uniqueClusters
    .map(set => ({ nodes: Array.from(set), edgeCount: edgeCountBetween(set) }))
    .sort((a, b) => b.edgeCount - a.edgeCount)
    .slice(0, 10);

  // Layers
  const layersOut = { count: layers.length, list: layers.map(l => ({ id: l.id, name: l.name, description: l.description })) };

  // Node summary index
  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary || '' };
  }

  const result = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal: {
      startNode,
      order: bfsOrder,
      depthMap,
      byDepth
    },
    nonCodeFiles,
    clusters,
    layers: layersOut,
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('Fatal error:', err && err.stack ? err.stack : err);
  process.exit(1);
}
