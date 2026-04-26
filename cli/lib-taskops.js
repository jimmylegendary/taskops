import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve, relative } from 'node:path';

export const STATUS_VALUES = ['pending', 'active', 'done', 'blocked', 'cancelled'];
export const ENTITY_TYPES = ['project', 'taskGroup', 'taskGroupVersion', 'task', 'versionSnapshot', 'run', 'runNode', 'runEdge'];

export function parseScalar(value) {
  const stripped = String(value).trim();
  if (stripped === 'true') return true;
  if (stripped === 'false') return false;
  if (/^-?\d+$/.test(stripped)) return Number(stripped);
  return stripped;
}

export function parseFrontmatterText(content, filePath = '<inline>') {
  if (!content.startsWith('---\n')) throw new Error(`Missing YAML frontmatter in ${filePath}`);
  const lines = content.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`Unclosed YAML frontmatter in ${filePath}`);

  const root = {};
  const stack = [{ indent: -1, container: root, kind: 'object' }];

  const setValue = (container, key, value) => {
    if (Array.isArray(container)) container.push(value);
    else container[key] = value;
  };

  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const trimmed = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];

    if (trimmed.startsWith('- ')) {
      if (!Array.isArray(parent.container)) throw new Error(`Invalid list item in ${filePath}: ${raw}`);
      const itemText = trimmed.slice(2);
      if (!itemText.includes(':')) {
        parent.container.push(parseScalar(itemText));
      } else {
        const obj = {};
        parent.container.push(obj);
        stack.push({ indent, container: obj, kind: 'object' });
        const idx = itemText.indexOf(':');
        const key = itemText.slice(0, idx).trim();
        const rest = itemText.slice(idx + 1).trim();
        if (rest === '') {
          obj[key] = [];
          stack.push({ indent: indent + 2, container: obj[key], kind: 'array' });
        } else {
          obj[key] = parseScalar(rest);
        }
      }
      continue;
    }

    const idx = trimmed.indexOf(':');
    if (idx === -1) throw new Error(`Invalid frontmatter line in ${filePath}: ${raw}`);
    const key = trimmed.slice(0, idx).trim();
    const rest = trimmed.slice(idx + 1).trim();
    if (rest === '') {
      const next = lines.slice(i + 1, end).find((line) => line.trim());
      const nextTrimmed = next ? next.trim() : '';
      const nextIndent = next ? next.match(/^\s*/)[0].length : indent + 2;
      const container = nextTrimmed.startsWith('- ') && nextIndent > indent ? [] : {};
      setValue(parent.container, key, container);
      stack.push({ indent, container, kind: Array.isArray(container) ? 'array' : 'object' });
    } else {
      setValue(parent.container, key, parseScalar(rest));
    }
  }

  return root;
}

export function parseMarkdownFile(filePath) {
  return parseFrontmatterText(readFileSync(filePath, 'utf8'), filePath);
}

export function readBody(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  return end === -1 ? content : lines.slice(end + 1).join('\n').trim();
}

function fileExists(path) {
  return existsSync(path);
}

function listDirs(path) {
  if (!fileExists(path)) return [];
  return readdirSync(path).map((name) => join(path, name)).filter((p) => statSync(p).isDirectory()).sort();
}

function listMd(path) {
  if (!fileExists(path)) return [];
  return readdirSync(path).map((name) => join(path, name)).filter((p) => p.endsWith('.md')).sort();
}

function checkFields(fm, required, filePath, errors) {
  for (const field of required) {
    if (!(field in fm) || fm[field] === '' || fm[field] == null) errors.push(`${filePath}: missing required field '${field}'`);
  }
}

export function discoverProjects(inputPath) {
  const full = resolve(inputPath);
  const st = statSync(full, { throwIfNoEntry: false });
  if (!st) throw new Error(`Path not found: ${inputPath}`);
  if (st.isFile()) return discoverProjects(dirname(full));
  const directIndex = join(full, 'index.md');
  if (fileExists(directIndex)) {
    try {
      const fm = parseMarkdownFile(directIndex);
      if (fm.entityType === 'project') return [full];
    } catch {}
  }
  const projects = listDirs(full).filter((dir) => {
    const indexPath = join(dir, 'index.md');
    if (!fileExists(indexPath)) return false;
    try {
      return parseMarkdownFile(indexPath).entityType === 'project';
    } catch {
      return false;
    }
  });
  if (projects.length === 0) throw new Error(`No TaskOps project found under ${inputPath}`);
  return projects;
}

