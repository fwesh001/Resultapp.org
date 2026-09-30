import type { LegalDocumentData } from "./types";
import {
  CONTROLLER_NAME,
  CONTROLLER_LOCATION,
  EFFECTIVE_DATE,
  REFUND_VERSION,
  SUPPORT_EMAIL,
  SUPPORT_HOURS,
  SUPPORT_PHONE_DISPLAY,
} from "./constants";

/**
 * Single source of truth for the Refund Policy.
 *
 * Position locked with the product owner: strict final sale. There are no
 * guaranteed refund triggers. Section 4 lists circumstances in which we MAY
 * elect to issue a discretionary goodwill refund; it is deliberately worded
 * as a discretion and not an entitlement, because no automated refund path
 * exists in the billing implementation.
 *
 * Section 2 must stay aligned with section 7 of the Terms of Service and with
 * lib/pricing.ts. If the credit price, the slot tiers, or the trial grant
 * change, update both documents together.
 */
export const refundPolicy: LegalDocumentData = {
  slug: "refund-policy",
  title: "Refund Policy",
  subtitle:
    "How payments, Slots, and Credits are handled on ResultApp.org, and when a refund may be issued.",
  version: REFUND_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  description:
    "The ResultApp.org refund policy. All payments are final sale. Purchased Slots and Credits never expire, and any refund is issued at our discretion subject to the process and timescales set out here.",
  summary: [
    "**All payments are final sale.** Fees are non-refundable once paid.",
    "**We do not operate subscriptions.** There is no auto-renewal and no billing cycle. Paying simply stops when you stop buying.",
    "**Unused Slots and Credits never expire.** They are not forfeited at the end of a term or a school year, and are retained through suspension.",
    "**Consumed Credits are not recoverable.** A published report card is a permanent output, and reprints are free.",
    "Deleting a student from your roster **automatically returns one Slot of capacity** — capacity, not cash.",
    "Any refund is **discretionary and at our sole election**. There is no automatic refund mechanism.",
  ],
  sections: [
    {
      id: "scope",
      heading: "1. Scope of this policy",
      blocks: [
        {
          kind: "p",
          text: "This Refund Policy governs all payments made to " + CONTROLLER_NAME + " through the ResultApp.org platform, processed by our payment provider. It supplements the Terms of Service. Where the Terms of Service and this policy conflict, this policy governs matters of payment and refund.",
        },
        {
          kind: "p",
          text: "It applies to the purchase of Slots and Credits by a School, including the Slot purchase made during registration. It does not affect your statutory rights under the Consumer Protection Act 2023 or any other law of general application, which continue to apply.",
        },
      ],
    },
    {
      id: "how-billing-works",
      heading: "2. How our billing works",
      blocks: [
        {
          kind: "p",
          text: "This section matters, because it explains why our position on refunds is what it is.",
        },
        {
          kind: "p",
          text: "**2.1 We do not operate subscriptions.** ResultApp is not a subscription service. There is no recurring charge, no auto-renewal, no payment method stored on file for future debits, and no billing cycle. Nothing renews automatically. A School simply stops purchasing when it wants to stop. There is no subscription to cancel and no cancellation notice period.",
        },
        {
          kind: "p",
          text: "**2.2 Slots.** A Slot is a unit of roster capacity: one Slot permits one pupil to be added to the School's roster. Slots are consumed when a pupil is added, and one Slot is automatically returned when a pupil is removed. Slots are priced per unit on a tiered basis:",
        },
        {
          kind: "table",
          head: ["Quantity purchased", "Price per Slot"],
          rows: [
            ["Under 500", "₦100"],
            ["500 to 999", "₦90"],
            ["1,000 and above", "₦80"],
          ],
        },
        {
          kind: "p",
          text: "**2.3 Credits.** A Credit is a unit of publication capacity. One Credit is consumed each time a report card is published for a pupil. Entering scores, building and previewing templates, saving drafts, and re-printing a report card that has already been published consume no Credits. Credits are priced per unit at a flat rate published at the point of purchase.",
        },
        {
          kind: "p",
          text: "**2.4 Registration.** Registration is a one-off, paid purchase of Slots for the pupil numbers the School supplies, made before the portal is provisioned. We additionally grant free trial Credits to a new School, governed by section 10.",
        },
        {
          kind: "p",
          text: "**2.5 Nothing expires.** Purchased Slots and Credits remain available for as long as the School's account is in good standing. They do not expire at the end of a session, a school year, or a calendar year.",
        },
        {
          kind: "note",
          text: "**Why a consumed Credit cannot be returned.** A Credit is not an item held in storage. It is a permission to perform a unit of work: the compilation and publication of a report card. When a Credit is consumed, that work has been performed, the report card has been generated, and it has been made available to the School, to the pupil, and to any parent or guardian the School has made it available to. That output is permanent and cannot be un-performed, returned to stock, or recalled. This is also why re-printing an already-published report card is free — the School is not short-changed when a result needs to be reissued.",
        },
      ],
    },
    {
      id: "general-stance",
      heading: "3. General position",
      blocks: [
        {
          kind: "p",
          text: "**3.1 Final sale.** All payments are final sale and non-refundable. Once a payment has been made, the corresponding entitlement has been allocated to the School.",
        },
        {
          kind: "p",
          text: "**3.2 Unconsumed entitlements.** Unconsumed Credits and unused Slots cannot be converted into cash. They are not redeemable for a refund, a credit note, or any other monetary instrument. They do, however, never expire and are not forfeited by the passage of time, provided the School's account remains in good standing. Unused entitlements are therefore not a lost value.",
        },
        {
          kind: "p",
          text: "**3.3 Discretionary goodwill.** At our sole and absolute discretion we may issue free Credits or Slots as a goodwill gesture, or refund a payment where the circumstances in section 4 apply. **Nothing in this policy creates an entitlement to a refund, and we are not obliged to issue one in any circumstance.** A goodwill credit is a gesture, carries no cash value, and is not transferable or redeemable.",
        },
      ],
    },
    {
      id: "discretionary-refunds",
      heading: "4. Circumstances in which we may elect to refund",
      blocks: [
        {
          kind: "p",
          text: "The following are circumstances in which we **may, at our discretion**, issue a refund. They are not guarantees, and we reserve the right to decline in any case, for any reason.",
        },
        {
          kind: "ul",
          items: [
            "**Duplicate charge.** You were charged twice for the same purchase, and the duplicate has not been applied to your entitlements. We will normally identify and reverse this ourselves, but a refund may be issued where the duplication has already been settled.",
            "**Payment captured, portal not provisioned.** A payment was successfully taken but the School's portal was not created. This most commonly arises where the subdomain the School chose was claimed by another school between the School submitting the registration and the payment being verified, or where provisioning failed or timed out after the charge. In this situation we will normally either provision the portal manually or resolve the payment, and may alternatively refund.",
            "**Payment declined because the price changed.** A School completed a valid checkout at a price quoted to it, and the resulting payment was rejected because the price changed before verification. The School is not charged in that situation, and the payment is returned to its source.",
            "**A defect that blocks use.** A reproducible fault in the Platform prevents the School from consuming Slots or Credits it has paid for, and persists for a sustained period despite reasonable efforts to fix it. Remedy is at our election: a refund, or replacement Credits.",
            "**Payment received but nothing delivered.** A verified charge exists in our records with no corresponding entitlement and no record of the service having been used, and we are unable to resolve it another way.",
          ],
        },
        {
          kind: "note",
          text: "If a payment was taken and you believe the School has received nothing for it, contact us on the terms of section 7 as soon as possible. We would always rather resolve a genuine problem than rely on the general position in section 3.",
        },
      ],
    },
    {
      id: "non-refundable-cases",
      heading: "5. Cases where we will not refund",
      blocks: [
        {
          kind: "p",
          text: "The following are not refundable. The list is not exhaustive.",
        },
        {
          kind: "ul",
          items: [
            "**Change of mind.** A School that decides it no longer wants the Service, or changes its mind shortly after purchasing.",
            "**Over-purchasing Slots.** A School that buys capacity for a projected pupil intake that later does not materialise. Unused Slots never expire, so the capacity remains available for future intakes.",
            "**Failing to use Credits before a term or school year ends.** Credits do not expire, so unused Credits carry over indefinitely.",
            "**A pupil leaving the school.** Removing a pupil from the roster automatically returns one Slot of capacity under section 6.1. It does not return cash, and Credits already consumed on that pupil's published results are not returned.",
            "**Withdrawing, correcting, or reissuing a result.** Re-printing a report card that has already been published is free, so a School whose result needs correcting or republishing loses nothing. Where a School withdraws a result after publication, the Credit already consumed is not returned.",
            "**Suspension, deactivation, or closure of the School.** This includes loss of accreditation, loss of a licence, change of management or proprietor, change of school name, or the closure of the institution. Balances are retained through a suspension, and reinstating a portal restores them.",
            "**Failing to enter data or use features for reasons within the School's control**, including a decision not to compile results for a given term.",
            "**Third-party payment failure.** Incorrect PIN, an expired USSD authorisation code, an unconfirmed or reversed bank transfer, a failed direct debit mandate, or a dispute with the School's own bank.",
            "**Currency conversion loss.** Any difference between the Naira amount charged and the amount ultimately credited by the School's bank, including the School's bank's own charges.",
            "**A chargeback obtained after the service was delivered.** See section 8.",
            "**A request made long after the transaction**, beyond 30 days from the transaction date, except where the School did not receive the service it paid for.",
          ],
        },
      ],
    },
    {
      id: "non-cash-remedies",
      heading: "6. Non-cash remedies",
      blocks: [
        {
          kind: "p",
          text: "In most circumstances the practical remedy available to a School is a non-cash adjustment to its entitlements rather than a refund. These are automatic or discretionary and are always available.",
        },
        { kind: "h3", text: "6.1 Automatic Slot return" },
        {
          kind: "p",
          text: "When a pupil is removed from a School's roster, one Slot of capacity is automatically and immediately returned to the School's balance, and the movement is recorded in the billing ledger. This restores **capacity, not currency**: it is worth exactly the difference in future consumption, and it is not a refund of the amount originally paid for that Slot.",
        },
        { kind: "h3", text: "6.2 Discretionary Credit grants" },
        {
          kind: "p",
          text: "Our operators may grant free Credits or Slots to a School at any time as a goodwill gesture, for example in recognition of a fault, as a courtesy, or where a School has been inconvenienced. Every grant is recorded in the billing ledger so that it is visible to the School, and carries a value of ₦0 against the account. A grant is not a right and may be withdrawn only by revoking the portal.",
        },
        { kind: "h3", text: "6.3 Free reprints" },
        {
          kind: "p",
          text: "Re-printing a report card that has already been published consumes no Credit, and correcting and reissuing a result therefore has no Credit cost. If a School needs a result reissued, it should ask us rather than treat it as a credit matter.",
        },
        { kind: "h3", text: "6.4 Export and retention" },
        {
          kind: "p",
          text: "A School's Content remains available to it for export throughout any period of suspension and for 30 days following termination, under sections 8.2 and 8.6 of the Terms of Service.",
        },
      ],
    },
    {
      id: "how-to-request",
      heading: "7. How to request a refund",
      blocks: [
        {
          kind: "p",
          text: "All refund requests are handled by a person, not an automated system. Please contact us by email at " + SUPPORT_EMAIL + ", or on WhatsApp at " + SUPPORT_PHONE_DISPLAY + ".",
        },
        { kind: "h3", text: "7.1 What to include" },
        {
          kind: "p",
          text: "To act on a request we need the following. A request without the transaction reference cannot be located and is likely to be delayed:",
        },
        {
          kind: "ul",
          items: [
            "**Your Flutterwave transaction reference.** This is the reference issued by our payment provider, and appears in your payment confirmation. It is the only way we can identify your charge in our records.",
            "The School portal subdomain, for example yourschool.resultapp.org",
            "The administrator email address on the account",
            "The amount paid, in Nigerian Naira, and the date of the transaction",
            "The reason for the request",
            "Your preferred resolution: a refund to the original payment method, or Credits or Slots to your account.",
          ],
        },
        { kind: "h3", text: "7.2 Timescales" },
        {
          kind: "table",
          head: ["Stage", "Target"],
          rows: [
            ["Acknowledgement of your request", "Within 2 business days"],
            ["Decision on the request", "Within 10 business days"],
          ],
        },
        {
          kind: "p",
          text: "A **business day** for these purposes means a day on which our support team is available, which is " + SUPPORT_HOURS + ". A request sent over the weekend or outside those hours is treated as received on the next business day. We may ask for further information, which pauses the clock while we wait for your reply.",
        },
        { kind: "h3", text: "7.3 If a refund is approved" },
        {
          kind: "ul",
          items: [
            "The refund is issued to the **original payment method** via our payment provider. We cannot refund to a different account, a different card, or a bank account that was not the original source of payment.",
            "**Timing is set by your bank or card issuer,** not by us, and is typically between 3 and 10 business days from the point the refund is submitted. Please allow for this before raising a concern.",
            "A credit note identifying the transaction is issued to the administrator email address.",
            "Where a purchase was only partly delivered, a **partial refund** may be granted at our discretion, calculated proportionately to the undelivered portion. A partial refund does not reverse entitlements that have already been consumed.",
            "Where a payment was made in error and we refund the full amount, the School must return or destroy any entitlement it received in respect of that payment.",
          ],
        },
      ],
    },
    {
      id: "chargebacks",
      heading: "8. Chargebacks and payment disputes",
      blocks: [
        {
          kind: "p",
          text: "We ask that you raise a payment problem with us first, using the process in section 7. It is faster for you, and it lets us fix the underlying issue rather than merely reversing the money.",
        },
        {
          kind: "p",
          text: "We do not charge a fee for handling a dispute. While a chargeback or a disputed payment is open, we may suspend the affected portal or restrict new purchases, because the payment for those purchases is in question. **Raising a chargeback with your bank does not entitle you to keep the service you have already paid for.** A chargeback that is unmeritorious, or that is raised repeatedly after a matter has been resolved, is a ground for termination under section 8.3 of the Terms of Service, and any goodwill credit previously granted may be withdrawn.",
        },
      ],
    },
    {
      id: "currency-taxes",
      heading: "9. Currency, taxes, and payment method risk",
      blocks: [
        {
          kind: "p",
          text: "**9.1 Currency.** All prices are quoted and charged in Nigerian Naira (NGN). The volume discounts for Slot purchases at 500 and 1,000 units are fixed Naira amounts, not percentages, and do not vary with exchange rates.",
        },
        {
          kind: "p",
          text: "**9.2 Taxes.** Fees are exclusive of any applicable value added tax, withholding tax, or other levy, unless expressly stated on an invoice. The School is responsible for its own tax position, and a tax liability on the School's side is not a ground for a refund.",
        },
        {
          kind: "p",
          text: "**9.3 Payment method risk.** The School bears the risk associated with its chosen payment method, including failed USSD authorisations, unconfirmed or reversed bank transfers, insufficient funds, and its own bank's charges. Where a payment fails and is reversed by the payment provider, the School is not charged and no entitlement is deducted.",
        },
      ],
    },
    {
      id: "promotions",
      heading: "10. Promotions, trial Credits, and goodwill grants",
      blocks: [
        {
          kind: "p",
          text: "Free trial Credits granted on registration, promotional Credits, referral value, and any goodwill grant under section 6.2 are **not purchased goods**. They:",
        },
        {
          kind: "ul",
          items: [
            "carry a value of ₦0 against the account and are not counted as revenue;",
            "are not redeemable for cash, refund, credit note, or any other monetary instrument;",
            "are not transferable to another school, and are not exchangeable between Slots and Credits;",
            "are forfeited on misuse of the Service, on an unmeritorious chargeback, or on termination for cause under section 8.3 of the Terms of Service; and",
            "are provided at our discretion and may be discontinued or changed at any time without notice, though a grant already made available to a School is not withdrawn except on forfeiture.",
        ],
        },
        {
          kind: "p",
          text: "Because trial Credits are granted rather than purchased, the final-sale position in section 3 does not apply to them; nothing in this policy entitles a School to a refund in respect of a grant.",
        },
      ],
    },
    {
      id: "changes",
      heading: "11. Changes to this policy",
      blocks: [
        {
          kind: "p",
          text: "We may amend this policy from time to time. The version number and effective date appear at the top of this page. Changes take effect prospectively only. A change does not apply retrospectively, and a change to this policy does not reduce a balance already held, revoke a goodwill grant already made, or alter the basis on which a prior request was decided. We will notify Schools of a material change by email to the administrator address before it takes effect.",
        },
      ],
    },
    {
      id: "contact",
      heading: "12. Contact",
      blocks: [
        {
          kind: "p",
          text: `Questions about this policy, and refund requests, should be sent to ${SUPPORT_EMAIL} or raised on WhatsApp at ${SUPPORT_PHONE_DISPLAY}. Our support team is available ${SUPPORT_HOURS}. Postal correspondence may be directed to ${CONTROLLER_NAME}, ${CONTROLLER_LOCATION}.`,
        },
        {
          kind: "note",
          text: "Before you write, it is worth reading section 2. Because the Service is prepaid rather than subscription-based, most questions are answered by the explanation of how Slots and Credits work rather than by an exception to the general position.",
        },
      ],
    },
  ],
};
