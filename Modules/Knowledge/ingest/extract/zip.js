const zlib = require('zlib');

// Office files are zip archives whose headers state their own inflated sizes, and parsers inflate
// first and check after. So every entry is inflated here against one budget, zlib being told the
// most it may produce, and the parser is handed an archive rebuilt from what was really inflated,
// with the UTF-8 name flag kept so names that are not ASCII read the same.

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

const UTF8_NAMES = 0x800;

const localHeader = ({ name, flags, crc, size }) => {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags & UTF8_NAMES, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    return header;
};

const centralHeader = ({ name, flags, crc, size }, offset) => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags & UTF8_NAMES, 8);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    return header;
};

/**
 * An archive of stored entries holding at most `budget` inflated bytes. The first pass inflates
 * each entry only to measure it and lets it go; the second inflates it again straight into the
 * output, so what is held at once is the output and one entry, never every entry beside it.
 * `rewrite(name, content)` may change an entry on its way in, and must return the same bytes for
 * the same entry on both passes; the budget counts what was inflated.
 */
const inflateWithin = (buffer, budget, { rewrite = (name, content) => content } = {}) => {
    const entries = entriesOf(buffer);
    let used = 0;
    const measured = entries.map((entry) => {
        const inflated = inflateEntry(buffer, entry, budget - used);
        used += inflated.length;
        if (used > budget) throw refusal('inflated_too_large', 'The archive inflates past the budget.');
        const content = rewrite(entry.name, inflated);
        return { name: entry.name, flags: entry.flags, crc: crc32(content), size: content.length, inflatedSize: inflated.length };
    });
    const directorySize = measured.reduce((sum, file) => sum + 46 + file.name.length, 0);
    const out = Buffer.allocUnsafe(measured.reduce((sum, file) => sum + 30 + file.name.length + file.size, 0) + directorySize + 22);
    let offset = 0;
    const offsets = [];
    entries.forEach((entry, at) => {
        const file = measured[at];
        offsets.push(offset);
        offset += localHeader(file).copy(out, offset);
        offset += file.name.copy(out, offset);
        const inflated = inflateEntry(buffer, entry, file.inflatedSize);
        if (inflated.length !== file.inflatedSize) throw damaged();
        const content = rewrite(entry.name, inflated);
        if (content.length !== file.size) throw damaged();
        offset += content.copy(out, offset);
    });
    const directoryAt = offset;
    measured.forEach((file, at) => {
        offset += centralHeader(file, offsets[at]).copy(out, offset);
        offset += file.name.copy(out, offset);
    });
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(measured.length, 8);
    end.writeUInt16LE(measured.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(directoryAt, 16);
    end.copy(out, offset);
    return out;
};

module.exports = { inflateWithin, crc32 };
