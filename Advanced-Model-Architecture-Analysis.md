# Advanced Model — Complete Architecture & Analysis
**Project working name:** Central Post Hub / MultiPost Hub (the name is not final; branding will be decided later)

**Document purpose:** Once the Basic (MVP) workflow is complete, use this document as the reference for beginning work on the Advanced Model. It consolidates the discussion, from initial planning through a production-ready platform.

---

## 0. Basic vs Advanced

| | Basic (currently in development) | Advanced (this document) |
|---|---|---|
| Clients | Assumes one client | Multiple clients with isolated data |
| Posts | One post at a time | Multiple posts, ready to scale |
| Media | Images only | Images and video (large files handled by a separate app) |
| Platform selection | SMO manually selects one platform | Multiple destinations with platform-specific rules |
| Workflow | One linear path | Two modes: Recommendation and Full Automation |
| AI check | Spelling and OCR (single engine) | Dual-engine fallback for spelling and OCR |
| Approval | SMO → Admin | Central TL/Manager → Common Final Reviewer login |
| Publishing | Direct publishing/manual | Queue-based, per-destination jobs, retries, and reconciliation |
| Hosting concern | Not yet considered | A2 shared-hosting limits explicitly included in the design |

After the Basic workflow is complete, treat each section of this document as an upgrade task.

---

## 1. Vision

An **agency-grade Social Media Post Approval & Publishing Platform** that:
- Manages multiple clients on one platform while keeping their data isolated
- Runs AI-assisted quality checks on every post (spelling, grammar, image text, and brand consistency)
- Enforces multi-level human approval without shortcuts
- Publishes to Instagram, Facebook, and YouTube, either automatically or manually
- Runs reliably on A2 shared hosting without moving to a VPS
- Maintains an audit trail of every action, revision, and approval

---

## 2. Multi-Client Architecture

- An agency may have N clients (for example, ABC Hospital and XYZ Real Estate).
- Each client has a name, brand guidelines (tone, restricted words, and required rules), connected social accounts (Instagram/Facebook/YouTube), and a complete post and approval history.
- **Enforce data isolation at the backend level**, not only through frontend filtering. Middleware must check `client_id` ownership on every API request.
- Connect a client's social accounts when the client is created (Admin action).
- Version brand guidelines and save the version used to check each post for auditing.

---

## 3. Roles and Access

| Role | Responsibility | Access pattern |
|---|---|---|
| Admin | Manages users and roles, connects clients and accounts, monitors the system | Full access to all clients |
| Creator / SMO | Creates posts and handles AI suggestions | Creates posts for authorized clients |
| Central Creative TL / Manager | First approval — posts for all clients appear in one dashboard | Centralized, with no separate client assignments |
| Final Reviewer | Final approval through a **shared login account** (`finalreview@yourcompany.com`) | No dedicated employee; any authorized person can sign in |
| Live Verification | Verifies published posts | May be separate or combined with the Final Reviewer role |

The AI Monitoring Dashboard is visible to **all roles**, with data filtered by role (Admin: all clients; Creator: own posts; TL: all relevant posts; Final Reviewer: posts awaiting approval).

---

## 4. Two Workflow Modes

### Mode A — Recommendation Mode (manual workflow)
```
Select client → Upload creative → Add caption/tagline/hashtags
→ AI check (suggestions) → Creator reviews/accepts/edits (limited recheck loop)
→ Submit → Central TL/Manager approval → Final Reviewer approval (shared login)
→ SMO selects platform after approval → Publish Now / Schedule / Manual
→ Live Verification
```

### Mode B — Full Automation Mode
```
Select client, platforms, and publishing method at the start
→ Upload media and content → Mandatory AI check (fail-closed)
→ Pass → Publish or schedule directly (skip the manual approval chain)
→ Fail → Block, clearly show the reason, and require manual review
```

**Important:** Both modes use shared services (AI service, revision engine, and publishing engine); only the control flow differs. Avoid code duplication.

---

## 5. AI Content Checking — Dual Engine Design

| Check | Primary | Fallback | Fallback trigger |
|---|---|---|---|
| Spelling/Grammar | LanguageTool API | nspell (local) | API timeout, outage, or quota exhaustion |
| Image text (OCR) | Google Vision API | Tesseract.js (local) | API timeout, outage, or quota exhaustion |

