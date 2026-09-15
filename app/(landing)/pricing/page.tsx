import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

const plans = [
  {
    name: "Pay As You Go",
    price: "₦150",
    unit: "/ student / term",
    features: [
      "Upload up to 50 students at once",
      "Broadsheet & report card generation",
      "PDF export & printing",
      "Credits never expire",
      "Email support",
    ],
    cta: "Get Started",
    popular: true,
  },
  {
    name: "Bulk Discount",
    price: "₦120",
    unit: "/ student / term (500+ students)",
    features: [
      "Everything in Pay As You Go",
      "Priority WhatsApp support",
      "Dedicated onboarding call",
      "Custom school branding on reports",
      "API access (coming soon)",
    ],
    cta: "Contact Sales",
    popular: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "for school chains & LGAs",
    features: [
      "Volume pricing for 2000+ students",
      "Multi-school admin portal",
      "SSO & custom domain",
      "On-premise deployment option",
      "SLA & dedicated manager",
    ],
    cta: "Talk to us",
    popular: false,
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight">Simple, transparent pricing</h1>
        <p className="mt-4 text-lg text-zinc-600">
          Pay only for the students you process. No hidden fees, no subscriptions.
          Credits roll over forever.
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`relative flex flex-col rounded-2xl border bg-white p-8 shadow-sm ${
              plan.popular ? "border-blue-600 ring-1 ring-blue-600" : ""
            }`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white">
                Most Popular
              </span>
            )}
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="text-sm text-zinc-500">{plan.unit}</span>
            </div>
            <ul className="mt-6 flex-1 space-y-3">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2 text-sm">
                  <Check className="h-5 w-5 shrink-0 text-green-600" />
                  <span className="text-zinc-700">{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/register" className="mt-8">
              <Button
                className="w-full"
                variant={plan.popular ? "default" : "outline"}
              >
                {plan.cta}
              </Button>
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-sm text-zinc-500">
        Need a custom quote? Email us at{" "}
        <a href="mailto:support@resultapp.org" className="font-medium text-blue-600">
          support@resultapp.org
        </a>
      </p>
    </div>
  );
}
