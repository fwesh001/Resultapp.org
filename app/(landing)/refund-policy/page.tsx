import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal";
import { refundPolicy } from "@/lib/legal/refund";

export const metadata: Metadata = {
  title: `${refundPolicy.title} — ResultApp`,
  description: refundPolicy.description,
};

export default function RefundPolicyPage() {
  return <LegalDocument document={refundPolicy} />;
}
