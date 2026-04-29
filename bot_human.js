// bot.js — CraftVN HT1 PvP bots (10 acc, chia team, không cần mineflayer-auto-eat ESM)
// Yêu cầu: node 18+, mineflayer 4.31+, pathfinder, pvp, vec3

const mineflayer = require('mineflayer')
const {
  pathfinder,
  Movements,
  goals: { GoalNear }
} = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const { Vec3 } = require('vec3')

const SERVER_HOST = process.env.SERVER_HOST || 'node1.lumine.asia'
const SERVER_PORT = Number(process.env.SERVER_PORT || 25675)
const AUTH_MODE = process.env.AUTH_MODE || 'offline'

const BOT_NAMES = [
  'NhatLMAO',
  'Swight',
  'MeoSimmy',
  'MayChemHaTinh',
  'Phumye2k8',
  'Jaoebeb8',
  'honaghhmc',
  'Hubgf',
  'KhanggVNMC',
  'Huyenkhoaifo'
]

const TEAMS = {
  xPVP2: 'A',
  CauBeNgoc: 'A',
  MayChemHaTinh: 'B',
  Memaybel: 'B',
  Bomaychaphet: 'C',
  noomn: 'C',
  tretrauminecraft: 'D',
  Phu2k8: 'D',
  Linhdepgai: 'E',
  CraftVNHT1: 'E'
}

const CHASE_LINES = [
  ""
]

// ─── TẦNG ĐÁNH LEGIT ───────────────────────────────────────────────────────
const BASE_MELEE_RANGE   = 2.8
const MELEE_RANGE_JITTER = 0.15

// ─── AIM SYSTEM ────────────────────────────────────────────────────────────
// Thay vì lookAt() snap thẳng, ta lerp yaw/pitch từng tick
// Tốc độ quay phụ thuộc khoảng cách góc: gần đích thì chậm lại (precision)
// + thêm micro-shake nhỏ như tay người run

function angleDiff (a, b) {
  // Hiệu góc rút gọn về [-π, π]
  let d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI
  return d
}

