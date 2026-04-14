export interface DepositParams {
  playerId: string
  phone: string
  amount: number
  currency: string
  reference: string
}

export interface WithdrawParams {
  playerId: string
  phone: string
  amount: number
  currency: string
  reference: string
}

export interface PaymentProvider {
  readonly name: string
  deposit(params: DepositParams): Promise<{ providerRef: string }>
  withdraw(params: WithdrawParams): Promise<{ providerRef: string }>
}
