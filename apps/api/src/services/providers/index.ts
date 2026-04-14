import { mpesaProvider } from './mpesa.provider.js'
import { mtnProvider } from './mtn.provider.js'
import { airtelProvider } from './airtel.provider.js'
import type { PaymentProvider } from './provider.interface.js'
import { AppError } from '../../lib/errors.js'

const PROVIDERS: Record<string, PaymentProvider> = {
  mpesa: mpesaProvider,
  mtn: mtnProvider,
  airtel: airtelProvider,
}

export function getProvider(name: string): PaymentProvider {
  const provider = PROVIDERS[name]
  if (!provider) throw new AppError('INVALID_PROVIDER', `Unknown provider: ${name}`, 400)
  return provider
}

export type { PaymentProvider }
