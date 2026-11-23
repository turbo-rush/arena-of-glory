import { DuelWebSocketTransport } from './duelTransport'

export type CreatedDuelRoom = {
  roomCode: string
  websocketUrl: string
}

function serverBaseUrl(): string {
  const configured = import.meta.env.VITE_DUEL_SERVER_URL
  if (!configured) throw new Error('Online duels are not configured yet')
  return configured.replace(/\/$/, '')
}

/** Creates a private room on the Cloudflare room service. */
export async function createDuelRoom(): Promise<CreatedDuelRoom> {
  const response = await fetch(serverBaseUrl() + '/api/rooms', { method: 'POST' })
  if (!response.ok) throw new Error('Could not create a duel room')
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' ||
      typeof (data as CreatedDuelRoom).roomCode !== 'string' ||
      typeof (data as CreatedDuelRoom).websocketUrl !== 'string') {
    throw new Error('Duel server returned an invalid room response')
  }
  return data as CreatedDuelRoom
}

/** Builds a WebSocket URL for joining an existing private room. */
export function duelRoomWebSocketUrl(roomCode: string, displayName: string): string {
  const code = roomCode.trim().toUpperCase()
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('Enter a valid six-character room code')
  const url = new URL(serverBaseUrl() + '/api/rooms/' + code + '/ws')
  url.searchParams.set('name', displayName.trim().slice(0, 20) || 'PLAYER')
  return url.toString()
}

export function createDuelTransport(websocketUrl: string): DuelWebSocketTransport {
  return new DuelWebSocketTransport(websocketUrl)
}
