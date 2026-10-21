"use client";

import { useEffect, useState } from "react";
import { Settings, AlertCircle, Loader2, Sparkles, KeyRound, ShieldCheck } from "lucide-react";
import { formatNaira } from "@/lib/pricing";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { PasswordToggle } from "@/components/ui/PasswordField";

interface FreeCreditsConfig {
  enabled: boolean;
  min_students: number;
  grant_amount: number;
}

type TabId = "billing" | "security";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "billing", label: "Billing" },
  { id: "security", label: "Security" },
];

function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return "at least 12 characters";
  if (!/[a-zA-Z]/.test(pw)) return "at least one letter";
  if (!/[0-9]/.test(pw)) return "at least one number";
  return null;
}

/**
 * Global Settings — platform tunables, tabbed.
 *
 * Billing: the two existing platform tunables (credit price, free credits),
 * moved verbatim under the tab. Security: change OWN password — the normal
 * path that replaces SSH rotation via scripts/set-platform-admin-password.py
 * (the script remains break-glass).
 */
export default function SettingsView() {
  const [tab, setTab] = useState<TabId>("billing");

  // --- Billing state (unchanged behaviour, from the pre-tab page) ---
  const [creditPrice, setCreditPrice] = useState<number>(200);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [freeCredits, setFreeCredits] = useState<FreeCreditsConfig | null>(null);
  const [freeLoading, setFreeLoading] = useState(true);
  const [freeSaving, setFreeSaving] = useState(false);
  const [freeError, setFreeError] = useState<string | null>(null);

  // --- Security state (change own password) ---
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPrice() {
      setPriceLoading(true);
      try {
        const res = await fetch("/api/admin/config/credit-price", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof (data as { credit_price?: number }).credit_price === "number") {
          if (!cancelled) setCreditPrice((data as { credit_price: number }).credit_price);
        }
      } catch {}
      if (!cancelled) setPriceLoading(false);
    }
    async function loadFreeCredits() {
      setFreeLoading(true);
      try {
        const res = await fetch("/api/admin/config/free-credits", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof (data as FreeCreditsConfig).enabled === "boolean") {
          if (!cancelled) setFreeCredits(data as FreeCreditsConfig);
        }
      } catch {}
      if (!cancelled) setFreeLoading(false);
    }
    void loadPrice();
    void loadFreeCredits();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setPriceSaving(true);
    setPriceError(null);
    try {
      const res = await fetch("/api/admin/config/credit-price", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credit_price: creditPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      toast.success(`Saved: ${formatNaira((data as { credit_price: number }).credit_price)} per credit`);
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setPriceSaving(false);
    }
  }

  async function handleToggleFreeCredits(next: boolean) {
    if (!freeCredits) return;
    const prev = freeCredits;
    // Optimistic — reverted if the save fails.
    setFreeCredits({ ...freeCredits, enabled: next });
    setFreeSaving(true);
    setFreeError(null);
    try {
      const res = await fetch("/api/admin/config/free-credits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      const saved = data as FreeCreditsConfig;
      setFreeCredits({
        enabled: saved.enabled,
        min_students: saved.min_students ?? prev.min_students,
        grant_amount: saved.grant_amount ?? prev.grant_amount,
      });
      toast.success(saved.enabled ? "Free registration credits enabled" : "Free registration credits disabled");
    } catch (e) {
      setFreeCredits(prev);
      setFreeError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setFreeSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (!currentPw || !newPw) {
      setPwError("Both the current and the new password are required");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("The new passwords do not match");
      return;
    }
    const weak = passwordProblems(newPw);
    if (weak) {
      setPwError(`Password too weak — needs ${weak}.`);
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/superadmin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      toast.success("Password changed. Use it the next time you sign in.");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.35)]">
          <Settings className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Global Settings</h1>
          <p className="text-sm text-text-2">Platform-wide tunables, organised by area</p>
        </div>
      </div>

      {/* Tab bar — same functional shape as the school admin SettingsForm tabs:
          content panels stay siblings so forms never nest. */}
      <div role="tablist" aria-label="Settings sections" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-fg"
                : "rounded-full border border-line-1 px-4 py-2 text-xs text-text-2 hover:bg-surface-2"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Billing                                                          */}
      {/* ---------------------------------------------------------------- */}
      {tab === "billing" && (
        <>
          <div className="mt-4 rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur">
            <h2 className="text-sm font-semibold text-text-1">Publishing Credit Price (Superadmin)</h2>
            <p className="mt-1 text-xs text-text-2">
              Flat NGN per credit — applies to all future credit top-ups. Slots remain tiered (100/90/80).
            </p>
            {priceError && (
              <div className="mt-3 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{priceError}</span>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-2">₦</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={priceLoading ? "" : creditPrice}
                  onChange={(e) => setCreditPrice(Math.max(1, Math.min(100000, Number(e.target.value) || 0)))}
                  className="w-28 rounded-xl border border-line-1 bg-surface-0 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                  disabled={priceLoading}
                />
                <span className="text-sm text-text-2">per credit</span>
              </div>
              <button
                type="button"
                disabled={priceSaving || priceLoading}
                onClick={() => void handleSave()}
                className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
              >
                {priceSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Price
              </button>
            </div>
          </div>

          {/* Free registration credits — toggle is only half the rule */}
          <div className="mt-4 rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text-1">
                  <Sparkles className="h-4 w-4 text-success" />
                  Free Registration Credits
                </h2>
                <p className="mt-1 text-xs text-text-2">
                  Grants a complimentary credit bundle to new schools at provisioning.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-text-2">
                  {freeLoading ? "Loading…" : freeCredits?.enabled ? "Enabled" : "Disabled"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={freeCredits?.enabled ?? false}
                  aria-label="Enable free registration credits"
                  disabled={freeLoading || freeSaving || !freeCredits}
                  onClick={() => void handleToggleFreeCredits(!(freeCredits?.enabled ?? false))}
                  className={cn(
                    "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 disabled:cursor-not-allowed disabled:opacity-60",
                    freeCredits?.enabled ? "bg-emerald-500" : "bg-surface-3"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                      freeCredits?.enabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
                {freeSaving && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
              </div>
            </div>

            {/* The threshold is the binding constraint — say so explicitly so the
                toggle is never read as "free credits for everyone". */}
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-3">
              <p className="text-xs font-medium text-warning">Volume threshold always applies</p>
              <p className="mt-1 text-xs leading-5 text-warning">
                This toggle only <em>permits</em> the grant. The backend grants{" "}
                <strong className="font-semibold text-warning">
                  {freeCredits?.grant_amount ?? 30} credits
                </strong>{" "}
                only when a school&apos;s initial capacity is{" "}
                <strong className="font-semibold text-warning">
                  {freeCredits?.min_students ?? 500} students or more
                </strong>{" "}
                (inclusive — exactly {freeCredits?.min_students ?? 500} qualifies). Smaller schools receive no
                free credits regardless of this setting.
              </p>
            </div>

            <p className="mt-3 text-xs text-text-3">
              The server is authoritative: the registration form&apos;s credit value is ignored, and this
              toggle never grants credits on its own. Changes apply to future registrations only.
            </p>

            {freeError && (
              <div className="mt-3 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{freeError}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Security                                                         */}
      {/* ---------------------------------------------------------------- */}
      {tab === "security" && (
        <div className="mt-4 rounded-2xl border border-line-1 bg-surface-1 p-5 backdrop-blur">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-1">
            <KeyRound className="h-4 w-4 text-accent" />
            Change your password
          </h2>
          <p className="mt-1 text-xs text-text-2">
            Rotates YOUR platform admin credential. The current password is verified server-side, and only
            the bcrypt hash is stored — the old SSH routine (
            <span className="font-mono">set-platform-admin-password.py</span>) stays available as
            break-glass tooling.
          </p>

          {/* Residual, stated plainly: stateless cookies mean open sessions
              keep verifying until their 12-hour expiry (ToS §5.5). */}
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-3">
            <p className="text-xs font-medium text-warning">Open sessions are not signed out</p>
            <p className="mt-1 text-xs leading-5 text-warning">
              Sessions are stateless (a signed 12-hour cookie). A password change does not revoke a session
              someone already holds — it stops them from signing in with the OLD password from now on.
            </p>
          </div>

          {pwError && (
            <div className="mt-3 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{pwError}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} className="mt-4 max-w-md space-y-4">
            <Input
              label="Current password"
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              required
            />
            <Input
              label="New password (min 12 characters, a letter and a number)"
              type={showNew ? "text" : "password"}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
              required
              trailing={
                <PasswordToggle label="new password" visible={showNew} onToggle={() => setShowNew((v) => !v)} />
              }
            />
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="submit"
              disabled={pwSaving}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
            >
              {pwSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Change password
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
