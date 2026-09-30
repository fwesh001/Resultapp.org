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

- **P1 remains open.** Privacy Policy §9 and §10 still describe controls the
  code does not yet implement: no field-level encryption at rest (item 5) and
  no retention enforcement (item 9). Both are in the published text. They are
  not P0 because neither creates a disclosure path on its own, but the policy
  currently overstates the posture in those two sections.
- **`purge_orphan_students.py` has never been run.** The P0-2 cascade only
  covers deletions made after it shipped. Existing orphans remain in
  production and need a point-in-time snapshot before `--execute`.

---

## P0 — CLOSED 1 October 2026

All four P0 items were remediated in a single pass. Each is marked below with
what actually changed, because two of the original write-ups were wrong about
the code and the correction matters if anyone re-investigates.

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
- **Pre-existing orphans** are not reachable by new code. A reaper was written:
  `backend/scripts/purge_orphan_students.py` — **dry run by default**,
  `--execute` to write, plus `--collisions-only` to audit admission-number
  reuse. It deliberately never resolves a *collision* (where the number has
  been re-enrolled and now belongs to a different child): nothing in the
  schema records which pupil a grade row belonged to, so those are reported
  for manual review only. **It has not been run. It requires a
  point-in-time PostgreSQL snapshot first.**

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

### 5. No field-level encryption at rest

Zero occurrences of `encrypt`, `decrypt`, `Fernet`, `AES`, or any KMS across
the repository. Every PII field — names, emails, phones, addresses, student
IDs, scores, behavioural traits, remarks — is stored as plaintext. The only
hashing is bcrypt via `pgcrypto`, applied to credentials alone.

- **Options:** (a) add column-level encryption for the highest-value columns
  (student names, remarks, signature URLs) with a KMS-managed key; or (b) amend
  Privacy Policy §9 to describe the actual posture — encryption in transit,
  hashed credentials, infrastructure-level disk encryption — rather than the
  current inference that records are protected beyond that.
- Schema to work from: `backend/services/db_manager.py:297-588, 1799-1931`.

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

### 9. No retention enforcement

No `expires_at`, no TTL column, no purge job, no anonymisation-on-delete
anywhere. All grades, remarks, notifications, ledgers, and audit logs persist
indefinitely. The only time-bound artefact in the whole system is the 12-hour
session cookie.

- Privacy Policy §10 commits to a retention schedule. **Fix:** implement the
  table in §10 as an actual job, or reduce §10 to what the system enforces.

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

### 11. "Top up to restore access" does not restore access

A suspended tenant sees a call to action in
`app/[subdomain]/admin/(dashboard)/layout.tsx:52-65` telling them to top up in
order to restore access. Suspension is lifted only by a superadmin
`PATCH /tenants/{subdomain}/status` (`backend/routers/admin.py:389-449`); a
top-up changes no status column.

- **Fix:** make the action honest, or wire the CTA to a request rather than to
  billing. ToS §8.5 promises prompt restoration once the risk is resolved.

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
  platform collects that data.
