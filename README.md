# HK-HCC Agentic SDLC Knowledge Graph Data

This repository stores deterministic structured artifacts generated from the
HK-HCC Agentic SDLC SDD Markdown repository.

## Repository Role

- Stores generated graph artifacts under `_graph/`.
- Supports review and audit of graph sync output.
- Provides source files for Neo4j import/upsert jobs.
- May be rebuilt from the SDD repository at any time.
- Does not own human-authored SDD content.

## Layout

```text
.
├── _graph/
│   ├── standard-sdd/
│   │   └── control-tower/
│   │       ├── manifest.json
│   │       ├── nodes.jsonl
│   │       ├── edges.jsonl
│   │       ├── issues.jsonl
│   │       └── suggestions.jsonl
│   └── ibm-i/
│       └── hk-hcc-core/
│           ├── manifest.json
│           ├── nodes.jsonl
│           ├── edges.jsonl
│           ├── issues.jsonl
│           └── suggestions.jsonl
├── runs/
├── schema/
├── .github/
│   └── workflows/
│       └── sync-graph.yml
└── scripts/
    └── sdd-graph-sync.mjs
```

## Sync From SDD Repo

```bash
npm run sync:sdd
```

Optional identifiers:

```bash
npm run sync -- \
  --source ../hk-hcc-agentic-sdlc-sdd/docs/standard-sdd/projects/control-tower \
  --out _graph/standard-sdd/control-tower \
  --workspace ws-default-001 \
  --application agentic-sdlc-control-tower \
  --profile standard-sdd \
  --project control-tower \
  --snow-group "SDLC Platform"
```

For a new project, point `--source` at that project folder and pass the same
`--project` ID used in document front matter:

```bash
npm run sync -- \
  --source ../hk-hcc-agentic-sdlc-sdd/docs/ibm-i/projects/new-project \
  --out _graph/ibm-i/new-project \
  --profile ibm-i \
  --workspace ws-default-001 \
  --application hk-hcc \
  --project new-project \
  --snow-group HK-HCC
```

For HK-HCC IBM i validation:

```bash
npm run sync:ibm-i
```

Each sync writes a project-scoped artifact set:

- `_graph/{profile}/{project}/manifest.json`
- `_graph/{profile}/{project}/nodes.jsonl`
- `_graph/{profile}/{project}/edges.jsonl`
- `_graph/{profile}/{project}/issues.jsonl`
- `_graph/{profile}/{project}/suggestions.jsonl`

When a source repository contains multiple profiles or projects, the sync
includes documents with matching `profile` front matter and, when `--project`
is provided, documents with matching `project_id` front matter. Documents
without `project_id` inherit the command-line `--project` value.

## Artifact Contract

- `nodes.jsonl`: one graph node per line.
- `edges.jsonl`: one directed relationship per line.
- `issues.jsonl`: validation errors and warnings from the sync.
- `suggestions.jsonl`: non-blocking graph completion suggestions.
- `manifest.json`: sync metadata, counts, source commit, and artifact paths.

`issues.jsonl` should be reviewed before importing into Neo4j. Error-level
issues mean the projection is useful for debugging but should not be promoted as
trusted graph truth.

## GitHub Actions Sync

The repository also exposes a GitHub Actions workflow for hosted sync:

- Manual trigger: open **Actions** -> **Sync Graph Artifacts** -> **Run workflow**.
- Page/backend trigger: call the GitHub Actions `workflow_dispatch` API for
  `.github/workflows/sync-graph.yml` with the same inputs.
- Automatic trigger: the SDD repo sends a `repository_dispatch` event whenever
  `docs/**` changes on `main`.

Workflow inputs:

- `profile`: `standard-sdd` or `ibm-i`
- `project_id`: project folder under `docs/{profile}/projects/`
- `source_branch`: SDD branch to read, usually `main`
- `workspace_id`: graph workspace scope
- `application_id`: application scope
- `snow_group`: optional SNOW group scope

Required repository setup:

- In this repo, add `SDD_READ_TOKEN` if the SDD repository is private. Use a
  fine-grained token with read access to `wwa-lab/hk-hcc-agentic-sdlc-sdd`
  contents.
- The default `GITHUB_TOKEN` commits generated `_graph/` artifacts back to this
  repository, so this repo's workflow permission must allow write access.
- If an application page triggers the sync, its backend token needs Actions
  write permission on this repository and should call the workflow dispatch
  endpoint rather than writing graph files directly.
