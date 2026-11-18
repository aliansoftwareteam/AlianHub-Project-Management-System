const mongoose = require('mongoose');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* comments.taskId is Mixed: rows hold a task id as an ObjectId or as text, neither Mongoose nor an
   aggregate casts either side, and 'default' names the main chat. */
const taskIdMatch = (taskId) => (OBJECT_ID.test(String(taskId))
    ? { $in: [String(taskId), new mongoose.Types.ObjectId(String(taskId))] }
    : taskId);

module.exports = { taskIdMatch };
