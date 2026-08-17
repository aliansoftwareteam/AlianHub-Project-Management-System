# Output schema

```
{
  "needsClarification": false,
  "plan": {
    "sprints": [
      {
        "sprintName": string,                             // 1-80 chars
        "tasks": [
          {
            "TaskName": string,                           // 4-200 chars, imperative
            "TaskTypeKey": number,                        // must match one of the project's task type keys (given)
            "status": string,                             // must match one of the project's task status names (given)
            "priority": "Low" | "Medium" | "High",
            "estimatedHours": number,                     // <= 2; OMIT when subtasks are present
            "AssigneeUserId": string[],                   // member ids only; default []
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": string } },
              { "type": "header",    "data": { "text": "What to do", "level": 4 } },
              { "type": "list",      "data": { "style": "ordered", "items": string[] } },
              { "type": "header",    "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list",      "data": { "style": "unordered", "items": string[] } }
            ],
            "subtasks": [                                 // only when the work exceeds 2h
              {
                "TaskName": string,                       // 2-200 chars
                "estimatedHours": number,                 // <= 2, required on each
                "descriptionBlocks": [ { "type": "paragraph", "data": { "text": string } } ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## Hard requirements (validation will reject otherwise)

- The top-level object MUST have `needsClarification: false`.
- There is **NO** `project` block — the project already exists. Emit `plan.sprints` only.
- Every `task.status` must exactly equal one of the project's task status names given in the user message.
- Every `task.TaskTypeKey` must match one of the project's task type keys given in the user message.
- Every task's `descriptionBlocks` must include all five required blocks in order: paragraph (context), header "What to do", ordered list, header "Acceptance criteria", unordered list. An optional sixth paragraph starting with `"Depends on: "` is allowed.
- Block types are limited to `paragraph`, `header`, `list`. Do not invent others.