function setupAimSystem (bot) {
  bot._aim = {
    // Góc hiện tại của "aim bot nội bộ" — khởi tạo từ góc bot thực
    yaw:   bot.entity ? bot.entity.yaw   : 0,
    pitch: bot.entity ? bot.entity.pitch : 0,

    // Lịch sử vị trí target để predict
    lastTargetPos: null,
    lastTargetTime: 0,
    targetVelocity: new Vec3(0, 0, 0),

    // Overshoot state
    overshooting: false,
    overshootYaw: 0,
    overshootPitch: 0
  }

  // Aim loop chạy nhanh hơn combat loop: 50ms (20Hz) cho mượt
  setInterval(() => {
    try {
      if (!bot.entity || !bot._aimTarget) return

      const target = bot._aimTarget
      if (!target.position) return

      const now = Date.now()
      const aim = bot._aim

      // ── Predict vị trí target ─────────────────────────────────────────
      let predictedPos = target.position.clone()
      if (aim.lastTargetPos) {
        const dt = (now - aim.lastTargetTime) / 1000  // giây
        // Tính velocity từ delta pos
        aim.targetVelocity = target.position.minus(aim.lastTargetPos).scaled(1 / Math.max(dt, 0.05))
        // Look-ahead: dự đoán vị trí sau ~80ms
        predictedPos = target.position.offset(
          aim.targetVelocity.x * 0.08,
          0,  // không predict Y (nhảy khó đoán)
          aim.targetVelocity.z * 0.08
        )
      }
      aim.lastTargetPos  = target.position.clone()
      aim.lastTargetTime = now

      // ── Tính góc đến target ──────────────────────────────────────────
      const eyePos = bot.entity.position.offset(0, 1.62, 0)
      const aimPoint = predictedPos.offset(0, 1.5, 0)  // ngắm ngực/đầu
      const dx = aimPoint.x - eyePos.x
      const dy = aimPoint.y - eyePos.y
      const dz = aimPoint.z - eyePos.z
      const hDist = Math.sqrt(dx * dx + dz * dz)

      const targetYaw   = Math.atan2(-dx, dz)
      const targetPitch = -Math.atan2(dy, hDist)

      // ── Lerp speed: dựa theo khoảng cách góc ─────────────────────────
      const yawDiff   = Math.abs(angleDiff(aim.yaw, targetYaw))
      const pitchDiff = Math.abs(angleDiff(aim.pitch, targetPitch))
      const maxDiff   = Math.max(yawDiff, pitchDiff)

      // Khi góc lớn (mới lock target) quay nhanh ~0.35–0.45
      // Khi gần đích (tracking) quay chậm lại ~0.15–0.25 (precision aim)
      let speed
      if (maxDiff > 0.5)       speed = randBetween(0.32, 0.44)
      else if (maxDiff > 0.15) speed = randBetween(0.18, 0.28)
      else                     speed = randBetween(0.10, 0.18)

      // ── Micro-shake: tay người không ngắm hoàn toàn thẳng ────────────
      // Shake nhỏ hơn khi đang precision aim
      const shakeMag = maxDiff > 0.2 ? 0.012 : 0.005
      const shakeY = (Math.random() - 0.5) * shakeMag
      const shakeP = (Math.random() - 0.5) * shakeMag * 0.6

      // ── Overshoot: ~8% cơ hội vượt qua rồi kéo lại ──────────────────
      if (!aim.overshooting && maxDiff < 0.05 && Math.random() < 0.08) {
        aim.overshooting  = true
        aim.overshootYaw   = angleDiff(0, targetYaw)   * randBetween(0.06, 0.14)
        aim.overshootPitch = angleDiff(0, targetPitch) * randBetween(0.04, 0.10)
        setTimeout(() => { if (aim) aim.overshooting = false }, randBetween(60, 150))
      }

      const osY = aim.overshooting ? aim.overshootYaw   : 0
      const osP = aim.overshooting ? aim.overshootPitch : 0

      // ── Lerp về target ────────────────────────────────────────────────
      aim.yaw   += angleDiff(aim.yaw,   targetYaw)   * speed + shakeY + osY
      aim.pitch += angleDiff(aim.pitch, targetPitch) * speed + shakeP + osP

      // Clamp pitch [-π/2, π/2]
      aim.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, aim.pitch))

      // Áp góc vào bot
      bot.look(aim.yaw, aim.pitch, false).catch(() => {})
    } catch (_) {}
  }, 50)
}
// ────────────────────────────────────────────────────────────────────────────

function wait (ms) {
  return new Promise(res => setTimeout(res, ms))
}

function randChoice (arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randBetween (min, max) {
  return min + Math.random() * (max - min)
}

function isTeammate (bot, username) {
  const tSelf  = TEAMS[bot.username]
  const tOther = TEAMS[username]
  return tSelf && tOther && tSelf === tOther
}

function findItem (bot, names) {
  const list = Array.isArray(names) ? names : [names]
  return bot.inventory.items().find(it => list.includes(it.name))
}

function findFoodItem (bot) {
  const foodNames = [
    'cooked_beef','cooked_porkchop','cooked_chicken','bread',
    'cooked_mutton','cooked_rabbit','baked_potato','cooked_cod',
    'cooked_salmon','pumpkin_pie'
  ]
  return bot.inventory.items().find(it => foodNames.includes(it.name))
}

function findSword (bot) {
  const swordNames = [
    'netherite_sword','diamond_sword','iron_sword',
    'stone_sword','golden_sword','wooden_sword'
  ]
  return bot.inventory.items().find(it => swordNames.includes(it.name))
}

async function equipSword (bot) {
  try {
    const sword = findSword(bot)
    if (sword) await bot.equip(sword, 'hand')
  } catch (_) {}
}

function getNearestEnemyPlayer (bot, maxDistance) {
  let best = null, bestDist = maxDistance
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || e.type !== 'player') continue
    if (!e.username || e.username === bot.username) continue
    if (BOT_NAMES.includes(e.username) && isTeammate(bot, e.username)) continue
    if (!e.position) continue
    const dist = bot.entity.position.distanceTo(e.position)
    if (dist < bestDist) { best = e; bestDist = dist }
  }
  return best
}

