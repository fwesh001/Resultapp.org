"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  UserCog,
  UserX,
  Users,
  RefreshCw,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { PasswordToggle } from "@/components/ui/PasswordField";
import {
  PLATFORM_PAGE_LABELS,
  OWNER_ONLY_PAGES,
  roleDefaultPages,
  type PlatformPageId,
} from "@/lib/platformPages";

interface Member {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  /** Role-default or explicit allocation, resolved server-side: what they see. */
  pages: PlatformPageId[];
  /** Normalised explicit allocation (only what page_scope stored). */
  page_scope: string[];
}

const ROLES: Array<{ id: string; label: string; hint: string }> = [
  { id: "admin", label: "Admin", hint: "Command Center by default; owner trims pages" },
  { id: "support", label: "Mod", hint: "No pages until the owner allocates them" },
];

function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return "at least 12 characters";
  if (!/[a-zA-Z]/.test(pw)) return "at least one letter";
  if (!/[0-9]/.test(pw)) return "at least one number";
  return null;
}

/**
 * Team — owner-only platform member management.
 *
 * Replaces the CLI duo (seed_platform_admin.py + set-platform-admin-password.py)
 * for the day-to-day: create members, allocate the pages each one can see,
 * rotate passwords, deactivate. Owners cannot be minted here by design — the
 * first owner is bootstrapped by SQL; owner-role itself is therefore not a
 * role this screen grants (owner promotes an owner from the same bootstrap).
 */
