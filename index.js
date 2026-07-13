const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits, ActivityType, ChannelType } = require('discord.js');
const { QuickDB } = require('quick.db');
const db = new QuickDB();
const { createCanvas, loadImage } = require('canvas');
const express = require("express");
const crypto = require("crypto");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ]
});
const SECRET = "TOP.GG SERVER AUTHORIZATION HERE";
const BANNED_WORDS = ['nigga', 'nibba', 'gga', 'nigger', 'wigger', 'ass', 'fuck'];
const KEYBOARD_CHARS_REGEX = /[A-Za-z0-9 *&|.,_#$%=+:;-]/;
const TARGET_GUILD_ID = '498898363350253569';
const WELCOME_CHANNEL_ID = '498898363350253571';
const VERIFY_CHANNEL_ID = '623176341830762526';
const LEVEL_ROLES = [
  { level: 1, roleId: '498915544876056577' },
  { level: 7, roleId: '836422040591925248' },
  { level: 15, roleId: '836421588684898342' },
  { level: 25, roleId: '500011042357772288' },
  { level: 38, roleId: '500011531430395905' },
  { level: 51, roleId: '500011920540303362' },
  { level: 62, roleId: '500012144243507201' },
  { level: 75, roleId: '500012320089440286' },
  { level: 88, roleId: '500012762228064285' },
  { level: 100, roleId: '499120445501603840' },
];
const EXCLUDED_VC_CHANNELS = new Set([
  "849004709490589726",
  "852966290981126174",
  "849005281803632723"
]);
const TICK_INTERVAL = 60 * 1000;
const MIN_ELIGIBLE_USERS = 2;
const activeVCUsers = new Map();

let cachedBackground = null;
let xpInterval = null;

client.on('clientReady', async () => {
  console.log('Bot is ready');
  client.user.setActivity(`Inside the AGG universe!`, { type: ActivityType.Playing });
});

async function getLeaderboard(guildId) {
  const allData = await db.all();
  const xpEntries = allData
    .filter(entry => entry.id.startsWith('levelXP_') && entry.id.endsWith(guildId));
  const users = await Promise.all(xpEntries.map(async entry => {
    const userId = entry.id.replace('levelXP_', '').replace(guildId, '');
    const xp = entry.value ?? 0;
    const level = await db.get('level_' + userId + guildId) ?? 0;
    return { userId, xp, level };
  }));
  users.sort((a, b) => b.level - a.level || b.xp - a.xp);
  return users;
}

async function ensureUserInitialized(userId, guildId) {
  const isNewUser = await db.get('level_' + userId + guildId);
  if (isNewUser === null) await db.set('nextXP_' + userId + guildId, 1000);
}

function getXpAmount(member, boosts) {
  let number = Math.round(Math.random() * 30) + 20;
  let number1 = Math.round(Math.random() * 45) + 30;
  let number2 = Math.round(Math.random() * 60) + 40;
  let number3 = Math.round(Math.random() * 75) + 50;
  let number4 = Math.round(Math.random() * 90) + 60;
  let number5 = Math.round(Math.random() * 105) + 70;
  if (boosts == 1) {
    number = Math.round(Math.random() * 120) + 80;
    number1 = Math.round(Math.random() * 135) + 90;
    number2 = Math.round(Math.random() * 150) + 100;
    number3 = Math.round(Math.random() * 165) + 110;
    number4 = Math.round(Math.random() * 180) + 120;
    number5 = Math.round(Math.random() * 195) + 130;
  }
  if (member.roles.cache.has('705353616944267284')) return number5;
  if (member.roles.cache.has('586457992002666536')) return number4;
  if (member.roles.cache.has('648199869860806671')) return number3;
  if (member.roles.cache.has('813998590644191232')) return number3;
  if (member.roles.cache.has('698098009233293392')) return number2;
  if (member.roles.cache.has('698098130620514374')) return number2;
  if (member.roles.cache.has('698097735739637760')) return number1;
  return number;
}

async function processLevelUp(userId, guildId, guild) {
  const XP = await db.get('levelXP_' + userId + guildId);
  const level = await db.get('level_' + userId + guildId);
  const nextXP = await db.get('nextXP_' + userId + guildId);
  if (!(XP >= nextXP || (XP < 0 && level > 0))) return;
  let currentXP = XP;
  let currentLevel = level;
  let requiredXP = nextXP;
  while (currentXP >= requiredXP) {
    currentXP -= requiredXP;
    currentLevel += 1;
    requiredXP += 1000;
  }
  while (currentXP < 0 && currentLevel > 0) {
    requiredXP -= 1000;
    currentLevel -= 1;
    currentXP += requiredXP;
  }
  await db.set('level_' + userId + guildId, currentLevel);
  await db.set('levelXP_' + userId + guildId, currentXP);
  await db.set('nextXP_' + userId + guildId, requiredXP);
  const channel = client.channels.cache.get('502936933471748126');
  if (channel) {
    const embed = new EmbedBuilder()
      .setDescription(`Congratulations <@${userId}>, you just levelled up to level ${currentLevel}! Keep going!`)
      .setColor("#9b5cff")
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
  const member = guild.members.cache.get(userId);
  if (member) {
    for (const { level: reqLevel, roleId } of LEVEL_ROLES) {
      const shouldHaveRole = currentLevel >= reqLevel;
      const hasRole = member.roles.cache.has(roleId);
      if (shouldHaveRole && !hasRole) {
        member.roles.add(roleId).catch(() => { });
      } else if (!shouldHaveRole && hasRole) {
        member.roles.remove(roleId).catch(() => { });
      }
    }
  }
}

function isEligible(state, member) {
  const isStage = state.channel?.type === ChannelType.GuildStageVoice;
  const isSuppressed = isStage && state.suppress;
  return (
    state.channel &&
    !EXCLUDED_VC_CHANNELS.has(state.channel.id) &&
    !member.user.bot &&
    !state.selfMute &&
    !state.selfDeaf &&
    !state.serverMute &&
    !state.serverDeaf &&
    !isSuppressed
  );
}

async function runXpTick() {
  const channelCounts = new Map();
  for (const { channelId } of activeVCUsers.values()) {
    channelCounts.set(channelId, (channelCounts.get(channelId) || 0) + 1);
  }
  const payouts = [...activeVCUsers.entries()].filter(
    ([, { channelId }]) => channelCounts.get(channelId) >= MIN_ELIGIBLE_USERS
  );
  for (const [userId, { guildId }] of payouts) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
      await ensureUserInitialized(userId, guildId);
      const boosts = await db.get('xboost_' + guildId);
      const xpAmount = getXpAmount(member, boosts);
      await db.add('levelXP_' + userId + guildId, xpAmount);
      await processLevelUp(userId, guildId, guild);
    } catch (err) {
      console.error(`VC XP error for ${userId}:`, err);
    }
  }
}