export function parseProject(projectDir) {
  const errors = [];
  const warnings = [];
  const projectIndex = join(projectDir, 'index.md');
  const project = parseMarkdownFile(projectIndex);
  checkFields(project, ['taskOpsVersion', 'entityType', 'id', 'title', 'objective', 'activeRootTaskGroupId', 'createdAt', 'status'], projectIndex, errors);
  if (project.entityType !== 'project') errors.push(`${projectIndex}: entityType must be 'project'`);
  if (!STATUS_VALUES.includes(project.status)) errors.push(`${projectIndex}: invalid status '${project.status}'`);

  const taskGroups = new Map();
  const versions = new Map();
  const tasks = new Map();
  const snapshots = new Map();
  const runNodes = new Map();
  const runEdges = new Map();

  for (const tgDir of listDirs(join(projectDir, 'task-groups'))) {
    const tgIndex = join(tgDir, 'index.md');
    if (!fileExists(tgIndex)) { errors.push(`${tgDir}: missing index.md`); continue; }
    const tg = parseMarkdownFile(tgIndex);
    checkFields(tg, ['taskOpsVersion', 'entityType', 'id', 'objective', 'createdAt'], tgIndex, errors);
    if (tg.entityType !== 'taskGroup') errors.push(`${tgIndex}: entityType must be 'taskGroup'`);
    if (tg.id !== basename(tgDir)) errors.push(`${tgIndex}: id must match folder name '${basename(tgDir)}'`);
    taskGroups.set(tg.id, { ...tg, path: tgDir, versions: [] });

    for (const versionDir of listDirs(join(tgDir, 'versions'))) {
      const versionIndex = join(versionDir, 'index.md');
      if (!fileExists(versionIndex)) { errors.push(`${versionDir}: missing index.md`); continue; }
      const v = parseMarkdownFile(versionIndex);
      checkFields(v, ['taskOpsVersion', 'entityType', 'id', 'taskGroupId', 'version', 'summary', 'createdAt'], versionIndex, errors);
      if (v.entityType !== 'taskGroupVersion') errors.push(`${versionIndex}: entityType must be 'taskGroupVersion'`);
      if (v.id !== basename(versionDir)) errors.push(`${versionIndex}: id must match folder name '${basename(versionDir)}'`);
      if (v.taskGroupId !== tg.id) errors.push(`${versionIndex}: taskGroupId must be '${tg.id}'`);
      const versionRecord = { ...v, path: versionDir, tasks: [] };
      versions.set(v.id, versionRecord);
      taskGroups.get(tg.id).versions.push(versionRecord);

      const tasksDir = join(versionDir, 'tasks');
      if (!fileExists(tasksDir)) errors.push(`${versionDir}: missing tasks/ directory`);
      for (const taskPath of listMd(tasksDir)) {
        if (basename(taskPath) === 'index.md') continue;
        const task = parseMarkdownFile(taskPath);
        checkFields(task, ['taskOpsVersion', 'entityType', 'id', 'taskGroupId', 'taskGroupVersionId', 'title', 'objective', 'responsibility', 'completionCriteria', 'order', 'createdAt', 'status'], taskPath, errors);
        if (task.entityType !== 'task') errors.push(`${taskPath}: entityType must be 'task'`);
        if (task.id !== basename(taskPath, '.md')) errors.push(`${taskPath}: id must match file name '${basename(taskPath, '.md')}'`);
        if (task.taskGroupId !== tg.id) errors.push(`${taskPath}: taskGroupId must be '${tg.id}'`);
        if (task.taskGroupVersionId !== v.id) errors.push(`${taskPath}: taskGroupVersionId must be '${v.id}'`);
        if (!STATUS_VALUES.includes(task.status)) errors.push(`${taskPath}: invalid status '${task.status}'`);
        const key = `${v.id}:${task.id}`;
        if (tasks.has(key)) errors.push(`${taskPath}: duplicate task key '${key}'`);
        const taskRecord = { ...task, path: taskPath };
        tasks.set(key, taskRecord);
        versionRecord.tasks.push(taskRecord);
      }
    }
  }

  if (!taskGroups.has(project.activeRootTaskGroupId)) errors.push(`${projectIndex}: activeRootTaskGroupId '${project.activeRootTaskGroupId}' not found`);

  for (const [id, tg] of taskGroups) {
    const activeVersions = tg.versions.filter((v) => v.selected === true || v.id === tg.activeVersionId);
    if (tg.activeVersionId && !versions.has(tg.activeVersionId)) errors.push(`${tg.path}/index.md: activeVersionId '${tg.activeVersionId}' not found`);
    if (activeVersions.length > 1) warnings.push(`${tg.path}/index.md: multiple selected/active versions detected`);
  }

  for (const snapshotPath of listMd(join(projectDir, 'snapshots'))) {
    const snap = parseMarkdownFile(snapshotPath);
    checkFields(snap, ['taskOpsVersion', 'entityType', 'id', 'rootTaskGroupId', 'createdAt'], snapshotPath, errors);
    if (snap.entityType !== 'versionSnapshot') errors.push(`${snapshotPath}: entityType must be 'versionSnapshot'`);
    if (!Array.isArray(snap.selectedVersions)) errors.push(`${snapshotPath}: selectedVersions must be a list`);
    if (snap.id !== basename(snapshotPath, '.md')) errors.push(`${snapshotPath}: id must match file name '${basename(snapshotPath, '.md')}'`);
    if (!taskGroups.has(snap.rootTaskGroupId)) errors.push(`${snapshotPath}: rootTaskGroupId '${snap.rootTaskGroupId}' not found`);
    for (const pair of snap.selectedVersions || []) {
      if (!pair || typeof pair !== 'object') { errors.push(`${snapshotPath}: invalid selectedVersions entry`); continue; }
      if (!taskGroups.has(pair.taskGroupId)) errors.push(`${snapshotPath}: selected taskGroupId '${pair.taskGroupId}' not found`);
      if (!versions.has(pair.versionId)) errors.push(`${snapshotPath}: selected versionId '${pair.versionId}' not found`);
    }
    snapshots.set(snap.id, { ...snap, path: snapshotPath });
  }
  if (project.activeSnapshotId && !snapshots.has(project.activeSnapshotId)) errors.push(`${projectIndex}: activeSnapshotId '${project.activeSnapshotId}' not found`);

  const runIndex = join(projectDir, 'run', 'index.md');
  if (fileExists(runIndex)) {
    const run = parseMarkdownFile(runIndex);
    checkFields(run, ['taskOpsVersion', 'entityType', 'id', 'projectId', 'createdAt'], runIndex, errors);
    if (run.entityType !== 'run') errors.push(`${runIndex}: entityType must be 'run'`);
    if (run.projectId !== project.id) errors.push(`${runIndex}: projectId must be '${project.id}'`);

    for (const nodePath of listMd(join(projectDir, 'run', 'nodes'))) {
      const node = parseMarkdownFile(nodePath);
      checkFields(node, ['taskOpsVersion', 'entityType', 'id', 'runId', 'type', 'title', 'status', 'createdAt'], nodePath, errors);
      if (node.entityType !== 'runNode') errors.push(`${nodePath}: entityType must be 'runNode'`);
      if (node.id !== basename(nodePath, '.md')) errors.push(`${nodePath}: id must match file name '${basename(nodePath, '.md')}'`);
      if (node.runId !== run.id) errors.push(`${nodePath}: runId must be '${run.id}'`);
      if (node.sourceTaskGroupVersionId && !versions.has(node.sourceTaskGroupVersionId)) errors.push(`${nodePath}: sourceTaskGroupVersionId '${node.sourceTaskGroupVersionId}' not found`);
      if (node.sourceTaskId) {
        const found = [...tasks.values()].some((t) => t.id === node.sourceTaskId);
        if (!found) errors.push(`${nodePath}: sourceTaskId '${node.sourceTaskId}' not found`);
      }
      runNodes.set(node.id, { ...node, path: nodePath });
    }
    for (const edgePath of listMd(join(projectDir, 'run', 'edges'))) {
      const edge = parseMarkdownFile(edgePath);
      checkFields(edge, ['taskOpsVersion', 'entityType', 'id', 'runId', 'fromRunNodeId', 'toRunNodeId', 'edgeType', 'createdAt'], edgePath, errors);
      if (edge.entityType !== 'runEdge') errors.push(`${edgePath}: entityType must be 'runEdge'`);
      if (edge.id !== basename(edgePath, '.md')) errors.push(`${edgePath}: id must match file name '${basename(edgePath, '.md')}'`);
      if (edge.runId !== run.id) errors.push(`${edgePath}: runId must be '${run.id}'`);
      if (!runNodes.has(edge.fromRunNodeId)) errors.push(`${edgePath}: fromRunNodeId '${edge.fromRunNodeId}' not found`);
      if (!runNodes.has(edge.toRunNodeId)) errors.push(`${edgePath}: toRunNodeId '${edge.toRunNodeId}' not found`);
      runEdges.set(edge.id, { ...edge, path: edgePath });
    }
  } else {
    warnings.push(`${projectDir}: missing run/index.md`);
  }

  for (const version of versions.values()) {
    for (const task of version.tasks) {
      if (task.childTaskGroupId && !taskGroups.has(task.childTaskGroupId)) errors.push(`${task.path}: childTaskGroupId '${task.childTaskGroupId}' not found`);
    }
  }

  return { projectDir, project, taskGroups, versions, tasks, snapshots, runNodes, runEdges, errors, warnings };
}

