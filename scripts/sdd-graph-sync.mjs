#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const [key, inlineValue] = arg.slice(2).split('=');
    const value = inlineValue ?? (process.argv[i + 1]?.startsWith('--') ? 'true' : process.argv[++i] ?? 'true');
    args.set(key, value);
  }
}

const sourceRoot = resolve(args.get('source') ?? '.');
const outputRoot = resolve(args.get('out') ?? join(sourceRoot, '_graph'));
const profileId = args.get('profile') ?? 'standard-sdd';
const branch = args.get('branch') ?? git(['rev-parse', '--abbrev-ref', 'HEAD'], sourceRoot, 'unknown');
const workspaceId = args.get('workspace') ?? 'ws-default';
const applicationId = args.get('application') ?? null;
const snowGroup = args.get('snow-group') ?? null;
const projectId = args.get('project') ?? null;

const profiles = {
  'standard-sdd': {
    docTypes: new Set(['requirement', 'user-story', 'spec', 'architecture', 'data-flow', 'data-model', 'design', 'api-guide', 'tasks']),
    dependencyPairs: new Set([
      'user-story->requirement',
      'spec->user-story',
      'architecture->spec',
      'data-flow->architecture',
      'data-model->architecture',
      'design->data-flow',
      'design->data-model',
      'api-guide->design',
      'tasks->api-guide',
      'tasks->design',
    ]),
  },
  'ibm-i': {
    docTypes: new Set(['requirement-normalizer', 'functional-spec', 'technical-design', 'program-spec', 'file-spec', 'ut-plan', 'test-scaffold', 'spec-review', 'dds-review', 'code-review']),
    dependencyPairs: new Set([
      'functional-spec->requirement-normalizer',
      'technical-design->functional-spec',
      'program-spec->technical-design',
      'file-spec->technical-design',
      'ut-plan->program-spec',
      'test-scaffold->ut-plan',
      'spec-review->technical-design',
      'dds-review->file-spec',
      'code-review->program-spec',
    ]),
  },
};

const profile = profiles[profileId];
if (!profile) {
  throw new Error(`Unknown profile: ${profileId}`);
}

const files = findMarkdownFiles(sourceRoot).filter(file => !file.includes(`${sep()}_graph${sep()}`));
const documents = files.map(readDocument).filter(Boolean);
const docIds = new Set(documents.map(doc => doc.frontmatter.doc_id));
const duplicateIds = duplicates(documents.map(doc => doc.frontmatter.doc_id).filter(Boolean));

const nodes = [];
const edges = [];
const issues = [];
const suggestions = [];

for (const duplicateId of duplicateIds) {
  issues.push(issue('ERROR', 'DUPLICATE_DOC_ID', `Duplicate doc_id: ${duplicateId}`, `doc:${duplicateId}`));
}

for (const doc of documents) {
  validateDocument(doc, issues);
  nodes.push(documentNode(doc));
  for (const ref of arrayValue(doc.frontmatter.source_refs)) {
    const sourceId = `source:${doc.frontmatter.doc_id}:${hash(JSON.stringify(ref))}`;
    nodes.push({
      id: sourceId,
      kind: 'SOURCE_REF',
      label: ref.title ?? ref.url ?? ref.external_id ?? 'Source Reference',
      properties: scoped({ sourceType: ref.type, url: ref.url, externalId: ref.external_id, docId: doc.frontmatter.doc_id }),
    });
    edges.push(edge(`doc:${doc.frontmatter.doc_id}`, 'REFERENCES', sourceId, 'frontmatter', { profile: profileId, branch }));
  }
  for (const program of arrayValue(doc.frontmatter.entities?.programs)) {
    const programName = program.name ?? program;
    const programId = `program:${programName}`;
    nodes.push({ id: programId, kind: 'PROGRAM', label: programName, properties: scoped(typeof program === 'object' ? program : { name: programName }) });
    edges.push(edge(`doc:${doc.frontmatter.doc_id}`, 'COVERS', programId, 'frontmatter', { entityType: 'program', profile: profileId, branch }));
  }
  for (const file of arrayValue(doc.frontmatter.entities?.files)) {
    const fileName = file.name ?? file;
    const fileId = `file:${fileName}`;
    nodes.push({ id: fileId, kind: 'FILE', label: fileName, properties: scoped(typeof file === 'object' ? file : { name: fileName }) });
    edges.push(edge(`doc:${doc.frontmatter.doc_id}`, 'COVERS', fileId, 'frontmatter', { entityType: 'file', profile: profileId, branch }));
  }
}

