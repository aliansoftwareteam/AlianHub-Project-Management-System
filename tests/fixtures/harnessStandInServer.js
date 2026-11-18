/* Stands in for index.js in the harness test: same fatal handling of a failed listen, same ready line. */
const http = require('node:http');

require('../../Config/processGuards').install();

const port = Number(process.env.PORT);
http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404);
    res.end('stand-in');
}).listen(port, () => console.log(`Server ready on ${port}`));
