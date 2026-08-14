#!/usr/bin/env bash
# Initialize /Tasks/ structure at the project root.
# Idempotent: safe to run multiple times.

set -euo pipefail

# Resolve script location to find templates regardless of where it's run from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATES_DIR="$SKILL_DIR/templates"

# Run from project root (current working directory)
TASKS_DIR="./Tasks"

if [[ -d "$TASKS_DIR" ]]; then
    echo "Tasks/ already exists. No changes made."
    echo "If you want to reset, remove Tasks/ manually first."
    exit 0
fi

mkdir -p "$TASKS_DIR/active" "$TASKS_DIR/backlog" "$TASKS_DIR/done"

# Copy README from templates
if [[ -f "$TEMPLATES_DIR/README.md" ]]; then
    cp "$TEMPLATES_DIR/README.md" "$TASKS_DIR/README.md"
else
    echo "Warning: template README.md not found at $TEMPLATES_DIR/README.md" >&2
fi

# Create empty index.md
cat > "$TASKS_DIR/index.md" <<'EOF'
# Task Index

Auto-maintained registry of all tasks. Reflects YAML frontmatter from each `task.md`.

| ID  | Title | Status | Priority | Depends on | Path |
|-----|-------|--------|----------|------------|------|

*No tasks yet. Create one with the task-manager skill.*
EOF

echo "✓ Created Tasks/ structure:"
echo "    Tasks/"
echo "    ├── README.md"
echo "    ├── index.md"
echo "    ├── active/"
echo "    ├── backlog/"
echo "    └── done/"
echo ""
echo "Read Tasks/README.md for conventions."
