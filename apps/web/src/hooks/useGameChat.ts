'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import { getToken } from '@/lib/auth'
import { apiFetch } from '@/lib/apiFetch'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export interface ChatMessage {
  id: string
  username: string
  text: string
  createdAt: string
}

interface ChatError { code: string; message: string }

export function useGameChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [enabled, setEnabled] = useState(true)
  const [username, setUsername] = useState<string | null>(null)
  const [banned, setBanned] = useState<string | null>(null)
  const [error, setError] = useState<ChatError | null>(null)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io(API_URL, { auth: cb => cb({ token: getToken() }) })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('chat:init', (d: { enabled: boolean; username: string | null; messages: ChatMessage[] }) => {
      setEnabled(d.enabled)
      setUsername(d.username)
      setMessages(d.messages ?? [])
    })
    socket.on('chat:message', (m: ChatMessage) => setMessages(prev => [...prev.slice(-199), m]))
    socket.on('chat:deleted', ({ id }: { id: string }) => setMessages(prev => prev.filter(m => m.id !== id)))
    socket.on('chat:disabled', () => setEnabled(false))
    socket.on('chat:enabled', () => setEnabled(true))
    socket.on('chat:error', (e: ChatError) => {
      if (e.code === 'BANNED') setBanned(e.message)
      else setError(e)
    })

    return () => { socket.disconnect() }
  }, [])

  const send = useCallback((text: string) => {
    setError(null)
    socketRef.current?.emit('chat:send', { text })
  }, [])

  const saveUsername = useCallback(async (name: string) => {
    const data = await apiFetch<{ username: string }>('/chat/username', {
      method: 'POST', body: JSON.stringify({ username: name }),
    })
    setUsername(data.username)
    return data.username
  }, [])

  return {
    messages, enabled, username, banned, error, connected,
    send, saveUsername, clearError: () => setError(null),
  }
}
