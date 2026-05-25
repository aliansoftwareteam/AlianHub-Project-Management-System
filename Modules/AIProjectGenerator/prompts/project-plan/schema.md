# Output schema

```
{
  "needsClarification": false,
  "plan": {
    "project": {
      "ProjectName": string,                              // 3-80 chars
      "description": string,                              // 1-2 sentences summarizing the project
      "projectIcon": { "emoji": string, "backgroundColor": "#RRGGBB" },
      "isPrivateSpace": boolean,                          // default false; server may override

      "projectStatusData": [
        { "name": string, "textColor": "#RRGGBB", "type": "default_active" | "active" | "close" }
      ],

      "taskStatusData": [
        { "name": string, "textColor": "#RRGGBB", "type": "default_active" | "active" | "close" }
      ],

      "taskTypeCounts": [
        { "name": string, "key": number }                 // keys are 1, 2, 3, ...
      ],

      "LeadUserId": string[]                              // member ids only; default []
    },

    "sprints": [
      {
        "sprintName": string,                             // 1-80 chars
        "tasks": [
          {
            "TaskName": string,                           // 4-200 chars, imperative
            "TaskTypeKey": number,                        // must match a taskTypeCounts[].key
            "status": string,                             // must match a taskStatusData[].name
            "priority": "Low" | "Medium" | "High" | "Urgent",
            "AssigneeUserId": string[],                   // member ids only; default []
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": string } },
              { "type": "header",    "data": { "text": "What to do", "level": 4 } },
              { "type": "list",      "data": { "style": "ordered", "items": string[] } },
              { "type": "header",    "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list",      "data": { "style": "unordered", "items": string[] } }
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
- `projectStatusData` must contain exactly one entry with `type: "default_active"` and exactly one with `type: "close"`.
- `taskStatusData` must contain exactly one entry with `type: "default_active"` and exactly one with `type: "close"`.
- Every `task.status` must exactly equal some `taskStatusData[i].name`.
- Every `task.TaskTypeKey` must match some `taskTypeCounts[i].key`.
- Every task's `descriptionBlocks` must include all five required blocks in order: paragraph (context), header "What to do", ordered list, header "Acceptance criteria", unordered list. An optional sixth paragraph starting with `"Depends on: "` is allowed.
- Block types are limited to `paragraph`, `header`, `list`. Do not invent others.
- All hex colors are 6 digits (`#RRGGBB`).