- Always show an **engine tag** in the report: "Google Vision" or "Tesseract (fallback used)".
- Banned/restricted words: simple database table matching; no external API.
- **AI recheck loop cap:** Limit each revision to 3–4 recheck cycles, then require manual review to control cost and rate limits.
- Repeated fallback triggers (the primary API repeatedly becomes unavailable) must send the Admin a **separate alert** to check the OCR/spelling service.

---

## 6. Content & Revisions

- Each post has a revision number; editing content creates a **new revision**.
- Revisions are **immutable** (insert new revisions; do not update existing ones) to preserve audit integrity.
- Approval always applies to an **exact revision**; approval of an older revision is invalid for a newer one.
- Platform-specific caption/title overrides: if the platform was not selected before content creation (Recommendation Mode), add overrides in a **separate step** after platform selection, not during content creation.

---

## 7. Approval Chain — Detail

1. Central Creative TL/Manager — submitted posts for all clients appear in one dashboard; separate client assignments are unnecessary.
2. Common Final Reviewer login — no dedicated employee; any authorized person can sign in.
3. Creators cannot approve their own posts.
4. Platform selection and publishing remain locked until final approval.

---

## 8. Platform Integration

| Platform | Mechanism | Important constraint |
|---|---|---|
| Instagram | Meta Graph API — based on `video_url`/`image_url`; Meta fetches the media | Professional account required; app review required |
| Facebook | Meta Graph API, Page-based | Personal profiles cannot be used for publishing |
| YouTube | YouTube Data API v3, OAuth | **URL fetching is not supported** — media bytes are required; **Manual Publish is currently best** for large videos (800 MB–1 GB) |

Each platform has its own adapter/service, so a failure on one platform does not affect the others.

**Start the Meta/YouTube app review process early and in parallel** — it is independent of the development timeline and may take weeks.

---

## 9. Publishing Engine

- Create a **separate job** for each **destination** (platform + account): one post on three platforms creates three independent jobs.
- Statuses: Pending, Scheduled, Processing, Published, Failed, Retry Pending, Manual Action Required, Verification Pending, Verified
- **Retry only failed destinations**; do not retry successful ones.
- **Reconcile-before-retry rule:** If the result is uncertain (for example, a timeout), check the actual platform state before retrying to avoid duplicate publishing.
- Worker: node-cron-based, runs every minute, and stays lightweight (minimal dependencies; do not load the entire framework).

---

## 10. Media Handling

### Image (simple)
- Maximum size ~10 MB; validate file type (JPG/PNG).
- Use a normal single-request upload; concurrency control is unnecessary for this lightweight operation.
- Handle image uploads in the Main App.

