# Legal & Data Protection Remediation Backlog

**Status:** P0 closed (1 October 2026). P1 and P2 open.
**Raised:** 1 October 2026
**P0 closed:** 1 October 2026
**Owner:** engineering
**Context:** discovered while drafting `/privacy`, `/terms` and `/refund-policy`.

The legal pages shipped in a deliberately clean form: they describe what the
platform does, and they are worded the way a production policy is worded. That
choice is only safe while the P0 items below are closed. They now are, and each
entry records what actually changed — including two places where the original
write-up about the code was wrong.

The NDPA 2023 / NDPR 2023 exposure is real: the Nigeria Data Protection
Commission can levy penalties up to **₦10,000,000 or 2% of annual turnover**
for serious breaches, and up to ₦10,000,000 for a data breach that is not
notified. The Terms of Service carve the school out for its own unlawful
processing (ToS §12.2), but nothing can carve us out for ours.

### Outstanding before the policy is fully accurate

- **P0-0 is closed.** Session cookies are HMAC-signed and verified on every
  request, with server-enforced expiry. One residual is accepted and documented
  rather than hidden: sessions are stateless, so a copied session stays valid
  until its 12-hour expiry. ToS §5.5 was amended to state this plainly.
- **P1 remains open.** Privacy Policy §9 and §10 were corrected on
  1 October 2026 (v1.1) so the published text now matches the code — the policy
  no longer overstates encryption-at-rest or claims unenforced retention
  periods. **Items 5 and 9 stay on the roadmap as engineering work:**
  amending the policy limits misstatement risk, not the underlying risk, and
  NDPR s.44 applies regardless of what the policy says. New P1 items 18–22
  track the follow-ups that surfaced, including the missing automated backup
  schedule and the fact that our data residency and transfer mechanism are
  outside Nigeria.
- **`purge_orphan_students.py` ran clean — there is nothing to purge.** See
  item 2; verified against production on 1 October 2026 with a positive
  control. No snapshot or export was needed.
- **Deploying the session signing logs out everyone.** Unsigned cookies carry
  no `v1.` prefix, so every existing session fails verification and is cleared.
  That is the intended fail-closed migration. Rotating `SESSION_SECRET` has the
  same effect and is the emergency kill switch.

---

## P0 — CLOSED 1 October 2026

All four P0 items were remediated in a single pass. Each is marked below with
what actually changed, because two of the original write-ups were wrong about
the code and the correction matters if anyone re-investigates.

### 0. Session cookies were unsigned — anyone could forge superadmin — **CLOSED 1 October 2026**

**Found while verifying the P0-1 fix. It outranked everything else here.**

All three session cookies were **raw JSON with no signature and no server-side
validation**:

| Cookie | Written at | Validated at | Mechanism |
|---|---|---|---|
| `admin_session` | `app/api/admin/login/route.ts` | `lib/adminAuth.ts` | `JSON.parse` + field compare |
| `staff_session` | `app/api/staff/login/route.ts` | *7 inline copies* | `JSON.parse` + field compare |
| `superadmin_session` | `app/api/superadmin/login/route.ts` | `lib/superadminAuth.ts` | `JSON.parse(raw).superadmin === true` |

The old `lib/superadminAuth.ts` docstring stated the design outright: *"Value is
an opaque JSON blob; validity = presence + well-formed + not expired (maxAge
enforced by cookie)."* There was no `createHmac`, no JWT, and no session table
anywhere. **Setting a cookie value was sufficient to authenticate.**

```bash
# Platform superadmin, no credentials.
curl -H 'Cookie: superadmin_session={"superadmin":true,"admin_id":"x","email":"a@b.c","role":"owner"}' \
     'https://resultapp.org/api/superadmin/tenants'
```

The 12-hour `maxAge` was enforced by the **browser**, so a forged cookie never
expired. Verified bypasses before the fix: `superadmin/tenants`,
`superadmin/stats`, `superadmin/audit-logs`, `admin/allocations` DELETE,
`billing/ledger`, `staff/grading` POST — all 401 without a cookie and accepted
with a forged one.

**Structural problem found while fixing it.** There were **17 physical read
sites and only 3 used a shared helper.** Staff session parsing was
reimplemented inline in **seven** independent places, and `lib/staffAuth.ts`
— cited in the original version of this document — **did not exist**. Two of
the staff dashboard guards never checked `tenant_id` at all, so a valid session
for one school would have rendered another school's dashboard. Patching only
the shared helpers would have left seven forgeable paths.

#### What was done

- **`lib/sessionCrypto.ts`** (new) — pure HMAC-SHA-256 sign/verify, no
  `next/headers`, so the crypto is testable in plain Node. Wire format
  `v1.<base64url(payload)>.<base64url(mac)>`, MAC over `v1.<payload>`. Adds
  `iat`/`exp` **inside the signed material**, so expiry is now enforced
  server-side rather than by the browser. Verification is fail-closed and
  returns `null` for every failure mode; there is no code path returning claims
  without passing a `timingSafeEqual` comparison.
