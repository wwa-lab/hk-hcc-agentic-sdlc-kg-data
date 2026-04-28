# Graph Outputs

Generated graph artifacts are stored by profile and project:

```text
_graph/{profile}/{project}/
├── manifest.json
├── nodes.jsonl
├── edges.jsonl
├── issues.jsonl
└── suggestions.jsonl
```

This keeps multiple projects in the same structured repository without
overwriting each other.
