import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line-1 bg-surface-1">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <p className="font-semibold tracking-tight text-text-1">resultapp.org</p>
            <p className="mt-2 text-sm leading-6 text-text-3">
              School result compilation for modern Nigerian schools.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-text-2">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-text-3">
              <li><Link href="/pricing" className="transition-colors hover:text-text-1">Pricing</Link></li>
              <li><a href="https://demo.resultapp.org" className="transition-colors hover:text-text-1">Demo</a></li>
              <li><Link href="/register" className="transition-colors hover:text-text-1">Register</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-text-2">Company</p>
            <ul className="mt-3 space-y-2 text-sm text-text-3">
              <li><Link href="/about" className="transition-colors hover:text-text-1">About</Link></li>
              <li><Link href="/support" className="transition-colors hover:text-text-1">Support</Link></li>
              <li><Link href="/contact" className="transition-colors hover:text-text-1">Contact</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-text-2">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-text-3">
              <li><Link href="/privacy" className="transition-colors hover:text-text-1">Privacy</Link></li>
              <li><Link href="/terms" className="transition-colors hover:text-text-1">Terms</Link></li>
              <li><Link href="/refund-policy" className="transition-colors hover:text-text-1">Refund Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-line-1 pt-6 text-center text-sm text-text-3">
          © {new Date().getFullYear()} resultapp.org. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