function isEntityInWeb (bot, entity) {
  if (!entity || !entity.position) return false
  const block = bot.blockAt(entity.position.offset(0, 0.1, 0))
  return block && block.name && block.name.includes('web')
}

function isBotInWeb (bot) {
  return isEntityInWeb(bot, bot.entity)
}

async function ensureOffhand (bot) {
  try {
    const now = Date.now(), hp = bot.health
    if (hp <= 0) return
    const totem  = findItem(bot, ['totem_of_undying','totem'])
    const gapple = findItem(bot, ['enchanted_golden_apple','golden_apple'])
    if (totem && (hp <= 6 || (bot._dangerUntil && now < bot._dangerUntil))) {
      await bot.equip(totem, 'off-hand'); return
    }
    if (gapple) await bot.equip(gapple, 'off-hand')
  } catch (_) {}
}

async function emergencyHeal (bot) {
  try {
    const hp = bot.health
    if (hp <= 0 || hp > 8) return
    const gapple = findItem(bot, ['enchanted_golden_apple','golden_apple'])
    if (gapple) {
      await bot.equip(gapple, 'hand')
      bot.activateItem()
      setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 900)
    }
  } catch (_) {}
}

async function autoEatLoop (bot) {
  if (bot._autoEating) return
  bot._autoEating = true
  const tick = async () => {
    try {
      if (!bot.player || !bot.entity || bot.health <= 0) return
      if (bot.food < 16) {
        const food = findFoodItem(bot)
        if (food) {
          await bot.equip(food, 'hand')
          bot.activateItem()
          setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 900)
        }
      }
    } catch (_) {}
    finally { setTimeout(tick, 1200) }
  }
  setTimeout(tick, 1200)
}

async function throwPearlAt (bot, target) {
  try {
    const pearl = findItem(bot, 'ender_pearl')
    if (!pearl) return
    await bot.equip(pearl, 'hand')
    await bot.lookAt(target.position.offset(0, 1.5, 0), true)
    bot.activateItem()
  } catch (_) {}
}

async function escapeWebWithWater (bot) {
  try {
    if (bot._escapingWeb) return
    const waterBucket = findItem(bot, 'water_bucket')
    if (!waterBucket) return
    bot._escapingWeb = true
    const feet  = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    if (below) {
      await bot.equip(waterBucket, 'hand')
      await bot.lookAt(below.position.offset(0.5, 1, 0.5), true)
      await bot.placeBlock(below, new Vec3(0, 1, 0))
    }
    setTimeout(async () => {
      try {
        const bucket = findItem(bot, 'bucket')
        if (!bucket) return
        const water = bot.findBlock({ matching: b => b && b.name === 'water', maxDistance: 5 })
        if (water) {
          await bot.equip(bucket, 'hand')
          await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true)
          await bot.activateBlock(water)
        }
      } catch (_) {}
      finally { bot._escapingWeb = false }
    }, 1200)
  } catch (_) { bot._escapingWeb = false }
}

async function placeWebTrap (bot, target) {
  try {
    const web = findItem(bot, ['cobweb','web'])
    if (!web) return
    if (bot.entity.position.distanceTo(target.position) > 4) return
    const below = bot.blockAt(target.position.offset(0, -1, 0).floored())
    if (!below) return
    await bot.equip(web, 'hand')
    await bot.lookAt(target.position.offset(0.5, 0.2, 0.5), true)
    await bot.placeBlock(below, new Vec3(0, 1, 0))
    equipSword(bot)
  } catch (_) {}
}

async function useBuffPotion (bot) {
  try {
    const now = Date.now()
    if (bot._lastPotion && now - bot._lastPotion < 8000) return
    const pot = findItem(bot, ['potion','splash_potion','lingering_potion'])
    if (!pot) return
    bot._lastPotion = now
    await bot.equip(pot, 'hand')
    bot.activateItem()
    setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 850)
  } catch (_) {}
}

