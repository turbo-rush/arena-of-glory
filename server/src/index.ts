export interface Env {
  DUEL_ROOMS: DurableObjectNamespace
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function makeRoomCode(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, value => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("")
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    } })
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      let code = ""
      let stub: DurableObjectStub | undefined
      for (let attempt = 0; attempt < 5; attempt++) {
        code = makeRoomCode()
        const id = env.DUEL_ROOMS.idFromName(code)
        stub = env.DUEL_ROOMS.get(id)
        const created = await stub.fetch("https://duel.internal/internal/create", { method: "POST" })
        if (created.status === 201) break
        stub = undefined
      }
      if (!stub) return json({ error: "room_creation_failed" }, 503)
      const origin = url.origin.replace(/^http/, "ws")
      return json({ roomCode: code, websocketUrl: origin + "/api/rooms/" + code + "/ws" }, 201)
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/)
    if (match && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const id = env.DUEL_ROOMS.idFromName(match[1])
      const target = new URL("https://duel.internal/ws")
      target.searchParams.set("roomCode", match[1])
      target.searchParams.set("name", url.searchParams.get("name") ?? "PLAYER")
      const resumeToken = url.searchParams.get("resumeToken")
      if (resumeToken) target.searchParams.set("resumeToken", resumeToken)
      return env.DUEL_ROOMS.get(id).fetch(new Request(target.toString(), request))
    }
    return json({ error: "not_found" }, 404)
  },
}

type WeaponId = "pistol" | "rifle" | "shotgun" | "sniper"
type AmmoState = Record<WeaponId, number>
const MAGAZINES: AmmoState = { pistol: 12, rifle: 30, shotgun: 6, sniper: 5 }
const RESERVES: AmmoState = { pistol: 48, rifle: 120, shotgun: 30, sniper: 20 }
type Player = { id: string; name: string; ready: boolean; socket: WebSocket | null; resumeToken: string; slot: 1 | 2; x: number; z: number; yaw: number; pitch: number; health: number; roundWins: number; shotTimes: Partial<Record<WeaponId, number>>; lastShotId: number; lastInputSeq: number; weapon: WeaponId; ammo: AmmoState; reserve: AmmoState; reloadUntil: number }

