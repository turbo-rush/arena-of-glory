import * as THREE from 'three'

export type WeaponId = 'pistol' | 'rifle' | 'shotgun' | 'sniper'
export type GameState = { health: number; enemyHealth: number; ammo: number; reserveAmmo: number; weapon: WeaponId; reloading: boolean; status: 'FIGHT' | 'ROUND_BREAK' | 'VICTORY' | 'DEFEAT'; kills: number; roundsWon: number; roundsLost: number; roundNumber: number; arenaName: string; hitFeedback: 'HEADSHOT' | 'HIT' | 'EXPLOSION' | ''; hitFeedbackId: number; damageFlashId: number }
type StateListener = (state: GameState) => void
const WEAPONS: Record<WeaponId, { name: string; subtitle: string; magazine: number; reserve: number; damage: number; headMultiplier: number; spread: number; pellets: number }> = {
  pistol: { name: 'VX-9 SIDEARM', subtitle: 'SEMI-AUTO // 9MM', magazine: 12, reserve: 48, damage: 18, headMultiplier: 2.2, spread: .42, pellets: 1 },
  rifle: { name: 'AR-4 STRIKER', subtitle: 'FULL-AUTO // 5.56MM', magazine: 30, reserve: 120, damage: 12, headMultiplier: 1.8, spread: .34, pellets: 1 },
  shotgun: { name: 'BREACH-12', subtitle: 'PUMP ACTION // 12 GA', magazine: 6, reserve: 30, damage: 7, headMultiplier: 1.25, spread: .95, pellets: 6 },
  sniper: { name: 'M-90 LONGSHOT', subtitle: 'BOLT ACTION // .308', magazine: 5, reserve: 20, damage: 48, headMultiplier: 2.5, spread: .1, pellets: 1 }
}
const WEAPON_ORDER: WeaponId[] = ['pistol', 'rifle', 'shotgun', 'sniper']
const ARENAS = [
  { name: 'SKYLINE // GOLDEN HOUR', sky: '#9b9b9d', fog: '#9b9b9d', ground: '#4c5058', sun: '#ffe0b1', roof: '#353b46', trim: '#555a64', cover: '#59636e' },
  { name: 'IRONWORKS // DUSK', sky: '#725d5b', fog: '#725d5b', ground: '#343b40', sun: '#ff9a67', roof: '#343b3d', trim: '#6a625c', cover: '#65534a' },
  { name: 'NEON DISTRICT // NIGHT', sky: '#202b49', fog: '#202b49', ground: '#202737', sun: '#8ba8ff', roof: '#252d43', trim: '#53617c', cover: '#3b4965' }
]

