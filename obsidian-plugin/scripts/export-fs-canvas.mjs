#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('Usage: node scripts/export-fs-canvas.mjs <project-root>');
  process.exit(1);
}

function findVaultRoot(start) {
  let current = start;
  while (true) {
    const obsidianDir = join(current, '.obsidian');
    if (statSync(obsidianDir, { throwIfNoEntry: false })?.isDirectory()) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}
const vaultRoot = findVaultRoot(projectRoot);

function parseFrontmatter(path) {
  const content = readFileSync(path, 'utf8');
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const yaml = content.slice(4, end);
  const fm = {};
  const lines = yaml.split('\n');
  let currentKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    const keyMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      let value = keyMatch[2];
      if (value === '') fm[currentKey] = [];
      else if (value === 'true') fm[currentKey] = true;
      else if (value === 'false') fm[currentKey] = false;
      else fm[currentKey] = value;
      continue;
    }
    const listMatch = line.match(/^\s*-\s*(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(listMatch[1]);
    }
  }
  return fm;
}

function entityFromIndex(folder, expectedType) {
  const path = join(folder, 'index.md');
  const fm = parseFrontmatter(path);
  if (!fm || fm.entityType !== expectedType) throw new Error(`Expected ${expectedType} at ${path}`);
  return { type: expectedType, id: fm.id || basename(folder), title: fm.title || fm.summary || fm.objective || fm.id || basename(folder), status: fm.status || 'unknown', frontmatter: fm, file: { path: relative(vaultRoot, path).replace(/\\/g, '/') }, children: [] };
}

function entityFromFile(path, expectedType) {
  const fm = parseFrontmatter(path);
  if (!fm || fm.entityType !== expectedType) throw new Error(`Expected ${expectedType} at ${path}`);
  return { type: expectedType, id: fm.id || basename(path, '.md'), title: fm.title || fm.summary || fm.label || fm.id || basename(path, '.md'), status: fm.status || 'unknown', frontmatter: fm, file: { path: relative(vaultRoot, path).replace(/\\/g, '/') }, children: [] };
}

function listDirs(folder) { return readdirSync(folder).map((name) => join(folder, name)).filter((p) => statSync(p).isDirectory()).sort(); }
function listMd(folder) { return readdirSync(folder).map((name) => join(folder, name)).filter((p) => p.endsWith('.md')).sort(); }

function loadProject(root) {
  const project = entityFromIndex(root, 'project');
  for (const tgDir of listDirs(join(root, 'task-groups'))) {
    const taskGroup = entityFromIndex(tgDir, 'taskGroup');
    for (const versionDir of listDirs(join(tgDir, 'versions'))) {
      const version = entityFromIndex(versionDir, 'taskGroupVersion');
      for (const taskPath of listMd(join(versionDir, 'tasks'))) {
        version.children.push(entityFromFile(taskPath, 'task'));
      }
      taskGroup.children.push(version);
    }
    project.children.push(taskGroup);
  }
  for (const snapshotPath of listMd(join(root, 'snapshots'))) project.children.push(entityFromFile(snapshotPath, 'versionSnapshot'));
  const run = entityFromIndex(join(root, 'run'), 'run');
  for (const nodePath of listMd(join(root, 'run', 'nodes'))) run.children.push(entityFromFile(nodePath, 'runNode'));
  for (const edgePath of listMd(join(root, 'run', 'edges'))) run.children.push(entityFromFile(edgePath, 'runEdge'));
  project.children.push(run);
  return project;
}

const COLORS = { project: '#94A3B8', taskGroup: '#F59E0B', taskGroupVersion: '#60A5FA', task: '#10B981', versionSnapshot: '#8B5CF6', run: '#334155', runNode: '#2563EB', runEdge: '#64748B' };
const SIZE = { project: [320, 100], taskGroup: [280, 92], taskGroupVersion: [260, 84], task: [240, 78], versionSnapshot: [260, 84], run: [260, 84], runNode: [240, 78], runEdge: [220, 72] };
const key = (entity) => `${entity.type}-${entity.id}-${entity.file.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const fileNode = (entity, x, y, color) => ({ id: key(entity), type: 'file', file: entity.file.path, x, y, width: SIZE[entity.type][0], height: SIZE[entity.type][1], color });
const edge = (fromNode, toNode, color, label) => ({ id: `${fromNode}--${toNode}`, fromNode, toNode, fromSide: 'right', toSide: 'left', toEnd: 'arrow', color, label });

function taskGroupCanvas(project) {
  const nodes = [fileNode(project, 0, 0, COLORS.project)];
  const edges = [];
  project.children.filter((c) => c.type === 'taskGroup').forEach((taskGroup, tgIndex) => {
    const tgNode = fileNode(taskGroup, tgIndex * 920, 220, COLORS.taskGroup); nodes.push(tgNode); edges.push(edge(nodes[0].id, tgNode.id, COLORS.taskGroup, 'taskGroup'));
    taskGroup.children.forEach((version, versionIndex) => {
      const versionNode = fileNode(version, tgIndex * 920 + versionIndex * 280, 370, COLORS.taskGroupVersion); nodes.push(versionNode); edges.push(edge(tgNode.id, versionNode.id, COLORS.taskGroupVersion, version.frontmatter.selected === true ? 'selected' : 'version'));
      version.children.forEach((task, taskIndex) => { const taskNode = fileNode(task, tgIndex * 920 + versionIndex * 280, 510 + taskIndex * 104, COLORS.task); nodes.push(taskNode); edges.push(edge(versionNode.id, taskNode.id, COLORS.task, 'task')); });
    });
  });
  return { nodes, edges };
}

function snapshotCanvas(project) {
  const nodes = [fileNode(project, 0, 0, COLORS.project)];
  const edges = [];
  const versionNodes = new Map();
  project.children.filter((c) => c.type === 'taskGroup').forEach((taskGroup, tgIndex) => {
    taskGroup.children.forEach((version, versionIndex) => { const node = fileNode(version, 420 + tgIndex * 360, 320 + versionIndex * 140, COLORS.taskGroupVersion); versionNodes.set(version.id, node); nodes.push(node); });
  });
  project.children.filter((c) => c.type === 'versionSnapshot').forEach((snapshot, idx) => {
    const snapNode = fileNode(snapshot, idx * 340, 140, COLORS.versionSnapshot); nodes.push(snapNode); edges.push(edge(nodes[0].id, snapNode.id, COLORS.versionSnapshot, 'snapshot'));
  });
  return { nodes, edges };
}

function runCanvas(project) {
  const nodes = [fileNode(project, 0, 0, COLORS.project)];
  const edges = [];
  const run = project.children.find((c) => c.type === 'run');
  if (!run) return { nodes, edges };
  const runNode = fileNode(run, 0, 180, COLORS.run); nodes.push(runNode); edges.push(edge(nodes[0].id, runNode.id, COLORS.run, 'run'));
  run.children.filter((c) => c.type === 'runNode').forEach((child, idx) => { const node = fileNode(child, idx * 320, 340, COLORS.runNode); nodes.push(node); edges.push(edge(runNode.id, node.id, COLORS.runNode, String(child.frontmatter.type || 'runNode'))); });
  return { nodes, edges };
}

const project = loadProject(projectRoot);
const outDir = join(projectRoot, 'canvases');
mkdirSync(outDir, { recursive: true });
const outputs = { 'task-groups': taskGroupCanvas(project), snapshots: snapshotCanvas(project), run: runCanvas(project) };
for (const [mode, data] of Object.entries(outputs)) {
  const outPath = join(outDir, `${project.id}-${mode}-view.canvas`);
  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
  console.log(outPath);
}
