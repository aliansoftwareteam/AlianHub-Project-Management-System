# Examples

Two complete examples — read them carefully. They show the shape of good
output. Do not copy the names or task content; match the structure and
the quality bar.

## Example 1 — a content launch

**Input description:**
"Launching a weekly tech podcast with 12 episodes. Two co-hosts. Need to
record, edit, publish on major podcast platforms, and run social
promotion. 6 months of runway."

**Output:**

```json
{
  "needsClarification": false,
  "plan": {
    "project": {
      "ProjectName": "Weekly Tech Podcast",
      "description": "Launch and run a weekly tech interview podcast across the major platforms with paired social promotion.",
      "projectIcon": { "emoji": "🎙️", "backgroundColor": "#F97316" },
      "isPrivateSpace": false,
      "projectStatusData": [
        { "name": "Pre-Launch", "type": "default_active", "textColor": "#F97316" },
        { "name": "Recording", "type": "active", "textColor": "#FF9600" },
        { "name": "Promoting", "type": "active", "textColor": "#A855F7" },
        { "name": "Wrapped", "type": "close", "textColor": "#22C55E" }
      ],
      "taskStatusData": [
        { "name": "Idea", "type": "default_active", "textColor": "#0EA5E9" },
        { "name": "Booked", "type": "active", "textColor": "#6473E8" },
        { "name": "Recorded", "type": "active", "textColor": "#A855F7" },
        { "name": "Editing", "type": "active", "textColor": "#FF9600" },
        { "name": "Scheduled", "type": "active", "textColor": "#F97316" },
        { "name": "Published", "type": "close", "textColor": "#22C55E" }
      ],
      "taskTypeCounts": [
        { "name": "Episode", "key": 1 },
        { "name": "Promo", "key": 2 },
        { "name": "Ops", "key": 3 }
      ],
      "LeadUserId": []
    },
    "sprints": [
      {
        "sprintName": "Branding & Setup",
        "tasks": [
          {
            "TaskName": "Decide podcast name and tagline",
            "TaskTypeKey": 3,
            "status": "Idea",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "The name will appear on every platform listing and in social posts, so we need it locked before any cover art or trailers are produced." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Brainstorm 10-15 candidate names with both hosts in a single working session.",
                "Check each candidate against existing podcasts on Apple Podcasts and Spotify — no exact duplicates.",
                "Pick top 3 and run them past 5 target listeners for a quick reaction.",
                "Lock the winner and write a one-line tagline (under 80 chars)."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Final name and tagline are written down in the project's shared doc.",
                "The name does not collide with an existing podcast on Apple or Spotify.",
                "Both hosts agreed on the final pick."
              ] } }
            ]
          },
          {
            "TaskName": "Design cover art and intro music",
            "TaskTypeKey": 3,
            "status": "Idea",
            "priority": "Medium",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Apple and Spotify both require a 3000x3000 cover image and reject blurry uploads, so we need real artwork before we can submit the show." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Brief a designer (or Canva template) on the locked name + tagline.",
                "Produce a 3000x3000 PNG cover with text legible at 200x200.",
                "Commission or license a 10-second intro/outro music bed (royalty-free).",
                "Save final assets in the project drive under /branding."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "3000x3000 cover PNG exists and passes Apple's preview test.",
                "Intro music file is in WAV at 44.1kHz, under 15 seconds.",
                "All files are licensed for podcast distribution."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Decide podcast name and tagline" } }
            ]
          },
          {
            "TaskName": "Submit show to Apple Podcasts and Spotify",
            "TaskTypeKey": 3,
            "status": "Idea",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Approvals can take up to a week, so we kick off submissions as soon as cover art and the first trailer episode are ready." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Set up an RSS feed via the hosting provider (Transistor or equivalent).",
                "Submit the feed URL to Apple Podcasts Connect.",
                "Submit the feed URL to Spotify for Podcasters.",
                "Save the show URLs once approved."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Show is live and searchable on both Apple Podcasts and Spotify.",
                "RSS feed validates without errors.",
                "Show URLs are recorded in the project doc."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Design cover art and intro music" } }
            ]
          }
        ]
      },
      {
        "sprintName": "First Three Episodes",
        "tasks": [
          {
            "TaskName": "Book and record guests for episodes 1-3",
            "TaskTypeKey": 1,
            "status": "Idea",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Three strong launch episodes set the tone for the show and give Apple's algorithm something to recommend." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Draft a shortlist of 8-10 candidate guests across diverse angles.",
                "Reach out via email with a 4-line pitch and 2 proposed time slots.",
                "Confirm 3 guests and lock recording dates.",
                "Send each confirmed guest the prep doc (topics, format, tech setup)."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Three guests are confirmed in writing with locked dates.",
                "Each guest has received the prep doc and acknowledged it.",
                "Recording slots are on both hosts' calendars."
              ] } }
            ]
          }
        ]
      }
    ]
  }
}
```

