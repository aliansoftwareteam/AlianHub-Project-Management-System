# Examples

One complete example — read it carefully. It shows the shape and the
quality bar for adding tasks to an **EXISTING** project. Do not copy the
names or content; match the structure and the quality.

Two things make this different from a from-scratch project plan:

1. There is **NO `project` block**. You emit `plan.sprints` only.
2. Every task's `status` and `TaskTypeKey` must reuse the values the user
   message gives you — you never invent a new status name or type key.

## Example — adding a feature to an existing software project

**Given project context (as it would appear in the user message):**

- Project: "Acme Storefront" — a Vue + Node/Express e-commerce store.
- Task statuses (use one of these EXACT names in each task's `status`):
  `Backlog, In Progress, Code Review, QA, Done`
- Task types (use one of these EXACT keys in `TaskTypeKey`):
  `[ { "key": 1, "name": "Task" }, { "key": 2, "name": "Bug" } ]`
- Existing sprints: `Foundation, Product Catalog`

**Requirements:** "Add the checkout flow — a cart page, a Stripe payment
integration, and an order-confirmation screen."

**Output:**

```json
{
  "needsClarification": false,
  "plan": {
    "sprints": [
      {
        "sprintName": "Checkout Flow",
        "tasks": [
          {
            "TaskName": "Build GET /api/cart endpoint",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "The checkout page needs to read the current user's cart before it can render line items and totals. This is the read side of the cart and unblocks the cart UI." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add route GET /api/cart in routes/cart.js, behind the verifyToken middleware.",
                "Load the Cart document for req.user.userId; create an empty one on first access.",
                "Populate each line item with product name, price, and image from the Product collection.",
                "Return 200 with { items: [{ productId, name, price, qty, image }], subtotal, currency }."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Authenticated request returns 200 with items and a correct subtotal.",
                "An empty cart returns items: [] and subtotal: 0, not a 404.",
                "Unauthenticated request returns 401."
              ] } }
            ]
          },
          {
            "TaskName": "Build Cart page",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "Medium",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "The cart page is where a shopper reviews items before paying. It reads from GET /api/cart and is the entry point into the payment step." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Create views/CartPage.vue at route /cart.",
                "Fetch GET /api/cart on mount; show a skeleton loader while pending.",
                "Render each line item with image, name, unit price, a quantity stepper, and a remove button.",
                "Show the subtotal and a 'Proceed to payment' button that routes to /checkout.",
                "Render an empty-cart state with a 'Browse products' link when items is empty."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Line items, quantities, and subtotal match the API response.",
                "The empty state shows when the cart has no items.",
                "'Proceed to payment' is disabled when the cart is empty.",
                "Layout is usable at 360px and 1280px."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Build GET /api/cart endpoint" } }
            ]
          },
          {
            "TaskName": "Build POST /api/checkout/session endpoint (Stripe)",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Create a Stripe Checkout Session on the server so card details never touch our backend. The frontend redirects the shopper to the returned session URL." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add route POST /api/checkout/session behind verifyToken.",
                "Load the user's cart; map each line item to a Stripe line_item (name, unit_amount in cents, quantity).",
                "Call stripe.checkout.sessions.create with mode: 'payment', a success_url and a cancel_url.",
                "Persist a pending Order with the session id and a snapshot of the cart.",
                "Return 200 with { url } (the hosted checkout URL). Read the Stripe key from an env var."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "A valid cart returns 200 with a Stripe checkout URL.",
                "An empty cart returns 400.",
                "A pending Order row is written with the session id.",
                "The Stripe secret key is read from an env var, never hard-coded."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Build GET /api/cart endpoint" } }
            ]
          },
          {
            "TaskName": "Build POST /api/webhooks/stripe handler",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "High",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Stripe confirms payment asynchronously via webhook. This handler marks the Order paid when checkout.session.completed arrives, so we never rely on the browser redirect alone." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add route POST /api/webhooks/stripe with the raw body parser (Stripe needs the raw payload for signature checks).",
                "Verify the signature with stripe.webhooks.constructEvent and STRIPE_WEBHOOK_SECRET; return 400 on failure.",
                "On checkout.session.completed, find the Order by session id and set its status to 'paid'.",
                "Clear the user's cart.",
                "Return 200 quickly and process idempotently so retries are safe."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "A validly-signed completed-session event flips the Order to 'paid'.",
                "An invalid signature returns 400 and mutates no Order.",
                "Replaying the same event does not double-process."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Build POST /api/checkout/session endpoint (Stripe)" } }
            ]
          },
          {
            "TaskName": "Build Order confirmation screen",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "Medium",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "After a successful payment Stripe redirects to the success URL. This screen confirms the order and shows what was purchased." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Create views/OrderConfirmation.vue at route /checkout/success.",
                "Read the session id from the query string and fetch GET /api/orders/by-session/:id.",
                "Show the order number, purchased line items, the total paid, and an estimated-delivery note.",
                "Add a 'Continue shopping' link back to the catalog."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "A paid order shows its number, items, and total.",
                "An unknown or unpaid session shows a friendly 'we couldn't find that order' state.",
                "Layout is usable at 360px and 1280px."
              ] } },
              { "type": "paragraph", "data": { "text": "Depends on: Build POST /api/webhooks/stripe handler" } }
            ]
          },
          {
            "TaskName": "Write empty-cart and payment-cancelled copy",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "Low",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Polish the edge-case messaging so a shopper is never stuck on a blank or confusing screen." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Write empty-cart copy with a link back to the catalog.",
                "Write a payment-cancelled message on the /checkout cancel route with a 'try again' button.",
                "Have a teammate review the tone against the rest of the store."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Empty-cart and payment-cancelled states both show clear next-step copy.",
                "No raw error codes are shown to the shopper."
              ] } }
            ]
          }
        ]
      }
    ]
  }
}
```

## Notice in this example

- **No `project` block** — only `plan.sprints`. The project already exists.
- Every `status` is `"Backlog"` — one of the EXACT status names the user
  message provided. No invented statuses.
- Every `TaskTypeKey` is `1` — one of the project's given type keys. No
  invented types.
- **One task per endpoint and per screen** — the cart read, the
  checkout-session endpoint, the webhook, the cart page, and the
  confirmation screen are all separate tasks, never one "build checkout" task.
- Each description has all five blocks in order, with concrete files,
  routes, payloads, and checkable acceptance criteria.
- **Priorities vary** — the critical-path endpoints are High, the screens
  are Medium, the copy polish is Low. Not everything is High.
- `AssigneeUserId` is `[]` because no member was named in the requirements.
- `"Depends on: "` paragraphs reference the blocking task by its exact name.

## Example 2 — with sub-tasks and epics enabled

When the user turns on **sub-tasks** and **epics**, the plan must actually
use them, not just mention them: define a plan-level `epics` array AND point
tasks at it via `epicRef`, and break the larger tasks down with a `subtasks`
array. The same existing-project rules apply (given statuses/types, no
`project` block).

**Output (abridged — two tasks shown):**

```json
{
  "needsClarification": false,
  "plan": {
    "epics": [
      { "ref": "e1", "name": "Payments", "color": "#7b68ee" },
      { "ref": "e2", "name": "Storefront UI", "color": "#22c55e" }
    ],
    "sprints": [
      {
        "sprintName": "Checkout Flow",
        "tasks": [
          {
            "TaskName": "Integrate Stripe payments",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "High",
            "epicRef": "e1",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "Wire up server-side Stripe so shoppers can pay. This is the spine of the checkout flow and gates the confirmation screen." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Add the Stripe SDK and read the secret key from an env var.",
                "Create the checkout-session endpoint and the webhook handler.",
                "Mark the Order paid on checkout.session.completed."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "A valid cart produces a Stripe checkout URL.",
                "A signed completed-session webhook flips the Order to paid.",
                "The secret key is never hard-coded."
              ] } }
            ],
            "subtasks": [
              {
                "TaskName": "Add POST /api/checkout/session endpoint",
                "priority": "High",
                "descriptionBlocks": [
                  { "type": "paragraph", "data": { "text": "Create a Stripe Checkout Session from the user's cart and return its hosted URL; persist a pending Order with the session id." } }
                ]
              },
              {
                "TaskName": "Add POST /api/webhooks/stripe handler",
                "priority": "High",
                "descriptionBlocks": [
                  { "type": "paragraph", "data": { "text": "Verify the Stripe signature, and on checkout.session.completed mark the matching Order paid and clear the cart. Process idempotently." } }
                ]
              },
              {
                "TaskName": "Handle payment cancel and failure states",
                "priority": "Medium",
                "descriptionBlocks": [
                  { "type": "paragraph", "data": { "text": "On the cancel_url show a 'payment cancelled' message with a retry button; surface no raw Stripe error codes to the shopper." } }
                ]
              }
            ]
          },
          {
            "TaskName": "Build Cart page",
            "TaskTypeKey": 1,
            "status": "Backlog",
            "priority": "Medium",
            "epicRef": "e2",
            "AssigneeUserId": [],
            "descriptionBlocks": [
              { "type": "paragraph", "data": { "text": "The cart page lets a shopper review items before paying; it reads GET /api/cart and routes into the payment step." } },
              { "type": "header", "data": { "text": "What to do", "level": 4 } },
              { "type": "list", "data": { "style": "ordered", "items": [
                "Create views/CartPage.vue at /cart and fetch GET /api/cart on mount.",
                "Render line items with a quantity stepper and a remove button.",
                "Show the subtotal and a 'Proceed to payment' button."
              ] } },
              { "type": "header", "data": { "text": "Acceptance criteria", "level": 4 } },
              { "type": "list", "data": { "style": "unordered", "items": [
                "Items and subtotal match the API response.",
                "'Proceed to payment' is disabled on an empty cart.",
                "Layout is usable at 360px and 1280px."
              ] } }
            ]
          }
        ]
      }
    ]
  }
}
```

## Notice in Example 2

- The `epics` array is defined AND used — `e1` ("Payments") and `e2`
  ("Storefront UI") are each referenced by a task's `epicRef`. Never emit an
  epic that no task points at.
- `epicRef` sits ON the task (a sibling of `TaskName` / `priority`), and its
  value is the epic's `ref` string (e.g. `"e1"`) — not the epic's name.
- The big task ("Integrate Stripe payments") carries a `subtasks` array; each
  sub-task has a SHORT one-paragraph description (no full skeleton) and its
  own `priority`. The simpler "Build Cart page" stays flat — not every task
  needs sub-tasks, but the large multi-part ones do.
- Sub-tasks are never nested under other sub-tasks.

## Other modes

The example above is the default "sprints + tasks" shape. The user message's
per-mode output contract is authoritative for the exact envelope:

- **Tasks only** — the same task quality (5-block descriptions, granularity,
  varied priority), but the tasks go in a FLAT `plan.tasks` array with no
  `sprints` key, because the target sprint already exists.
- **Sprints only** — emit `plan.sprints` where each sprint has ONLY a
  `sprintName` and no `tasks`.