export default function TeamView({ selfAdminId }: { selfAdminId: string | null }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("support");
  const [allocated, setAllocated] = useState<PlatformPageId[]>([]);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Password rotation
  const [pwTarget, setPwTarget] = useState<Member | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const load = useCallback(async () => {
    // NOTE: no synchronous setState before the first await — the initial
    // loading states start true, and a refresh keeps the stale list on screen
    // until fresh data lands (no spinner flicker, no cascading render).
    try {
      const res = await fetch("/api/superadmin/platform-admins", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      setMembers(((data as { admins?: Member[] }).admins ?? []) as Member[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial boot — with setStates strictly after the awaits (react-hooks
    // set-state-in-effect). `load` remains for event-handler refreshes.
    let cancelled = false;
    async function boot() {
      try {
        const res = await fetch("/api/superadmin/platform-admins", { cache: "no-store" });
        if (cancelled) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data as { error?: string })?.error || `Failed (${res.status})`);
        } else {
          setMembers(((data as { admins?: Member[] }).admins ?? []) as Member[]);
        }
      } catch {
        if (!cancelled) setError("Could not load members");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  function togglePage(id: PlatformPageId) {
    setAllocated((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setError("A valid email is required");
      return;
    }
    const weak = passwordProblems(newPassword);
    if (weak) {
      setError(`Password too weak — needs ${weak}.`);
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/superadmin/platform-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: newPassword,
          role: newRole,
          pages: allocated,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      toast.success(`${email} created (${newRole}).`);
      setShowCreate(false);
      setNewEmail("");
      setNewPassword("");
      setAllocated([]);
      setNewRole("support");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setCreating(false);
    }
  }

  async function patch(member: Member, body: Record<string, unknown>, successMsg: string) {
    setBusyId(member.id);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/platform-admins/${encodeURIComponent(member.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      toast.success(successMsg);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetPassword() {
    if (!pwTarget) return;
    const weak = passwordProblems(pwValue);
    if (weak) {
      toast.warning(`Password too weak — needs ${weak}.`);
      return;
    }
    setPwBusy(true);
    try {
      const res = await fetch(
        `/api/superadmin/platform-admins/${encodeURIComponent(pwTarget.id)}/password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pwValue }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      toast.success(`Password updated for ${pwTarget.email}. Tell them out-of-band.`);
      setPwTarget(null);
      setPwValue("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setPwBusy(false);
    }
  }

  const pageIds = Object.keys(PLATFORM_PAGE_LABELS) as PlatformPageId[];
  const allocatable = pageIds.filter(
    (p) => !(OWNER_ONLY_PAGES as readonly string[]).includes(p),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.35)]">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-1">Team</h1>
            <p className="text-sm text-text-2">
              Platform members and the Command Center pages each one can see.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line-1 px-4 py-2 text-xs text-text-2 hover:bg-surface-2"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" /> New member
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Create form                                                  */}
      {/* ------------------------------------------------------------ */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-2xl border border-accent/40 bg-accent-soft/40 p-5"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-1">
            <ShieldCheck className="h-4 w-4 text-accent" /> New platform member
          </h2>
          <p className="mt-1 text-xs text-text-2">
            Owners cannot be minted here — the first owner is bootstrapped by SQL. Admin and Mod accounts are
            created with the password you type now; no email is sent, deliver it out-of-band.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Input
              label="Email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="colleague@resultapp.org"
              autoComplete="off"
              required
            />
            <Input
              label="Password (min 12 — a letter and a number)"
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              trailing={
                <PasswordToggle
                  label="new member password"
                  visible={showNewPassword}
                  onToggle={() => setShowNewPassword((v) => !v)}
                />
              }
            />
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-text-2">Role</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setNewRole(r.id)}
                  aria-pressed={newRole === r.id}
                  title={r.hint}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs",
                    newRole === r.id
                      ? "border-accent bg-accent-soft font-semibold text-accent"
                      : "border-line-1 text-text-2 hover:bg-surface-2",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-text-3">
              {ROLES.find((r) => r.id === newRole)?.hint}
              {newRole === "admin" && " — untick pages to trim the default."}
            </p>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-text-2">Pages this member can see</legend>
            <p className="mt-1 text-xs text-text-3">
              Empty = role defaults ({newRole === "admin" ? "everything except Team" : "nothing"}). Explicitly
              ticked pages REPLACE the defaults. Team is always owner-only.
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {allocatable.map((p) => {
                const inDefaults = roleDefaultPages(newRole).includes(p);
                const checked = allocated.includes(p);
                return (
                  <label
                    key={p}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                      checked
                        ? "border-accent bg-accent-soft text-accent"
                        : inDefaults
                          ? "border-line-1 text-text-2"
                          : "border-line-1 text-text-3",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePage(p)}
                      className="h-4 w-4 accent-purple-600"
                    />
                    {PLATFORM_PAGE_LABELS[p]}
                    {inDefaults && !checked && (
                      <span className="ml-auto text-[10px] text-text-3">default</span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={creating}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
              </>
            ) : (
              "Create member"
            )}
          </button>
        </form>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Member list                                                  */}
      {/* ------------------------------------------------------------ */}
      {loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-line-1 bg-surface-1 p-12 text-text-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading members…
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {members.map((m) => {
            const self = selfAdminId === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-2xl border border-line-1 bg-surface-1 p-5",
                  !m.is_active && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-text-1">
                      <span className="truncate">{m.email}</span>
                      {self && (
                        <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                          you
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-text-3">
                      Role:{" "}
                      <span className="font-medium text-text-2">
                        {m.role === "owner" ? "Owner" : m.role === "admin" ? "Admin" : "Mod"}
                      </span>{" "}
                      · joined {new Date(m.created_at).toLocaleDateString()} ·{" "}
                      {m.is_active ? "active" : "DISABLED"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPwTarget(m);
                        setPwValue("");
                      }}
                      disabled={busyId === m.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line-1 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 disabled:opacity-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Set password
                    </button>
                    {m.role !== "owner" && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void patch(
                              m,
                              { role: m.role === "admin" ? "support" : "admin" },
                              `Role changed for ${m.email}`,
                            )
                          }
                          disabled={busyId === m.id || self}
                          title={self ? "You cannot change your own role" : m.role === "admin" ? "Demote to Mod" : "Promote to Admin"}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line-1 px-3 py-1.5 text-xs text-text-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <UserCog className="h-3.5 w-3.5" />
                          {m.role === "admin" ? "Make Mod" : "Make Admin"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void patch(
                              m,
                              { is_active: !m.is_active },
                              m.is_active ? `Disabled ${m.email}` : `Re-enabled ${m.email}`,
                            )
                          }
                          disabled={busyId === m.id || self}
                          title={self ? "You cannot deactivate yourself" : undefined}
                          className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 px-3 py-1.5 text-xs text-danger hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <UserX className="h-3.5 w-3.5" />
                          {m.is_active ? "Deactivate" : "Re-activate"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Per-member allocation */}
                {m.role !== "owner" && (
                  <fieldset className="mt-4" disabled={busyId === m.id}>
                    <legend className="text-xs text-text-3">
                      Pages this member sees ({m.pages.length})
                    </legend>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {allocatable.map((p) => {
                        const on = m.pages.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => {
                              // Allocation math: an EMPTY explicit list means
                              // "role defaults" server-side, so stripping a
                              // default page has to materialise the defaults
                              // minus that page; adding to a default shell
                              // materialises defaults plus the page. Within an
                              // explicit list it is a plain add/remove. Team is
                              // filtered everywhere — owner-only pages cannot
                              // enter a non-owner's scope.
                              const defaults = roleDefaultPages(m.role);
                              const explicit = m.page_scope.filter((x) => x !== "team");
                              const next = on
                                ? explicit.length > 0
                                  ? explicit.filter((x) => x !== p)
                                  : defaults.filter((d) => d !== p)
                                : explicit.length > 0
                                  ? Array.from(new Set([...explicit, p]))
                                  : Array.from(new Set([...defaults, p]));
                              void patch(
                                m,
                                { pages: next.filter((x) => x !== "team") },
                                on
                                  ? `Removed ${PLATFORM_PAGE_LABELS[p]} from ${m.email}`
                                  : `Added ${PLATFORM_PAGE_LABELS[p]} to ${m.email}`,
                              );
                            }}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11px]",
                              on
                                ? "bg-accent text-accent-fg"
                                : "border border-line-1 text-text-3 hover:bg-surface-2 hover:text-text-2",
                            )}
                          >
                            {PLATFORM_PAGE_LABELS[p]}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Password modal */}
      {pwTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Set password for ${pwTarget.email}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPwTarget(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSetPassword();
            }}
            className="w-full max-w-md rounded-2xl bg-surface-1 p-6 shadow-2xl"
          >
            <h3 className="text-sm font-semibold text-text-1">Set password — {pwTarget.email}</h3>
            <p className="mt-1 text-xs text-text-2">
              Min 12 characters with a letter and a number. Nothing is emailed — deliver it to them directly.
            </p>
            <div className="mt-4">
              <Input
                label="New password"
                type={showPw ? "text" : "password"}
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                autoComplete="new-password"
                required
                trailing={
                  <PasswordToggle label="new password" visible={showPw} onToggle={() => setShowPw((v) => !v)} />
                }
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPwTarget(null)}
                className="rounded-full border border-line-1 px-4 py-2 text-xs text-text-2 hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pwBusy}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
              >
                {pwBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Set password
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
