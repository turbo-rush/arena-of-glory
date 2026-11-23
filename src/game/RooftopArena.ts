import * as THREE from 'three'

export type WeaponId = 'pistol' | 'rifle' | 'shotgun' | 'sniper'
export type GameState = { health: number; enemyHealth: number; ammo: number; reserveAmmo: number; weapon: WeaponId; reloading: boolean; status: 'FIGHT' | 'VICTORY' | 'DEFEAT'; kills: number }
type StateListener = (state: GameState) => void
const WEAPONS: Record<WeaponId, { name: string; subtitle: string; magazine: number; reserve: number; damage: number; headMultiplier: number; spread: number; pellets: number }> = {
  pistol: { name: 'VX-9 SIDEARM', subtitle: 'SEMI-AUTO // 9MM', magazine: 12, reserve: 48, damage: 18, headMultiplier: 2.2, spread: .42, pellets: 1 },
  rifle: { name: 'AR-4 STRIKER', subtitle: 'FULL-AUTO // 5.56MM', magazine: 30, reserve: 120, damage: 12, headMultiplier: 1.8, spread: .34, pellets: 1 },
  shotgun: { name: 'BREACH-12', subtitle: 'PUMP ACTION // 12 GA', magazine: 6, reserve: 30, damage: 7, headMultiplier: 1.25, spread: .95, pellets: 6 },
  sniper: { name: 'M-90 LONGSHOT', subtitle: 'BOLT ACTION // .308', magazine: 5, reserve: 20, damage: 48, headMultiplier: 2.5, spread: .1, pellets: 1 }
}
const WEAPON_ORDER: WeaponId[] = ['pistol', 'rifle', 'shotgun', 'sniper']

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
    this.scene.add(new THREE.HemisphereLight('#dceaff', '#33303b', 2.1))
    const sun = new THREE.DirectionalLight('#ffe0b1', 3.2)
    sun.position.set(-12, 24, 10); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); this.scene.add(sun)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), this.material('#4c5058'))
    ground.rotation.x = -Math.PI / 2; ground.position.y = -3.1; ground.receiveShadow = true; this.scene.add(ground)
    // Distant city skyline
    for (let i = 0; i < 38; i++) {
      const x = (i % 10 - 5) * 8 + Math.sin(i * 4) * 2
      const z = -36 - Math.floor(i / 10) * 15
      const h = 5 + (i * 13 % 17)
      const b = this.box(this.scene, x, h / 2 - 3, z, 4 + i % 3, h, 4, i % 3 ? '#555966' : '#6c6265')
      const windows = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * .72, 0.08), new THREE.MeshBasicMaterial({ color: i % 2 ? '#e7bd83' : '#7d9ba9' }))
      windows.position.set(2.05 + i % 3 * .5, 0, 2.03); b.add(windows)
    }
    // Player rooftop
    const roof = new THREE.Group(); roof.position.set(0, 0, 5); this.scene.add(roof)
    this.box(roof, 0, -0.45, 0, 17, .9, 15, '#353b46')
    this.box(roof, 0, .04, -7.2, 17, 1.2, .5, '#555a64')
    this.box(roof, -8.2, .04, 0, .5, 1.2, 15, '#555a64')
    this.box(roof, 8.2, .04, 0, .5, 1.2, 15, '#555a64')
    for (let i = 0; i < 5; i++) this.box(roof, -6 + i * 3, .12, 5.5, 1.2, .25, 1.2, '#737781')
    this.box(roof, -5.6, .75, -3.5, 2.8, 1.5, 1.1, '#59636e')
    this.box(roof, 5.2, .65, 1.8, 2.4, 1.3, 1.2, '#59636e')
    // Enemy rooftop
    const far = new THREE.Group(); far.position.set(0, 0, -12.5); this.scene.add(far)
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
  }

  private createFighter(jacket: string, pants: string) {
    const group = new THREE.Group()
    const torso = new THREE.Mesh(new THREE.BoxGeometry(.72, 1.05, .42), this.material(jacket)); torso.position.y = 1.2; torso.castShadow = true; group.add(torso)
    const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 8, 7), this.material('#c58f70')); head.position.y = 1.93; head.castShadow = true; group.add(head)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(.57, .18, .5), this.material(pants)); hood.position.set(0, 2.08, -.03); group.add(hood)
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
  start() { this.started = true }
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
    if (!this.enemyCovering) return false
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
    for (let pellet = 0; pellet < config.pellets; pellet++) {
      const isHead = Math.random() < (this.aiming ? .38 : .16) * (this.weapon === 'sniper' ? 1.45 : 1)
      const target = new THREE.Vector3(); this.enemy.localToWorld(target.set((Math.random() - .5) * config.spread, isHead ? 1.96 : 1.2, 0))
      target.x += (Math.random() - .5) * (this.aiming ? .12 : config.spread)
      target.y += (Math.random() - .5) * (this.aiming ? .1 : config.spread * .55)
      if (this.hasLineOfSight(origin, target) && !this.isEnemyProtected() && origin.distanceTo(target) > 0) {
        totalDamage += config.damage * (isHead ? config.headMultiplier : 1)
      }
    }
    if (totalDamage > 0) { this.enemyHealth = Math.max(0, this.enemyHealth - Math.round(totalDamage)); this.enemyHitTimer = .3 }
    this.recoil = 1
    this.flash(this.player)
    this.showTracer(totalDamage > 0)
    this.publish()
    if (this.enemyHealth === 0) this.finish('VICTORY')
  }
  private flash(fighter: THREE.Group) {
    const muzzle = fighter.userData.muzzle as THREE.Mesh
    muzzle.visible = true
    const arm = fighter.userData.arm as THREE.Group | undefined
    if (arm) arm.rotation.x = -.18
    window.setTimeout(() => { if (!this.disposed) muzzle.visible = false }, 85)
  }

  private showTracer(hit: boolean) {
    if (this.tracer) { this.scene.remove(this.tracer); this.tracer.geometry.dispose(); this.tracer = null }
    const start = new THREE.Vector3(); const end = new THREE.Vector3()
    this.player.localToWorld(start.set(.46, 1.04, .35))
    this.enemy.localToWorld(end.set(0, 1.2, 0))
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const material = new THREE.LineBasicMaterial({ color: hit ? '#ffd18a' : '#9ba9b8', transparent: true, opacity: .9 })
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
  reset() { this.health = 100; this.enemyHealth = 100; this.weapon = 'pistol'; this.ammoByWeapon = { pistol: 12, rifle: 30, shotgun: 6, sniper: 5 }; this.reserveByWeapon = { pistol: 48, rifle: 120, shotgun: 30, sniper: 20 }; this.ammo = 12; this.reserveAmmo = 48; this.reloading = false; this.rebuildWeaponModel(); this.started = true; this.publish() }
  private finish(status: 'VICTORY' | 'DEFEAT') { this.started = false; this.publish(status) }
  private publish(status: GameState['status'] = 'FIGHT') {
    this.listener({ health: this.health, enemyHealth: this.enemyHealth, ammo: this.ammo, reserveAmmo: this.reserveAmmo, weapon: this.weapon, reloading: this.reloading, status, kills: status === 'VICTORY' ? 1 : 0 })
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
      playerArm.rotation.x = THREE.MathUtils.damp(playerArm.rotation.x, this.aiming ? -.12 : 0, 10, dt) - this.recoil * .2
      this.recoil = Math.max(0, this.recoil - dt * 5)
      this.enemyWalkTime += dt
      this.enemyCoverTimer += dt
      if (this.enemyCoverTimer > 5.2) { this.enemyCoverTimer = 0; this.enemyCovering = !this.enemyCovering }
      this.enemyHitTimer = Math.max(0, this.enemyHitTimer - dt)
      const enemyTorso = this.enemy.userData.torso as THREE.Mesh
      ;(enemyTorso.material as THREE.MeshStandardMaterial).color.set(this.enemyHitTimer > 0 ? '#ffb0a0' : '#d64f48')
      this.enemy.rotation.z = THREE.MathUtils.damp(this.enemy.rotation.z, this.enemyHitTimer > 0 ? .16 : 0, 12, dt)
      const enemyBaseX = 1.4
      const enemyTargetX = this.enemyCovering ? 4.2 : enemyBaseX + Math.sin(this.enemyWalkTime * .72) * 1.65
      const enemyTargetZ = this.enemyCovering ? -3.35 : -1.7
      this.enemy.position.x = THREE.MathUtils.damp(this.enemy.position.x, enemyTargetX, 2.8, dt)
      this.enemy.position.z = THREE.MathUtils.damp(this.enemy.position.z, enemyTargetZ, 2.8, dt)
      const enemyLegs = this.enemy.userData.legs as THREE.Mesh[]
      enemyLegs.forEach((leg, index) => { leg.rotation.x = Math.sin(this.enemyWalkTime * 4 + index * Math.PI) * .22 })
      this.enemy.rotation.y = Math.PI
      this.enemy.position.y = this.enemyCovering ? -.32 : Math.abs(Math.sin(this.enemyWalkTime * 2)) * .035
      this.enemy.userData.arm.rotation.x = THREE.MathUtils.damp(this.enemy.userData.arm.rotation.x, 0, 8, dt)
      this.enemyTimer += dt
      if (this.enemyTimer > 2.8 && this.enemyHealth > 0) {
        this.enemyTimer = 0
        if (Math.random() > .2) {
          const protectedByCover = this.isPlayerProtected()
          const enemyOrigin = new THREE.Vector3(); this.enemy.localToWorld(enemyOrigin.set(.46, 1.04, .35))
          const playerTarget = new THREE.Vector3(); this.player.localToWorld(playerTarget.set(0, 1.2, 0))
          const clearShot = this.hasLineOfSight(enemyOrigin, playerTarget)
          if (!protectedByCover && clearShot && !this.isEnemyProtected()) this.health = Math.max(0, this.health - (Math.random() > .5 ? 8 : 12))
          if (!this.isEnemyProtected()) this.flash(this.enemy)
          this.publish()
          if (this.health === 0) this.finish('DEFEAT')
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
    this.renderer.dispose(); this.host.removeChild(this.renderer.domElement)
  }
}