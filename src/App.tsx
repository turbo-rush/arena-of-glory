import { useEffect, useRef, useState } from 'react'
import { Crosshair, Shield, Zap, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { RooftopArena, type GameState } from './game/RooftopArena'

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<RooftopArena | null>(null)
  const [state, setState] = useState<GameState>({ health: 100, enemyHealth: 100, ammo: 12, reloading: false, status: 'FIGHT', kills: 0 })
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
      <div className="scene" ref={mountRef} />
      <div className="vignette" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><div><b>ARENA <i>OF</i> GLORY</b><small>ROOFTOP COMBAT // SECTOR 07</small></div></div>
        <div className="match-tag"><span className="live-dot" /> LIVE DUEL <strong>01:42</strong></div>
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

      <div className="objective"><span className="objective-icon"><Crosshair size={15}/></span><div><b>ELIMINATE THE TARGET</b><small>Move · Aim · Fire</small></div></div>

      <div className="weapon-panel">
        <div className="weapon-icon">✦</div>
        <div className="weapon-info"><b>VX-9 SIDEARM</b><small>SEMI-AUTO // 9MM</small></div>
        <div className="ammo"><b>{String(state.ammo).padStart(2, '0')}</b><small>/ 048</small></div>
        <button className="reload-btn" onClick={reload} aria-label="Перезарядить"><RotateCcw size={17}/></button>
      </div>

      <div className="controls-hint"><span>W A S D</span> MOVE <span>SPACE</span> DODGE</div>
      <div className="touch-controls">
        <div className="dpad">
          <button onTouchStart={() => move('KeyW', true)} onTouchEnd={() => move('KeyW', false)} onMouseDown={() => move('KeyW', true)} onMouseUp={() => move('KeyW', false)}>▲</button>
          <div><button onTouchStart={() => move('KeyA', true)} onTouchEnd={() => move('KeyA', false)} onMouseDown={() => move('KeyA', true)} onMouseUp={() => move('KeyA', false)}>◀</button><button onTouchStart={() => move('KeyS', true)} onTouchEnd={() => move('KeyS', false)} onMouseDown={() => move('KeyS', true)} onMouseUp={() => move('KeyS', false)}>▼</button><button onTouchStart={() => move('KeyD', true)} onTouchEnd={() => move('KeyD', false)} onMouseDown={() => move('KeyD', true)} onMouseUp={() => move('KeyD', false)}>▶</button></div>
        </div>
        <div className="action-buttons"><button className="aim-btn" onClick={() => gameRef.current?.aim()}><Crosshair size={20}/><small>AIM</small></button><button className="fire-btn" onTouchStart={fire} onMouseDown={fire}><Zap size={25}/><small>FIRE</small></button></div>
      </div>

      {!started && <div className="start-overlay"><div className="start-card"><div className="eyebrow">THE CITY IS YOUR BATTLEFIELD</div><h1>OWN THE<br/><em>ROOFTOPS.</em></h1><p>One opponent. One rooftop. No second chances.</p><button onClick={() => { setStarted(true); gameRef.current?.start() }}>ENTER THE ARENA <span>→</span></button><small>PROTOTYPE BUILD 0.1 // TRAINING MATCH</small></div></div>}
      {state.status !== 'FIGHT' && <div className="result-overlay"><div className="eyebrow">DUEL COMPLETE</div><h2>{state.status === 'VICTORY' ? 'VICTORY' : 'DEFEAT'}</h2><button onClick={() => { gameRef.current?.reset(); setStarted(true) }}>PLAY AGAIN</button></div>}
      <footer className="footer"><span><Shield size={13}/> TRAINING SIMULATION</span><span>ARENA OF GLORY <b>© 2026</b></span><button onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button></footer>
    </main>
  )
}