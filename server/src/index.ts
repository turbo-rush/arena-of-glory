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
      return env.DUEL_ROOMS.get(id).fetch(new Request(target.toString(), request))
    }
    return json({ error: "not_found" }, 404)
  },
}

type Player = { id: string; name: string; ready: boolean; socket: WebSocket }

export class DuelRoom {
  private players = new Map<string, Player>()
  private phase: "waiting" | "ready" | "fighting" | "finished" = "waiting"
  private roomCode = ""

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    this.restorePlayers()
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
      if (this.players.size >= 2) return json({ error: "room_full" }, 409)
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      const playerId = crypto.randomUUID()
      const slot = (this.players.size + 1) as 1 | 2
      const name = (url.searchParams.get("name") ?? (slot === 1 ? "PLAYER 1" : "PLAYER 2")).slice(0, 20)
      this.state.acceptWebSocket(server)
      server.serializeAttachment({ playerId, name, slot })
      this.players.set(playerId, { id: playerId, name, ready: false, socket: server })
      server.send(JSON.stringify({ type: "welcome", playerId, roomCode: this.roomCode, slot }))
      this.updatePhase()
      this.broadcastRoomState()
      return new Response(null, { status: 101, webSocket: client })
    }
    return json({ error: "not_found" }, 404)
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    this.restorePlayers()
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
      case "input":
      case "fire":
      case "reload":
      case "switch_weapon":
        if (this.phase === "fighting") this.broadcast(message, socket)
        break
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

  webSocketClose(socket: WebSocket): void {
    this.restorePlayers()
    const attachment = socket.deserializeAttachment() as { playerId?: string } | null
    if (attachment?.playerId) this.players.delete(attachment.playerId)
    if (this.phase !== "finished") this.phase = this.players.size === 0 ? "waiting" : "ready"
    this.broadcastRoomState()
  }

  webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket)
  }

  private restorePlayers(): void {
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as { playerId?: string; name?: string; slot?: 1 | 2; ready?: boolean } | null
      if (!attachment?.playerId || this.players.has(attachment.playerId)) continue
      this.players.set(attachment.playerId, {
        id: attachment.playerId,
        name: attachment.name ?? "PLAYER",
        ready: attachment.ready === true,
        socket,
      })
    }
    this.updatePhase()
  }

  private updatePhase(): void {
    if (this.players.size < 2) this.phase = "waiting"
    else this.phase = [...this.players.values()].every(player => player.ready) ? "fighting" : "ready"
  }

  private broadcastRoomState(): void {
    this.broadcast({
      type: "room_state",
      phase: this.phase,
      players: [...this.players.values()].map(player => ({
        playerId: player.id, displayName: player.name, ready: player.ready, connected: true,
      })),
    })
  }

  private broadcast(message: unknown, except?: WebSocket): void {
    const data = JSON.stringify(message)
    for (const player of this.players.values()) {
      if (player.socket === except) continue
      try { player.socket.send(data) } catch { this.players.delete(player.id) }
    }
  }
}
