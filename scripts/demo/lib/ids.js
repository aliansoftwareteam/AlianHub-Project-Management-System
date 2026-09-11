const mongoose = require('mongoose');

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// The same foreign key is a string in some collections and an ObjectId in others.
const idForms = (ids) => [].concat(ids || []).filter(Boolean).map(String)
    .flatMap((id) => (OBJECT_ID.test(id) ? [id, new mongoose.Types.ObjectId(id)] : [id]));

module.exports = { OBJECT_ID, idForms };
