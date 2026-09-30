import type { LegalDocumentData } from "./types";
import {
  CONTROLLER_LOCATION,
  CONTROLLER_NAME,
  EFFECTIVE_DATE,
  GOVERNING_LAW,
  JURISDICTION,
  SUPPORT_EMAIL,
  SUPPORT_HOURS,
  SUPPORT_PHONE_DISPLAY,
  TERMS_VERSION,
  TRADING_NAME,
} from "./constants";

/**
 * Single source of truth for the Terms of Service.
 *
 * Positions locked with the product owner and reflected here:
 *  - Billing is prepaid credit, not a subscription (see section 7).
 *  - 99.9% availability is an objective, not a contractual SLA (section 9.1).
 *  - Aggregate liability is capped at the greater of fees paid in the
 *    preceding 12 months or NGN 50,000, with carve-outs in section 15.3.
 *  - Exclusive forum is the Federal High Court sitting in Abuja (section 17).
 */
export const termsOfService: LegalDocumentData = {
  slug: "terms",
  title: "Terms of Service",
  subtitle:
    "The agreement between your school and Zabdiel Tech for use of the ResultApp.org platform.",
  version: TERMS_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  description:
    "The terms governing use of ResultApp.org by Nigerian schools: account responsibilities, acceptable use, prepaid credits, termination, service availability, and limitation of liability under Nigerian law.",
  summary: [
    "These terms bind the **school**, and must be accepted by someone authorised to bind it.",
    "**Your school is responsible for the accuracy of every score, rating, and remark entered into the platform.** We do not validate academic content.",
    "**Your school must have lawful authority** to process each pupil's data, including any parental or guardian consent required by law.",
    "There is **no subscription and no lock-in.** Payment is prepaid, one-off, and credits never expire.",
    "**No uptime commitment.** 99.9% is a target; no service credits are owed for downtime.",
    "Liability is capped at the greater of **fees paid in the last 12 months or ₦50,000**, with carve-outs for fraud, wilful misconduct, and data-protection liability.",
  ],
  sections: [
    {
      id: "agreement",
      heading: "1. Agreement to these terms",
      blocks: [
        {
          kind: "p",
          text: `These Terms of Service (the "Terms") form a binding agreement between ${CONTROLLER_NAME} ("ResultApp", "we", "us") and the school registering for a ResultApp.org portal (the "School"). They govern the School's use of the Platform, including the School Administrator's and all Authorised Users' access to it.`,
        },
        {
          kind: "p",
          text: "By registering a School and proceeding through the registration or payment flow, the person doing so confirms that they are an employee, officer, proprietor, or authorised representative of the School and that they have full authority to accept these Terms on the School's behalf. A School that does not have authority to accept these Terms must not use the Platform.",
        },
        {
          kind: "p",
          text: "These Terms should be read together with our Privacy Policy and our Refund Policy, which form part of this agreement and are available at the legal links in the site footer. Where these Terms and the Refund Policy conflict, the Refund Policy governs matters of payment and refund.",
        },
        {
          kind: "p",
          text: "These Terms apply from the effective date shown at the top of this page and continue until terminated under section 8.",
        },
      ],
    },
    {
      id: "definitions",
      heading: "2. Definitions",
      blocks: [
        {
          kind: "ul",
          items: [
            "**Platform** — the ResultApp.org software application, including each School's dedicated portal subdomain and the public result checker.",
            "**Service** — the functionality we make available on the Platform, as described in section 3.",
            "**School** — the educational institution that has registered for a portal.",
            "**School Administrator** — the individual holding the administrator account, who manages staff, rosters, subjects, templates, billing, and publication.",
            "**Authorised User** — any individual the School has given portal access to, including teachers and form masters.",
            "**Student Data** — any personal data relating to a pupil of the School, entered into or processed through the Platform.",
            "**Content** — everything the School or its Authorised Users enter into, upload to, or publish through the Platform, including rosters, scores, assessments, remarks, templates, branding, and signature images.",
            "**Slot** — a unit of roster capacity, permitting one pupil to be added to the School's roster. See section 7.1.",
            "**Credit** — a unit of publication capacity, permitting one report card to be published. See section 7.2.",
            "**Charges** — the amounts payable for Slots and Credits.",
            "**Fees** — the Charges paid by the School under section 7, excluding taxes.",
            "**Subdomain** — the portal address in the form yourschool.resultapp.org.",
          ],
        },
      ],
    },
    {
      id: "the-service",
      heading: "3. The Service",
      blocks: [
        {
          kind: "p",
          text: "The Service consists of:",
        },
        {
          kind: "ul",
          items: [
            "provisioning of a dedicated portal on a School-specific subdomain",
            "staff accounts and a grading workspace for entering scores, assessments, and remarks",
            "configuration of subjects, classes, staff allocations, and grading templates",
            "calculation of totals and generation of printable report cards",
            "publication of results, and a public result checker where the School enables it",
            "in-platform notifications, including low-balance and provisioning notices",
            "purchase and administration of Slots and Credits, and a viewable billing ledger",
            "support by email and WhatsApp during the hours in section 9.4",
          ],
        },
        {
          kind: "p",
          text: "**The Service is provided as described and no more.** We may add, change, or withdraw functionality. Anything not listed above — including examination registration, candidate registration with external awarding bodies, student enrolment, fee collection, payroll, and any integration with a school's internal systems — is outside the scope of the Service unless we have agreed otherwise in writing.",
        },
        {
          kind: "note",
          text: "The Platform is a compilation and publication tool. It is not an examination body, an awarding institution, or a regulator, and use of the Platform does not make a result official, certified, or accepted by any external body. The School is solely responsible for determining that the Platform satisfies its own regulatory and accreditation requirements before relying on it.",
        },
      ],
    },
    {
      id: "eligibility",
      heading: "4. Eligibility and registration",
      blocks: [
        {
          kind: "ul",
          items: [
            "The Service is available to schools. The individual registering confirms they are authorised to act for the School.",
            "The School is responsible for the accuracy of the registration details it supplies, and must keep its administrator email address current. Legal notices to the School are validly served at the administrator email address recorded in the platform until that address is changed.",
            "One School may hold one portal. The School chooses its Subdomain, which must be available and must not impersonate another School, an individual, or any other party.",
            "The School must not register in order to circumvent the Charges, or to obtain a portal it is not entitled to use.",
            "We may decline or withdraw a registration where we reasonably believe it is fraudulent, abusive, or infringes the rights of another party.",
          ],
        },
      ],
    },
    {
      id: "responsibilities",
      heading: "5. Roles and responsibilities",
      blocks: [
        {
          kind: "p",
          text: "**5.1 School Administrator.** The Administrator is responsible for managing staff accounts and role assignments, maintaining the roster, configuring subjects and allocations, maintaining grading templates, managing billing, and deciding when results are published.",
        },
        {
          kind: "p",
          text: "**5.2 Authorised Users.** Authorised Users are responsible for the accuracy and timeliness of the Content they enter and for handling the data they are given access to in accordance with the School's own policies and applicable data protection law.",
        },
        {
          kind: "p",
          text: "**5.3 Accuracy of grades and records.** This is the School's central obligation under the Service. The School is **solely responsible** for the accuracy, completeness, and timeliness of every score, total, behavioural rating, grade band, remark, and piece of Content entered into the Platform. A published report card reproduces what the School's staff entered. We do not validate, audit, verify, moderate, correct, or sanity-check academic content, and we give no assurance as to its accuracy. Where an error originates in Content entered by the School or its Authorised Users, the School is responsible for correcting it and for any consequences of it, including reissuing results to students and parents.",
        },
        {
          kind: "p",
          text: "**5.4 Lawful collection and parental consent.** The School is solely responsible for having a lawful basis to process each pupil's data under the Nigeria Data Protection Act 2023 and the Nigeria Data Protection Regulations 2023, including obtaining any consent from a parent or guardian that Nigerian law requires in the School's circumstances. The School is also responsible for informing students and parents about the data it collects, the purposes it uses it for, and the fact that results will be published. The School warrants that it holds all rights, permissions, and authority necessary to enter the Content it uploads and to publish the results it publishes.",
        },
        {
          kind: "p",
          text: "**5.5 Account security.** The School is responsible for the security of its accounts and for all activity under them. In particular:",
        },
        {
          kind: "ul",
          items: [
            "The School must change any default or initial password or PIN issued to a staff account before the account is used, and must ensure each member of staff holds an individual account rather than a shared one.",
            "The School must not share account credentials, and must not permit an Authorised User to work under another person's account.",
            "The School must sign out, and change the affected password, at any time it suspects that a credential or a session has been exposed, and should do so before reporting it to us. Contacting us first does not suspend or end a session.",
            "Every portal session expires **12 hours after it is created**. That limit is fixed: it is not extended by activity, it is not reset by signing in elsewhere, and it cannot be paused. **We do not currently provide a means to revoke an individual session before it expires.** We may terminate the School's access as a whole under section 8, and we invalidate all sessions automatically whenever our signing key is rotated, but we cannot end one session while leaving the account usable.",
            "A session is a signed, tamper-proof token that cannot be edited or fabricated, so a School's access to another School's portal or data cannot be obtained by altering a session. The School should still not rely on a session remaining open, and must not leave a portal open on a shared or public device.",
            "The School is responsible for ensuring that the devices its staff use are appropriately secured.",
          ],
        },
        {
          kind: "p",
          text: "**5.6 Authorisation and visibility.** The School controls which individuals are given access and what role they hold. We do not verify a School's internal authorisation decisions, and we are not responsible for the School's failure to remove access from a former staff member or leaver.",
        },
        {
          kind: "p",
          text: "**5.7 Communications to students and parents.** The School is responsible for all notices, explanations, and communications given to students and parents in connection with the Platform and with the results it publishes, including the method and timing of result notification. We publish only what the School instructs us to publish.",
        },
      ],
    },
    {
      id: "acceptable-use",
      heading: "6. Acceptable use",
      blocks: [
        {
          kind: "p",
          text: "The School must not, and must not permit any Authorised User to:",
        },
        {
          kind: "ul",
          items: [
            "use the Platform for any unlawful purpose, or upload Content that is unlawful, infringing, defamatory, or otherwise objectionable;",
            "enter or upload Student Data or any other personal data the School has no right to process, or for which it has not obtained any consent that Nigerian law requires;",
            "access, attempt to access, or probe any portal other than the School's own, including any other School's portal or our internal administration tooling;",
            "use the public result checker to enumerate, harvest, or compile student records beyond what the School has deliberately published;",
            "share, resell, sublicense, or provide access to the Service to any third party, or permit use by an individual who is not an Authorised User of the School;",
            "circumvent, manipulate, or attempt to circumvent the Slot or Credit metering, the limits in these Terms, or any suspension;",
            "reverse engineer, decompile, disassemble, or attempt to derive the source code of the Platform, or probe it for vulnerabilities outside our published disclosure process;",
            "scrape, crawl, or make automated requests against the Platform other than as a registered portal user acting in the ordinary course;",
            "upload malicious code, or any file that could harm the Platform or another user, or attempt to exploit the upload functionality;",
            "use Student Data for commercial exploitation, advertising, profiling, surveillance of staff, or for any purpose other than the School's own academic administration;",
            "transmit or publish content that is likely to cause offence or distress to a student, parent, or member of staff;",
            "harass, abuse, or impersonate our personnel, or use the support channels to send unsolicited commercial communications;",
            "misrepresent the School's identity or status, or impersonate another school or individual; or",
            "breach these Terms, the Acceptable Use Policy summary above, or any applicable law.",
        ],
        },
        {
          kind: "p",
          text: "Breach of this section is a material breach. It may lead to immediate suspension or termination under section 8, at our sole discretion and without refund except as provided in the Refund Policy.",
        },
      ],
    },
    {
      id: "fees",
      heading: "7. Fees, Slots, and Credits",
      blocks: [
        {
          kind: "p",
          text: "**7.1 Slots.** A Slot is a unit of roster capacity. One Slot permits one pupil to be added to the School's roster. Slots are consumed when a pupil is added. Removing a pupil from the roster automatically returns one Slot of capacity to the School. Slots are priced on a per-unit tiered basis:",
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
          text: "**7.2 Credits.** A Credit is a unit of publication capacity. One Credit is consumed each time a report card is published for a pupil. Entering scores, building and previewing templates, saving drafts, and re-printing a report card that has already been published are all free and consume no Credits. Credits are priced per unit at a flat rate published at the point of purchase.",
        },
        {
          kind: "p",
          text: "**7.3 No subscription, no auto-renewal.** The Service operates on prepaid Credits and Slots. **There is no recurring charge, no auto-renewal, no payment method stored for future debits, and no billing cycle.** Nothing renews automatically. The School simply stops purchasing when it wants to stop. There is no subscription to cancel and no cancellation notice period.",
        },
        {
          kind: "p",
          text: "**7.4 Credits and Slots do not expire.** Purchased Credits and Slots remain available to the School for as long as its account is in good standing. They do not expire at the end of an academic session, a school year, or a calendar year, and they do not lapse if the School does not use them in a given term.",
        },
        {
          kind: "p",
          text: "**7.5 Registration purchase and trial Credits.** Registration is a one-off, paid purchase of Slots for the pupil numbers the School supplies, made before the portal is provisioned. We additionally grant free trial Credits to a new School. Trial Credits are a promotional grant under section 10 of the Refund Policy and carry no cash value.",
        },
        {
          kind: "p",
          text: "**7.6 Price changes.** Prices for Slots and Credits may change. A change applies prospectively and does not reduce a balance already held. Where a School completes a checkout at a quoted price and we decline the resulting payment because the price changed before verification, the School is not charged and the Refund Policy applies.",
        },
        {
          kind: "p",
          text: "**7.7 Payment processing.** Payments are processed by our payment processor through its own secure checkout. We do not receive or store card numbers, expiry dates, or security codes. The School is responsible for using a valid and available payment method, and bears all costs, charges, and consequences associated with it, including bank charges and any loss arising from foreign currency conversion applied by its own bank.",
        },
        {
          kind: "p",
          text: "**7.8 Taxes.** Fees are exclusive of any applicable value added tax, withholding tax, or other levy, unless expressly stated on an invoice. The School is responsible for its own tax position in respect of the Service.",
        },
        {
          kind: "p",
          text: "**7.9 Disputed Charges.** The School must notify us in writing of any disputed Charge within 15 days of the transaction date. Charges not disputed within that period are payable. Raising a dispute does not suspend the School's obligation to pay other undisputed Charges.",
        },
        {
          kind: "p",
          text: "**7.10 Refunds.** Fees are non-refundable except as expressly set out in the Refund Policy, which is incorporated into these Terms.",
        },
      ],
    },
    {
      id: "term-termination",
      heading: "8. Term, suspension, and termination",
      blocks: [
        {
          kind: "p",
          text: "**8.1 Term.** This agreement continues indefinitely until terminated. There is no fixed term, no minimum commitment, and no lock-in.",
        },
        {
          kind: "p",
          text: "**8.2 Suspension by the School.** The School may request that its portal be suspended at any time by contacting " + SUPPORT_EMAIL + ". Suspension pauses public, staff, and result access. The School's Content, Slot balance, and Credit balance are retained and restored if the portal is reactivated.",
        },
        {
          kind: "p",
          text: "**8.3 Termination by us for cause, immediate.** We may terminate this agreement and disable the School's portal immediately, without notice and without refund other than as the Refund Policy provides, where the School:",
        },
        {
          kind: "ul",
          items: [
            "commits fraud, or attempts to obtain Slots or Credits by deception;",
            "impersonates another school, an individual, or an organisation;",
            "accesses or attempts to access a portal or data that is not its own;",
            "uses Student Data unlawfully, or for a purpose the School has no authority for;",
            "uploads Content it has no right to upload, or that infringes a third party's rights;",
            "engages in harassment, abuse, or impersonation of our personnel;",
            "raises a chargeback that is unmeritorious, or repeatedly raises chargebacks;",
            "resells, sublicenses, or provides third-party access to the Service;",
            "breaches section 5, 6, or 12 in a way that we reasonably consider cannot be remedied; or",
            "engages in any other activity that exposes us to liability, regulatory action, or reputational harm.",
          ],
        },
        {
          kind: "p",
          text: "**8.4 Termination for breach with notice.** Where a breach is minor, first-time, and in our reasonable view capable of remedy, we will ordinarily notify the School in writing and allow 10 days to remedy before terminating.",
        },
        {
          kind: "p",
          text: "**8.5 Suspension for security or legal risk.** We may suspend a portal immediately, without notice, where we identify a security, legal, or reputational risk, including a suspected data breach, a suspected unlawful use, or a pending regulatory enquiry. We will restore the portal once the risk is resolved.",
        },
        {
          kind: "p",
          text: "**8.6 Effect of termination.** On termination or suspension:",
        },
        {
          kind: "ul",
          items: [
            "all access to the portal ceases immediately;",
            "the School has **30 days** from the date of termination to export its Content, after which access may be withdrawn;",
            "the School may instruct us in writing to delete its School Data, which we will action within 30 days, save for billing and audit records we must retain by law, which we will isolate rather than continue to process operationally;",
            "Slot and Credit balances are forfeited on termination for cause under section 8.3, and on voluntary abandonment of an account that has been inactive for 90 days;",
            "balances are **retained in full** where the portal is merely suspended under section 8.2 or section 8.5, and on termination for cause that is not attributable to the School;",
            "all Fees due at the date of termination remain payable;",
            "no pro-rata refund of Fees arises from termination, and any refund is governed solely by the Refund Policy; and",
            "sections 9 (as it relates to disclaimers), 10, 11, 12, 13, 15, 16, 17, and 20 survive termination.",
          ],
        },
        {
          kind: "p",
          text: "**8.7 Reinstatement.** Where a portal is suspended and the underlying issue is resolved, the School may request reinstatement and we will reinstate promptly. Reinstatement is at our discretion and does not guarantee restoration of a terminated portal.",
        },
      ],
    },
    {
      id: "availability",
      heading: "9. Service availability and support",
      blocks: [
        {
          kind: "p",
          text: "**9.1 Availability target, not a commitment.** We target 99.9% availability of the Platform. **This is an operational objective and is not a contractual service level agreement. We give no commitment to achieve any particular level of availability, and no service credits, fee rebates, or other remedy are owed for downtime, however caused.** The Service is provided on an \"as available\" and \"as is\" basis as set out in section 14.",
        },
        {
          kind: "p",
          text: "**9.2 Maintenance.** We may perform maintenance that causes unavailability. We will give reasonable notice where practicable and will schedule disruptive work outside the periods in which Nigerian schools typically compile results, where we can.",
        },
        {
          kind: "p",
          text: "**9.3 Force majeure.** We are not liable for any failure or delay in performing our obligations to the extent it results from a cause beyond our reasonable control, including natural disaster, epidemic or pandemic, war, terrorism, civil unrest, industrial action, governmental action, power or telecommunications failure, internet or hosting failure, or third-party supplier failure. Where a force majeure event persists for more than 30 days, the School may terminate on written notice, in which case any refund is governed by the Refund Policy.",
        },
        {
          kind: "p",
          text: `**9.4 Support.** Support is provided by email at ${SUPPORT_EMAIL} and on WhatsApp at ${SUPPORT_PHONE_DISPLAY}, ${SUPPORT_HOURS}. Support is advisory and provided on a best-effort basis. We do not warrant that we will respond within any particular time.`,
        },
        {
          kind: "p",
          text: "**9.5 Preview features.** Features we identify as preview or beta are provided as is, may change without notice, and may be withdrawn. They are excluded from the availability target in section 9.1.",
        },
      ],
    },
    {
      id: "content-ownership",
      heading: "10. Ownership of Content",
      blocks: [
        {
          kind: "p",
          text: "The School retains all rights, title, and interest in its Content. We claim no ownership of it. Ownership of the Platform, our software, our design, and our supplied template library remains with us, as set out in section 11.",
        },
        {
          kind: "p",
          text: "The School grants us the limited licence described in section 8 of the Privacy Policy to host, process, transmit, and display its Content for the purpose of operating the Platform, and a limited licence to identify the School as a customer as set out in section 8.4 of that policy. Those licences are the whole of our entitlement to the School's Content.",
        },
        {
          kind: "p",
          text: "The School is responsible for the Content and for having the right to submit it. We do not review, verify, or endorse Content, and we may remove Content where we reasonably believe it infringes a third party's rights, is unlawful, or is submitted by someone with no right to submit it.",
        },
      ],
    },
    {
      id: "ip",
      heading: "11. Intellectual property",
      blocks: [
        {
          kind: "p",
          text: "**11.1 Our rights.** We and our licensors retain all intellectual property rights in the Platform, including the software, source code, database schema, interface and visual design, the \"" + TRADING_NAME + "\" and \"ResultApp\" names and marks, domain names, and the grading template library we supply for general use. Except for the limited right to use the Service under these Terms, no licence is granted to the School, and no other rights are implied.",
        },
        {
          kind: "p",
          text: "**11.2 The School's rights.** The School retains all rights in its own branding, including its name, logo, motto, and any template artwork or report card design it creates. The School grants us a limited licence to display that branding on its own portal and to identify the School as a customer, as set out in section 8.4 of the Privacy Policy.",
        },
        {
          kind: "p",
          text: "**11.3 Feedback.** The School may suggest enhancements to the Service. We may use any suggestion without restriction and without obligation to the School. This does not apply to the School's Content or branding.",
        },
        {
          kind: "p",
          text: "**11.4 No misuse of marks.** The School may not use our names, marks, or branding in a way that suggests endorsement, partnership, or affiliation without our prior written consent.",
        },
      ],
    },
    {
      id: "confidentiality",
      heading: "12. Confidentiality and data protection",
      blocks: [
        {
          kind: "p",
          text: "Our respective obligations as controller and processor in relation to Student Data are set out in the Privacy Policy, which is incorporated into these Terms.",
        },
        {
          kind: "p",
          text: "Each of us will keep the other's confidential information confidential and use it only for the purpose of performing this agreement. This does not apply to information that is public, already lawfully known to the recipient without restriction, independently developed, or lawfully received from a third party.",
        },
        {
          kind: "p",
          text: "**12.1 The School's responsibility for lawful processing.** The School instructs us to process Student Data. The School warrants that each such instruction is lawful, that it holds the necessary rights and any required consent for the Content it submits, and that its instructions do not infringe the rights of any student, parent, guardian, or third party. Where the School instructs us to process Student Data in a manner that is unlawful, we may suspend the affected processing immediately and are not liable for consequences arising from it.",
        },
        {
          kind: "p",
          text: "**12.2 Indemnity for data protection.** The School will indemnify us against any fine, penalty, order, award, compensation claim, or reasonable cost we incur arising from the School's breach of this section, of the Privacy Policy, of the NDPA 2023 or NDPR 2023, or of any law relating to the data it submits to the Platform, including where the School did not obtain a consent that Nigerian law required. This indemnity is not subject to the limitation in section 15.",
        },
      ],
    },
    {
      id: "third-parties",
      heading: "13. Third-party services",
      blocks: [
        {
          kind: "p",
          text: "The Service relies on third-party suppliers, including a payment processor for card, USSD, and bank transfer payments, a transactional email provider, a hosting and database provider, and an optional self-hosted student-information component provisioned within a School's portal. Where the School has enabled the student-information component, that component is a separate application with its own configuration, and the School is responsible for the data it places there.",
        },
        {
          kind: "p",
          text: "Third-party services and any external site the Platform links to are provided as is. We do not warrant their availability, security, accuracy, or fitness for purpose, and they are not covered by the availability target in section 9.1. Where a School communicates with a third party through a link — for example a WhatsApp or email link on a staff contact record — that communication is between the School and the third party and is outside our control.",
        },
        {
          kind: "p",
          text: "Our use of sub-processors is described in section 7.2 of the Privacy Policy.",
        },
      ],
    },
    {
      id: "warranties",
      heading: "14. Warranties and disclaimers",
      blocks: [
        {
          kind: "p",
          text: "**14.1 Mutual warranties.** Each of us warrants that it has full power and authority to enter into this agreement, and that doing so does not conflict with any other obligation binding on it.",
        },
        {
          kind: "p",
          text: "**14.2 Our warranties.** We warrant that the Service will perform materially as described in section 3, and that we will provide it with reasonable skill and care.",
        },
        {
          kind: "p",
          text: "**14.3 Disclaimers.** Except as expressly stated, the Service is provided \"as is\" and \"as available\". We expressly disclaim all warranties, whether express or implied, including:",
        },
        {
          kind: "ul",
          items: [
            "merchantability and fitness for a particular purpose;",
            "non-infringement;",
            "uninterrupted, error-free, or secure operation;",
            "**the accuracy, correctness, or completeness of any academic Content, including any score, total, grade band, behavioural rating, or remark**;",
            "that the Platform will meet the School's regulatory, accreditation, examination, or reporting requirements; and",
            "that the Platform will produce results acceptable to any external body, awarding institution, parent, or student.",
        ],
        },
        {
          kind: "p",
          text: "Some jurisdictions do not allow the exclusion of implied warranties or certain statutory rights. To the extent such a term cannot be excluded, our liability for breach of it is limited to the minimum amount permitted by law, and the other terms of this agreement continue to apply.",
        },
      ],
    },
    {
      id: "liability",
      heading: "15. Limitation of liability",
      blocks: [
        {
          kind: "p",
          text: "**15.1 Exclusion of indirect loss.** Neither party is liable to the other for any indirect or consequential loss, or any loss of profit, revenue, anticipated saving, goodwill, business opportunity, or data, in each case howsoever arising and whether in contract, tort (including negligence), breach of statutory duty, or otherwise, even if that loss was foreseeable or the party was advised of the possibility of it.",
        },
        {
          kind: "p",
          text: "**15.2 Aggregate cap.** Subject to section 15.3, our total aggregate liability to the School arising out of or in connection with this agreement, in any 12-month period and for all claims combined, is limited to the **greater of: (a) the total Fees paid by the School in the 12 months preceding the event giving rise to the claim, and (b) ₦50,000.**",
        },
        {
          kind: "p",
          text: "**15.3 Carve-outs from the cap.** Nothing in this agreement limits or excludes our liability:",
        },
        {
          kind: "ul",
          items: [
            "for death or personal injury caused by our negligence;",
            "for fraud or fraudulent misrepresentation;",
            "for wilful misconduct or gross negligence;",
            "for the School's unpaid Fees or any other amount due to us;",
            "for our liability under the data protection indemnity in section 12.2, or for any fine, penalty, or enforcement action arising from our own breach of the NDPA 2023 or NDPR 2023;",
            "for breach of our confidentiality obligations under section 12; or",
            "for infringement of the School's intellectual property rights.",
        ],
        },
        {
          kind: "p",
          text: "**15.4 Reasonableness.** The cap in section 15.2 reflects the prepaid, low-cost, per-pupil nature of the Service and the fact that the School controls the accuracy of its Content. It does not apply to any of the liabilities in section 15.3.",
        },
        {
          kind: "p",
          text: "**15.5 Non-excludable liability.** Nothing in this agreement excludes or limits liability that cannot lawfully be excluded or limited under the laws of Nigeria, including liability under the Consumer Protection Act 2023 where it applies to you.",
        },
        {
          kind: "p",
          text: "**15.6 Scope.** These limitations apply to the fullest extent permitted by law, whether the claim arises in contract, tort (including negligence), breach of statutory duty, or otherwise, and whether or not we have been informed of the possibility of the loss.",
        },
        {
          kind: "p",
          text: "**15.7 Allocation of risk.** Each party is responsible for insuring its own risks. Nothing in this agreement requires either party to obtain insurance.",
        },
      ],
    },
    {
      id: "indemnity",
      heading: "16. Indemnities",
      blocks: [
        {
          kind: "p",
          text: "**16.1 School indemnifies us.** The School will indemnify us, on an indemnity basis, against all losses, liabilities, costs, and expenses (including reasonable legal fees) arising from:",
        },
        {
          kind: "ul",
          items: [
            "the School's breach of these Terms or the Acceptable Use Policy in section 6;",
            "a claim that Content the School submitted, or that results the School published, infringes the intellectual property rights or other rights of a third party;",
            "a claim brought by a student, parent, or guardian in respect of Content, on the ground that the School lacked the right or authority to process the data concerned;",
            "any personal data breach, regulatory investigation, or enforcement action to the extent caused by the School's instructions, the School's failure to obtain a required consent, or the School's breach of the Privacy Policy; or",
            "any representation the School makes to a student, parent, or regulator about the accuracy or official status of a result, where that representation is not ours to make.",
        ],
        },
        {
          kind: "p",
          text: "**16.2 We indemnify the School.** We will indemnify the School against direct losses arising from our gross negligence or wilful misconduct in the provision of the Service.",
        },
        {
          kind: "p",
          text: "**16.3 Procedure.** The indemnified party must notify the indemnifying party promptly of any claim, provide reasonable cooperation at the indemnifying party's cost, and allow the indemnifying party to control the defence and settlement. The indemnifying party may not settle any claim in a way that admits fault by, or imposes a non-monetary obligation on, the indemnified party without that party's consent, not to be unreasonably withheld.",
        },
      ],
    },
    {
      id: "disputes",
      heading: "17. Governing law and disputes",
      blocks: [
        {
          kind: "p",
          text: "**17.1 Good faith.** The parties will attempt in good faith to resolve any dispute arising out of this agreement by discussion between the School Administrator and our support team before commencing any formal process.",
        },
        {
          kind: "p",
          text: "**17.2 Mediation.** If a dispute is not resolved within 15 business days of being raised in writing, the parties will attempt to resolve it by mediation with a mediator agreed between them. The parties will share the mediator's costs equally.",
        },
        {
          kind: "p",
          text: `**17.3 Court.** Failing resolution, the courts of ${JURISDICTION} have exclusive jurisdiction over any dispute arising out of or in connection with this agreement, and each party submits to that jurisdiction.`,
        },
        {
          kind: "p",
          text: `**17.4 Governing law.** This agreement and any dispute arising out of or in connection with it are governed by the laws of ${GOVERNING_LAW}, without regard to its conflict of law rules.`,
        },
        {
          kind: "p",
          text: "**17.5 Mandatory law prevails.** Nothing in this agreement, including any choice of law or jurisdiction, excludes or limits the application of the Nigeria Data Protection Act 2023, the Nigeria Data Protection Regulations 2023, the Consumer Protection Act 2023, or any other law of general application to which the parties are subject. Where a provision of this agreement conflicts with such a law, the law prevails and the remainder of this agreement continues in effect.",
        },
        {
          kind: "p",
          text: "**17.6 Class waiver.** To the fullest extent permitted by law, the parties agree to waive any right to participate in a class, collective, or representative action. If this waiver is held unenforceable, this section does not otherwise limit any right the party may have to bring a claim on an individual basis.",
        },
      ],
    },
    {
      id: "notices",
      heading: "18. Notices",
      blocks: [
        {
          kind: "p",
          text: "Notices under this agreement must be in writing. Notices to us must be sent by email to " + SUPPORT_EMAIL + ". Notices to the School are validly given if sent to the administrator email address recorded in the platform, or by WhatsApp to " + SUPPORT_PHONE_DISPLAY + " for operational matters. A change of administrator email address is not effective for the purposes of a notice until the change has been made in the platform.",
        },
      ],
    },
    {
      id: "changes",
      heading: "19. Changes to these Terms",
      blocks: [
        {
          kind: "p",
          text: "We may amend these Terms from time to time. The version number and effective date appear at the top of this page. We will give the School at least 30 days' notice of any material change by email to the administrator address before it takes effect. A change does not apply retrospectively, and any new or increased Charges take effect only from the School's next purchase after the change takes effect.",
        },
        {
          kind: "p",
          text: "If the School does not notify us of an objection within the notice period, or continues to use the Service after the change takes effect, the School is deemed to accept the amended Terms. If the School does not accept a material change, it may terminate under section 8.2 by requesting suspension and ceasing to purchase.",
        },
      ],
    },
    {
      id: "general",
      heading: "20. General",
      blocks: [
        {
          kind: "p",
          text: "**20.1 Assignment.** Neither party may assign this agreement without the other's prior written consent, except that we may assign it to a successor of our business or to a purchaser of substantially all of our assets on written notice to the School.",
        },
        {
          kind: "p",
          text: "**20.2 Severability.** If any provision is held invalid or unenforceable, it is modified to the minimum extent necessary to make it enforceable, or severed if it cannot be made enforceable, and the remainder continues in effect.",
        },
        {
          kind: "p",
          text: "**20.3 Waiver.** A failure or delay in enforcing a right is not a waiver of it. A waiver is effective only if given in writing.",
        },
        {
          kind: "p",
          text: "**20.4 Entire agreement.** These Terms, the Privacy Policy, the Refund Policy, and any order or signed agreement between the parties constitute the entire agreement between them and supersede all prior discussions and representations. Each party acknowledges that it has not relied on any statement not set out in these documents.",
        },
        {
          kind: "p",
          text: "**20.5 Order of precedence.** In the event of conflict, the following order of precedence applies: (1) a separate written agreement between the parties; (2) the Refund Policy, for payment and refund matters; (3) these Terms; (4) the Privacy Policy; (5) any School-specific documentation in the platform.",
        },
        {
          kind: "p",
          text: "**20.6 Force majeure.** This is dealt with in section 9.3 and is incorporated by reference.",
        },
        {
          kind: "p",
          text: "**20.7 Survival.** Provisions that by their nature should survive termination survive, including sections 9 (as to disclaimers), 10, 11, 12, 13, 15, 16, 17, 18, and 20.",
        },
        {
          kind: "p",
          text: "**20.8 Language.** These Terms are written in English. If a translation is provided for convenience, the English version prevails.",
        },
      ],
    },
    {
      id: "contact",
      heading: "21. Contact",
      blocks: [
        {
          kind: "p",
          text: `Questions about these Terms, and notices under this agreement, may be sent to ${SUPPORT_EMAIL}, or by post to ${CONTROLLER_NAME}, ${CONTROLLER_LOCATION}. Support is available ${SUPPORT_HOURS} on WhatsApp and telephone ${SUPPORT_PHONE_DISPLAY}.`,
        },
        {
          kind: "note",
          text: "For data protection enquiries and data subject requests, please see section 11 of the Privacy Policy. For anything relating to a payment or a refund, please see the Refund Policy, which sets out the process and timescales we work to.",
        },
      ],
    },
  ],
};
