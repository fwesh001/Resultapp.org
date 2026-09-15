export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">About ResultApp</h1>
      <p className="mt-6 text-lg leading-8 text-zinc-600">
        ResultApp is a SaaS platform built for Nigerian schools to eliminate the
        stress of manual result compilation. We started with a simple observation:
        principals and teachers spend weeks every term wrestling with Excel
        sheets, transcription errors, and printing delays.
      </p>

      <div className="mt-10 space-y-6 text-zinc-700">
        <p>
          Our mission is to give every school — from a 50-pupil community
          primary to a 3,000-student college — access to fast, affordable,
          and accurate result processing.
        </p>

        <h2 className="text-2xl font-semibold text-black">How it works</h2>
        <ol className="list-decimal space-y-2 pl-6">
          <li>Register your school and verify your email.</li>
          <li>Purchase student credits via Flutterwave (card, transfer, USSD).</li>
          <li>Upload student lists and scores (Excel/CSV) or enter manually.</li>
          <li>Generate broadsheets, report cards, and publish to parents.</li>
        </ol>

        <h2 className="text-2xl font-semibold text-black">Our values</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Affordability:</strong> Pay per student, not per month. Credits
            never expire.
          </li>
          <li>
            <strong>Reliability:</strong> 99.9% uptime, daily backups, and data
            residency in Africa.
          </li>
          <li>
            <strong>Support:</strong> Real humans on WhatsApp, 8am–8pm WAT.
          </li>
        </ul>
      </div>

      <div className="mt-12 rounded-xl border bg-zinc-50 p-6">
        <h3 className="font-semibold">Contact</h3>
        <p className="mt-2 text-sm text-zinc-600">
          Email: support@resultapp.org <br />
          Phone: +234 800 RESULTAPP <br />
          Lagos, Nigeria
        </p>
      </div>
    </div>
  );
}