for (const doc of documents) {
  for (const dep of arrayValue(doc.frontmatter.depends_on)) {
    const targetId = typeof dep === 'string' ? dep : dep.doc_id;
    if (!targetId) {
      issues.push(issue('ERROR', 'INVALID_DEPENDS_ON', `Invalid depends_on entry in ${doc.frontmatter.doc_id}`, `doc:${doc.frontmatter.doc_id}`));
      continue;
    }
    if (!docIds.has(targetId)) {
      issues.push(issue('ERROR', 'MISSING_DEPENDENCY_TARGET', `${doc.frontmatter.doc_id} depends on missing ${targetId}`, `doc:${doc.frontmatter.doc_id}`));
    }
    const target = documents.find(candidate => candidate.frontmatter.doc_id === targetId);
    if (target && !profile.dependencyPairs.has(`${doc.frontmatter.doc_type}->${target.frontmatter.doc_type}`)) {
      issues.push(issue('WARNING', 'UNUSUAL_DEPENDENCY_PAIR', `${doc.frontmatter.doc_type} -> ${target.frontmatter.doc_type} is not a standard ${profileId} pair`, `doc:${doc.frontmatter.doc_id}`));
    }
    edges.push(edge(`doc:${doc.frontmatter.doc_id}`, 'DEPENDS_ON', `doc:${targetId}`, 'frontmatter', { profile: profileId, branch, reason: dep.reason ?? null }));
  }
}

for (const doc of documents.filter(doc => arrayValue(doc.frontmatter.depends_on).length === 0 && doc.frontmatter.doc_type !== 'requirement' && doc.frontmatter.doc_type !== 'requirement-normalizer')) {
  suggestions.push({
    id: `suggestion:${doc.frontmatter.doc_id}:missing-depends-on`,
    type: 'MISSING_DEPENDENCY',
    message: `${doc.frontmatter.doc_id} has no depends_on entry.`,
    nodeId: `doc:${doc.frontmatter.doc_id}`,
    properties: scoped({ docType: doc.frontmatter.doc_type }),
  });
}

mkdirSync(outputRoot, { recursive: true });
const generatedAt = new Date().toISOString();
const manifest = {
  schemaVersion: '1.0',
  runId: `skg-sync-${generatedAt.replace(/[-:]/g, '').slice(0, 15)}`,
  generatedAt,
  workspaceId,
  applicationId,
  snowGroup,
  projectId,
  profileId,
  branch,
  sourceCommitSha: git(['rev-parse', 'HEAD'], sourceRoot, null),
  artifacts: {
    nodes: '_graph/nodes.jsonl',
    edges: '_graph/edges.jsonl',
    issues: '_graph/issues.jsonl',
    suggestions: '_graph/suggestions.jsonl',
  },
  counts: { documents: documents.length, nodes: uniqueById(nodes).length, edges: uniqueById(edges).length, issues: issues.length, suggestions: suggestions.length },
  stale: false,
  lastSync: {
    runId: `skg-sync-${generatedAt.replace(/[-:]/g, '').slice(0, 15)}`,
    status: issues.some(item => item.severity === 'ERROR') ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
    sourceCommitSha: git(['rev-parse', 'HEAD'], sourceRoot, null),
    structuredCommitSha: null,
    startedAt: generatedAt,
    completedAt: generatedAt,
  },
};

writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeJsonl(join(outputRoot, 'nodes.jsonl'), uniqueById(nodes));
writeJsonl(join(outputRoot, 'edges.jsonl'), uniqueById(edges));
writeJsonl(join(outputRoot, 'issues.jsonl'), issues);
writeJsonl(join(outputRoot, 'suggestions.jsonl'), suggestions);

if (args.get('commit') === 'true') {
  git(['add', relative(sourceRoot, outputRoot)], sourceRoot, null);
  git(['commit', '-m', `Update SDD knowledge graph artifacts for ${profileId}`], sourceRoot, null);
}

console.log(JSON.stringify(manifest.counts, null, 2));

function findMarkdownFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', 'target'].includes(entry.name)) return [];
      return findMarkdownFiles(path);
    }
    return entry.isFile() && /\.mdx?$/i.test(entry.name) ? [path] : [];
  });
}

function readDocument(path) {
  const markdown = readFileSync(path, 'utf8');
  if (!markdown.startsWith('---\n')) return null;
  const end = markdown.indexOf('\n---', 4);
  if (end < 0) return null;
  const yaml = markdown.slice(4, end);
  return { path, relativePath: relative(sourceRoot, path), frontmatter: parseYamlSubset(yaml), markdown };
}

function parseYamlSubset(source) {
  const lines = source.split(/\r?\n/)
    .filter(line => line.trim() && !line.trimStart().startsWith('#'))
    .map(line => ({ indent: line.match(/^\s*/)[0].length, text: line.trim() }));
  return parseBlock(lines, 0, 0).value ?? {};
}