## Example 2 — a generic software project

**Input description:**
"Build a small internal todo app for a 4-person team. React frontend, Node
backend, MongoDB. Auth, basic CRUD on tasks, real-time updates. Quick —
two weeks."

**Output (abridged — same shape, fewer sprints shown):**

```json
{
  "needsClarification": false,
  "plan": {
    "project": {
      "ProjectName": "Internal Todo App",
      "description": "Small internal task-tracking web app for a 4-person team, with real-time updates.",
      "projectIcon": { "emoji": "✅", "backgroundColor": "#6473E8" },
      "isPrivateSpace": false,
      "projectStatusData": [
        { "name": "Planning", "type": "default_active", "textColor": "#6473E8" },
        { "name": "Building", "type": "active", "textColor": "#FF9600" },
        { "name": "Launched", "type": "close", "textColor": "#22C55E" }
      ],
      "taskStatusData": [
        { "name": "Backlog", "type": "default_active", "textColor": "#475569" },
        { "name": "In Progress", "type": "active", "textColor": "#FF9600" },
        { "name": "Code Review", "type": "active", "textColor": "#A855F7" },
        { "name": "QA", "type": "active", "textColor": "#0EA5E9" },
        { "name": "Done", "type": "close", "textColor": "#22C55E" }
      ],
      "taskTypeCounts": [
        { "name": "Task", "key": 1 },
        { "name": "Bug", "key": 2 }
      ],
      "LeadUserId": []
    },
    "sprints": [
      {
        "sprintName": "Backend Foundation",
        "tasks": [
          {
            "TaskName": "Wire JWT auth for /login and /logout",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Every other endpoint requires an authenticated user, so this is the first task that unblocks the rest of the backend work." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add POST /api/login: bcrypt-compare submitted password against users.passwordHash; on match, sign a 24h JWT with JWT_SECRET and return { token, user }.",
                "Add POST /api/logout: client clears the token; server-side just returns 204 (stateless JWT).",
                "Add middleware verifyToken() that decodes the Bearer JWT and attaches req.user; mount on all /api/* routes except /login.",
                "Rate-limit /login to 5 attempts per IP per minute using express-rate-limit."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "POST /api/login with valid credentials returns 200 + { token, user }; invalid returns 401.",
                "Any /api/* call without a valid Bearer token returns 401.",
                "Passwords never appear in logs or error responses.",
                "6th login attempt from same IP inside a minute returns 429."
              ] } }
            ]
          }
        ]
      }
    ]
  }
}
```

Notice in both examples:

- Status names and task types match the domain (podcast uses "Booked / Recorded / Editing"; software uses "Backlog / Code Review / QA").
- Task names are specific verbs ("Wire JWT", "Submit show"), not categories.
- Every description has all four parts in the same block order.
- Steps name actual files, endpoints, or deliverables.
- Acceptance criteria are checkable, not aspirational.
- Priorities vary — not everything is Medium.
- `AssigneeUserId` is always `[]` because no specific members were named.
