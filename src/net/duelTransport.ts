export const DUEL_PROTOCOL_VERSION = 1 as const

export type WeaponId = 'pistol' | 'rifle' | 'shotgun' | 'sniper'
export type DuelPhase = 'waiting' | 'ready' | 'fighting' | 'round_break' | 'finished'
export type HitZone = 'head' | 'body'

export type DuelInput = {
  seq: number
  clientTime: number
  moveX: number
  moveZ: number
  lookYaw: number
  lookPitch: number
  crouched: boolean
  aiming: boolean
}

export type ClientDuelMessage =
  | { type: 'create_room'; protocol: typeof DUEL_PROTOCOL_VERSION; displayName: string }
  | { type: 'join_room'; protocol: typeof DUEL_PROTOCOL_VERSION; roomCode: string; displayName: string }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'continue_round' }
  | { type: 'input'; input: DuelInput }
  | { type: 'fire'; shotId: number; weapon: WeaponId; aimYaw: number; aimPitch: number }
  | { type: 'reload' }
  | { type: 'switch_weapon'; weapon: WeaponId }
  | { type: 'leave_room' }
  | { type: 'ping'; clientTime: number }

export type ServerDuelMessage =
  | { type: 'welcome'; playerId: string; roomCode: string; slot: 1 | 2; resumeToken?: string; resumed?: boolean }
  | { type: 'room_state'; phase: DuelPhase; players: { playerId: string; displayName: string; ready: boolean; connected: boolean }[] }
  | { type: 'match_started'; arenaId: string; seed: number; serverTime: number }
  | { type: 'round_started'; roundNumber: number; serverTime: number }
  | { type: 'input'; input: DuelInput }
  | { type: 'fire'; shotId: number; weapon: WeaponId; aimYaw: number; aimPitch: number }
  | { type: 'snapshot'; serverTick: number; ackInputSeq: number; players: { playerId: string; x: number; y: number; z: number; yaw: number; health: number; ammo: number; weapon: WeaponId; alive: boolean }[] }
  | { type: 'health_update'; health: number; damage: number; hitZone: HitZone; shooterId: string }
  | { type: 'shot_result'; shotId: number; shooterId: string; hitPlayerId: string | null; hitZone: HitZone | null; damage: number; targetHealth: number | null; accepted: boolean }
  | { type: 'loadout_update'; weapon: WeaponId; ammo: number; reserveAmmo: number; reloading: boolean }
  | { type: 'reload'; weapon: WeaponId }
  | { type: 'switch_weapon'; weapon: WeaponId }
  | { type: 'round_ended'; roundNumber: number; winnerPlayerId: string | null; score: { player1: number; player2: number } }
  | { type: 'match_ended'; winnerPlayerId: string | null; score: { player1: number; player2: number } }
  | { type: 'resume_state'; phase: DuelPhase; health: number; opponentHealth: number; x: number; z: number; yaw: number; pitch: number; roundWins: number; opponentWins: number; lastInputSeq: number }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'error'; code: string; message: string }

export type DuelConnectionState = 'disconnected' | 'connecting' | 'connected'

type Listener<T> = (value: T) => void

const WEAPONS: WeaponId[] = ['pistol', 'rifle', 'shotgun', 'sniper']
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isWeapon = (value: unknown): value is WeaponId =>
  isString(value) && WEAPONS.includes(value as WeaponId)

