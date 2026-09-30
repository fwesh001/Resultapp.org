import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal";
import { privacyPolicy } from "@/lib/legal/privacy";

export const metadata: Metadata = {
  title: `${privacyPolicy.title} — ResultApp`,
  description: privacyPolicy.description,
};

export default function PrivacyPage() {
  return <LegalDocument document={privacyPolicy} />;
}