async function shootBowAt (bot, target) {
  try {
    const bow   = findItem(bot, 'bow')
    const arrow = findItem(bot, ['arrow','tipped_arrow'])
    if (!bow || !arrow) return
    await bot.equip(bow, 'hand')
    await bot.lookAt(target.position.offset(0, 1.4, 0), true)
    bot.activateItem()
    setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 450)
    equipSword(bot)
  } catch (_) {}
}

// ─── Idle look-around khi không có mục tiêu (trông như người đứng ngó) ─────
function idleLook (bot) {
  if (bot._idleLooking) return
  bot._idleLooking = true
  const doLook = () => {
    if (!bot.entity || bot._combatActive) { bot._idleLooking = false; return }
    const yaw   = bot.entity.yaw + randBetween(-0.4, 0.4)
    const pitch = randBetween(-0.3, 0.3)
    bot.look(yaw, pitch, false).catch(() => {})
    setTimeout(doLook, randBetween(1500, 3500))
  }
  setTimeout(doLook, randBetween(800, 2000))
}

function setupHT1Brain (bot) {
  bot._combatState = {
    lastPearl: 0,
    lastWeb:   0,
    lastBow:   0,
    lastDist:  null,
    lastChat:  0,
    nextWTap:  0
  }
  bot._lastHit       = 0
  bot._nextHitDelay  = 450          // khởi đầu 450ms (mức an toàn)
  bot._followingTarget = null
  bot._combatActive  = false

  bot.on('health', () => {
    const hp = bot.health
    if (hp <= 8 && hp > 0) bot._dangerUntil = Date.now() + 7000
    ensureOffhand(bot)
    emergencyHeal(bot)
  })

  bot.on('death', () => {
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
    if (bot.pvp && bot.pvp.target) bot.pvp.stop()
    bot._followingTarget = null
    bot._combatActive = false
    if (bot.pathfinder) bot.pathfinder.setGoal(null)
  })

  bot.on('respawn', () => {
    console.log(`[${bot.username}] respawned, ready to fight again`)
    bot._homePos = bot.entity.position.clone()
    bot._combatState.lastDist = null
    bot._dangerUntil = Date.now() + 5000
    bot._followingTarget = null
    bot._combatActive = false
  })

  autoEatLoop(bot)

  // ─── COMBAT LOOP — 250ms tick ───────────────────────────────────────────
  setInterval(() => {
    if (!bot.entity || !bot.entity.position) return
    const now = Date.now()

    // Về home nếu đi quá xa
    if (bot._homePos) {
      if (bot.entity.position.distanceTo(bot._homePos) > 100) {
        if (bot.pvp && bot.pvp.target) bot.pvp.stop()
        bot.setControlState('jump', false)
        bot.setControlState('sprint', false)
        bot._followingTarget = null
        bot._combatActive    = false
        bot.pathfinder.setGoal(new GoalNear(bot._homePos.x, bot._homePos.y, bot._homePos.z, 2))
        return
      }
    }

    let target = getNearestEnemyPlayer(bot, 80)

    if (target && bot._homePos) {
      if (target.position.distanceTo(bot._homePos) > 100) target = null
    }

    if (target) {
      bot._combatActive = true
      const p    = target.position
      const dist = bot.entity.position.distanceTo(p)

      // Follow — dừng lại ở cách ~2.0 block (không áp sát như bot)
      bot.pathfinder.setGoal(new GoalNear(p.x, p.y, p.z, 2.0))

      // Nhìn mục tiêu — có micro jitter nhỏ giống chuột người thật
      const jitterY = randBetween(-0.05, 0.05)
      bot.lookAt(target.position.offset(jitterY, 1.6, jitterY), true).catch(() => {})

      // W-tap / sprint reset: chỉ khi cận chiến
      if (dist < 5) {
        equipSword(bot)
        bot.setControlState('jump', true)

        if (now > bot._combatState.nextWTap) {
          // interval ngẫu nhiên 500–800ms thay vì cố định 600ms
          bot._combatState.nextWTap = now + randBetween(500, 800)
          bot.setControlState('sprint', false)
          // bật lại sprint sau 80–160ms (tự nhiên hơn)
          setTimeout(() => {
            try { bot.setControlState('sprint', true) } catch (_) {}
          }, Math.round(randBetween(80, 160)))
        }
      } else {
        bot.setControlState('jump', false)
      }

      useBuffPotion(bot)

      // Phát hiện chạy trốn
      if (bot._combatState.lastDist !== null) {
        const diff = dist - bot._combatState.lastDist
        if (diff > 2 && dist > 10) {
          if (now - bot._combatState.lastChat > 5000) {
            bot._combatState.lastChat = now
            bot.chat(randChoice(CHASE_LINES))
          }
          if (now - bot._combatState.lastPearl > 3500) {
            bot._combatState.lastPearl = now
            throwPearlAt(bot, target)
            setTimeout(() => placeWebTrap(bot, target), 300)
          }
        }
      }
      bot._combatState.lastDist = dist

      // Pearl khi xa
      if (dist > 12 && dist < 60 && now - bot._combatState.lastPearl > 5000) {
        bot._combatState.lastPearl = now
        throwPearlAt(bot, target)
      }

      // Web trap khi đủ gần
      if (dist < 4 && now - bot._combatState.lastWeb > 3500) {
        bot._combatState.lastWeb = now
        placeWebTrap(bot, target)
      }

      // Bắn tên khi địch dính tơ
      if (isEntityInWeb(bot, target) && now - bot._combatState.lastBow > 1200) {
        bot._combatState.lastBow = now
        shootBowAt(bot, target)
      }

      // ─── ĐÁNH CẬN CHIẾN LEGIT ────────────────────────────────────────────
      // Tầm đánh = BASE_MELEE_RANGE ± MELEE_RANGE_JITTER (2.65–2.95)
      const effectiveRange = BASE_MELEE_RANGE + randBetween(-MELEE_RANGE_JITTER, MELEE_RANGE_JITTER)
      const dy = Math.abs(target.position.y - bot.entity.position.y)

      if (dist <= effectiveRange && dy <= 2.2) {
        if (now - bot._lastHit > bot._nextHitDelay) {
          bot._lastHit = now
          // Delay hit kế tiếp: 400–700ms (1.4–2.5 CPS) — phân phối lệch về 500ms
          // Dùng phân phối gaussian thô: trung bình ~530ms, lệch chuẩn ~80ms
          const base  = randBetween(400, 700)
          const extra = (Math.random() + Math.random()) / 2  // trung gian về giữa
          bot._nextHitDelay = Math.round(base * 0.5 + extra * (base * 0.5))
          // Thêm 5% cơ hội "miss" (người thật đôi khi miss)
          if (Math.random() > 0.05) {
            equipSword(bot)
            try { bot.attack(target) } catch (_) {}
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────
    } else {
      // Không có mục tiêu
      if (bot.pvp && bot.pvp.target) bot.pvp.stop()
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot._combatState.lastDist = null
      bot._followingTarget      = null
      if (bot._combatActive) {
        bot._combatActive = false
        idleLook(bot)   // đứng ngó xung quanh khi vừa thoát combat
      }
    }

    if (isBotInWeb(bot)) escapeWebWithWater(bot)
  }, 250)
}

function createBot (name) {
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: name,
    auth: AUTH_MODE
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)

  bot.once('spawn', () => {
    console.log(`[${name}] joined with HT1 brain!`)
    const mcData    = require('minecraft-data')(bot.version)
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)
    bot._homePos = bot.entity.position.clone()
    setupHT1Brain(bot)
  })

  bot.on('kicked', r  => console.log(`[${name}] kicked:`, r))
  bot.on('error',  e  => console.log(`[${name}] error:`,  e))
  bot.on('end', reason => {
    console.log(`[${name}] disconnected (${reason}), reconnecting in 10s`)
    setTimeout(() => createBot(name), 10000)
  })

  return bot
}

;(async () => {
  for (const name of BOT_NAMES) {
    createBot(name)
    await wait(20000)
  }
})()
