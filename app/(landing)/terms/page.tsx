import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal";
import { termsOfService } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: `${termsOfService.title} — ResultApp`,
  description: termsOfService.description,
};

export default function TermsPage() {
  return <LegalDocument document={termsOfService} />;
}