export class RooftopArena {
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300)
  private renderer: THREE.WebGLRenderer
  private player!: THREE.Group
  private enemy!: THREE.Group
  private keys = new Set<string>()
  private touchKeys = new Set<string>()
  private clock = new THREE.Clock()
  private frame = 0
  private health = 100
  private enemyHealth = 100
  private hitFeedback: GameState['hitFeedback'] = ''
  private hitFeedbackId = 0
  private damageFlashId = 0
  private hitFeedbackTimer = 0
  private weapon: WeaponId = 'pistol'
  private ammo = WEAPONS.pistol.magazine
  private reserveAmmo = WEAPONS.pistol.reserve
  private ammoByWeapon: Record<WeaponId, number> = { pistol: 12, rifle: 30, shotgun: 6, sniper: 5 }
  private reserveByWeapon: Record<WeaponId, number> = { pistol: 48, rifle: 120, shotgun: 30, sniper: 20 }
  private reloading = false
  private reloadTimer = 0
  private reloadDuration = 1.15
  private enemyTimer = 0
  private started = false
  private disposed = false
  private aiming = false
  private walkTime = 0
  private enemyWalkTime = 0
  private recoil = 0
  private enemyHitTimer = 0
  private crouched = false
  private peekDirection: -1 | 0 | 1 = 0
  private enemyCovering = false
  private enemyCoverTimer = 0
  private enemyPeeking = false
  private enemyPeekTimer = 0
  private enemyStrafeDirection = 1
  private enemyShotWindup = 0
  private enemyDodgeTimer = 0
  private enemyDodgeDirection = 1
  private playerAimTimer = 0
  private enemyAimBreakTimer = 0
  private enemyAimBreakCooldown = 0
  private enemyAimBreakDirection = 1
  private playerCampTimer = 0
  private enemyFlankTimer = 0
  private enemyFlankCooldown = 0
  private enemyFlankSide = 1
  private previousPlayerPosition = new THREE.Vector3(0, 0, 2.3)
  private playerVelocity = new THREE.Vector3()
  private roundsWon = 0
  private roundsLost = 0
  private roundNumber = 1
  private gameStatus: GameState['status'] = 'FIGHT'
  private intermissionTimer = 0
  private arenaIndex = 0
  private roof!: THREE.Group
  private farRoof!: THREE.Group
  private ground!: THREE.Mesh
  private sun!: THREE.DirectionalLight
  private hemisphere!: THREE.HemisphereLight
  private arenaLandmarks: THREE.Group[] = []
  private readonly coverColliders = [
    new THREE.Box3(new THREE.Vector3(-7.0, 0, .95), new THREE.Vector3(-4.2, 1.55, 2.05)),
    new THREE.Box3(new THREE.Vector3(4.0, 0, 6.2), new THREE.Vector3(6.4, 1.35, 7.4)),
    new THREE.Box3(new THREE.Vector3(-5.75, 0, -11.1), new THREE.Vector3(-3.25, 1.65, -9.9)),
    new THREE.Box3(new THREE.Vector3(2.95, 0, -14.9), new THREE.Vector3(5.45, 1.45, -13.7))
  ]
  private readonly coverZones = [
    { x: -5.6, z: -3.5, halfX: 1.4, halfZ: .55 },
    { x: 5.2, z: 1.8, halfX: 1.2, halfZ: .6 }
  ]
  private muzzleTimer = 0
  private tracer: THREE.Line | null = null
  private impactParticles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; maxLife: number }[] = []
  private listener: StateListener
  private host: HTMLElement
  private onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); if (e.code === 'KeyR') this.reload(); if (e.code === 'KeyC' && !e.repeat) this.crouch() }
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.code === 'KeyQ' || e.code === 'KeyE') this.peekDirection = 0 }
  private resizeObserver: ResizeObserver

  constructor(host: HTMLElement, listener: StateListener) {
    this.host = host; this.listener = listener
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.25
    host.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color('#9b9b9d')
    this.scene.fog = new THREE.Fog('#9b9b9d', 35, 115)
    this.buildWorld()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.resize()
    this.animate()
  }

  private material(color: string, roughness = 0.86) { return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true }) }
  private box(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.material(color))
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
  }

  private buildWorld() {
    this.hemisphere = new THREE.HemisphereLight('#dceaff', '#33303b', 2.1); this.scene.add(this.hemisphere)
    this.sun = new THREE.DirectionalLight('#ffe0b1', 3.2)
    this.sun.position.set(-12, 24, 10); this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024); this.scene.add(this.sun)
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), this.material('#4c5058'))
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -3.1; this.ground.receiveShadow = true; this.scene.add(this.ground)
    // Distant city skyline
    for (let i = 0; i < 38; i++) {
      const x = (i % 10 - 5) * 8 + Math.sin(i * 4) * 2
      const z = -36 - Math.floor(i / 10) * 15
      const h = 5 + (i * 13 % 17)
      const b = this.box(this.scene, x, h / 2 - 3, z, 4 + i % 3, h, 4, i % 3 ? '#555966' : '#6c6265')
      const windows = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * .72, 0.08), new THREE.MeshBasicMaterial({ color: i % 2 ? '#e7bd83' : '#7d9ba9' }))
      windows.position.set(2.05 + i % 3 * .5, 0, 2.03); b.add(windows)
    }
    // Distinct skyline silhouettes make each rotating arena feel like a different district.
    const skylineProps = new THREE.Group(); this.arenaLandmarks.push(skylineProps); this.scene.add(skylineProps)
    this.box(skylineProps, -17, 7, -47, 1.2, 14, 1.2, '#77727a')
    this.box(skylineProps, -17, 14, -47, 8, .45, 1.1, '#d69a55')
    this.box(skylineProps, -17, 16, -47, .35, 4, .35, '#d69a55')
    this.box(skylineProps, -20.5, 10, -47, .3, 6, .3, '#d69a55')
    const factoryProps = new THREE.Group(); this.arenaLandmarks.push(factoryProps); this.scene.add(factoryProps)
    this.box(factoryProps, 17, 5, -48, 7, 10, 7, '#494b50')
    this.box(factoryProps, 14.5, 14, -49, 1.8, 13, 1.8, '#69534c')
    this.box(factoryProps, 19.5, 12, -46, 1.5, 9, 1.5, '#69534c')
    this.box(factoryProps, 17, 10.5, -48, 12, .45, .45, '#b17b5d')
    const neonProps = new THREE.Group(); this.arenaLandmarks.push(neonProps); this.scene.add(neonProps)
    this.box(neonProps, -18, 8, -48, 7, 16, 6, '#303b58')
    this.box(neonProps, -18, 17, -48, 9, .5, .5, '#536a9a')
    const neonSign = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.2, .22), new THREE.MeshBasicMaterial({ color: '#42d9ed' }))
    neonSign.position.set(-18, 10, -44.8); neonProps.add(neonSign)
    const neonSign2 = new THREE.Mesh(new THREE.BoxGeometry(3.2, .28, .24), new THREE.MeshBasicMaterial({ color: '#ff4f9a' }))
    neonSign2.position.set(-18, 6.8, -44.7); neonProps.add(neonSign2)
    this.arenaLandmarks.forEach((group, index) => { group.visible = index === 0 })

    // Player rooftop
    const roof = new THREE.Group(); this.roof = roof; roof.position.set(0, 0, 5); this.scene.add(roof)
    this.box(roof, 0, -0.45, 0, 17, .9, 15, '#353b46')
    this.box(roof, 0, .04, -7.2, 17, 1.2, .5, '#555a64')
    this.box(roof, -8.2, .04, 0, .5, 1.2, 15, '#555a64')
    this.box(roof, 8.2, .04, 0, .5, 1.2, 15, '#555a64')
    for (let i = 0; i < 5; i++) this.box(roof, -6 + i * 3, .12, 5.5, 1.2, .25, 1.2, '#737781')
    this.box(roof, -5.6, .75, -3.5, 2.8, 1.5, 1.1, '#59636e')
    this.box(roof, 5.2, .65, 1.8, 2.4, 1.3, 1.2, '#59636e')
    // Enemy rooftop
    const far = new THREE.Group(); this.farRoof = far; far.position.set(0, 0, -12.5); this.scene.add(far)
    this.box(far, 0, -0.45, 0, 15, .9, 12, '#383d49')
    this.box(far, -7.2, .1, 0, .5, 1.3, 12, '#656a72')
    this.box(far, 7.2, .1, 0, .5, 1.3, 12, '#656a72')
    this.box(far, 0, .1, -5.8, 15, 1.3, .5, '#656a72')
    this.box(far, -4.5, .8, 2, 2.5, 1.6, 1.2, '#59636e')
    this.box(far, 4.2, .7, -1.8, 2.5, 1.4, 1.2, '#59636e')
    this.player = this.createFighter('#e5a23b', '#263342')
    this.player.position.set(0, 0, 2.3); this.player.scale.setScalar(0.64); roof.add(this.player)
    this.enemy = this.createFighter('#d64f48', '#20232d')
    this.enemy.position.set(1.4, 0, -1.7); this.enemy.scale.setScalar(1.28); far.add(this.enemy)
    this.rebuildWeaponModel()
    // Camera follows just behind the player, looking toward the rival rooftop.
    this.camera.position.set(0, 7.4, 20.2)
    this.camera.lookAt(0, 1.3, -9.4)
    this.applyArena(0)
  }

  private createFighter(jacket: string, pants: string) {
    const group = new THREE.Group()
    const torso = new THREE.Mesh(new THREE.BoxGeometry(.72, 1.05, .42), this.material(jacket)); torso.position.y = 1.2; torso.castShadow = true; torso.userData.hitZone = 'body'; group.add(torso)
    const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 8, 7), this.material('#c58f70')); head.position.y = 1.93; head.castShadow = true; head.userData.hitZone = 'head'; group.add(head)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(.57, .18, .5), this.material(pants)); hood.position.set(0, 2.08, -.03); hood.userData.hitZone = 'head'; group.add(hood)
    const legs: THREE.Mesh[] = []
    for (const x of [-.2, .2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.25, .7, .3), this.material(pants)); leg.position.set(x, .36, 0); leg.castShadow = true; group.add(leg); legs.push(leg)
    }
    const arm = new THREE.Group(); arm.position.set(.43, 1.42, -.1); group.add(arm)
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .72, .22), this.material(jacket)); armMesh.position.y = -.3; armMesh.rotation.x = -.8; armMesh.rotation.z = -.15; arm.add(armMesh)
    const gun = new THREE.Group(); gun.position.set(.03, -.38, -.48); arm.add(gun)
    group.userData.weaponModel = gun
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 5), new THREE.MeshBasicMaterial({ color: '#ff8b32' })); muzzle.position.set(.03, -.38, -.86); muzzle.visible = false; arm.add(muzzle)
    group.userData.muzzle = muzzle
    group.userData.torso = torso
    group.userData.head = head
    group.userData.arm = arm
    group.userData.legs = legs
    group.userData.baseY = 0
    return group
  }

  private rebuildWeaponModel() {
    const model = this.player.userData.weaponModel as THREE.Group
    model.clear()
    const dark = this.material('#20242b', .38)
    const metal = this.material('#59616c', .34)
    const addPart = (w: number, h: number, d: number, x: number, y: number, z: number, material = dark) => {
      const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
      part.position.set(x, y, z); part.castShadow = true; model.add(part)
    }
    if (this.weapon === 'pistol') {
      addPart(.16, .17, .48, 0, 0, -.08)
      addPart(.13, .25, .15, 0, -.17, .02)
      addPart(.08, .08, .12, 0, .08, -.34, metal)
    } else if (this.weapon === 'rifle') {
      addPart(.17, .2, .82, 0, 0, -.2)
      addPart(.12, .12, .62, 0, .03, -.69, metal)
      addPart(.15, .3, .22, 0, -.2, -.08)
      addPart(.18, .16, .3, 0, -.02, .31)
    } else if (this.weapon === 'shotgun') {
      addPart(.2, .22, .72, 0, 0, -.18)
      addPart(.09, .09, .72, 0, .04, -.68, metal)
      addPart(.16, .13, .3, 0, -.1, .28)
      addPart(.17, .1, .26, 0, -.12, -.38)
    } else {
      addPart(.19, .2, .78, 0, 0, -.22)
      addPart(.075, .075, 1.0, 0, .07, -.86, metal)
      addPart(.2, .24, .28, 0, .19, -.32)
      addPart(.18, .14, .38, 0, -.04, .35)
    }
  }
  start() { this.started = true; this.gameStatus = 'FIGHT'; this.publish() }
  continueRound() { if (this.gameStatus === 'ROUND_BREAK') this.beginNextRound() }
  private applyArena(index: number) {
    this.arenaIndex = index % ARENAS.length
    const arena = ARENAS[this.arenaIndex]
    this.scene.background = new THREE.Color(arena.sky)
    this.scene.fog = new THREE.Fog(arena.fog, 35, 115)
    if (this.ground.material instanceof THREE.MeshStandardMaterial) this.ground.material.color.set(arena.ground)
    this.sun.color.set(arena.sun)
    this.sun.intensity = this.arenaIndex === 2 ? 2.2 : 3.2
    this.hemisphere.intensity = this.arenaIndex === 2 ? 1.35 : 2.1
    this.arenaLandmarks.forEach((group, landmarkIndex) => { group.visible = landmarkIndex === this.arenaIndex })
    const paintRoof = (group: THREE.Group, floorColor: string, trimColor: string, coverColor: string, coverStart: number, coverEnd: number) => {
      const paint = (object: THREE.Object3D, color: string) => {
        const mesh = object as THREE.Mesh
        if (mesh.material && (mesh.material as THREE.MeshStandardMaterial).color) (mesh.material as THREE.MeshStandardMaterial).color.set(color)
      }
      paint(group.children[0], floorColor)
      for (let i = 1; i <= 3; i++) paint(group.children[i], trimColor)
      for (let i = coverStart; i <= coverEnd; i++) paint(group.children[i], coverColor)
    }
    paintRoof(this.roof, arena.roof, arena.trim, arena.cover, 9, 10)
    paintRoof(this.farRoof, arena.roof, arena.trim, arena.cover, 4, 5)
  }
  private resetRoundState() {
    this.health = 100; this.enemyHealth = 100
    this.hitFeedback = ''; this.hitFeedbackTimer = 0
    this.weapon = 'pistol'; this.ammoByWeapon = { pistol: 12, rifle: 30, shotgun: 6, sniper: 5 }
    this.reserveByWeapon = { pistol: 48, rifle: 120, shotgun: 30, sniper: 20 }
    this.ammo = 12; this.reserveAmmo = 48; this.reloading = false; this.reloadTimer = 0
    this.aiming = false; this.crouched = false; this.peekDirection = 0
    this.enemyTimer = 0; this.enemyShotWindup = 0; this.enemyCoverTimer = 0; this.enemyPeekTimer = 0
    this.enemyDodgeTimer = 0; this.enemyDodgeDirection = 1
    this.playerAimTimer = 0; this.enemyAimBreakTimer = 0; this.enemyAimBreakCooldown = 0; this.enemyAimBreakDirection = 1
    this.playerCampTimer = 0; this.enemyFlankTimer = 0; this.enemyFlankCooldown = 0
    this.previousPlayerPosition.set(0, 0, 2.3); this.playerVelocity.set(0, 0, 0)
    this.enemyCovering = false; this.enemyPeeking = false; this.enemyHitTimer = 0
    this.recoil = 0; this.player.position.set(0, 0, 2.3); this.enemy.position.set(1.4, 0, -1.7)
    this.player.rotation.set(0, Math.PI, 0); this.enemy.rotation.set(0, Math.PI, 0)
    this.player.userData.arm.rotation.x = 0; this.enemy.userData.arm.rotation.x = 0
    this.keys.clear(); this.touchKeys.clear(); this.rebuildWeaponModel()
  }
  private beginNextRound() {
    this.roundNumber++
    this.resetRoundState()
    this.applyArena((this.roundNumber - 1) % ARENAS.length)
    this.intermissionTimer = 0; this.gameStatus = 'FIGHT'; this.started = true
    this.publish()
  }
  crouch() { this.crouched = !this.crouched }
  peek(direction: -1 | 1) { this.peekDirection = this.peekDirection === direction ? 0 : direction }
  setTouchKey(key: string, pressed: boolean) { pressed ? this.touchKeys.add(key) : this.touchKeys.delete(key) }
  aim() { this.aiming = !this.aiming }
  private blockedByCover(x: number, z: number) {
    return this.coverZones.some(cover => Math.abs(x - cover.x) < cover.halfX + .42 && Math.abs(z - cover.z) < cover.halfZ + .42)
  }
  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3) {
    const direction = to.clone().sub(from)
    const distance = direction.length()
    direction.normalize()
    const ray = new THREE.Ray(from, direction)
    return !this.coverColliders.some(box => {
      const point = ray.intersectBox(box, new THREE.Vector3())
      return point !== null && point.distanceTo(from) < distance - .45
    })
  }
  private isEnemyProtected() {
    if (!this.enemyCovering || this.enemyPeeking) return false
    const p = new THREE.Vector3(); this.enemy.getWorldPosition(p)
    return p.z < -14.8 && Math.abs(p.x - 4.2) < 1.15
  }
  private isPlayerProtected() {
    if (!this.crouched || this.peekDirection !== 0) return false
    return this.coverZones.some(cover => {
      const behindCover = this.player.position.z > cover.z + cover.halfZ
      const closeEnough = this.player.position.z - (cover.z + cover.halfZ) < 2.8
      const aligned = Math.abs(this.player.position.x - cover.x) < cover.halfX + .35
      return behindCover && closeEnough && aligned
    })
  }
  shoot() {
    if (!this.started || this.reloading || this.ammo <= 0 || this.health <= 0 || this.enemyHealth <= 0) return
    this.ammo--
    const config = WEAPONS[this.weapon]
    const origin = new THREE.Vector3(); this.player.localToWorld(origin.set(.46, 1.04, .35))
    let totalDamage = 0
    let headHits = 0
    this.enemy.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster()
    for (let pellet = 0; pellet < config.pellets; pellet++) {
      const target = new THREE.Vector3()
      // Aim mode deliberately centers shots on the head; hip-fire favors the torso.
      const targetHeight = this.aiming ? 1.93 : 1.2
      const horizontalSpread = this.aiming ? .12 : config.spread
      const verticalSpread = this.aiming ? .1 : config.spread * .55
      this.enemy.localToWorld(target.set((Math.random() - .5) * (this.aiming ? .12 : .5), targetHeight + (Math.random() - .5) * verticalSpread, 0))
      target.x += (Math.random() - .5) * horizontalSpread
      const direction = target.clone().sub(origin).normalize()
      raycaster.set(origin, direction)
      raycaster.far = origin.distanceTo(target) + .65
      const hit = raycaster.intersectObjects(this.enemy.children, true).find(item => item.object.userData.hitZone)
      if (hit && this.hasLineOfSight(origin, hit.point) && !this.isEnemyProtected()) {
        const isHead = hit.object.userData.hitZone === 'head'
        totalDamage += config.damage * (isHead ? config.headMultiplier : 1)
        if (isHead) headHits++
      }
    }
    if (totalDamage > 0) {
      this.hitFeedback = headHits > 0 ? 'HEADSHOT' : 'HIT'
      this.hitFeedbackId++
      this.hitFeedbackTimer = .62
      this.enemyHealth = Math.max(0, this.enemyHealth - Math.round(totalDamage)); this.enemyHitTimer = headHits > 0 ? .48 : .3
      // A confirmed hit triggers an evasive counter-move instead of letting the rival stay exposed.
      this.enemyDodgeTimer = headHits > 0 ? 1.05 : .78
      this.enemyDodgeDirection = this.enemy.position.x >= this.player.position.x ? 1 : -1
      this.enemyCovering = false; this.enemyPeeking = false; this.enemyPeekTimer = 0
      const impact = new THREE.Vector3(); this.enemy.localToWorld(impact.set((Math.random() - .5) * .38, headHits > 0 ? 1.93 : 1.2, 0))
      this.spawnImpact(impact, headHits > 0 ? '#fff0a0' : this.weapon === 'sniper' ? '#9fe8ff' : '#ff9b54', headHits > 0 ? 12 : this.weapon === 'shotgun' ? 12 : 7)
    }
    this.recoil = this.weapon === 'sniper' ? 1.5 : this.weapon === 'shotgun' ? 1.25 : this.weapon === 'rifle' ? .72 : .9
    this.flash(this.player)
    this.showTracer(totalDamage > 0)
    this.publish()
    if (this.enemyHealth === 0) this.finish('VICTORY')
  }
  private flash(fighter: THREE.Group) {
    const muzzle = fighter.userData.muzzle as THREE.Mesh
    muzzle.visible = true
    muzzle.scale.setScalar(this.weapon === 'shotgun' ? 1.65 : this.weapon === 'sniper' ? 1.35 : 1)
    const arm = fighter.userData.arm as THREE.Group | undefined
    if (arm) arm.rotation.x = -.18
    window.setTimeout(() => { if (!this.disposed) muzzle.visible = false }, this.weapon === 'sniper' ? 125 : 75)
  }

  private spawnImpact(position: THREE.Vector3, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(.045 + Math.random() * .035, 5, 4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }))
      mesh.position.copy(position); this.scene.add(mesh)
      this.impactParticles.push({ mesh, velocity: new THREE.Vector3((Math.random() - .5) * 3.2, Math.random() * 2.6, (Math.random() - .5) * 2.2), life: .32 + Math.random() * .2, maxLife: .52 })
    }
  }

  private showTracer(hit: boolean) {
    if (this.tracer) { this.scene.remove(this.tracer); this.tracer.geometry.dispose(); this.tracer = null }
    const start = new THREE.Vector3(); const end = new THREE.Vector3()
    this.player.localToWorld(start.set(.46, 1.04, .35))
    this.enemy.localToWorld(end.set(0, 1.2, 0))
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const tracerColor = this.weapon === 'sniper' ? '#9fe8ff' : this.weapon === 'shotgun' ? '#ffb45f' : this.weapon === 'rifle' ? '#ffdf8a' : '#ffd18a'
    const material = new THREE.LineBasicMaterial({ color: hit ? tracerColor : '#9ba9b8', transparent: true, opacity: .9 })
    this.tracer = new THREE.Line(geometry, material); this.scene.add(this.tracer)
    window.setTimeout(() => {
      if (this.tracer) { this.scene.remove(this.tracer); this.tracer.geometry.dispose(); (this.tracer.material as THREE.Material).dispose(); this.tracer = null }
    }, 110)
  }
  switchWeapon() {
    if (this.reloading) return
    this.ammoByWeapon[this.weapon] = this.ammo
    this.reserveByWeapon[this.weapon] = this.reserveAmmo
    const index = WEAPON_ORDER.indexOf(this.weapon)
    this.weapon = WEAPON_ORDER[(index + 1) % WEAPON_ORDER.length]
    this.ammo = this.ammoByWeapon[this.weapon]
    this.reserveAmmo = this.reserveByWeapon[this.weapon]
    this.rebuildWeaponModel()
    this.publish()
  }
  reload() {
    const config = WEAPONS[this.weapon]
    if (this.reloading || this.ammo === config.magazine || this.reserveAmmo <= 0 || !this.started) return
    this.reloading = true
    this.reloadTimer = this.reloadDuration
    const arm = this.player.userData.arm as THREE.Group
    arm.rotation.x = 1.05
    this.publish()
  }
  reset() {
    this.roundsWon = 0; this.roundsLost = 0; this.roundNumber = 1
    this.resetRoundState(); this.applyArena(0); this.intermissionTimer = 0
    this.gameStatus = 'FIGHT'; this.started = true; this.publish()
  }
  private finish(status: 'VICTORY' | 'DEFEAT') {
    this.started = false
    if (status === 'VICTORY') this.roundsWon++
    else this.roundsLost++
    if (this.roundsWon >= 3 || this.roundsLost >= 3) {
      this.gameStatus = this.roundsWon >= 3 ? 'VICTORY' : 'DEFEAT'
    } else {
      this.gameStatus = 'ROUND_BREAK'; this.intermissionTimer = 2.8
    }
    this.publish()
  }
  private publish(status: GameState['status'] = this.gameStatus) {
    this.listener({ health: this.health, enemyHealth: this.enemyHealth, ammo: this.ammo, reserveAmmo: this.reserveAmmo, weapon: this.weapon, reloading: this.reloading, status, kills: this.roundsWon, roundsWon: this.roundsWon, roundsLost: this.roundsLost, roundNumber: this.roundNumber, arenaName: ARENAS[this.arenaIndex].name, hitFeedback: this.hitFeedback, hitFeedbackId: this.hitFeedbackId, damageFlashId: this.damageFlashId })
  }

  private resize() {
    const w = this.host.clientWidth || window.innerWidth
    const h = this.host.clientHeight || window.innerHeight
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false)
  }
  private animate = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    const dt = Math.min(this.clock.getDelta(), .04)
    if (this.hitFeedbackTimer > 0) {
      this.hitFeedbackTimer = Math.max(0, this.hitFeedbackTimer - dt)
      if (this.hitFeedbackTimer === 0 && this.hitFeedback) { this.hitFeedback = ''; this.publish() }
    }
    if (this.impactParticles.length) {
      for (let i = this.impactParticles.length - 1; i >= 0; i--) {
        const particle = this.impactParticles[i]
        particle.life -= dt
        particle.velocity.y -= 5.5 * dt
        particle.mesh.position.addScaledVector(particle.velocity, dt)
        ;(particle.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, particle.life / particle.maxLife)
        if (particle.life <= 0) {
          this.scene.remove(particle.mesh); particle.mesh.geometry.dispose(); (particle.mesh.material as THREE.Material).dispose()
          this.impactParticles.splice(i, 1)
        }
      }
    }
    if (!this.started && this.gameStatus === 'ROUND_BREAK') {
      this.intermissionTimer -= dt
      if (this.intermissionTimer <= 0) this.beginNextRound()
    }
    if (this.started) {
      if (this.reloading) {
        this.reloadTimer -= dt
        const arm = this.player.userData.arm as THREE.Group
        arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, .95, 8, dt)
        if (this.reloadTimer <= 0) {
          const config = WEAPONS[this.weapon]
          const loaded = Math.min(config.magazine - this.ammo, this.reserveAmmo)
          this.ammo += loaded; this.reserveAmmo -= loaded
          this.reloading = false
          arm.rotation.x = 0
          this.ammoByWeapon[this.weapon] = this.ammo
          this.reserveByWeapon[this.weapon] = this.reserveAmmo
          this.publish()
        }
      }
      const speed = 4.4 * dt
      const forward = this.keys.has('KeyW') || this.touchKeys.has('KeyW')
      const back = this.keys.has('KeyS') || this.touchKeys.has('KeyS')
      const left = this.keys.has('KeyA') || this.touchKeys.has('KeyA')
      const right = this.keys.has('KeyD') || this.touchKeys.has('KeyD')
      const moving = forward || back || left || right
      if (this.keys.has('KeyQ')) this.peekDirection = -1
      else if (this.keys.has('KeyE')) this.peekDirection = 1
      const nextX = this.player.position.x + (right ? speed : 0) - (left ? speed : 0)
      const nextZ = this.player.position.z + (back ? speed : 0) - (forward ? speed : 0)
      if (!this.blockedByCover(nextX, this.player.position.z)) this.player.position.x = nextX
      if (!this.blockedByCover(this.player.position.x, nextZ)) this.player.position.z = nextZ
      if (moving) this.walkTime += dt * 10
      this.player.position.x = THREE.MathUtils.clamp(this.player.position.x, -6.8, 6.8)
      this.player.position.z = THREE.MathUtils.clamp(this.player.position.z, -1.8, 6.5)
      this.player.rotation.y = Math.PI
      const playerLegs = this.player.userData.legs as THREE.Mesh[]
      playerLegs.forEach((leg, index) => { const walk = moving ? Math.sin(this.walkTime + index * Math.PI) * .62 : 0; leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, this.crouched ? -.85 + walk * .25 : walk, 10, dt) })
      const targetCrouchY = this.crouched ? -.42 : 0
      this.player.position.y = targetCrouchY + (moving && !this.crouched ? Math.abs(Math.sin(this.walkTime * 2)) * .07 : 0)
      this.player.rotation.z = THREE.MathUtils.damp(this.player.rotation.z, this.peekDirection * -.2, 9, dt)
      this.player.rotation.x = THREE.MathUtils.damp(this.player.rotation.x, this.crouched ? .12 : 0, 9, dt)
      const playerArm = this.player.userData.arm as THREE.Group
      const recoilKick = this.weapon === 'sniper' ? .48 : this.weapon === 'shotgun' ? .38 : this.weapon === 'rifle' ? .24 : .3
      playerArm.rotation.x = THREE.MathUtils.damp(playerArm.rotation.x, this.reloading ? 1.05 : this.aiming ? -.12 : 0, 10, dt) - this.recoil * recoilKick
      this.recoil = Math.max(0, this.recoil - dt * 5)
      this.enemyWalkTime += dt
      const playerDeltaX = this.player.position.x - this.previousPlayerPosition.x
      const playerDeltaZ = this.player.position.z - this.previousPlayerPosition.z
      const playerDisplacement = Math.hypot(playerDeltaX, playerDeltaZ)
      this.playerVelocity.set(playerDeltaX / Math.max(dt, .001), 0, playerDeltaZ / Math.max(dt, .001))
      this.previousPlayerPosition.copy(this.player.position)
      this.enemyFlankCooldown = Math.max(0, this.enemyFlankCooldown - dt)
      // Sustained ADS gives the rival a chance to read the player's commitment and break the sightline.
      this.playerAimTimer = this.aiming ? this.playerAimTimer + dt : Math.max(0, this.playerAimTimer - dt * 2.2)
      this.enemyAimBreakCooldown = Math.max(0, this.enemyAimBreakCooldown - dt)
      this.enemyAimBreakTimer = Math.max(0, this.enemyAimBreakTimer - dt)
      if (this.playerAimTimer > 1.65 && this.enemyAimBreakCooldown <= 0) {
        this.enemyAimBreakTimer = this.roundNumber % 3 === 2 ? 1.35 : 1.05
        this.enemyAimBreakCooldown = this.roundNumber % 3 === 2 ? 4.2 : 5.4
        this.enemyAimBreakDirection = this.enemy.position.x >= this.player.position.x ? -1 : 1
        this.enemyCovering = false; this.enemyPeeking = false; this.enemyPeekTimer = 0
        this.playerAimTimer = 0
      }
      if (this.isPlayerProtected() && playerDisplacement < .035) this.playerCampTimer += dt
      else this.playerCampTimer = Math.max(0, this.playerCampTimer - dt * 2.5)
      // Each round introduces a distinct rival doctrine so the duel evolves as the match progresses.
      const rivalStyle = (this.roundNumber - 1) % 3 // 0: aggressor, 1: sentinel, 2: hunter
      const flankThreshold = (this.weapon === 'sniper' ? 3.1 : 3.8) * (rivalStyle === 2 ? .72 : rivalStyle === 1 ? 1.3 : 1)
      if (this.playerCampTimer > flankThreshold && this.enemyFlankCooldown <= 0) {
        // Punish prolonged passive cover play by rotating to the opposite rooftop angle.
        this.enemyFlankTimer = 2.9
        this.enemyFlankCooldown = 8.5
        this.enemyFlankSide = this.player.position.x >= 0 ? -1 : 1
        this.playerCampTimer = 0
        this.enemyCovering = false; this.enemyPeeking = false; this.enemyPeekTimer = 0
      }
      this.enemyFlankTimer = Math.max(0, this.enemyFlankTimer - dt)
      this.enemyCoverTimer += dt
      const baseCoverInterval = this.weapon === 'sniper' ? 2.45 : this.weapon === 'shotgun' ? 3.2 : this.enemyHealth < 60 ? 2.9 : 3.8
      const coverDecisionInterval = baseCoverInterval * (rivalStyle === 0 ? 1.35 : rivalStyle === 1 ? .62 : .9)
      if (this.enemyCoverTimer > coverDecisionInterval) {
        this.enemyCoverTimer = 0
        // A wounded opponent favors cover; otherwise it alternates between strafing and cover.
        this.enemyCovering = this.enemyHealth < 60 ? Math.random() < .72 : !this.enemyCovering
      }
      this.enemyHitTimer = Math.max(0, this.enemyHitTimer - dt)
      this.enemyDodgeTimer = Math.max(0, this.enemyDodgeTimer - dt)
      if (this.enemyCovering) {
        this.enemyPeekTimer += dt
        const peekCycle = this.weapon === 'sniper' ? 2.2 : 2.55
        if (this.enemyPeekTimer >= peekCycle) this.enemyPeekTimer = 0
        this.enemyPeeking = this.enemyPeekTimer > (this.weapon === 'sniper' ? 1.72 : 1.45)
      } else {
        this.enemyPeekTimer = 0
        this.enemyPeeking = false
      }
      const enemyTorso = this.enemy.userData.torso as THREE.Mesh
      ;(enemyTorso.material as THREE.MeshStandardMaterial).color.set(this.enemyHitTimer > 0 ? '#ffb0a0' : '#d64f48')
      this.enemy.rotation.z = THREE.MathUtils.damp(this.enemy.rotation.z, this.enemyHitTimer > 0 ? .16 : 0, 12, dt)
      this.enemy.rotation.x = THREE.MathUtils.damp(this.enemy.rotation.x, this.enemyHitTimer > 0 ? -.09 : 0, 10, dt)
      const enemyBaseX = 1.4
      const strafeSpeed = (this.weapon === 'sniper' ? 1.45 : 1.05) * (rivalStyle === 0 ? 1.3 : rivalStyle === 1 ? .72 : 1.12)
      const strafeWidth = (this.weapon === 'sniper' ? 2.45 : this.weapon === 'rifle' ? 2.25 : 2.05) * (rivalStyle === 0 ? 1.18 : rivalStyle === 1 ? .78 : 1.08)
      const enemyStrafe = Math.sin(this.enemyWalkTime * strafeSpeed) * strafeWidth
      const playerWorldX = this.player.position.x
      const enemyTargetX = this.enemyDodgeTimer > 0
        ? THREE.MathUtils.clamp(this.enemy.position.x + this.enemyDodgeDirection * 2.35, -4.1, 4.1)
        : this.enemyAimBreakTimer > 0
          ? THREE.MathUtils.clamp(this.enemy.position.x + this.enemyAimBreakDirection * 2.7, -5.2, 5.2)
        : this.enemyFlankTimer > 0
          ? this.enemyFlankSide * 5.25
          : this.enemyCovering
            ? (this.enemyPeeking ? 5.65 : 4.2)
            : THREE.MathUtils.clamp(enemyBaseX + enemyStrafe + playerWorldX * .16, -3.8, 3.8)
      // Keep distance from close-range shotguns; pressure sniper users with faster rotations.
      const enemyTargetZ = this.enemyCovering ? (rivalStyle === 1 ? -4.15 : -3.35) : this.weapon === 'shotgun' ? -4.1 : rivalStyle === 0 ? -.9 : rivalStyle === 2 ? -2.1 : -1.7
      this.enemy.position.x = THREE.MathUtils.damp(this.enemy.position.x, enemyTargetX, 3.8, dt)
      this.enemy.position.z = THREE.MathUtils.damp(this.enemy.position.z, enemyTargetZ, 3.8, dt)
      const enemyLegs = this.enemy.userData.legs as THREE.Mesh[]
      const enemyMoving = Math.abs(this.enemy.position.x - enemyTargetX) > .12 || Math.abs(this.enemy.position.z - enemyTargetZ) > .12
      enemyLegs.forEach((leg, index) => {
        const stride = enemyMoving ? Math.sin(this.enemyWalkTime * 7 + index * Math.PI) * .38 : Math.sin(this.enemyWalkTime * 1.8 + index * Math.PI) * .025
        leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, this.enemyCovering ? -.72 + stride * .2 : stride, 9, dt)
      })
      this.enemy.rotation.y = Math.PI
      this.enemy.position.y = this.enemyCovering ? (this.enemyPeeking ? -.08 : -.32) : Math.abs(Math.sin(this.enemyWalkTime * 2.2)) * .045
      const enemyTorsoGroup = this.enemy.userData.torso as THREE.Mesh
      enemyTorsoGroup.rotation.z = THREE.MathUtils.damp(enemyTorsoGroup.rotation.z, Math.sin(this.enemyWalkTime * 1.7) * (enemyMoving ? .045 : .018), 7, dt)
      const enemyHead = this.enemy.userData.head as THREE.Mesh
      enemyHead.rotation.x = THREE.MathUtils.damp(enemyHead.rotation.x, Math.sin(this.enemyWalkTime * 1.35) * .035, 6, dt)
      // Keep the weapon raised toward the player; lower it slightly while tucked behind cover.
      const enemyArm = this.enemy.userData.arm as THREE.Group
      // Telegraph incoming shots by raising the weapon before the actual hit check.
      this.enemyTimer += dt
      if (this.enemyShotWindup > 0) {
        this.enemyShotWindup = Math.max(0, this.enemyShotWindup - dt)
        enemyArm.rotation.x = THREE.MathUtils.damp(enemyArm.rotation.x, -.62, 12, dt)
        if (this.enemyShotWindup === 0) {
          const protectedByCover = this.isPlayerProtected()
          const enemyOrigin = new THREE.Vector3(); this.enemy.localToWorld(enemyOrigin.set(.46, 1.04, .35))
          const playerTarget = new THREE.Vector3(); this.player.localToWorld(playerTarget.set(0, this.crouched ? .78 : 1.2, 0))
          // Lead a moving target slightly so sustained lateral movement remains useful but not invulnerable.
          const leadTime = this.weapon === 'shotgun' ? .1 : this.weapon === 'sniper' ? .2 : .16
          playerTarget.addScaledVector(this.playerVelocity, leadTime)
          playerTarget.x = THREE.MathUtils.clamp(playerTarget.x, -6.8, 6.8)
          playerTarget.z = THREE.MathUtils.clamp(playerTarget.z, 3.2, 11.5)
          const clearShot = this.hasLineOfSight(enemyOrigin, playerTarget)
          if (!protectedByCover && clearShot && !this.isEnemyProtected()) {
            // Movement and active peeking are meaningful defensive actions, not just animation.
            const playerEvading = playerDisplacement > .035 || this.peekDirection !== 0
            const hitChance = playerEvading ? (this.crouched ? .48 : .58) : .88
            if (Math.random() < hitChance) {
              const baseDamage = this.enemyHealth < 45 ? 13 : 10
              this.health = Math.max(0, this.health - (Math.random() > .5 ? baseDamage + 4 : baseDamage))
              this.damageFlashId++
              this.spawnImpact(playerTarget, '#ff805e', 5)
            } else {
              // A missed burst still gives visual feedback without damaging the player.
              const missPoint = playerTarget.clone()
              missPoint.x += (Math.random() - .5) * (playerEvading ? 2.2 : 1.1)
              missPoint.y += (Math.random() - .5) * .8
              this.spawnImpact(missPoint, '#ffb080', 3)
            }
          }
          if (!this.isEnemyProtected()) this.flash(this.enemy)
          this.publish()
          if (this.health === 0) this.finish('DEFEAT')
        }
      } else {
        enemyArm.rotation.x = THREE.MathUtils.damp(enemyArm.rotation.x, this.enemyCovering && !this.enemyPeeking ? .12 : -.28, 7, dt)
        const shotInterval = (this.enemyHealth < 45 ? 1.65 : 2.0) * (rivalStyle === 0 ? .78 : rivalStyle === 1 ? 1.28 : .92)
        if (this.enemyTimer > shotInterval && this.enemyHealth > 0) {
          this.enemyTimer = 0
          const reactionWindup = (this.weapon === 'sniper' ? .27 : .32) * (rivalStyle === 0 ? .82 : rivalStyle === 1 ? 1.18 : .92)
          if (Math.random() > .04 && (!this.enemyCovering || this.enemyPeeking)) this.enemyShotWindup = reactionWindup
        }
      }
    }
    this.camera.position.x += (this.player.position.x * .2 - this.camera.position.x) * .055
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.aiming ? 6.6 : 7.4, 5, dt)
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.aiming ? 18.4 : 20.2, 5, dt)
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.aiming ? 48 : 56, 6, dt)
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(this.player.position.x * .12 + this.peekDirection * .28, this.crouched ? .95 : 1.3, -9.4)
    this.renderer.render(this.scene, this.camera)
  }
  destroy() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp)
    if (this.tracer) { this.scene.remove(this.tracer); this.tracer.geometry.dispose(); (this.tracer.material as THREE.Material).dispose() }
    this.impactParticles.forEach(p => { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose() }); this.impactParticles = []
    this.renderer.dispose(); this.host.removeChild(this.renderer.domElement)
  }
}