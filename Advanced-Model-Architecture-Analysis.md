# Advanced Model — Complete Architecture & Analysis
**Project working name:** Central Post Hub / MultiPost Hub (naam final nahi hai, branding baad mein decide hoga)

**Is document ka purpose:** Jab Basic (MVP) workflow complete ho jaye, tab isी document ko reference banakar Advanced Model par kaam shuru karna hai. Ye poori discussion ka consolidated nichod hai — zero se lekar full production-ready platform tak.

---

## 0. Basic vs Advanced — pehle ye samjho

| | Basic (abhi ban raha hai) | Advanced (ye document) |
|---|---|---|
| Clients | Single client assume | Multiple clients, isolated data |
| Posts | Single post, ek baar mein | Multi-post, scale-ready |
| Media | Sirf image | Image + Video (bade files, alag app) |
| Platform select | SMO manually ek platform choose karta hai | Multi-destination, platform-specific rules |
| Workflow | Ek hi seedha path | Do modes: Recommendation aur Full Automation |
| AI check | Spelling + OCR (single engine) | Dual-engine fallback (primary+backup) dono jagah |
| Approval | SMO → Admin | Central TL/Manager → Common Final Reviewer login |
| Publishing | Direct publish/manual | Queue-based, per-destination jobs, retry, reconciliation |
| Hosting concern | Abhi nazarandaz | A2 shared hosting limits explicitly design mein shamil |

Basic complete hone ke baad, is document ke har section ko "upgrade task" ki tarah treat karna hai.

---

## 1. Vision

Ek **agency-grade Social Media Post Approval & Publishing Platform** jo:
- Multiple clients ko ek hi platform se, isolated tarike se manage kare
- Har post ko AI-assisted quality check se guzare (spelling, grammar, image text, brand consistency)
- Multi-level human approval enforce kare bina kisi shortcut ke
- Instagram, Facebook, YouTube par publish kare — auto ya manual, dono tarike se
- A2 shared hosting ke andar hi reliably chale, bina VPS move kiye
- Audit-proof ho — har action, har revision, har approval history mein safe rahe

---

## 2. Multi-Client Architecture

- Agency ke andar N clients ho sakte hain (jaise ABC Hospital, XYZ Real Estate)
- Har client ka: naam, brand guidelines (tone, restricted words, mandatory rules), connected social accounts (Instagram/Facebook/YouTube), apna poora post/approval history
- **Data isolation backend-level par enforce hoga** — sirf frontend filtering se nahi. Har API request par `client_id` ownership check middleware mein hoga
- Client create karte hi uske social accounts connect kiye jate hain (admin action)
- Brand guidelines versioned rahenge — kis version se post check hua, wo save hoga audit ke liye

---

## 3. Roles aur Access

| Role | Kaam | Access pattern |
|---|---|---|
| Admin | Users/roles manage, clients/accounts connect, poora system monitor | Full access, saare clients |
| Creator / SMO | Post banata hai, AI suggestions handle karta hai | Authorized clients ke liye post create |
| Central Creative TL / Manager | Pehla approval — sabhi clients ke posts ek hi dashboard mein | Client-wise alag assignment nahi, central hi hai |
| Final Reviewer | Aakhri approval, **common login account** (`finalreview@yourcompany.com`) | Koi dedicated employee assign nahi, jo authorized ho wahi login kare |
| Live Verification | Published post ko verify karta hai | Separate ya Final Reviewer ke saath combine ho sakta hai |

AI Monitoring Dashboard **sabhi roles ko dikhega**, lekin data visibility role-based filter hogi (Admin: sab clients; Creator: apne posts; TL: sabhi relevant; Final Reviewer: approval-stage posts).

---

## 4. Do Workflow Modes

### Mode A — Recommendation Mode (manual-heavy)
```
Client select → Creative upload → Caption/tagline/hashtags
→ AI Check (suggestions) → Creator review/accept/edit (recheck loop, capped)
→ Submit → Central TL/Manager approval → Final Reviewer (common login) approval
→ Platform select (SMO manual, approval ke baad) → Publish Now / Schedule / Manual
→ Live Verification
```

### Mode B — Full Automation Mode
```
Client + Platform(s) + Publish method — sab shuru mein hi select
→ Upload + content → AI Check (mandatory, fail-closed)
→ Pass → seedha publish/schedule (manual approval chain skip)
→ Fail → block, reason clearly dikhana, manual review required
```

**Important:** Dono modes shared services use karenge (AI service, revision engine, publishing engine) — sirf control-flow alag hoga. Code duplication se bachna hai.

