# Digital Twin — AI Executive Assistant

> An AI middleware layer that sits between you and your communication channels — filtering noise, triaging messages, drafting replies, and escalating only what genuinely needs your attention.

**Status:** Phase 1 MVP · Gmail + Google Chat · Human-in-the-loop

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [Architecture Overview](#architecture-overview)
3. [Folder Structure](#folder-structure)
4. [Running Locally](#running-locally)
5. [Environment Variables](#environment-variables)
6. [Google OAuth Setup](#google-oauth-setup)
7. [Gmail Pub/Sub Webhook Setup](#gmail-pubsub-webhook-setup)
8. [Google Chat Webhook Setup](#google-chat-webhook-setup)
9. [Database Setup](#database-setup)
10. [How the Triage Pipeline Works](#how-the-triage-pipeline-works)
11. [Human-in-the-Loop (HITL) Flow](#human-in-the-loop-hitl-flow)
12. [Safety Guardrails](#safety-guardrails)
13. [Scaling to Production](#scaling-to-production)
14. [Making This Open Source](#making-this-open-source)
15. [Roadmap](#roadmap)
16. [Contributing](#contributing)
17. [License](#license)

---

## What It Does

Digital Twin connects to your Gmail and Google Chat, reads every incoming message, and runs it through an AI triage pipeline powered by Claude. Based on the result, it either:

- **Auto-handles** low-stakes social messages (high confidence only)
- **Drafts a reply** and queues it for your approval
- **Interrupts you immediately** for urgent or sensitive messages
- **Batches informational messages** into a daily digest

The AI **never sends anything autonomously** that involves money, contracts, HR, clients, or anything it is uncertain about. Every decision is logged in an immutable audit trail.

---

## Architecture Overview

```
                    ┌──────────────────────────────────────┐
                    │           Incoming Messages           │
                    │   Gmail (Pub/Sub)  │  Google Chat     │
                    └─────────┬──────────┴────────┬─────────┘
                              │                   │
                    ┌─────────▼───────────────────▼─────────┐
                    │         Fastify API  (apps/api)        │
                    │   Webhook receivers · OAuth endpoints  │
                    └─────────────────┬─────────────────────┘
                                      │ BullMQ job
                    ┌─────────────────▼─────────────────────┐
                    │           Triage Worker                │
                    │  1. Fetch message from DB              │
                    │  2. Retrieve relevant memories         │
                    │  3. Call Claude Sonnet 4 (LLM)         │
                    │  4. Validate output with Zod           │
                    │  5. Apply guardrails                   │
                    │  6. Apply decision matrix              │
                    └─────────────────┬─────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
        auto_handle            queue_approval         interrupt_immediate
        (silent)             (HITL dashboard)        (push notification)
                                      │
                    ┌─────────────────▼─────────────────────┐
                    │         React Dashboard (apps/web)     │
                    │   Inbox · Approval queue · Audit log   │
                    └─────────────────┬─────────────────────┘
                                      │ approve / reject / edit
                    ┌─────────────────▼─────────────────────┐
                    │           Reply Worker                 │
                    │   Send via Gmail API / Chat API        │
                    │   Mark approval SENT · Audit log       │
                    └────────────────────────────────────────┘
```

**Tech stack:**

| Layer | Technology |
|---|---|
| API | Node.js · TypeScript · Fastify |
| AI | Claude Sonnet 4 (Anthropic SDK) |
| Queue | BullMQ + Redis |
| Database | PostgreSQL + pgvector (Prisma ORM) |
| Frontend | React 18 + Vite + Tailwind + shadcn/ui |
| Auth | Auth.js (Google OAuth 2.0) |
| Monorepo | npm workspaces |

---

## Folder Structure

```
digital-twin/
│
├── apps/
│   ├── api/                          # Fastify backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # Full DB schema (users, messages, triage, approvals, audit)
│   │   │   └── migrations/           # Auto-generated Prisma migrations
│   │   └── src/
│   │       ├── config/
│   │       │   └── index.ts          # Zod-validated environment variables
│   │       │
│   │       ├── ingestion/
│   │       │   ├── gmail/
│   │       │   │   ├── webhook.ts    # Pub/Sub push receiver
│   │       │   │   └── oauth.ts      # Gmail OAuth2 flow
│   │       │   └── google-chat/
│   │       │       ├── webhook.ts    # Google Chat event receiver
│   │       │       └── oauth.ts      # Chat OAuth2 flow
│   │       │
│   │       ├── queue/
│   │       │   └── worker.ts         # BullMQ triage + reply workers
│   │       │
│   │       ├── cognitive/
│   │       │   ├── prompts/
│   │       │   │   └── triage-v1.txt # Versioned system prompt
│   │       │   └── classifiers/
│   │       │       └── triage.ts     # LLM orchestration + retry + validation
│   │       │
│   │       ├── decision/
│   │       │   └── triage-matrix.ts  # Maps triage result → system action
│   │       │
│   │       ├── memory/
│   │       │   ├── embeddings.ts     # Text embedding + pgvector storage
│   │       │   └── retrieval.ts      # Semantic memory retrieval
│   │       │
│   │       ├── actions/
│   │       │   └── send-reply.ts     # Platform reply dispatcher
│   │       │
│   │       ├── hitl/
│   │       │   └── approval.ts       # Approval queue management
│   │       │
│   │       ├── notifications/
│   │       │   └── notify.ts         # Push / email / digest notifications
│   │       │
│   │       ├── audit/
│   │       │   └── index.ts          # INSERT-only immutable audit logger
│   │       │
│   │       └── routes/
│   │           ├── messages.ts       # GET /messages, GET /messages/:id
│   │           ├── approvals.ts      # GET/POST /approvals/:id
│   │           ├── integrations.ts   # OAuth connect/disconnect
│   │           └── health.ts         # Health check endpoint
│   │
│   └── web/                          # React frontend
│       └── src/
│           ├── pages/
│           │   ├── inbox/            # Message feed with triage context
│           │   ├── approvals/        # HITL approval queue
│           │   ├── tasks/            # Extracted tasks dashboard
│           │   ├── logs/             # Audit log viewer
│           │   └── settings/         # Preferences, integrations, style
│           ├── components/
│           │   ├── ui/               # shadcn/ui base components
│           │   └── layout/           # Sidebar, header, nav
│           ├── hooks/                # useMessages, useApprovals, etc.
│           ├── lib/                  # API client, date utils
│           └── store/                # Zustand global state
│
├── packages/
│   ├── shared-types/
│   │   └── index.ts                  # Zod schemas shared across apps
│   └── platform-adapters/
│       └── index.ts                  # Gmail + Google Chat adapter interfaces
│
├── infra/
│   ├── docker-compose.yml            # Local Postgres + Redis
│   ├── Dockerfile.api
│   └── Dockerfile.web
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint, typecheck, test on PR
│       └── deploy.yml                # Deploy on merge to main
│
├── package.json                      # Monorepo root
└── README.md
```

---

## Running Locally

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- A Google Cloud project with Gmail API and Google Chat API enabled
- An Anthropic API key

### Step 1 — Clone and install

```bash
git clone https://github.com/your-org/digital-twin.git
cd digital-twin
npm install
```

### Step 2 — Start infrastructure (Postgres + Redis)

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:
- PostgreSQL on `localhost:5432` with the `pgvector` extension
- Redis on `localhost:6379`

### Step 3 — Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values. See [Environment Variables](#environment-variables) below for the full list.

### Step 4 — Run database migrations

```bash
npm run db:generate   # generate Prisma client
npm run db:migrate    # run migrations (creates all tables + pgvector extension)
```

### Step 5 — Start the development servers

```bash
npm run dev
```

This runs both the API (port 3001) and web dashboard (port 3000) concurrently with hot reload.

Or run them separately:

```bash
npm run dev:api   # API only
npm run dev:web   # Dashboard only
```

### Step 6 — Connect your Google account

Open `http://localhost:3000` and click **Connect Gmail** and/or **Connect Google Chat**. This runs the OAuth2 flow and stores your tokens.

### Step 7 — Set up webhook forwarding (local dev)

Gmail uses Google Pub/Sub to push notifications. To receive these locally, you need to expose your local API:

```bash
# Install ngrok (or use any tunnel)
npx ngrok http 3001

# Take the https URL, e.g. https://abc123.ngrok.io
# Register it as a Pub/Sub push endpoint — see Gmail Pub/Sub Setup below
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values.

```bash
# Server
NODE_ENV=development
PORT=3001
APP_URL=http://localhost:3000
API_URL=http://localhost:3001

# Database (Postgres with pgvector)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/digital_twin

# Redis (BullMQ queues)
REDIS_URL=redis://localhost:6379

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Google OAuth 2.0
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# Google Pub/Sub (Gmail push notifications)
GOOGLE_PUBSUB_TOPIC=projects/YOUR_PROJECT/topics/gmail-notifications
GOOGLE_PUBSUB_SUBSCRIPTION=projects/YOUR_PROJECT/subscriptions/gmail-notifications-sub

# Security
JWT_SECRET=your-32-character-minimum-secret-here
ENCRYPTION_KEY=64-character-hex-string-for-token-encryption

# Triage behaviour
CONFIDENCE_THRESHOLD=0.85   # Below this, always escalate to human
DIGEST_HOUR=8               # UTC hour to send daily digest (0-23)
```

Generate a random encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable these APIs:
   - Gmail API
   - Google Chat API
   - Cloud Pub/Sub API
4. Go to **APIs & Services → Credentials → Create OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add to **Authorised redirect URIs**:
   - `http://localhost:3001/auth/google/callback` (local)
   - `https://yourdomain.com/auth/google/callback` (production)
7. Copy the **Client ID** and **Client Secret** into your `.env`

**OAuth scopes required:**

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/chat.messages
https://www.googleapis.com/auth/chat.spaces.readonly
```

---

## Gmail Pub/Sub Webhook Setup

Gmail push notifications flow through Google Cloud Pub/Sub. You set this up once per Google Cloud project.

### Step 1 — Create a Pub/Sub topic

```bash
gcloud pubsub topics create gmail-notifications
```

### Step 2 — Grant Gmail publish rights to the topic

```bash
gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

### Step 3 — Create a push subscription

```bash
gcloud pubsub subscriptions create gmail-notifications-sub \
  --topic=gmail-notifications \
  --push-endpoint=https://your-api-domain.com/webhooks/gmail \
  --ack-deadline=60
```

For local dev, use your ngrok URL:

```bash
gcloud pubsub subscriptions modify-push-config gmail-notifications-sub \
  --push-endpoint=https://abc123.ngrok.io/webhooks/gmail
```

### Step 4 — Watch the inbox

After a user connects their Gmail, call Gmail's `watch` API to subscribe to push notifications:

```bash
POST https://gmail.googleapis.com/gmail/v1/users/me/watch
{
  "topicName": "projects/YOUR_PROJECT/topics/gmail-notifications",
  "labelIds": ["INBOX"]
}
```

The API does this automatically on OAuth completion. Note: watches expire after 7 days and must be renewed. The API runs a daily cron to renew active watches.

---

## Google Chat Webhook Setup

Google Chat sends events to your API when messages are posted in spaces where the app is installed.

1. Go to [Google Cloud Console → Google Chat API](https://console.cloud.google.com/apis/library/chat.googleapis.com)
2. Click **Configuration**
3. Set **Connection settings** to **App URL**
4. Set the URL to `https://your-api-domain.com/webhooks/google-chat`
5. Enable the **MESSAGE** event type
6. Install the app in the desired Google Chat spaces

For local development, use ngrok and update the App URL to your tunnel address.

---

## Database Setup

The schema is managed by Prisma. Key tables:

| Table | Purpose |
|---|---|
| `users` | User accounts (one per Google account) |
| `integrations` | Encrypted OAuth tokens per platform |
| `messages` | Every received message, deduplicated |
| `triages` | LLM classification result for each message |
| `approvals` | Human-in-the-loop approval queue |
| `memories` | pgvector embeddings for context retrieval |
| `audit_logs` | INSERT-only immutable decision log |

Run migrations:

```bash
npm run db:migrate          # apply pending migrations
npm run db:generate         # regenerate Prisma client after schema changes
```

Explore the database:

```bash
npx prisma studio           # opens a browser UI at localhost:5555
```

---

## How the Triage Pipeline Works

Every incoming message goes through this exact sequence:

```
1. Webhook received
       │
       ▼
2. Message stored to DB (deduplication by platform + externalId)
       │
       ▼
3. Triage job enqueued in BullMQ
       │
       ▼
4. Worker picks up job
       │
       ├── 4a. Embed message text → retrieve similar memories from pgvector
       ├── 4b. Build context-enriched prompt
       ├── 4c. Call Claude Sonnet 4
       ├── 4d. Validate response with Zod (strict schema enforcement)
       └── 4e. Apply guardrails (keyword blocklist, confidence floor)
       │
       ▼
5. Decision matrix maps triage → action
   • auto_handle           → log only, no approval
   • queue_digest          → add to digest, no immediate notification
   • queue_approval        → create Approval record, batch notification
   • interrupt_immediate   → create Approval record, push notification
   • escalate_sensitive    → create Approval record, immediate alert
       │
       ▼
6. Audit log written (INSERT-only, immutable)
```

**Confidence thresholds:**

| Confidence | Action |
|---|---|
| ≥ 0.90 | May auto-handle (if category allows) |
| 0.85 – 0.89 | Queue for approval, batch notification |
| 0.70 – 0.84 | Queue for approval, flag as uncertain |
| < 0.70 | Always escalate, never auto-handle |

---

## Human-in-the-Loop (HITL) Flow

When a message requires human review:

1. An `Approval` record is created with `status: PENDING` and a pre-written draft
2. The user sees it in the **Approvals** tab on the dashboard
3. They can:
   - **Approve** — sends the draft as-is
   - **Edit + Approve** — modifies the draft, then sends
   - **Reject** — discards the draft, message is flagged
4. On approval, a `send-reply` job is enqueued
5. The reply worker sends via the appropriate platform API (Gmail or Google Chat)
6. The approval is marked `SENT`, audit log updated

**What the AI will never send autonomously:**

- Anything involving a dollar amount, invoice, or payment
- Contracts, NDAs, or legal language
- HR decisions (hiring, termination, salary)
- Client commitments or SLAs
- Any message where confidence < 0.70
- Any message from an unknown or first-time sender (configurable)

---

## Safety Guardrails

Multiple independent layers prevent bad outputs:

**Layer 1 — System prompt rules**
Hard rules baked into the triage prompt: explicit instructions on when `requires_human` must be `true` and when `auto_handle` must be `false`.

**Layer 2 — Keyword blocklist (pre-LLM)**
Before calling the LLM, the raw message body is scanned for sensitive patterns (financial terms, legal language, HR keywords). A match forces `requires_human = true` regardless of LLM output.

**Layer 3 — Zod schema validation (post-LLM)**
Every LLM response is parsed through a strict Zod schema. Any malformed, missing, or out-of-range field causes an immediate retry, then failure. No unvalidated data ever reaches the database.

**Layer 4 — Confidence floor (post-validation)**
If confidence < configured threshold (default 0.85), the decision matrix overrides `auto_handle` to `false` and escalates.

**Layer 5 — Decision matrix**
An explicit deterministic function (no LLM involved) maps triage results to actions. Sensitive categories can never be auto-handled by the matrix, regardless of other fields.

**Layer 6 — INSERT-only audit log**
Every decision, at every layer, is written to `audit_logs`. The table should have Postgres row-level security with INSERT-only access for the API role. No decision can be retroactively hidden.

---

## Scaling to Production

The architecture is designed to scale horizontally without major rework.

### Database scaling

- Add **read replicas** for the message feed and audit log queries (high read volume)
- Partition the `messages` and `audit_logs` tables by `created_at` (monthly partitions) once you exceed ~10M rows
- Use **pgBouncer** connection pooling in front of Postgres
- The pgvector index on `memories` uses `ivfflat` — rebuild it with `VACUUM ANALYZE` after large batch inserts

### Queue scaling

- BullMQ workers are stateless — add more worker processes or containers to increase triage throughput
- Separate `triage` and `send-reply` workers to different machine types (triage is CPU/API-bound, send-reply is network-bound)
- Add a `priority` queue for `interrupt_immediate` jobs so critical messages are never delayed by a backlog
- Use **BullMQ Pro** for rate limiting per user (avoids hammering Google APIs)

### API scaling

- The Fastify API is stateless — deploy behind a load balancer with any number of instances
- Session state is stored in the database (not in-memory), so any instance can serve any request

### LLM cost and latency

- Cache triage results for identical message bodies (dedup by content hash before calling LLM) — useful for newsletter unsubscribe storms
- Use **Anthropic's Batch API** for digest-level messages (8-hour turnaround, 50% cheaper) — only use real-time for `interrupt_immediate`
- Add per-user rate limits in Redis to prevent runaway costs

### Multi-tenancy

The schema is already multi-tenant (every table has `userId`). For a SaaS deployment:
- Add a `tenantId` / `organizationId` layer above users for team accounts
- Use Postgres row-level security with `SET app.current_user_id` for true data isolation
- Bill per message processed (stored in `audit_logs`) — easy to aggregate

### Production deployment checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use a managed Postgres (AWS RDS / Supabase / Neon) with pgvector extension enabled
- [ ] Use a managed Redis (Upstash / AWS ElastiCache)
- [ ] Store secrets in AWS Secrets Manager / Vault — not `.env` files
- [ ] Set up Datadog / Grafana for BullMQ queue depth, triage latency, and LLM error rate dashboards
- [ ] Configure Postgres row-level security on `audit_logs` (INSERT-only)
- [ ] Enable Gmail watch renewal cron (every 6 days)
- [ ] Set up a dead-letter queue for failed triage jobs with alerting

---

## Making This Open Source

Here is a practical roadmap for turning Digital Twin into a healthy open-source project.

### Before the first public release

**Code hygiene:**
- Remove all hardcoded references to internal infrastructure, project IDs, and domain names
- Add an `.env.example` with every variable documented (no real values)
- Run `git filter-repo` to purge any secrets from git history before making the repo public
- Add MIT or Apache 2.0 license (see below)

**Documentation:**
- This README covers the basics; also add:
  - `CONTRIBUTING.md` — how to file issues, open PRs, coding style, commit conventions
  - `SECURITY.md` — how to report vulnerabilities (private disclosure, not GitHub issues)
  - `ARCHITECTURE.md` — deeper explanation of each module's design decisions
  - `docs/` folder with guides: self-hosting, adding a new platform adapter, writing prompts

**CI/CD:**
- Add a GitHub Actions workflow that runs on every PR:
  - `npm run typecheck`
  - `npm run lint`
  - Unit tests (Vitest)
  - Integration tests with a local Postgres/Redis via Docker services
- Require all PRs to pass CI before merging

### Repository structure for open source

```
.github/
  ISSUE_TEMPLATE/
    bug_report.md
    feature_request.md
    platform_adapter.md    # template for "please add Outlook support"
  PULL_REQUEST_TEMPLATE.md
  workflows/
    ci.yml
    release.yml            # auto-publish changelog on tag

CONTRIBUTING.md
SECURITY.md
LICENSE
CHANGELOG.md              # keep with "Keep a Changelog" format
```

### License choice

**Recommended: Apache 2.0**
Permissive, allows commercial use, includes a patent grant. Good for attracting enterprise contributors and integrations.

**Alternative: Business Source License (BUSL)**
Open for self-hosting and development, converts to MIT after N years. Used by MariaDB, HashiCorp (pre-fork). Prevents direct commercial SaaS competition while keeping the code open.

**Avoid AGPL** unless you want to force all cloud deployments to open their modifications — it creates friction for enterprise adoption.

### Community infrastructure

- **GitHub Discussions** — Q&A, ideas, show-and-tell (better than Issues for open-ended discussion)
- **Discord server** — real-time help, contributor coordination, `#platform-adapters` channel for people building integrations
- **GitHub Projects board** — public roadmap; tag items `good first issue` and `help wanted` to attract contributors

### What to accept from contributors

High value, low risk:
- Bug fixes with regression tests
- New platform adapters (Outlook, Slack, Teams) — the `PlatformAdapter` interface is already designed for this
- New triage prompt versions (`triage-v2.txt`) with benchmark results
- Translations of the dashboard UI
- Deployment guides (Railway, Fly.io, self-hosted Kubernetes)

Review carefully:
- Changes to the decision matrix or safety guardrails — require maintainer sign-off and a clear reasoning document
- New LLM providers (replacing Claude with another model) — acceptable, but must pass the same safety benchmark suite
- Schema migrations — must be backward-compatible; never drop columns in a migration PR

### Self-hosting vs managed cloud

Consider offering two tiers:
- **Self-hosted (fully open source)** — run on your own infra, bring your own API keys, full control
- **Digital Twin Cloud (hosted)** — managed version with setup wizard, no server required, subscription pricing

The codebase is already structured to support this: all platform-specific logic is in adapters, secrets are env vars, and the database is the only stateful component.

### Versioning and releases

- Use [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`
- Automate releases with `semantic-release` or `release-please`
- Maintain a `CHANGELOG.md` in Keep a Changelog format
- Tag every release in git; publish Docker images to GitHub Container Registry (`ghcr.io`)

```bash
# Example release workflow
git tag v1.2.0
git push origin v1.2.0
# GitHub Actions builds + pushes ghcr.io/your-org/digital-twin:1.2.0
```

---

## Roadmap

### Phase 1 — MVP (current)

- [x] Gmail ingestion via Pub/Sub
- [x] Google Chat ingestion via webhook
- [x] Claude Sonnet 4 triage pipeline
- [x] Zod schema validation + guardrails
- [x] BullMQ triage + reply workers
- [x] Approval queue (HITL)
- [x] pgvector memory layer
- [x] Immutable audit log
- [ ] React dashboard (in progress)
- [ ] Gmail OAuth flow (in progress)
- [ ] Daily digest emails

### Phase 2 — Context awareness

- [ ] Google Calendar integration (schedule awareness in triage)
- [ ] Meeting summarisation (auto-summary for Google Meet via transcripts)
- [ ] Task extraction and tracking (sync to Google Tasks)
- [ ] Smart digest with priority ranking
- [ ] Writing style learning (adapt drafts to match your voice over time)

### Phase 3 — Multi-platform

- [ ] Slack integration
- [ ] Microsoft Outlook + Teams
- [ ] Linear / GitHub Issues (engineering workflow)
- [ ] Voice interface (spoken briefings, voice approvals)

### Phase 4 — Intelligence

- [ ] Relationship intelligence (track communication patterns per contact)
- [ ] Burnout detection (flag overload patterns, suggest delegation)
- [ ] Predictive scheduling (suggest best times to respond)
- [ ] Multi-agent delegation (route messages to the right team member)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full details.

Quick start for contributors:

```bash
# Fork and clone
git clone https://github.com/your-username/digital-twin.git
cd digital-twin

# Create a branch
git checkout -b feat/my-feature

# Make changes, add tests, commit
npm run typecheck
npm test

# Open a PR against main
```

We use [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add Outlook platform adapter
fix: ensure triage worker retries on 529 rate limit
docs: add self-hosting guide for Railway
chore: update Anthropic SDK to 0.40.0
```

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for full text.

Copyright 2026 Digital Twin Contributors.

---

*Built with [Claude](https://claude.ai) · Powered by [Anthropic](https://anthropic.com)*
