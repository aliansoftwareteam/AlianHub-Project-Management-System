const zlib = require('zlib');

// Office files are zip archives whose headers state their own inflated sizes, and parsers inflate
// first and check after. So every entry is inflated here against one budget, zlib being told the
// most it may produce, and the parser is handed an archive rebuilt from what was really inflated.

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const ZIP64 = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;
const ENCRYPTED = 0x1;
const MAX_ENTRIES = 5000;

const refusal = (code, message) => Object.assign(new Error(message), { code });
const damaged = () => refusal('failed', 'The archive is damaged.');

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
};

const endOfDirectory = (buffer) => {
    const earliest = Math.max(0, buffer.length - 65557);
    for (let at = buffer.length - 22; at >= earliest; at -= 1) {
        if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
    }
    throw damaged();
};

/* What the directory says each entry is, sizes excepted: those are taken from the inflation. */
const entriesOf = (buffer) => {
    const end = endOfDirectory(buffer);
    const count = buffer.readUInt16LE(end + 10);
    let offset = buffer.readUInt32LE(end + 16);
    if (count > MAX_ENTRIES) throw refusal('inflated_too_large', `The archive holds more than ${MAX_ENTRIES} entries.`);
    if (offset === ZIP64) throw damaged();
    const entries = [];
    for (let i = 0; i < count; i += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw damaged();
        const nameLength = buffer.readUInt16LE(offset + 28);
        entries.push({
            flags: buffer.readUInt16LE(offset + 8),
            method: buffer.readUInt16LE(offset + 10),
            compressedSize: buffer.readUInt32LE(offset + 20),
            localOffset: buffer.readUInt32LE(offset + 42),
            name: buffer.subarray(offset + 46, offset + 46 + nameLength),
        });
        offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    }
    return entries;
};

const dataOf = (buffer, entry) => {
    const at = entry.localOffset;
    if (entry.compressedSize === ZIP64 || at === ZIP64 || at + 30 > buffer.length || buffer.readUInt32LE(at) !== LOCAL_FILE_HEADER) throw damaged();
    const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
    const stop = start + entry.compressedSize;
    if (stop > buffer.length) throw damaged();
    return buffer.subarray(start, stop);
};

const inflateEntry = (buffer, entry, left) => {
    if (entry.flags & ENCRYPTED) throw refusal('failed', 'The archive is encrypted.');
    const data = dataOf(buffer, entry);
    if (entry.method === STORED) return data;
    if (entry.method !== DEFLATED) throw refusal('failed', `The archive uses compression method ${entry.method}.`);
    try {
        return zlib.inflateRawSync(data, { maxOutputLength: left + 1 });
    } catch (error) {
        if (error && (error.code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError)) throw refusal('inflated_too_large', 'The archive inflates past the budget.');
        throw damaged();
    }
};

const storedArchive = (files) => {
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach(({ name, content }) => {
        const crc = crc32(content);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(content.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(content.length, 20);
        central.writeUInt32LE(content.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, content);
        centrals.push(central, name);
        offset += 30 + name.length + content.length;
    });
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
};

/** @returns {Buffer} an archive of stored entries holding at most `budget` inflated bytes */
const inflateWithin = (buffer, budget) => {
    let used = 0;
    const files = entriesOf(buffer).map((entry) => {
        const content = inflateEntry(buffer, entry, budget - used);
        used += content.length;
        if (used > budget) throw refusal('inflated_too_large', 'The archive inflates past the budget.');
        return { name: entry.name, content };
    });
    return storedArchive(files);
};

module.exports = { inflateWithin, crc32 };
