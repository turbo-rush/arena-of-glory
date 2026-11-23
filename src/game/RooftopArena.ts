import * as THREE from 'three'

export type GameState = { health: number; enemyHealth: number; ammo: number; reloading: boolean; status: 'FIGHT' | 'VICTORY' | 'DEFEAT'; kills: number }
type StateListener = (state: GameState) => void

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
  private ammo = 12
  private enemyTimer = 0
  private started = false
  private disposed = false
  private aiming = false
  private walkTime = 0
  private enemyWalkTime = 0
  private recoil = 0
  private muzzleTimer = 0
  private tracer: THREE.Line | null = null
  private listener: StateListener
  private host: HTMLElement
  private onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); if (e.code === 'KeyR') this.reload() }
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)
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
    this.player.position.set(0, 0, 2.3); roof.add(this.player)
    this.enemy = this.createFighter('#d64f48', '#20232d')
    this.enemy.position.set(1.4, 0, -2.5); far.add(this.enemy)
    // Camera follows just behind the player, looking toward the rival rooftop.
    this.camera.position.set(0, 6.4, 17.2)
    this.camera.lookAt(0, 1.35, -10.5)
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
    const gun = new THREE.Mesh(new THREE.BoxGeometry(.14, .14, .72), this.material('#20242b', .4)); gun.position.set(.03, -.38, -.48); arm.add(gun)
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffca71', emissive: '#ff8b32', emissiveIntensity: 2 })); muzzle.position.set(.03, -.38, -.86); muzzle.visible = false; arm.add(muzzle)
    group.userData.muzzle = muzzle
    group.userData.arm = arm
    group.userData.legs = legs
    group.userData.baseY = 0
    return group
  }

  start() { this.started = true }
  setTouchKey(key: string, pressed: boolean) { pressed ? this.touchKeys.add(key) : this.touchKeys.delete(key) }
  aim() { this.aiming = !this.aiming }
  shoot() {
    if (!this.started || this.ammo <= 0 || this.health <= 0 || this.enemyHealth <= 0) return
    this.ammo--
    const hit = Math.random() > (this.aiming ? .08 : .24)
    if (hit) this.enemyHealth = Math.max(0, this.enemyHealth - (this.aiming ? 25 : 16))
    this.recoil = 1
    this.flash(this.player)
    this.showTracer(hit)
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
  reload() {
    if (this.ammo === 12 || !this.started) return
    this.ammo = 12; this.publish()
  }
  reset() { this.health = 100; this.enemyHealth = 100; this.ammo = 12; this.started = true; this.publish() }
  private finish(status: 'VICTORY' | 'DEFEAT') { this.started = false; this.publish(status) }
  private publish(status: GameState['status'] = 'FIGHT') {
    this.listener({ health: this.health, enemyHealth: this.enemyHealth, ammo: this.ammo, reloading: false, status, kills: status === 'VICTORY' ? 1 : 0 })
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
      const speed = 4.4 * dt
      const forward = this.keys.has('KeyW') || this.touchKeys.has('KeyW')
      const back = this.keys.has('KeyS') || this.touchKeys.has('KeyS')
      const left = this.keys.has('KeyA') || this.touchKeys.has('KeyA')
      const right = this.keys.has('KeyD') || this.touchKeys.has('KeyD')
      const moving = forward || back || left || right
      if (forward) this.player.position.z -= speed
      if (back) this.player.position.z += speed
      if (left) this.player.position.x -= speed
      if (right) this.player.position.x += speed
      if (moving) this.walkTime += dt * 10
      this.player.position.x = THREE.MathUtils.clamp(this.player.position.x, -6.8, 6.8)
      this.player.position.z = THREE.MathUtils.clamp(this.player.position.z, -1.8, 6.5)
      this.player.rotation.y = Math.PI
      const playerLegs = this.player.userData.legs as THREE.Mesh[]
      playerLegs.forEach((leg, index) => { leg.rotation.x = moving ? Math.sin(this.walkTime + index * Math.PI) * .62 : THREE.MathUtils.damp(leg.rotation.x, 0, 9, dt) })
      this.player.position.y = moving ? Math.abs(Math.sin(this.walkTime * 2)) * .07 : 0
      const playerArm = this.player.userData.arm as THREE.Group
      playerArm.rotation.x = THREE.MathUtils.damp(playerArm.rotation.x, this.aiming ? -.12 : 0, 10, dt) - this.recoil * .2
      this.recoil = Math.max(0, this.recoil - dt * 5)
      this.enemyWalkTime += dt
      const enemyBaseX = 1.4
      this.enemy.position.x = enemyBaseX + Math.sin(this.enemyWalkTime * .72) * 1.65
      const enemyLegs = this.enemy.userData.legs as THREE.Mesh[]
      enemyLegs.forEach((leg, index) => { leg.rotation.x = Math.sin(this.enemyWalkTime * 4 + index * Math.PI) * .22 })
      this.enemy.rotation.y = Math.PI
      this.enemy.position.y = Math.abs(Math.sin(this.enemyWalkTime * 2)) * .035
      this.enemy.userData.arm.rotation.x = THREE.MathUtils.damp(this.enemy.userData.arm.rotation.x, 0, 8, dt)
      this.enemyTimer += dt
      if (this.enemyTimer > 2.8 && this.enemyHealth > 0) {
        this.enemyTimer = 0
        if (Math.random() > .2) {
          this.health = Math.max(0, this.health - (Math.random() > .5 ? 8 : 12))
          this.flash(this.enemy); this.publish()
          if (this.health === 0) this.finish('DEFEAT')
        }
      }
    }
    this.camera.position.x += (this.player.position.x * .2 - this.camera.position.x) * .055
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.aiming ? 5.8 : 6.4, 5, dt)
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.aiming ? 15.9 : 17.2, 5, dt)
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.aiming ? 45 : 52, 6, dt)
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(this.player.position.x * .12, 1.35, -10.5)
    this.renderer.render(this.scene, this.camera)
  }
  destroy() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp)
    if (this.tracer) { this.scene.remove(this.tracer); this.tracer.geometry.dispose(); (this.tracer.material as THREE.Material).dispose() }
    this.renderer.dispose(); this.host.removeChild(this.renderer.domElement)
  }
}