- **`lib/session.ts`** (new) — the single cookie chokepoint:
  `setSessionCookie` / `readSessionCookie` / `clearSessionCookie`. All 17 read
  sites now route through it.
- **`lib/staffAuth.ts`** (new) — staff guard, with **mandatory** tenant
  binding. Carries both `staff_id` and the row UUID so the profile route's
  self-edit rule keeps working.
- **`SESSION_SECRET`** — dedicated, ≥32 random bytes, **Next.js only**. The
  backend never reads a cookie, so it never receives the key. `BACKEND_API_SECRET`
  was deliberately not reused: it is already attached to every `X-API-SECRET-KEY`
  request and sits outside the Next.js trust boundary. Fatal in production if
  missing or short; ephemeral per-process in dev with an error log.
- **All 17 read sites refactored.** 4 layouts/pages and 3 staff API routes that
  duplicated parsing inline now call the shared guards. `adminAuth`,
  `superadminAuth`, `supportAuth` and `notifications/_lib` were rewritten
  against the chokepoint.
- **Rejection clears the cookie** and returns 401 in every route handler.
  Server Components cannot mutate cookies, so the layouts redirect to login
  instead and the login page overwrites the stale value.
- **Adjacent defects fixed in the same pass:** added the missing
  `app/api/staff/logout/route.ts` (staff had no sign-out path at all, so Privacy
  Policy §5's "deleted on sign-out" was false for them); all three logout routes
  now pass an explicit `path` and report failure instead of returning
  `{success:true}` while leaving a live credential in the browser; the two staff
  dashboard guards now enforce `tenant_id`, and the dashboard page no longer
  falls back to the URL subdomain when the session has none.
- **Signature never reaches client JS.** `admin/login` and `staff/login` sign a
  copy of the upstream payload and return the original, so the `{success:true,
  ...data}` spread cannot leak a valid session token past `httpOnly`.
- **`scripts/verify-session-signing.mjs`** (new) — 25 assertions, all
  negative-path. Rejects legacy unsigned JSON, flipped payload bytes, zeroed and
  truncated MACs, a transplanted MAC, a MAC from a different key, an unknown
  format version, non-base64url junk, array payloads, missing/non-numeric `exp`,
  and validly-signed-but-expired tokens. Never throws on degenerate input.
  Run with `node scripts/verify-session-signing.mjs`.
- **End-to-end verified** against a live server: 12 forged-cookie attempts
  across all three cookie types, each returning 401 with a deleting
  `Set-Cookie`, including a cross-tenant replay and a payload with no tenant.

**Residual, accepted:** sessions are stateless, so a session copied by someone
else stays valid until its 12-hour expiry — there is no per-session off-switch.
ToS §5.5 was **amended** to say exactly this rather than promise an intervention
capability we do not have, and now places the burden of sign-out on the School.
A `sid` denylist or a server-side session store would close that gap; neither
was in scope for the patch.

**Policy corrections in the same pass:** Privacy Policy §5.1 now describes the
signed tokens and the server-enforced expiry (and adds it to the summary);
ToS §5.5 no longer claims 12 hours "of inactivity" (it is 12 hours from
creation) and no longer implies we can revoke a session.

**This document previously listed `lib/staffAuth.ts` as an existing validation
site. It did not exist and never had. Corrected.**

---

### 1. `/api/report` had no publication gate — CLOSED

**Original claim (wrong in its fix):** add `requireAdminSession` to
`app/api/report/route.ts`.

**Why that was wrong:** `/api/report` is not an admin route. Its only caller is
`components/report-card/StudentReportCard.tsx:184`, which renders the *public*
result checker. Adding an auth wall would have broken a marketed feature
rather than secured it. The real defect was different in kind: the publication
gate existed only as a React prop computed in a server component
(`app/[subdomain]/report/[...studentId]/page.tsx`), while the data arrived
independently from an unguarded route. The client-side `blur-[3px]` overlay was
cosmetic — the bytes were already in React state and in devtools.

**What was done:**

- **Backend enforcement** (`backend/routers/report.py`) — the bundle may only
  be released when a `result_publications` row exists for
  `(tenant, student_id, term, academic_session)`. Added an `include_draft`
  query parameter, defaulting to `false`, set only by the trusted proxy when
  the caller holds an `admin_session` for that tenant. Deleted the
  session-agnostic `published_at` fallback that returned a timestamp for a
  publication made in a *different* academic session, which defeated the gate.
  Added an explicit `is_published` field so consumers stop inferring status.
- **Scope split in the proxy** (`app/api/report/route.ts`) — uses
  `hasAdminSession` (boolean) rather than `requireAdminSession` (error
  response), so an anonymous caller is *degraded* to public scope rather than
  rejected. The flag is derived from the httpOnly cookie, never from a query
  parameter.
- **Enumeration oracle closed.** "Unpublished" and "unknown student" return
  the **same** 404 with a byte-identical body
  (`{success:false, error:"Report not found", raw:{detail:"Report not found"}}`),
  via a single `notFound()` helper used by all three paths — unknown student,
  unpublished, and malformed admission number. The report page's amber "Draft
  preview" pill is now gated on `isAdminPreview` as well, because for the
  public it would otherwise sit above a "Student Not Found" card.
- **Session drift fixed.** The gate uses `schools.current_session` first, then
  the derived session, matching the report page. Previously the page used the
  tenant's configured session while the backend used a private naive-local-time
  `_academic_session()`, so the two could disagree near the September rollover.
  The duplicated inline cookie parsing was replaced with `hasAdminSession`.
- **Throttle.** Sliding-window rate limit, 30 requests per 60s per
  (client IP, tenant), applied to both scopes. Generous enough that a family
  checking several children is never throttled, far too low to walk a roster.
- **Dead routes deleted.** `app/api/records/route.ts` and
  `app/api/records/academic/route.ts` had zero callers. The second was worse
  than a read leak: it forwarded an arbitrary attacker-supplied JSON body to
  `create_academic_record`, an **unauthenticated score-write primitive**.

### 2. Deleting a student orphaned their grades and remarks — CLOSED

`backend/routers/allocations.py` `delete_roster_record` now cascades, in the
same transaction as the `tenant_students` delete and the slot refund, to all
four dependent tables: `tenant_grades`, `student_academic_records`,
`student_behavioral_records`, `result_publications` (each matched on
`LOWER(student_id)`). Returns the per-table row counts as `cascaded_rows`.

**The deciding factor was not privacy.** `tenant_students` is
`UNIQUE(subdomain, student_id)`, so a re-enrolment reusing a withdrawn
admission number inherited the previous child's grades, remarks, behavioural
ratings and published state — and was treated as already published, costing
zero credits to publish. The orphan was the mechanism of a live correctness
bug.

This **reverses a deliberate design decision**, recorded at the old
`db_manager.py:1882-1883`: *"not enforced as FK so roster edits never
cascade-delete grades."* That comment has been rewritten to explain the
reversal and to instruct that any future table referencing a student be added
to the cascade. There is no database-level FK available to do this for us —
all four tables key on the admission-number *string*, and none references
`tenant_students`.

**Consequences accepted:**

- Deleting a student is now irreversible beyond the roster row. The
  confirmation dialog previously had an **empty description** and only the
  default "This action cannot be undone." It now spells out exactly what is
  destroyed: the pupil's identifying fields, all scores and behavioural
  assessments, every teacher and principal remark written about them, and the
  publication record. Also warns that one slot is returned but consumed credits
  are not — consistent with Refund Policy §5.
- Each purge writes an `audit_logs` entry (`roster.student_purged`, actor
  `tenant_admin`). Student deletion was previously invisible.
- **Ledger carve-out (approved, P1 exception).** `billing_ledger.description`
  still embeds the admission number (`"Slot refund for deleted student
  vhs/005"`). The ledger is an immutable financial audit record and that
  string is the audit trail for the slot refund, so it is deliberately **not**
  scrubbed. Tracked as P1 item 16.
- **Pre-existing orphans: none.** A reaper was written:
  `backend/scripts/purge_orphan_students.py` — dry run by default, `--execute`
  requires `--export <dir>`, plus `--collisions-only` to audit
  admission-number reuse and `--tenant <slug>` to scope to one school. It
  deliberately never resolves a *collision* (where the number has been
  re-enrolled and now belongs to a different child): nothing in the schema
  records which pupil a grade row belonged to, so those are reported for
  manual review only.

  **Run against production 1 October 2026. Result: 0 orphans in all four
  tables, 0 collisions. Nothing was deleted; no export or snapshot was needed.**

  Verified with a positive control, because a zero from a query that cannot
  match rows is indistinguishable from a zero from a working one:

  | Table | Total rows | Orphans |
  |---|---|---|
  | `tenant_students` | 16 | 0 |
  | `tenant_grades` | 7 | **0** |
  | `result_publications` | 6 | **0** |
  | `student_academic_records` | 0 | 0 |
  | `student_behavioral_records` | 0 | 0 |

  `tenant_grades` and `result_publications` both hold real rows, so the
  predicate demonstrably executed against data and found no orphans.

  **Why it is clean, and what that does not prove.** The production dataset is
  small — 16 pupils. The result means *no pupil had ever been deleted from a
  roster before the cascade shipped*, not that the reaper is thorough. **The
  reaper has still never deleted a real orphan, so its DELETE path is
  unexercised.** If orphans ever appear, test it against a synthetic orphan in
  a scratch database before pointing it at production.

  **Incidental finding:** `student_academic_records` and
  `student_behavioral_records` are both empty in production. The SQLAlchemy
  grading engine (`backend/models.py`, `backend/routers/grading.py`) is
  provisioned and wired but unused — real grading goes through
  `tenant_grades` via `backend/routers/staff_grading.py`. That halves the
  reaper's surface, and means the P0-2 cascade's four-table sweep is really
  operating on two tables in practice.

### 3. The admin password was sent to the payment processor — CLOSED

**Original claim (wrong in its details):** `app/api/provision/route.ts:281-287`
reads the password back from Flutterwave `meta`, implying a live read-back
path.

**Correction:** that route had **zero callers anywhere in the repository** and
`app/api/register-school/route.ts` never reads `meta` at all — only
`vData.status` and `vData.amount`. The Flutterwave `meta` path was already
dead. The real channel was always the browser POST body →
`fastApiPayload.admin_password` → `ProvisionRequest.admin_password` →
`register_school(admin_password_hash=…)` → `crypt(...)`.

So the fix was a **one-line deletion**, not a re-plumb: `adminPassword` is no
longer in the Flutterwave `meta` object. The password now travels only on the
server-to-server provisioning call. `app/api/provision/route.ts` was deleted
entirely, removing the dead duplicate of `/api/register-school`.

**Residual risk that code cannot fix:** Flutterwave retains `meta` on
*historical* transactions already captured. Removing the field stops future
disclosure, not past copies. If that matters it requires action on Flutterwave's
side, not ours.

### 4. No record of what was accepted — CLOSED

**Original claim (factually wrong):** that `acceptTerms` is "collected by
`components/forms/RegisterSchoolForm.tsx`". It was not. There was **no checkbox
anywhere in the registration funnel** — only a passive "By continuing, you
agree" paragraph. The sole declaration was `types/school.ts:58` on a
`SchoolRegistrationPayload` interface imported nowhere in the codebase. This
was built from scratch.

- **Schema** — new `tenant_consents` table in
  `backend/services/db_manager.py` (`init_consent_tables()`, wired into the
  `main.py` lifespan and logged at ERROR on failure, unlike the other inits,
  because registration now hard-requires it):
  `subdomain` (FK, cascade), `terms_version`, `privacy_version`, `accepted_at`,
  `accepted_by`, `ip_address`, unique on
  `(subdomain, terms_version, privacy_version)`. Append-only, so re-acceptance
  of a genuinely new version is retained as a new row while a replayed
  registration cannot manufacture a duplicate acceptance.
- **Atomicity** — `register_school()` now opens an explicit transaction and
  writes the `schools` row and the consent row together. It **refuses to
  register at all** if the consent fields are absent. Previously the connection
  was left in autocommit and the caller swallowed failures, which could leave a
  live portal with no registry row.
- **Loud failure** — a registry write failure is now logged at ERROR and
  surfaced as `registry_error` on the provisioning response, instead of a
  swallowed `logger.warning`.
- **Source of truth** — version strings are imported from
  `lib/legal/constants.ts` (`TERMS_VERSION`, `PRIVACY_VERSION`) on the client
  and re-defaulted server-side, so the persisted record cannot drift from the
  published text.
- **Enforcement** — a required checkbox blocks submission client-side, and
  `/api/register-school` independently returns 400 with
  `fieldErrors.acceptTerms` when absent. `ProvisionRequest` declares the three
  consent fields as **required**, so FastAPI rejects at 422 before any
  provisioning begins.
- `ip_address` is retained as evidence of acceptance under NDPR s.41(3),
  best-effort from `X-Forwarded-For`.

---

## P1 — discrepancies the clean policy papers over

### 5. No field-level encryption at rest — **POLICY AMENDED; engineering work still open**

**Status: the published statement is now accurate. The gap is not closed.**

Zero occurrences of `encrypt`, `decrypt`, `Fernet`, `AES`, or any KMS across the
repository. Every PII field — names, emails, phones, addresses, student IDs,
scores, behavioural traits, remarks — is stored as plaintext. The only hashing is
bcrypt via `pgcrypto`, applied to credentials alone.

**What changed (1 October 2026, Privacy Policy v1.1):** §9 no longer leaves the
posture to inference. It now adds a **"What we do not do"** notice stating
expressly that we do not encrypt individual database fields, that protection at
rest depends on controls applied by the hosting provider which we have not
independently verified and do not control, and that a party obtaining the
database or its backups would be able to read it. §9 also gained an accurate
**signed session cookies** entry, which is a real control we do have.

Deliberately **not** claimed: infrastructure or volume encryption at rest. We
could not verify DigitalOcean's posture for the droplet from application
evidence, and a security claim we cannot stand behind is worse than an honest
gap. See new P1 item 19.

**Why this stays on the roadmap.** Amending the policy limits *misstatement*
risk. It does not change NDPR s.44, which requires appropriate technical and
organisational measures irrespective of what the policy says. A named School
that needs stronger protection for particular data will ask for it.

- **Option still available:** column-level encryption for the highest-value
  columns (student names, remarks, signature URLs) with a KMS-managed key.
  Schema to work from: `backend/services/db_manager.py:297-588, 1799-1931`.

### 6. PII written to application logs in cleartext

No redaction anywhere in the logging path.

- `backend/main.py:508-512` — logs school subdomain, admin email, and client IP
- `backend/routers/admin_auth.py:120` — logs the admin email on success
- `backend/routers/staff_auth.py:96` — logs the staff identifier
- `backend/routers/platform_auth.py:62` — logs the platform admin email
- `backend/main.py:186` — logs a prefix of the API shared secret
- **Fix:** add a redaction filter for emails, staff identifiers, and secret
  prefixes at the logger, and scrub `backend/logs/provisioning.log`.

### 7. Signature images are served without read-time authentication

`schools.principal_signature_url` and `tenant_staff.signature_url` point at
files in the publicly served `public/uploads/<subdomain>/` directory. The
`app/api/admin/uploads` handler explicitly leaves the `shared` bucket
unauthenticated.

- `app/api/staff/uploads/route.ts:71-86`
- `app/api/admin/uploads/route.ts:55-60, 84-101`
- A signature is biometric-adjacent personal data. **Fix:** move uploads behind
  a session-gated handler and stop serving them as static files.

### 8. Default staff PIN is the constant `123456`

`backend/services/db_manager.py:1848` (backfill) and
`backend/routers/allocations.py:582, 990` (inserts) create every staff account
with `crypt('123456', gen_salt('bf'))`. No forced rotation, no expiry.

- **Fix:** mark the account `must_change_password`, force a change on first
  login, and add an expiry. ToS §5.5 places the obligation on the school, but
  the platform currently makes compliance with that obligation impossible to
  verify.

### 9. No retention enforcement — **POLICY AMENDED; engineering work still open**

**Status: the published schedule is now accurate. The gap is not closed.**

No `expires_at`, no TTL column, no purge job, no anonymisation-on-delete
anywhere. All grades, remarks, notifications, ledgers, and audit logs persist
indefinitely. The only time-bound artefact in the whole system is the 12-hour
session cookie.

Worse than "unenforced": version 1.0 of the Privacy Policy stated fixed periods
we did not enforce, and in practice held the data **longer** than stated —
audit logs "5 years" and support tickets "2 years" are both kept indefinitely,
and server logs had no rotation. Under NDPR s.41(2) storage limitation,
retaining beyond what you told people is the wrong direction, so this was a real
over-collection claim rather than a cosmetic one.

**What changed (1 October 2026, Privacy Policy v1.1):** §10 replaced the false
precision with the actual position — School Data is retained for as long as the
account is provisioned, and we act on a School's verified written instruction
within 30 days, except categories Nigerian law requires us to keep (the
append-only financial ledger). The three unsupported periods were removed. The
lead-in now states plainly that **we do not delete School Data by default**, and
a closing note commits to the 30-day instruction turnaround. The billing row
kept its 7-year statutory period, which is genuine.

Note the drafted phrasing was corrected before publication: it originally
proposed tying retention to "the school's subscription". There is no
subscription — `schools.subscription_plan` is always `NULL` and Refund Policy
§2.1 says so explicitly — so that wording would have repeated the same error as
item 10.

**Why this stays on the roadmap.** By default we now delete nothing, which is
honest but weak against NDPR s.41(2) ("no longer than is necessary"). Building
real enforcement remains the fix.

### 10. Marketing copy does not match the billing model

`app/(landing)/pricing/page.tsx:37` says "Pay Per Term" and
`components/ui/PricingCalculator.tsx:59-61` labels the total "TOTAL COST PER
TERM (NGN)" and "one-time per term". The code charges `N × tierPrice` **once at
signup** and the resulting Slots roll over **forever**. There is no per-term
charge.

- `lib/pricing.ts:15-33` (tiers), `credits.py:403-413` (permanent top-up)
- Refund Policy §2.2 and §2.5 state the true model. **Fix:** correct the
  pricing page and calculator copy so the marketing site and the legal page
  agree, or a school that read `/pricing` will have a legitimate expectation
  problem.

### 11. "Top up to restore access" does not restore access — CLOSED

The suspended-tenant banner told schools to top up, and `credits.py` top-ups
only ever wrote `credit_balance` / `slots_balance`. Suspension was lifted solely
by superadmin `PATCH /tenants/{subdomain}/status` (`admin.py:393`), so a paying
school stayed suspended and the CTA was a dead end.

**A safety blocker surfaced before the fix could be built.** There was **no**
`schools.suspension_reason` column — the superadmin "reason" field was optional
free text written only to `audit_logs.details` and never read back. Nothing could
distinguish "suspended for non-payment" from "suspended for abuse or legal risk"
(ToS 8.3, 8.5). Wiring the payment hook naively would have let anyone banned for
abuse restore themselves by paying N100 — a pay-to-escape-a-ban path on a
platform holding children's assessment data.

**What was done:**

- **`suspension_reason VARCHAR(24)`** added to `schools` (`db_manager.py`,
  `init_schools_registry()`, existing `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  idiom, so idempotent and run on every boot). Values: `nonpayment`, `abuse`,
  `legal`, `security`, or NULL. Existing suspended tenants default to NULL,
  which behaves as non-payment from day one — no backfill required.
- **Persisted, not just audited.** `TenantStatusUpdate` in `admin.py` accepts
  and validates `suspension_reason`, writes it to the tenant row, and clears it
  on reactivation so a stale cause cannot keep blocking future restores.
- **Restore hook** — `_restore_if_payment_clears_suspension()` in
  `backend/routers/credits.py`, called from **both** top-ups on the same cursor,
  after the ledger write and **before `COMMIT`**, so the grant and the
  reactivation are one atomic unit. Guarded by
  `is_active = FALSE AND (suspension_reason IS NULL OR = 'nonpayment')`, so
  `abuse` / `legal` / `security` are never cleared by money. The idempotent
  replay branch returns before reaching it, so a repeated `transaction_id`
  cannot re-trigger a restore.
- **Audit attribution.** Writes `billing.payment_restore` with
  `actor="payment"` / `actor_type="system"`, so a payment is not misattributed
  to `superadmin` as it would have been via the superadmin endpoint.
- **Required cause in the UI.** `TenantLifecycleModals.tsx` — the optional
  free-text reason is now a **required** category select (free text kept as a
  supplementary note), and the confirm button is blocked until a cause is
  chosen. Deliberate: an operator who leaves it unset on an abuse suspension
  silently re-enables pay-to-escape.
- **Tenant-facing copy corrected** on the admin dashboard banner and
  `SuspendedPortal.tsx`, both now stating that a top-up restores access only for
  non-payment suspensions. `SuspendedPortal` previously said "contact the school
  administration" beside an admin-only button saying "top up"; the two branches
  are now distinct.
- **Fail-open closed** at
  `app/[subdomain]/admin/(dashboard)/layout.tsx:43`. It read
  `school != null && school.isActive === false`, so an unreachable backend
  (`school === null`) hid the banner and rendered the whole dashboard as if
  nothing were wrong. Now fails closed.
- **Feedback loop** — the top-up response carries `restored_from_suspension`,
  which `BillingCheckout` surfaces as a "Portal Restored!" confirmation instead
  of bouncing the admin back to a still-suspended portal.

**Residual, accepted:** the guard depends on a human picking the right category.
That is human-in-the-loop, not a guarantee — a mis-categorised abuse suspension
becomes liftable by payment. Proper mitigation means scoping who may suspend
(see P1 item 21).

---
### 16. Two publication-status predicates disagree (surfaced by the P0-1 fix)

Now that the backend report gate is the control, its definition of "published"
has to match the one the report page still uses for the draft pill and the
print button. They do not:

- `backend/services/db_manager.py:1554-1584` `is_result_published()` — matches
  `LOWER(student_id) = LOWER(...)`.
- `backend/routers/credits.py:168-184` `GET /credits/publications` — matches
  `student_id = %s`, **case-sensitive**.

On normalised input they agree, but they are not the same predicate, and a
row with a non-lowercased `student_id` would read as published on one side and
unpublished on the other.

- **Fix:** make `credits.py` use `LOWER()` on both sides, or have
  `app/[subdomain]/report/[...studentId]/page.tsx` stop duplicating the check
  and take `is_published` from the report response. Note
  `result_publications` has a **case-sensitive** `UNIQUE` constraint while all
  readers normalise — `backend/scripts/migrate_lowercase_ids.py` exists to fix
  legacy rows but is a one-off, and the publish path compensates with a
  `LOWER()` pre-select.

### 17. Admission number retained in the billing ledger (approved carve-out)

`backend/routers/allocations.py` writes
`f"Slot refund for deleted student {sid}"` into `billing_ledger.description`
on every student deletion. The admission number is a pupil identifier, and it
survives the P0-2 cascade that erases everything else about that child.

**Accepted deliberately.** `billing_ledger` is an append-only financial record
retained under Privacy Policy §10 (7 years, legal obligation), and the string
is the audit trail tying a slot refund to the pupil it returned capacity for.
Mutating a financial ledger to remove an identifier is a worse compliance
outcome than retaining the identifier, and `ON CONFLICT (reference_id) DO
NOTHING` makes the rows non-editable by design anyway.

- **Do not** scrub this without a decision from the product owner plus a
  finance sign-off. If it is ever in scope, the correct fix is to key the
  ledger on the `tenant_students` row UUID (which is already in `reference_id`
  as `{record_id}`) rather than the admission number, for *future* rows only.

### 18. No automated backup schedule (surfaced by the item-5 amendment)

Confirmed 1 October 2026: **there is no automated daily backup job on the
droplet**, and DigitalOcean automated backups are not enabled. Snapshots have
been taken by hand (e.g. `uresultapp-engine-1790852051531`, 4.79 GB, NYC1).

Privacy Policy v1.0 claimed a *"recurring daily cycle"* of database backups.
§9 now says backups are *"taken on a manual and ad hoc basis rather than on a
fixed automated schedule"* and flags it as a gap.

- **Impact:** a disk-level failure between manual snapshots loses everything
  since the last one. The Refund Policy and ToS make no recovery promise, so
  this is not a contractual breach — but "we'll restore your data" is the first
  thing a school asks after an incident, and today the honest answer is "from
  the most recent manual snapshot".
- **Fix:** enable DigitalOcean automated Droplet backups (weekly + on-demand
  daily before release) **and** add a logical `pg_dump` on a schedule, because
  a full-disk image is a slow restore path (new droplet, new IP) for a targeted
  recovery. Retain at least one snapshot off the production droplet.
- **Also verify:** the §9 claim of *"periodic"* backups now needs at least one
  real schedule behind it, or it drifts back into being a soft claim.

### 19. Data residency is outside Nigeria — verified as a statement

Superseded the false §9 claim (Privacy Policy v1.1 now names the United States
and cross-references §13). Recorded here because it is an ongoing compliance
fact, not a closed item:

- The database and every per-tenant database live on a DigitalOcean Droplet in
  **NYC1**, outside Nigeria. Under NDPR s.49–51 this is a cross-border transfer
  and we are the exporter.
- §13 discloses it and names the safeguards we rely on. **Those safeguards have
  not been independently verified** — we rely on the processing addendum with
  DigitalOcean, and we have not confirmed an SCC or adequacy basis exists. If
  one does not, the transfer mechanism is asserted rather than established.
- **Fix:** confirm the DPA and transfer mechanism with DigitalOcean in writing,
  and record the date of confirmation next to §13.
- **Option:** move the data region to Africa if customer expectations require
  local residency. This is the change that would let §9 claim local hosting, and
  is a commercial decision rather than a technical one.

### 20. `upgrade_tenant` can grant unearned capacity and produces a contradictory row

`backend/main.py:403-494` `POST /api/v1/tenant/{id}/upgrade` sets
`subscription_status = 'active'` and overwrites `student_count` — but **never
touches `is_active`**, so it cannot unsuspend a suspended tenant. It then
leaves the row in `is_active = FALSE, subscription_status = 'active'`, a state
that both the "Active" directory filter (`admin.py:146`) and the
`active_schools` KPI (`admin.py:1043`) exclude, so a tenant can be paying and
invisible in reporting.

Worse: it writes **no `billing_ledger` row**, so capacity is granted with no
financial record, and it is reachable by any tenant admin via a hand-crafted
POST — `app/api/billing/upgrade/route.ts` is mounted and guarded only by
`requireAdminSession`. It is unreachable from the UI (`BillingCheckout`'s
`mode="subscription"` default has no caller), but the endpoint is live.

- **Fix:** either delete the route, or make it call the same audited,
  ledger-writing path as the top-ups. Do not leave a second, weaker way to
  change billing state.

### 21. No role separation on tenant lifecycle actions

`lib/superadminAuth.ts` checks only that `superadmin === true`. It never reads
`role`, even though `platform_admins.role` is constrained to
`owner | admin | support` (`db_manager.py:410`). A **`support`-role** platform
admin can therefore suspend, unsuspend, soft-delete, restore, reset a tenant's
password, grant credits, and change the credit price — the same powers as an
owner.

This matters more after the item-11 fix, because choosing a suspension cause is
now the control that decides whether abuse suspensions are liftable by payment.

- **Fix:** enforce role checks in `requireSuperadmin` callers — read-only roles
  must not reach lifecycle or financial endpoints. Role is already in the signed
  session payload, so no re-fetch is needed.

### 22. `restore_tenant` does not clear `is_active`

`admin.py:589-627` soft-restore clears `deleted_at` only. A tenant that was
soft-deleted *and* suspended comes back still suspended, with the portal 404ing
on every surface. `suspension_reason` is also left stale.

- **Fix:** clear `is_active` and `suspension_reason` alongside `deleted_at`, or
  state in the UI that restore does not reactivate.

---

## P2 — hardening

### 12. Per-tenant database password in plaintext on disk

`backend/services/site_generator.py:109-124, 217-225` writes the generated
24-character password into `config.inc.php` at mode 640, and
`db_manager.py:69-75` generates it in process.

- **Fix:** pull the credential from a secret store or an environment file with
  restrictive permissions, and template only the reference.

### 13. `/api/admin/set-password` has no session guard

`app/api/admin/set-password/route.ts` (whole file) reads no cookie. An
unauthenticated party who knows a `tenant_id` and an admin email can set the
admin password for any tenant whose `admin_password_hash IS NULL`
(`backend/routers/admin_auth.py:147-211`).

- **Fix:** require a valid superadmin session and audit the action.

### 14. `notification_reads` and legacy log rows leak tenant keys

`notification_reads.tenant_id` has no foreign key to `schools`, and
`audit_logs.subdomain` is nullable with no FK, so both can retain rows for a
tenant that no longer exists. There is a manual cleanup script
(`scripts/clean_orphan_nudge_reads.py`, dry-run by default) but no scheduled
job.

- **Fix:** add the foreign keys with an explicit retention rule, and schedule
  the cleanup.

### 15. Support ticket payload sanitiser is a denylist, not an allowlist

`backend/routers/support.py:132-167` strips known-bad keys rather than
permitting only known-good ones, so a determined submitter can place arbitrary
content in `support_tickets.payload` (JSONB, tenant-scoped).

- **Fix:** invert to an allowlist of permitted keys and types.

### 23. Dead SQLAlchemy grading tables (surfaced by the orphan-reaper run)

Confirmed empty in production on 1 October 2026:

| Table | Rows |
|---|---|
| `tenant_students` | 16 |
| `tenant_grades` | 7 |
| `result_publications` | 6 |
| **`student_academic_records`** | **0** |
| **`student_behavioral_records`** | **0** |

The SQLAlchemy grading engine — `backend/models.py` (`GradingTemplate`,
`StudentAcademicRecord`, `StudentBehavioralRecord`) and
`backend/routers/grading.py` — is **provisioned on every boot via
`init_grading_tables()` and entirely unused**. Real grading runs through
`backend/services/db_manager.py` into `tenant_grades`, driven by
`backend/routers/staff_grading.py`.

Two consequences:

- **Blast radius is smaller than believed.** The P0-2 delete cascade sweeps four
  tables but is really operating on two, and the orphan reaper's
  `--execute` path has half its intended surface. That is good news for risk,
  not a reason to stop sweeping them.
- **Maintenance and attack surface.** A second, unused schema for the most
  sensitive data in the system is created, migrated and served with no consumer.
  Its endpoints are live and reachable (`app/api/records/**`, deleted during
  the P0 pass as unauthenticated; `POST /api/v1/records/academic` behind the
  shared secret), so a future caller could write to tables nothing reads.

- **Decide:** either finish the migration to the new grading engine, or delete
  `backend/models.py`, `backend/routers/grading.py`,
  `backend/schemas.py`'s grading models and `init_grading_tables()`, plus the
  two tables. Do not leave it provisioned and inert.

---

## Verification notes

- **No cookies were in scope for remediation.** The session-cookie position in
  Privacy Policy §5 is accurate as written: three first-party host-only
  HTTP-only SameSite=Lax cookies, 12-hour lifetime, and no advertising,
  analytics, or tracking technology of any kind in the repository. No cookie
  banner is required and none is shown. Nothing here should be read as
  implying a consent mechanism is needed.
- `tenant_students` has no DOB, photograph, address, guardian, or biometric
  column. Privacy Policy §4.3 states this explicitly as a negative list. If
  any of those fields are ever added, §4.3, the Annex A inventory, and
  §12 (children's data) all need revisiting at the same time.
- `types/school.ts:69-85` declares `dateOfBirth`, `parentEmail`, `parentPhone`
  and `photoUrl` on the `Student` interface. **No column behind them exists.**
  The type declarations are unused and should either be implemented or deleted,
  because a future developer could reasonably read them as evidence the
  platform collects that data. Likewise `SchoolRegistrationPayload` at
  `types/school.ts:46-59` (including its `acceptTerms: boolean`) is imported
  nowhere; real consent now lives in the `tenant_consents` table.
- **Testing note.** `python` on this workstation resolves to the Microsoft
  Store alias stub, which makes `python -m py_compile ... | ...` silently
  unreliable. The real interpreter is at
  `%LOCALAPPDATA%\Programs\Python\Python311\python.exe`. Backend syntax checks
  must use that path.
