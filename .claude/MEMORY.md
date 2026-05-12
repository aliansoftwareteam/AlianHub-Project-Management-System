# Memory Files Index

Persistent memory for development context. Files here are loaded in future conversations.

## User Profile
- [user_role.md](memory/user_role.md) — User role and expertise

## Project Context
- [project_tech_stack.md](memory/project_tech_stack.md) — Tech stack decisions and rationale
- [project_key_decisions.md](memory/project_key_decisions.md) — Architectural decisions and constraints
- [project_team_practices.md](memory/project_team_practices.md) — Team conventions and guidelines

## Development Patterns & Feedback
- (Add feedback memories as you learn about user preferences)

## External References
- [reference_external_systems.md](memory/reference_external_systems.md) — External tools and integrations
- [reference_key_files.md](memory/reference_key_files.md) — Important file paths and purposes

## To Add New Memory
Create a file in `memory/` folder following this format:
```markdown
---
name: {memory name}
description: {one-line description}
type: {user|feedback|project|reference}
---

{memory content}
```

Then add a link here under the appropriate section.
