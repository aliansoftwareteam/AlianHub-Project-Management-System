// Stands in for a parser that inflates a stream into memory outside the JS heap and never yields.
const held = [];
const busy = (ms) => { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } };
for (let i = 0; i < 64; i += 1) {
    held.push(Buffer.alloc(8 * 1024 * 1024, 1));
    busy(10);
}
for (;;) { /* spin */ }
