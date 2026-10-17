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
    <div className="rounded-2xl border border-line-2 bg-surface-2 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/30">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-text-1">Contact and escalation</h2>
          <p className="text-xs text-text-3">
            Operated by {CONTROLLER_NAME} &middot; {CONTROLLER_LOCATION}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="flex gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-3">
              Email
            </dt>
            <dd className="mt-1 text-sm text-text-3">
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-accent underline decoration-accent/30 underline-offset-4 transition hover:text-text-1 hover:decoration-accent"
              >
                {SUPPORT_EMAIL}
              </a>
            </dd>
          </div>
        </div>

        <div className="flex gap-3">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-3">
              WhatsApp
            </dt>
            <dd className="mt-1 text-sm text-text-3">
              <a
                href={`https://wa.me/${SUPPORT_PHONE_TEL}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline decoration-accent/30 underline-offset-4 transition hover:text-text-1 hover:decoration-accent"
              >
                {SUPPORT_PHONE_DISPLAY}
              </a>
            </dd>
          </div>
        </div>

        <div className="flex gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-3">
              Hours
            </dt>
            <dd className="mt-1 text-sm text-text-3">{SUPPORT_HOURS}</dd>
          </div>
        </div>

        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-3">
              Regulator
            </dt>
            <dd className="mt-1 text-sm text-text-3">
              <a
                href={REGULATOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline decoration-accent/30 underline-offset-4 transition hover:text-text-1 hover:decoration-accent"
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