---

## 5. AI Content Checking — Dual Engine Design

| Check | Primary | Fallback | Trigger for fallback |
|---|---|---|---|
| Spelling/Grammar | LanguageTool API | nspell (local) | API timeout/down/quota khatam |
| Image text (OCR) | Google Vision API | Tesseract.js (local) | API timeout/down/quota khatam |

- Report mein hamesha **engine tag** dikhana hai: "Google Vision" ya "Tesseract (fallback used)"
- Banned/restricted words: simple DB table match, koi external API nahi
- **AI recheck loop cap:** Max 3-4 recheck cycles per revision; usके baad "manual review required" force ho jaye (cost aur rate-limit control ke liye)
- Repeated fallback-trigger (matlab primary API baar-baar down) ho toh Admin ko ek **separate alert** jaye — "OCR/Spelling primary service down check karein"

---

## 6. Content & Revisions

- Har post ka revision number hota hai; content edit hone par **naya revision** bante hai
- Revisions **immutable** hain (update nahi, sirf naya insert) — audit integrity ke liye
- Approval hamesha **exact revision** par apply hota hai — purani approval naye revision ke liye invalid
- Platform-specific caption/title override — agar platform selection content-creation se pehle nahi hui hai (Recommendation Mode), toh ye overrides ek **separate step** honge platform-select ke baad, content-creation step mein nahi

---

## 7. Approval Chain — Detail

1. Central Creative TL/Manager — sabhi clients ki submitted posts ek hi dashboard mein aati hain, client-wise alag assignment ki zaroorat nahi
2. Common Final Reviewer login — koi dedicated employee nahi, authorized person jo bhi login kare
3. Creator apna khud ka post approve nahi kar sakta
4. Final approval ke bina platform-selection aur publishing unlock nahi hoga

---

## 8. Platform Integration

| Platform | Mechanism | Important constraint |
|---|---|---|
| Instagram | Meta Graph API — `video_url`/`image_url` based, Meta khud fetch karta hai | Professional account zaroori, app review chahiye |
| Facebook | Meta Graph API, Page-based | Personal profile publish nahi hota |
| YouTube | YouTube Data API v3, OAuth | **URL-fetch support nahi** — bytes directly chahiye; bade video (800MB-1GB) ke liye abhi **Manual Publish hi best** |

Har platform ka apna adapter/service — ek platform ki failure doosre ko affect nahi karegi.

**Meta/YouTube app review process parallel mein jaldi shuru karna hai** — dev timeline se independent hai, weeks lag sakte hain.

---

## 9. Publishing Engine

- Har **destination** (platform+account) ke liye **separate job** — 1 post, 3 platforms = 3 independent jobs
- Statuses: Pending, Scheduled, Processing, Published, Failed, Retry Pending, Manual Action Required, Verification Pending, Verified
- **Retry sirf failed destination ka** — successful pe dobara nahi
- **Reconcile-before-retry rule:** Agar result uncertain hai (timeout), retry se pehle actual platform state check karo — duplicate publish se bachne ke liye
- Worker: node-cron based, har minute chalta hai, lightweight rakhna hai (minimal dependencies, poora framework load mat karo)

---

## 10. Media Handling

### Image (simple)
- Max size ~10MB, type validation (jpg/png)
- Normal single-request upload, concurrency control ki zaroorat nahi — halka operation hai
- Main App ke andar hi handle hota hai

### Video (800MB-1GB — alag architecture)
**Do separate Node.js apps (same A2 hosting account, cPanel "Setup Node.js App" se):**

- **App 1 (Main App):** Login, images, approvals, dashboards, cron worker, publishing logic
- **App 2 (Video Upload App):** Sirf bade video intake — upload accept karta hai, disk pe save karta hai, DB mein status likhta hai

**Connection mechanism:** Dono apps seedha ek-dusre ko call nahi karte — **shared MySQL database + shared disk** ke through indirectly connect hote hain:
```
Browser → Video Upload App → Shared Disk (file save) + Shared DB (status row)
Main App cron worker → Shared DB polls → Meta API ko video_url bhejta hai
Meta → Shared Disk se file fetch karta hai (Apache serve karta hai, Node nahi)
Publish confirm → Main App file delete karta hai + DB update
```

**Kyun alag app:** Agar video-upload wahi Main App mein hota, toh A2 ke limited Passenger processes video-upload mein busy ho jate aur baaki saara app (login, images, approvals) slow/stuck ho jata. Alag app = alag process pool = isolation.

