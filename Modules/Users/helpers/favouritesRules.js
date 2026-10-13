const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const FAVOURITE_TYPES = ['project', 'folder', 'sprint', 'task', 'doc'];
const MAX_FAVOURITES = 200;

const refuse = (error) => ({ ok: false, error });
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isEntry = (type, id) => FAVOURITE_TYPES.includes(type) && typeof id === 'string' && OBJECT_ID_PATTERN.test(id);

const favouriteKey = ({ type, id }) => `${type}:${id}`;

const parseKey = (key) => {
    if (typeof key !== 'string') return null;
    const at = key.indexOf(':');
    const type = key.slice(0, at);
    const id = key.slice(at + 1);
    return at > 0 && isEntry(type, id) ? { type, id } : null;
};

const sanitizeFavouriteToggle = (body) => {
    if (!isPlainObject(body)) return refuse('The body must be an object.');
    const keys = Object.keys(body).sort();
    if (keys.join(',') !== 'favourite,id,type') return refuse('Send type, id and favourite only.');
    if (!isEntry(body.type, body.id)) return refuse('type or id is not valid.');
    if (typeof body.favourite !== 'boolean') return refuse('favourite must be true or false.');
    return { ok: true, entry: { type: body.type, id: body.id }, favourite: body.favourite };
};

const sanitizeFavouriteOrder = (body) => {
    if (!isPlainObject(body) || Object.keys(body).join(',') !== 'keys') return refuse('Send keys only.');
    const { keys } = body;
    if (!Array.isArray(keys)) return refuse('keys must be a list.');
    if (keys.length > MAX_FAVOURITES) return refuse(`At most ${MAX_FAVOURITES} favourites can be ordered.`);
    if (!keys.every(parseKey)) return refuse('keys names an unknown item.');
    if (new Set(keys).size !== keys.length) return refuse('keys lists an item twice.');
    return { ok: true, keys: [...keys] };
};

const companyFavourites = (user, companyId) => ((user && user.favourites) || [])
    .filter((entry) => entry && String(entry.companyId) === String(companyId) && isEntry(entry.type, String(entry.id)));

/* Listed entries first, in the order given; the ones the caller could not see keep their place after them. */
const reorderFavourites = (all, companyId, keys) => {
    const mine = (all || []).filter((entry) => String(entry.companyId) === String(companyId));
    const others = (all || []).filter((entry) => String(entry.companyId) !== String(companyId));
    const byKey = new Map(mine.map((entry) => [favouriteKey(entry), entry]));
    const listed = keys.map((key) => byKey.get(key)).filter(Boolean);
    const rest = mine.filter((entry) => !keys.includes(favouriteKey(entry)));
    return [...others, ...listed, ...rest];
};

module.exports = {
    FAVOURITE_TYPES,
    MAX_FAVOURITES,
    favouriteKey,
    parseKey,
    sanitizeFavouriteToggle,
    sanitizeFavouriteOrder,
    companyFavourites,
    reorderFavourites,
};
