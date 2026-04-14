import crypto from 'node:crypto'
import type { PaymentProvider, DepositParams, WithdrawParams } from './provider.interface.js'

export const mtnProvider: PaymentProvider = {
  name: 'mtn',

  async deposit(params: DepositParams) {
    const providerRef = `stub-mtn-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] MTN MoMo Collection: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },

  async withdraw(params: WithdrawParams) {
    const providerRef = `stub-mtn-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] MTN MoMo Disbursement: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },
}
