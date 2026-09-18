import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-purple-500/10 bg-[#080412]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <p className="font-semibold tracking-tight text-white">resultapp.org</p>
            <p className="mt-2 text-sm leading-6 text-purple-200/70">
              School result compilation for modern Nigerian schools.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-purple-100">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-purple-200/70">
              <li><Link href="/pricing" className="transition-colors hover:text-white">Pricing</Link></li>
              <li><Link href="/register" className="transition-colors hover:text-white">Register</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-purple-100">Company</p>
            <ul className="mt-3 space-y-2 text-sm text-purple-200/70">
              <li><Link href="/about" className="transition-colors hover:text-white">About</Link></li>
              <li><Link href="/support" className="transition-colors hover:text-white">Support</Link></li>
              <li><Link href="/contact" className="transition-colors hover:text-white">Contact</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-purple-100">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-purple-200/70">
              <li><span title="Coming soon">Privacy</span></li>
              <li><span title="Coming soon">Terms</span></li>
              <li><span title="Coming soon">Refund Policy</span></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-purple-500/10 pt-6 text-center text-sm text-purple-200/70">
          © {new Date().getFullYear()} resultapp.org. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