/** Reject malformed or unknown server packets before they reach game code. */
export function parseServerDuelMessage(raw: string): ServerDuelMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value) || !isString(value.type)) return null

  switch (value.type) {
    case 'welcome':
      return isString(value.playerId) && isString(value.roomCode) && (value.slot === 1 || value.slot === 2) &&
        (value.resumeToken === undefined || isString(value.resumeToken)) &&
        (value.resumed === undefined || typeof value.resumed === 'boolean')
        ? value as ServerDuelMessage : null
    case 'room_state':
      return ['waiting', 'ready', 'fighting', 'round_break', 'finished'].includes(String(value.phase)) && Array.isArray(value.players)
        ? value as ServerDuelMessage : null
    case 'match_started':
      return isString(value.arenaId) && isNumber(value.seed) && isNumber(value.serverTime)
        ? value as ServerDuelMessage : null
    case 'round_started':
      return isNumber(value.roundNumber) && isNumber(value.serverTime) ? value as ServerDuelMessage : null
    case 'input': {
      if (!isRecord(value.input)) return null
      const input = value.input
      return isNumber(input.seq) && isNumber(input.clientTime) && isNumber(input.moveX) &&
        isNumber(input.moveZ) && isNumber(input.lookYaw) && isNumber(input.lookPitch) &&
        typeof input.crouched === 'boolean' && typeof input.aiming === 'boolean'
        ? value as ServerDuelMessage : null
    }
    case 'fire':
      return isNumber(value.shotId) && isWeapon(value.weapon) &&
        isNumber(value.aimYaw) && isNumber(value.aimPitch)
        ? value as ServerDuelMessage : null
    case 'snapshot':
      return isNumber(value.serverTick) && isNumber(value.ackInputSeq) && Array.isArray(value.players)
        ? value as ServerDuelMessage : null
    case 'health_update':
      return isNumber(value.health) && isNumber(value.damage) && (value.hitZone === 'head' || value.hitZone === 'body') && isString(value.shooterId) ? value as ServerDuelMessage : null
    case 'shot_result':
      return isNumber(value.shotId) && isString(value.shooterId) &&
        (value.hitPlayerId === null || isString(value.hitPlayerId)) &&
        (value.hitZone === null || value.hitZone === 'head' || value.hitZone === 'body') &&
        isNumber(value.damage) && (value.targetHealth === null || isNumber(value.targetHealth)) &&
        typeof value.accepted === 'boolean' ? value as ServerDuelMessage : null
    case 'loadout_update':
      return isWeapon(value.weapon) && isNumber(value.ammo) && isNumber(value.reserveAmmo) && typeof value.reloading === 'boolean' ? value as ServerDuelMessage : null
    case 'reload':
    case 'switch_weapon':
      return isWeapon(value.weapon) ? value as ServerDuelMessage : null
    case 'round_ended':
    case 'match_ended':
      return (value.winnerPlayerId === null || isString(value.winnerPlayerId)) &&
        isRecord(value.score) && isNumber(value.score.player1) && isNumber(value.score.player2)
        ? value as ServerDuelMessage : null
    case 'resume_state':
      return ['waiting', 'ready', 'fighting', 'round_break', 'finished'].includes(String(value.phase)) &&
        isNumber(value.health) && isNumber(value.opponentHealth) && isNumber(value.x) && isNumber(value.z) && isNumber(value.yaw) && isNumber(value.pitch) && isNumber(value.roundWins) && isNumber(value.opponentWins) && isNumber(value.lastInputSeq)
        ? value as ServerDuelMessage : null
    case 'pong':
      return isNumber(value.clientTime) && isNumber(value.serverTime) ? value as ServerDuelMessage : null
    case 'error':
      return isString(value.code) && isString(value.message) ? value as ServerDuelMessage : null
    default:
      return null
  }
}

/**
 * Browser-side transport only. The authoritative room/game server is a separate
 * Cloudflare Durable Object service; this class never simulates an online rival.
 */
export class DuelWebSocketTransport {
  private socket: WebSocket | null = null
  private state: DuelConnectionState = 'disconnected'
  private heartbeatTimer: number | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private reconnectStartedAt = 0
  private shouldReconnect = false
  private url: string
  private lastPongAt = 0
  private lastRoundTripMs: number | null = null
  private messageListeners = new Set<Listener<ServerDuelMessage>>()
  private stateListeners = new Set<Listener<DuelConnectionState>>()

  constructor(url: string) {
    if (!url.trim()) throw new Error('Duel server URL is required')
    this.url = url
  }

