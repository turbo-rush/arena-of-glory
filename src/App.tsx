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
  const [selectedHero, setSelectedHero] = useState<'VOLT' | 'VEX'>(() => { try { return localStorage.getItem('aog-selected-hero') === 'VEX' ? 'VEX' : 'VOLT' } catch { return 'VOLT' } })
  const [selectedArena, setSelectedArena] = useState<number>(() => { try { const value = Number(localStorage.getItem('aog-selected-arena') ?? 0); return Number.isInteger(value) && value >= 0 && value <= 2 ? value : 0 } catch { return 0 } })
  const arenaChoices = ['SKYLINE // GOLDEN HOUR', 'IRONWORKS // DUSK', 'NEON DISTRICT // NIGHT']
  const [inviteLink, setInviteLink] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [roomPhase, setRoomPhase] = useState<'idle' | 'connecting' | 'waiting' | 'ready' | 'fighting'>('idle')
  const [roomPlayers, setRoomPlayers] = useState<{ playerId: string; displayName: string; ready: boolean; connected: boolean }[]>([])
  const [myPlayerId, setMyPlayerId] = useState('')
  const [roomError, setRoomError] = useState('')
  const [selectedMatchDuration, setSelectedMatchDuration] = useState<300 | 600>(300)
  const [matchEndsAt, setMatchEndsAt] = useState(0)
  const [matchSecondsLeft, setMatchSecondsLeft] = useState(0)
  const transportRef = useRef<DuelWebSocketTransport | null>(null)
  const shotSequenceRef = useRef(0)
  const onlineModeRef = useRef(false)
  const pendingResumeLoadoutRef = useRef<Extract<ServerDuelMessage, { type: 'loadout_update' }> | null>(null)
  const resumeStorageKey = 'arena-of-glory:duel-resume'

  useEffect(() => {
    const telegram = (window as Window & { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp
    telegram?.ready?.()
    telegram?.expand?.()
  }, [])

  useEffect(() => {
    if (!mountRef.current) return
    const game = new RooftopArena(mountRef.current, setState)
    gameRef.current = game
    return () => { game.destroy(); gameRef.current = null }
  }, [])

  useEffect(() => () => transportRef.current?.suspend(), [])

  useEffect(() => {
    if (!matchEndsAt) { setMatchSecondsLeft(0); return }
    const update = () => setMatchSecondsLeft(Math.max(0, Math.ceil((matchEndsAt - Date.now()) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [matchEndsAt])

  useEffect(() => { gameRef.current?.setPlayerHero(selectedHero) }, [selectedHero])

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
        setMatchEndsAt(message.endsAt)
        const arenaIndex = ({ 'skyline-golden-hour': 0, 'ironworks-dusk': 1, 'neon-district-night': 2 } as Record<string, number>)[message.arenaId] ?? 0
        gameRef.current?.selectArena(arenaIndex)
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
        setMatchEndsAt(message.matchEndsAt ?? 0)
        if (!onlineModeRef.current) {
          gameRef.current?.startOnline(
            input => transport.send({ type: 'input', input }),
            (weapon, aimYaw, aimPitch) => transport.send({ type: 'fire', shotId: ++shotSequenceRef.current, weapon, aimYaw, aimPitch }),
            () => transport.send({ type: 'reload' }),
            weapon => transport.send({ type: 'switch_weapon', weapon })
          )
          onlineModeRef.current = true
        }
        gameRef.current?.applyOnlineResume(message.health, message.phase, message.roundWins, message.opponentWins, message.x, message.z, message.lastInputSeq, message.opponentHealth)
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
        setMatchEndsAt(0)
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

  const chooseHero = (hero: 'VOLT' | 'VEX') => {
    setSelectedHero(hero)
    try { localStorage.setItem('aog-selected-hero', hero) } catch { /* selection remains active for this session */ }
  }

  const playSolo = () => {
    leaveRoom()
    gameRef.current?.selectArena(selectedArena)
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
      const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '')
      const invite = botUsername
        ? new URL(`https://t.me/${botUsername}?startapp=room_${room.roomCode}`)
        : new URL(window.location.href)
      if (!botUsername) invite.searchParams.set('room', room.roomCode)
      setInviteLink(invite.toString())
      await connectToRoom(url.toString(), room.roomCode)
    } catch (error) {
      setRoomPhase('idle')
      setRoomError(error instanceof Error ? error.message : 'Could not create room')
    }
  }

  const joinRoom = async (code: string, playerName = displayName) => {
    try {
      const normalizedCode = code.trim().toUpperCase()
      const url = duelRoomWebSocketUrl(normalizedCode, playerName)
      const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '')
      const invite = botUsername
        ? new URL(`https://t.me/${botUsername}?startapp=room_${normalizedCode}`)
        : new URL(window.location.href)
      if (!botUsername) invite.searchParams.set('room', normalizedCode)
      setInviteLink(invite.toString())
      await connectToRoom(url, normalizedCode)
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not join room')
    }
  }

  useEffect(() => {
    const telegram = (window as Window & { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string; user?: { first_name?: string; username?: string } } } } }).Telegram?.WebApp
    const telegramUser = telegram?.initDataUnsafe?.user
    const startParam = telegram?.initDataUnsafe?.start_param ?? new URLSearchParams(window.location.search).get('tgWebAppStartParam') ?? ''
    const startRoom = startParam.match(/^room_([A-HJ-NP-Z2-9]{6})$/i)?.[1]
    const inviteCode = startRoom ?? new URLSearchParams(window.location.search).get('room')
    const launchName = telegramUser?.first_name || telegramUser?.username || displayName
    if (telegramUser?.first_name || telegramUser?.username) setDisplayName(launchName)
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
    if (inviteCode && /^[A-HJ-NP-Z2-9]{6}$/i.test(inviteCode)) void joinRoom(inviteCode, launchName)
  }, [])

  const setReady = () => {
    try {
      transportRef.current?.send({ type: 'set_ready', ready: true, durationSeconds: selectedMatchDuration, arenaId: (['skyline-golden-hour', 'ironworks-dusk', 'neon-district-night'] as const)[selectedArena] })
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
    setMatchEndsAt(0)
    setRoomError('')
  }

  const shareInvite = async () => {
    if (!inviteLink) return
    const telegram = (window as Window & { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } }).Telegram?.WebApp
    const shareText = 'Join my ARENA OF GLORY rooftop duel!'
    try {
      if (telegram?.openTelegramLink) {
        const shareUrl = new URL('https://t.me/share/url')
        shareUrl.searchParams.set('url', inviteLink)
        shareUrl.searchParams.set('text', shareText)
        telegram.openTelegramLink(shareUrl.toString())
      } else if (navigator.share) {
        await navigator.share({ title: 'ARENA OF GLORY — Duel invitation', text: shareText, url: inviteLink })
      } else {
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
  const timerLabel = `${Math.floor(matchSecondsLeft / 60).toString().padStart(2, '0')}:${(matchSecondsLeft % 60).toString().padStart(2, '0')}`

  return (
    <main className="game-shell">
      {state.damageFlashId > 0 && <div key={state.damageFlashId} className="damage-flash" />}
      {state.hitFeedback && <div key={state.hitFeedbackId} className={`hit-feedback${state.hitFeedback === 'HEADSHOT' ? ' is-headshot' : ''}`}><span className="hit-crosshair">✣</span><b>{state.hitFeedback}</b></div>}
      <div className="scene" ref={mountRef} />
      <div className="vignette" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><div><b>ARENA <i>OF</i> GLORY</b><small>ROOFTOP COMBAT // SECTOR 07</small></div></div>
        <div className="match-tag"><span className="live-dot" /> {matchEndsAt > 0 ? timerLabel : `${selectedMatchDuration / 60}:00 MATCH`} <strong>{state.roundsWon} : {state.roundsLost}</strong></div>
      </header>

      <section className="hud">
        <div className={`fighter-card player-card${state.health <= 30 ? ' is-critical' : ''}`}>
          <div className="fighter-card-top"><span className={`fighter-avatar ${selectedHero === "VOLT" ? "volt-avatar" : "vex-avatar"}`}>{selectedHero === "VOLT" ? "V" : "X"}</span><div className="fighter-label"><span>YOU // {selectedHero}</span><strong>{displayName.trim() || 'PLAYER'}</strong></div><b className="health-value">{state.health}<small>%</small></b></div>
          <div className="health-track"><span style={{ width: Math.max(0, Math.min(100, state.health)) + '%' }} /></div>
          <div className="health-caption"><span>VITALITY</span><span>{state.health <= 30 ? 'CRITICAL' : state.health <= 60 ? 'WOUNDED' : 'COMBAT READY'}</span></div>
        </div>
        <div className="versus"><span>VS</span></div>
        <div className={`fighter-card enemy-card${state.enemyHealth <= 30 ? ' is-critical' : ''}`}>
          <div className="fighter-card-top"><span className={`fighter-avatar ${selectedHero === "VOLT" ? "vex-avatar" : "volt-avatar"}`}>{selectedHero === "VOLT" ? "X" : "V"}</span><div className="fighter-label"><span>RIVAL // {selectedHero === "VOLT" ? "VEX" : "VOLT"}</span><strong>{roomPlayers.find(player => player.playerId !== myPlayerId)?.displayName ?? 'RIVAL'}</strong></div><b className="health-value">{state.enemyHealth}<small>%</small></b></div>
          <div className="health-track"><span style={{ width: Math.max(0, Math.min(100, state.enemyHealth)) + '%' }} /></div>
          <div className="health-caption"><span>VITALITY</span><span>{state.enemyHealth <= 30 ? 'CRITICAL' : state.enemyHealth <= 60 ? 'WOUNDED' : 'COMBAT READY'}</span></div>
        </div>
      </section>

      <div className="objective"><span className="objective-icon"><Crosshair size={15}/></span><div><b>{state.arenaName}</b><small>{roomPhase === 'fighting' ? 'LIVE ONLINE DUEL // MATCH CLOCK' : 'ROUND WINS // MATCH CLOCK'}</small></div></div>

      <div className="weapon-panel">
        <div className="weapon-icon"><span>✦</span><small>LOADOUT</small></div>
        <div className="weapon-info"><b>{({ pistol: 'VX-9 SIDEARM', rifle: 'AR-4 STRIKER', shotgun: 'BREACH-12', sniper: 'M-90 LONGSHOT' })[state.weapon]}</b><small>{({ pistol: 'SEMI-AUTO // 9MM', rifle: 'FULL-AUTO // 5.56MM', shotgun: 'PUMP ACTION // 12 GA', sniper: 'BOLT ACTION // .308' })[state.weapon]}</small></div>
        <div className={`ammo${state.ammo <= 3 ? ' ammo-low' : ''}`}><b>{String(state.ammo).padStart(2, '0')}</b><small>/ {String(state.reserveAmmo).padStart(3, '0')}</small></div>
        <button className={`reload-btn${state.reloading ? " is-reloading" : ""}`} onClick={reload} aria-label="Перезарядить" disabled={state.reloading}><RotateCcw size={17}/>{state.reloading && <small>RELOAD</small>}</button>
        <button className="weapon-switch" onClick={() => gameRef.current?.switchWeapon()} aria-label="Сменить оружие">SWAP</button>
      </div>

      <div className="controls-hint"><span>W A S D</span> MOVE <span>DRAG</span> AIM <span>C</span> CROUCH <span>Q / E</span> PEEK</div>
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
        <div className="hero-select-heading"><span>01 / CHOOSE YOUR FIGHTER</span><i>ROOFTOP DIVISION</i></div>
        <div className="hero-select-grid">
          <button type="button" className={`hero-select-card hero-volt${selectedHero === "VOLT" ? " is-selected" : ""}`} onClick={() => chooseHero("VOLT")} aria-pressed={selectedHero === "VOLT"}>
            <span className="hero-card-index">A // 01</span><span className="hero-sigil">V</span><span className="hero-card-name">VOLT</span><span className="hero-card-role">THE ALL-ROUNDER</span><span className="hero-card-desc">Bold. Precise. Unbreakable.</span>
            <span className="hero-stat"><i>POWER</i><b><u style={{width:"82%"}} /></b></span><span className="hero-stat"><i>SPEED</i><b><u style={{width:"76%"}} /></b></span><span className="hero-stat"><i>CONTROL</i><b><u style={{width:"88%"}} /></b></span>
            <span className="hero-select-state">{selectedHero === "VOLT" ? "✓ SELECTED" : "SELECT FIGHTER"}</span>
          </button>
          <button type="button" className={`hero-select-card hero-vex${selectedHero === "VEX" ? " is-selected" : ""}`} onClick={() => chooseHero("VEX")} aria-pressed={selectedHero === "VEX"}>
            <span className="hero-card-index">B // 02</span><span className="hero-sigil">X</span><span className="hero-card-name">VEX</span><span className="hero-card-role">THE STRIKE SPECIALIST</span><span className="hero-card-desc">Fast. Fearless. Relentless.</span>
            <span className="hero-stat"><i>POWER</i><b><u style={{width:"74%"}} /></b></span><span className="hero-stat"><i>SPEED</i><b><u style={{width:"94%"}} /></b></span><span className="hero-stat"><i>CONTROL</i><b><u style={{width:"78%"}} /></b></span>
            <span className="hero-select-state">{selectedHero === "VEX" ? "✓ SELECTED" : "SELECT FIGHTER"}</span>
          </button>
        </div>
        <div className="arena-select-heading"><span>02 / SELECT YOUR ARENA</span><i>THREE COMBAT ZONES</i></div>
        <div className="arena-select-grid">
          {arenaChoices.map((arena, index) => <button type="button" key={arena} className={"arena-select-card arena-choice-" + index + (selectedArena === index ? " is-selected" : "")} onClick={() => { setSelectedArena(index); try { localStorage.setItem("aog-selected-arena", String(index)) } catch { /* session selection remains active */ } }} aria-pressed={selectedArena === index}>
            <span className="arena-choice-index">0{index + 1} / COMBAT ZONE</span><b>{arena.split(" // ")[0]}</b><small>{arena.split(" // ")[1]}</small><i>{selectedArena === index ? "✓ SELECTED" : "CHOOSE ARENA"}</i>
          </button>)}
        </div>
        <div className="lobby-label">MATCH LENGTH</div>
        <div className="arena-select-grid" style={{ marginBottom: 16 }}>
          {[300, 600].map(seconds => <button type="button" key={seconds} className={`arena-select-card${selectedMatchDuration === seconds ? ' is-selected' : ''}`} onClick={() => setSelectedMatchDuration(seconds as 300 | 600)} aria-pressed={selectedMatchDuration === seconds}>
            <span className="arena-choice-index">{seconds === 300 ? 'QUICK MATCH' : 'FULL MATCH'}</span><b>{seconds / 60} MIN</b><small>{seconds === 300 ? 'FAST ROOFTOP DUEL' : 'LONG-FORM DUEL'}</small><i>{selectedMatchDuration === seconds ? '✓ SELECTED' : 'CHOOSE LENGTH'}</i>
          </button>)}
        </div>
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
          <p className="lobby-note">Live player movement, manual aim, server-validated hits and a synchronized match clock.</p>
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