export function summarizeProject(parsed) {
  const project = parsed.project;
  const taskGroups = [...parsed.taskGroups.values()];
  const versions = [...parsed.versions.values()];
  const tasks = [...parsed.tasks.values()];
  const snapshots = [...parsed.snapshots.values()];
  const runNodes = [...parsed.runNodes.values()];
  const runEdges = [...parsed.runEdges.values()];
  const countsByStatus = STATUS_VALUES.map((status) => [status, tasks.filter((t) => t.status === status).length]);
  const activeSnapshot = project.activeSnapshotId ? parsed.snapshots.get(project.activeSnapshotId) : null;
  const lines = [
    `# ${project.title || project.id}`,
    '',
    `- id: ${project.id}`,
    `- objective: ${project.objective || ''}`,
    `- status: ${project.status || 'unknown'}`,
    `- root task group: ${project.activeRootTaskGroupId || '(none)'}`,
    `- active snapshot: ${project.activeSnapshotId || '(none)'}`,
    `- task groups: ${taskGroups.length}`,
    `- task group versions: ${versions.length}`,
    `- tasks: ${tasks.length}`,
    `- snapshots: ${snapshots.length}`,
    `- run nodes: ${runNodes.length}`,
    `- run edges: ${runEdges.length}`,
    '',
    '## Task status counts',
    ...countsByStatus.map(([status, count]) => `- ${status}: ${count}`),
    '',
    '## Task groups',
  ];
  for (const tg of taskGroups.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
    lines.push(`- ${tg.id} — objective: ${tg.objective}`);
    for (const version of tg.versions.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      lines.push(`  - version ${version.id}${version.selected === true ? ' [selected]' : ''}: ${version.summary}`);
      for (const task of version.tasks.sort((a,b)=>(a.order??0)-(b.order??0))) {
        lines.push(`    - task ${task.id} [${task.status}]${task.childTaskGroupId ? ` -> ${task.childTaskGroupId}` : ''}: ${task.title}`);
      }
    }
  }
  lines.push('', '## Snapshot detail');
  if (activeSnapshot) {
    for (const pair of activeSnapshot.selectedVersions || []) {
      lines.push(`- ${pair.taskGroupId} -> ${pair.versionId}`);
    }
  } else {
    lines.push('- none');
  }
  lines.push('', '## Run graph');
  if (runNodes.length === 0) lines.push('- no run nodes');
  else {
    for (const node of runNodes.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      lines.push(`- node ${node.id} [${node.status}] type=${node.type}${node.sourceTaskId ? ` sourceTask=${node.sourceTaskId}` : ''}`);
    }
    for (const edge of runEdges.sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
      lines.push(`- edge ${edge.id}: ${edge.fromRunNodeId} -${edge.edgeType}-> ${edge.toRunNodeId}`);
    }
  }
  if (parsed.errors.length || parsed.warnings.length) {
    lines.push('', '## Diagnostics');
    for (const error of parsed.errors) lines.push(`- ERROR: ${error}`);
    for (const warning of parsed.warnings) lines.push(`- WARN: ${warning}`);
  }
  return lines.join('\n') + '\n';
}

