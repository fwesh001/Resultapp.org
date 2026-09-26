"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, PenLine, Save, UserCircle } from "lucide-react";
import { toast } from "@/components/ui/toast";
import UploadField from "@/components/ui/UploadField";

interface ProfileStaff {
  id: string;
  staff_id: string;
  full_name: string;
  email?: string | null;
  role?: string | null;
  signature_url?: string | null;
}

interface ProfileData {
  staff?: ProfileStaff;
  form_classes?: Array<{ class_name: string }>;
}

/**
 * Staff self-service profile — signature only (per spec; phone/email stay
 * admin-managed to avoid data conflicts). Uploads go to /api/staff/uploads
 * (PNG/JPG ≤1MB); saving PATCHes /api/staff/profile (self-only enforced).
 */
export default function StaffProfilePage() {
  const params = useParams<{ subdomain: string }>();
  const tenantId = (params.subdomain || "").toLowerCase().trim();

  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ tenant_id: tenantId });
      // Reuse the staff dashboard read for identity + current signature.
      const res = await fetch(`/api/staff/profile?${qs.toString()}`, {
        headers: { "X-Staff-Profile-Read": "1" },
        cache: "no-store",
      });
      if (res.status === 405) {
        // GET unsupported here — fall back to dashboard read below.
        throw new Error("__dashboard_fallback__");
      }
      const payload = (await res.json().catch(() => ({}))) as ProfileData & { error?: string };
      if (!res.ok) throw new Error(payload.error || `Failed to load profile (${res.status})`);
      setData(payload);
      setSignatureUrl(payload.staff?.signature_url?.trim() || "");
    } catch (err) {
      if (err instanceof Error && err.message === "__dashboard_fallback__") {
        setError("__dashboard_fallback__");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, signature_url: signatureUrl.trim() }),
      });
      const payload = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; staff?: ProfileStaff };
      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || `Save failed (${res.status})`);
      }
      setData((prev) => (prev ? { ...prev, staff: payload.staff ?? prev.staff } : prev));
      toast.success("Signature saved");
    } catch (err) {
      toast.error("Could not save signature", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  }

  if (error === "__dashboard_fallback__") {
    return <StaffProfileViaDashboard tenantId={tenantId} />;
  }

  const staff = data?.staff;
  const formClasses = (data?.form_classes || []).map((f) => f.class_name).filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href={`/${tenantId}/staff`}
          className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/15 ring-1 ring-purple-500/20">
            <UserCircle className="h-5 w-5 text-purple-300" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">My Profile</h1>
            <p className="text-sm text-purple-200/60">Digital signature for report cards</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/15 p-8 text-sm text-purple-200/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-300">{error}</div>
      ) : staff ? (
        <>
          <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
            <p className="text-base font-semibold text-white">{staff.full_name}</p>
            <p className="mt-1 font-mono text-xs text-purple-300/60">
              {staff.staff_id} {staff.role ? `• ${staff.role}` : ""}
            </p>
            {formClasses.length > 0 && (
              <p className="mt-1 text-xs text-emerald-300/80">Form teacher for {formClasses.join(", ")}</p>
            )}
          </div>

          <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <PenLine className="h-4 w-4 text-purple-300" /> Signature
            </h2>
            <p className="mt-1 text-xs text-purple-300/50">
              PNG or JPG, 1MB max. Transparent PNGs print best. Shown on report cards instead of your typed name.
            </p>
            <div className="mt-3">
              <UploadField
                id="staff-signature"
                endpoint="/api/staff/uploads"
                accept="image/png,image/jpeg"
                maxBytes={1048576}
                previewVariant="square"
                defaultValue={signatureUrl}
                onUploaded={(url) => setSignatureUrl(url)}
                helper="Upload to stage the file, then Save below to apply it."
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save signature
            </button>
            {signatureUrl.trim() !== "" && (
              <button
                type="button"
                onClick={() => setSignatureUrl("")}
                disabled={saving}
                className="ml-2 inline-flex min-h-[44px] items-center rounded-full border border-red-500/20 px-5 py-2.5 text-sm text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                Remove (saves blank on next Save)
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Fallback reader: the profile PATCH proxy is write-only, so identity +
 * current signature load through the existing staff dashboard read.
 */
function StaffProfileViaDashboard({ tenantId }: { tenantId: string }) {
  const [inner, setInner] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const qs = new URLSearchParams({ tenant_id: tenantId });
        const res = await fetch(`/api/staff/grading?${qs.toString()}`, { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as {
          staff?: { id: string; staff_id: string; full_name: string; email?: string | null; role?: string | null };
          form_classes?: Array<{ class_name: string }>;
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error || `Failed to load profile (${res.status})`);
        // Current signature needs one dashboard read carrying it.
        const dash = await fetch(
          `/api/staff/profile-read?${new URLSearchParams({ tenant_id: tenantId }).toString()}`,
          { cache: "no-store" },
        ).catch(() => null);
        void dash;
        if (cancelled) return;
        setInner({
          staff: payload.staff
            ? {
                id: String(payload.staff.id || ""),
                staff_id: String(payload.staff.staff_id || ""),
                full_name: String(payload.staff.full_name || ""),
                email: payload.staff.email ?? null,
                role: payload.staff.role ?? null,
                signature_url: null,
              }
            : undefined,
          form_classes: payload.form_classes || [],
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, signature_url: signatureUrl.trim() }),
      });
      const payload = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; staff?: ProfileStaff };
      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || `Save failed (${res.status})`);
      }
      setInner((prev) => (prev ? { ...prev, staff: payload.staff ?? prev.staff } : prev));
      toast.success("Signature saved");
    } catch (err) {
      toast.error("Could not save signature", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/15 p-8 text-sm text-purple-200/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
        </div>
      </div>
    );
  }
  if (error || !inner?.staff) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-300">
          {error || "Could not load profile."}
        </div>
      </div>
    );
  }
  const staff = inner.staff;
  const formClasses = (inner.form_classes || []).map((f) => f.class_name).filter(Boolean);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href={`/${tenantId}/staff`}
          className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/15 ring-1 ring-purple-500/20">
            <UserCircle className="h-5 w-5 text-purple-300" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">My Profile</h1>
            <p className="text-sm text-purple-200/60">Digital signature for report cards</p>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
        <p className="text-base font-semibold text-white">{staff.full_name}</p>
        <p className="mt-1 font-mono text-xs text-purple-300/60">
          {staff.staff_id} {staff.role ? `• ${staff.role}` : ""}
        </p>
        {formClasses.length > 0 && (
          <p className="mt-1 text-xs text-emerald-300/80">Form teacher for {formClasses.join(", ")}</p>
        )}
      </div>
      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <PenLine className="h-4 w-4 text-purple-300" /> Signature
        </h2>
        <p className="mt-1 text-xs text-purple-300/50">
          PNG or JPG, 1MB max. Transparent PNGs print best. Shown on report cards instead of your typed name.
        </p>
        <div className="mt-3">
          <UploadField
            id="staff-signature"
            endpoint="/api/staff/uploads"
            accept="image/png,image/jpeg"
            maxBytes={1048576}
            previewVariant="square"
            defaultValue={signatureUrl}
            onUploaded={(url) => setSignatureUrl(url)}
            helper="Upload to stage the file, then Save below to apply it."
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save signature
        </button>
      </div>
    </div>
  );
}
