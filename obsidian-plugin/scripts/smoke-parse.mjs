#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, relative } from 'node:path';

const EXAMPLE_ROOT = new URL('../../examples/taskops-canonical-minimal-v1', import.meta.url).pathname;

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const yaml = content.slice(4, end);
  const fm = {};
  const lines = yaml.split('\n');
  let currentListKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    const keyMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (keyMatch) {
      currentListKey = null;
      let value = keyMatch[2];
      if (value === '') {
        fm[keyMatch[1]] = [];
        currentListKey = keyMatch[1];
      } else if (/^\d+$/.test(value)) fm[keyMatch[1]] = Number(value);
      else if (value === 'true') fm[keyMatch[1]] = true;
      else if (value === 'false') fm[keyMatch[1]] = false;
      else fm[keyMatch[1]] = value;
      continue;
    }
    const listMatch = line.match(/^\s*-\s*(.*)$/);
    if (listMatch && currentListKey) {
      fm[currentListKey].push(listMatch[1]);
    }
  }
  return fm;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = walk(EXAMPLE_ROOT);
const projects = [];
for (const path of files) {
  if (basename(path) !== 'index.md') continue;
  const fm = parseFrontmatter(readFileSync(path, 'utf8'));
  if (!fm || fm.entityType !== 'project') continue;
  projects.push({ path, fm, root: dirname(path) });
}
if (projects.length !== 1) {
  console.error(`FAIL: expected 1 project, found ${projects.length}`);
  process.exit(1);
}

const project = projects[0];
console.log(`project: ${project.fm.id} status=${project.fm.status} at ${relative(EXAMPLE_ROOT, project.path)}`);
let taskGroups = 0;
let versions = 0;
let tasks = 0;
let snapshots = 0;
let runNodes = 0;
let runEdges = 0;

for (const tgName of readdirSync(join(project.root, 'task-groups'))) {
  const tgDir = join(project.root, 'task-groups', tgName);
  if (!statSync(tgDir).isDirectory()) continue;
  const tgFm = parseFrontmatter(readFileSync(join(tgDir, 'index.md'), 'utf8'));
  if (tgFm?.entityType !== 'taskGroup') throw new Error(`Expected taskGroup at ${tgDir}`);
  taskGroups++;
  console.log(`  taskGroup: ${tgFm.id}`);
  for (const versionName of readdirSync(join(tgDir, 'versions'))) {
    const versionDir = join(tgDir, 'versions', versionName);
    if (!statSync(versionDir).isDirectory()) continue;
    const versionFm = parseFrontmatter(readFileSync(join(versionDir, 'index.md'), 'utf8'));
    if (versionFm?.entityType !== 'taskGroupVersion') throw new Error(`Expected taskGroupVersion at ${versionDir}`);
    versions++;
    console.log(`    version: ${versionFm.id}`);
    for (const taskName of readdirSync(join(versionDir, 'tasks'))) {
      if (!taskName.endsWith('.md')) continue;
      const taskFm = parseFrontmatter(readFileSync(join(versionDir, 'tasks', taskName), 'utf8'));
      if (taskFm?.entityType !== 'task') throw new Error(`Expected task at ${taskName}`);
      tasks++;
      console.log(`      task: ${taskFm.id}`);
    }
  }
}
for (const snapName of readdirSync(join(project.root, 'snapshots'))) {
  if (!snapName.endsWith('.md')) continue;
  const fm = parseFrontmatter(readFileSync(join(project.root, 'snapshots', snapName), 'utf8'));
  if (fm?.entityType !== 'versionSnapshot') throw new Error(`Expected versionSnapshot at ${snapName}`);
  snapshots++;
  console.log(`  snapshot: ${fm.id}`);
}
for (const runNodeName of readdirSync(join(project.root, 'run', 'nodes'))) {
  if (!runNodeName.endsWith('.md')) continue;
  const fm = parseFrontmatter(readFileSync(join(project.root, 'run', 'nodes', runNodeName), 'utf8'));
  if (fm?.entityType !== 'runNode') throw new Error(`Expected runNode at ${runNodeName}`);
  runNodes++;
  console.log(`  runNode: ${fm.id}`);
}
for (const runEdgeName of readdirSync(join(project.root, 'run', 'edges'))) {
  if (!runEdgeName.endsWith('.md')) continue;
  const fm = parseFrontmatter(readFileSync(join(project.root, 'run', 'edges', runEdgeName), 'utf8'));
  if (fm?.entityType !== 'runEdge') throw new Error(`Expected runEdge at ${runEdgeName}`);
  runEdges++;
  console.log(`  runEdge: ${fm.id}`);
}

console.log(`\nOK: projects=1 taskGroups=${taskGroups} versions=${versions} tasks=${tasks} snapshots=${snapshots} runNodes=${runNodes} runEdges=${runEdges}`);
if (taskGroups !== 2 || versions !== 2 || tasks !== 5 || snapshots !== 1 || runNodes !== 2 || runEdges !== 1) {
  console.error('FAIL: counts do not match expected canonical example');
  process.exit(1);
}
