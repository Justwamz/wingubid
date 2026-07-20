import AfricasTalking from 'africastalking'
import { getSmsConfig } from './sms-config.service.js'

/**
 * Send an SMS using the admin-configured provider. When SMS is disabled or the
 * credentials are missing, the message is simulated (logged) - so the demo and
 * local dev keep working without a live provider.
 */
export async function sendSms(to: string, message: string): Promise<void> {
  const cfg = await getSmsConfig()

  if (!cfg.enabled || !cfg.apiKey || !cfg.username) {
    console.log(`[SMS SIMULATION] To: ${to} | ${message}`)
    return
  }

  const at = AfricasTalking({ apiKey: cfg.apiKey, username: cfg.username })
  await at.SMS.send({ to: [to], message, from: cfg.senderId || '' })
}
