import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { DuelInput } from '../net/duelTransport'

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
  private characterLoader = new GLTFLoader()
  private readonly lowPowerDevice = window.matchMedia('(max-width: 900px)').matches || (navigator.hardwareConcurrency || 4) <= 6
  private camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300)
  private renderer: THREE.WebGLRenderer
  private player!: THREE.Group
  private enemy!: THREE.Group
  private onlineMode = false
  private networkTimer = 0
  private inputSequence = 0
  private onLocalInput?: (input: DuelInput) => void
  private onLocalFire?: (weapon: WeaponId, aimYaw: number, aimPitch: number) => void
  private onLocalReload?: () => void
  private onLocalSwitchWeapon?: (weapon: WeaponId) => void
  private remoteCrouched = false
  private remoteAiming = false
  private remoteLookPitch = 0
  private remoteWeapon: WeaponId = 'pistol'
  private remoteReloadTimer = 0
  private remoteFireTimer = 0
  private remoteTarget = new THREE.Vector3(1.4, 0, -1.7)
  private remoteTargetYaw = Math.PI
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
    this.characterLoader.setMeshoptDecoder(MeshoptDecoder)
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.lowPowerDevice, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowPowerDevice ? 1.1 : 1.25))
    this.renderer.shadowMap.enabled = false
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
    mesh.position.set(x, y, z); mesh.castShadow = false; mesh.receiveShadow = false; parent.add(mesh); return mesh
  }

  private buildWorld() {
    this.hemisphere = new THREE.HemisphereLight('#dceaff', '#33303b', 2.1); this.scene.add(this.hemisphere)
    this.sun = new THREE.DirectionalLight('#ffe0b1', 3.2)
    this.sun.position.set(-12, 24, 10); this.sun.castShadow = false; this.scene.add(this.sun)
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), this.material('#4c5058'))
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -3.1; this.ground.receiveShadow = true; this.scene.add(this.ground)
    // Distant city skyline
    for (let i = 0; i < (this.lowPowerDevice ? 12 : 38); i++) {
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
    this.addRoofGraphics(roof, 17, 15, '#ff8b45')
    // Enemy rooftop
    const far = new THREE.Group(); this.farRoof = far; far.position.set(0, 0, -12.5); this.scene.add(far)
    this.box(far, 0, -0.45, 0, 15, .9, 12, '#383d49')
    this.box(far, -7.2, .1, 0, .5, 1.3, 12, '#656a72')
    this.box(far, 7.2, .1, 0, .5, 1.3, 12, '#656a72')
    this.box(far, 0, .1, -5.8, 15, 1.3, .5, '#656a72')
    this.box(far, -4.5, .8, 2, 2.5, 1.6, 1.2, '#59636e')
    this.box(far, 4.2, .7, -1.8, 2.5, 1.4, 1.2, '#59636e')
    this.addRoofGraphics(far, 15, 12, '#ffbd70')
    this.player = this.createFighter('volt')
    this.player.position.set(0, 0, 2.3); this.player.scale.setScalar(0.78); roof.add(this.player)
    this.enemy = this.createFighter('vex')
    this.enemy.position.set(-1.4, 0, 0.8); this.enemy.scale.setScalar(0.78); far.add(this.enemy)
    this.rebuildWeaponModel()
    // Camera follows just behind the player, looking toward the rival rooftop.
    this.camera.position.set(0, 7.4, 20.2)
    this.camera.lookAt(0, 1.3, -9.4)
    this.applyArena(0)
  }

  private addRoofGraphics(parent: THREE.Group, width: number, depth: number, accentColor: string) {
    const graphic = new THREE.Group()
    graphic.position.y = .012
    parent.add(graphic)
    const ink = new THREE.MeshBasicMaterial({ color: '#202733' })
    const accent = new THREE.MeshBasicMaterial({ color: accentColor })
    const pale = new THREE.MeshBasicMaterial({ color: '#e8d9c3' })
    const addMark = (w: number, d: number, x: number, z: number, material: THREE.Material, rotation = 0) => {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material)
      mark.rotation.x = -Math.PI / 2
      mark.rotation.z = rotation
      mark.position.set(x, 0, z)
      graphic.add(mark)
      return mark
    }

    // Painted rooftop lane graphics: decorative only, with no collision or gameplay effect.
    addMark(width * .72, .035, 0, depth * .31, accent)
    addMark(width * .72, .035, 0, -depth * .31, accent)
    addMark(.045, depth * .58, -width * .43, 0, accent)
    addMark(.045, depth * .58, width * .43, 0, accent)
    addMark(2.5, .11, 0, depth * .22, ink)
    addMark(1.7, .055, 0, depth * .22, pale)
    // Directional chevrons along the rear edge give the roof a graphic arena identity.
    for (let i = -2; i <= 2; i++) {
      addMark(.72, .09, i * 1.15, -depth * .38, accent, Math.PI / 4)
      addMark(.72, .09, i * 1.15, -depth * .38 - .32, accent, -Math.PI / 4)
    }

    // Low-profile LED edge strips stay flush with the roof surface.
    const led = new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: .88 })
    const edge = (w: number, d: number, x: number, z: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, .035, d), led)
      bar.position.set(x, .035, z)
      graphic.add(bar)
    }
    edge(width * .68, .045, 0, depth * .47)
    edge(width * .68, .045, 0, -depth * .47)
    edge(.045, depth * .7, -width * .47, 0)
    edge(.045, depth * .7, width * .47, 0)
  }

  private createFighter(character: 'volt' | 'vex') {
    const group = new THREE.Group()
    const isVolt = character === 'volt'
    const jacketColor = isVolt ? '#202936' : '#211d32'
    const pantsColor = isVolt ? '#293442' : '#252538'
    const accentColor = isVolt ? '#ff713d' : '#f044a0'
    const secondaryColor = isVolt ? '#ffd447' : '#a45cff'
    const skinColor = isVolt ? '#bd8064' : '#d69a83'
    const cloth = this.material(jacketColor, .9)
    const pants = this.material(pantsColor, .92)
    const accent = this.material(accentColor, .62)
    const secondary = this.material(secondaryColor, .7)
    const skin = this.material(skinColor, .88)
    const rubber = this.material('#111722', .96)
    const metal = this.material('#65717e', .38)
    const addBox = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, rz = 0) => {
      const radius = Math.min(w, h, d) * .18
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat)
      mesh.position.set(x, y, z); mesh.rotation.z = rz; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh)
      return mesh
    }
    const addSphere = (parent: THREE.Object3D, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat)
      mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; parent.add(mesh)
      return mesh
    }
    const addCone = (parent: THREE.Object3D, x: number, y: number, z: number, radius: number, height: number, mat: THREE.Material, rotationX = 0, rotationZ = 0) => {
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), mat)
      mesh.position.set(x, y, z); mesh.rotation.set(rotationX, 0, rotationZ); mesh.castShadow = true; parent.add(mesh)
      return mesh
    }

    // Shared athletic base silhouette; hit zones stay on the torso and head.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(isVolt ? .34 : .3, isVolt ? .38 : .45, 5, 12), cloth)
    torso.scale.set(isVolt ? 1.08 : 1, 1, .72)
    torso.position.y = 1.2; torso.castShadow = true; torso.userData.hitZone = 'body'; group.add(torso)
    group.userData.character = character
    // Layered street-fighter tailoring: cropped panels, reinforced shoulders and utility details.
    addBox(group, isVolt ? .88 : .74, .2, .5, 0, 1.67, 0, cloth)
    addBox(group, isVolt ? .2 : .16, .28, .49, isVolt ? -.34 : -.29, 1.55, .015, secondary, isVolt ? -.08 : .12)
    addBox(group, isVolt ? .2 : .16, .28, .49, isVolt ? .34 : .29, 1.55, .015, accent, isVolt ? .08 : -.12)
    addBox(group, .78, .12, .47, 0, .83, 0, rubber)
    addBox(group, .18, .16, .035, isVolt ? -.29 : .25, .85, .245, metal)
    addBox(group, .12, .22, .035, isVolt ? .29 : -.25, .85, .245, accent)
    const shirt = this.material(isVolt ? '#e8e2d5' : '#d8d0e2', .95)
    addBox(group, .3, .62, .035, 0, 1.22, .232, shirt)
    addBox(group, .12, .62, .045, -.22, 1.2, .244, accent, -.08)
    addBox(group, .12, .62, .045, .22, 1.2, .244, accent, .08)
    addBox(group, .16, .72, .045, -.31, 1.22, .235, secondary, -.12)
    addBox(group, .16, .72, .045, .31, 1.22, .235, secondary, .12)
    addBox(group, .58, .11, .46, 0, .76, 0, rubber)
    addBox(group, .16, .13, .08, 0, .76, .27, metal)

    // A shaped neck and jaw give the face a more intentional, character-led silhouette.
    addSphere(group, 0, 1.72, .015, .16, .2, .16, skin)
    const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 16, 12), skin)
    head.position.y = 1.93; head.scale.set(isVolt ? 1 : .94, 1.08, .94); head.castShadow = true; head.userData.hitZone = 'head'; group.add(head)
    addSphere(group, 0, 1.79, .115, .19, .13, .16, skin)
    const earInner = this.material(isVolt ? '#965f50' : '#ad7567', .9)
    addSphere(group, -.265, 1.94, -.005, .055, .09, .07, skin)
    addSphere(group, .265, 1.94, -.005, .055, .09, .07, skin)
    addSphere(group, -.28, 1.94, .048, .018, .045, .018, earInner)
    addSphere(group, .28, 1.94, .048, .018, .045, .018, earInner)
    // Soft cheek planes, eye highlights and sculpted brows keep expressions legible at game distance.
    addSphere(group, -.145, 1.885, .205, .09, .055, .035, skin)
    addSphere(group, .145, 1.885, .205, .09, .055, .035, skin)
    const eyeWhite = this.material('#f1e9df', .7)
    const eyeDark = this.material('#25212a', .6)
    const eyeGlint = new THREE.MeshBasicMaterial({ color: '#ffffff' })
    addSphere(group, -.095, 1.97, .244, .047, .026, .022, eyeWhite)
    addSphere(group, .095, 1.97, .244, .047, .026, .022, eyeWhite)
    addSphere(group, -.095, 1.97, .264, .018, .021, .012, eyeDark)
    addSphere(group, .095, 1.97, .264, .018, .021, .012, eyeDark)
    addSphere(group, -.101, 1.981, .276, .006, .007, .004, eyeGlint)
    addSphere(group, .089, 1.981, .276, .006, .007, .004, eyeGlint)
    const brow = this.material(isVolt ? '#28232a' : '#492b48', .82)
    addSphere(group, -.095, 2.025, .238, .067, .018, .025, brow)
    addSphere(group, .095, 2.025, .238, .067, .018, .025, brow)
    addSphere(group, 0, 1.91, .264, .032, .052, .035, skin)
    addSphere(group, 0, 1.855, .252, .052, .012, .018, this.material('#70483f', .8))
    addSphere(group, 0, 1.835, .249, .038, .009, .015, this.material('#c17d75', .8))

    if (isVolt) {
      const hair = this.material('#171b24', .78)
      addSphere(group, 0, 2.13, -.025, .29, .19, .29, hair)
      addCone(group, -.17, 2.22, .02, .12, .34, hair, 0, -.72)
      addCone(group, -.02, 2.27, .08, .13, .36, hair, 0, -.18)
      addCone(group, .13, 2.23, .015, .12, .32, hair, 0, .55)
      const strandA = new THREE.Mesh(new THREE.CapsuleGeometry(.065, .22, 4, 8), hair)
      strandA.position.set(-.19, 2.12, .16); strandA.rotation.z = -.48; strandA.rotation.x = -.3; group.add(strandA)
      const strandB = new THREE.Mesh(new THREE.CapsuleGeometry(.06, .2, 4, 8), hair)
      strandB.position.set(.015, 2.16, .2); strandB.rotation.z = .2; strandB.rotation.x = -.4; group.add(strandB)
      const strandC = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .18, 4, 8), hair)
      strandC.position.set(.19, 2.1, .12); strandC.rotation.z = .55; strandC.rotation.x = -.25; group.add(strandC)
      addSphere(group, -.25, 1.98, -.015, .09, .2, .12, hair)
      // Signature lightning mark and asymmetric utility details.
      addBox(group, .08, .24, .025, .02, 1.24, -.228, accent, .28)
      addBox(group, .16, .07, .026, .04, 1.15, -.23, accent, -.35)
      addBox(group, .22, .25, .08, -.42, 1.03, .02, pants, -.12)
      addBox(group, .22, .25, .08, .42, 1.03, .02, pants, .12)
      addBox(group, .12, .09, .035, -.42, 1.03, .07, secondary)
      addBox(group, .12, .09, .035, .42, 1.03, .07, accent)
    } else {
      const hair = this.material('#f044a0', .68)
      const darkHair = this.material('#33203f', .78)
      addSphere(group, 0, 2.13, -.015, .29, .19, .29, hair)
      addBox(group, .12, .28, .08, -.2, 2.02, .08, hair, -.22)
      addBox(group, .12, .24, .08, .2, 2.02, .08, hair, .2)
      const fringeLeft = new THREE.Mesh(new THREE.CapsuleGeometry(.065, .19, 4, 8), hair)
      fringeLeft.position.set(-.15, 2.075, .19); fringeLeft.rotation.z = -.28; fringeLeft.rotation.x = -.35; group.add(fringeLeft)
      const fringeRight = new THREE.Mesh(new THREE.CapsuleGeometry(.06, .17, 4, 8), hair)
      fringeRight.position.set(.13, 2.08, .19); fringeRight.rotation.z = .3; fringeRight.rotation.x = -.35; group.add(fringeRight)
      const pony = new THREE.Group(); pony.position.set(.02, 2.13, -.19); group.add(pony)
      group.userData.pony = pony
      addSphere(pony, .02, .15, -.08, .14, .2, .15, hair)
      addSphere(pony, .05, .34, -.18, .12, .22, .13, hair)
      addSphere(pony, .1, .53, -.3, .1, .2, .11, hair)
      const ponyTail = new THREE.Mesh(new THREE.CapsuleGeometry(.085, .36, 5, 10), hair)
      ponyTail.position.set(.12, .67, -.38); ponyTail.rotation.x = -.42; ponyTail.rotation.z = .16; pony.add(ponyTail)
      addCone(pony, .12, .88, -.47, .085, .22, hair, -.48, .2)
      addBox(group, .1, .08, .08, 0, 2.13, -.23, secondary)
      addBox(group, .055, .2, .03, 0, 1.98, -.23, darkHair, .12)
      // Cropped jacket, asymmetric belt rig and bold VEX back insignia.
      addBox(group, .24, .08, .025, 0, .88, -.23, accent, -.08)
      addBox(group, .08, .24, .025, .02, 1.03, -.23, secondary, .25)
      addBox(group, .22, .22, .08, -.36, 1.02, .02, secondary, -.16)
      addBox(group, .22, .22, .08, .36, 1.02, .02, pants, .16)
      addBox(group, .1, .1, .04, -.36, 1.02, .07, accent)
      addBox(group, .1, .1, .04, .36, 1.02, .07, secondary)
    }

    const legs: THREE.Mesh[] = []
    for (const x of (isVolt ? [-.23, .23] : [-.18, .18])) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(isVolt ? .135 : .115, .42, 4, 10), pants)
      leg.scale.z = .92
      leg.position.set(x, .36, 0); leg.castShadow = true; group.add(leg); legs.push(leg)
      addSphere(leg, 0, -.31, -.08, isVolt ? .22 : .2, .105, .31, rubber)
      addSphere(leg, 0, -.36, -.08, isVolt ? .225 : .205, .035, .315, accent)
      addSphere(leg, 0, -.22, .15, .14, .075, .045, secondary)
      addSphere(leg, 0, -.1, .16, .15, .09, .05, isVolt ? metal : secondary)
    }
    // Character-specific streetwear tailoring: cargo pockets, articulated knee guards and layered sneaker soles.
    legs.forEach((leg, index) => {
      const side = index === 0 ? -1 : 1
      addBox(leg, .17, .17, .075, side * .105, .035, .105, isVolt ? secondary : accent, side * -.08)
      addBox(leg, .19, .045, .09, side * .105, -.035, .153, metal, side * -.08)
      addBox(leg, .205, .15, .09, 0, -.12, .145, isVolt ? rubber : secondary)
      addBox(leg, .16, .035, .105, 0, -.12, .197, accent)
      addBox(leg, isVolt ? .34 : .31, .045, .46, 0, -.39, -.08, rubber)
      addBox(leg, isVolt ? .28 : .26, .025, .39, 0, -.365, -.075, accent)
      addBox(leg, .075, .055, .025, side * .07, -.22, .205, metal)
    })

    // A diagonal utility harness, compact shoulder webbing and reinforced cuff seams add layered material reads.
    const harnessMaterial = this.material(isVolt ? '#3a4654' : '#47344f', .82)
    const harnessPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.34, 1.62, .255),
      new THREE.Vector3(-.2, 1.48, .27),
      new THREE.Vector3(0, 1.28, .275),
      new THREE.Vector3(.22, 1.08, .27),
      new THREE.Vector3(.34, .91, .245)
    ])
    const harness = new THREE.Mesh(new THREE.TubeGeometry(harnessPath, 16, .035, 6, false), harnessMaterial)
    harness.castShadow = true
    group.add(harness)
    addBox(group, .12, .14, .055, .13, 1.34, .3, metal, -.55)
    addBox(group, .09, .11, .045, .18, 1.27, .31, accent, -.55)

    // Distinctive gloves and forearm guards.
    const leftArm = new THREE.Group(); leftArm.position.set(-.43, 1.42, -.08); group.add(leftArm)
    const leftSleeve = new THREE.Mesh(new THREE.CapsuleGeometry(.105, .42, 4, 10), cloth)
    leftSleeve.rotation.z = .08; leftSleeve.position.set(0, -.3, 0); leftArm.add(leftSleeve)
    addSphere(leftArm, 0, -.58, .015, .12, .09, .13, rubber)
    addSphere(leftArm, 0, -.43, .015, .125, .055, .135, accent)
    addBox(leftArm, .22, .055, .19, 0, -.49, .015, metal)
    addBox(leftArm, .12, .035, .2, 0, -.49, .12, secondary)

    const arm = new THREE.Group(); arm.position.set(.43, 1.42, -.1); group.add(arm)
    const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(.105, .48, 4, 10), cloth)
    armMesh.position.y = -.3; armMesh.rotation.x = -.8; armMesh.rotation.z = -.15; arm.add(armMesh)
    addSphere(arm, 0, -.56, .02, .12, .09, .13, rubber)
    addSphere(arm, 0, -.43, .02, .125, .055, .135, accent)
    addBox(arm, .22, .055, .19, 0, -.49, .02, metal)
    addBox(arm, .12, .035, .2, 0, -.49, .125, secondary)
    const gun = new THREE.Group(); gun.position.set(.03, -.38, -.48); arm.add(gun)
    group.userData.weaponModel = gun
    const muzzle = new THREE.Mesh(new THREE.OctahedronGeometry(.13, 0), new THREE.MeshBasicMaterial({ color: '#ffb34f' }))
    muzzle.position.set(.03, -.38, -.86); muzzle.visible = false; arm.add(muzzle)
    group.userData.muzzle = muzzle
    group.userData.torso = torso
    group.userData.head = head
    group.userData.arm = arm
    group.userData.legs = legs
    const shoulderPads = new THREE.Group(); shoulderPads.position.y = 1.62; group.add(shoulderPads)
    addBox(shoulderPads, .2, .12, .25, -.38, 0, 0, secondary, -.12)
    addBox(shoulderPads, .2, .12, .25, .38, 0, 0, accent, .12)
    group.userData.shoulderPads = shoulderPads
    // Character-specific forearm guards and a visible shoulder badge.
    addBox(leftArm, .25, .18, .25, 0, -.12, .015, secondary)
    addBox(group, .18, .18, .035, isVolt ? -.39 : .39, 1.61, .245, accent, isVolt ? -.12 : .12)
    // Dedicated hit volumes remain independent from the rendered character asset.
    delete torso.userData.hitZone
    delete head.userData.hitZone
    const bodyHitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(.34, .42, 4, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
    )
    bodyHitbox.position.set(0, 1.2, 0)
    bodyHitbox.userData.hitZone = 'body'
    group.add(bodyHitbox)
    const headHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(.29, 12, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
    )
    headHitbox.position.set(0, 1.94, 0)
    headHitbox.userData.hitZone = 'head'
    group.add(headHitbox)
    group.userData.baseY = 0
    this.loadCharacterModel(group, character)
    return group
  }

  private loadCharacterModel(fighter: THREE.Group, character: 'volt' | 'vex') {
    // Mobile devices use separately optimized assets; desktop keeps the high-detail originals.
    const modelPath = this.lowPowerDevice
      ? `/models/${character}-mobile.glb`
      : `/models/${character}.glb`
    this.characterLoader.load(modelPath, (gltf) => {
      if (this.disposed || !fighter.parent) {
        gltf.scene.traverse(object => {
          const mesh = object as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose())
          else if (mesh.material) mesh.material.dispose()
        })
        return
      }

      const weapon = fighter.userData.weaponModel as THREE.Group | undefined
      const muzzle = fighter.userData.muzzle as THREE.Mesh | undefined
      if (weapon) weapon.parent?.remove(weapon)
      if (muzzle) muzzle.parent?.remove(muzzle)

      // Keep the gameplay rig as a compatibility layer, but render the generated skinned model.
      fighter.traverse(object => {
        if (object instanceof THREE.Mesh && !object.userData.hitZone && (!weapon || !weapon.getObjectById(object.id)) && object !== muzzle) {
          object.visible = false
        }
      })

      const visual = gltf.scene
      const originalBounds = new THREE.Box3().setFromObject(visual)
      const originalSize = originalBounds.getSize(new THREE.Vector3())
      const modelScale = 2.3 / Math.max(originalSize.y, .001)
      visual.scale.setScalar(modelScale)
      visual.updateMatrixWorld(true)
      const fittedBounds = new THREE.Box3().setFromObject(visual)
      visual.position.set(
        -(fittedBounds.min.x + fittedBounds.max.x) * .5,
        -fittedBounds.min.y,
        -(fittedBounds.min.z + fittedBounds.max.z) * .5
      )
      visual.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = false
          object.receiveShadow = false
          if (Array.isArray(object.material)) object.material.forEach(material => { material.side = THREE.DoubleSide })
          else object.material.side = THREE.DoubleSide
        }
      })
      fighter.add(visual)

      // Attach the existing weapon prop to the generated skeleton's right hand when available.
      let rightHand: THREE.Bone | undefined
      visual.traverse(object => {
        if (object instanceof THREE.Bone && /right.?hand/i.test(object.name)) rightHand = object
      })
      if (weapon) {
        if (rightHand) {
          rightHand.add(weapon)
          weapon.position.set(0, 0, 0)
          weapon.rotation.set(Math.PI / 2, 0, Math.PI / 2)
          weapon.scale.setScalar(.72)
        } else {
          fighter.add(weapon)
          weapon.position.set(.34, 1.22, .18)
          weapon.rotation.set(0, Math.PI, 0)
          weapon.scale.setScalar(.72)
        }
      }
      if (muzzle && weapon) {
        weapon.add(muzzle)
        muzzle.position.set(0, 0, -.42)
        muzzle.rotation.set(0, 0, 0)
      }

      const mixer = new THREE.AnimationMixer(visual)
      const clips = gltf.animations
      const findClip = (pattern: RegExp) => clips.find(clip => pattern.test(clip.name))
      const actions: Record<string, THREE.AnimationAction | undefined> = {
        idle: findClip(/idle|stand|breath/i) ? mixer.clipAction(findClip(/idle|stand|breath/i)!) : undefined,
        run: findClip(/run|walk|locomotion/i) ? mixer.clipAction(findClip(/run|walk|locomotion/i)!) : undefined,
        shoot: findClip(/shoot|fire|attack/i) ? mixer.clipAction(findClip(/shoot|fire|attack/i)!) : undefined,
        reload: findClip(/reload/i) ? mixer.clipAction(findClip(/reload/i)!) : undefined,
        hit: findClip(/hit|damage/i) ? mixer.clipAction(findClip(/hit|damage/i)!) : undefined
      }
      if (!actions.idle && clips[0]) actions.idle = mixer.clipAction(clips[0])
      fighter.userData.modelMixer = mixer
      fighter.userData.modelActions = actions
      fighter.userData.activeModelAction = ''
      fighter.userData.modelActionHold = 0
      this.setCharacterAnimation(fighter, 'idle')
    }, undefined, (error) => {
      console.error(`Failed to load ${character} character model from ${modelPath}; keeping emergency fallback.`, error)
    })
  }

  private setCharacterAnimation(fighter: THREE.Group, state: 'idle' | 'run' | 'shoot' | 'reload' | 'hit') {
    const actions = fighter.userData.modelActions as Record<string, THREE.AnimationAction | undefined> | undefined
    if (!actions) return
    if ((state === 'idle' || state === 'run') && (fighter.userData.modelActionHold as number || 0) > 0) return
    const next = actions[state] || actions.idle
    if (!next || fighter.userData.activeModelAction === state) return
    const previous = actions[fighter.userData.activeModelAction as string]
    next.reset().fadeIn(.14).play()
    previous?.fadeOut(.14)
    fighter.userData.activeModelAction = state
  }

  private triggerCharacterAnimation(fighter: THREE.Group, state: 'shoot' | 'reload' | 'hit', holdSeconds: number) {
    fighter.userData.modelActionHold = holdSeconds
    // Re-trigger one-shot actions even when two shots happen in quick succession.
    fighter.userData.activeModelAction = ''
    this.setCharacterAnimation(fighter, state)
  }

  private buildWeaponModel(model: THREE.Group, weapon: WeaponId) {
    model.clear()
    const dark = this.material('#20242b', .38)
    const metal = this.material('#697583', .3)
    const accent = this.material('#ff8b45', .42)
    const glow = new THREE.MeshBasicMaterial({ color: '#ffc36a' })
    const grip = this.material('#111820', .92)
    const addPart = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = dark, bevel = false) => {
      const geometry = bevel
        ? new THREE.BoxGeometry(w, h, d, 1, 1, 1)
        : new THREE.BoxGeometry(w, h, d)
      const part = new THREE.Mesh(geometry, material)
      part.position.set(x, y, z); part.castShadow = true; part.receiveShadow = true; model.add(part)
      return part
    }
    const addBarrel = (length: number, radius: number, z: number) => {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), metal)
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0, .035, z); barrel.castShadow = true; model.add(barrel)
      addPart(radius * 2.8, radius * 2.8, .055, 0, .035, z - length * .43, accent)
    }
    const addSight = (z: number, size = 1) => {
      addPart(.19 * size, .045, .2 * size, 0, .145, z, metal)
      addPart(.075 * size, .11 * size, .075 * size, 0, .21 * size, z, dark)
      addPart(.035 * size, .025 * size, .035 * size, 0, .27 * size, z, glow)
    }
    if (weapon === 'pistol') {
      addPart(.17, .18, .5, 0, 0, -.08)
      addPart(.135, .27, .17, 0, -.17, .025, grip)
      addPart(.09, .07, .13, 0, .085, -.34, metal)
      addPart(.035, .035, .19, 0, .105, -.12, accent)
      addBarrel(.12, .045, -.38)
      addPart(.13, .035, .14, 0, -.3, .02, accent)
      addSight(-.28, .72)
    } else if (weapon === 'rifle') {
      addPart(.18, .2, .84, 0, 0, -.2)
      addBarrel(.72, .055, -.69)
      addPart(.15, .31, .23, 0, -.2, -.08, grip)
      addPart(.18, .16, .31, 0, -.02, .31, dark)
      addPart(.12, .28, .22, 0, -.23, -.18, metal)
      addPart(.14, .06, .36, 0, -.13, -.56, grip)
      addPart(.19, .045, .56, 0, .125, -.24, metal)
      addSight(-.38, 1.05)
      addPart(.035, .13, .24, .105, .01, -.2, accent)
    } else if (weapon === 'shotgun') {
      addPart(.21, .22, .76, 0, 0, -.18)
      addBarrel(.68, .065, -.69)
      addPart(.17, .14, .31, 0, -.1, .28, grip)
      addPart(.18, .11, .28, 0, -.12, -.38, grip)
      addPart(.11, .12, .64, 0, -.13, -.58, metal)
      addPart(.22, .045, .24, 0, .13, -.2, accent)
      addSight(-.48, .82)
    } else {
      addPart(.19, .2, .82, 0, 0, -.22)
      addBarrel(1.0, .042, -.86)
      addPart(.2, .24, .3, 0, .19, -.32, metal)
      addPart(.18, .14, .4, 0, -.04, .35, grip)
      addPart(.12, .24, .22, 0, -.18, -.12, dark)
      addPart(.24, .06, .3, 0, .15, -.33, accent)
      addPart(.22, .045, .18, 0, .33, -.32, metal)
      addSight(-.47, 1.35)
      addPart(.12, .08, .14, 0, -.13, -.7, accent)
    }
    // Small side rail and serial plate make each weapon read as manufactured gear.
    addPart(.035, .055, .34, .105, .015, -.18, metal)
    addPart(.025, .08, .12, .125, .02, .02, accent)
  }
  private rebuildWeaponModel() { this.buildWeaponModel(this.player.userData.weaponModel as THREE.Group, this.weapon) }
  setPlayerHero(hero: 'VOLT' | 'VEX') {
    const character = hero === 'VOLT' ? 'volt' : 'vex'
    if (this.player.userData.character === character) return
    const parent = this.player.parent
    if (!parent) return
    const replacement = this.createFighter(character)
    replacement.position.copy(this.player.position)
    replacement.rotation.copy(this.player.rotation)
    replacement.scale.copy(this.player.scale)
    parent.add(replacement)
    parent.remove(this.player)
    this.player = replacement
    this.rebuildWeaponModel()
  }
  selectArena(index: number) { if (this.started || this.onlineMode || !Number.isInteger(index)) return; this.applyArena(Math.max(0, Math.min(2, index))); this.publish() }
  start() { this.started = true; this.gameStatus = 'FIGHT'; this.publish() }
  startOnline(onLocalInput: (input: DuelInput) => void, onLocalFire: (weapon: WeaponId, aimYaw: number, aimPitch: number) => void, onLocalReload: () => void, onLocalSwitchWeapon: (weapon: WeaponId) => void) {
    this.onlineMode = true
    this.onLocalInput = onLocalInput
    this.onLocalFire = onLocalFire
    this.onLocalReload = onLocalReload
    this.onLocalSwitchWeapon = onLocalSwitchWeapon
    this.networkTimer = 0
    this.inputSequence = 0
    this.remoteTarget.set(this.enemy.position.x, this.enemy.position.y, this.enemy.position.z)
    this.remoteTargetYaw = this.enemy.rotation.y
    this.started = true
    this.gameStatus = 'FIGHT'
    this.health = 100
    this.enemyHealth = 100
    this.publish()
  }
  stopOnline() {
    this.onlineMode = false
    this.onLocalInput = undefined
    this.onLocalFire = undefined
    this.onLocalReload = undefined
    this.onLocalSwitchWeapon = undefined
    this.started = false
  }
  applyRemoteInput(input: DuelInput) {
    if (!this.onlineMode) return
    this.remoteTarget.x = THREE.MathUtils.clamp(input.moveX, -6.8, 6.8)
    this.remoteTarget.z = THREE.MathUtils.clamp(input.moveZ, -1.8, 6.5)
    this.remoteCrouched = input.crouched
    this.remoteAiming = input.aiming
    this.remoteLookPitch = THREE.MathUtils.clamp(input.lookPitch, -Math.PI / 2, Math.PI / 2)
    this.remoteTarget.y = input.crouched ? -.32 : 0
    this.remoteTargetYaw = Number.isFinite(input.lookYaw) ? input.lookYaw : Math.PI
    const legs = this.enemy.userData.legs as THREE.Mesh[]
    legs.forEach((leg, index) => { leg.rotation.x = Math.sin(input.clientTime / 110 + index * Math.PI) * (Math.abs(input.moveX) + Math.abs(input.moveZ) > .1 ? .35 : .02) })
  }
  applyRemoteWeaponSwitch(weapon: WeaponId) {
    if (!this.onlineMode) return
    this.remoteWeapon = weapon
    this.buildWeaponModel(this.enemy.userData.weaponModel as THREE.Group, weapon)
    this.remoteReloadTimer = 0
  }
  applyRemoteReload(weapon: WeaponId) {
    if (!this.onlineMode) return
    this.triggerCharacterAnimation(this.enemy, 'reload', this.reloadDuration)
    if (weapon !== this.remoteWeapon) this.applyRemoteWeaponSwitch(weapon)
    this.remoteReloadTimer = this.reloadDuration
  }
  applyOnlineResume(health: number, phase: 'waiting' | 'ready' | 'fighting' | 'round_break' | 'finished', roundsWon: number, roundsLost: number, x?: number, z?: number, lastInputSeq?: number, opponentHealth?: number) {
    if (!this.onlineMode) return
    this.health = THREE.MathUtils.clamp(health, 0, 100)
    if (Number.isFinite(opponentHealth)) this.enemyHealth = THREE.MathUtils.clamp(opponentHealth as number, 0, 100)
    if (Number.isFinite(lastInputSeq)) this.inputSequence = Math.max(0, Math.floor(lastInputSeq as number))
    if (Number.isFinite(x)) this.player.position.x = THREE.MathUtils.clamp(x as number, -6.8, 6.8)
    if (Number.isFinite(z)) this.player.position.z = THREE.MathUtils.clamp(z as number, -1.8, 6.5)
    this.roundsWon = Math.max(0, roundsWon)
    this.roundsLost = Math.max(0, roundsLost)
    this.roundNumber = Math.min(5, this.roundsWon + this.roundsLost + 1)
    if (phase === 'round_break') {
      this.started = false
      this.gameStatus = 'ROUND_BREAK'
    } else if (phase === 'finished') {
      this.started = false
      this.gameStatus = this.roundsWon >= 3 ? 'VICTORY' : 'DEFEAT'
    } else if (phase === 'fighting') {
      this.started = true
      this.gameStatus = 'FIGHT'
    } else {
      this.started = false
    }
    this.publish()
  }

  applyOnlineLoadout(weapon: WeaponId, ammo: number, reserveAmmo: number, reloading: boolean) {
    if (!this.onlineMode) return
    this.weapon = weapon
    this.ammo = Math.max(0, ammo)
    this.reserveAmmo = Math.max(0, reserveAmmo)
    this.ammoByWeapon[weapon] = this.ammo
    this.reserveByWeapon[weapon] = this.reserveAmmo
    this.reloading = reloading
    this.reloadTimer = reloading ? this.reloadDuration : 0
    this.rebuildWeaponModel()
    this.publish()
  }
  applyOnlineShotResult(hit: boolean, damage: number, targetHealth: number | null, hitZone: 'head' | 'body' | null) {
    if (!this.onlineMode) return
    if (hit && damage > 0) this.triggerCharacterAnimation(this.enemy, 'hit', .32)
    if (targetHealth !== null) this.enemyHealth = targetHealth
    if (hit && damage > 0) {
      this.hitFeedback = hitZone === 'head' ? 'HEADSHOT' : 'HIT'
      this.hitFeedbackId++
      this.hitFeedbackTimer = .62
      this.enemyHitTimer = .3
    }
    this.publish()
  }
  applyOnlineDamage(health: number, damage: number, hitZone: 'head' | 'body') {
    if (!this.onlineMode) return
    this.triggerCharacterAnimation(this.player, 'hit', .32)
    this.health = THREE.MathUtils.clamp(health, 0, 100)
    this.damageFlashId++
    this.hitFeedback = hitZone === 'head' ? 'HEADSHOT' : 'HIT'
    this.hitFeedbackId++
    this.hitFeedbackTimer = .62
    this.publish()
  }
  applyOnlineRoundResult(roundNumber: number, won: boolean) {
    if (!this.onlineMode) return
    if (won) this.roundsWon++
    else this.roundsLost++
    this.roundNumber = roundNumber
    this.started = false
    this.gameStatus = 'ROUND_BREAK'
    this.publish()
  }
  startOnlineRound(roundNumber: number) {
    if (!this.onlineMode) return
    this.roundNumber = roundNumber
    this.resetRoundState()
    this.applyArena((roundNumber - 1) % ARENAS.length)
    this.intermissionTimer = 0
    this.gameStatus = 'FIGHT'
    this.started = true
    this.publish()
  }
  applyOnlineMatchResult(won: boolean) {
    if (!this.onlineMode) return
    if (won) this.roundsWon++
    else this.roundsLost++
    this.started = false
    this.gameStatus = won ? 'VICTORY' : 'DEFEAT'
    this.publish()
  }
  rejectOnlineShot() {
    if (!this.onlineMode) return
    const magazine = WEAPONS[this.weapon].magazine
    this.ammo = Math.min(magazine, this.ammo + 1)
    this.publish()
  }
  applyRemoteFire() {
    if (!this.onlineMode) return
    this.triggerCharacterAnimation(this.enemy, 'shoot', .38)
    const muzzle = this.enemy.userData.muzzle as THREE.Mesh
    muzzle.visible = true
    this.remoteFireTimer = .2
    const arm = this.enemy.userData.arm as THREE.Group
    arm.rotation.x = -.62
    window.setTimeout(() => { if (!this.disposed) muzzle.visible = false }, 90)
  }
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
    this.triggerCharacterAnimation(this.player, 'shoot', .38)
    this.ammo--
    if (this.onlineMode) {
      this.recoil = this.weapon === 'sniper' ? 1.5 : this.weapon === 'shotgun' ? 1.25 : this.weapon === 'rifle' ? .72 : .9
      this.flash(this.player)
      this.showTracer(false)
      const aimDirection = this.camera.getWorldDirection(new THREE.Vector3()).normalize()
      const aimYaw = Math.atan2(aimDirection.x, aimDirection.z)
      const aimPitch = Math.asin(THREE.MathUtils.clamp(aimDirection.y, -1, 1))
      this.onLocalFire?.(this.weapon, aimYaw, aimPitch)
      this.publish()
      return
    }
    const config = WEAPONS[this.weapon]
    const origin = this.getMuzzleWorldPosition(this.player)
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
    // A quick expanding ink-ring makes confirmed hits readable even on small screens.
    const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.13, .025, 5, 12), ringMaterial)
    ring.position.copy(position)
    ring.quaternion.copy(this.camera.quaternion)
    this.scene.add(ring)
    this.impactParticles.push({ mesh: ring, velocity: new THREE.Vector3(), life: .22, maxLife: .22 })

    for (let i = 0; i < count; i++) {
      const size = .035 + Math.random() * .045
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }))
      mesh.position.copy(position); this.scene.add(mesh)
      this.impactParticles.push({ mesh, velocity: new THREE.Vector3((Math.random() - .5) * 3.8, Math.random() * 3.1, (Math.random() - .5) * 2.6), life: .28 + Math.random() * .18, maxLife: .46 })
    }
  }

  private getMuzzleWorldPosition(fighter: THREE.Group) {
    fighter.updateMatrixWorld(true)
    const muzzle = fighter.userData.muzzle as THREE.Mesh | undefined
    if (muzzle) return muzzle.getWorldPosition(new THREE.Vector3())
    return fighter.localToWorld(new THREE.Vector3(.46, 1.04, .35))
  }

  private showTracer(hit: boolean) {
    if (this.tracer) { this.scene.remove(this.tracer); this.tracer.geometry.dispose(); this.tracer = null }
    const start = this.getMuzzleWorldPosition(this.player); const end = new THREE.Vector3()
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
    if (this.onlineMode) {
      const index = WEAPON_ORDER.indexOf(this.weapon)
      this.onLocalSwitchWeapon?.(WEAPON_ORDER[(index + 1) % WEAPON_ORDER.length])
      return
    }
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
    if (this.onlineMode) {
      this.onLocalReload?.()
      return
    }
    this.triggerCharacterAnimation(this.player, 'reload', this.reloadDuration)
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
    ;[this.player, this.enemy].forEach(fighter => {
      const mixer = fighter.userData.modelMixer as THREE.AnimationMixer | undefined
      mixer?.update(dt)
      if (typeof fighter.userData.modelActionHold === 'number' && fighter.userData.modelActionHold > 0) {
        fighter.userData.modelActionHold = Math.max(0, fighter.userData.modelActionHold - dt)
      }
    })
    if (this.hitFeedbackTimer > 0) {
      this.hitFeedbackTimer = Math.max(0, this.hitFeedbackTimer - dt)
      if (this.hitFeedbackTimer === 0 && this.hitFeedback) { this.hitFeedback = ''; this.publish() }
    }
    if (this.impactParticles.length) {
      for (let i = this.impactParticles.length - 1; i >= 0; i--) {
        const particle = this.impactParticles[i]
        particle.life -= dt
        const isImpactRing = particle.mesh.geometry.type === 'TorusGeometry'
        if (!isImpactRing) particle.velocity.y -= 5.5 * dt
        particle.mesh.position.addScaledVector(particle.velocity, dt)
        if (isImpactRing) particle.mesh.scale.setScalar(1 + (1 - particle.life / particle.maxLife) * 2.6)
        ;(particle.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, particle.life / particle.maxLife)
        if (particle.life <= 0) {
          this.scene.remove(particle.mesh); particle.mesh.geometry.dispose(); (particle.mesh.material as THREE.Material).dispose()
          this.impactParticles.splice(i, 1)
        }
      }
    }
    if (!this.onlineMode && !this.started && this.gameStatus === 'ROUND_BREAK') {
      this.intermissionTimer -= dt
      if (this.intermissionTimer <= 0) this.beginNextRound()
    }
    if (this.started) {
      if (this.reloading) {
        this.reloadTimer -= dt
        const arm = this.player.userData.arm as THREE.Group
        arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, .95, 8, dt)
        if (this.reloadTimer <= 0) {
          if (!this.onlineMode) {
            const config = WEAPONS[this.weapon]
            const loaded = Math.min(config.magazine - this.ammo, this.reserveAmmo)
            this.ammo += loaded; this.reserveAmmo -= loaded
          }
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
      this.setCharacterAnimation(this.player, moving ? 'run' : 'idle')
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
      const playerTorso = this.player.userData.torso as THREE.Mesh
      const playerHead = this.player.userData.head as THREE.Mesh
      const playerPony = this.player.userData.pony as THREE.Group | undefined
      const playerShoulders = this.player.userData.shoulderPads as THREE.Group | undefined
      const heroIsVex = this.player.userData.character === 'vex'
      const gait = moving ? Math.sin(this.walkTime * (heroIsVex ? 1.18 : .92)) : 0
      playerTorso.rotation.z = THREE.MathUtils.damp(playerTorso.rotation.z, moving ? gait * (heroIsVex ? .075 : .045) : Math.sin(this.walkTime * 1.2) * .012, 8, dt)
      playerTorso.scale.y = THREE.MathUtils.damp(playerTorso.scale.y, 1 + Math.sin(this.walkTime * 2) * (moving ? .012 : .018), 8, dt)
      playerHead.rotation.z = THREE.MathUtils.damp(playerHead.rotation.z, moving ? -gait * (heroIsVex ? .035 : .018) : 0, 8, dt)
      if (playerPony) { playerPony.rotation.x = THREE.MathUtils.damp(playerPony.rotation.x, moving ? -.16 + Math.sin(this.walkTime * 1.8) * .22 : Math.sin(this.walkTime * 1.1) * .035, 7, dt); playerPony.rotation.z = THREE.MathUtils.damp(playerPony.rotation.z, moving ? gait * .16 : 0, 7, dt) }
      if (playerShoulders) playerShoulders.rotation.z = THREE.MathUtils.damp(playerShoulders.rotation.z, moving ? -gait * (heroIsVex ? .07 : .035) : 0, 8, dt)
      const targetCrouchY = this.crouched ? -.42 : 0
      this.player.position.y = targetCrouchY + (moving && !this.crouched ? Math.abs(Math.sin(this.walkTime * 2)) * .07 : 0)
      this.player.rotation.z = THREE.MathUtils.damp(this.player.rotation.z, this.peekDirection * -.2, 9, dt)
      this.player.rotation.x = THREE.MathUtils.damp(this.player.rotation.x, this.crouched ? .12 : 0, 9, dt)
      const playerArm = this.player.userData.arm as THREE.Group
      const recoilKick = this.weapon === 'sniper' ? .48 : this.weapon === 'shotgun' ? .38 : this.weapon === 'rifle' ? .24 : .3
      playerArm.rotation.x = THREE.MathUtils.damp(playerArm.rotation.x, this.reloading ? 1.05 : this.aiming ? -.12 : 0, 10, dt) - this.recoil * recoilKick
      this.recoil = Math.max(0, this.recoil - dt * 5)
      if (!this.onlineMode) {
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
      this.setCharacterAnimation(this.enemy, enemyMoving ? 'run' : 'idle')
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
      const enemyPony = this.enemy.userData.pony as THREE.Group | undefined
      const enemyShoulders = this.enemy.userData.shoulderPads as THREE.Group | undefined
      const enemyIsVex = this.enemy.userData.character === 'vex'
      if (enemyPony) { enemyPony.rotation.x = THREE.MathUtils.damp(enemyPony.rotation.x, enemyMoving ? -.14 + Math.sin(this.enemyWalkTime * 2.1) * .2 : Math.sin(this.enemyWalkTime) * .025, 7, dt); enemyPony.rotation.z = THREE.MathUtils.damp(enemyPony.rotation.z, enemyMoving ? Math.sin(this.enemyWalkTime * 1.2) * .14 : 0, 7, dt) }
      if (enemyShoulders) enemyShoulders.rotation.z = THREE.MathUtils.damp(enemyShoulders.rotation.z, enemyMoving ? Math.sin(this.enemyWalkTime * (enemyIsVex ? 8.3 : 6.8)) * (enemyIsVex ? .065 : .035) : 0, 8, dt)
      // Keep the weapon raised toward the player; lower it slightly while tucked behind cover.
      const enemyArm = this.enemy.userData.arm as THREE.Group
      // Telegraph incoming shots by raising the weapon before the actual hit check.
      this.enemyTimer += dt
      if (this.enemyShotWindup > 0) {
        this.enemyShotWindup = Math.max(0, this.enemyShotWindup - dt)
        enemyArm.rotation.x = THREE.MathUtils.damp(enemyArm.rotation.x, -.62, 12, dt)
        if (this.enemyShotWindup === 0) {
          const protectedByCover = this.isPlayerProtected()
          const enemyOrigin = this.getMuzzleWorldPosition(this.enemy)
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
      } else {
        this.enemyWalkTime += dt
        this.enemy.position.x = THREE.MathUtils.damp(this.enemy.position.x, this.remoteTarget.x, 13, dt)
        this.enemy.position.y = THREE.MathUtils.damp(this.enemy.position.y, this.remoteTarget.y, 13, dt)
        this.enemy.position.z = THREE.MathUtils.damp(this.enemy.position.z, this.remoteTarget.z, 13, dt)
        const yawDelta = Math.atan2(Math.sin(this.remoteTargetYaw - this.enemy.rotation.y), Math.cos(this.remoteTargetYaw - this.enemy.rotation.y))
        this.enemy.rotation.y += THREE.MathUtils.damp(0, yawDelta, 13, dt)
        this.networkTimer += dt
        if (this.networkTimer >= 0.05) {
          this.networkTimer = 0
          const aimDirection = this.camera.getWorldDirection(new THREE.Vector3()).normalize()
          this.onLocalInput?.({
            seq: ++this.inputSequence,
            clientTime: Date.now(),
            moveX: this.player.position.x,
            moveZ: this.player.position.z,
            lookYaw: Math.atan2(aimDirection.x, aimDirection.z),
            lookPitch: Math.asin(THREE.MathUtils.clamp(aimDirection.y, -1, 1)),
            crouched: this.crouched,
            aiming: this.aiming
          })
        }
        const remoteLegs = this.enemy.userData.legs as THREE.Mesh[]
        const remoteMoving = Math.hypot(this.remoteTarget.x - this.enemy.position.x, this.remoteTarget.z - this.enemy.position.z) > .12
        this.setCharacterAnimation(this.enemy, remoteMoving ? 'run' : 'idle')
        remoteLegs.forEach((leg, index) => {
          const stride = remoteMoving ? Math.sin(this.enemyWalkTime * 7 + index * Math.PI) * .38 : 0
          leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, this.remoteCrouched ? -.62 + stride * .2 : stride, 9, dt)
        })
        this.remoteReloadTimer = Math.max(0, this.remoteReloadTimer - dt)
        this.remoteFireTimer = Math.max(0, this.remoteFireTimer - dt)
        const remoteArm = this.enemy.userData.arm as THREE.Group
        const remoteTargetArm = this.remoteReloadTimer > 0 ? 1.05 : this.remoteFireTimer > 0 ? -.62 : this.remoteAiming ? -.32 - this.remoteLookPitch * .42 : this.remoteCrouched ? -.08 : -.28
        remoteArm.rotation.x = THREE.MathUtils.damp(remoteArm.rotation.x, remoteTargetArm, this.remoteReloadTimer > 0 ? 7 : 12, dt)
        const remoteTorso = this.enemy.userData.torso as THREE.Mesh
        remoteTorso.rotation.x = THREE.MathUtils.damp(remoteTorso.rotation.x, this.remoteAiming ? -this.remoteLookPitch * .12 : 0, 8, dt)
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