export class DuelRoom {
  private players = new Map<string, Player>()
  private phase: "waiting" | "ready" | "fighting" | "round_break" | "finished" = "waiting"
  private roomCode = ""

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    this.restorePlayers()
    await this.restorePendingPlayers()
    const url = new URL(request.url)
    if (url.pathname === "/internal/create" && request.method === "POST") {
      if (await this.state.storage.get<boolean>("created")) return json({ error: "exists" }, 409)
      this.roomCode = url.searchParams.get("roomCode") ?? ""
      await this.state.storage.put({ created: true, createdAt: Date.now() })
      return json({ created: true }, 201)
    }
    if (url.pathname === "/ws") {
      const created = await this.state.storage.get<boolean>("created")
      if (!created) return json({ error: "room_not_found" }, 404)
      this.roomCode = url.searchParams.get("roomCode") ?? ""
      const requestedToken = url.searchParams.get("resumeToken")
      let resumed: Record<string, any> | null = null
      if (requestedToken) {
        const saved = await this.state.storage.get<{ expiresAt: number; player: Record<string, any> }>("resume:" + requestedToken)
        if (!saved || saved.expiresAt < Date.now()) {
          await this.state.storage.delete("resume:" + requestedToken)
          return json({ error: "resume_expired", message: "The reconnect window has expired. Create or join a new room." }, 410)
        }
        resumed = saved.player
        await this.state.storage.delete("resume:" + requestedToken)
      } else if (this.players.size >= 2) {
        return json({ error: "room_full" }, 409)
      }
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.state.acceptWebSocket(server)
      let player: Player
      if (resumed) {
        const resumeToken = crypto.randomUUID() + crypto.randomUUID()
        player = { ...resumed, id: String(resumed.playerId), socket: server, resumeToken } as Player
        this.players.set(player.id, player)
        this.phase = await this.state.storage.get<typeof this.phase>("roomPhase") ?? this.phase
        server.serializeAttachment({ ...resumed, resumeToken })
        await this.state.storage.setAlarm(Date.now() + 60_000)
        server.send(JSON.stringify({ type: "welcome", playerId: player.id, roomCode: this.roomCode, slot: player.slot, resumeToken, resumed: true }))
        this.sendResumeState(server, player)
      } else {
        const playerId = crypto.randomUUID()
        const slot = (this.players.size + 1) as 1 | 2
        const name = (url.searchParams.get("name") ?? (slot === 1 ? "PLAYER 1" : "PLAYER 2")).slice(0, 20)
        const resumeToken = crypto.randomUUID() + crypto.randomUUID()
        const ammo = { ...MAGAZINES }
        const reserve = { ...RESERVES }
        player = { id: playerId, name, ready: false, socket: server, resumeToken, slot, x: 0, z: 2.3, yaw: Math.PI, pitch: 0, health: 100, roundWins: 0, shotTimes: {}, lastShotId: 0, lastInputSeq: 0, weapon: "pistol", ammo, reserve, reloadUntil: 0 }
        this.players.set(playerId, player)
        server.serializeAttachment({ playerId, name, slot, ready: false, x: 0, z: 2.3, yaw: Math.PI, pitch: 0, health: 100, roundWins: 0, shotTimes: {}, lastShotId: 0, lastInputSeq: 0, weapon: "pistol", ammo, reserve, reloadUntil: 0, resumeToken })
        server.send(JSON.stringify({ type: "welcome", playerId, roomCode: this.roomCode, slot, resumeToken, resumed: false }))
      }
      this.updatePhase()
      this.broadcastRoomState()
      return new Response(null, { status: 101, webSocket: client })
    }
    return json({ error: "not_found" }, 404)
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    this.restorePlayers()
    await this.restorePendingPlayers()
    if (typeof raw !== "string" || raw.length > 16_384) {
      socket.close(1009, "message_too_large")
      return
    }
    let message: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
      message = parsed as Record<string, unknown>
    } catch { return }

    const attachment = socket.deserializeAttachment() as { playerId?: string } | null
    const player = attachment?.playerId ? this.players.get(attachment.playerId) : undefined
    if (!player) return

    switch (message.type) {
      case "set_ready": {
        const wasFighting = this.phase === "fighting"
        player.ready = message.ready === true
        const attachment = socket.deserializeAttachment() as { playerId: string; name: string; slot: 1 | 2 }
        socket.serializeAttachment({ ...attachment, ready: player.ready })
        this.updatePhase()
        this.broadcastRoomState()
        if (!wasFighting && this.phase === "fighting" && this.players.size === 2) {
          this.broadcast({ type: "match_started", arenaId: "skyline-golden-hour", seed: crypto.getRandomValues(new Uint32Array(1))[0], serverTime: Date.now() })
        }
        break
      }
      case "continue_round": {
        if (this.phase !== "round_break") break
        player.ready = true
        const attachment = socket.deserializeAttachment() as Record<string, unknown> | null
        socket.serializeAttachment({ ...(attachment ?? {}), ready: true })
        if (this.players.size === 2 && [...this.players.values()].every(candidate => candidate.ready)) {
          this.phase = "fighting"
          const roundNumber = [...this.players.values()].reduce((sum, candidate) => sum + candidate.roundWins, 0) + 1
          this.broadcast({ type: "round_started", roundNumber, serverTime: Date.now() })
          this.broadcastRoomState()
        }
        break
      }
      case "input": {
        if (this.phase !== "fighting") break
        const input = message.input
        if (!input || typeof input !== "object" || Array.isArray(input)) break
        const state = input as Record<string, unknown>
        const valid = Number.isSafeInteger(state.seq) && Number(state.seq) > player.lastInputSeq &&
          Number.isFinite(state.clientTime) &&
          Number.isFinite(state.moveX) && Number(state.moveX) >= -6.8 && Number(state.moveX) <= 6.8 &&
          Number.isFinite(state.moveZ) && Number(state.moveZ) >= -1.8 && Number(state.moveZ) <= 6.5 &&
          Number.isFinite(state.lookYaw) && Math.abs(Number(state.lookYaw)) <= Math.PI * 4 &&
          Number.isFinite(state.lookPitch) && Math.abs(Number(state.lookPitch)) <= Math.PI / 2 &&
          typeof state.crouched === "boolean" && typeof state.aiming === "boolean"
        if (!valid) break
        player.lastInputSeq = Number(state.seq)
        player.x = Number(state.moveX)
        player.z = Number(state.moveZ)
        player.yaw = Number(state.lookYaw)
        player.pitch = Number(state.lookPitch)
        const attachment = socket.deserializeAttachment() as Record<string, unknown> | null
        socket.serializeAttachment({ ...(attachment ?? {}), lastInputSeq: player.lastInputSeq, x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch })
        this.broadcast({ type: "input", input: {
          seq: player.lastInputSeq, clientTime: Date.now(),
          moveX: Number(state.moveX), moveZ: Number(state.moveZ),
          lookYaw: Number(state.lookYaw), lookPitch: Number(state.lookPitch),
          crouched: state.crouched, aiming: state.aiming,
        } }, socket)
        break
      }
      case "fire": {
        if (this.phase !== "fighting") break
        const weapon = message.weapon
        const shotId = message.shotId
        const aimYaw = message.aimYaw
        const aimPitch = message.aimPitch
        const cooldowns: Record<WeaponId, number> = { pistol: 220, rifle: 115, shotgun: 650, sniper: 850 }
        if (!["pistol", "rifle", "shotgun", "sniper"].includes(String(weapon)) ||
            !Number.isSafeInteger(shotId) || Number(shotId) <= player.lastShotId ||
            typeof aimYaw !== "number" || !Number.isFinite(aimYaw) ||
            typeof aimPitch !== "number" || !Number.isFinite(aimPitch) || Math.abs(aimPitch) > Math.PI / 2) {
          socket.send(JSON.stringify({ type: "shot_result", shotId: Number.isSafeInteger(shotId) ? shotId : 0, shooterId: player.id, hitPlayerId: null, hitZone: null, damage: 0, targetHealth: null, accepted: false }))
          break
        }
        const typedWeapon = weapon as WeaponId
        const now = Date.now()
        const lastShotAt = player.shotTimes[typedWeapon] ?? 0
        if (player.weapon !== typedWeapon || now < player.reloadUntil || player.ammo[typedWeapon] <= 0 || now - lastShotAt < cooldowns[typedWeapon]) {
          socket.send(JSON.stringify({ type: "shot_result", shotId: Number(shotId), shooterId: player.id, hitPlayerId: null, hitZone: null, damage: 0, targetHealth: null, accepted: false }))
          break
        }
        player.shotTimes[typedWeapon] = now
        player.lastShotId = Number(shotId)
        player.ammo[typedWeapon] = Math.max(0, player.ammo[typedWeapon] - 1)
        const attachment = socket.deserializeAttachment() as Record<string, unknown> | null
        socket.serializeAttachment({ ...(attachment ?? {}), shotTimes: player.shotTimes, lastShotId: player.lastShotId, ammo: player.ammo, reserve: player.reserve, weapon: player.weapon, reloadUntil: player.reloadUntil, x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch })
        socket.send(JSON.stringify({ type: "loadout_update", weapon: player.weapon, ammo: player.ammo[player.weapon], reserveAmmo: player.reserve[player.weapon], reloading: false }))
        const target = [...this.players.values()].find(candidate => candidate.id !== player.id)
        let damage = 0
        let hitZone: "head" | "body" | null = null
        if (target && target.health > 0) {
          const shooterZ = player.slot === 1 ? 5 + player.z : -12.5 - player.z
          const targetZ = player.slot === 1 ? -12.5 - target.z : 5 + target.z
          const dx = target.x - player.x
          const dz = targetZ - shooterZ
          const directionX = Math.sin(aimYaw as number)
          const directionZ = Math.cos(aimYaw as number) * (player.slot === 1 ? 1 : -1)
          const along = dx * directionX + dz * directionZ
          const perpendicular = Math.abs(dx * directionZ - dz * directionX)
          const range = typedWeapon === "sniper" ? 70 : typedWeapon === "rifle" ? 45 : typedWeapon === "shotgun" ? 16 : 32
          const pitchError = Math.abs(aimPitch as number)
          if (along > 0 && along <= range && perpendicular < (typedWeapon === "shotgun" ? 1.15 : .72) && pitchError < .42) {
            hitZone = (aimPitch as number) > .025 ? "head" : "body"
            const baseDamage: Record<WeaponId, number> = { pistol: 18, rifle: 12, shotgun: 28, sniper: 48 }
            damage = hitZone === "head" ? Math.round(baseDamage[typedWeapon] * (typedWeapon === "sniper" ? 2.5 : typedWeapon === "pistol" ? 2.2 : typedWeapon === "rifle" ? 1.8 : 1.25)) : baseDamage[typedWeapon]
            target.health = Math.max(0, target.health - damage)
            const targetAttachment = target.socket?.deserializeAttachment() as Record<string, unknown> | null
            if (target.socket) target.socket.serializeAttachment({ ...(targetAttachment ?? {}), health: target.health })
            else await this.persistDisconnectedPlayer(target)
            target.socket?.send(JSON.stringify({ type: "health_update", health: target.health, damage, hitZone, shooterId: player.id }))
            if (target.health === 0) await this.finishRound(player)
          }
        }
        socket.send(JSON.stringify({ type: "shot_result", shotId: Number(shotId), shooterId: player.id, hitPlayerId: damage > 0 && target ? target.id : null, hitZone, damage, targetHealth: damage > 0 && target ? target.health : null, accepted: true }))
        this.broadcast({ ...message, hit: damage > 0 }, socket)
        break
      }
      case "reload": {
        if (this.phase !== "fighting" || Date.now() < player.reloadUntil) break
        const current = player.weapon
        const missing = MAGAZINES[current] - player.ammo[current]
        if (missing <= 0 || player.reserve[current] <= 0) break
        const transfer = Math.min(missing, player.reserve[current])
        player.ammo[current] += transfer
        player.reserve[current] -= transfer
        player.reloadUntil = Date.now() + 1150
        const attachment = socket.deserializeAttachment() as Record<string, unknown> | null
        socket.serializeAttachment({ ...(attachment ?? {}), ammo: player.ammo, reserve: player.reserve, weapon: player.weapon, reloadUntil: player.reloadUntil })
        socket.send(JSON.stringify({ type: "loadout_update", weapon: current, ammo: player.ammo[current], reserveAmmo: player.reserve[current], reloading: true }))
        this.broadcast({ type: "reload", weapon: current }, socket)
        break
      }
      case "switch_weapon": {
        if (this.phase !== "fighting" || Date.now() < player.reloadUntil || !["pistol", "rifle", "shotgun", "sniper"].includes(String(message.weapon))) break
        player.weapon = message.weapon as WeaponId
        const attachment = socket.deserializeAttachment() as Record<string, unknown> | null
        socket.serializeAttachment({ ...(attachment ?? {}), weapon: player.weapon, ammo: player.ammo, reserve: player.reserve })
        socket.send(JSON.stringify({ type: "loadout_update", weapon: player.weapon, ammo: player.ammo[player.weapon], reserveAmmo: player.reserve[player.weapon], reloading: false }))
        this.broadcast({ type: "switch_weapon", weapon: player.weapon }, socket)
        break
      }
      case "ping":
        socket.send(JSON.stringify({ type: "pong", clientTime: Number(message.clientTime) || 0, serverTime: Date.now() }))
        break
      case "leave_room":
        socket.close(1000, "player_left")
        break
      default:
        socket.send(JSON.stringify({ type: "error", code: "unknown_message", message: "Unsupported duel message" }))
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    this.restorePlayers()
    await this.restorePendingPlayers()
    const attachment = socket.deserializeAttachment() as Record<string, any> | null
    const player = attachment?.playerId ? this.players.get(attachment.playerId) : undefined
    if (!player || player.socket !== socket) return
    player.socket = null
    if (code === 1000 && reason === "player_left") {
      this.players.delete(player.id)
      if (this.phase !== "finished") this.phase = this.players.size === 0 ? "waiting" : "ready"
    } else {
      const expiresAt = Date.now() + 60_000
      await this.state.storage.put("resume:" + player.resumeToken, { expiresAt, player: { ...attachment, socket: undefined } })
      await this.state.storage.put("roomPhase", this.phase)
      await this.state.storage.setAlarm(expiresAt)
    }
    this.broadcastRoomState()
  }

  async alarm(): Promise<void> {
    await this.restorePendingPlayers()
    const now = Date.now()
    for (const [id, player] of this.players) {
      if (!player.socket) {
        const saved = await this.state.storage.get<{ expiresAt: number }>("resume:" + player.resumeToken)
        if (!saved || saved.expiresAt <= now) {
          await this.state.storage.delete("resume:" + player.resumeToken)
          this.players.delete(id)
        }
      }
    }
    if (this.phase !== "finished" && this.players.size < 2) this.phase = this.players.size === 0 ? "waiting" : "ready"
    this.broadcastRoomState()
  }

  private async restorePendingPlayers(): Promise<void> {
    const pending = await this.state.storage.list<{ expiresAt: number; player: Record<string, any> }>({ prefix: "resume:" })
    for (const [key, saved] of pending) {
      if (saved.expiresAt <= Date.now()) {
        await this.state.storage.delete(key)
        continue
      }
      const data = saved.player
      if (!data?.playerId || this.players.has(data.playerId)) continue
      this.players.set(data.playerId, {
        ...data,
        id: data.playerId,
        socket: null,
        resumeToken: key.slice("resume:".length),
        slot: data.slot === 2 ? 2 : 1,
        ammo: data.ammo ?? { ...MAGAZINES },
        reserve: data.reserve ?? { ...RESERVES },
        shotTimes: data.shotTimes ?? {},
      } as Player)
    }
    if (pending.size > 0) {
      this.phase = await this.state.storage.get<typeof this.phase>("roomPhase") ?? this.phase
    }
  }

  private sendResumeState(socket: WebSocket, player: Player): void {
    socket.send(JSON.stringify({ type: "loadout_update", weapon: player.weapon, ammo: player.ammo[player.weapon], reserveAmmo: player.reserve[player.weapon], reloading: Date.now() < player.reloadUntil }))
    const opponentWins = [...this.players.values()].find(candidate => candidate.id !== player.id)?.roundWins ?? 0
    socket.send(JSON.stringify({ type: "resume_state", phase: this.phase, health: player.health, x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, roundWins: player.roundWins, opponentWins }))
    for (const other of this.players.values()) {
      if (other.id !== player.id && other.socket) {
        socket.send(JSON.stringify({ type: "input", input: { seq: other.lastInputSeq, clientTime: Date.now(), moveX: other.x, moveZ: other.z, lookYaw: other.yaw, lookPitch: other.pitch, crouched: false, aiming: false } }))
        socket.send(JSON.stringify({ type: "switch_weapon", weapon: other.weapon }))
      }
    }
    this.broadcastRoomState()
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket, 1006, "socket_error")
  }

  private restorePlayers(): void {
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as { playerId?: string; name?: string; slot?: 1 | 2; ready?: boolean; shotTimes?: Partial<Record<WeaponId, number>>; lastShotId?: number; lastInputSeq?: number; x?: number; z?: number; yaw?: number; pitch?: number; health?: number; roundWins?: number; weapon?: WeaponId; ammo?: AmmoState; reserve?: AmmoState; reloadUntil?: number; resumeToken?: string } | null
      if (!attachment?.playerId || this.players.has(attachment.playerId)) continue
      this.players.set(attachment.playerId, {
        id: attachment.playerId,
        name: attachment.name ?? "PLAYER",
        ready: attachment.ready === true,
        socket,
        resumeToken: attachment.resumeToken ?? crypto.randomUUID(),
        slot: attachment.slot ?? 1,
        x: attachment.x ?? 0,
        z: attachment.z ?? 2.3,
        yaw: attachment.yaw ?? Math.PI,
        pitch: attachment.pitch ?? 0,
        health: attachment.health ?? 100,
        roundWins: attachment.roundWins ?? 0,
        shotTimes: attachment.shotTimes ?? {},
        lastShotId: attachment.lastShotId ?? 0,
        lastInputSeq: attachment.lastInputSeq ?? 0,
        weapon: attachment.weapon ?? "pistol",
        ammo: attachment.ammo ?? { ...MAGAZINES },
        reserve: attachment.reserve ?? { ...RESERVES },
        reloadUntil: attachment.reloadUntil ?? 0,
      })
    }
    this.updatePhase()
  }


  private async finishRound(winner: Player): Promise<void> {
    if (this.phase !== "fighting") return
    winner.roundWins += 1
    for (const player of this.players.values()) {
      const attachment = player.socket?.deserializeAttachment() as Record<string, unknown> | null
      if (player.socket) player.socket.serializeAttachment({ ...(attachment ?? {}), health: player.health, roundWins: player.roundWins })
    }
    const score = {
      player1: [...this.players.values()].find(p => p.slot === 1)?.roundWins ?? 0,
      player2: [...this.players.values()].find(p => p.slot === 2)?.roundWins ?? 0,
    }
    if (winner.roundWins >= 3) {
      this.phase = "finished"
      this.broadcast({ type: "match_ended", winnerPlayerId: winner.id, score })
      this.broadcastRoomState()
      return
    }
    this.phase = "round_break"
    this.broadcast({ type: "round_ended", roundNumber: score.player1 + score.player2 + 1, winnerPlayerId: winner.id, score })
    for (const player of this.players.values()) {
      player.ready = false
      player.health = 100
      player.x = 0
      player.z = 2.3
      player.yaw = Math.PI
      player.pitch = 0
      player.shotTimes = {}
      player.weapon = "pistol"
      player.ammo = { ...MAGAZINES }
      player.reserve = { ...RESERVES }
      player.reloadUntil = 0
      const attachment = player.socket?.deserializeAttachment() as Record<string, unknown> | null
      if (player.socket) player.socket.serializeAttachment({ ...(attachment ?? {}), ready: false, health: 100, x: 0, z: 2.3, yaw: Math.PI, pitch: 0, shotTimes: {}, weapon: player.weapon, ammo: player.ammo, reserve: player.reserve, reloadUntil: 0 })
      else await this.persistDisconnectedPlayer(player)
    }
    this.broadcastRoomState()
  }

  private updatePhase(): void {
    if (this.players.size < 2) this.phase = "waiting"
    else if (this.phase === "round_break" || this.phase === "finished") return
    else this.phase = [...this.players.values()].every(player => player.ready) ? "fighting" : "ready"
  }

  private async persistDisconnectedPlayer(player: Player): Promise<void> {
    const key = "resume:" + player.resumeToken
    const saved = await this.state.storage.get<{ expiresAt: number }>(key)
    if (!saved) return
    const { socket: _socket, ...data } = player
    await this.state.storage.put(key, { expiresAt: saved.expiresAt, player: { ...data, playerId: player.id } })
  }

  private broadcastRoomState(): void {
    void this.state.storage.put("roomPhase", this.phase)
    this.broadcast({
      type: "room_state",
      phase: this.phase,
      players: [...this.players.values()].map(player => ({
        playerId: player.id, displayName: player.name, ready: player.ready, connected: player.socket !== null,
      })),
    })
  }

  private broadcast(message: unknown, except?: WebSocket): void {
    const data = JSON.stringify(message)
    for (const player of this.players.values()) {
      if (!player.socket || player.socket === except) continue
      try { player.socket.send(data) } catch { player.socket = null }
    }
  }
}
