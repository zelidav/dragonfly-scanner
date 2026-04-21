# Dragonfly Scanner — Product Guide

**For the Dragonfly team, admins, and anyone who maintains the app.**

Live URL: <https://dragonfly.cannacrypted.com> (proxy for the Cloud Run service `dragonfly-scanner`)
Admin URL: <https://dragonfly.cannacrypted.com/admin>
Source: <https://github.com/zelidav/dragonfly-scanner>

---

## What it is

A mobile-first web app with two surfaces:

1. **Customer surface** — scan Dragonfly products to see strain details; scan dispensary receipts to earn loyalty points.
2. **Admin surface** — a dashboard at `/admin` for the Dragonfly team to manage products, loyalty accounts, and review flagged activity.

Everything runs in a single Node/Express service on Cloud Run. The frontend is a Vite+React SPA served by the same container.

---

## Feature map

### Customer
- **Product scan** — Claude Vision identifies the strain from a photo of the label. Falls back to fuzzy-matching OCR against our 64-strain database.
- **Browse all strains** — searchable list of every Dragonfly strain with images, genetics, flavor, effects.
- **Nearest retailers** — geolocation-sorted list of dispensaries carrying Dragonfly.
- **Loyalty program** — email-as-identity account (no password). Receipt scanning awards 1 point per $1 on Dragonfly line items.
- **History view** — balance + every receipt the account has submitted.

### Admin (at `/admin`, protected by `ADMIN_KEY`)
- **Dashboard** — scans, signups, products, loyalty accounts, receipts, points issued, flagged count, uptime.
- **Products tab** — CRUD over the strain database.
- **Loyalty tab** — three sub-views:
  - *Receipts* — every submitted receipt with retailer, total, Dragonfly subtotal, items, flags, location, status.
  - *Flagged* — filtered view of receipts needing review.
  - *Accounts* — every loyalty account with points, flag count, status.
- **Admin actions** — void a receipt (reverses points), flag a receipt, adjust an account's points by delta, block/unblock an account.
- **Scraper tab** — pull product listings from `dragonflybrandny.com` and related sites.

---

## Architecture at a glance

```
  Customer browser ─────┐                 Admin browser
        (SPA)           │                      (admin.html)
         │              │                          │
         └──────────────┼──────────────────────────┘
                        │  HTTPS (custom domain: dragonfly.cannacrypted.com)
                        ▼
            ┌──────────────────────┐
            │ Cloud Run            │
            │ dragonfly-scanner    │
            │ us-east1             │
            │ (Node/Express)       │◀── calls Claude Vision
            │ max-instances: 10    │      (Anthropic API)
            │                      │◀── calls Resend
            │                      │      (email notifications only now)
            └──────────┬───────────┘
                       │
                       │ write-through (debounced 2s)
                       ▼
            ┌──────────────────────┐
            │ gs://dragonfly-      │
            │  scanner-data/       │
            │  dragonfly/          │
            │                      │
            │ products.json        │
            │ accounts.json        │
            │ receipts.json        │
            │ scrape-sites.json    │
            └──────────────────────┘
```

- **Frontend** (`src/App.jsx`): one big React component, camera + file-upload capture, calls `/api/*` on the same origin.
- **Backend** (`server.js`): Express app, `/api/scan` for product vision, `/api/loyalty/*` for loyalty, `/api/admin/*` for the admin surface.
- **LLM**: Anthropic Claude Haiku 4.5 for both product identification and receipt parsing (separate prompts).
- **Data**: four JSON files in `data/`, each mirrored to GCS on save and hydrated from GCS on startup.
- **Auth**:
  - Customer loyalty: HMAC-signed JWT-style token (`{email, exp}`) stored in the browser's localStorage. 30-day TTL.
  - Admin: a single shared secret (`ADMIN_KEY`) passed as `?key=` query param.

---

## Loyalty program rules

| Rule | Value | Notes |
|---|---|---|
| Points rate | 1 point per $1 of Dragonfly subtotal | Rounded down |
| Approval | Automatic, instant | No queue |
| Session length | 30 days | Token stored in localStorage |
| Duplicate receipt | Blocked globally | SHA-256 hash of `retailer + date + total + items` — second submission is rejected with 409 |
| Account identity | Email only | No password, no code verification |

### Anomaly flags (non-blocking — points still awarded, visible to admin)
| Flag | Trigger |
|---|---|
| `low_confidence_parse` | Claude returned confidence: "low" |
| `no_items_parsed` | Empty items array |
| `no_dragonfly_items` | No Dragonfly line items found |
| `high_value` | Total > $500 |
| `rapid_submission` | ≥3 receipts from same account in 5 min |
| `dragonfly_exceeds_total` | Dragonfly subtotal > receipt total (parse bug) |
| `low_location_accuracy` | Provided location accuracy > 1000m |
| `high_daily_submissions` | ≥10 receipts from same account in 24h |

### Data stored per receipt
```json
{
  "id": "8-byte hex",
  "email": "account identifier",
  "retailer": "string",
  "date": "YYYY-MM-DD",
  "total": 45.99,
  "subtotal": 42.00,
  "tax": 3.99,
  "items": [
    { "name": "...", "qty": 1, "price": 18.00, "is_dragonfly": true, "notes": "" }
  ],
  "dragonflySubtotal": 18.00,
  "pointsAwarded": 18,
  "status": "approved | voided",
  "flags": ["high_value", ...],
  "hash": "sha256 for dedup",
  "confidence": "high | medium | low",
  "location": { "lat": ..., "lng": ..., "accuracy": ..., "source": "browser" },
  "timestamp": "ISO"
}
```

