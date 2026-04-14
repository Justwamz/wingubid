import crypto from 'node:crypto'
import type { PaymentProvider, DepositParams, WithdrawParams } from './provider.interface.js'

export const mpesaProvider: PaymentProvider = {
  name: 'mpesa',

  async deposit(params: DepositParams) {
    const providerRef = `stub-mpesa-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] M-Pesa STK Push: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },

  async withdraw(params: WithdrawParams) {
    const providerRef = `stub-mpesa-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] M-Pesa B2C: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },
}
