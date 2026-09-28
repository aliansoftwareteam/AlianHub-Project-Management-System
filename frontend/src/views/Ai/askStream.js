import Cookies from "js-cookie";
import * as env from "@/config/env";

/* Whole `data:` events out of what has arrived so far; a partial event stays in `rest` for the next chunk.
 * Comment lines (the `: ping` heartbeat) carry no data and are dropped. */
export function readSse(buffer) {
    const blocks = String(buffer).split("\n\n");
    const rest = blocks.pop();
    const events = [];
    blocks.forEach((block) => {
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) return;
        try {
            events.push(JSON.parse(data));
        } catch {
            /* a malformed event is skipped, as the progress streams do */
        }
    });
    return { events, rest };
}

/* The same headers the axios instance sends; fetch is used because axios cannot read a response body as it arrives. */
const headers = () => {
    const token = Cookies.get("accessToken") || "";
    let companyId = "";
    try {
        companyId = localStorage.getItem("selectedCompany") || "";
    } catch {
        companyId = "";
    }
    return {
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        companyId
    };
};

/* Resolves to { kind: 'done' | 'error', payload } for a streamed answer, or { kind: 'json', payload, status }
 * when the server answered without a model call (a refusal, no provider, nothing matched). An abort rejects
 * with the AbortError fetch raises. */
export async function streamAsk({ body, signal, onToken }) {
    const response = await fetch(`${env.API_URI}${env.AI_ASK_STREAM}`, {
        method: "POST",
        headers: headers(),
        credentials: "same-origin",
        body: JSON.stringify(body),
        signal
    });
    const type = (response.headers && response.headers.get("content-type")) || "";
    if (!type.includes("text/event-stream") || !response.body) {
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        return { kind: "json", payload, status: response.status };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: !done });
        const { events, rest } = readSse(done ? `${buffer}\n\n` : buffer);
        buffer = rest || "";
        for (const event of events) {
            if (event.event === "token") onToken(String(event.text || ""));
            else if (event.event === "done" || event.event === "error") return { kind: event.event, payload: event };
        }
        if (done) return { kind: "error", payload: { event: "error", code: "stream_ended" } };
    }
}
