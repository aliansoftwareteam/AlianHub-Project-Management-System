'use strict';

/* Whether an uploaded file is audio, and how long it runs, both read from its first bytes and its container: WebM
 * (what the browser recorder writes), MP4 and WAV state a length. Other audio, or a file whose container does not
 * say, is estimated from its size. */

const ESTIMATED_BYTES_PER_MINUTE = 480000;

const EBML = Object.freeze({
    SEGMENT: 0x18538067, INFO: 0x1549a966, CLUSTER: 0x1f43b675, BLOCK_GROUP: 0xa0,
    TIMESTAMP_SCALE: 0x2ad7b1, DURATION: 0x4489, CLUSTER_TIMESTAMP: 0xe7, SIMPLE_BLOCK: 0xa3, BLOCK: 0xa1,
});
const EBML_PARENTS = [EBML.SEGMENT, EBML.INFO, EBML.CLUSTER, EBML.BLOCK_GROUP];
const DEFAULT_TIMESTAMP_SCALE_NS = 1000000;

const vintLength = (byte) => {
    for (let length = 1; length <= 8; length += 1) if (byte & (0x100 >> length)) return length;
    return 0;
};

const uintAt = (buffer, at, length) => {
    let value = 0;
    for (let i = 0; i < length; i += 1) value = value * 256 + buffer[at + i];
    return value;
};

/* An element's id and content size; size is null when the writer left it open, as a live recorder does. */
function ebmlHeader(buffer, at) {
    const idLength = vintLength(buffer[at]);
    if (!idLength || idLength > 4 || at + idLength >= buffer.length) return null;
    const sizeAt = at + idLength;
    const sizeLength = vintLength(buffer[sizeAt]);
    if (!sizeLength || sizeAt + sizeLength > buffer.length) return null;
    const mask = 0xff >> sizeLength;
    let size = buffer[sizeAt] & mask;
    let open = size === mask;
    for (let i = 1; i < sizeLength; i += 1) {
        open = open && buffer[sizeAt + i] === 0xff;
        size = size * 256 + buffer[sizeAt + i];
    }
    return { id: uintAt(buffer, at, idLength), size: open ? null : size, contentAt: sizeAt + sizeLength };
}

/* A browser recording carries no Duration, so its length is the last block's timestamp. */
function webmSeconds(buffer) {
    let at = 0;
    let scale = DEFAULT_TIMESTAMP_SCALE_NS;
    let duration = null;
    let cluster = 0;
    let last = null;
    while (at < buffer.length) {
        const element = ebmlHeader(buffer, at);
        if (!element) break;
        const { id, size, contentAt } = element;
        if (EBML_PARENTS.includes(id)) { at = contentAt; continue; }
        if (size === null || contentAt + size > buffer.length) break;
        if (id === EBML.TIMESTAMP_SCALE) scale = uintAt(buffer, contentAt, size) || scale;
        else if (id === EBML.DURATION) duration = size === 4 ? buffer.readFloatBE(contentAt) : size === 8 ? buffer.readDoubleBE(contentAt) : null;
        else if (id === EBML.CLUSTER_TIMESTAMP) { cluster = uintAt(buffer, contentAt, size); last = Math.max(last || 0, cluster); }
        else if (id === EBML.SIMPLE_BLOCK || id === EBML.BLOCK) {
            const track = vintLength(buffer[contentAt]);
            if (track && size >= track + 2) last = Math.max(last || 0, cluster + buffer.readInt16BE(contentAt + track));
        }
        at = contentAt + size;
    }
    const ticks = duration > 0 ? duration : last;
    return ticks > 0 ? (ticks * scale) / 1e9 : null;
}

function mp4Box(buffer, from, to, type) {
    let at = from;
    while (at + 8 <= to) {
        let size = buffer.readUInt32BE(at);
        let header = 8;
        if (size === 1 && at + 16 <= to) { size = Number(buffer.readBigUInt64BE(at + 8)); header = 16; }
        else if (size === 0) size = to - at;
        if (size < header) return null;
        if (buffer.toString('latin1', at + 4, at + 8) === type) return { from: at + header, to: Math.min(to, at + size) };
        at += size;
    }
    return null;
}

/* A fragmented file states no length in its movie header and falls to the estimate. */
function mp4Seconds(buffer) {
    const moov = mp4Box(buffer, 0, buffer.length, 'moov');
    const mvhd = moov && mp4Box(buffer, moov.from, moov.to, 'mvhd');
    if (!mvhd || mvhd.to - mvhd.from < 20) return null;
    const wide = buffer[mvhd.from] === 1;
    if (wide && mvhd.to - mvhd.from < 32) return null;
    const timescale = buffer.readUInt32BE(mvhd.from + (wide ? 20 : 12));
    const duration = wide ? Number(buffer.readBigUInt64BE(mvhd.from + 24)) : buffer.readUInt32BE(mvhd.from + 16);
    if (!timescale || !duration || (!wide && duration === 0xffffffff)) return null;
    return duration / timescale;
}

function wavSeconds(buffer) {
    let at = 12;
    let byteRate = 0;
    while (at + 8 <= buffer.length) {
        const id = buffer.toString('latin1', at, at + 4);
        const size = buffer.readUInt32LE(at + 4);
        if (id === 'fmt ' && at + 20 <= buffer.length) byteRate = buffer.readUInt32LE(at + 16);
        if (id === 'data') return byteRate ? Math.min(size, buffer.length - at - 8) / byteRate : null;
        at += 8 + size + (size % 2);
    }
    return null;
}

const tagAt = (buffer, at, tag) => buffer.length >= at + tag.length && buffer.toString('latin1', at, at + tag.length) === tag;
const isWebm = (buffer) => buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3;
const isMp4 = (buffer) => tagAt(buffer, 4, 'ftyp');
const isWav = (buffer) => tagAt(buffer, 0, 'RIFF') && tagAt(buffer, 8, 'WAVE');

/* An MP3 or AAC file with no tag starts at a frame: eleven set bits, then a layer. Layer one is left out, because
 * UTF-16 text starts with the same two bytes. */
const startsAtAudioFrame = (buffer) => buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0x06;

/* Read from the bytes, not from the name or the type the sender states: the browser recorder names an MP4 recording
 * .webm, and a stored voice note comes back as video/webm. */
const isAudioFile = (buffer) => Buffer.isBuffer(buffer) && (isWebm(buffer) || isMp4(buffer) || isWav(buffer)
    || tagAt(buffer, 0, 'OggS') || tagAt(buffer, 0, 'fLaC') || tagAt(buffer, 0, 'ID3') || startsAtAudioFrame(buffer));

function containerSeconds(buffer) {
    if (buffer.length < 16) return null;
    if (isWebm(buffer)) return webmSeconds(buffer);
    if (isMp4(buffer)) return mp4Seconds(buffer);
    if (isWav(buffer)) return wavSeconds(buffer);
    return null;
}

/** @returns {{seconds:number, estimated:boolean}} estimated when the length came from the file's size */
function measure(buffer) {
    let seconds = null;
    try { seconds = containerSeconds(buffer); } catch (e) { seconds = null; }
    if (Number.isFinite(seconds) && seconds > 0) return { seconds, estimated: false };
    return { seconds: (buffer.length / ESTIMATED_BYTES_PER_MINUTE) * 60, estimated: true };
}

module.exports = { measure, isAudioFile, ESTIMATED_BYTES_PER_MINUTE };
