import Link from 'next/link'
import { TermsContent } from '@/components/TermsContent'

export default function TermsPage() {
  return (
    <main className="min-h-screen text-white" style={{ background: '#160B2E' }}>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link href="/" className="inline-block mb-8">
          <img src="/wingubet-logo.png" alt="WinguBet" className="h-14 w-auto" />
        </Link>
        <h1 className="text-3xl font-extrabold mb-6">Terms &amp; Conditions</h1>
        <TermsContent />
        <div className="mt-10">
          <Link href="/" className="text-cyan-400 hover:text-cyan-300 text-sm transition-colors">← Back to home</Link>
        </div>
      </div>
    </main>
  )
}
