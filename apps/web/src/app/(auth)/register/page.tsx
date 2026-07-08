'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Registration now lives in the auth modal on the landing page (REGISTER tab).
// Keep this route working by redirecting into that modal.
export default function RegisterPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/?register=true') }, [router])
  return null
}