---

## Admin walkthrough

1. Go to <https://dragonfly.cannacrypted.com/admin>
2. Enter `ADMIN_KEY` (stored in browser localStorage).
3. Tabs:
   - **Dashboard** — overview of everything. Stat cards are live; activity feed updates on each page load.
   - **Products** — click any row to edit; **+ Add Product** to create. Image URLs should be hosted (GCS or CDN); we don't upload from the admin.
   - **Loyalty** — pick a sub-tab:
     - *Receipts*: search by email, retailer, or item name; filter by status; click **View** for the parse detail.
     - *Flagged*: receipts with anomaly flags — usable as a review queue.
     - *Accounts*: adjust points with a delta (+50, -25, etc.), block/unblock for abuse.
   - **Scraper** — run it against a product URL to pull strain images and prices.
   - **Settings** — shows which env vars are configured; useful when diagnosing a bad deploy.

### Common admin tasks

**Customer says their points are wrong.**
- Loyalty → Accounts → search their email → **Adjust** → enter a signed delta (e.g. `+18`) and reason. Adjustment is logged in activity feed.

**Suspicious receipt — want to reverse it.**
- Loyalty → Receipts → find it → **Void**. Points are deducted immediately. Reason field recommended; it's logged.

**Shutting down a bad actor.**
- Loyalty → Accounts → **Block**. They can't request codes or submit receipts until unblocked.

**Bulk refund scenario.**
- No UI for this yet. You can either adjust points per-account, or open a terminal to the Cloud Run service via `gcloud` and edit `accounts.json` directly (not recommended — will race with running writes).

---

## Operational runbook

### Deploy
- Everything deploys on `git push origin main` via GitHub Actions (`.github/workflows/deploy.yml`).
- Uses Google's auth with workload-identity-federation; no keys in the repo.
- Target: project `jbd-glass`, region `us-east1`, service `dragonfly-scanner`, max-instances 10.

### Environment variables

| Var | Purpose | Required? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Vision for product + receipt parse | **yes** |
| `ADMIN_KEY` | Admin dashboard auth | **yes** |
| `RESEND_API_KEY` | Transactional email (signups) | yes for emails |
| `NOTIFY_EMAIL` | Recipient for Hive signup notifications | yes |
| `FROM_EMAIL` | Sender for transactional mail | yes |
| `GCS_BUCKET` | Enables write-through persistence | optional — without it, data is ephemeral |
| `GCS_PREFIX` | Prefix inside the bucket | defaults to `dragonfly/` |
| `LOYALTY_SECRET` | HMAC signing key for loyalty sessions | optional — falls back to `ADMIN_KEY` |
| `PORT` | Cloud Run sets this automatically | n/a |

### To update an env var **without wiping others**:
```
gcloud run services update dragonfly-scanner \
  --region=us-east1 --project=jbd-glass \
  --update-env-vars=KEY=value
```
Use `--update-env-vars` (additive), **not** `--set-env-vars` (replaces the whole list).

### Monitoring
- Logs: Cloud Run → `dragonfly-scanner` → Logs. Search for `loyalty_`, `scan`, `GCS upload`, `error`.
- Health: `GET /api/health` — public, returns loyalty totals + Resend/GCS status.
- Admin stats: `GET /api/admin/stats?key=...` — more detail.

### Rollback
- `gcloud run services update-traffic dragonfly-scanner --region=us-east1 --project=jbd-glass --to-revisions=<previous-revision-name>=100`
- Revisions are listed with `gcloud run revisions list --service=dragonfly-scanner --region=us-east1 --project=jbd-glass`.

### Restoring loyalty data
- GCS is the source of truth. Any container instance can fail or be replaced — the next one hydrates from the bucket at startup.
- Before destructive manual edits, copy `gs://dragonfly-scanner-data/dragonfly/*.json` to a dated backup prefix.

---

## Known limitations

- **Multi-instance writes can race.** `max-instances=10` + JSON-file storage = last-writer-wins under simultaneous saves. Real today but probably not exercised at current volume. Migrate to Firestore when receipt throughput sustains >1/min or you see admin data inconsistencies.
- **No password / no 2FA on loyalty accounts.** Anyone who knows an email can submit receipts to that account. Mitigation: duplicate-hash blocking, anomaly flags, admin void/block. Add lightweight rate limiting or magic-link verification if abuse appears.
- **Points redemption isn't implemented.** Accounts accrue points; there's no catalog, no redeem flow, no reversal for redemptions. Roadmap item.
- **No receipt image is kept after parsing.** We don't store the photo, only the parsed fields. Disputes cannot be re-reviewed by re-reading the image. If disputes become routine, add image storage in GCS with a TTL.
- **Admin key is a single shared secret.** No user identity for admin actions. OK for a small team; replace with per-user auth (OAuth or Cloud IAP) before broadening access.
- **Product DB is static.** The 64 strains are baked into `src/App.jsx` today; `data/products.json` can be edited from the admin UI but the SPA still ships with the hardcoded list for fallback. Unifying these is a modest refactor.

---

## Roadmap (sketch)

- Point redemption catalog + "redeem" UX
- Firestore migration when volume justifies
- Ingestion of strain breeder / lineage data from SeedFinder (clickable parents)
- Est. retail valuation per product (category + THC)
- Better search: filter by phenotype, lineage, terpene profile
- Magic-link email verification as an opt-in for users who want higher-trust accounts
- Per-admin login (replace shared `ADMIN_KEY`)

---

**Questions or changes?** File issues at the GitHub repo or DM the dev team.