function startXpInterval() {
  if (xpInterval) return;
  xpInterval = setInterval(runXpTick, TICK_INTERVAL);
}

function stopXpInterval() {
  if (!xpInterval) return;
  clearInterval(xpInterval);
  xpInterval = null;
}

async function getBackgroundImage() {
  if (!cachedBackground) {
    cachedBackground = await loadImage("https://wallpapercave.com/wp/wp4247363.jpg");
  }
  return cachedBackground;
}

const app = express();
app.listen(15341, "0.0.0.0", () => {
  console.log("Webhook server running on port 15341");
});
app.post("/topgg", express.json(), async (req, res) => {
  const sig = req.headers["x-topgg-signature"];
  const [t, v1] = sig.split(",").map(s => s.split("=")[1]);
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${t}.${JSON.stringify(req.body)}`)
    .digest("hex");
  if (expected !== v1) return res.sendStatus(401);
  const body = req.body;
  if (body.type === "vote.create") {
    const userId = body.data.user.platform_id;
    const guildId = "498898363350253569";
    await ensureUserInitialized(userId, guildId);
    await db.add(`levelXP_${userId}${guildId}`, 250);
    console.log(`${userId} voted and received 250 XP.`);
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) throw new Error(`Guild ${guildId} not in cache`);
      await processLevelUp(userId, guildId, guild);
    } catch (err) {
      console.error(`Vote level up error for ${userId}:`, err);
    }
  }
  res.sendStatus(200);
});

client.on("messageCreate", async (message) => {
  if (!message.inGuild()) return;
  if (message.author.bot) return;
  if (!message.member) return;
  const TRAP_CHANNEL_ID = "1523244497268506714";
  const IMMUNE_ROLES = new Set([
    "498899750662438937",
    "530279836451864586",
    "838418584660213790",
    "498898597681561620",
    "499124594700189696",
    "633975146784227328"
  ]);
  if (message.channel.id !== TRAP_CHANNEL_ID) return;
  if (message.member.roles.cache.some(role => IMMUNE_ROLES.has(role.id))) {
    return;
  }
  if (!message.member.kickable) {
    console.log(`Couldn't kick ${message.author.tag}.`);
    return;
  }
  try {
    await message.author.send(
      `You triggered the autokick system in **${message.guild.name}** by sending a message in **do-not-type** channel.\nYour account will now be automatically kicked.`
    );
  } catch (err) { console.error(`Failed to DM ${message.author.tag}:`, err); }
  await message.delete().catch(() => { });
  try {
    await message.member.kick("[AUTOKICK] - Sending messages in do-not-type channel.");
  } catch (err) {
    console.error(`Failed to kick ${message.author.tag}:`, err);
  }
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (message.content === "<@784671168673873952>" || message.content === "<@!784671168673873952>") {
    return message.channel.send('I am here!');
  } else if (message.content.startsWith("!eval")) {
    let owners = ["504635146553524234"];
    if (!owners.includes(message.author.id)) return;
    const args = message.content.split(" ").slice(1);
    const clean = text => {
      if (typeof (text) === "string")
        return text.replace(/`/g, "`" + String.fromCharCode(8203)).replace(/@/g, "@" + String.fromCharCode(8203));
      else
        return text;
    };
    try {
      const code = args.join(" ");
      let evaled = eval(code);
      if (typeof evaled !== "string")
        evaled = require("util").inspect(evaled);
      message.channel.send({ content: `\`\`\`xl\n${clean(evaled)}\n\`\`\`` });
    } catch (err) {
      message.channel.send(`\`ERROR\` \`\`\`xl\n${clean(err)}\n\`\`\``);
    }
  } else if (message.content == '!trialsinfo') {
    if (message.guild.id === "498898363350253569" &&
      (message.member.roles.cache.has('498898597681561620') ||
        message.member.roles.cache.has('530279836451864586') ||
        message.member.roles.cache.has('498899750662438937'))) {
      const embed = new EmbedBuilder()
        .setTitle('Trial Mod Guidelines')
        .setColor('#9b5cff')
        .setFooter({ text: 'Failing to follow these guidelines may result in a direct demotion' })
        .setDescription(`- 2k messages weekly. \n- Non toxic. \n- Friendly behaviour with everyone. \n- Must know MOD command uses or experience. [Even if you dont have exp as long as you are willing to work and learn them its all good] \n- Read rules and info. \n- Must do the task given by your seniors.`);
      message.channel.send({ embeds: [embed] });
    }
  } else if (message.content == '!eventmanagersinfo') {
    if (message.guild.id === "498898363350253569" &&
      (message.member.roles.cache.has('498898597681561620') ||
        message.member.roles.cache.has('530279836451864586') ||
        message.member.roles.cache.has('498899750662438937'))) {
      const embed = new EmbedBuilder()
        .setTitle('Event Managers Guidelines')
        .setColor('#9b5cff')
        .setFooter({ text: 'Failing to follow these guidelines may result in a direct demotion' })
        .setDescription(`- 1k messages weekly. \n- 1 event weekly [can host alone or with the help of others in staff or event managers which are present, also complete the event within the week]. \n- Update <#513975623048364032> channel accordingly.`);
      message.channel.send({ embeds: [embed] });
    }
  } else if (message.content == '!modinfo') {
    if (message.guild.id === "498898363350253569" &&
      (message.member.roles.cache.has('498898597681561620') ||
        message.member.roles.cache.has('530279836451864586') ||
        message.member.roles.cache.has('498899750662438937'))) {
      const embed = new EmbedBuilder()
        .setTitle('Mod Guidelines')
        .setColor('#9b5cff')
        .setFooter({ text: 'Failing to follow these guidelines may result in a direct demotion' })
        .setDescription(`- 2k messages weekly. \n- Moderation without partiality. \n- Don't fight with fellow staff members over moderation issues outside staff channels. \n- Don't be toxic with people u don't know personally. \n- Change the nickname which ain't pingable or are in other languages or fonts. \n- Read staff channels on a regular basis. \n- If you have to go inactive due to some days, go by telling your seniors and the amount of time for which you will be inactive. \n \nNOTE :- You work is not only to moderate but also to make chat active, non-toxic, friendly and social.`);
      message.channel.send({ embeds: [embed] });
    }
  } else if (message.content == '!gamingmanagersinfo') {
    if (message.guild.id === "498898363350253569" &&
      (message.member.roles.cache.has('498898597681561620') ||
        message.member.roles.cache.has('530279836451864586') ||
        message.member.roles.cache.has('498899750662438937'))) {
      const embed = new EmbedBuilder()
        .setTitle('Gaming Managers Guidelines')
        .setColor('#9b5cff')
        .setFooter({ text: 'Failing to follow these guidelines may result in a direct demotion' })
        .setDescription(`- 1k messages weekly. \n- You can stream the games or host game related events yourself or with the help of event managers. \n- Update <#590141817031491584> channel.`);
      message.channel.send({ embeds: [embed] });
    }
  } else if (message.content.startsWith('!level')) {
    let user = message.mentions.users.first() || message.author;
    const [levelRaw, XPRaw, nextXPRaw, leaderboard, bg, av] = await Promise.all([
      db.get('level_' + user.id + message.guild.id),
      db.get('levelXP_' + user.id + message.guild.id),
      db.get('nextXP_' + user.id + message.guild.id),
      getLeaderboard(message.guild.id),
      getBackgroundImage(),
      loadImage(user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 })),
    ]);
    let level = levelRaw === null ? 0 : levelRaw;
    let XP = XPRaw === null ? 0 : XPRaw;
    let nextXP = nextXPRaw === null ? 1000 : nextXPRaw;
    const rankIndex = leaderboard.findIndex(entry => entry.userId === user.id);
    const rank = rankIndex === -1 ? 'N/A' : `#${rankIndex + 1}`;
    const progress = Math.max(0, Math.min(1, XP / nextXP));
    const canvas = createCanvas(1000, 300);
    const ctx = canvas.getContext('2d');
    function roundRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    roundRectPath(ctx, 0, 0, canvas.width, canvas.height, 24);
    ctx.clip();
    ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    const overlay = ctx.createLinearGradient(0, 0, canvas.width, 0);
    overlay.addColorStop(0, "rgba(10,10,20,0.75)");
    overlay.addColorStop(0.55, "rgba(10,10,20,0.45)");
    overlay.addColorStop(1, "rgba(10,10,20,0.65)");
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const accentStart = "#8b5cf6";
    const accentEnd = "#3b82f6";
    ctx.save();
    ctx.shadowColor = accentStart;
    ctx.shadowBlur = 16;
    const ringGradient = ctx.createLinearGradient(10, 10, 230, 230);
    ringGradient.addColorStop(0, accentStart);
    ringGradient.addColorStop(1, accentEnd);
    ctx.beginPath();
    ctx.arc(120, 120, 108, 0, 2 * Math.PI);
    ctx.lineWidth = 6;
    ctx.strokeStyle = ringGradient;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(120, 120, 100, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(av, 20, 20, 200, 200);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.font = "bold 34px Sans";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(user.username, 120, 265, 210);
    ctx.restore();
    function drawStat(label, value, x) {
      ctx.font = "bold 18px Sans";
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.textAlign = "left";
      ctx.fillText(label.toUpperCase(), x, 45);
      ctx.font = "bold 42px Sans";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(value, x, 88);
    }
    drawStat("Rank", rank, 640);
    drawStat("Level", level, 830);
    const barX = 300, barY = 190, barWidth = 640, barHeight = 28, barRadius = 14;
    roundRectPath(ctx, barX, barY, barWidth, barHeight, barRadius);
    ctx.fillStyle = "rgba(139,92,246,0.12)";
    ctx.fill();
    const fillWidth = Math.max(barHeight, barWidth * progress);
    ctx.save();
    ctx.shadowColor = accentEnd;
    ctx.shadowBlur = 12;
    roundRectPath(ctx, barX, barY, fillWidth, barHeight, barRadius);
    const barGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    barGradient.addColorStop(0, accentStart);
    barGradient.addColorStop(1, accentEnd);
    ctx.fillStyle = barGradient;
    ctx.fill();
    ctx.restore();
    ctx.font = "bold 20px Sans";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.fillText(`${XP} / ${nextXP} XP`, barX + barWidth, barY - 12);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`${(progress * 100).toFixed(0)}%`, barX, barY - 12);
    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'level.png' });
    message.channel.send({ files: [attachment] });
  } else if (message.content.startsWith("!addXP")) {
    const prefix = '!';
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const user = message.mentions.users.first();
    if (!user) return message.channel.send("Invalid User");
    const args = message.content.slice(prefix.length).trim().split(' ');
    if (!args[2]) return message.channel.send('Invalid XP amount.');
    if (isNaN(args[2])) return message.channel.send("Invalid XP amount.");
    if (args[2] <= 0) return message.channel.send("Invalid XP amount.");
    const userId = user.id;
    const guildId = message.guild.id;
    await ensureUserInitialized(userId, guildId);
    await db.add("levelXP_" + userId + guildId, parseInt(args[2]));
    await processLevelUp(userId, guildId, message.guild);
    message.channel.send(`Gave ${args[2]}XP to ${user.username}.`);
  } else if (message.content.startsWith("!removeXP")) {
    const prefix = '!';
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const user = message.mentions.users.first();
    if (!user) return message.channel.send("Invalid User");
    const args = message.content.slice(prefix.length).trim().split(' ');
    if (!args[2]) return message.channel.send('Invalid XP amount.');
    if (isNaN(args[2])) return message.channel.send("Invalid XP amount.");
    if (args[2] <= 0) return message.channel.send("Invalid XP amount.");
    const userId = user.id;
    const guildId = message.guild.id;
    await ensureUserInitialized(userId, guildId);
    await db.sub("levelXP_" + user.id + message.guild.id, parseInt(args[2]));
    await processLevelUp(userId, guildId, message.guild);
    message.channel.send(`Removed ${args[2]}XP from ${user.username}.`);
  } else if (message.content.startsWith("!reset")) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const user = message.mentions.users.first();
    if (!user) return message.channel.send("Invalid User");
    await db.delete("levelXP_" + user.id + message.guild.id);
    await db.delete("level_" + user.id + message.guild.id);
    await db.delete("nextXP_" + user.id + message.guild.id);
    message.channel.send(`Resetted ${user.username}.`);
  } else if (message.content.startsWith("!enable-boost")) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    await db.set('xboost_' + message.guild.id, 1);
    message.channel.send("Successfully enabled 3x boost.");
  } else if (message.content.startsWith("!disable-boost")) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    await db.set('xboost_' + message.guild.id, 0);
    message.channel.send("Successfully disabled 3x boost.");
  } else if (message.content.startsWith('!leaderboard')) {
    const leaderboard = await getLeaderboard(message.guild.id);
    if (leaderboard.length === 0)
      return message.channel.send('No leaderboard data yet!');
    const USERS_PER_PAGE = 15;
    const totalPages = Math.ceil(leaderboard.length / USERS_PER_PAGE);
    let currentPage = 0;
    async function buildLeaderboardEmbed(page) {
      const start = page * USERS_PER_PAGE;
      const end = start + USERS_PER_PAGE;
      const pageEntries = leaderboard.slice(start, end);
      let description = '';
      for (let i = 0; i < pageEntries.length; i++) {
        const { userId, xp, level } = pageEntries[i];
        const globalIndex = start + i;
        const prefix = `**#${globalIndex + 1}**`;
        let member;
        try {
          member = await message.guild.members.fetch(userId);
        } catch {
          member = null;
        }
        const displayName = member ? member.user.username : `Unknown (${userId})`;
        description += `${prefix} **${displayName}** — Level ${level} | ${xp} XP\n`;
      }
      return new EmbedBuilder()
        .setTitle(`${message.guild.name} Leaderboard`)
        .setColor('#9b5cff')
        .setDescription(description)
        .setFooter({ text: `Page ${page + 1} of ${totalPages} • ${leaderboard.length} total users • React ⏮ ◀ ▶ ⏭ to navigate` })
        .setTimestamp();
    }
    const initialEmbed = await buildLeaderboardEmbed(0);
    const lbMessage = await message.channel.send({ embeds: [initialEmbed] });
    if (totalPages > 1) {
      await lbMessage.react('⏮');
      await lbMessage.react('◀');
      await lbMessage.react('▶');
      await lbMessage.react('⏭');
    }
    const filter = (reaction, user) =>
      ['⏮', '◀', '▶', '⏭'].includes(reaction.emoji.name) && user.id === message.author.id;
    const collector = lbMessage.createReactionCollector({ filter, time: 120000 });
    collector.on('collect', async (reaction, user) => {
      await reaction.users.remove(user.id).catch(() => { });
      if (reaction.emoji.name === '⏮') currentPage = 0;
      else if (reaction.emoji.name === '◀') currentPage = Math.max(0, currentPage - 1);
      else if (reaction.emoji.name === '▶') currentPage = Math.min(totalPages - 1, currentPage + 1);
      else if (reaction.emoji.name === '⏭') currentPage = totalPages - 1;
      const newEmbed = await buildLeaderboardEmbed(currentPage);
      await lbMessage.edit({ embeds: [newEmbed] });
    });
    collector.on('end', async () => {
      await lbMessage.reactions.removeAll().catch(() => { });
    });
  } else if (message.content === '!cleanupleaderboard') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const leaderboard = await getLeaderboard(message.guild.id);
    if (leaderboard.length === 0)
      return message.channel.send('No leaderboard data to clean up!');
    let msg = await message.channel.send("Leaderboard cleaning in progress..... This will take some time, please wait....")
    const allMembers = await message.guild.members.fetch();
    let removed = 0;
    for (const entry of leaderboard) {
      if (!allMembers.has(entry.userId)) {
        await db.delete('level_' + entry.userId + message.guild.id);
        await db.delete('levelXP_' + entry.userId + message.guild.id);
        await db.delete('nextXP_' + entry.userId + message.guild.id);
        removed++;
      }
    }
    await msg.edit(`Cleanup complete! Removed **${removed}** users from the leaderboard!`)
  }
  else {
    return;
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const excludedChannels = ["499533661771792406", "503614955472420878", "540467584126943243",
    "498911483531624467", "525607058121162762", "502052026486751233"];
  const userId = message.author.id;
  const guildId = message.guild.id;
  await ensureUserInitialized(userId, guildId);
  if (!excludedChannels.includes(message.channel.id)) {
    const timeout = 60000;
    const levelOut = await db.get(`levelOut_${userId}${guildId}`);
    const onCooldown = levelOut !== null && (Date.now() - levelOut) < timeout;
    if (!onCooldown) {
      await db.set(`levelOut_${userId}${guildId}`, Date.now());
      const boosts = await db.get('xboost_' + guildId);
      const member = await message.guild.members.fetch(userId);
      const xpAmount = getXpAmount(member, boosts);
      await db.add('levelXP_' + userId + guildId, xpAmount);
      await processLevelUp(userId, guildId, message.guild);
    }
  }
});

