import { useEffect, useRef, useState } from 'react'
import { Crosshair, Shield, Zap, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { RooftopArena, type GameState } from './game/RooftopArena'

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<RooftopArena | null>(null)
  const [state, setState] = useState<GameState>({ health: 100, enemyHealth: 100, ammo: 12, reserveAmmo: 48, weapon: 'pistol', reloading: false, status: 'FIGHT', kills: 0, roundsWon: 0, roundsLost: 0, roundNumber: 1, arenaName: 'SKYLINE // GOLDEN HOUR', hitFeedback: '', hitFeedbackId: 0, damageFlashId: 0 })
  const [muted, setMuted] = useState(true)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!mountRef.current) return
    const game = new RooftopArena(mountRef.current, setState)
    gameRef.current = game
    return () => { game.destroy(); gameRef.current = null }
  }, [])

  const fire = () => gameRef.current?.shoot()
  const reload = () => gameRef.current?.reload()
  const move = (key: string, pressed: boolean) => gameRef.current?.setTouchKey(key, pressed)

  return (
    <main className="game-shell">
      {state.damageFlashId > 0 && <div key={state.damageFlashId} className="damage-flash" />}
      {state.hitFeedback && <div key={state.hitFeedbackId} className={`hit-feedback${state.hitFeedback === 'HEADSHOT' ? ' is-headshot' : state.hitFeedback === 'EXPLOSION' ? ' is-explosion' : ''}`}><span className="hit-crosshair">✣</span><b>{state.hitFeedback}</b></div>}
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

      {!started && <div className="start-overlay"><div className="start-card"><div className="eyebrow">THE CITY IS YOUR BATTLEFIELD</div><h1>OWN THE<br/><em>ROOFTOPS.</em></h1><p>One opponent. One rooftop. No second chances.</p><button onClick={() => { setStarted(true); gameRef.current?.start() }}>ENTER THE ARENA <span>→</span></button><small>PROTOTYPE BUILD 0.1 // TRAINING MATCH</small></div></div>}
      {state.status !== 'FIGHT' && <div className="result-overlay"><div className="eyebrow">{state.status === 'ROUND_BREAK' ? `ROUND ${state.roundNumber} COMPLETE` : 'MATCH COMPLETE'}</div><h2>{state.status === 'ROUND_BREAK' ? (state.roundsWon > state.roundsLost ? 'ROUND WON' : 'ROUND LOST') : (state.status === 'VICTORY' ? 'VICTORY' : 'DEFEAT')}</h2><p className="round-score">{state.roundsWon} <span>—</span> {state.roundsLost}</p>{state.status === 'ROUND_BREAK' ? <button onClick={() => gameRef.current?.continueRound()}>NEXT ROUND <span>→</span></button> : <button onClick={() => { gameRef.current?.reset(); setStarted(true) }}>REMATCH</button>}</div>}
      <footer className="footer"><span><Shield size={13}/> TRAINING SIMULATION</span><span>ARENA OF GLORY <b>© 2026</b></span><button onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button></footer>
    </main>
  )
}