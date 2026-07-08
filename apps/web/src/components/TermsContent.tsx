// Single source of truth for the Terms & Conditions copy. Rendered by both the
// /terms page and the registration overlay. Replace the placeholder sections
// below with the final content when it's provided.
export function TermsContent() {
  return (
    <div className="space-y-5 text-sm text-gray-300 leading-relaxed">
      <p className="text-gray-500 italic">
        This is placeholder text. The final Terms &amp; Conditions will be provided and dropped in here.
      </p>

      <section>
        <h3 className="text-white font-semibold mb-1">1. Eligibility</h3>
        <p>You must be at least 18 years old (or the legal gambling age in your jurisdiction) to open an account and place bets. By registering you confirm you meet this requirement.</p>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">2. Your Account</h3>
        <p>You are responsible for keeping your login credentials secure and for all activity on your account. One account per person.</p>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">3. Deposits &amp; Withdrawals</h3>
        <p>Deposits and withdrawals are processed through supported payment providers. Limits, fees, and processing times may apply.</p>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">4. Fair Play</h3>
        <p>Game outcomes are determined server-side using provably-fair methods where indicated. Any attempt to manipulate outcomes will result in account closure.</p>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">5. Responsible Gaming</h3>
        <p>Gambling should be for entertainment. Please play responsibly and within your means. Tools and support for responsible gaming are available on request.</p>
      </section>

      <section>
        <h3 className="text-white font-semibold mb-1">6. Changes to These Terms</h3>
        <p>We may update these Terms from time to time. Continued use of the platform after changes constitutes acceptance of the updated Terms.</p>
      </section>
    </div>
  )
}
