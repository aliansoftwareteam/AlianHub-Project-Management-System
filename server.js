// Entry point for `npm start` / pm2.
//
// This file used to be a restart wrapper that re-spawned `node server.js`
// recursively on every crash. Under a crash-loop each exit stacked another
// wrapper process, exhausting the OS process table until every spawn failed
// with EAGAIN and took the whole instance down (staging outage, 2026-06-10).
//
// Process supervision belongs to pm2 (autorestart with backoff) — the app
// now simply runs in-process.
require('./index.js');