export function writeSummary(parsed, fileName = 'summary.md') {
  const outPath = join(parsed.projectDir, fileName);
  writeFileSync(outPath, summarizeProject(parsed), 'utf8');
  return outPath;
}

function isoNow() { return new Date().toISOString(); }

function fmBlock(data) {
  const lines = ['---'];
  const emit = (key, value, indent = '') => {
    if (Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) lines.push(`${indent}  - {}`);
          else {
            const [firstK, firstV] = entries[0];
            lines.push(`${indent}  - ${firstK}: ${firstV}`);
            for (const [k, v] of entries.slice(1)) lines.push(`${indent}    ${k}: ${v}`);
          }
        } else {
          lines.push(`${indent}  - ${item}`);
        }
      }
      return;
    }
    lines.push(`${indent}${key}: ${value}`);
  };
  for (const [k,v] of Object.entries(data)) emit(k,v);
  lines.push('---', '');
  return lines.join('\n');
}

export function ensureDir(path) { mkdirSync(path, { recursive: true }); }

export function initProject(dir, { id, title, objective }) {
  const root = resolve(dir);
  ensureDir(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'tasks'));
  ensureDir(join(root, 'snapshots'));
  ensureDir(join(root, 'run', 'nodes'));
  ensureDir(join(root, 'run', 'edges'));
  ensureDir(join(root, 'derived', 'canvases'));
  ensureDir(join(root, 'derived', 'views'));
  const now = isoNow();
  writeFileSync(join(root, 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'project', id, title, objective, activeRootTaskGroupId: 'tg-root', activeSnapshotId: 'snapshot-root-v1', createdAt: now, status: 'active' }) + `# ${title}\n`, 'utf8');
  writeFileSync(join(root, 'project-log.md'), '# Project log\n\n- Initialized project.\n', 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'taskGroup', id: 'tg-root', objective, activeVersionId: 'tgv-root-v1', createdAt: now, status: 'active' }) + '# Root task group\n', 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: 'tgv-root-v1', taskGroupId: 'tg-root', version: 'v1', summary: 'Initial root decomposition', selected: true, createdAt: now, status: 'active' }) + '# Root version\n', 'utf8');
  writeFileSync(join(root, 'task-groups', 'tg-root', 'versions', 'tgv-root-v1', 'decomposition-log.md'), '# Decomposition log\n\n- Initial version created.\n', 'utf8');
  writeFileSync(join(root, 'snapshots', 'snapshot-root-v1.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'versionSnapshot', id: 'snapshot-root-v1', rootTaskGroupId: 'tg-root', createdAt: now, label: 'Initial snapshot', status: 'active', selectedVersions: [{ taskGroupId: 'tg-root', versionId: 'tgv-root-v1' }] }) + '# Snapshot root v1\n', 'utf8');
  writeFileSync(join(root, 'run', 'index.md'), fmBlock({ taskOpsVersion: 'v1', entityType: 'run', id: 'run-main', projectId: id, createdAt: now, status: 'active' }) + '# Run main\n', 'utf8');
  writeFileSync(join(root, 'run', 'run-log.md'), '# Run log\n\n- Run initialized.\n', 'utf8');
  return root;
}

export function writeVersionFromSpec(projectDir, taskGroupId, spec, { supersedesVersionId = null } = {}) {
  const taskGroupDir = join(projectDir, 'task-groups', taskGroupId);
  const tgIndex = join(taskGroupDir, 'index.md');
  if (!fileExists(tgIndex)) throw new Error(`Task group not found: ${taskGroupId}`);
  const versionId = spec.versionId;
  const versionDir = join(taskGroupDir, 'versions', versionId);
  if (fileExists(versionDir)) throw new Error(`Version already exists: ${versionId}`);
  ensureDir(join(versionDir, 'tasks'));
  const now = isoNow();
  const versionFm = { taskOpsVersion: 'v1', entityType: 'taskGroupVersion', id: versionId, taskGroupId, version: spec.version ?? versionId, summary: spec.summary, createdAt: now, status: spec.status ?? 'active' };
  if (supersedesVersionId) versionFm.supersedesVersionId = supersedesVersionId;
  if (spec.selected === true) versionFm.selected = true;
  writeFileSync(join(versionDir, 'index.md'), fmBlock(versionFm) + `# ${spec.summary}\n`, 'utf8');
  writeFileSync(join(versionDir, 'decomposition-log.md'), '# Decomposition log\n\n- Version created from spec.\n', 'utf8');
  (spec.tasks || []).forEach((task, i) => {
    const fm = {
      taskOpsVersion: 'v1', entityType: 'task', id: task.id, taskGroupId, taskGroupVersionId: versionId,
      title: task.title, objective: task.objective, responsibility: task.responsibility,
      completionCriteria: task.completionCriteria, order: task.order ?? i + 1, createdAt: now, status: task.status ?? 'pending'
    };
    if (task.childTaskGroupId) fm.childTaskGroupId = task.childTaskGroupId;
    writeFileSync(join(versionDir, 'tasks', `${task.id}.md`), fmBlock(fm) + `# ${task.title}\n`, 'utf8');
  });
  return versionDir;
}
