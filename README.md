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
│   ├── manifest.json
│   ├── nodes.jsonl
│   ├── edges.jsonl
│   ├── issues.jsonl
│   └── suggestions.jsonl
├── runs/
├── schema/
└── scripts/
    └── sdd-graph-sync.mjs
```

## Sync From SDD Repo

```bash
npm run sync -- --source ../hk-hcc-agentic-sdlc-sdd --workspace ws-default-001 --application agentic-sdlc-control-tower
```

Optional identifiers:

```bash
npm run sync -- \
  --source ../hk-hcc-agentic-sdlc-sdd \
  --workspace ws-default-001 \
  --application agentic-sdlc-control-tower \
  --project proj-42 \
  --snow-group "SDLC Platform"
```

The sync writes:

- `_graph/manifest.json`
- `_graph/nodes.jsonl`
- `_graph/edges.jsonl`
- `_graph/issues.jsonl`
- `_graph/suggestions.jsonl`

## Artifact Contract

- `nodes.jsonl`: one graph node per line.
- `edges.jsonl`: one directed relationship per line.
- `issues.jsonl`: validation errors and warnings from the sync.
- `suggestions.jsonl`: non-blocking graph completion suggestions.
- `manifest.json`: sync metadata, counts, source commit, and artifact paths.

`issues.jsonl` should be reviewed before importing into Neo4j. Error-level
issues mean the projection is useful for debugging but should not be promoted as
trusted graph truth.
