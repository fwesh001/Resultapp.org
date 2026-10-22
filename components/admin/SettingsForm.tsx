"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Mail, PenLine } from "lucide-react";
import UploadField from "@/components/ui/UploadField";
import { SectionCard } from "@/components/ui/SectionCard";
import { MobileActionBar } from "@/components/ui/MobileActionBar";
import { Select } from "@/components/ui/Select";
import InfoTooltip from "@/components/ui/InfoTooltip";
import SchemeBuilder from "@/components/remarks/SchemeBuilder";
import ModeratorManager from "@/components/admin/ModeratorManager";
import PasswordChange from "@/components/admin/PasswordChange";
import { toast } from "@/components/ui/toast";
import SignatureCaptureModal from "@/components/ui/SignatureCaptureModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { RemarkBand, School } from "@/types/school";

interface SettingsFormProps {
  school: School | null;
}

/**
 * The four settings surfaces.
 *
 * Split by WHO changes them and HOW OFTEN, not by which database table the
 * fields live in. The previous "Report-Card Branding" tab held the principal
 * signature next to ID prefixes next to the term calendar — three unrelated
 * jobs behind one label, so nobody could find the term dropdown.
 *
 *   General   — identity and contact. Changes rarely.
 *   Branding  — how the report card LOOKS. Changes rarely.
 *   Security  — who can reach this portal. Changes when the team does.
 *   Academics — the term calendar and remark rules. Changes every term.
 */
type SettingsTab = "general" | "branding" | "security" | "academics";

const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "branding", label: "Branding" },
  { id: "security", label: "Security" },
  { id: "academics", label: "Academics" },
] as const;

/**
 * Client-side school profile form.
 * PATCHes branding data through the Next.js settings proxy,
 * which forwards to FastAPI with the API secret.
 */
