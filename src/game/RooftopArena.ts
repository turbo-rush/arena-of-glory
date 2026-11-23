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
    this.camera.position.set(0, 5.6, 12.5)
    this.camera.lookAt(0, 1.2, -13)
  }

  private createFighter(jacket: string, pants: string) {
    const group = new THREE.Group()
    const torso = new THREE.Mesh(new THREE.BoxGeometry(.72, 1.05, .42), this.material(jacket)); torso.position.y = 1.2; torso.castShadow = true; group.add(torso)
    const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 8, 7), this.material('#c58f70')); head.position.y = 1.93; head.castShadow = true; group.add(head)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(.57, .18, .5), this.material(pants)); hood.position.set(0, 2.08, -.03); group.add(hood)
    for (const x of [-.2, .2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.25, .7, .3), this.material(pants)); leg.position.set(x, .36, 0); leg.castShadow = true; group.add(leg)
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.2, .72, .22), this.material(jacket)); arm.position.set(.43, 1.12, -.1); arm.rotation.x = -.8; arm.rotation.z = -.15; group.add(arm)
    const gun = new THREE.Mesh(new THREE.BoxGeometry(.14, .14, .72), this.material('#20242b', .4)); gun.position.set(.46, 1.04, -.52); group.add(gun)
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffca71' })); muzzle.position.set(.46, 1.03, -.9); muzzle.visible = false; group.add(muzzle)
    group.userData.muzzle = muzzle
    return group
  }

  start() { this.started = true }
  setTouchKey(key: string, pressed: boolean) { pressed ? this.touchKeys.add(key) : this.touchKeys.delete(key) }
  aim() { this.aiming = !this.aiming }
  shoot() {
    if (!this.started || this.ammo <= 0 || this.health <= 0 || this.enemyHealth <= 0) return
    this.ammo--
    const hit = Math.random() > .28
    if (hit) this.enemyHealth = Math.max(0, this.enemyHealth - (this.aiming ? 24 : 14))
    this.flash(this.player)
    this.publish()
    if (this.enemyHealth === 0) this.finish('VICTORY')
  }
  private flash(fighter: THREE.Group) {
    const muzzle = fighter.userData.muzzle as THREE.Mesh
    muzzle.visible = true
    window.setTimeout(() => { if (!this.disposed) muzzle.visible = false }, 90)
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
      const speed = 5.2 * dt
      const forward = this.keys.has('KeyW') || this.touchKeys.has('KeyW')
      const back = this.keys.has('KeyS') || this.touchKeys.has('KeyS')
      const left = this.keys.has('KeyA') || this.touchKeys.has('KeyA')
      const right = this.keys.has('KeyD') || this.touchKeys.has('KeyD')
      if (forward) this.player.position.z -= speed
      if (back) this.player.position.z += speed
      if (left) this.player.position.x -= speed
      if (right) this.player.position.x += speed
      this.player.position.x = THREE.MathUtils.clamp(this.player.position.x, -6.8, 6.8)
      this.player.position.z = THREE.MathUtils.clamp(this.player.position.z, -1.8, 6.5)
      this.player.rotation.y = Math.PI
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
    this.camera.position.x += (this.player.position.x * .24 - this.camera.position.x) * .035
    this.camera.lookAt(this.player.position.x * .12, 1.2, -13)
    this.renderer.render(this.scene, this.camera)
  }
  destroy() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp)
    this.renderer.dispose(); this.host.removeChild(this.renderer.domElement)
  }
}