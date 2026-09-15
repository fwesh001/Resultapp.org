import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t bg-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <h4 className="font-semibold">resultapp.org</h4>
            <p className="mt-2 text-sm text-zinc-600">
              School result compilation for modern Nigerian schools. Pay per student, not per term.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Product</h4>
            <ul className="mt-3 space-y-2 text-sm text-zinc-600">
              <li><Link href="/pricing" className="hover:text-black">Pricing</Link></li>
              <li><Link href="/dashboard" className="hover:text-black">Dashboard</Link></li>
              <li><Link href="/register" className="hover:text-black">Register</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Company</h4>
            <ul className="mt-3 space-y-2 text-sm text-zinc-600">
              <li><Link href="/about" className="hover:text-black">About</Link></li>
              <li><Link href="#" className="hover:text-black">Contact</Link></li>
              <li><Link href="#" className="hover:text-black">Support</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Legal</h4>
            <ul className="mt-3 space-y-2 text-sm text-zinc-600">
              <li><Link href="#" className="hover:text-black">Privacy</Link></li>
              <li><Link href="#" className="hover:text-black">Terms</Link></li>
              <li><Link href="#" className="hover:text-black">Refund Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t pt-6 text-center text-sm text-zinc-500">
          © {new Date().getFullYear()} resultapp.org. All rights reserved. Secured by Flutterwave.
        </div>
      </div>
    </footer>
  );
}
