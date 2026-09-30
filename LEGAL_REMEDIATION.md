# Legal & Data Protection Remediation Backlog

**Status:** open
**Raised:** 1 October 2026
**Owner:** engineering
**Context:** discovered while drafting `/privacy`, `/terms` and `/refund-policy`.

The legal pages shipped in a deliberately clean form: they describe what the
platform does, and they are worded the way a production policy is worded. That
choice is only safe while the items below are closed. Each item is a place
where the code does not yet do what a reader of the published policy would
reasonably assume it does.

The NDPA 2023 / NDPR 2023 exposure is real: the Nigeria Data Protection
Commission can levy penalties up to **₦10,000,000 or 2% of annual turnover**
for serious breaches, and up to ₦10,000,000 for a data breach that is not
notified. The Terms of Service carve the school out for its own unlawful
processing (ToS §12.2), but nothing can carve us out for ours.

---

## P0 — the policy currently makes a statement the code cannot support

### 1. `/api/report` has no session guard

`app/api/report/route.ts` reads no cookie and applies no `requireAdminSession`.
Anyone who can reach the deployment and knows a `tenant_id` and a `student_id`
can fetch a full report bundle: name, class, gender, every score, every
behavioural rating, all remarks, and class rankings. Same for `/api/records`
and `/api/records/academic`.

- Backend fan-out: `backend/routers/report.py:497-700`
- Privilege argument to close: Privacy Policy §4.4 and §4.5 say academic and
  publication records sit behind Authorised Users; §9 says tenant isolation is
  enforced on every request.
- **Fix:** add `requireAdminSession(tenantId)` plus the tenant-binding check
  used in `lib/adminAuth.ts:44-51`, and repeat for the records routes.

### 2. Deleting a student orphans their grades and remarks

`backend/routers/allocations.py:1240-1290` hard-deletes the `tenant_students`
row. `tenant_grades` links to a student by `student_id` as a **logical
reference, deliberately not a foreign key** (`backend/services/db_manager.py:1882-1883`).
The consequence is that `tenant_grades`, `student_academic_records`,
`student_behavioral_records` and `result_publications` rows survive the
deletion, taking with them free-text teacher, form-master, and principal
remarks about a child who no longer exists as a record.

- **Fix:** transactionally delete or anonymise the dependent grade and
  publication rows in the same transaction, and have the caller choose between
  deletion and anonymisation.
- **Blocker for:** Privacy Policy §11.1 (erasure) cannot be honestly true
  until this is closed. Erasure of a deleted pupil's data is currently not
  achievable end to end.

### 3. The admin password is sent to the payment processor

`components/forms/RegisterSchoolForm.tsx:285` places `adminPassword` into the
Flutterwave `meta` object. `app/api/provision/route.ts:281-287` reads it back.
The password is therefore transmitted in cleartext to a third-party payment
provider and retained in their transaction metadata.

- **Fix:** delete the field from the checkout payload. Provisioning should
  happen after payment, server to server, or the password should be set in a
  separate step after the portal exists.
- **Blocker for:** Privacy Policy §7.2 (sub-processor table) and §2.2
  (processor confined to documented instructions). This is a disclosure of a
  credential to a sub-processor that the school never authorised.

### 4. No record of what was accepted

`acceptTerms` is declared in `types/school.ts:58` and collected by
`components/forms/RegisterSchoolForm.tsx`, but it is **never transmitted to or
persisted by any backend endpoint**. There is no consent table, no
`consent_at`, no policy-version column, and no marketing opt-in field anywhere
in the schema.

- **Fix:** add a `tenant_consents` table keyed by subdomain, capturing document
  slug, version, effective date, timestamp, and the admin email that accepted.
  Write on successful registration and on any later re-acceptance.
- **Blocker for:** ToS §1 (acceptance) and Privacy Policy §14. We cannot prove
  which version of the Terms a given school agreed to.

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
