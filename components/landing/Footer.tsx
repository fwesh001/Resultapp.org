import Link from "next/link";
import type { School } from "@/types/school";
import { toTitleCase } from "@/lib/format";

interface FooterProps {
  school: School;
  subdomain: string;
}

export default function Footer({ school, subdomain }: FooterProps) {
  const year = new Date().getFullYear();
  const location = [school.address, school.city, school.state]
    .filter(Boolean)
    .join(", ");

  return (
    <footer className="border-t border-purple-500/20 bg-[#0B0514]">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 p-8 md:grid-cols-4">
        {/* Col 1 — School info & contact */}
        <div>
          <h3 className="text-base font-semibold text-white">
            {toTitleCase(school.name)}
          </h3>
          <p className="mt-2 text-sm italic text-purple-300/80">
            {school.motto || "Academic excellence portal"}
          </p>
          <div className="mt-3 space-y-1.5 text-sm text-purple-200/70">
            <p>{location || "Address not provided"}</p>
            {school.phone ? (
              <p>
                <a href={`tel:${school.phone.replace(/\s+/g, "")}`} className="transition hover:text-white">
                  {school.phone}
                </a>
              </p>
            ) : (
              <p>Phone not provided</p>
            )}
            {school.email ? (
              <p>
                <a href={`mailto:${school.email}`} className="transition hover:text-white">
                  {school.email}
                </a>
              </p>
            ) : (
              <p>Email not provided</p>
            )}
          </div>
        </div>

        {/* Col 2 — Students */}
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-purple-200">
            Students
          </h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                href="#result-checker"
                className="inline-flex min-h-[44px] items-center text-purple-200/70 transition hover:text-white"
              >
                Result Checker
              </Link>
            </li>
          </ul>
        </div>

        {/* Col 3 — Staff & Faculty */}
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-purple-200">
            Staff &amp; Faculty
          </h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                href={`/${subdomain}/staff`}
                className="inline-flex min-h-[44px] items-center text-purple-200/70 transition hover:text-white"
              >
                Staff Portal
              </Link>
            </li>
          </ul>
        </div>

        {/* Col 4 — Administration */}
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-purple-200">
            Administration
          </h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                href={`/${subdomain}/admin/templates`}
                className="inline-flex min-h-[44px] items-center text-purple-200/70 transition hover:text-white"
              >
                Template Builder
              </Link>
            </li>
            <li>
              <Link
                href={`/${subdomain}/admin/billing`}
                className="inline-flex min-h-[44px] items-center text-purple-200/70 transition hover:text-white"
              >
                Billing
              </Link>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom sub-footer */}
      <div className="border-t border-purple-500/20">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-8 py-5 text-center text-xs text-purple-200/70 md:flex-row md:text-left">
          <p>
            © {year} {toTitleCase(school.name)}. All rights reserved.
          </p>
          <p>
            Powered by{" "}
            <a
              href="https://resultapp.org"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-purple-200 underline-offset-4 hover:text-white hover:underline"
            >
              ResultApp.org
            </a>{" "}
            • Academic Registry Portal
          </p>
          <p>
            built by{" "}
            <a
              href="https://zabdiel.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-purple-200 underline-offset-4 hover:text-white hover:underline"
            >
              ZABDIEL
            </a>
          </p>
        </div>

        {/* Legal links — platform-wide policies, not school-specific */}
        <nav
          aria-label="Legal"
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-purple-500/15 px-8 py-4 text-xs text-purple-200/60"
        >
          <Link
            href="/privacy"
            className="transition-colors hover:text-white"
          >
            Privacy Policy
          </Link>
          <span aria-hidden="true" className="text-purple-500/30">
            &middot;
          </span>
          <Link
            href="/terms"
            className="transition-colors hover:text-white"
          >
            Terms of Service
          </Link>
          <span aria-hidden="true" className="text-purple-500/30">
            &middot;
          </span>
          <Link
            href="/refund-policy"
            className="transition-colors hover:text-white"
          >
            Refund Policy
          </Link>
          <span aria-hidden="true" className="text-purple-500/30">
            &middot;
          </span>
          {/* Platform support desk — apex route, not tenant-scoped. */}
          <Link
            href="/support"
            className="transition-colors hover:text-white"
          >
            Support
          </Link>
        </nav>
      </div>
    </footer>
  );
}