export default function SettingsForm({ school }: SettingsFormProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The custom Select is controlled, so the active term is held in state and
  // mirrored into the form by its hidden `name="current_term"` input.
  const [currentTerm, setCurrentTerm] = useState(school?.currentTerm ?? "Term 1");

  // Drawn principal signature.
  //
  // Held in local state (not in the form's field list) and persisted by its
  // OWN request the moment the modal saves. Deliberately not part of
  // handleSubmit: a hidden input would be re-sent on every later Save, so
  // changing an unrelated setting could silently restore a stale signature.
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [drawnSignature, setDrawnSignature] = useState<string | null>(
    school?.principalSignatureData ?? null,
  );

  // --- Email-change OTP -----------------------------------------------------
  //
  // schools.email is the admin login identifier, so changing it needs proof the
  // requester controls the NEW mailbox. The sequence is: type a new address ->
  // the OTP panel appears -> request a code -> verify it -> the change saves
  // itself and the admin is signed out to the new address.
  //
  // Verify is the LAST step, not a checkpoint before one. That is why the code
  // must survive verification: the profile write burns it. For a while the
  // verify endpoint burned it too, so the write could never succeed and every
  // confirmed change failed at the save with "That verification code is invalid
  // or has expired." Exactly one burn remains, on the write.
  //
  // The code is still single-use: a second save with the same code fails,
  // because the first one consumed the row.
  const [emailValue, setEmailValue] = useState(school?.email ?? "");
  const [otpState, setOtpState] = useState<"idle" | "sent" | "verified">("idle");
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  /**
   * Holds a VERIFIED code whose application is waiting on a yes/no answer,
   * because applying it signs the admin out and would discard other edits.
   *
   * The code travels in here rather than being re-read from `otpCode` so the
   * dialog cannot apply a different code than the one that was just checked —
   * if the admin edits the OTP field while the dialog is open, the pending
   * entry still carries what actually verified.
   */
  const [discardPrompt, setDiscardPrompt] = useState<{ code: string } | null>(null);
  /** True while the confirmed email is being written and the admin is signed out. */
  const [applyingEmail, setApplyingEmail] = useState(false);
  // Needed to read the live DOM values of the profile fields. The form is
  // uncontrolled (defaultValue), so there is no state holding them — the only
  // way to know whether the admin has unsaved work is to ask the form.
  const formRef = useRef<HTMLFormElement>(null);

  const originalEmail = (school?.email ?? "").trim().toLowerCase();
  const emailChanged =
    emailValue.trim().toLowerCase().length > 0 &&
    emailValue.trim().toLowerCase() !== originalEmail;

  /**
   * Do any fields OTHER than the email differ from what the server sent?
   *
   * Confirming an email now saves immediately and then bounces to login,
   * because the session is keyed to the address that just changed. Anything the
   * admin had half-typed in the motto or term fields dies with that redirect.
   * Silently discarding someone's work is the kind of thing that gets a form
   * distrusted, so we detect it and ask first.
   */
  function hasUnsavedOtherChanges(): boolean {
    const form = formRef.current;
    if (!form) return false;
    const fd = new FormData(form);
    const originals: Record<string, string> = {
      school_name: school?.name ?? "",
      motto: school?.motto ?? "",
      phone: school?.phone ?? "",
      address: school?.address ?? "",
      current_term: school?.currentTerm ?? "",
      current_session: school?.currentSession ?? "",
      new_term_begins: school?.newTermBegins ? String(school.newTermBegins).slice(0, 10) : "",
      logo_url: school?.logoUrl ?? "",
      hero_bg_url: school?.heroBgUrl ?? "",
      id_prefix: school?.idPrefix ?? "",
      staff_id_prefix: school?.staffIdPrefix ?? "",
    };
    for (const [key, original] of Object.entries(originals)) {
      const raw = fd.get(key);
      const current = typeof raw === "string" ? raw.trim() : "";
      if (current !== original.trim()) return true;
    }
    return false;
  }

  /**
   * Persist the email change on its own, then force a re-login.
   *
   * Deliberately separate from handleSubmit, which builds its payload from
   * FormData of the whole profile. The email is the one field whose change is
   * self-contained and independently verifiable, so verifying it writes exactly
   * that one field. Folding it into the general save would let a confirmed
   * address drag along whatever half-finished edits happened to be in the
   * other tabs.
   */
  async function saveEmailChange(code: string): Promise<void> {
    const subdomain = school?.slug ?? "";
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subdomain,
        email: emailValue.trim(),
        otp_verified: true,
        otp_code: code,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
    };
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Failed to update the login address.");
    }
    // The address is now the login identifier, so the session this page is
    // rendered under is keyed to a value that no longer exists. Bouncing to
    // login is the honest outcome — staying on Settings would leave the admin
    // looking at a portal they can no longer sign in to.
    toast.success("Email updated. Please sign in again with the new address.");
    router.push(`/${subdomain}/admin/login?emailChanged=1`);
  }

  async function requestOtp() {
    const target = emailValue.trim();
    if (!target || !target.includes("@")) {
      setOtpError("Enter a valid email address first.");
      return;
    }
    setOtpBusy(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/auth/request-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target, purpose: "email_change" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not send the code.");
      }
      // The endpoint is deliberately neutral (always "sent"), so reaching here
      // does NOT prove the address exists or received anything. The wording
      // below matches that: it tells the admin what to do next, not whether
      // the mail arrived.
      setOtpState("sent");
      toast.success("If that address can receive mail, a code is on its way.");
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Could not send the code.");
    } finally {
      setOtpBusy(false);
    }
  }

  /**
   * Apply a code that has just been verified.
   *
   * Both routes into this converge here — the direct path when the form is
   * clean, and the ConfirmDialog's onConfirm when the admin has other unsaved
   * edits. One function so the two can never drift: if the guard were only on
   * one path, a change would save silently on the other.
   */
  async function commitEmailChange(code: string) {
    setOtpState("verified");
    await saveEmailChange(code);
  }

  async function verifyOtp() {
    const target = emailValue.trim();
    setOtpBusy(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/auth/verify-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: target,
          code: otpCode,
          purpose: "email_change",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        error?: string;
        // The backend returns a failure as `message` with a 200, deliberately
        // keeping the endpoint neutral. Reading only `error` meant the specific
        // "Request a new one" guidance never reached the admin.
        message?: string;
      };
      if (!res.ok || data.verified !== true) {
        throw new Error(
          data.error || data.message || "That code is incorrect or has expired.",
        );
      }

      // Verified. The code is still unspent at this point — the profile write
      // is the single authoritative consume — so save immediately rather than
      // asking the admin for a second click on a button that has nothing left
      // to do.
      //
      // Unless they have other work in progress, which the redirect would
      // silently throw away. That used to be a `window.confirm`: an unstyled
      // grey box in the middle of a themed page. ConfirmDialog is what the rest
      // of the app uses for exactly this decision, and it can show a loading
      // state while the (async) save runs.
      if (hasUnsavedOtherChanges()) {
        setDiscardPrompt({ code: otpCode });
        setOtpState("sent");
        setOtpError(
          "Code confirmed. Choose below to apply it now — your other unsaved changes will be discarded.",
        );
        return;
      }

      await commitEmailChange(otpCode);
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "That code is incorrect.");
      setOtpState("sent");
    } finally {
      setOtpBusy(false);
    }
  }

  async function persistSignature(body: Record<string, string | null>) {
    const subdomain = school?.slug ?? "";
    if (!subdomain) throw new Error("Unknown school subdomain");
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error || `Could not save signature (${res.status})`);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const subdomain = school?.slug ?? "";
    if (!subdomain) {
      setError("Unknown school subdomain — cannot save.");
      setIsSubmitting(false);
      return;
    }

    const formData = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = { subdomain };
    for (const field of [
      "school_name",
      "motto",
      "email",
      "phone",
      "address",
      "current_term",
      "current_session",
      "new_term_begins",
      "logo_url",
        "hero_bg_url",
        "id_prefix",
        "staff_id_prefix",
        "principal_signature_url",
      ]) {
      const value = formData.get(field);
      if (typeof value === "string") {
        if (field === "id_prefix") payload[field] = value.trim().toLowerCase();
        else if (field === "staff_id_prefix") payload[field] = value.trim();
        else if (field === "current_term" || field === "current_session") payload[field] = value.trim();
        else payload[field] = value.trim();
      }
    }

    // The email is NOT saved from here any more.
    //
    // It used to be: the code travelled with this payload and the backend burned
    // it on this write. But verification now writes the email itself, so by the
    // time this button is reachable the address is either already changed (and
    // the admin has been signed out) or still unverified. Carrying the proof
    // here would describe a flow that no longer exists, and forwarding a flag
    // with no matching code would be rejected server-side anyway.
    if (emailChanged) {
      setError(
        "Confirm the six-digit code with the Verify button first — that applies the email change.",
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Failed to save settings.");
      }

      // No re-login check here: this path can no longer change the email (the
      // gate above refuses when `emailChanged`), so the session's identity
      // cannot have moved. The email path owns that redirect in saveEmailChange.
      toast.success(data.message || "School profile updated successfully.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClassName =
    "mt-2 w-full rounded-xl border border-line-1 bg-surface-0 px-4 py-3 text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50";

  // THE SECURITY TAB IS DELIBERATELY OUTSIDE THE FORM.
  //
  // PasswordChange and ModeratorManager used to sit inside this <form>, and
  // PasswordChange opened a form of its own. Nested forms are invalid HTML: the
  // parser drops the inner start tag, so the "Change password" submit button
  // bound to THIS form and ran handleSubmit — a profile PATCH. The admin was
  // told the password changed and it never did. React then reported a hydration
  // mismatch and re-rendered, which is why the bug looked intermittent.
  //
  // So the form now wraps only the profile fields it can actually save, and the
  // Security panel renders as a sibling. Two independent forms, no nesting.
  const isSecurity = activeTab === "security";

  const content = (
    <div className="mt-6 space-y-4">
      {/* Free-card stack: each tab's sections carry their own borders (the
          dashboard composition). The old wrapper card is what nested panel
          cards inside a card and squeezed every row on a 375px screen. */}
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Tabs.
          Four tabs do not fit a `grid-cols-2` at 375px without shrinking the
          labels into unreadable stubs, so this is a single row that scrolls
          horizontally instead of wrapping.

          The strip is a scroll container, not a hiding one: `snap-x` gives each
          tab a detent so a swipe lands cleanly, and the fade on the right edge
          signals there is more to reach rather than implying the list ends. */}
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Settings sections"
      >
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`settings-panel-${t.id}`}
            tabIndex={activeTab === t.id ? 0 : -1}
            onClick={() => setActiveTab(t.id)}
            onKeyDown={(e) => {
              // Arrow-key navigation per the APG tabs pattern: without it the
              // strip is four separate tab stops and a keyboard user has to
              // Tab through every panel to move sideways.
              const i = SETTINGS_TABS.findIndex((x) => x.id === activeTab);
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next =
                  e.key === "ArrowRight"
                    ? (i + 1) % SETTINGS_TABS.length
                    : (i - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
                setActiveTab(SETTINGS_TABS[next].id);
                document
                  .getElementById(`settings-tab-${SETTINGS_TABS[next].id}`)
                  ?.focus();
              }
            }}
            className={`shrink-0 snap-start whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              activeTab === t.id
                ? "bg-accent font-semibold text-text-1"
                : "text-text-2 hover:bg-surface-2 hover:text-text-1"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* The profile panels, and only those, live in the form. On the Security
          tab there are no profile fields to save, so there is no form and no
          Save button — rendering one would be a submit path with nothing
          behind it. */}
      {!isSecurity && (
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      {activeTab === "general" && (
        <SectionCard
          className="space-y-4"
          role="tabpanel"
          id="settings-panel-general"
          aria-labelledby="settings-tab-general"
        >
      <div>
        <label
          htmlFor="school-name"
          className="block text-sm font-medium text-text-2"
        >
          School name
        </label>
        <input
          id="school-name"
          name="school_name"
          type="text"
          autoComplete="organization"
          defaultValue={school?.name ?? ""}
          placeholder="e.g. Victory High School"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-motto"
          className="block text-sm font-medium text-text-2"
        >
          Motto
        </label>
        <input
          id="school-motto"
          name="motto"
          type="text"
          autoComplete="off"
          defaultValue={school?.motto ?? ""}
          placeholder="e.g. Excellence through discipline"
          className={inputClassName}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="school-email"
            className="block text-sm font-medium text-text-2"
          >
            Email
          </label>
          <InfoTooltip
            label="About the admin login email"
            placement="top"
            className="-mr-2"
          >
            This is not just a contact address — it is the username you sign in to
            this portal with. Changing it will require a one-time code sent to the
            NEW address, so an attacker who gets into this form cannot quietly
            redirect the school&apos;s account to a mailbox they control.
          </InfoTooltip>
        </div>
        <input
          id="school-email"
          name="email"
          type="email"
          autoComplete="email"
          ref={emailRef}
          onChange={(e) => {
            setEmailValue(e.target.value);
            // Any edit invalidates the proof: a code was issued for one exact
            // address, so typing a different one must not inherit it.
            if (otpState !== "idle") {
              setOtpState("idle");
              setOtpCode("");
              setOtpError(null);
            }
          }}
          defaultValue={school?.email ?? ""}
          placeholder="e.g. info@school.edu"
          className={inputClassName}
        />

        {/* OTP step.
            Appears ONLY when the typed address differs from the stored one, so
            an admin editing the motto never sees it and never has to fetch a
            code to save an unrelated field. */}
        {emailChanged ? (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-warning-soft p-4">
            <p className="text-sm font-medium text-warning">
              Confirm the new login address
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-2">
              This address is how you sign in. We&apos;ll email a six-digit code
              to <span className="font-mono text-text-1">{emailValue.trim()}</span> —
              enter it and press Verify, and the change is applied straight
              away. You&apos;ll be signed out and will sign in with the new
              address.
            </p>

            {otpState === "idle" ? (
              <button
                type="button"
                onClick={requestOtp}
                disabled={otpBusy}
                className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line-1 px-4 py-2 text-sm font-medium text-accent-fg transition hover:bg-surface-2 disabled:opacity-60"
              >
                {otpBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="h-4 w-4" aria-hidden="true" />
                )}
                {otpBusy ? "Sending…" : "Send code"}
              </button>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[10rem] flex-1">
                    <label
                      htmlFor="email-otp"
                      className="block text-xs font-medium text-text-2"
                    >
                      Six-digit code
                    </label>
                    <input
                      id="email-otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void verifyOtp();
                        }
                      }}
                      placeholder="000000"
                      aria-describedby="email-otp-hint"
                      className="mt-2 w-full rounded-xl border border-line-1 bg-surface-0 px-4 py-3 font-mono text-lg tracking-[0.3em] text-accent-fg placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={verifyOtp}
                    disabled={otpBusy || otpCode.length !== 6}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-50"
                  >
                    {otpBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    Verify
                  </button>
                  <button
                    type="button"
                    onClick={requestOtp}
                    disabled={otpBusy}
                    className="inline-flex min-h-[44px] items-center px-3 py-2.5 text-xs font-medium text-text-2 transition hover:text-text-1 disabled:opacity-60"
                  >
                    Resend
                  </button>
                </div>

                <p id="email-otp-hint" className="text-xs text-text-3">
                  {otpState === "verified"
                    ? "Code confirmed — applying your new address."
                    : "The code expires in a few minutes. Enter it, then press Verify."}
                </p>

                {otpError ? (
                  <p role="alert" className="text-xs text-danger">
                    {otpError}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="school-phone"
          className="block text-sm font-medium text-text-2"
        >
          Phone
        </label>
        <input
          id="school-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={school?.phone ?? ""}
          placeholder="e.g. +234 800 000 0000"
          className={inputClassName}
        />
      </div>

      <div>
        <label
          htmlFor="school-address"
          className="block text-sm font-medium text-text-2"
        >
          School Address
        </label>
        <textarea
          id="school-address"
          name="address"
          rows={2}
          autoComplete="street-address"
          defaultValue={school?.address ?? ""}
          placeholder="e.g. Off Student Village Road, Nasarawa"
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-text-3">Shown beneath the school name on the report header.</p>
      </div>

        </SectionCard>
      )}

      {activeTab === "branding" && (
        <SectionCard
          className="space-y-4"
          role="tabpanel"
          id="settings-panel-branding"
          aria-labelledby="settings-tab-branding"
        >
      <UploadField
        id="school-logo-url"
        label="School logo"
        name="logo_url"
        defaultValue={school?.logoUrl ?? ""}
        extraFields={{ subdomain: school?.slug ?? "", kind: "logo" }}
        helper="Shown in the navbar and landing hero."
        preview="image"
        previewVariant="square"
      />

      <UploadField
        id="school-hero-bg-url"
        label="Hero background image"
        name="hero_bg_url"
        defaultValue={school?.heroBgUrl ?? ""}
        extraFields={{ subdomain: school?.slug ?? "", kind: "hero" }}
        helper="Displayed behind the landing hero."
        preview="image"
        previewVariant="wide"
        fallbackPreview="/bento-csv-accent.avif"
        fallbackNote="Previewing default platform artwork — upload to replace it."
      />

      {/* Drawn signature — the primary path. Shown above the uploader so the
          recommended option is the first thing an admin reaches for. */}
      {/* Signature group — de-carded: the panel SectionCard is the only
          surface here, and a divider marks the sub-group instead. */}
      <div className="border-t border-line-1 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-1">Principal&apos;s signature</p>
            <p className="mt-0.5 text-xs text-text-3">
              {drawnSignature
                ? "Using your drawn signature."
                : school?.principalSignatureUrl
                  ? "Using the uploaded image below."
                  : "Not set — report cards fall back to the word “Principal”."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSigModalOpen(true)}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {drawnSignature ? "Redraw signature" : "Draw signature"}
          </button>
        </div>
        {drawnSignature && (
          <div className="mt-3 flex h-20 items-end rounded-lg border border-line-1 bg-white p-2">
            {/* Preview of what will print. eslint-disable: a data URI cannot go
                through next/image without a loader configured for it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={drawnSignature} alt="Your saved signature preview" className="h-12 object-contain object-left" />
          </div>
        )}
      </div>

      {/* Uploaded-image fallback, retained per the single-signature rule: saving
          one clears the other, and the drawn one wins. */}
      <UploadField
        id="principal-signature-url"
        label="Or upload a signature image"
        name="principal_signature_url"
        defaultValue={school?.principalSignatureUrl ?? ""}
        extraFields={{ subdomain: school?.slug ?? "", kind: "signature" }}
        helper="Transparent PNG works best. Used only if no signature has been drawn above."
        preview="image"
        previewVariant="square"
      />

        </SectionCard>
      )}

      {activeTab === "academics" && (
        <div
          className="space-y-4"
          role="tabpanel"
          id="settings-panel-academics"
          aria-labelledby="settings-tab-academics"
        >
      <SectionCard className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label
          htmlFor="id-prefix"
          className="block text-sm font-medium text-text-2"
        >
          Admission ID Prefix
        </label>
        <input
          id="id-prefix"
          name="id_prefix"
          type="text"
          autoComplete="off"
          defaultValue={school?.idPrefix ?? school?.slug?.toLowerCase() ?? ""}
          placeholder="e.g. vhs"
          pattern="^[A-Za-z0-9/-]{2,20}$"
          maxLength={20}
          onChange={(e) => {
            e.target.value = e.target.value.toLowerCase();
          }}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-text-3">
          Prefix for new Admission Nos (e.g. <span className="font-mono text-text-2">vhs/001</span>). Auto-assigned on bulk upload; existing IDs are never changed.
        </p>
      </div>

      <div>
        <label
          htmlFor="staff-id-prefix"
          className="block text-sm font-medium text-text-2"
        >
          Staff ID Prefix
        </label>
        <input
          id="staff-id-prefix"
          name="staff_id_prefix"
          type="text"
          autoComplete="off"
          defaultValue={school?.staffIdPrefix ?? "STAFF/"}
          placeholder="e.g. STAFF/"
          pattern="^[A-Za-z0-9/-]{2,20}$"
          maxLength={20}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-text-3">
          Prefix for new Staff IDs (e.g. <span className="font-mono text-text-2">STAFF/001</span>). Auto-assigned on bulk upload; existing IDs are never changed.
        </p>
      </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="current-term" className="block text-sm font-medium text-text-2">
            Active Term
          </label>
          <Select
            id="current-term"
            name="current_term"
            aria-label="Active Term"
            value={currentTerm}
            onChange={setCurrentTerm}
            options={[
              { value: "Term 1", label: "Term 1" },
              { value: "Term 2", label: "Term 2" },
              { value: "Term 3", label: "Term 3" },
            ]}
          />
          <p className="mt-1 text-xs text-text-3">Dashboard and reports default to this term.</p>
        </div>
        <div>
          <label htmlFor="current-session" className="block text-sm font-medium text-text-2">
            Academic Session
          </label>
          <input
            id="current-session"
            name="current_session"
            type="text"
            autoComplete="off"
            defaultValue={school?.currentSession ?? ""}
            placeholder="e.g. 2026/2027"
            pattern="^\d{4}/\d{4}$"
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-text-3">Leave blank to auto-derive (Sept rollover).</p>
        </div>
      </div>

      <div>
        <label
          htmlFor="new-term-begins"
          className="block text-sm font-medium text-text-2"
        >
          New Term Begins
        </label>
        <input
          id="new-term-begins"
          name="new_term_begins"
          type="date"
          defaultValue={school?.newTermBegins ? String(school.newTermBegins).slice(0, 10) : ""}
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-text-3">
          Resumption date for the next term (e.g., 2026-01-09). Displayed as “09 Jan 2026” on report cards. Leave empty for “—”.
        </p>
      </div>
      </SectionCard>

      {/* The scheme saves itself (its own request + "Save scheme"), so it is a
          sibling card, not a block inside the calendar card — on a phone it
          would otherwise be a card inside a card inside band cards. */}
      <SectionCard
        title="Principal's Remark Scheme"
        description="Grade bands that auto-generate principal remarks from overall averages. Used by the “Auto-Apply Principal Remarks” bulk action. Averages in gaps stay manual."
      >
        <div className="mt-3">
          <SchemeBuilder
            initial={school?.principalRemarkScheme ?? []}
            accent="purple"
            onSave={async (bands: RemarkBand[]) => {
              const subdomain = school?.slug ?? "";
              if (!subdomain) throw new Error("Unknown school subdomain — cannot save.");
              const res = await fetch("/api/admin/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subdomain, principal_remark_scheme: bands }),
              });
              const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
              if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to save scheme.");
              }
              toast.success("Principal remark scheme saved.");
              router.refresh();
            }}
          />
        </div>
      </SectionCard>

        </div>
      )}

      {/* Free variant: the tab cards surrounding this form are the page stack
          now, so the bar carries its own rounded border instead of spilling
          past the grid. The label names what it saves on each tab — the
          Remark Scheme has its own "Save scheme" in its card, and this bar
          must not masquerade as it. */}
      <MobileActionBar variant="free">
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-accent-fg transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-surface-0 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting
            ? "Saving..."
            : activeTab === "academics"
              ? "Save term & prefixes"
              : "Save Changes"}
        </button>
      </MobileActionBar>
        </form>
      )}

      {isSecurity && (
        <div
          className="space-y-6"
          role="tabpanel"
          id="settings-panel-security"
          aria-labelledby="settings-tab-security"
        >
          <PasswordChange subdomain={school?.slug ?? ""} />

          <SectionCard
            title="Moderator Management"
            description="Give trusted staff a deputy role for the day-to-day portal without handing them your school settings, billing or audit log."
          >
            <div className="mt-4">
              <ModeratorManager subdomain={school?.slug ?? ""} />
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );

  // Mounted OUTSIDE the <form> on purpose: the drawn signature persists on its
  // own so that pressing "Save Changes" for an unrelated field (motto, prefixes)
  // cannot clobber a signature the admin just drew.
  return (
    <>
      {content}

      {/* Confirm a verified email when the form has other unsaved edits.
          Mounted outside `content` so it survives the Security tab switching —
          this decision is about the whole page, not one tab. */}
      <ConfirmDialog
        open={discardPrompt !== null}
        onOpenChange={(o: boolean) => {
          if (o) return;
          setDiscardPrompt(null);
          // Declining is not an error, but the code stays spent-proof-pending:
          // tell them plainly that nothing was applied.
          setOtpError(
            "Code confirmed, but not applied. Save your other changes first, then press Verify again.",
          );
        }}
        title="Apply your new email address now?"
        message="This signs you out immediately, because your session is keyed to the address you are changing."
        note="Any unsaved changes to the school name, motto, phone, term or branding on this page will be discarded."
        confirmLabel="Save email & sign out"
        cancelLabel="Keep editing"
        variant="danger"
        loading={applyingEmail}
        onConfirm={async () => {
          const pending = discardPrompt;
          setDiscardPrompt(null);
          if (!pending) return;
          setApplyingEmail(true);
          try {
            await commitEmailChange(pending.code);
          } catch (e) {
            setOtpError(e instanceof Error ? e.message : "Could not update the login address.");
            setOtpState("sent");
          } finally {
            setApplyingEmail(false);
          }
        }}
      />

      <SignatureCaptureModal
        open={sigModalOpen}
        onOpenChange={setSigModalOpen}
        signerLabel="Principal"
        currentSignature={drawnSignature ?? school?.principalSignatureUrl ?? null}
        onSave={async (dataUri) => {
          await persistSignature({ principal_signature_data: dataUri });
          setDrawnSignature(dataUri);
          toast.success("Signature saved", {
            description: "It will appear on report cards from now on.",
          });
          // Re-read the tenant so the header/logo and any other server-derived
          // school fields reflect the new state.
          router.refresh();
        }}
        onRemove={async () => {
          // "" is the clear signal, NOT null: null decodes identically to a
          // missing key, so the proxy cannot tell "clear it" from "not
          // supplied" and rejects the request. Blank is normalized to SQL NULL
          // server-side, which also clears the paired uploaded URL.
          await persistSignature({ principal_signature_data: "" });
          setDrawnSignature(null);
          toast.success("Signature removed");
          router.refresh();
        }}
      />
    </>
  );
}
