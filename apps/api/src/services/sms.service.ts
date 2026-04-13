import AfricasTalking from 'africastalking'
import { env } from '../env.js'

let _sms: ReturnType<typeof AfricasTalking>['SMS'] | null = null

function getSms() {
  if (!_sms) {
    const at = AfricasTalking({
      apiKey: env.AT_API_KEY,
      username: env.AT_USERNAME,
    })
    _sms = at.SMS
  }
  return _sms
}

export async function sendSms(to: string, message: string): Promise<void> {
  if (!env.SMS_ENABLED) {
    console.log(`[SMS SIMULATION] To: ${to} | ${message}`)
    return
  }

  await getSms().send({ to: [to], message, from: '' })
}
