import { getEmailConfig } from './email-config.service.js'

/**
 * Send an email via the configured transactional provider (Resend or SendGrid).
 * When email is disabled or unconfigured, the message is simulated (logged) so
 * the demo works without credentials. Send failures are swallowed so email can
 * never break the calling flow (e.g. a withdrawal).
 */
export async function sendEmail(opts: { subject: string; html: string; to?: string }): Promise<void> {
  const cfg = await getEmailConfig()
  const to = opts.to ?? cfg.toEmail

  if (!cfg.enabled || !cfg.apiKey || !cfg.fromEmail || !to) {
    console.log(`[EMAIL SIMULATION] to=${to || '(none)'} subject="${opts.subject}"`)
    return
  }

  try {
    if (cfg.provider === 'sendgrid') {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: cfg.fromEmail },
          subject: opts.subject,
          content: [{ type: 'text/html', value: opts.html }],
        }),
      })
    } else {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: cfg.fromEmail, to, subject: opts.subject, html: opts.html }),
      })
    }
  } catch (err) {
    console.error('[EMAIL] send failed:', err instanceof Error ? err.message : err)
  }
}

type WithdrawalEvent = 'initiated' | 'needs_approval' | 'approved' | 'rejected'

const EVENT_TITLE: Record<WithdrawalEvent, string> = {
  initiated: 'Withdrawal initiated',
  needs_approval: 'Withdrawal needs approval',
  approved: 'Withdrawal approved',
  rejected: 'Withdrawal rejected',
}

function kes(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

// Fire a withdrawal notification to the configured recipient. Never throws.
export async function notifyWithdrawal(event: WithdrawalEvent, d: {
  id: string; amount: number; phone: string; player: string; provider: string; adminId?: string
}): Promise<void> {
  const title = EVENT_TITLE[event]
  const subject = `[WinguBet] ${title} - ${kes(d.amount)}`
  const html =
    `<p><strong>${title}</strong></p>` +
    `<ul>` +
    `<li>Amount: ${kes(d.amount)}</li>` +
    `<li>Player: ${d.player} (${d.phone})</li>` +
    `<li>Provider: ${d.provider}</li>` +
    `<li>Transaction: ${d.id}</li>` +
    (d.adminId ? `<li>By admin: ${d.adminId}</li>` : '') +
    `</ul>` +
    (event === 'needs_approval' ? `<p>This withdrawal exceeds the approval threshold and is awaiting a decision in the admin dashboard.</p>` : '')
  await sendEmail({ subject, html })
}
