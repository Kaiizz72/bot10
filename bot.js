// bot.js — 17 survival bots (Mineflayer) with PvP vs mobs & players + weapon crafting

const mineflayer = require('mineflayer')
const { pathfinder, goals: { GoalXZ } } = require('mineflayer-pathfinder')
const autoEat = require('mineflayer-auto-eat').plugin
const pvp = require('mineflayer-pvp').plugin

const SERVER_HOST = process.env.SERVER_HOST || 'play2.eternalzero.cloud'
const SERVER_PORT = Number(process.env.SERVER_PORT || 27199)
const AUTH_MODE   = process.env.AUTH_MODE || 'offline'
const MAX_BOTS    = 17
const JOIN_DELAY_MS = 2500

const NAMES = [
  'memaybel','chaohet','anhhangxom','cuongdeptrai','linhthongthai',
  'hoanghac','suutam','khaibede','thanhnhien1','thanhnhien2',
  'thanhnhien3','thanhnhien4','thanhnhien5','noobgiau','prokhonglo',
  'laicanh','thodansoi'
].slice(0, MAX_BOTS)

function wait(ms) { return new Promise(res => setTimeout(res, ms)) }

async function craftStoneWeapons(bot) {
  const mcData = require('minecraft-data')(bot.version)
  const stoneSword = mcData.itemsByName.stone_sword
  const stonePick  = mcData.itemsByName.stone_pickaxe
  const craftingTable = mcData.blocksByName.crafting_table

  let tableBlock = bot.findBlock({ matching: craftingTable.id, maxDistance: 6 })
  if (!tableBlock) {
    // thử craft bàn chế tạo nếu có plank
    const planks = mcData.itemsByName.oak_planks || mcData.itemsByName.birch_planks
    const recipeTable = bot.recipesFor(craftingTable.id, null, 1, null)[0]
    if (recipeTable) {
      await bot.craft(recipeTable, 1, null)
      bot.chat("Đã craft bàn chế tạo 🛠️")
    }
    tableBlock = bot.findBlock({ matching: craftingTable.id, maxDistance: 6 })
  }

  const recipeSword = bot.recipesFor(stoneSword.id, null, 1, tableBlock)?.[0]
  if (recipeSword) {
    try {
      await bot.craft(recipeSword, 1, tableBlock)
      bot.chat("Đã craft kiếm đá ⚔️")
    } catch {}
  }

  const recipePick = bot.recipesFor(stonePick.id, null, 1, tableBlock)?.[0]
  if (recipePick) {
    try {
      await bot.craft(recipePick, 1, tableBlock)
      bot.chat("Đã craft cuốc đá ⛏️")
    } catch {}
  }
}

// PvP combat setup: attack mobs + players
function setupCombat(bot) {
  bot.on('physicTick', () => {
    const target = bot.nearestEntity(e =>
      (e.type === 'mob' && e.mobType && ['Zombie','Husk','Drowned','Skeleton','Spider','Creeper'].includes(e.mobType)) ||
      (e.type === 'player' && e.username !== bot.username)
    )
    if (target) {
      if (!bot.pvp.target) bot.pvp.attack(target)
    }
  })
}

// wandering loop
function wander(bot) {
  setInterval(() => {
    try {
      const x = Math.floor(bot.entity.position.x + (Math.random() * 16 - 8))
      const z = Math.floor(bot.entity.position.z + (Math.random() * 16 - 8))
      bot.pathfinder.setGoal(new GoalXZ(x, z), false)
    } catch {}
  }, 12000)
}

function createBot(name) {
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: name,
    auth: AUTH_MODE
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(autoEat)
  bot.loadPlugin(pvp)

  bot.once('spawn', async () => {
    console.log(`[${name}] joined!`)
    bot.autoEat.options = { priority: 'foodPoints', startAt: 14, bannedFood: [] }
    setupCombat(bot)
    wander(bot)

    // sau 10s thử craft vũ khí
    setTimeout(() => craftStoneWeapons(bot), 10000)
  })

  bot.on('kicked', r => console.log(`[${name}] kicked:`, r))
  bot.on('error', e => console.log(`[${name}] error:`, e))

  return bot
}

;(async () => {
  for (let i = 0; i < NAMES.length; i++) {
    createBot(NAMES[i])
    await wait(JOIN_DELAY_MS)
  }
})()
