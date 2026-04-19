# reglookup

HTTP microservice that mirrors the Friday app’s VicRoads and Repco Puppeteer flows: same routes, same JSON shapes, and the same scraper logic vendored from `KaranbirRk/Friday`.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Liveness and queue backlog (no response caching) |
| POST | `/api/vehicle-lookup` | Body `{ "registrationNumber": "ABC123" }` |
| POST | `/api/vehicle-lookup/warmup` | VicRoads `warmupBrowser()` |
| POST | `/api/vehicle-lookup/cleanup` | VicRoads `closeBrowser()` |
| GET | `/api/repco-search?registration=ABC123` | Repco lookup |
| POST | `/api/repco-search/warmup` | Repco warmup |
| POST | `/api/repco-search/cleanup` | Repco cleanup |
| POST | `/api/lookup-combined` | **Recommended for backends:** body `{ "registrationNumber": "ABC123" }` — VicRoads + Repco **in parallel**, **no** stored responses; each call scrapes fresh (warm browsers stay in RAM only while the process runs). |

### Calling from your software

Use **`POST /api/lookup-combined`** with JSON `{ "registrationNumber": "…" }` (3–10 chars after trim). The JSON body includes **`vicroads`**, **`repco`**, **`ms`**, and **`registrationNumber`**. There is **no disk or Redis cache of results** in the default setup.

Many **different** plates in parallel are fine up to queue limits; each **VicRoads** scrape and each **Repco** scrape is still **serialized per site** on a single instance (one page per browser) so heavy bursts queue rather than corrupting tabs.

### Latency

Each lookup is dominated by VicRoads/Repco network and page time (often **several seconds**). Optional env tuning: `VICROADS_NAV_TIMEOUT_MS`, `VICROADS_INPUT_WAIT_MS`, `VICROADS_RESULT_WAIT_MS`, `REPCO_RESULT_WAIT_MS` (see `.env.example`).

## Railway checklist

1. **Build**: [railway.toml](railway.toml) sets `builder = "DOCKERFILE"` so Railway uses the repo **Dockerfile** (Chromium + `npm ci` + `tsc` build). Default **Railpack** would not install a working browser for Puppeteer.
2. **Start**: same image `CMD` is `node dist/server.js`; Railway sets **`PORT`** automatically (no change needed).
3. **Memory**: allocate **≥ 2 GB** per service that runs Puppeteer (two Chromium processes when both VicRoads and Repco are used). **512 MB plans will OOM or crash.**
4. **Chromium**: the Dockerfile sets `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` and `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1`.
5. **Health check**: [railway.toml](railway.toml) sets `healthcheckPath = "/health"` (also configurable in the Railway UI).
6. **Optional auth**: set `LOOKUP_API_KEY` and send `Authorization: Bearer <key>` on all routes except `/health`.
7. **Scaling**:
   - **No Redis**: each replica is independent; use in-process queue; horizontal scale = multiple isolated browsers (no shared queue).
   - **With Redis**: set `REDIS_URL`, deploy **both** the web service (`npm start`) and a **worker** service (`npm run worker`) from the same image so BullMQ jobs are processed. Without workers, queued scrapes will never finish.
   - **Warmup with Redis**: `POST .../warmup` runs in the **API** process only; BullMQ scrapes run in **worker** processes with their own browsers. Rely on lazy launch on first job per worker, or run a warmup job per worker if you add that automation later.
8. **CORS**: optional `CORS_ORIGIN` (comma-separated) if a browser calls the API directly.
9. **Frontend**: the Vite app in `frontend/` is **not** in the Docker image; your production software should call Railway over HTTPS from the server.

## Railway CLI (this repo)

The dev dependency **`@railway/cli`** is pinned so everyone uses the same CLI via `npx` / npm scripts (no global install required).

| Script | What it does |
|--------|----------------|
| `npm run railway:login` | Browser login to Railway (once per machine). |
| `npm run railway:whoami` | Show the logged-in account. |
| `npm run railway:init` | **New** Railway project from this directory (interactive). |
| `npm run railway:link` | Link this directory to an **existing** project (writes local `.railway/`, gitignored). |
| `npm run railway:unlink` | Remove the local link. |
| `npm run railway:up` | **Deploy from your laptop**: upload sources, build with your **[railway.toml](railway.toml)** Dockerfile, stream logs. |
| `npm run railway:logs` | Tail deployment / runtime logs. |
| `npm run railway:open` | Open the project in the browser. |
| `npm run railway:status` | Show linked project / service info. |
| `npm run railway:vars` | Manage variables (pass subcommands, e.g. `npm run railway:vars -- list`). |
| `npm run railway:shell` | Subshell with Railway-injected env vars. |
| `npm run railway:run` | Run a one-off command with Railway env injected (e.g. `npm run railway:run -- node dist/server.js`). |

