# Operations

Nothing here changes how the site works today. GitHub Pages keeps serving `main` from the repo root.

## What lives where
| Concern | Location |
|---|---|
| Site tests | `test/site.test.mjs` (`node --test test/`, no install needed) |
| Container | `Dockerfile`, `nginx.conf`, `docker-compose.yml`, `.dockerignore` |
| CI/CD | `.github/workflows/` `ci.yml` (tests, image build + smoke test, terraform + k8s validation), `pages.yml` (optional Pages-from-Actions), `docker.yml` (GHCR image on `v*` tags) |
| Kubernetes | `k8s/` (`kubectl apply -k k8s/`) |
| Terraform | `infra/terraform/` (cluster add-ons: namespace, ingress-nginx, cert-manager) |
| Metrics, health, error log, charts, SLOs | the **Health** tab of the admin app (`verdant-archive-originals/`, private repo) |

## Run the container locally
`docker compose up --build` then open http://localhost:8080. Health endpoint: `/healthz`.

## Switch Pages to Actions (optional)
Settings -> Pages -> Source: **GitHub Actions**, then add repository variable `PAGES_VIA_ACTIONS=true`. Until both are done `pages.yml` does nothing. The workflow publishes only `index.html`, `site.config.json`, `css/`, `js/`, `data/`, `media/`.

## Host on Kubernetes (future)
1. Create a cluster, point `~/.kube/config` at it.
2. `cd infra/terraform && terraform init && terraform apply`
3. Tag a release (`git tag v1.0.0 && git push --tags`) so `docker.yml` pushes `ghcr.io/<you>/the-verdant-archive`. Make the package public or add an image-pull secret.
4. Edit the host in `k8s/ingress.yaml` and the email in `k8s/clusterissuer.yaml`, then `kubectl apply -f k8s/clusterissuer.yaml && kubectl apply -k k8s/`.

## Size limits to know about
- GitHub Pages sites are limited to about **1 GB** published. `media/` is currently larger; the Health tab flags this. The container/Kubernetes route has no such limit.
- The image bakes in all of `media/`. Re-tag only when the gallery should ship; the site files revalidate, derivatives are immutable and cached for a year.

## Admin monitoring
`npm run admin`, then the **Health** tab. Settings live in `verdant-archive-originals/verdant.config.json`:
```json
"monitor": { "siteUrl": "https://you.github.io/The-Verdant-Archive/", "intervalSec": 60, "windowDays": 30,
             "availability": 99.5, "latency": 95, "latencyMs": 1500, "api": 99, "publish": 95 }
```
- `siteUrl: ""` turns the live-site probe off. The probe loads the page and `data/photos.json` like a visitor.
- SLOs: site availability, site speed (share of probes under `latencyMs`), admin requests without a 5xx, successful auto-publishes. Each shows the error budget left and 1h / 6h / 24h burn rates.
- History is stored in `verdant-archive-originals/.tmp/telemetry/*.jsonl` (git-ignored, 35 days kept). Delete the folder to reset.
- `http://127.0.0.1:4321/metrics` serves Prometheus text format for a future Grafana.
- Limit: the admin only measures while it is running, so availability covers the hours you have it open. For 24/7 numbers, scrape the deployed site from the cluster (the Deployment already exposes `/healthz`).
