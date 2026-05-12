const events = require('events');
const eventEmitter = new events.EventEmitter();

exports.emitListener = (evId, data) => {
    eventEmitter.emit(evId, data)
}
exports.handleEvents = (req, res) => {
    try {
        const evId = req.params.id;
        const sendProgress = (data) => {
            res.write(`data: ${JSON.stringify({ data })}\n\n`);
        };

        const testFun = (data) => {
            if(data.step === "STOP") {
                sendProgress({...data, step: 100});
                eventEmitter.off(evId, testFun)
                res.end();
            } else {
                sendProgress(data);
            }
        }

        eventEmitter.on(evId, testFun)
    } catch (error) {
        console.error("ERROR IN EMITTER: ", error);
    }
}