**One-shot (local machine, interactive)**

From the repo root:

```bash
npm run railway:first-deploy
```

This runs `npm install`, `railway login`, `railway init -n reglookup` (skipped if `.railway/` already exists), then `railway up`.

**Typical first-time flow (manual steps)**

1. `npm install`
2. `npm run railway:login`
3. Either `npm run railway:init` (create project) **or** create the project in the Railway UI, then `npm run railway:link`.
4. In the Railway dashboard: set **RAM ≥ 2 GB** on the API service, confirm **Dockerfile** build (already implied by `railway.toml`).
5. Set secrets as needed, for example:  
   `npx railway variable set LOOKUP_API_KEY=your-secret`  
   Use `-s <service-name>` if the CLI asks which service (API vs worker).
6. `npm run railway:up` to deploy from local files, **or** connect **GitHub** in Railway and push to `main` for automatic deploys (no `up` required).

**GitHub vs `railway up`**

- **GitHub integration (Railway UI)**: connect the repo in Railway’s dashboard; pushes build there (no local CLI).
- **GitHub Actions + CLI**: [`.github/workflows/railway-deploy.yml`](.github/workflows/railway-deploy.yml) runs **`npx railway up --ci`**. Add Actions secret **`RAILWAY_TOKEN`** (Railway **project token**: Project → Settings → Tokens). Optionally **`RAILWAY_PROJECT_ID`** and **`RAILWAY_SERVICE`**. Then open **Actions → Deploy to Railway → Run workflow**. To deploy on every push to `main`, edit that workflow and add a `push` trigger under `on:` (see comment in the file).
- **Local `railway up`**: useful for quick iterations without waiting for GitHub.

**Bull worker (optional)**

If you use `REDIS_URL`, add a **second service** in the same project (e.g. `railway add` or the UI), same image/repo, start command **`npm run worker`**, and set `REDIS_URL` on **both** API and worker.

## How to verify the API

1. **Health (fast, no browser):** with the API running on port 3000, run `curl -sS http://127.0.0.1:3000/health | jq` (or without `jq` to see raw JSON). You should see `"ok": true` and backlog fields.
2. **VicRoads lookup (slow, real scrape):**  
   `curl -sS -X POST http://127.0.0.1:3000/api/vehicle-lookup -H 'Content-Type: application/json' -d '{"registrationNumber":"ABC123"}'`
3. **Repco:**  
   `curl -sS 'http://127.0.0.1:3000/api/repco-search?registration=ABC123'`
4. **Optional auth:** if `LOOKUP_API_KEY` is set, add `-H "Authorization: Bearer YOUR_KEY"` to every request except `GET /health`.
5. **Browser UI:** use the separate dashboard in [`frontend/`](frontend/) (see below) so you can click warmup, lookup, and cleanup without writing curl each time.

## Local development

```bash
npm install
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # macOS
npm run dev
```

### Dashboard (separate frontend)

From another terminal (API still on port 3000):

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Leave **API base URL** empty so calls go through the Vite dev proxy to `http://127.0.0.1:3000` (no CORS setup needed). If you point the UI at a public Railway URL instead, set **`CORS_ORIGIN`** on the API to include your UI origin (e.g. `http://localhost:5173`), or use a server-side proxy.

Optional: create `frontend/.env.local` with `VITE_PROXY_TARGET=http://127.0.0.1:PORT` if your API is not on 3000.

## Docker Compose (API + Redis + Bull worker)

```bash
docker compose up --build
```

- API: `http://localhost:3000`
- Set `LOOKUP_API_KEY` / `CORS_ORIGIN` in `docker-compose.yml` as needed.

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run `dist/server.js`
- `npm run worker` — run BullMQ workers (`dist/worker.js`) when using `REDIS_URL`
- `npm run railway:*` — Railway CLI wrappers (see **Railway CLI** above)

## Environment variables

See [.env.example](.env.example) for the full list.
