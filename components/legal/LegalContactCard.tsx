import { Mail, MessageCircle, MapPin, ShieldCheck } from "lucide-react";
import {
  CONTROLLER_LOCATION,
  CONTROLLER_NAME,
  REGULATOR_NAME,
  REGULATOR_SHORT,
  REGULATOR_URL,
  SUPPORT_EMAIL,
  SUPPORT_HOURS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_TEL,
} from "@/lib/legal/constants";

/**
 * Shared closing panel for the three legal documents: who to contact, on what
 * hours, and where to escalate. The content is identical everywhere, so it is
 * defined once here rather than repeated in the document payloads.
 */
export function LegalContactCard() {
  return (
    <div className="rounded-2xl border border-purple-500/20 bg-[#0F0A1E]/60 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/15 text-purple-300 ring-1 ring-purple-500/15">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Contact and escalation</h2>
          <p className="text-xs text-purple-200/50">
            Operated by {CONTROLLER_NAME} &middot; {CONTROLLER_LOCATION}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="flex gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-purple-400/70" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-purple-300/70">
              Email
            </dt>
            <dd className="mt-1 text-sm text-purple-200/65">
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-purple-300 underline decoration-purple-500/30 underline-offset-4 transition hover:text-white hover:decoration-purple-400"
              >
                {SUPPORT_EMAIL}
              </a>
            </dd>
          </div>
        </div>

        <div className="flex gap-3">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-purple-400/70" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-purple-300/70">
              WhatsApp
            </dt>
            <dd className="mt-1 text-sm text-purple-200/65">
              <a
                href={`https://wa.me/${SUPPORT_PHONE_TEL}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-300 underline decoration-purple-500/30 underline-offset-4 transition hover:text-white hover:decoration-purple-400"
              >
                {SUPPORT_PHONE_DISPLAY}
              </a>
            </dd>
          </div>
        </div>

        <div className="flex gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-purple-400/70" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-purple-300/70">
              Hours
            </dt>
            <dd className="mt-1 text-sm text-purple-200/65">{SUPPORT_HOURS}</dd>
          </div>
        </div>

        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-purple-400/70" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-purple-300/70">
              Regulator
            </dt>
            <dd className="mt-1 text-sm text-purple-200/65">
              <a
                href={REGULATOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-300 underline decoration-purple-500/30 underline-offset-4 transition hover:text-white hover:decoration-purple-400"
              >
                {REGULATOR_SHORT}
              </a>{" "}
              &mdash; {REGULATOR_NAME}
            </dd>
          </div>
        </div>
      </dl>
    </div>
  );
}
