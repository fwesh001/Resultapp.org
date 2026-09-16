import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-purple-500/10 bg-[#080412]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <h4 className="font-semibold tracking-tight text-white">resultapp.org</h4>
            <p className="mt-2 text-sm leading-6 text-purple-200/60">
              School result compilation for modern Nigerian schools. Pay per student, not per term.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold tracking-wide text-purple-100">Product</h4>
            <ul className="mt-3 space-y-2 text-sm text-purple-200/60">
              <li><Link href="/pricing" className="transition-colors hover:text-white">Pricing</Link></li>
              <li><Link href="/dashboard" className="transition-colors hover:text-white">Dashboard</Link></li>
              <li><Link href="/register" className="transition-colors hover:text-white">Register</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold tracking-wide text-purple-100">Company</h4>
            <ul className="mt-3 space-y-2 text-sm text-purple-200/60">
              <li><Link href="/about" className="transition-colors hover:text-white">About</Link></li>
              <li><Link href="#" className="transition-colors hover:text-white">Contact</Link></li>
              <li><Link href="#" className="transition-colors hover:text-white">Support</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold tracking-wide text-purple-100">Legal</h4>
            <ul className="mt-3 space-y-2 text-sm text-purple-200/60">
              <li><Link href="#" className="transition-colors hover:text-white">Privacy</Link></li>
              <li><Link href="#" className="transition-colors hover:text-white">Terms</Link></li>
              <li><Link href="#" className="transition-colors hover:text-white">Refund Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-purple-500/10 pt-6 text-center text-sm text-purple-200/40">
          © {new Date().getFullYear()} resultapp.org. All rights reserved. Secured by Flutterwave.
        </div>
      </div>
    </footer>
  );
}
