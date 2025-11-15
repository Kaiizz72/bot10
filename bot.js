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

// 10 bot như yêu cầu
const BOT_NAMES = [
  'xPVP2',
  'CauBeNgoc',
  'MayChemHaTinh',
  'Memaybel',
  'Bomaychaphet',
  'noomn',
  'tretrauminecraft',
  'Phu2k8',
  'Linhdepgai',
  'CraftVNHT1'
  'HuyVPV',
  'Giabao71',
  'Kaiiz',
  'JasonX',
  'NhatLMAO',
  'Vietbuuofficial',
  'TacoOF'
]

// Chia team 2 đứa / team
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

// Câu chat PvP tiếng Anh (gamer talk, không xúc phạm chủng tộc)
const CHASE_LINES = [
  "You can't run from me!",
  "Come here, I'm not done yet!",
  "Keep running, I'll catch you!",
  "You think you can escape?",
  "I'm on you!",
  "Nice try, runner!"
]

// Giới hạn tầm đánh cận chiến cho đỡ giống reach hack
const MAX_MELEE_RANGE = 3.05

function wait (ms) {
  return new Promise(res => setTimeout(res, ms))
}

function randChoice (arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function isTeammate (bot, username) {
  const tSelf = TEAMS[bot.username]
  const tOther = TEAMS[username]
  return tSelf && tOther && tSelf === tOther
}

function findItem (bot, names) {
  const list = Array.isArray(names) ? names : [names]
  return bot.inventory.items().find(it => list.includes(it.name))
}

function findFoodItem (bot) {
  // Ưu tiên đồ ăn thường, không ăn táo vàng trong auto-eat
  const foodNames = [
    'cooked_beef',
    'cooked_porkchop',
    'cooked_chicken',
    'bread',
    'cooked_mutton',
    'cooked_rabbit',
    'baked_potato',
    'cooked_cod',
    'cooked_salmon',
    'pumpkin_pie'
  ]
  return bot.inventory.items().find(it => foodNames.includes(it.name))
}

function findSword (bot) {
  const swordNames = [
    'netherite_sword',
    'diamond_sword',
    'iron_sword',
    'stone_sword',
    'golden_sword',
    'wooden_sword'
  ]
  return bot.inventory.items().find(it => swordNames.includes(it.name))
}

async function equipSword (bot) {
  try {
    const sword = findSword(bot)
    if (sword) {
      await bot.equip(sword, 'hand')
    }
  } catch (_) {}
}

function getNearestEnemyPlayer (bot, maxDistance) {
  let best = null
  let bestDist = maxDistance
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || e.type !== 'player') continue
    if (!e.username || e.username === bot.username) continue

    // Nếu là bot khác và cùng team -> bỏ qua, không đánh đồng đội
    if (BOT_NAMES.includes(e.username) && isTeammate(bot, e.username)) continue
    if (!e.position) continue

    const dist = bot.entity.position.distanceTo(e.position)
    if (dist < bestDist) {
      best = e
      bestDist = dist
    }
  }
  return best
}

function isEntityInWeb (bot, entity) {
  if (!entity || !entity.position) return false
  const feet = entity.position.offset(0, 0.1, 0)
  const block = bot.blockAt(feet)
  if (!block) return false
  return block.name && block.name.includes('web') // cobweb / web
}

function isBotInWeb (bot) {
  return isEntityInWeb(bot, bot.entity)
}

async function ensureOffhand (bot) {
  try {
    const now = Date.now()
    const hp = bot.health // 0–20 (mỗi 2 = 1 tim)
    if (hp <= 0) return

    const totem = findItem(bot, ['totem_of_undying', 'totem'])
    const gapple = findItem(bot, ['enchanted_golden_apple', 'golden_apple'])

    // Nếu còn totem, và đang/nguy hiểm (máu thấp hoặc vừa bị trade mạnh) => luôn ưu tiên totem
    if (totem && (hp <= 6 || (bot._dangerUntil && now < bot._dangerUntil))) {
      await bot.equip(totem, 'off-hand')
      return
    }

    // Bình thường (không nguy hiểm / hết totem) giữ táo vàng ở tay trái
    if (gapple) {
      await bot.equip(gapple, 'off-hand')
    }
  } catch (_) {}
}

