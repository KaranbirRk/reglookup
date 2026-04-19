import "./style.css";

type OutState = {
  status: number | null;
  ms: number | null;
  path: string;
  body: string;
};

const state: { busy: number } = { busy: 0 };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, string | undefined>,
  children?: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of children) {
      node.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return node;
}

function apiBase(): string {
  const raw = (document.getElementById("api-base") as HTMLInputElement).value.trim();
  return raw.replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  const token = (document.getElementById("api-token") as HTMLInputElement).value.trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function registration(): string {
  return (document.getElementById("rego") as HTMLInputElement).value.trim();
}

function setBusy(on: boolean) {
  document.querySelectorAll("button[data-act], #lookup-form button[type=submit]").forEach((b) => {
    (b as HTMLButtonElement).disabled = on;
  });
}

function setLookupLoading(on: boolean) {
  const row = document.getElementById("lookup-loading");
  if (!row) return;
  row.hidden = !on;
  row.setAttribute("aria-busy", on ? "true" : "false");
  const rego = document.getElementById("rego") as HTMLInputElement | null;
  if (rego) rego.readOnly = on;
}

function setOut(s: OutState) {
  const meta = document.getElementById("out-meta")!;
  const pre = document.getElementById("out-body")!;
  const st = s.status;
  const cls =
    st === null ? "" : st >= 200 && st < 300 ? "status-2xx" : "status-4xx status-5xx";
  meta.innerHTML = "";
  meta.append(
    el("span", {}, [
      el("strong", {}, ["Path: "]),
      document.createTextNode(s.path),
    ])
  );
  if (st !== null) {
    const span = el("span", { class: cls }, [
      el("strong", {}, ["Status: "]),
      document.createTextNode(String(st)),
    ]);
    meta.append(span);
  }
  if (s.ms !== null) {
    meta.append(
      el("span", {}, [
        el("strong", {}, ["Time: "]),
        document.createTextNode(`${s.ms} ms`),
      ])
    );
  }
  if (s.ms !== null && s.ms >= 12_000 && st !== null && st >= 200 && st < 300) {
    meta.append(
      el("span", { class: "hint-inline" }, [
        "Live scrapes are slow; first hits after deploy or far-from-AU hosting can take this long. ",
        el("code", {}, ["/health"]),
        " shows ",
        el("code", {}, ["browsers"]),
        " when warmups finished.",
      ])
    );
  }
  pre.textContent = s.body;
}

const LOOKUP_FETCH_TIMEOUT_MS = 180_000;

async function runCombinedLookup(reg: string): Promise<void> {
  const url = `${apiBase() || ""}/api/lookup-combined`;
  state.busy++;
  setBusy(true);
  setLookupLoading(true);
  const t0 = performance.now();
  let status: number | null = null;
  let bodyText = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ registrationNumber: reg }),
      signal: AbortSignal.timeout(LOOKUP_FETCH_TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      bodyText = JSON.stringify(parsed, null, 2);
    } catch {
      bodyText = text;
    }
  } catch (e) {
    status = null;
    if (e instanceof DOMException && e.name === "TimeoutError") {
      bodyText = `Request aborted after ${LOOKUP_FETCH_TIMEOUT_MS / 1000}s (browser limit).\n\nThe Railway/proxy layer may have a shorter timeout than VicRoads+Repco need. Try again, or raise proxy timeouts.`;
    } else {
      bodyText =
        e instanceof Error
          ? `${e.name}: ${e.message}\n\nIf the API is on another host, set API base URL and CORS, or use the Vite proxy (local dev).`
          : String(e);
    }
  } finally {
    const ms = Math.round(performance.now() - t0);
    setLookupLoading(false);
    setOut({ status, ms, path: url, body: bodyText || "(empty)" });
    state.busy--;
    if (state.busy <= 0) setBusy(false);
  }
}

async function run(
  path: string,
  init: RequestInit & { parseJson?: boolean } = {}
): Promise<void> {
  const base = apiBase();
  const url = `${base}${path}`;
  const { parseJson = true, ...rest } = init;
  state.busy++;
  setBusy(true);
  const t0 = performance.now();
  let status: number | null = null;
  let bodyText = "";
  try {
    const res = await fetch(url, {
      ...rest,
      headers: {
        ...authHeaders(),
        ...(rest.headers || {}),
      },
    });
    status = res.status;
    const text = await res.text();
    if (parseJson) {
      try {
        bodyText = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        bodyText = text;
      }
    } else {
      bodyText = text;
    }
  } catch (e) {
    status = null;
    bodyText =
      e instanceof Error
        ? `${e.name}: ${e.message}\n\nIf the API is on another host, set API base URL and ensure CORS_ORIGIN on the server includes this UI origin, or leave base empty and use Vite proxy (local dev).`
        : String(e);
  } finally {
    const ms = Math.round(performance.now() - t0);
    setOut({ status, ms, path: url, body: bodyText || "(empty)" });
    state.busy--;
    if (state.busy <= 0) setBusy(false);
  }
}

