import crypto from 'node:crypto'
import type { PaymentProvider, DepositParams, WithdrawParams } from './provider.interface.js'

export const airtelProvider: PaymentProvider = {
  name: 'airtel',

  async deposit(params: DepositParams) {
    const providerRef = `stub-airtel-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] Airtel Money Collection: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },

  async withdraw(params: WithdrawParams) {
    const providerRef = `stub-airtel-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] Airtel Money Disbursement: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },
}