async function emergencyHeal (bot) {
  try {
    const hp = bot.health
    if (hp <= 0) return

    // Không để xuống dưới 3 tim: nếu <= 8 máu (4 tim) thì ăn táo
    if (hp <= 8) {
      const gapple = findItem(bot, ['enchanted_golden_apple', 'golden_apple'])
      if (gapple) {
        await bot.equip(gapple, 'hand')
        bot.activateItem()
        setTimeout(() => {
          try { bot.deactivateItem() } catch (_) {}
        }, 900)
      }
    }
  } catch (_) {}
}

async function autoEatLoop (bot) {
  if (bot._autoEating) return
  bot._autoEating = true

  const eatInterval = 1200 // ~1.2s

  const eatTick = async () => {
    try {
      if (!bot.player || !bot.entity) return
      if (bot.health <= 0) return

      // bot.food: 0–20 (20 = full thanh đói)
      if (bot.food < 16) { // đói xuống dưới 8 "đùi"
        const food = findFoodItem(bot)
        if (food) {
          await bot.equip(food, 'hand')
          bot.activateItem()
          setTimeout(() => {
            try { bot.deactivateItem() } catch (_) {}
          }, 900)
        }
      }
    } catch (_) {
      // ignore
    } finally {
      setTimeout(eatTick, eatInterval)
    }
  }

  setTimeout(eatTick, eatInterval)
}

async function throwPearlAt (bot, target) {
  try {
    const pearl = findItem(bot, 'ender_pearl')
    if (!pearl) return

    await bot.equip(pearl, 'hand')
    await bot.lookAt(target.position.offset(0, 1.5, 0), true)
    bot.activateItem() // ném pearl
  } catch (_) {}
}

async function escapeWebWithWater (bot) {
  try {
    if (bot._escapingWeb) return
    const waterBucket = findItem(bot, 'water_bucket')
    if (!waterBucket) return

    bot._escapingWeb = true

    // Đặt nước dưới chân để phá tơ
    const feet = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    if (below) {
      await bot.equip(waterBucket, 'hand')
      await bot.lookAt(below.position.offset(0.5, 1, 0.5), true)
      await bot.placeBlock(below, new Vec3(0, 1, 0))
    }

    // Chờ nước phá tơ rồi hốt lại nước
    setTimeout(async () => {
      try {
        const bucket = findItem(bot, 'bucket')
        if (!bucket) return
        const water = bot.findBlock({
          matching: b => b && b.name === 'water',
          maxDistance: 5
        })
        if (water) {
          await bot.equip(bucket, 'hand')
          await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true)
          await bot.activateBlock(water)
        }
      } catch (_) {
        // ignore
      } finally {
        bot._escapingWeb = false
      }
    }, 1200)
  } catch (_) {
    bot._escapingWeb = false
  }
}

async function placeWebTrap (bot, target) {
  try {
    const web = findItem(bot, ['cobweb', 'web'])
    if (!web) return

    const dist = bot.entity.position.distanceTo(target.position)
    if (dist > 4) return // phải đủ gần

    const below = bot.blockAt(target.position.offset(0, -1, 0).floored())
    if (!below) return

    await bot.equip(web, 'hand')
    await bot.lookAt(target.position.offset(0.5, 0.2, 0.5), true)
    await bot.placeBlock(below, new Vec3(0, 1, 0))

    // Sau khi đặt bẫy quay lại cầm kiếm
    equipSword(bot)
  } catch (_) {}
}

async function useBuffPotion (bot) {
  try {
    const now = Date.now()
    if (bot._lastPotion && now - bot._lastPotion < 8000) return

    const pot = findItem(bot, ['potion', 'splash_potion', 'lingering_potion'])
    if (!pot) return

    bot._lastPotion = now
    await bot.equip(pot, 'hand')
    bot.activateItem()
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 850)
  } catch (_) {}
}

