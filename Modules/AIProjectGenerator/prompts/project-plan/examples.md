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
            "estimatedHours": 1.5,
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
            "_comment": "Roughly six hours of work, so it is split. The parent carries NO estimatedHours — the hours live on the sub-tasks.",
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
            ],
            "subtasks": [
              {
                "TaskName": "Design three cover art concepts",
                "estimatedHours": 2,
                "descriptionBlocks": [
                  { "type": "paragraph", "data": { "text": "Three distinct directions at 3000x3000px, each readable when shrunk to a 55px podcast tile." } }
                ]
              },
              {
                "TaskName": "Refine the chosen cover art to final artwork",
                "estimatedHours": 2,
                "descriptionBlocks": [
                  { "type": "paragraph", "data": { "text": "Take the concept the hosts picked to final, and export at every size Apple and Spotify require." } }
                ]
              },
              {
                "TaskName": "Produce the intro and outro music stings",
                "estimatedHours": 2,
                "descriptionBlocks": [
                  { "type": "paragraph", "data": { "text": "Licence or commission a short theme, then cut a 10-second intro and a 5-second outro from it." } }
                ]
              }
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
            "TaskName": "Build POST /auth/signup endpoint",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Stand up the account-creation endpoint that lets a new user register. This unblocks every subsequent endpoint that requires a logged-in user." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add route POST /auth/signup in routes/auth.js.",
                "Validate body: { email (valid format), password (≥8 chars, ≥1 letter + ≥1 number), name (2-60 chars) }. Return 400 with field errors on failure.",
                "Check the User collection for an existing email (case-insensitive). Return 409 if found.",
                "bcrypt-hash the password at cost factor 12 and save the User document.",
                "Sign a 24h JWT with payload { userId, email } using JWT_SECRET.",
                "Respond 201 with { token, user: { id, email, name } }. Never include passwordHash in any response."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Valid payload returns 201 with token and user fields.",
                "Duplicate email returns 409.",
                "Invalid email or weak password returns 400 with the offending field named.",
                "Stored User document contains passwordHash, not the raw password.",
                "Decoded token yields the correct userId."
              ] } }
            ]
          },
          {
            "TaskName": "Build POST /auth/login endpoint",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Return a JWT for an existing user so the frontend can authenticate subsequent requests." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add route POST /auth/login in routes/auth.js.",
                "Validate body: { email, password }. Return 400 if either is missing.",
                "Look up the User by email (case-insensitive). Return 401 if not found.",
                "bcrypt.compare the submitted password against users.passwordHash. Return 401 on mismatch.",
                "Sign a 24h JWT and return 200 with { token, user: { id, email, name } }.",
                "Apply express-rate-limit: max 5 attempts per IP per minute; return 429 on breach."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Valid credentials return 200 + { token, user }.",
                "Wrong password or unknown email returns 401.",
                "6th attempt from the same IP within a minute returns 429.",
                "Passwords never appear in logs or error responses."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Build POST /auth/signup endpoint" } }
            ]
          },
          {
            "TaskName": "Build POST /auth/logout endpoint",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "Medium",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Provide a logout endpoint so the client has a clean contract for ending a session. Stateless JWT — the server returns 204 and the client discards the token." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add route POST /auth/logout in routes/auth.js.",
                "Apply the verifyToken middleware so only authenticated requests reach this route.",
                "Return 204 No Content. No body needed — client is responsible for clearing the stored token."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Authenticated POST /auth/logout returns 204.",
                "Unauthenticated request returns 401."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Build POST /auth/login endpoint" } }
            ]
          },
          {
            "TaskName": "Build GET /users/me endpoint",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "Medium",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Return the authenticated user's profile so the frontend can display the current user without re-parsing the JWT." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add route GET /users/me in routes/users.js.",
                "Apply the verifyToken middleware.",
                "Look up the User document by req.user.userId. Return 404 if somehow missing.",
                "Return 200 with { id, email, name, createdAt }. Exclude passwordHash."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Authenticated request returns 200 with id, email, name, createdAt.",
                "passwordHash is never present in the response.",
                "Unauthenticated request returns 401."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Build POST /auth/login endpoint" } }
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
- Task names are specific verbs ("Build POST /auth/signup", "Submit show"), not categories.
- **Each API endpoint is its own task — signup, login, logout, and GET /users/me are four separate tasks, not one.** Never combine two endpoints or two screens in one task name.
- Every description has all four parts in the same block order.
- The context paragraph explains WHY the task exists — it does not list skills or technologies.
- Steps name actual files, endpoints, payloads, status codes, frame sizes, and libraries.
- Acceptance criteria are checkable, not aspirational.
- Priorities vary — not everything is Medium.
- `AssigneeUserId` is always `[]` because no specific members were named.
