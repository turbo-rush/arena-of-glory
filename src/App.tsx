import { useEffect, useRef, useState } from 'react'
import { Crosshair, Shield, Zap, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { RooftopArena, type GameState } from './game/RooftopArena'
import { createDuelRoom, createDuelTransport, duelRoomWebSocketUrl } from './net/duelRooms'
import type { DuelWebSocketTransport, ServerDuelMessage } from './net/duelTransport'

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<RooftopArena | null>(null)
  const [state, setState] = useState<GameState>({ health: 100, enemyHealth: 100, ammo: 12, reserveAmmo: 48, weapon: 'pistol', reloading: false, status: 'FIGHT', kills: 0, roundsWon: 0, roundsLost: 0, roundNumber: 1, arenaName: 'SKYLINE // GOLDEN HOUR', hitFeedback: '', hitFeedbackId: 0, damageFlashId: 0 })
  const [muted, setMuted] = useState(true)
  const [started, setStarted] = useState(false)
  const [displayName, setDisplayName] = useState('PLAYER')
  const [inviteLink, setInviteLink] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [roomPhase, setRoomPhase] = useState<'idle' | 'connecting' | 'waiting' | 'ready' | 'fighting'>('idle')
  const [roomPlayers, setRoomPlayers] = useState<{ playerId: string; displayName: string; ready: boolean; connected: boolean }[]>([])
  const [myPlayerId, setMyPlayerId] = useState('')
  const [roomError, setRoomError] = useState('')
  const transportRef = useRef<DuelWebSocketTransport | null>(null)
  const shotSequenceRef = useRef(0)
  const onlineModeRef = useRef(false)
  const pendingResumeLoadoutRef = useRef<Extract<ServerDuelMessage, { type: 'loadout_update' }> | null>(null)
  const resumeStorageKey = 'arena-of-glory:duel-resume'

  useEffect(() => {
    if (!mountRef.current) return
    const game = new RooftopArena(mountRef.current, setState)
    gameRef.current = game
    return () => { game.destroy(); gameRef.current = null }
  }, [])

  useEffect(() => () => transportRef.current?.suspend(), [])

  const connectToRoom = async (url: string, code: string) => {
    transportRef.current?.close()
    gameRef.current?.stopOnline()
    onlineModeRef.current = false
    pendingResumeLoadoutRef.current = null
    try { sessionStorage.removeItem(resumeStorageKey) } catch { /* storage may be unavailable */ }
    setRoomError('')
    setRoomCode(code)
    setRoomPlayers([])
    setMyPlayerId('')
    setRoomPhase('connecting')
    const transport = createDuelTransport(url)
    transportRef.current = transport
    transport.onMessage((message: ServerDuelMessage) => {
      if (message.type === 'welcome') {
        setMyPlayerId(message.playerId)
        try { sessionStorage.setItem(resumeStorageKey, JSON.stringify({ url: transport.reconnectUrl, roomCode: code, displayName })) } catch { /* session resume is optional */ }
      } else if (message.type === 'room_state') {
        setRoomPlayers(message.players)
        setRoomPhase(message.phase === 'fighting' ? 'fighting' : message.phase === 'ready' || message.phase === 'round_break' || message.phase === 'finished' ? 'ready' : 'waiting')
      } else if (message.type === 'match_started') {
        setRoomPhase('fighting')
        setStarted(true)
        gameRef.current?.startOnline(
          input => transport.send({ type: 'input', input }),
          (weapon, aimYaw, aimPitch) => transport.send({ type: 'fire', shotId: ++shotSequenceRef.current, weapon, aimYaw, aimPitch }),
          () => transport.send({ type: 'reload' }),
          weapon => transport.send({ type: 'switch_weapon', weapon })
        )
        onlineModeRef.current = true
      } else if (message.type === 'input') {
        gameRef.current?.applyRemoteInput(message.input)
      } else if (message.type === 'fire') {
        gameRef.current?.applyRemoteFire()
      } else if (message.type === 'resume_state') {
        if (!onlineModeRef.current) {
          gameRef.current?.startOnline(
            input => transport.send({ type: 'input', input }),
            (weapon, aimYaw, aimPitch) => transport.send({ type: 'fire', shotId: ++shotSequenceRef.current, weapon, aimYaw, aimPitch }),
            () => transport.send({ type: 'reload' }),
            weapon => transport.send({ type: 'switch_weapon', weapon })
          )
          onlineModeRef.current = true
        }
        gameRef.current?.applyOnlineResume(message.health, message.phase, message.roundWins, message.opponentWins, message.x, message.z, message.lastInputSeq)
        if (pendingResumeLoadoutRef.current) {
          const loadout = pendingResumeLoadoutRef.current
          gameRef.current?.applyOnlineLoadout(loadout.weapon, loadout.ammo, loadout.reserveAmmo, loadout.reloading)
          pendingResumeLoadoutRef.current = null
        }
        setRoomPhase(message.phase === 'fighting' ? 'fighting' : message.phase === 'ready' || message.phase === 'round_break' || message.phase === 'finished' ? 'ready' : 'waiting')
        setStarted(message.phase === 'fighting' || message.phase === 'round_break')
      } else if (message.type === 'loadout_update') {
        if (onlineModeRef.current) gameRef.current?.applyOnlineLoadout(message.weapon, message.ammo, message.reserveAmmo, message.reloading)
        else pendingResumeLoadoutRef.current = message
      } else if (message.type === 'switch_weapon') {
        gameRef.current?.applyRemoteWeaponSwitch(message.weapon)
      } else if (message.type === 'reload') {
        gameRef.current?.applyRemoteReload(message.weapon)
      } else if (message.type === 'shot_result') {
        if (!message.accepted) gameRef.current?.rejectOnlineShot()
        else gameRef.current?.applyOnlineShotResult(message.damage > 0, message.damage, message.targetHealth, message.hitZone)
      } else if (message.type === 'health_update') {
        gameRef.current?.applyOnlineDamage(message.health, message.damage, message.hitZone)
      } else if (message.type === 'round_ended') {
        gameRef.current?.applyOnlineRoundResult(message.roundNumber, message.winnerPlayerId === myPlayerId)
        setRoomPhase('ready')
        setStarted(true)
      } else if (message.type === 'round_started') {
        gameRef.current?.startOnlineRound(message.roundNumber)
        setRoomPhase('fighting')
        setStarted(true)
      } else if (message.type === 'match_ended') {
        gameRef.current?.applyOnlineMatchResult(message.winnerPlayerId === myPlayerId)
        setStarted(false)
      } else if (message.type === 'error') {
        setRoomError(message.message)
      }
    })
    transport.onStateChange(connection => {
      if (connection === 'connecting') setRoomPhase('connecting')
      if (connection === 'connected') setRoomError('')
      if (connection === 'disconnected') {
        if (transport.reconnecting) {
          setRoomPhase('connecting')
          setRoomError('Связь потеряна. Восстанавливаем подключение к матчу…')
        } else {
          setRoomPhase('idle')
          gameRef.current?.stopOnline()
          onlineModeRef.current = false
          try { sessionStorage.removeItem(resumeStorageKey) } catch { /* storage may be unavailable */ }
          setStarted(false)
          setRoomError('Не удалось восстановить соединение. Попробуйте снова войти в комнату.')
        }
      }
    })
    try {
      await transport.connect()
      setRoomPhase('waiting')
    } catch (error) {
      if (!transport.reconnecting) {
        setRoomPhase('idle')
        setRoomError(error instanceof Error ? error.message : 'Unable to connect')
      } else {
        setRoomPhase('connecting')
        setRoomError('Сервер временно недоступен. Повторяем подключение…')
      }
    }
  }

  const playSolo = () => {
    leaveRoom()
    gameRef.current?.start()
    setStarted(true)
  }

  const createRoom = async () => {
    try {
      setRoomError('')
      setRoomPhase('connecting')
      const room = await createDuelRoom()
      const url = new URL(room.websocketUrl)
      url.searchParams.set('name', displayName.trim().slice(0, 20) || 'PLAYER')
      const invite = new URL(window.location.href)
      invite.searchParams.set('room', room.roomCode)
      setInviteLink(invite.toString())
      await connectToRoom(url.toString(), room.roomCode)
    } catch (error) {
      setRoomPhase('idle')
      setRoomError(error instanceof Error ? error.message : 'Could not create room')
    }
  }

  const joinRoom = async (code: string) => {
    try {
      const normalizedCode = code.trim().toUpperCase()
      const url = duelRoomWebSocketUrl(normalizedCode, displayName)
      const invite = new URL(window.location.href)
      invite.searchParams.set('room', normalizedCode)
      setInviteLink(invite.toString())
      await connectToRoom(url, normalizedCode)
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not join room')
    }
  }

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get('room')
    try {
      const raw = sessionStorage.getItem(resumeStorageKey)
      if (raw) {
        const saved = JSON.parse(raw) as { url?: unknown; roomCode?: unknown; displayName?: unknown }
        const savedCode = typeof saved.roomCode === 'string' ? saved.roomCode.toUpperCase() : ''
        const inviteMatches = !inviteCode || inviteCode.toUpperCase() === savedCode
        if (inviteMatches && typeof saved.url === 'string' && typeof saved.roomCode === 'string' && /^[A-HJ-NP-Z2-9]{6}$/i.test(saved.roomCode)) {
          if (typeof saved.displayName === 'string') setDisplayName(saved.displayName)
          const invite = new URL(window.location.href)
          invite.searchParams.set('room', saved.roomCode)
          setInviteLink(invite.toString())
          void connectToRoom(saved.url, saved.roomCode)
          return
        }
        if (!inviteMatches) sessionStorage.removeItem(resumeStorageKey)
      }
    } catch { /* ignore malformed or unavailable session storage */ }
    if (inviteCode && /^[A-HJ-NP-Z2-9]{6}$/i.test(inviteCode)) void joinRoom(inviteCode)
  }, [])

  const setReady = () => {
    try {
      transportRef.current?.send({ type: 'set_ready', ready: true })
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not set ready')
    }
  }

  const leaveRoom = () => {
    transportRef.current?.close()
    gameRef.current?.stopOnline()
    onlineModeRef.current = false
    try { sessionStorage.removeItem(resumeStorageKey) } catch { /* storage may be unavailable */ }
    transportRef.current = null
    setRoomCode('')
    setInviteLink('')
    setRoomPlayers([])
    setMyPlayerId('')
    setRoomPhase('idle')
    setRoomError('')
  }

  const shareInvite = async () => {
    if (!inviteLink) return
    try {
      if (navigator.share) await navigator.share({ title: 'ARENA OF GLORY — Duel invitation', text: 'Join my rooftop duel!', url: inviteLink })
      else {
        await navigator.clipboard.writeText(inviteLink)
        setRoomError('Invite link copied. Send it to your friend.')
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setRoomError('Could not share the invite link.')
    }
  }

  const fire = () => gameRef.current?.shoot()
  const reload = () => gameRef.current?.reload()
  const move = (key: string, pressed: boolean) => gameRef.current?.setTouchKey(key, pressed)

  return (
    <main className="game-shell">
      {state.damageFlashId > 0 && <div key={state.damageFlashId} className="damage-flash" />}
      {state.hitFeedback && <div key={state.hitFeedbackId} className={`hit-feedback${state.hitFeedback === 'HEADSHOT' ? ' is-headshot' : ''}`}><span className="hit-crosshair">✣</span><b>{state.hitFeedback}</b></div>}
      <div className="scene" ref={mountRef} />
      <div className="vignette" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><div><b>ARENA <i>OF</i> GLORY</b><small>ROOFTOP COMBAT // SECTOR 07</small></div></div>
        <div className="match-tag"><span className="live-dot" /> ROUND {state.roundNumber}/5 <strong>{state.roundsWon} : {state.roundsLost}</strong></div>
      </header>

      <section className="hud">
        <div className="fighter-card">
          <div className="fighter-label"><span>YOU</span><strong>ROOFTOP GHOST</strong></div>
          <div className="health-track"><span style={{ width: state.health + '%' }} /></div>
          <div className="health-meta"><b>{state.health}</b><small>HEALTH</small></div>
        </div>
        <div className="versus">VS</div>
        <div className="fighter-card enemy-card">
          <div className="fighter-label"><span>ENEMY</span><strong>IRON JACKAL</strong></div>
          <div className="health-track"><span style={{ width: state.enemyHealth + '%' }} /></div>
          <div className="health-meta"><b>{state.enemyHealth}</b><small>HEALTH</small></div>
        </div>
      </section>

      <div className="objective"><span className="objective-icon"><Crosshair size={15}/></span><div><b>{state.arenaName}</b><small>FIRST TO 3 WINS THE MATCH</small></div></div>

      <div className="weapon-panel">
        <div className="weapon-icon">✦</div>
        <div className="weapon-info"><b>{({ pistol: 'VX-9 SIDEARM', rifle: 'AR-4 STRIKER', shotgun: 'BREACH-12', sniper: 'M-90 LONGSHOT' })[state.weapon]}</b><small>{({ pistol: 'SEMI-AUTO // 9MM', rifle: 'FULL-AUTO // 5.56MM', shotgun: 'PUMP ACTION // 12 GA', sniper: 'BOLT ACTION // .308' })[state.weapon]}</small></div>
        <div className="ammo"><b>{String(state.ammo).padStart(2, '0')}</b><small>/ {String(state.reserveAmmo).padStart(3, '0')}</small></div>
        <button className={`reload-btn${state.reloading ? " is-reloading" : ""}`} onClick={reload} aria-label="Перезарядить" disabled={state.reloading}><RotateCcw size={17}/>{state.reloading && <small>RELOAD</small>}</button>
        <button className="weapon-switch" onClick={() => gameRef.current?.switchWeapon()} aria-label="Сменить оружие">SWAP</button>
      </div>

      <div className="controls-hint"><span>W A S D</span> MOVE <span>C</span> CROUCH <span>Q / E</span> PEEK</div>
      <div className="touch-controls">
        <div className="dpad">
          <button onTouchStart={() => move('KeyW', true)} onTouchEnd={() => move('KeyW', false)} onMouseDown={() => move('KeyW', true)} onMouseUp={() => move('KeyW', false)}>▲</button>
          <div><button onTouchStart={() => move('KeyA', true)} onTouchEnd={() => move('KeyA', false)} onMouseDown={() => move('KeyA', true)} onMouseUp={() => move('KeyA', false)}>◀</button><button onTouchStart={() => move('KeyS', true)} onTouchEnd={() => move('KeyS', false)} onMouseDown={() => move('KeyS', true)} onMouseUp={() => move('KeyS', false)}>▼</button><button onTouchStart={() => move('KeyD', true)} onTouchEnd={() => move('KeyD', false)} onMouseDown={() => move('KeyD', true)} onMouseUp={() => move('KeyD', false)}>▶</button></div>
        </div>
        <div className="action-buttons"><button className="stance-btn" onClick={() => gameRef.current?.crouch()}><span>↓</span><small>CROUCH</small></button><button className="stance-btn" onClick={() => gameRef.current?.peek(-1)}><span>↶</span><small>PEEK</small></button><button className="aim-btn" onClick={() => gameRef.current?.aim()}><Crosshair size={20}/><small>AIM</small></button><button className="fire-btn" onTouchStart={fire} onMouseDown={fire}><Zap size={25}/><small>FIRE</small></button></div>
      </div>

      {!started && <div className="start-overlay"><div className="lobby-card">
        <div className="eyebrow">REAL PLAYERS. ONE ROOFTOP.</div>
        <h1>PRIVATE<br/><em>DUEL.</em></h1>
        <p>Create a private room and send your friend an invite link. Open a friend's link to join their duel.</p>
        <label className="lobby-label">PLAYER NAME</label>
        <input className="lobby-input" value={displayName} maxLength={20} onChange={event => setDisplayName(event.target.value)} placeholder="Your name" />
        {roomPhase === 'idle' && <>
          <button className="lobby-primary" onClick={playSolo}>PLAY SOLO <span>→</span></button>
          <button className="lobby-secondary" style={{ marginTop: 10 }} onClick={createRoom}>CREATE ONLINE DUEL</button>
        </>}
        {roomPhase !== 'idle' && <div className="room-status">
          <div className="room-status-line"><span className={roomPhase === 'connecting' ? 'status-dot connecting' : 'status-dot'} />{roomPhase === 'connecting' ? 'CONNECTING TO DUEL SERVER' : roomPhase === 'fighting' ? 'BOTH PLAYERS READY' : 'ROOM CONNECTED'}</div>
          <div className="room-code-label">PRIVATE INVITATION</div>
          <button className="lobby-primary invite-button" onClick={shareInvite}>SHARE INVITE LINK <span>↗</span></button>
          <div className="room-player-list">{[0, 1].map(index => {
            const player = roomPlayers[index]
            return <div className="room-player" key={index}><span className="player-slot">{index + 1}</span><div><b>{player?.displayName ?? (index === 0 ? 'WAITING FOR YOU' : 'WAITING FOR OPPONENT')}</b><small>{player ? (player.ready ? 'READY' : 'CONNECTED') : 'NOT CONNECTED'}</small></div><i className={player?.ready ? 'player-ready' : ''}>{player?.ready ? '✓' : '—'}</i></div>
          })}</div>
          {roomPhase !== 'fighting' && roomPhase !== 'connecting' && !roomPlayers.some(player => player.playerId === myPlayerId && player.ready) && <button className="lobby-primary" onClick={setReady}>I'M READY <span>→</span></button>}
          <p className="lobby-note">Player movement and firing animations are relayed live. Server-validated hits, damage and match scoring are the next stage.</p>
          <button className="lobby-secondary" onClick={leaveRoom}>LEAVE ROOM</button>
        </div>}
        {roomError && <div className="lobby-error">{roomError}</div>}
        <small className="lobby-footnote">SOLO TRAINING // ONLINE PVP</small>
      </div></div>}
      {state.status !== 'FIGHT' && <div className="result-overlay"><div className="eyebrow">{state.status === 'ROUND_BREAK' ? `ROUND ${state.roundNumber} COMPLETE` : 'MATCH COMPLETE'}</div><h2>{state.status === 'ROUND_BREAK' ? (state.roundsWon > state.roundsLost ? 'ROUND WON' : 'ROUND LOST') : (state.status === 'VICTORY' ? 'VICTORY' : 'DEFEAT')}</h2><p className="round-score">{state.roundsWon} <span>—</span> {state.roundsLost}</p>{state.status === 'ROUND_BREAK' ? <button onClick={() => { if (roomCode) { try { transportRef.current?.send({ type: 'continue_round' }) } catch (error) { setRoomError(error instanceof Error ? error.message : 'Could not ready up') } } else gameRef.current?.continueRound() }}>NEXT ROUND <span>→</span></button> : <button onClick={() => { gameRef.current?.reset(); setStarted(true) }}>REMATCH</button>}</div>}
      <footer className="footer"><span><Shield size={13}/> {roomPhase === 'fighting' ? 'ONLINE DUEL // INPUT RELAY' : 'TRAINING SIMULATION'}</span><span>ARENA OF GLORY <b>© 2026</b></span><button onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button></footer>
    </main>
  )
}