# Graph Artifact Schema

## Node

Each line in `_graph/{profile}/{project}/nodes.jsonl` is a JSON object:

```json
{
  "id": "doc:agentic-sdlc-control-tower:slice:requirement",
  "kind": "DOCUMENT",
  "label": "Document title",
  "properties": {
    "docType": "requirement",
    "requirementId": "REQ-001",
    "path": "01-requirements/example-requirements.md",
    "workspaceId": "ws-default-001",
    "applicationId": "agentic-sdlc-control-tower",
    "projectId": "control-tower",
    "profile": "standard-sdd",
    "branch": "main"
  }
}
```

## Edge

Each line in `_graph/{profile}/{project}/edges.jsonl` is a JSON object:

```json
{
  "id": "edge:source:relationship:target",
  "from": "doc:source-doc-id",
  "to": "doc:target-doc-id",
  "type": "DEPENDS_ON",
  "evidence": "frontmatter",
  "properties": {
    "profile": "standard-sdd",
    "projectId": "control-tower",
    "branch": "main",
    "reason": "Stories refine requirements."
  }
}
```

## Issue

Each line in `_graph/{profile}/{project}/issues.jsonl` is a JSON object:

```json
{
  "id": "issue:stable-id",
  "severity": "ERROR",
  "code": "MISSING_REQUIRED_FIELD",
  "message": "Document is missing doc_id",
  "nodeId": null,
  "edgeId": null,
  "properties": {
    "workspaceId": "ws-default-001",
    "applicationId": "agentic-sdlc-control-tower",
    "projectId": "control-tower",
    "profile": "standard-sdd",
    "branch": "main"
  }
}
```

## Promotion Rule

Only promote a generated artifact set for Neo4j import when:

- `manifest.json` has the expected `sourceCommitSha`.
- `issues.jsonl` contains no `ERROR` severity records.
- Review confirms expected document counts for the target SDD scope.
