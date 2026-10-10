"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, PenLine, Save, UserCircle } from "lucide-react";
import { toast } from "@/components/ui/toast";
import UploadField from "@/components/ui/UploadField";
import SignatureCaptureModal from "@/components/ui/SignatureCaptureModal";

interface HubStaff {
  id: string;
  staff_id: string;
  full_name: string;
  email?: string | null;
  role?: string | null;
  signature_url?: string | null;
  /** Drawn signature (base64 PNG data URI). Wins over signature_url. */
  signature_data?: string | null;
}

interface HubData {
  staff?: HubStaff | null;
  form_classes?: Array<{ class_name: string }>;
  error?: string;
}

/**
 * Staff self-service profile — signature only (phone/email stay
 * admin-managed to avoid data conflicts). Reads identity + current
 * signature from the existing hub endpoint; uploads go to
 * /api/staff/uploads (PNG/JPG ≤1MB); saving PATCHes /api/staff/profile,
 * which enforces self-only edits via staff_session.
 */
export default function StaffProfilePage() {
  const params = useParams<{ subdomain: string }>();
  const tenantId = (params.subdomain || "").toLowerCase().trim();

  const [staff, setStaff] = useState<HubStaff | null>(null);
  const [formClasses, setFormClasses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState("");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ tenant_id: tenantId });
      const res = await fetch(`/api/staff/grading?${qs.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as HubData;
      if (!res.ok) throw new Error(data.error || `Failed to load profile (${res.status})`);
      if (!data.staff) throw new Error("Signed-in staff record not found");
      setStaff(data.staff);
      setFormClasses((data.form_classes || []).map((f) => f.class_name).filter(Boolean));
      setSignatureUrl(data.staff.signature_url?.trim() || "");
      setSignatureData(data.staff.signature_data?.trim() || null);
    } catch (err) {
      setStaff(null);
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  async function persistSignature(body: Record<string, string | null>, successMessage: string) {
    const res = await fetch("/api/staff/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, ...body }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      staff?: HubStaff;
    };
    if (!res.ok || payload.success === false) {
      throw new Error(payload.error || `Save failed (${res.status})`);
    }
    if (payload.staff) setStaff(payload.staff);
    toast.success(successMessage);
  }

  // URL upload path: staged by UploadField, applied here (two steps, as before).
  async function handleSave() {
    setSaving(true);
    try {
      await persistSignature({ signature_url: signatureUrl.trim() }, "Signature saved");
    } catch (err) {
      toast.error("Could not save signature", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  }

  // Drawn path: one step. Saves immediately on modal confirm, because a canvas
  // has no "staged" state to reconcile and forcing a second Save step would
  // invite the teacher to draw and then leave without applying it.
  async function handleDrawnSave(dataUri: string) {
    setSaving(true);
    try {
      await persistSignature({ signature_data: dataUri }, "Signature saved");
      setSignatureData(dataUri);
      setSignatureUrl("");
    } catch (err) {
      toast.error("Could not save signature", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDrawnRemove() {
    setSaving(true);
    try {
      // "" is the clear signal, NOT null -- see the note in the proxy: null is
      // indistinguishable from an absent key. Blank becomes SQL NULL and, per
      // the single-signature rule, clears the uploaded URL too.
      await persistSignature({ signature_data: "" }, "Signature removed");
      setSignatureData(null);
      setSignatureUrl("");
    } catch (err) {
      toast.error("Could not remove signature", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  }

  // Clear the UPLOADED signature. This one must persist immediately rather than
  // stage a URL change for the Save button: leaving a signature in place with a
  // label promising it was removed is worse than the extra round trip, and the
  // drawn path already behaves this way.
  async function handleUrlRemove() {
    setSaving(true);
    try {
      await persistSignature({ signature_url: "" }, "Signature removed");
      setSignatureUrl("");
      setSignatureData(null);
    } catch (err) {
      toast.error("Could not remove signature", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  }

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
              Draw it below, or upload a PNG/JPG. Shown on report cards instead of your typed name.
            </p>

            {/* Drawn signature is the primary path and saves in one step. */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-500/20 bg-purple-900/20 p-4">
              <div className="min-w-0 text-xs text-purple-300/60">
                {signatureData
                  ? "Using your drawn signature."
                  : signatureUrl
                    ? "Using the uploaded image below."
                    : "No signature set — your typed name will be used."}
              </div>
              <button
                type="button"
                onClick={() => setSigModalOpen(true)}
                disabled={saving}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-50"
              >
                <PenLine className="h-4 w-4" aria-hidden="true" />
                {signatureData ? "Redraw signature" : "Draw signature"}
              </button>
            </div>

            {signatureData && (
              <div className="mt-3 flex h-20 items-end rounded-lg border border-purple-500/20 bg-white p-2">
                {/* Preview of the saved drawing. eslint-disable: a data URI
                    cannot go through next/image without a loader. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signatureData}
                  alt="Your saved signature preview"
                  className="h-12 object-contain object-left"
                />
              </div>
            )}

            <div className="mt-4">
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
              Save uploaded image
            </button>
            {signatureUrl.trim() !== "" && (
              <button
                type="button"
                onClick={() => void handleUrlRemove()}
                disabled={saving}
                className="ml-2 inline-flex min-h-[44px] items-center rounded-full border border-red-500/20 px-5 py-2.5 text-sm text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        </>
      ) : null}

      <SignatureCaptureModal
        open={sigModalOpen}
        onOpenChange={setSigModalOpen}
        signerLabel="Class Teacher"
        currentSignature={signatureData || signatureUrl || null}
        onSave={handleDrawnSave}
        onRemove={handleDrawnRemove}
      />
    </div>
  );
}
