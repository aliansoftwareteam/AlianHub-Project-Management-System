import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

// scope=all answers with the pages the caller may open, so a citation links only
// when the server would also let this viewer read the page. One request per
// session, shared by every comment on screen.
const pages = ref(new Map());
let request = null;

const ensure = () => {
    if (!request) {
        request = apiRequest("get", `${env.PAGES}?scope=all`)
            .then((res) => {
                const rows = res?.data?.status && Array.isArray(res.data.data) ? res.data.data : [];
                pages.value = new Map(rows.map((page) => [String(page._id).toLowerCase(), page]));
            })
            .catch(() => { request = null; });
    }
    return request;
};

export function useVisiblePages() {
    const pageOf = (id) => pages.value.get(String(id || "").toLowerCase()) || null;
    return { ensure, pageOf };
}