async function shootBowAt (bot, target) {
  try {
    const bow = findItem(bot, 'bow')
    const arrow = findItem(bot, ['arrow', 'tipped_arrow'])
    if (!bow || !arrow) return

    await bot.equip(bow, 'hand')
    await bot.lookAt(target.position.offset(0, 1.4, 0), true)
    bot.activateItem() // kéo cung
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 450)

    // Bắn xong thì lại cầm kiếm
    equipSword(bot)
  } catch (_) {}
}

function setupHT1Brain (bot) {
  bot._combatState = {
    lastPearl: 0,
    lastWeb: 0,
    lastBow: 0,
    lastDist: null,
    lastChat: 0,
    nextWTap: 0
  }
  bot._lastHit = 0
  bot._nextHitDelay = 350
  bot._followingTarget = null

  // Quản lý máu, táo vàng, totem
  bot.on('health', () => {
    const hp = bot.health
    if (hp <= 8 && hp > 0) {
      // vừa bị trade mạnh / đang nguy hiểm -> giữ trạng thái danger thêm 7s
      bot._dangerUntil = Date.now() + 7000
    }
    ensureOffhand(bot)
    emergencyHeal(bot)
  })

  // Chết -> dừng PvP, chờ respawn
  bot.on('death', () => {
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
    if (bot.pvp && bot.pvp.target) bot.pvp.stop()
    bot._followingTarget = null
    if (bot.pathfinder) bot.pathfinder.setGoal(null)
  })

  // Respawn -> đặt lại homePos (nếu cần) và tiếp tục đánh
  bot.on('respawn', () => {
    console.log(`[${bot.username}] respawned, ready to fight again`)
    // spawn mới (vd: FFA spawn) làm home mới
    bot._homePos = bot.entity.position.clone()
    // reset một chút state
    bot._combatState.lastDist = null
    bot._dangerUntil = Date.now() + 5000
    bot._followingTarget = null
  })

  // Bắt đầu auto ăn
  autoEatLoop(bot)

  // Vòng lặp combat chính
  setInterval(() => {
    if (!bot.entity || !bot.entity.position) return

    const now = Date.now()

    // Giữ bot không đi quá xa khỏi vị trí home (~100 block)
    if (bot._homePos) {
      const homeDist = bot.entity.position.distanceTo(bot._homePos)
      if (homeDist > 100) {
        if (bot.pvp && bot.pvp.target) bot.pvp.stop()
        bot.setControlState('jump', false)
        bot.setControlState('sprint', false)
        bot._followingTarget = null
        const goal = new GoalNear(
          bot._homePos.x,
          bot._homePos.y,
          bot._homePos.z,
          2
        )
        bot.pathfinder.setGoal(goal)
        // ngừng xử lý combat tick này, chờ chạy về home
        return
      }
    }

    let target = getNearestEnemyPlayer(bot, 80) // tầm nhìn rộng

    // Không đuổi mục tiêu quá xa khỏi khu vực home
    if (target && bot._homePos) {
      const distFromHomeToTarget = target.position.distanceTo(bot._homePos)
      if (distFromHomeToTarget > 100) {
        target = null
      }
    }

    if (target) {
      // Follow mục tiêu bằng pathfinder (không dùng mineflayer-pvp để đỡ bị đánh xa)
      const p = target.position
      bot.pathfinder.setGoal(new GoalNear(p.x, p.y, p.z, 1.5))

      // luôn nhìn về phía đối thủ để combat trông pro hơn
      bot.lookAt(target.position.offset(0, 1.6, 0), true).catch(() => {})

      const dist = bot.entity.position.distanceTo(target.position)

      // W-tap / jump reset style: ở gần thì cầm kiếm + nhảy combo + tap sprint
      if (dist < 6) {
        equipSword(bot)
        bot.setControlState('jump', true)

        if (now > bot._combatState.nextWTap) {
          bot._combatState.nextWTap = now + 600 // mỗi 0.6s tap một lần
          bot.setControlState('sprint', false)
          setTimeout(() => {
            try {
              bot.setControlState('sprint', true)
            } catch (_) {}
          }, 120) // tắt sprint một chút rồi bật lại
        }
      } else {
        bot.setControlState('jump', false)
      }

      // Buff speed + strength trước combat
      useBuffPotion(bot)

      // Phát hiện người chơi "chạy trốn": khoảng cách tăng nhanh so với tick trước
      if (bot._combatState.lastDist !== null) {
        const diff = dist - bot._combatState.lastDist
        const isRunningAway = diff > 2 && dist > 10 // vừa xa, vừa tăng nhanh

        if (isRunningAway) {
          // Chat tiếng Anh kiểu PvP khi đối thủ chạy
          if (now - bot._combatState.lastChat > 5000) {
            bot._combatState.lastChat = now
            bot.chat(randChoice(CHASE_LINES))
          }

          // Ném pearl dí sát rồi đặt tơ nhanh
          if (now - bot._combatState.lastPearl > 3500) {
            bot._combatState.lastPearl = now
            throwPearlAt(bot, target)
            // cố gắng trap nhanh sau 300ms
            setTimeout(() => {
              placeWebTrap(bot, target)
            }, 300)
          }
        }
      }
      bot._combatState.lastDist = dist

      // Dùng ender pearl bình thường khi khoảng cách xa mà không cần đợi chạy
      if (dist > 12 && dist < 60 && now - bot._combatState.lastPearl > 5000) {
        bot._combatState.lastPearl = now
        throwPearlAt(bot, target)
      }

      // Khi tới rất gần thì đặt tơ để nhốt đối thủ
      if (dist < 4 && now - bot._combatState.lastWeb > 3500) {
        bot._combatState.lastWeb = now
        placeWebTrap(bot, target)
      }

      // Nếu đối thủ đang dính tơ -> bật auto bow spam
      if (isEntityInWeb(bot, target) && now - bot._combatState.lastBow > 1200) {
        bot._combatState.lastBow = now
        shootBowAt(bot, target)
      }

      // ĐÁNH CẬN CHIẾN LEGIT: chỉ đánh khi rất gần, có delay như người thật
      const dy = Math.abs(target.position.y - bot.entity.position.y)
      if (dist <= MAX_MELEE_RANGE && dy <= 2) {
        if (now - bot._lastHit > bot._nextHitDelay) {
          bot._lastHit = now
          bot._nextHitDelay = 250 + Math.random() * 250 // 0.25–0.5s 1 hit
          equipSword(bot)
          try {
            bot.attack(target)
          } catch (_) {}
        }
      }
    } else {
      // Không có mục tiêu -> tắt PvP, ngừng nhảy & sprint
      if (bot.pvp && bot.pvp.target) bot.pvp.stop()
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot._combatState.lastDist = null
      bot._followingTarget = null
      // giữ nguyên pathfinder goal hiện tại (ví dụ đang chạy về home)
    }

    // Nếu bot bị dính tơ -> tự thoát bằng xô nước
    if (isBotInWeb(bot)) {
      escapeWebWithWater(bot)
    }
  }, 250) // 4 lần / giây cho combat mượt
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

    const mcData = require('minecraft-data')(bot.version)
    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)

    // Lưu vị trí spawn làm "home" để không đi quá 100 block
    bot._homePos = bot.entity.position.clone()

    setupHT1Brain(bot)
  })

  bot.on('kicked', r => console.log(`[${name}] kicked:`, r))
  bot.on('error', e => console.log(`[${name}] error:`, e))

  // Nếu bị disconnect (kicked/timeout/leave) thì tự reconnect sau 10s
  bot.on('end', reason => {
    console.log(`[${name}] disconnected (${reason}), reconnecting in 10s`)
    setTimeout(() => {
      createBot(name)
    }, 10000)
  })

  return bot
}

;(async () => {
  for (const name of BOT_NAMES) {
    createBot(name)
    // Chờ 20s rồi mới spawn bot tiếp theo để tránh spam join
    await wait(20000)
  }
})()
