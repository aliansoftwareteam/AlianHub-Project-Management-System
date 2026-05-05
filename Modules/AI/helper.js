const requestedPrompts = {};

setInterval(() => {
    for (const userId in requestedPrompts) {
        if (requestedPrompts[userId]) {
            const user = requestedPrompts[userId];
            const currentTime = new Date();
            const timeDifference = currentTime - user.lastReq;
            const minutesDifference = timeDifference / (1000 * 60);
            if (minutesDifference > 10) {
                exports.deleteChat(userId)
            }
        }
    }
}, 60000);

exports.addChat = (chatId,message) => {
    requestedPrompts[chatId] = {
        createdAt: Date.now(),
        lastReq: Date.now(),
        chats: [message]
    };
}

exports.pushChat = (chatId,message) => {
    const user = requestedPrompts[chatId];
    if (user) {
        user.lastReq = Date.now()
        user.chats.push(message);
    }
}

exports.getChat = (chatId) => {
    const user = requestedPrompts[chatId];
    if (user) {
        return requestedPrompts[chatId].chats;
    } else {
        return [];
    }
}

exports.deleteChat = (chatId) => {
    delete requestedPrompts[chatId];
}

exports.removeChat = (chatId) => {
    const user = requestedPrompts[chatId];
    if (user && user.chats.length > 0) {
        user.chats.splice(user.chats.length - 1, 1);
    }
}