**Video file serving:** Static folder (`public_html/temp-videos/`) se Apache serve karega, Node app se nahi — warna Node process lambe download ke dauraan busy rehta.

**Concurrency control for uploads:** Global upload-slot limit (jaise max 2 ek saath) — DB-based queue table (`upload_sessions`), baaki automatically line mein lagenge, "queue position" frontend ko dikhao.

**Safety cleanup:** Daily cron job jo X ghante se purani orphan temp files delete kare, chahe unka status kuch bhi ho.

**Worker Threads:** Sirf tab use karna jab koi genuinely CPU-heavy local operation ho (jaise file hash/checksum calculate karna) — simple save/upload ke liye zaroorat nahi, Node already async handle karta hai. Worker Thread NPROC nahi badhata (same process ke andar), isliye A2 ke liye safe hai jahan zaroorat ho.

---

## 11. Hosting & Infrastructure Constraints (A2 Shared Hosting)

**Firm decision: Kabhi VPS pe move nahi karna hai — hamesha A2 shared hosting hi, optimized tarike se use karna hai.**

Isका matlab: jab bhi limits hit hon, solution hamesha **"kaam ko specialized/external jagah offload karo"** hoga, "bada server lao" nahi.

| Risk | Mitigation |
|---|---|
| NPROC/EP caps (limited Passenger processes) | Video upload ko alag app mein isolate karna, static files Apache se serve karna |
| Cron cold-start overhead | Worker ko lightweight rakhna — minimal dependencies, direct DB client, poora framework load mat karo |
| Disk/bandwidth | Confirmed unlimited is plan mein (screenshot se verify) — tension nahi, par **inode limit (file count)** dhyan rakhna, temp files cleanup zaroori |
| Secret/token management | Env file approach — cPanel pe proper KMS/Vault nahi hota, file permissions extra dhyan se set karna |
| Bade video uploads | Separate Node app + Apache static serving + upload concurrency limit |

**Sabse pehla implementation step (before heavy feature work):** Ek chhota **hosting stress test** — dummy cron worker + concurrent connections simulate karke dekho A2 kitna handle kar sakta hai, taaki architecture decisions ispar based ho, assumption par nahi.

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
- Client-level access check **har relevant API request** par — non-negotiable, security ka foundation
- OAuth tokens encrypted, kabhi frontend ko expose nahi
- Creator apna post approve nahi kar sakta
- Sirf exact approved revision publish ho sakta hai
- Rate limiting, input validation, file type/size checks
- Secrets env/config mein, code mein kabhi nahi

---

## 14. Notifications

Submit, approve/reject, changes requested, scheduled-due, publish success/failure, token expired, verification mismatch, **AI/OCR provider repeatedly failing** (important, aksar miss hota hai) — in sab par alert. Channel: Email/WhatsApp, admin-configurable (abhi exact channel decide nahi hua).

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

Jab Basic complete ho jaye, ye list point-by-point dekhni hai:

- [ ] Single-client assumption hatao → multi-client tables + access-check middleware add karo
- [ ] Single AI engine → dual-engine fallback (dono: spelling, OCR) add karo
- [ ] SMO manual platform-select ko client ke "connected accounts list" se replace karo
- [ ] Simple approval (SMO→Admin) ko Central TL + Common Final Reviewer login mein restructure karo
- [ ] Direct publish ko destination-level job queue mein convert karo (retry/reconciliation ke saath)
- [ ] Image-only upload mein Video Upload App (alag Node instance) add karo
- [ ] AI recheck loop cap, fallback-alert, revision-immutability enforce karo
- [ ] Hosting stress test karo isse pehle ki video/multi-client load aaye
- [ ] Notifications aur activity-log system build karo
- [ ] Reports/analytics (sabse last mein, Phase 5+ equivalent)

---

## 17. Open Decisions — Advanced build se pehle confirm karna

1. Notification channel final (Email/WhatsApp/dono)?
2. Ek Manager/Reviewer multiple clients handle karega ya sirf central hi rahega hamesha?
3. YouTube ke liye future mein browser-direct resumable upload karna hai ya Manual Publish hamesha hi rahega?
4. Scheduled time change hone par re-approval chahiye ya nahi?
5. Upload-slot safe limit kya hoga — hosting stress test ke baad hi pata chalega

---

## 18. Naming Note

Working names discuss hue: "MultiPost Hub", "Central Post Hub" — final branding baad mein decide karni hai, architecture ispar depend nahi karta.
