# Real-time (Socket.io) events

When one person changes something, every other open tab that shows it updates within a moment. This page explains the path from a database write to a browser: the in-process emitter, the relays in `socket/controller/`, the rooms a browser joins, and the event names in use.

## The path of a change

```
handler writes with MongoDbCrudOpration
        │
        ▼
socketEmitter.emit('update', { type, module: 'task', companyId, data, updatedFields })
        │   event/socketEventEmitter.js re-emits it as 'task:update'
        ▼
relay in socket/controller/taskSocket.js  (socketEmitter.on('task:update', ...))
        │   finds the rooms that show this task, checks each socket may receive it
        ▼
browser: socketInstance.on('taskUpdate', ...)  →  store mutation  →  view updates
```

Other listeners hear the same emitter: the domain event bus that feeds automations (`event/domainEventBus.js`) and the webhook dispatcher (`Modules/Webhooks/dispatcher.js`). A write that skips the emit is invisible to all three.

## Emitting from the server

`event/socketEventEmitter.js` is a Node `EventEmitter` that emits each event twice: under its plain name (`update`, `insert`, `delete`) and as `<module>:<name>` when the payload has a `module`. Relays subscribe to the namespaced form, so a task change wakes only the task relays.

The payload shape, from `Modules/Reactions/controller.js`:

```js
const socketEmitter = require('../../event/socketEventEmitter');

socketEmitter.emit('update', { type: "update", data: updated, updatedFields, module: 'task', companyId });
```

| Field | Meaning |
|---|---|
| `type` | `insert`, `update` or `delete`, the same as the event name |
| `module` | Which relay hears it: `task`, `comments`, `project`, `sprints`, `folders`, `goals`, `agent`, … |
| `companyId` | The company. Relays send only to sockets of this company |
| `data` | The document after the change |
| `updatedFields` | What changed, for an update |
| `actor`, `depth` | Optional. Who caused it (`{ kind: 'user' }`, or `agent`, `automation`, `system`, `import`) and how deep in a chain of automatic changes; automations stop at depth 3 |

Always include `companyId`. `tests/conventions/socket-events-name-company.test.js` fails when an event of the `task`, `userIdNotification`, `generalReminder`, `project`, `sprints` or `folders` modules leaves it out.

## Connections, namespaces and rooms

- The web app connects once per person and company, to the namespace `userid_<companyId>_<userId>` (`frontend/src/App.vue`, through `connectServer()` in `frontend/src/composable/socketHelper.js`). The session cookie travels with the handshake.
- `socket/socketinit.js` verifies the token and the session on the handshake, checks the namespace matches the token, and re-checks the session on every event. A socket whose session has ended is closed.
- A view joins a room for what it shows, by emitting a join event: `joinProjectSprintForTask` (a list), `joinTaskDetail` (a task panel), `joinCommentRoom`, `joinChats`, `joinCompaniesRoom`, `joinGeneralReminder`, `joinUserIdNotification`. `onJoin()` in `socket/roomAccess.js` checks the person may open what the room shows before it joins. Each has a matching `leave...` event.
- Rooms are indexed in `socket/helper.js` and cleared when a socket disconnects.

## Events a browser receives

| Event | Sent when | Relay |
|---|---|---|
| `taskInsert`, `taskUpdate` | A task in a list you have open is created or changed. A task panel hears `taskDetail_taskInsert` / `taskDetail_taskUpdate`, with `isSubTaskUpdate` for its subtasks | `taskSocket.js` |
| `chatTaskInsert`, `chatTaskUpdate` | A conversation in your chat list changes | `chatSocket.js` |
| `commentInsert`, `commentUpdate` | A comment in a thread you have open | `commentSocket.js` |
| `pageCommentInsert`, `pageCommentUpdate` | A comment on a doc | `commentSocket.js` |
| `commentTyping` | Someone is typing in a thread you have open | `commentSocket.js` |
| `companiesInsert`, `companiesUpdate` | The company record changes | `companiesSocket.js` |
| `projectChanged` | A project you can open is added, changed or removed. Carries only `{ kind, companyId, projectId }`; the browser reads the project again | `projectSocket.js` |
| `listChanged`, `foldersChanged` | A list or folder changes | `listSocket.js` |
| `customFieldsChanged` | Custom fields change | `customFieldSocket.js` |
| `goalsChanged` | Any goal changes. Carries only the type; each client reads its goals again | `goalSocket.js` |
| `docsChanged`, `docSharesChanged` | A doc is added, or a doc's sharing changes for you | `pageShareSocket.js` |
| `whiteboardChanged` | A whiteboard you have open gets a new revision | `whiteboardSocket.js` |
| `viewTemplatesChanged`, `projectTemplatesChanged` | Saved view templates or project templates change | `viewTemplateSocket.js`, `projectTemplateSocket.js` |
| `agentsChanged` | An agent run moves, a proposal you may read is filed, a policy or budget changes, or your own connected agent applied a change | `agentSocket.js` |
| `dispatcherChanged` | The dispatcher's settings, agents or decisions change | `dispatcherSocket.js` |
| `taskDetail_agentSession` | A delegated agent session on an open task reports activity | `agentSessionSocket.js` |
| `generalReminderUpdate` | One of your reminders changes | `generalReminderSocket.js` |
| `userIdNoticationUpdate` | Your notification count changes (the name is spelled this way in the code) | `userNotificationCount.js` |
| `INSTANCE_LIFECYCLE_CHANGED`, `INSTANCE_SUPPORT_ACCESS_CHANGED`, `PLAN_UPDATED` | The instance's lifecycle, support access or plan changes | `instanceSocket.js` |
| `INSTANCE_LOCKED` | An event was refused because the instance is suspended | `socketinit.js` |
| `call:incoming`, `call:ringing`, `call:accepted`, `call:rejected`, `call:cancelled`, `call:ended`, `call:missed`, `call:signal`, … | Audio and video call signalling | `callSocket.js` |

Several relays send only the fact of a change, never its content (`projectChanged`, `goalsChanged`, `dispatcherChanged`): naming a project or goal would tell a member about something they may not open. The browser reads it again through the API, which decides what it may see.

## Listening in the web app

The store attaches listeners to the shared socket instance. From `frontend/src/store/ProjectData/actions.js`:

```js
rootState.settings.socketInstance.emit('joinProjectSprintForTask', emitObj);
rootState.settings.socketInstance.on('taskUpdate', (data) => {
    const docData = data.fullDocument;
    commit('mutateUpdateFirebaseTasks', {snap: {}, op: "modified", pid, sprintId, data: {...docData},updatedFields:{...data?.updatedFields},showAllTasks});
    // ...
});
```

Newer screens keep the event name as a constant beside the code that uses it, for example `PROJECT_CHANGED_EVENT` in `frontend/src/views/Projects/liveProjects.js` and `AGENTS_CHANGED_EVENT` in `frontend/src/views/Ai/agentFeed.js`. Remove a listener with `off` when the view leaves, or it fires twice when the view comes back.

## Adding an event

1. After the write, emit with `module` and `companyId`, inside a `try` so a failed emit never fails the request.
2. If no relay listens to your module yet, add one in `socket/controller/` that subscribes to `<module>:insert` / `<module>:update`, decides who may receive it (helpers in `socket/roomAccess.js`, such as `toCompanyRoom`), and require it from `socket/socketinit.js`.
3. Prefer sending the fact of a change and letting the browser re-read it, unless every receiver may see the content.
4. Listen in the view or store, and remove the listener when the view leaves.

## Related

- [Multi-tenancy and data access](./multi-tenancy)
- [Frontend](./frontend)
- [Writing a module](./writing-a-module)