client.on("voiceStateUpdate", (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member) return;
  if (isEligible(newState, member)) {
    activeVCUsers.set(member.id, {
      guildId: newState.guild.id,
      channelId: newState.channel.id,
    });
  } else {
    activeVCUsers.delete(member.id);
  }
  if (activeVCUsers.size > 0) {
    startXpInterval();
  } else {
    stopXpInterval();
  }
});

client.on('guildMemberAdd', async member => {
  if (member.guild.id === TARGET_GUILD_ID) {
    const usernameLower = member.user.username.toLowerCase();
    const hasNoKeyboardChars = !KEYBOARD_CHARS_REGEX.test(member.user.username);
    const hasBannedWord = BANNED_WORDS.some(word => usernameLower.includes(word));
    if (hasNoKeyboardChars || hasBannedWord) {
      try {
        await member.setNickname('Moderated Nickname');
      } catch (err) {
        console.error(`Failed to moderate nickname for ${member.id}:`, err.message);
      }
    }
  }
  const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (channel) {
    channel.send(
      `Welcome <@${member.id}> to **${member.guild.name}!** Please visit <#${VERIFY_CHANNEL_ID}> to verify yourself!`
    );
  } else {
    console.error(`Welcome channel ${WELCOME_CHANNEL_ID} not found in guild ${member.guild.id}`);
  }
});

client.on('guildMemberRemove', async member => {
  const key = `${member.id}${member.guild.id}`;
  await Promise.all([
    db.delete(`level_${key}`),
    db.delete(`levelXP_${key}`),
    db.delete(`nextXP_${key}`),
  ]);
});

client.login('YOUR BOT TOKEN HERE');
