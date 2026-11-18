const HANDOFF_KEY = 'alianhub.ask.handoff';

const same = (a, b) => String(a || '').trim() === String(b || '').trim();

export function leaveAskHandoff(question, answer) {
    try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ question: String(question || '').trim(), answer })); } catch (e) { /* storage may be unavailable */ }
}

export function takeAskHandoff(question) {
    try {
        const handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
        if (!handoff || !handoff.answer || !same(handoff.question, question)) return null;
        sessionStorage.removeItem(HANDOFF_KEY);
        return handoff.answer;
    } catch (e) {
        return null;
    }
}
