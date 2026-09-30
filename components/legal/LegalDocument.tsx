import type { LegalDocumentData } from "@/lib/legal/types";
import { PageHero } from "@/components/ui/PageHero";
import { LegalSection } from "@/components/legal/LegalSection";
import { LegalToc } from "@/components/legal/LegalToc";
import { LegalContactCard } from "@/components/legal/LegalContactCard";

interface LegalDocumentProps {
  document: LegalDocumentData;
}

/**
 * Shell shared by /privacy, /terms and /refund-policy.
 *
 * Renders the hero, the version strip, the plain-language "In short" summary
 * required of us by section 41(4) of the NDPA 2023, a scroll-spy table of
 * contents, and then the section payloads. All copy comes from
 * lib/legal/{privacy,terms,refund}.ts.
 */
export function LegalDocument({ document }: LegalDocumentProps) {
  const entries = document.sections.map((section) => ({
    id: section.id,
    // The heading already carries its own number ("5. Refunds"), so it is
    // used verbatim in the rail rather than re-numbered.
    label: section.heading,
  }));

  return (
    <div className="min-h-screen bg-[#0B0514] text-purple-50">
      <PageHero title={document.title} subtitle={document.subtitle} />

      {/* Version strip */}
      <div className="border-b border-purple-500/10">
        <div className="mx-auto max-w-6xl px-6">
          <p className="py-3 text-xs text-purple-300/50">
            Version {document.version} &middot; Effective {document.effectiveDate}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-10 md:py-14">
        <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
          {/* Table of contents */}
          <aside className="hidden lg:block">
            <div className="sticky top-8">
              <LegalToc entries={entries} />
            </div>
          </aside>

          {/* Body */}
          <div className="min-w-0">
            {document.summary.length > 0 && (
              <div className="rounded-2xl border border-purple-500/20 bg-purple-900/10 p-6 backdrop-blur">
                <h2 className="text-sm font-semibold text-white">In short</h2>
                <ul className="mt-4 space-y-3">
                  {document.summary.map((item, index) => (
                    <li key={index} className="flex gap-3 text-sm leading-6 text-purple-200/70">
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500"
                      />
                      <LegalEmphasis>{item}</LegalEmphasis>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-12 space-y-12">
              {document.sections.map((section) => (
                <LegalSection key={section.id} section={section} />
              ))}
            </div>

            <div className="mt-16">
              <LegalContactCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Summary bullets reuse the same `**bold**` convention as the section bodies,
 * so they are parsed here rather than duplicating the parser.
 */
function LegalEmphasis({ children }: { children: string }) {
  return (
    <>
      {children.split("**").map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-purple-100">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}