function parseBlock(lines, start, indent) {
  if (start >= lines.length) return { value: {}, next: start };
  const isArray = lines[start].indent === indent && lines[start].text.startsWith('- ');
  const value = isArray ? [] : {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index += 1;
      continue;
    }
    if (isArray) {
      if (!line.text.startsWith('- ')) break;
      const itemText = line.text.slice(2).trim();
      if (itemText.includes(':')) {
        const item = {};
        applyMappingLine(item, itemText, lines, index, indent);
        const child = parseObjectContinuation(lines, index + 1, indent + 2);
        value.push({ ...item, ...child.value });
        index = child.next;
      } else {
        value.push(parseScalar(itemText));
        index += 1;
      }
    } else {
      if (line.text.startsWith('- ')) break;
      const [key, ...rest] = line.text.split(':');
      const valueText = rest.join(':').trim();
      if (valueText === '') {
        const childIndent = lines[index + 1]?.indent ?? indent + 2;
        const child = parseBlock(lines, index + 1, childIndent);
        value[key.trim()] = child.value;
        index = child.next;
      } else {
        value[key.trim()] = parseScalar(valueText);
        index += 1;
      }
    }
  }
  return { value, next: index };
}

function parseObjectContinuation(lines, start, indent) {
  const value = {};
  let index = start;
  while (index < lines.length && lines[index].indent >= indent) {
    if (lines[index].indent > indent) {
      index += 1;
      continue;
    }
    if (lines[index].text.startsWith('- ')) break;
    const [key, ...rest] = lines[index].text.split(':');
    const valueText = rest.join(':').trim();
    if (valueText === '') {
      const childIndent = lines[index + 1]?.indent ?? indent + 2;
      const child = parseBlock(lines, index + 1, childIndent);
      value[key.trim()] = child.value;
      index = child.next;
    } else {
      value[key.trim()] = parseScalar(valueText);
      index += 1;
    }
  }
  return { value, next: index };
}

function applyMappingLine(target, line) {
  const [key, ...rest] = line.split(':');
  target[key.trim()] = parseScalar(rest.join(':').trim());
}

function parseScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(item => parseScalar(item)).filter(Boolean);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function validateDocument(doc, targetIssues) {
  const required = ['doc_id', 'doc_type', 'title', 'owner', 'profile'];
  for (const field of required) {
    if (!doc.frontmatter[field]) {
      targetIssues.push(issue('ERROR', 'MISSING_REQUIRED_FIELD', `${doc.relativePath} is missing ${field}`, doc.frontmatter.doc_id ? `doc:${doc.frontmatter.doc_id}` : null));
    }
  }
  if (doc.frontmatter.profile && doc.frontmatter.profile !== profileId) {
    targetIssues.push(issue('WARNING', 'PROFILE_MISMATCH', `${doc.frontmatter.doc_id} declares profile ${doc.frontmatter.profile}, active profile is ${profileId}`, `doc:${doc.frontmatter.doc_id}`));
  }
  if (doc.frontmatter.doc_type && !profile.docTypes.has(doc.frontmatter.doc_type)) {
    targetIssues.push(issue('ERROR', 'INVALID_DOC_TYPE', `${doc.frontmatter.doc_type} is not allowed for ${profileId}`, `doc:${doc.frontmatter.doc_id}`));
  }
  if (profileId === 'ibm-i') {
    for (const program of arrayValue(doc.frontmatter.entities?.programs)) {
      if (typeof program === 'object' && (!program.name || !program.library)) {
        targetIssues.push(issue('WARNING', 'INVALID_PROGRAM_ENTITY', `Program entity in ${doc.frontmatter.doc_id} should include name and library`, `doc:${doc.frontmatter.doc_id}`));
      }
    }
  }
}

function documentNode(doc) {
  return {
    id: `doc:${doc.frontmatter.doc_id}`,
    kind: 'DOCUMENT',
    label: doc.frontmatter.title ?? doc.frontmatter.doc_id,
    properties: scoped({
      docId: doc.frontmatter.doc_id,
      docType: doc.frontmatter.doc_type,
      requirementId: doc.frontmatter.requirement_id ?? null,
      owner: doc.frontmatter.owner,
      path: doc.relativePath,
      freshnessStatus: 'FRESH',
    }),
  };
}

function edge(from, type, to, source, properties) {
  return { id: `edge:${from}:${type}:${to}`, type, from, to, source, confidence: 1.0, properties };
}

function issue(severity, code, message, nodeId) {
  return { id: `issue:${hash(`${severity}:${code}:${message}:${nodeId}`)}`, severity, code, message, nodeId, edgeId: null, properties: scoped({}) };
}

function scoped(properties) {
  return { ...properties, workspaceId, applicationId, snowGroup, projectId, profile: profileId, branch };
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueById(rows) {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

function git(command, cwd, fallback) {
  try {
    return execFileSync('git', command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function hash(value) {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = ((result << 5) - result + value.charCodeAt(i)) | 0;
  }
  return Math.abs(result).toString(36);
}

function sep() {
  return process.platform === 'win32' ? '\\' : '/';
}
