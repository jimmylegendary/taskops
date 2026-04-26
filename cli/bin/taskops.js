#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  discoverProjects,
  initProject,
  parseProject,
  summarizeProject,
  writeSummary,
  writeVersionFromSpec,
} from '../lib-taskops.js';

function usage() {
  console.log(`TaskOps CLI

Usage:
  taskops init <dir> --id <project-id> --title <title> --objective <objective>
  taskops validate <path>
  taskops summary <path> [--write]
  taskops show <path> [--json]
  taskops decompose <project-dir> --task-group-id <id> --spec <spec.json>
  taskops refactor <project-dir> --task-group-id <id> --spec <spec.json> --supersedes <version-id>
`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function requireFlag(flags, key) {
  if (!flags[key] || flags[key] === true) fail(`Missing required --${key}`);
  return String(flags[key]);
}

function parseOne(pathArg) {
  const projects = discoverProjects(pathArg);
  if (projects.length !== 1) fail(`Expected exactly 1 project under ${pathArg}, found ${projects.length}`);
  return parseProject(projects[0]);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const cmd = positional[0];

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  usage();
  process.exit(0);
}

try {
  if (cmd === 'init') {
    const dir = positional[1];
    if (!dir) fail('Missing init target directory');
    const root = initProject(dir, {
      id: requireFlag(flags, 'id'),
      title: requireFlag(flags, 'title'),
      objective: requireFlag(flags, 'objective'),
    });
    console.log(root);
    process.exit(0);
  }

  if (cmd === 'validate') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing validate path');
    const projects = discoverProjects(pathArg);
    let errorCount = 0;
    for (const projectDir of projects) {
      const parsed = parseProject(projectDir);
      if (parsed.errors.length === 0) {
        console.log(`OK ${parsed.project.id} (${projectDir})`);
      } else {
        console.error(`FAIL ${parsed.project.id} (${projectDir})`);
        for (const error of parsed.errors) console.error(`- ${error}`);
        errorCount += parsed.errors.length;
      }
      for (const warning of parsed.warnings) console.error(`WARN ${warning}`);
    }
    process.exit(errorCount === 0 ? 0 : 1);
  }

  if (cmd === 'summary') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing summary path');
    const parsed = parseOne(pathArg);
    const summary = summarizeProject(parsed);
    if (flags.write) {
      const out = writeSummary(parsed);
      console.log(out);
    } else {
      process.stdout.write(summary);
    }
    process.exit(parsed.errors.length === 0 ? 0 : 1);
  }

  if (cmd === 'show') {
    const pathArg = positional[1];
    if (!pathArg) fail('Missing show path');
    const parsed = parseOne(pathArg);
    const plain = {
      projectDir: parsed.projectDir,
      project: parsed.project,
      taskGroups: [...parsed.taskGroups.values()].map((tg) => ({
        id: tg.id,
        objective: tg.objective,
        activeVersionId: tg.activeVersionId ?? null,
        versions: tg.versions.map((v) => ({ id: v.id, summary: v.summary, selected: v.selected === true, taskCount: v.tasks.length })),
      })),
      snapshots: [...parsed.snapshots.values()],
      runNodes: [...parsed.runNodes.values()],
      runEdges: [...parsed.runEdges.values()],
      errors: parsed.errors,
      warnings: parsed.warnings,
    };
    if (flags.json) console.log(JSON.stringify(plain, null, 2));
    else process.stdout.write(summarizeProject(parsed));
    process.exit(parsed.errors.length === 0 ? 0 : 1);
  }

  if (cmd === 'decompose' || cmd === 'refactor') {
    const projectDir = resolve(positional[1] || '');
    if (!projectDir) fail(`Missing ${cmd} project dir`);
    const taskGroupId = requireFlag(flags, 'task-group-id');
    const specPath = resolve(requireFlag(flags, 'spec'));
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    const supersedes = cmd === 'refactor' ? requireFlag(flags, 'supersedes') : null;
    const out = writeVersionFromSpec(projectDir, taskGroupId, spec, { supersedesVersionId: supersedes });
    console.log(out);
    process.exit(0);
  }

  fail(`Unknown command: ${cmd}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
