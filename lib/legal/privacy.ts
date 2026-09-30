import type { LegalDocumentData } from "./types";
import {
  CONTROLLER_LOCATION,
  CONTROLLER_NAME,
  EFFECTIVE_DATE,
  JURISDICTION,
  PRIVACY_VERSION,
  REGULATOR_NAME,
  REGULATOR_SHORT,
  REGULATOR_URL,
  SUPPORT_EMAIL,
  SUPPORT_HOURS,
  SUPPORT_PHONE_DISPLAY,
  TRADING_NAME,
} from "./constants";

/**
 * Single source of truth for the Privacy Policy.
 *
 * The data inventory in section 4 and Annex A is enumerated against the live
 * schema in backend/services/db_manager.py and backend/models.py. Section 4.3
 * is deliberately bounded: it lists the student fields we actually hold, and
 * the negative list prevents the policy from implying collection of DOB,
 * photographs, guardian contacts, or biometrics that the platform does not
 * store. Keep both lists in sync with the schema.
 */
export const privacyPolicy: LegalDocumentData = {
  slug: "privacy",
  title: "Privacy Policy",
  subtitle:
    "How ResultApp.org collects, uses, and protects personal data on behalf of Nigerian schools.",
  version: PRIVACY_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  description:
    "How ResultApp.org handles personal data. We act as a data processor for student records on instruction from your school, and as a data controller for billing and account data. We use only strictly necessary session cookies — no advertising, analytics, or tracking.",
  summary: [
    `We are a **data processor**, not the owner, of student data. Your school decides why and how that data is used; we act only on the school's documented instructions.`,
    `We are a **data controller** for our own operations: billing and payment records, staff and administrator accounts, support requests, and security audit logs.`,
    "We use **only strictly necessary session cookies**. No advertising, analytics, or cross-site tracking cookies are set, and no cookie banner is required.",
    "**Every school is isolated** to its own tenant. Data belonging to one school is never visible to another school on the platform.",
    `We never sell data, and we never use student data for advertising, profiling, or our own commercial purposes.`,
    "Schools and their staff can request access to, correction of, or deletion of the data we hold. Contact us and we will assist.",
  ],
  sections: [
    {
      id: "who-we-are",
      heading: "1. Who we are",
      blocks: [
        {
          kind: "p",
          text: `${TRADING_NAME} ("ResultApp", "we", "us") is a result compilation platform operated by ${CONTROLLER_NAME}, ${CONTROLLER_LOCATION}. Through ResultApp, a school can create a private portal, enter and organise student grades and assessments, build report cards, and publish results to students and parents.`,
        },
        {
          kind: "p",
          text: `For the purposes of the Nigeria Data Protection Act 2023 and the Nigeria Data Protection Regulations 2023, this document describes how we handle personal data in two distinct capacities. Which capacity applies depends entirely on whose data it is. We are explicit about this because it determines who is responsible for your data and who you should approach with a request.`,
        },
        {
          kind: "p",
          text: "**Contact details.** Privacy enquiries and data subject requests: " + SUPPORT_EMAIL + `. Support is available ${SUPPORT_HOURS} on WhatsApp and telephone ${SUPPORT_PHONE_DISPLAY}. Postal and registered enquiries may be directed to ${CONTROLLER_NAME}, ${CONTROLLER_LOCATION}.`,
        },
      ],
    },
    {
      id: "roles",
      heading: "2. The two roles we play",
      blocks: [
        {
          kind: "p",
          text: "**2.1 Data Controller — your school.** Your school is the data controller for its own roster, grades, behavioural assessments, teacher and principal remarks, grading templates, and branding assets. Your school decides the purposes and the means of processing that data, and your school is the party answerable to students, parents, and regulators for it. We do not decide what is taught, how a student is assessed, or who may see a result.",
        },
        {
          kind: "p",
          text: "**2.2 Data Processor — ResultApp.org.** Where we handle data on your school's behalf, we act as a data processor under the school's documented instructions. Our obligations as a processor are to:",
        },
        {
          kind: "ul",
          items: [
            "process personal data only on the school's documented instructions, including as to international transfers;",
            "ensure that any person we authorise to process the data is bound by confidentiality obligations;",
            "implement appropriate technical and organisational security measures;",
            "not process data for our own purposes, and not sell, rent, or share it with anyone for our own commercial benefit;",
            "not engage a sub-processor without the school's specific or general authorisation — the sub-processors in section 7.2 are disclosed for that purpose, and new ones will be notified before they receive school data;",
            "taking into account the nature of the processing, assist the school in responding to data subject requests;",
            "assist the school in demonstrating compliance with the NDPA 2023; and",
            "at the school's choice, return or securely delete the data when our engagement ends, subject to the retention periods in section 10.",
          ],
        },
        {
          kind: "p",
          text: `**2.3 Data Controller — our own operations.** We are an independent data controller for the limited categories in section 4 that concern us rather than any student: billing and transaction records, staff and school administrator account data, support requests, and our platform security audit logs. We decide the purposes and means for these, and we are directly responsible for them.`,
        },
        {
          kind: "note",
          text: "This split is the single most important thing to understand about ResultApp's privacy model. If you want your student's record corrected, deleted, or a copy of, the first step is normally your school, because the school is the controller. We will assist your school promptly and at no charge. See section 11.",
        },
      ],
    },
    {
      id: "definitions",
      heading: "3. Definitions",
      blocks: [
        {
          kind: "ul",
          items: [
            "**School** — the educational institution that has registered for a ResultApp portal, together with its proprietor, board, management, and authorised representatives.",
            "**School Administrator** — the individual holding the administrator account on a school's portal, who can manage staff, rosters, subjects, templates, billing, and publication.",
            "**Authorised User** — any individual a school has given portal access to, including teachers, form masters, and other staff.",
            "**Student Data** — any personal data relating to a pupil of a School. This is school-controlled data under section 2.1.",
            "**School Data** — the aggregate of Student Data, staff records, templates, uploads, and configuration belonging to one School.",
            "**Sub-processor** — a third party that processes personal data on our behalf, listed in section 7.2.",
            "**Processing** — any operation on personal data, whether or not by automated means, as defined by the NDPA 2023.",
            "**The Platform** — the ResultApp.org software application, including each school's dedicated portal subdomain.",
          ],
        },
      ],
    },
    {
      id: "what-we-collect",
      heading: "4. Information we collect",
      blocks: [
        {
          kind: "p",
          text: "The categories below reflect what the platform actually stores. We have not listed any category of data that we do not collect.",
        },
        { kind: "h3", text: "4.1 School registration and administrator details" },
        {
          kind: "ul",
          items: [
            "School name, portal subdomain, logo, hero background image, and motto",
            "Administrator name, email address (which also serves as the administrator login), and telephone number",
            "School address, city, state, and country",
            "Proprietor name and school registration number, where the school provides them",
            "Academic configuration: current term, session, new term start date, and custom ID prefixes",
            "Credit and slot balances, and subscription status",
            "Portal creation date and last-updated timestamp",
          ],
        },
        { kind: "h3", text: "4.2 Staff and teacher account details" },
        {
          kind: "ul",
          items: [
            "Full name, staff identifier, role (Teacher, Form Master, Vice Principal, Principal, or Admin), and account active/inactive status",
            "Email address and telephone number, where provided",
            "A one-way cryptographic hash of the account password or PIN. We never store or have access to your password in readable form",
            "Handwritten signature image, where the staff member uploads one for use on report cards",
          ],
        },
        { kind: "h3", text: "4.3 Student roster data" },
        {
          kind: "p",
          text: "For each pupil a school adds to a portal, the platform stores:",
        },
        {
          kind: "ul",
          items: [
            "Full name",
            "Student identifier (the school's own internal code, for example a class-and-number reference)",
            "Class name",
            "Gender",
          ],
        },
        {
          kind: "note",
          text: "**What we do not collect.** ResultApp does not collect or store dates of birth, student photographs or avatars, student home addresses, student telephone numbers, guardian or parent names, parent or guardian contact details, national identification numbers, biometric templates, medical or disability information, religious beliefs, or special-needs records. Students are not registered as users of the platform, have no login, and provide no information to us directly. Any such data that appears in a School's portal is entered and controlled by the School, and is subject to this policy by reason of the School's instructions to us.",
        },
        { kind: "h3", text: "4.4 Academic and assessment records" },
        {
          kind: "ul",
          items: [
            "Scores entered per subject and per term, together with totals calculated from them",
            "Behavioural trait ratings assessed against grading templates",
            "Grading template structures: the academic and behavioural criteria, grade bands, and the classes a template applies to",
            "Free-text remarks authored by subject teachers, form teachers, and principals about individual pupils",
            "Subject and class allocations, including which staff member is assigned to which class and subject",
          ],
        },
        {
          kind: "p",
          text: "These records are education records about identifiable children. They are entered by the School's staff and are under the School's control as controller.",
        },
        { kind: "h3", text: "4.5 Result publication records" },
        {
          kind: "ul",
          items: [
            "The student identifier, term, and academic session for which a result was published",
            "The identity of the School Administrator who published the result, and the timestamp of publication",
          ],
        },
        { kind: "h3", text: "4.6 Billing and transaction records" },
        {
          kind: "ul",
          items: [
            "Transaction reference, amount, currency, and payment status",
            "The name and email address supplied to our payment processor at checkout",
            "Purchase history for slots and credits, recorded in an internal billing ledger with the token type, quantity, and description of each movement",
          ],
        },
        {
          kind: "note",
          text: "**We do not see or store your payment card details.** Card numbers, expiry dates, and security codes are entered into the payment processor's own secure checkout and never reach our servers. We store only the resulting transaction reference and status.",
        },
        { kind: "h3", text: "4.7 Support requests and feedback" },
        {
          kind: "ul",
          items: [
            "Submitter email address, role, and the school portal the request relates to",
            "The free-form content of the request, including any diagnostic information you choose to include",
            "Ticket status, resolution notes, and the identity of the staff member who resolved the ticket",
          ],
        },
        { kind: "h3", text: "4.8 Notification records" },
        {
          kind: "ul",
          items: [
            "Which Authorised Users and School Administrators have read which in-platform notification, and when",
          ],
        },
        { kind: "h3", text: "4.9 Platform security audit logs" },
        {
          kind: "p",
          text: "Our own staff and systems record administrative actions taken on the platform — who acted, what they did, which school was affected, and when. This includes account provisioning, suspension, restoration, deletion, credential resets, and manual credit or slot grants. These records are append-only and are not visible to a School.",
        },
        { kind: "h3", text: "4.10 Technical and security data" },
        {
          kind: "ul",
          items: [
            "Your browser's request to our servers, including the network address the request originated from, which we read transiently to apply rate limiting and to investigate abuse. This information is held in memory for that purpose and is not stored in our customer records as a matter of course",
            "Server and application logs recording errors and security events, retained on a limited cycle under section 10",
          ],
        },
        { kind: "h3", text: "4.11 Uploaded assets" },
        {
          kind: "ul",
          items: [
            "School branding assets: logo, hero background, motto, and any report card template artwork or PDF",
            "Handwritten signature images for the principal and for individual staff",
          ],
        },
        {
          kind: "p",
          text: "Uploaded files are restricted to a defined set of image and document formats and are subject to size limits. Where a signature image is uploaded, it is a biometric-adjacent personal data item and is handled as such.",
        },
      ],
    },
    {
      id: "cookies",
      heading: "5. Cookies and similar technologies",
      blocks: [
        {
          kind: "p",
          text: "**Our position: strictly necessary session data only.** We set no advertising cookies, no analytics cookies, no profiling cookies, no cross-site cookies, and no third-party tracking cookies. We do not run Google Analytics, Google Tag Manager, Meta Pixel, Microsoft Clarity, Hotjar, Sentry, Mixpanel, Segment, Amplitude, or any comparable advertising, analytics, or session-replay product.",
        },
        {
          kind: "p",
          text: "Because every cookie we set is strictly necessary for the service to function, and we set nothing based on consent, **no cookie consent banner is presented to visitors and none is required.** Under the NDPA 2023, consent is the lawful basis for processing that a person has agreed to. Non-essential technologies are the practical target of that rule, and we set none. The cookies below are set for the express technical purpose of keeping an authenticated user signed in, which is necessary for the performance of a contract with the School under section 26(2)(c) of the NDPA 2023.",
        },
        { kind: "h3", text: "5.1 The cookies we set" },
        {
          kind: "table",
          head: ["Cookie", "Purpose", "Lifetime"],
          rows: [
            [
              "**admin_session**",
              "Keeps a school administrator signed in to their portal and carries the tenant binding used to scope every request to that school.",
              "12 hours",
            ],
            [
              "**staff_session**",
              "Keeps an Authorised User signed in to the staff grading workspace and carries the same tenant binding.",
              "12 hours",
            ],
            [
              "**superadmin_session**",
              "Keeps an authorised operator of ResultApp.org signed in to internal support tooling.",
              "12 hours",
            ],
          ],
        },
        {
          kind: "p",
          text: "All three share the same technical characteristics: they are first-party, they are **host-only** — a session created on a school's portal subdomain is never transmitted to resultapp.org or to any other subdomain, so it cannot be used to link a visitor's activity across schools — they are set as **HTTP-only** so that client-side scripts cannot read them, they are marked **Secure** in production, they carry **SameSite=Lax**, and they are deleted on sign-out.",
        },
        {
          kind: "p",
          text: "Each of the three is **cryptographically signed**. The value we set is a signed token rather than readable session data, and it is verified on every request before any identity is read from it. The signature covers the session's contents and its expiry, so a session cannot be edited, extended, or fabricated by anyone who does not hold our signing key — including by a visitor, and including where a session is read on a school subdomain rather than on resultapp.org. A token that is unsigned, altered, or past its stated expiry is rejected and removed. Because the signing key is held only by our application server and is never transmitted to any third party, a school cannot forge a session for another school.",
        },
        {
          kind: "p",
          text: "A session is valid for up to 12 hours from the moment it is created, and that limit is enforced by us rather than only by your browser. It is not extended by activity. Signing a session makes it tamper-proof but does not give it a separate off-switch: if a session is copied by someone else, it remains usable until it expires. We therefore ask that Authorised Users sign out when they finish on a shared or public device, and we recommend that Step 1 of a new version of the Terms of Service and this Policy be treated as a re-sign-in point.",
        },
        { kind: "h3", text: "5.2 Payment checkout" },
        {
          kind: "p",
          text: "When a user chooses to make a payment, our payment processor's checkout script is loaded. This is required to process a card, USSD, or bank transfer payment and cannot be replaced by our own code. The processor may set its own cookies for the duration of the checkout, under its own privacy documentation. This script is not loaded on page view, and no data is transmitted to the processor until a user deliberately initiates a payment.",
        },
        { kind: "h3", text: "5.3 Browser local storage" },
        {
          kind: "p",
          text: "The staff grading workspace saves in-progress grading drafts to your browser's local storage so that scores are not lost if a page is refreshed or a connection drops. These drafts are stored under a key scoped to your school, class, subject, and assessment, and they remain on the device until the user clears them. Because a school portal may be used on a shared or public computer, we recommend signing out and clearing browser storage after use.",
        },
        { kind: "h3", text: "5.4 Changes to this section" },
        {
          kind: "p",
          text: "Should we ever introduce a non-essential technology, we will update this section and implement an appropriate consent mechanism before doing so.",
        },
      ],
    },
    {
      id: "how-we-use",
      heading: "6. How we use personal data, and on what basis",
      blocks: [
        {
          kind: "p",
          text: "Under section 26 of the NDPA 2023, personal data may be processed only on a lawful basis. The bases we rely on, and the purposes they support, are set out below.",
        },
        {
          kind: "table",
          head: ["Lawful basis", "What it covers"],
          rows: [
            [
              "**Performance of a contract** — section 26(2)(c)",
              "Provisioning a School's portal, authenticating Staff and Administrators, storing and displaying rosters and grades, building and rendering report cards, publishing results, administering slots and credits, and taking payment for those.",
            ],
            [
              "**Legitimate interests** — section 26(2)(e)",
              "Securing the Platform, preventing fraud and abuse, investigating and resolving support tickets, maintaining service reliability, and improving the Platform. We have assessed that these purposes do not override the interests of individuals, given that they are limited to security, service delivery, and support, and given that we hold no behavioural or advertising profile of any student.",
            ],
            [
              "**Legal obligation** — section 26(2)(d)",
              "Retaining transaction, billing, and audit records for the periods required by Nigerian tax, accounting, and corporate law.",
            ],
            [
              "**Consent** — section 26(2)(a)",
              "Any optional future communication that is not required to deliver the service. **We currently operate no marketing or mailing list, and no such consent has been collected.** If we ever introduce optional communications, we will request consent first and provide a means to withdraw it.",
            ],
          ],
        },
        {
          kind: "p",
          text: "**6.1 Purposes we expressly do not pursue.** For the avoidance of doubt, and notwithstanding that we are a controller for our own operations, we do not:",
        },
        {
          kind: "ul",
          items: [
            "sell, rent, trade, or licence personal data to anyone;",
            "use Student Data for advertising, marketing, or commercial prospecting of any kind;",
            "build behavioural, interest, or aptitude profiles of any student;",
            "share personal data with advertising networks, data brokers, or enrichment vendors;",
            "use personal data to train, fine-tune, or evaluate any machine-learning or artificial-intelligence model; or",
            "use Student's data for any purpose other than the instructions given to us by the School that collected it.",
          ],
        },
        {
          kind: "p",
          text: "**6.2 No automated decision-making.** The Platform applies no algorithm that produces a decision about an individual. Every score, behavioural rating, and remark in a portal is entered by a member of the School's staff. No automated scoring, ranking logic, or eligibility determination is performed on a student's record.",
        },
      ],
    },
    {
      id: "sharing",
      heading: "7. How we share personal data",
      blocks: [
        { kind: "h3", text: "7.1 Within your school" },
        {
          kind: "p",
          text: "Visibility of data inside a portal is controlled entirely by the School, which decides who is added as an Authorised User and what role they hold. We do not define or police intra-school visibility, and we do not grant any member of a School access to another School's data.",
        },
        { kind: "h3", text: "7.2 Our sub-processors" },
        {
          kind: "p",
          text: "We use the following sub-processors. Each processes data only for the purpose stated, on our instructions, and under confidentiality obligations.",
        },
        {
          kind: "table",
          head: ["Sub-processor", "Purpose", "Data shared"],
          rows: [
            [
              "**Flutterwave**",
              "Payment processing for slot and credit purchases",
              "Transaction reference, amount, currency, and payment status; the name, email address, and telephone number provided at checkout",
            ],
            [
              "**Brevo**",
              "Delivery of transactional email, such as portal provisioning notices, welcome messages, and low-balance alerts",
              "Recipient name and email address, and the content of the message",
            ],
            [
              "**DigitalOcean**",
              "Infrastructure, hosting, and database operation",
              "All data at rest, as necessary to operate the Platform",
            ],
            [
              "**Self-hosted RosarioSIS instance and per-school database**",
              "Optional student-information component provisioned within a School's own portal",
              "The subset of a School's student information that the School chooses to use there",
            ],
          ],
        },
        {
          kind: "note",
          text: "**WhatsApp.** Our support channel is a WhatsApp link. When a user contacts us on WhatsApp, that conversation is between the user and WhatsApp and does not pass through our systems. Users should not send student or pupil information over WhatsApp.",
        },
        {
          kind: "p",
          text: "**Fonts.** Our web fonts are downloaded and self-hosted as part of building the application, so no request for a font file is made to a third party when you browse the site.",
        },
        { kind: "h3", text: "7.3 Our own personnel" },
        {
          kind: "p",
          text: "Only personnel who need access to a School's data to perform a support or engineering function can access it, and only on a need-to-know basis. Administrative actions taken on the platform are recorded in the append-only audit logs described in section 4.9, with the acting individual identified.",
        },
        { kind: "h3", text: "7.4 Disclosure required by law" },
        {
          kind: "p",
          text: `We may disclose personal data where we are required to do so by Nigerian law, a court of competent jurisdiction, or ${REGULATOR_NAME}. Where we are permitted to do so, we will notify the affected School unless the law prohibits it.`,
        },
        { kind: "h3", text: "7.5 No sale" },
        {
          kind: "p",
          text: "We do not sell or otherwise disclose personal data for monetary consideration. We do not disclose personal data to advertisers or data brokers. We have never sold personal data and will not.",
        },
        { kind: "h3", text: "7.6 Business transfers" },
        {
          kind: "p",
          text: "If ResultApp.org is sold, merged, or reorganised, personal data may transfer to the successor entity. We will give the affected Schools notice before any such transfer, and the successor will be bound by these terms and this policy. A change of control does not release a School from its rights under section 11.",
        },
      ],
    },
    {
      id: "ownership",
      heading: "8. Data ownership and licences",
      blocks: [
        {
          kind: "p",
          text: "**8.1 The School owns its data.** A School owns and retains all rights in its Student Data, its grades, its assessments and remarks, its grading templates, its branding assets, and its portal subdomain. We claim no ownership of any School Data and no right to use Student Data for our own purposes. Our processing of that data is as a processor, on the School's instructions, and the licence below is the full extent of what we take.",
        },
        {
          kind: "p",
          text: "**8.2 We own the Platform.** We retain all rights in the Platform software, source code, database schema, interface design, branding, and the grading template library we supply for general use. Nothing in these terms transfers any of those rights to a School.",
        },
        {
          kind: "p",
          text: "**8.3 Licence to host.** The School grants us a limited, non-exclusive, non-transferable, revocable licence to host, copy, transmit, display, and process its School Data solely for the purpose of operating the Portal and delivering the Service. This licence is limited to the duration of the engagement and ends automatically on termination, save for the archival obligations in section 10.",
        },
        {
          kind: "p",
          text: "**8.4 Licence to display.** The School grants us a limited, non-exclusive, revocable licence to display the School's name, logo, motto, and approved report card design on the School's portal, and to identify the School as a customer of ResultApp in our public customer list unless the School asks us not to.",
        },
        {
          kind: "p",
          text: "**8.5 Aggregate information.** We may retain and use information that does not identify a student in order to understand how the Platform is used in aggregate — for instance, how many report cards are published in a term, or how quickly schools are set up. This is used only to operate and improve the service and never in a form that identifies a pupil.",
        },
        {
          kind: "p",
          text: "**8.6 Feedback.** If a School suggests an enhancement, we may use that suggestion without restriction or obligation to the School. This does not apply to a School's data or branding.",
        },
      ],
    },
    {
      id: "security",
      heading: "9. Security measures",
      blocks: [
        {
          kind: "p",
          text: "We apply technical and organisational measures appropriate to the risk, consistent with section 44 of the NDPA 2023. The measures in place include:",
        },
        {
          kind: "ul",
          items: [
            "**Encrypted password storage.** Passwords and PINs are stored only as one-way cryptographic hashes using a modern, salted algorithm. They cannot be recovered, read, or transmitted by us in any form.",
            "**HTTP-only, host-only session cookies.** Session tokens are inaccessible to client-side scripts and are scoped to a single host, so a session cannot be read or used on any other school portal or on the public site.",
            "**Tenant isolation on every request.** Each portal is isolated by tenant. Every request is validated against the tenant bound to the session and against the tenant being addressed, and all database access is filtered by that tenant. Data belonging to one school is not reachable from another school's portal.",
            "**No direct database access from the browser.** The browser never talks to the database. All data access is mediated by authenticated server-side request handlers that validate the caller and the tenant before returning anything.",
            "**Shared-secret internal API authentication.** Calls between the public-facing application and the data services are authenticated with a server-side secret compared in constant time, and the secret is never exposed to a browser.",
            "**Input validation.** Tenant identifiers, subdomains, role assignments, and uploaded file types and sizes are validated server-side before use.",
            "**Rate limiting.** Repeated or abusive requests are throttled and logged.",
            "**Append-only audit logging.** Administrative actions by our personnel are recorded with the actor, the action, the affected school, and the time.",
            "**Backups.** Our database is backed up on a recurring daily cycle so that School Data is recoverable following loss or corruption.",
            "**Data residency.** Platform data is hosted on infrastructure located in Africa.",
            "**Restricted upload formats.** Uploads are limited to a defined set of image and document formats with enforced size limits, reducing the risk of a harmful file being stored or served.",
          ],
        },
        {
          kind: "p",
          text: "Because the Platform handles assessment data about children, we treat security as an ongoing obligation rather than a fixed state. We review and strengthen these measures, and we will notify affected Schools without undue delay if a personal data breach occurs.",
        },
      ],
    },
    {
      id: "retention",
      heading: "10. Retention",
      blocks: [
        {
          kind: "p",
          text: "We keep personal data only for as long as we need it for the purpose it was collected, or for longer where Nigerian law requires it. The periods below apply unless a School instructs us otherwise in writing, or a longer period is required by law.",
        },
        {
          kind: "table",
          head: ["Data", "Retention"],
          rows: [
            [
              "Session cookies",
              "12 hours, or until you sign out",
            ],
            [
              "Network addresses used for rate limiting",
              "Held in memory only; discarded on restart. Not stored in customer records",
            ],
            [
              "Server and application error logs",
              "A short rolling cycle, reviewed regularly",
            ],
            [
              "Billing, ledger, and transaction records",
              "Retained for the period required by Nigerian tax, accounting, and corporate law (a minimum of 7 years)",
            ],
            [
              "Platform administrative audit logs",
              "Retained for 5 years",
            ],
            [
              "Support tickets and feedback",
              "2 years from resolution, unless needed longer to handle a recurring issue",
            ],
            [
              "Staff and administrator account data",
              "For the life of the account, and for 90 days afterwards. A School may direct us to delete a staff account at any time",
            ],
            [
              "Student academic records, assessments, and remarks",
              "Retained on the School's instruction for as long as the School requires. As controller, the School decides the applicable academic record-keeping period; we do not unilaterally delete or anonymise a School's academic records",
            ],
            [
              "Grading drafts held in your browser",
              "Until you clear your browser storage",
            ],
            [
              "Published results",
              "Retained on the School's instruction. A School may remove a published result; reprints of a result already published are free",
            ],
          ],
        },
        {
          kind: "p",
          text: "When a School's engagement ends, the School may instruct us in writing to delete its School Data. We will action that instruction within 30 days, save for data we are required by law to retain — principally billing and audit records — which we will isolate rather than continue to process for operational purposes.",
        },
      ],
    },
    {
      id: "your-rights",
      heading: "11. Your rights and how to exercise them",
      blocks: [
        {
          kind: "p",
          text: "The NDPA 2023 gives individuals rights over their personal data. The practical route to exercising them in relation to student data is through the School, because the School is the controller. We are obliged to assist the School, and we will do so at no charge.",
        },
        { kind: "h3", text: "11.1 The rights" },
        {
          kind: "p",
          text: "You may be entitled to:",
        },
        {
          kind: "ul",
          items: [
            "**Access** — obtain a copy of the personal data relating to you that we process",
            "**Rectification** — have inaccurate or incomplete data corrected",
            "**Erasure** — have your data erased where the applicable grounds apply",
            "**Restriction** — have processing restricted while a concern is investigated",
            "**Portability** — receive certain data in a structured, commonly used, machine-readable format",
            "**Object** — object to processing based on legitimate interests, and to direct marketing at any time",
            "**Withdraw consent** — where processing rests on consent, withdraw it at any time, without affecting the lawfulness of processing carried out before withdrawal",
            "**Complain** — lodge a complaint with us, and thereafter with " + REGULATOR_NAME + ".",
          ],
        },
        { kind: "h3", text: "11.2 How to make a request" },
        {
          kind: "p",
          text: `Email ${SUPPORT_EMAIL} with the subject line beginning "Data request", and include: the school portal subdomain; your name and the school you are associated with; whether you are a student, a parent or guardian, or a staff member; the student and record your request concerns; and the right you wish to exercise. We will acknowledge within 5 business days and aim to resolve within 30 days. Our business days are ${SUPPORT_HOURS}.`,
        },
        { kind: "h3", text: "11.3 Identity verification" },
        {
          kind: "p",
          text: "Before we disclose personal data or act on a request, we will take reasonable steps to verify the requester's identity and authority. Where a request comes from a parent or guardian about a student, we may ask the School to confirm the relationship. We will not disclose the existence or content of a School's data to a third party merely because they ask for it.",
        },
        { kind: "h3", text: "11.4 If you are not satisfied" },
        {
          kind: "p",
          text: `If we do not resolve a request to your satisfaction, you may escalate to ${REGULATOR_NAME} at ${REGULATOR_URL}. We would rather you come to us first, and we will cooperate fully with any enquiry.`,
        },
        { kind: "h3", text: "11.5 Data subject notification" },
        {
          kind: "p",
          text: `Where a personal data breach occurs, we will notify the affected School without undue delay, with the information ${REGULATOR_SHORT} requires so that the School can meet its own notification obligations. Notification is not delayed by our internal investigation, and we will provide further information as it becomes available.`,
        },
        { kind: "h3", text: "11.6 Our data protection contact" },
        {
          kind: "p",
          text: `Privacy and data protection enquiries are handled by our data protection contact at ${SUPPORT_EMAIL}, monitored ${SUPPORT_HOURS}.`,
        },
      ],
    },
    {
      id: "childrens-data",
      heading: "12. Children's data",
      blocks: [
        {
          kind: "p",
          text: "The Platform is used to process assessment data about children. Students are minors for the purposes of the NDPA 2023, and their data attracts the highest protection.",
        },
        {
          kind: "p",
          text: "**We have no direct relationship with students.** Students do not register on the Platform, do not have accounts, and provide no information to us directly. A School enters a pupil's data and configures their access. Accordingly:",
        },
        {
          kind: "ul",
          items: [
            "The School is the controller and is responsible for having a lawful basis for processing each pupil's data, including obtaining any consent from a parent or guardian that Nigerian law requires in the circumstances of that School.",
            "The School is responsible for informing students and parents about the data it collects and about result publication.",
            "We do not determine any purpose or means in respect of Student Data, and we process it only on the School's instructions.",
            "We apply the same security standards to student data as to all personal data, and we do not use it for any purpose of our own.",
          ],
        },
        {
          kind: "p",
          text: "A parent or guardian who wishes to know what is held about a pupil should approach the School in the first instance, as the School is the controller. We will assist the School in responding. We will not disclose a School's records of a pupil to a third party without the School's involvement, save where Nigerian law requires otherwise.",
        },
      ],
    },
    {
      id: "transfers",
      heading: "13. International transfers",
      blocks: [
        {
          kind: "p",
          text: "We are a Nigerian operator and our principal establishment is in Nigeria. Some of our sub-processors operate infrastructure or services outside Nigeria, as set out in section 7.2. Where personal data is transferred outside Nigeria, we rely on the transfer mechanisms recognised by the NDPA 2023 and the NDPR 2023, which may include:",
        },
        {
          kind: "ul",
          items: [
            "a transfer to a jurisdiction that the " + REGULATOR_SHORT + " has recognised as providing an adequate level of protection;",
            "standard contractual clauses or equivalent instruments approved by the " + REGULATOR_SHORT + "; or",
            "another lawful basis available under the Regulations.",
          ],
        },
        {
          kind: "p",
          text: "Where a School instructs us to transfer data outside Nigeria, we will put the appropriate safeguards in place before doing so and will inform the School of the mechanism relied upon. Each School is separately notified of any new destination for its data, and any new sub-processor outside Nigeria is notified before it receives that data.",
        },
      ],
    },
    {
      id: "changes",
      heading: "14. Changes to this policy",
      blocks: [
        {
          kind: "p",
          text: "We may update this policy from time to time. The version number and effective date appear at the top of this page, and every material change will be dated. Where a change is material — a new category of data, a new sub-processor, a new purpose, or a new jurisdiction for a transfer — we will give the affected Schools at least 30 days' notice before it takes effect.",
        },
        {
          kind: "p",
          text: "Continuing to use the Service after a change takes effect constitutes acceptance of the updated policy. The version of this policy in force at the time a School registered is the version that governs that School's engagement unless the School agrees otherwise.",
        },
        {
          kind: "note",
          text: "**Questions.** For any privacy question, or to make a request under section 11, contact " + SUPPORT_EMAIL + `, or write to ${CONTROLLER_NAME}, ${CONTROLLER_LOCATION}. Our forum for disputes arising under these terms is ${JURISDICTION}.`,
        },
      ],
    },
    {
      id: "annex-a",
      heading: "Annex A — Data inventory",
      blocks: [
        {
          kind: "p",
          text: "This annex is a summary rather than a substitute for sections 2 to 6. It is provided so that a School, a data subject, or the " + REGULATOR_SHORT + " can see, at a glance, what is held, why, and on whose authority.",
        },
        {
          kind: "table",
          head: ["Data", "Specific fields", "Why we hold it", "Basis", "Controller"],
          rows: [
            [
              "School registration",
              "School name, subdomain, logo, motto, address, location, registration number",
              "Provision and identify the portal",
              "Contract",
              "School",
            ],
            [
              "Administrator account",
              "Name, email (login identifier), telephone, password hash, current term and session",
              "Authenticate and administer the portal",
              "Contract",
              "School (account held jointly)",
            ],
            [
              "Staff accounts",
              "Name, staff ID, role, email, telephone, password hash, signature image, active status",
              "Authenticate and grant grading access",
              "Contract",
              "School",
            ],
            [
              "Student roster",
              "Full name, student ID, class, gender",
              "Attach results to the correct pupil",
              "School's instruction (contract)",
              "School",
            ],
            [
              "Academic records",
              "Per-subject and per-term scores, calculated totals, term and session",
              "Compile and render report cards",
              "School's instruction (contract)",
              "School",
            ],
            [
              "Behavioural assessments",
              "Trait ratings against templates; teacher, form-teacher, and principal remarks",
              "Produce the report card the School defines",
              "School's instruction (contract)",
              "School",
            ],
            [
              "Result publications",
              "Student ID, term, session, publisher identity, publication timestamp",
              "Record what was published, when, and by whom",
              "Legitimate interests (integrity)",
              "School",
            ],
            [
              "Billing and ledger",
              "Transaction reference, amount, currency, status, token type, movement description, balance",
              "Take payment, deliver entitlements, and meet accounting obligations",
              "Contract / legal obligation",
              "Zabdiel Tech",
            ],
            [
              "Support tickets",
              "Submitter email, role, school, free-form content, status, resolution note, resolver identity",
              "Answer the request and fix the underlying issue",
              "Legitimate interests (support)",
              "Zabdiel Tech",
            ],
            [
              "Notification read state",
              "User identifier, notification, read timestamp",
              "Deliver and track in-platform notices",
              "Contract",
              "School",
            ],
            [
              "Administrative audit logs",
              "Actor identity, action, school, details, timestamp",
              "Security, accountability, and abuse investigation",
              "Legitimate interests (security)",
              "Zabdiel Tech",
            ],
            [
              "Technical and log data",
              "Network address (transient), error and security log entries",
              "Rate limiting, security, and diagnostics",
              "Legitimate interests (security)",
              "Zabdiel Tech",
            ],
          ],
        },
      ],
    },
  ],
};