  get connectionState(): DuelConnectionState { return this.state }
  get roundTripMs(): number | null { return this.lastRoundTripMs }
  get reconnecting(): boolean { return this.shouldReconnect && Date.now() - this.reconnectStartedAt < 60_000 }
  get reconnectUrl(): string { return this.url }

  onMessage(listener: Listener<ServerDuelMessage>): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onStateChange(listener: Listener<DuelConnectionState>): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.state === 'connecting') return Promise.reject(new Error('Duel connection is already opening'))
    this.shouldReconnect = true
    this.reconnectStartedAt = Date.now()
    this.reconnectAttempt = 0
    return this.openConnection()
  }

  private openConnection(): Promise<void> {
    this.setState('connecting')
    return new Promise((resolve, reject) => {
      let socket: WebSocket
      try {
        socket = new WebSocket(this.url)
      } catch (error) {
        this.setState('disconnected')
        this.scheduleReconnect()
        reject(error)
        return
      }
      this.socket = socket
      let settled = false

      socket.addEventListener('open', () => {
        settled = true
        this.reconnectAttempt = 0
        this.reconnectStartedAt = Date.now()
        this.lastPongAt = Date.now()
        this.lastRoundTripMs = null
        this.setState('connected')
        this.startHeartbeat(socket)
        resolve()
      }, { once: true })

      socket.addEventListener('message', event => {
        if (typeof event.data !== 'string') return
        const message = parseServerDuelMessage(event.data)
        if (!message) return
        if (message.type === 'welcome' && message.resumeToken) {
          const nextUrl = new URL(this.url)
          nextUrl.searchParams.set('resumeToken', message.resumeToken)
          this.url = nextUrl.toString()
        }
        if (message.type === 'pong') {
          this.lastPongAt = Date.now()
          this.lastRoundTripMs = Math.max(0, this.lastPongAt - message.clientTime)
        }
        this.messageListeners.forEach(listener => listener(message))
      })

      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true
          if (this.socket === socket) {
            this.socket = null
            this.stopHeartbeat()
            this.setState('disconnected')
            this.scheduleReconnect()
          }
          reject(new Error('Unable to connect to the duel server'))
        }
      })

      socket.addEventListener('close', () => {
        if (this.socket !== socket) return
        this.socket = null
        this.stopHeartbeat()
        this.setState('disconnected')
        this.scheduleReconnect()
        if (!settled) {
          settled = true
          reject(new Error('Duel server closed the connection'))
        }
      })
    })
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) return
    if (Date.now() - this.reconnectStartedAt >= 60_000) {
      this.shouldReconnect = false
      this.setState('disconnected')
      return
    }
    const baseDelay = Math.min(750 * (2 ** this.reconnectAttempt), 8_000)
    const delay = baseDelay + Math.floor(Math.random() * 350)
    this.reconnectAttempt++
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (!this.shouldReconnect) return
      void this.openConnection().catch(() => undefined)
    }, delay)
  }

  send(message: ClientDuelMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Cannot send duel data while disconnected')
    }
    this.socket.send(JSON.stringify(message))
  }

  /** Closes the page's socket without telling the room the player intentionally left. */
  suspend(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const socket = this.socket
    this.socket = null
    this.stopHeartbeat()
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1001, 'page_suspend')
    this.setState('disconnected')
  }

  close(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const socket = this.socket
    this.socket = null
    this.stopHeartbeat()
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'leave_room' } satisfies ClientDuelMessage)) } catch { /* socket is closing */ }
      socket.close(1000, 'player_left')
    } else if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'player_left')
    }
    this.setState('disconnected')
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastPongAt > 15_000) {
        socket.close(4000, 'heartbeat_timeout')
        return
      }
      try {
        socket.send(JSON.stringify({ type: 'ping', clientTime: Date.now() } satisfies ClientDuelMessage))
      } catch {
        socket.close(4001, 'heartbeat_send_failed')
      }
    }, 5_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private setState(next: DuelConnectionState): void {
    if (this.state === next) return
    this.state = next
    this.stateListeners.forEach(listener => listener(next))
  }
}