function mount() {
  const root = document.getElementById("app")!;
  root.append(
    el("header", {}, [
      el("h1", {}, ["reglookup dashboard"]),
      el("p", {}, [
        "Enter a plate once and submit: the app calls ",
        el("strong", {}, ["VicRoads"]),
        " and ",
        el("strong", {}, ["Repco"]),
        " in one request (",
        el("code", {}, ["POST /api/lookup-combined"]),
        "). Under load the server keeps lookups in a queue; the page stays on “looking up” until the response returns. Leave API base empty in dev for the Vite proxy to ",
        el("code", {}, ["http://127.0.0.1:3000"]),
        ".",
      ]),
    ]),
    el("section", { class: "panel" }, [
      el("h2", {}, ["Connection"]),
      el("div", { class: "row" }, [
        el("label", {}, [
          el("span", {}, ["API base URL (optional)"]),
          el("input", {
            type: "text",
            id: "api-base",
            placeholder: "e.g. https://your-service.up.railway.app",
            autocomplete: "off",
          }),
        ]),
        el("label", {}, [
          el("span", {}, ["Bearer token (optional)"]),
          el("input", {
            type: "password",
            id: "api-token",
            placeholder: "LOOKUP_API_KEY if set on server",
            autocomplete: "off",
          }),
        ]),
      ]),
      el("div", { class: "btn-row" }, [
        (() => {
          const b = el("button", { type: "button", class: "primary", "data-act": "1" }, [
            "GET /health",
          ]);
          b.addEventListener("click", () => run(`${apiBase() || ""}/health`, { method: "GET" }));
          return b;
        })(),
      ]),
      el("p", { class: "hint" }, [
        "Proxy: ",
        el("code", {}, ["VITE_PROXY_TARGET"]),
        " in ",
        el("code", {}, ["frontend/.env.local"]),
        ".",
      ]),
    ]),
    el("section", { class: "panel panel--lookup" }, [
      el("h2", {}, ["Look up"]),
      (() => {
        const form = el("form", { id: "lookup-form", class: "lookup-form" });
        form.addEventListener("submit", (ev) => {
          ev.preventDefault();
          const reg = registration();
          if (!reg) {
            setOut({
              status: null,
              ms: null,
              path: "(validation)",
              body: "Enter a registration number before submitting.",
            });
            return;
          }
          void runCombinedLookup(reg);
        });
        form.append(
          el("label", { class: "reg-label" }, [
            el("span", {}, ["Registration"]),
            el("input", {
              type: "text",
              id: "rego",
              name: "registration",
              placeholder: "e.g. ABC123",
              autocomplete: "off",
              maxlength: "12",
            }),
          ]),
          el("button", { type: "submit", class: "primary submit-btn", "data-act": "1" }, [
            "Submit",
          ])
        );
        return form;
      })(),
      el("div", {
        id: "lookup-loading",
        class: "lookup-loading",
        hidden: "true",
        "aria-live": "polite",
        "aria-busy": "false",
      }, [
        el("span", { class: "lookup-loading__spinner", "aria-hidden": "true" }),
        el("span", { class: "lookup-loading__text" }, [
          "Looking up… ",
          el("span", { class: "lookup-loading__sub" }, [
            "If others are ahead of you, this waits in the server queue—no need to resubmit.",
          ]),
        ]),
      ]),
      el("p", { class: "hint" }, [
        "Each submit is one request; results are not stored on the server. Warm both browsers (Advanced) before demos to reduce cold latency.",
      ]),
    ]),
    el("details", { class: "panel panel--advanced" }, [
      (() => {
        const s = el("summary", {}, ["Advanced: browser warmup / cleanup"]);
        return s;
      })(),
      el("div", { class: "sides-grid" }, [
        el("div", { class: "side-actions" }, [
          el("h3", {}, ["VicRoads"]),
          el("div", { class: "btn-row" }, [
            (() => {
              const b = el("button", { type: "button", "data-act": "1" }, ["Warmup"]);
              b.addEventListener("click", () =>
                run(`${apiBase() || ""}/api/vehicle-lookup/warmup`, { method: "POST" })
              );
              return b;
            })(),
            (() => {
              const b = el("button", { type: "button", "data-act": "1" }, ["Cleanup"]);
              b.addEventListener("click", () =>
                run(`${apiBase() || ""}/api/vehicle-lookup/cleanup`, { method: "POST" })
              );
              return b;
            })(),
          ]),
        ]),
        el("div", { class: "side-actions" }, [
          el("h3", {}, ["Repco"]),
          el("div", { class: "btn-row" }, [
            (() => {
              const b = el("button", { type: "button", "data-act": "1" }, ["Warmup"]);
              b.addEventListener("click", () =>
                run(`${apiBase() || ""}/api/repco-search/warmup`, { method: "POST" })
              );
              return b;
            })(),
            (() => {
              const b = el("button", { type: "button", "data-act": "1" }, ["Cleanup"]);
              b.addEventListener("click", () =>
                run(`${apiBase() || ""}/api/repco-search/cleanup`, { method: "POST" })
              );
              return b;
            })(),
          ]),
        ]),
      ]),
    ]),
    el("section", { class: "panel" }, [
      el("h2", {}, ["Last response"]),
      el("div", { class: "output" }, [
        el("div", { class: "output-meta", id: "out-meta" }),
        el("pre", { id: "out-body" }, ["Submit a registration or hit Health."]),
      ]),
    ])
  );

  setOut({
    status: null,
    ms: null,
    path: "(none)",
    body: "Enter a rego and press Submit (or GET /health).",
  });
}

mount();