### Video (800 MB–1 GB — separate architecture)
**Use two separate Node.js apps (same A2 hosting account, configured through cPanel's "Setup Node.js App"):**

- **App 1 (Main App):** Login, images, approvals, dashboards, cron worker, and publishing logic.
- **App 2 (Video Upload App):** Accepts large video uploads, saves them to disk, and records their status in the database.

**Connection mechanism:** The apps do not call each other directly; they communicate indirectly through a **shared MySQL database and shared disk**:
```
Browser → Video Upload App → Shared Disk (file save) + Shared DB (status row)
Main App cron worker → Polls the shared database → Sends video_url to the Meta API
Meta → Fetches the file from the shared disk (served by Apache, not Node)
Publish confirmed → Main App deletes the file and updates the database
```

**Why a separate app:** If video uploads were handled by the Main App, A2's limited Passenger processes could be occupied by uploads, slowing or blocking login, image handling, and approvals. A separate app provides a separate process pool and isolation.

**Video file serving:** Apache serves files from the static folder (`public_html/temp-videos/`), not the Node app, so the Node process is not occupied during long downloads.

**Concurrency control for uploads:** Set a global upload-slot limit (for example, two simultaneous uploads) using a database-backed queue table (`upload_sessions`). Queue other uploads automatically and show their queue position in the frontend.

**Safety cleanup:** Run a daily cron job to delete orphaned temporary files older than X hours, regardless of their status.

**Worker Threads:** Use only for genuinely CPU-heavy local operations (such as calculating a file hash/checksum). They are unnecessary for simple save/upload operations, which Node already handles asynchronously. A Worker Thread does not increase NPROC because it runs within the same process, so it is safe for A2 when needed.

---

## 11. Hosting & Infrastructure Constraints (A2 Shared Hosting)

**Firm decision: Do not move to a VPS. Continue using A2 shared hosting, optimized for this workload.**

This means that when limits are reached, the solution is to **offload work to a specialized or external service**, not to use a larger server.

| Risk | Mitigation |
|---|---|
| NPROC/EP caps (limited Passenger processes) | Isolate video uploads in a separate app and serve static files through Apache |
| Cron cold-start overhead | Keep the worker lightweight: minimal dependencies, direct DB client, and no full-framework loading |
| Disk/bandwidth | The plan is confirmed unlimited (verified by screenshot), but monitor the **inode limit (file count)** and clean up temporary files |
| Secret/token management | Use environment files; cPanel does not provide a proper KMS/Vault, so set file permissions carefully |
| Large video uploads | Separate Node app, Apache static serving, and an upload concurrency limit |

**First implementation step (before major feature work):** Run a small **hosting stress test** by simulating a dummy cron worker and concurrent connections. Measure A2's capacity so architecture decisions are based on evidence, not assumptions.

---

## 12. Database — Core Tables (Advanced)

- **Access:** users, roles, permissions, client_users (composite unique index: user_id+client_id)
- **Clients:** clients, client_brand_guidelines, client_brand_guideline_versions
- **Accounts:** social_accounts, social_account_tokens (encrypted)
- **Posts:** social_posts, post_revisions (immutable), post_media
- **AI:** ai_check_results, ai_check_issues (engine-tagged)
- **Approval:** post_approvals, approval_comments, approval_workflow_instances
- **Publishing:** post_platform_targets, publishing_jobs, publishing_logs, scheduled_posts
- **Video pipeline:** upload_sessions (status tracking for video app)
- **Audit:** live_verifications, notifications, activity_logs

---

## 13. Security

- JWT auth + bcrypt passwords
- Check client-level access on **every relevant API request**; this is non-negotiable and foundational to security.
- Encrypt OAuth tokens; never expose them to the frontend.
- Creators cannot approve their own posts.
- Only the exact approved revision can be published.
- Apply rate limiting, input validation, and file type/size checks.
- Keep secrets in environment/configuration files, never in code.

---

## 14. Notifications

Send alerts for submissions, approvals/rejections, requested changes, scheduled posts due, publishing success/failure, expired tokens, verification mismatches, and **repeated AI/OCR provider failures**. Channels: Email/WhatsApp, configurable by Admin (the exact channel has not yet been decided).

---

## 15. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React.js |
| Backend | Node.js + Express.js (2 separate app instances — Main + Video) |
| Database | MySQL (shared between both apps) |
| Auth | JWT + bcrypt |
| Spelling | LanguageTool (primary) + nspell (fallback) |
| OCR | Google Vision (primary) + Tesseract.js (fallback) |
| Scheduling | node-cron |
| Platforms | Meta Graph API (Instagram/Facebook), YouTube Data API v3 |
| Hosting | A2 shared hosting (cPanel), 2 Node.js app instances |
| File serving | Apache/LiteSpeed (static, not through Node) |

---

## 16. Basic → Advanced: Upgrade Checklist

After the Basic workflow is complete, review this list point by point:

- [ ] Replace the single-client assumption with multi-client tables and access-check middleware
- [ ] Add dual-engine fallback for spelling and OCR
- [ ] Replace manual platform selection by the SMO with the client's connected accounts list
- [ ] Restructure simple approval (SMO→Admin) into Central TL + Common Final Reviewer login
- [ ] Convert direct publishing into a destination-level job queue with retries and reconciliation
- [ ] Add a Video Upload App (separate Node instance) to image-only uploads
- [ ] Enforce the AI recheck limit, fallback alerts, and revision immutability
- [ ] Run a hosting stress test before adding video or multi-client load
- [ ] Build the notifications and activity-log system
- [ ] Add reports/analytics (last, equivalent to Phase 5+)

---

## 17. Open Decisions — Confirm Before the Advanced Build

1. What is the final notification channel: Email, WhatsApp, or both?
2. Will one Manager/Reviewer handle multiple clients, or will the role always remain centralized?
3. Should YouTube support browser-direct resumable uploads in the future, or should publishing remain manual?
4. Is re-approval required when a scheduled time changes?
5. What is the safe upload-slot limit? Determine it after the hosting stress test.

---

## 18. Naming Note

Working names discussed: "MultiPost Hub" and "Central Post Hub". Final branding will be decided later and does not affect the architecture.
