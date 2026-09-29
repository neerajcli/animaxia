const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits, ActivityType, ChannelType } = require('discord.js');
const mongoose = require('mongoose');
const { createCanvas, loadImage } = require('canvas');
const express = require("express");
const crypto = require("crypto");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const DISCORD_TOKEN = "YOUR BOT TOKEN HERE";
const MONGODB_URI = "MONGODB CONNECTION STRING HERE";
const TOPGG_WEBHOOK_SECRET = "TOPGG SECRET HERE";

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
const guildInvites = new Map();
const INVITE_TRACK_GUILD_ID = '498898363350253569';
const INVITE_LOG_CHANNEL_ID = '522005174076833792';
const PREFIX = "!";
const EMBED_COLOR = 0x9b5cff;
const TOURNAMENT_ORGANISER_ROLE_ID = "778855335632699432";
const EMBED_DESCRIPTION_LIMIT = 3500;
const guildLocks = new Map();

let cachedBackground = null;
let xpInterval = null;

const userStatsSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    nextXP: { type: Number, default: 1000 },
    lastMessageXPAt: { type: Number, default: null }
}, { versionKey: false });

userStatsSchema.index({ userId: 1, guildId: 1 }, { unique: true });
userStatsSchema.index({ guildId: 1, level: -1, xp: -1 });

const guildSettingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    xpBoostEnabled: { type: Boolean, default: false },
    ghostPingEnabled: { type: Boolean, default: false }
}, { versionKey: false });

const matchSchema = new mongoose.Schema({
    id: { type: String, required: true },
    tournamentId: { type: String, required: true },
    round: { type: Number, required: true },
    player1: { type: String, default: null },
    player2: { type: String, default: null },
    winner: { type: String, default: null },
    status: { type: String, enum: ["pending", "completed"], default: "pending" },
    resultType: { type: String, default: null },
    createdAt: { type: Number, default: () => Date.now() },
    completedAt: { type: Number, default: null }
}, { _id: false });

const tournamentSchema = new mongoose.Schema({
    id: { type: String, required: true },
    guildId: { type: String, required: true },
    name: { type: String, required: true },
    channelId: { type: String, default: null },
    hostId: { type: String, required: true },
    maxPlayers: { type: Number, required: true },
    players: { type: [String], default: [] },
    disqualified: { type: [String], default: [] },
    matches: { type: [matchSchema], default: [] },
    currentRound: { type: Number, default: 0 },
    winner: { type: String, default: null },
    status: {
        type: String,
        enum: ["registration", "registration_closed", "active", "completed", "cancelled"],
        default: "registration"
    },
    createdAt: { type: Number, default: () => Date.now() },
    startedAt: { type: Number, default: null },
    completedAt: { type: Number, default: null },
    cancelledAt: { type: Number, default: null }
}, { versionKey: false });

tournamentSchema.index({ guildId: 1, id: 1 }, { unique: true });
tournamentSchema.index({ guildId: 1, status: 1 });
tournamentSchema.index({ guildId: 1, "matches.id": 1 });

const counterSchema = new mongoose.Schema({
    _id: { type: String },
    seq: { type: Number, default: 0 }
}, { versionKey: false });

const UserStats = mongoose.model("UserStats", userStatsSchema);
const GuildSettings = mongoose.model("GuildSettings", guildSettingsSchema);
const Tournament = mongoose.model("Tournament", tournamentSchema);
const Counter = mongoose.model("Counter", counterSchema);

async function ensureUserInitialized(userId, guildId) {
    await UserStats.updateOne(
        { userId, guildId },
        { $setOnInsert: { xp: 0, level: 0, nextXP: 1000, lastMessageXPAt: null } },
        { upsert: true }
    );
}

async function addXP(userId, guildId, amount) {
    return UserStats.findOneAndUpdate(
        { userId, guildId },
        {
            $inc: { xp: amount },
            $setOnInsert: { level: 0, nextXP: 1000, lastMessageXPAt: null }
        },
        { upsert: true, new: true }
    ).lean();
}

async function getXPBoost(guildId) {
    const settings = await GuildSettings.findOne({ guildId }).lean();
    return settings?.xpBoostEnabled ? 1 : 0;
}

async function setXPBoost(guildId, enabled) {
    await GuildSettings.updateOne({ guildId }, { $set: { xpBoostEnabled: enabled } }, { upsert: true });
}

async function getGhostPing(guildId) {
    const settings = await GuildSettings.findOne({ guildId }).lean();
    return settings?.ghostPingEnabled ? 1 : 0;
}

async function setGhostPing(guildId, enabled) {
    await GuildSettings.updateOne({ guildId }, { $set: { ghostPingEnabled: enabled } }, { upsert: true });
}

async function getLeaderboard(guildId) {
    const stats = await UserStats.find({ guildId }).sort({ level: -1, xp: -1 }).lean();
    return stats.map(s => ({ userId: s.userId, xp: s.xp, level: s.level }));
}

async function getTournament(guildId, tournamentId) {
    return Tournament.findOne({ guildId, id: tournamentId }).lean();
}

async function saveTournament(tournament) {
    const { _id, ...data } = tournament;
    await Tournament.replaceOne({ guildId: data.guildId, id: data.id }, data, { upsert: true });
}

async function nextSequence(key, amount = 1) {
    const counter = await Counter.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: amount } },
        { new: true, upsert: true }
    );
    return counter.seq;
}

async function getNextTournamentId(guildId) {
    const seq = await nextSequence(`tournament:${guildId}`);
    return `T${String(seq).padStart(3, "0")}`;
}

async function getNextMatchIds(guildId, count) {
    const last = await nextSequence(`match:${guildId}`, count);
    return Array.from({ length: count }, (_, i) => `M${String(last - count + 1 + i).padStart(4, "0")}`);
}

function shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function nextPowerOfTwo(number) {
    let power = 1;
    while (power < number) power *= 2;
    return power;
}

function getUserIdFromMention(value) {
    if (!value) return null;
    const match = value.match(/^<@!?(\d+)>$/);
    return match ? match[1] : null;
}

async function formatUser(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return `<@${userId}> (${member.user.username})`;
    } catch {
        try {
            const user = await client.users.fetch(userId);
            return `<@${userId}> (${user.username})`;
        } catch {
            return `<@${userId}>`;
        }
    }
}

async function formatUsers(guild, userIds) {
    return Promise.all(userIds.map(id => formatUser(guild, id)));
}

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`${title}`)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("Error")
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`ℹ️ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

async function sendEmbedPages(message, pages) {
    for (const page of pages) {
        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTimestamp();
        if (page.title) embed.setTitle(page.title);
        if (page.description) embed.setDescription(page.description);
        if (page.footer) embed.setFooter({ text: page.footer });
        await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
}

function buildPagesFromLines(lines, title) {
    const pages = [];
    let current = "";
    for (const line of lines) {
        const addition = current.length === 0 ? line : `\n${line}`;
        if (current.length + addition.length > EMBED_DESCRIPTION_LIMIT) {
            if (current.length > 0) {
                pages.push({
                    title: pages.length === 0 ? title : `${title} • Page ${pages.length + 1}`,
                    description: current
                });
            }
            current = line;
        } else {
            current += addition;
        }
    }
    if (current.length > 0) {
        pages.push({
            title: pages.length === 0 ? title : `${title} • Page ${pages.length + 1}`,
            description: current
        });
    }
    return pages;
}

async function replyEmbed(message, embed) {
    return message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function createRound(tournament, players, roundNumber) {
    const shuffledPlayers = shuffle(players);
    const bracketSize = nextPowerOfTwo(shuffledPlayers.length);
    const byeCount = bracketSize - shuffledPlayers.length;
    const byePlayers = shuffledPlayers.slice(0, byeCount);
    const pairedPlayers = shuffledPlayers.slice(byeCount);
    const pairCount = pairedPlayers.length / 2;
    const matchIds = await getNextMatchIds(tournament.guildId, byePlayers.length + pairCount);
    const newMatches = [];
    let idIndex = 0;
    for (const player of byePlayers) {
        newMatches.push({
            id: matchIds[idIndex++],
            tournamentId: tournament.id,
            round: roundNumber,
            player1: player,
            player2: null,
            winner: player,
            status: "completed",
            resultType: "bye",
            createdAt: Date.now(),
            completedAt: Date.now()
        });
    }
    for (let i = 0; i < pairedPlayers.length; i += 2) {
        newMatches.push({
            id: matchIds[idIndex++],
            tournamentId: tournament.id,
            round: roundNumber,
            player1: pairedPlayers[i],
            player2: pairedPlayers[i + 1],
            winner: null,
            status: "pending",
            resultType: null,
            createdAt: Date.now(),
            completedAt: null
        });
    }
    tournament.matches.push(...newMatches);
    tournament.currentRound = roundNumber;
    await saveTournament(tournament);
    return newMatches;
}

function getRoundMatches(tournament, roundNumber) {
    return tournament.matches.filter(match => match.round === roundNumber);
}

function getRoundWinners(tournament, roundNumber) {
    return getRoundMatches(tournament, roundNumber)
        .filter(match => match.status === "completed" && match.winner)
        .map(match => match.winner);
}

function isRoundComplete(tournament, roundNumber) {
    const matches = getRoundMatches(tournament, roundNumber);
    return matches.length > 0 && matches.every(match => match.status === "completed");
}

async function advanceTournament(tournament) {
    const currentRound = tournament.currentRound;
    if (!isRoundComplete(tournament, currentRound)) return null;
    const winners = getRoundWinners(tournament, currentRound);
    if (winners.length === 1) {
        tournament.status = "completed";
        tournament.winner = winners[0];
        tournament.completedAt = Date.now();
        await saveTournament(tournament);
        return { type: "winner", winner: winners[0] };
    }
    const nextRound = currentRound + 1;
    const matches = await createRound(tournament, winners, nextRound);
    return { type: "nextRound", round: nextRound, matches };
}

async function formatMatch(guild, match) {
    const [player1, player2] = await Promise.all([
        match.player1 ? formatUser(guild, match.player1) : Promise.resolve("**BYE**"),
        match.player2 ? formatUser(guild, match.player2) : Promise.resolve("**BYE**")
    ]);
    let result;
    if (match.resultType === "bye") {
        result = `**BYE →** ${await formatUser(guild, match.winner)}`;
    } else if (match.resultType === "disqualification") {
        result = match.winner
            ? `**DQ →** ${await formatUser(guild, match.winner)}`
            : "**DQ**";
    } else if (match.status === "completed") {
        result = `**Winner:** ${await formatUser(guild, match.winner)}`;
    } else {
        result = "**Pending**";
    }
    return `\`${match.id}\`\n${player1} vs ${player2}\n${result}`;
}

async function createTournament(message, args) {
    if (!message.member.roles.cache.has(TOURNAMENT_ORGANISER_ROLE_ID)) {
        return replyEmbed(message, errorEmbed("You need the **Tournament Organiser** role to create a tournament."));
    }
    if (args.length < 2) {
        return replyEmbed(message, errorEmbed(
            "Usage: `!tournament create <max_players> <name>`\n\nExample: `!tournament create 16 Valorant Cup`"
        ));
    }
    const maxPlayers = Number(args[0]);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2) {
        return replyEmbed(message, errorEmbed("Maximum players must be a whole number of at least 2."));
    }
    const name = args.slice(1).join(" ");
    const tournamentId = await getNextTournamentId(message.guild.id);
    const tournament = {
        id: tournamentId,
        name,
        guildId: message.guild.id,
        channelId: message.channel.id,
        hostId: message.author.id,
        maxPlayers,
        players: [],
        disqualified: [],
        matches: [],
        currentRound: 0,
        winner: null,
        status: "registration",
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        cancelledAt: null
    };
    await saveTournament(tournament);
    const host = await formatUser(message.guild, message.author.id);
    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("Tournament Created")
        .setDescription(`**${name}**`)
        .addFields(
            { name: "Tournament ID", value: `\`${tournamentId}\``, inline: true },
            { name: "Host", value: host, inline: true },
            { name: "Players", value: `0/${maxPlayers}`, inline: true },
            { name: "Registration", value: `Use \`!tournament register ${tournamentId}\``, inline: false },
            { name: "Host Registration", value: `Use \`!tournament register ${tournamentId} @player\``, inline: false },
            { name: "Start", value: `Use \`!tournament start ${tournamentId}\``, inline: false }
        )
        .setTimestamp();
    return replyEmbed(message, embed);
}

async function registerPlayer(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament register <tournament_id> [@player]`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    const isHost = tournament.hostId === message.author.id;
    const registeringOther = Boolean(args[1]);
    if (registeringOther && !isHost) {
        return replyEmbed(message, errorEmbed("Only the tournament host can register another player."));
    }
    const canRegister = tournament.status === "registration" ||
        (tournament.status === "registration_closed" && isHost && registeringOther);
    if (!canRegister) {
        const message_ = tournament.status === "registration_closed"
            ? "Registration is closed. Only the host can add a player directly, and only before the tournament starts."
            : "Registration is closed for this tournament.";
        return replyEmbed(message, errorEmbed(message_));
    }
    let playerId = message.author.id;
    if (registeringOther) {
        playerId = getUserIdFromMention(args[1]);
        if (!playerId) return replyEmbed(message, errorEmbed("Please mention a valid Discord user."));
    }
    if (tournament.disqualified?.includes(playerId)) {
        const user = await formatUser(message.guild, playerId);
        return replyEmbed(message, errorEmbed(`${user} has been disqualified from this tournament and cannot register.`));
    }
    if (tournament.players.includes(playerId)) {
        const user = await formatUser(message.guild, playerId);
        return replyEmbed(message, errorEmbed(`${user} is already registered.`));
    }
    if (tournament.players.length >= tournament.maxPlayers) {
        return replyEmbed(message, errorEmbed("This tournament is already full."));
    }
    tournament.players.push(playerId);
    await saveTournament(tournament);
    const user = await formatUser(message.guild, playerId);
    return replyEmbed(message, successEmbed(
        "Player Registered",
        `${user} has been registered for **${tournament.name}**.\n\nPlayers: **${tournament.players.length}/${tournament.maxPlayers}**`
    ));
}

async function leaveTournament(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament leave <tournament_id>`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    if (tournament.status !== "registration" && tournament.status !== "registration_closed") {
        return replyEmbed(message, errorEmbed("You can only leave a tournament before it starts."));
    }
    if (!tournament.players.includes(message.author.id)) {
        return replyEmbed(message, errorEmbed("You are not registered for this tournament."));
    }
    tournament.players = tournament.players.filter(p => p !== message.author.id);
    await saveTournament(tournament);
    return replyEmbed(message, successEmbed(
        "Left Tournament",
        `You have left **${tournament.name}**.\n\nPlayers: **${tournament.players.length}/${tournament.maxPlayers}**`
    ));
}

async function closeRegistration(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament registrationClose <tournament_id>`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    if (tournament.hostId !== message.author.id) {
        return replyEmbed(message, errorEmbed("Only the tournament host can close registration."));
    }
    if (tournament.status !== "registration") {
        return replyEmbed(message, errorEmbed("Registration is already closed."));
    }
    tournament.status = "registration_closed";
    await saveTournament(tournament);
    return replyEmbed(message, new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("Registration Closed")
        .setDescription(`Registration for **${tournament.name}** has been closed.`)
        .addFields({ name: "Registered Players", value: `${tournament.players.length}`, inline: true })
        .setTimestamp()
    );
}

async function showParticipants(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament participants <tournament_id>`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    if (tournament.players.length === 0) {
        return replyEmbed(message, new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle(`${tournament.name} - Participants`)
            .setDescription("No participants yet.")
            .addFields({ name: "Players", value: `0/${tournament.maxPlayers}`, inline: true })
            .setTimestamp()
        );
    }
    const usernames = await formatUsers(message.guild, tournament.players);
    const lines = tournament.players.map((player, i) => {
        const isDQ = tournament.disqualified?.includes(player);
        return `${i + 1}. ${usernames[i]}${isDQ ? " **Disqualified**" : ""}`;
    });
    const pages = buildPagesFromLines(lines, `${tournament.name} - Participants`);
    pages[0].description = `**Players:** ${tournament.players.length}/${tournament.maxPlayers}\n\n${pages[0].description}`;
    return sendEmbedPages(message, pages);
}

const STATUS_LABELS = {
    registration: "Registration Open",
    registration_closed: "Registration Closed"
};

async function listTournaments(message) {
    const activeTournaments = await Tournament.find({
        guildId: message.guild.id,
        status: { $in: ["registration", "registration_closed", "active"] }
    }).sort({ createdAt: -1 }).lean();
    if (activeTournaments.length === 0) {
        return replyEmbed(message, new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle("Active Tournaments")
            .setDescription("There are currently no active tournaments in this server.")
            .setTimestamp()
        );
    }
    const lines = await Promise.all(activeTournaments.map(async tournament => {
        const status = tournament.status === "active"
            ? `Round ${tournament.currentRound}`
            : STATUS_LABELS[tournament.status];

        const host = await formatUser(message.guild, tournament.hostId);
        return `**${tournament.name}**\n` +
            `ID: \`${tournament.id}\`\n` +
            `Host: ${host}\n` +
            `Players: **${tournament.players.length}/${tournament.maxPlayers}**\n` +
            `Status: ${status}`;
    }));
    const pages = buildPagesFromLines(lines, "Active Tournaments");
    return sendEmbedPages(message, pages);
}

async function tournamentHistory(message) {
    const completed = await Tournament.find({
        guildId: message.guild.id,
        status: "completed"
    }).sort({ completedAt: -1 }).lean();
    if (completed.length === 0) {
        return replyEmbed(message, infoEmbed(
            "No Tournament History",
            "No tournaments have been completed in this server yet."
        ));
    }

    const lines = await Promise.all(completed.map(async tournament => {
        const winner = tournament.winner ? await formatUser(message.guild, tournament.winner) : "Unknown";
        const totalPlayers = tournament.players.length + (tournament.disqualified?.length || 0);
        const completedDate = tournament.completedAt
            ? `<t:${Math.floor(tournament.completedAt / 1000)}:D>`
            : "Unknown date";
        return `**${tournament.name}**\n` +
            `ID: \`${tournament.id}\`\n` +
            `Winner: ${winner}\n` +
            `Players: **${totalPlayers}**\n` +
            `Completed: ${completedDate}`;
    }));
    const pages = buildPagesFromLines(lines, "Tournament History");
    return sendEmbedPages(message, pages);
}

async function disqualifyPlayer(message, args) {
    if (args.length < 2) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament disqualify <tournament_id> @player`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    if (tournament.hostId !== message.author.id) {
        return replyEmbed(message, errorEmbed("Only the tournament host can disqualify participants."));
    }
    if (tournament.status === "completed") {
        return replyEmbed(message, errorEmbed("This tournament has already been completed."));
    }
    if (tournament.status === "cancelled") {
        return replyEmbed(message, errorEmbed("This tournament has been cancelled."));
    }
    const playerId = getUserIdFromMention(args[1]);
    if (!playerId) {
        return replyEmbed(message, errorEmbed("Please mention the participant you want to disqualify."));
    }
    if (!tournament.players.includes(playerId)) {
        return replyEmbed(message, errorEmbed("That user is not a participant in this tournament."));
    }
    if (tournament.disqualified?.includes(playerId)) {
        return replyEmbed(message, errorEmbed("That participant is already disqualified."));
    }
    const player = await formatUser(message.guild, playerId);
    if (tournament.status === "registration" || tournament.status === "registration_closed") {
        tournament.players = tournament.players.filter(p => p !== playerId);
        tournament.disqualified.push(playerId);
        await saveTournament(tournament);
        return replyEmbed(message, new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle("Participant Disqualified")
            .setDescription(`${player} has been disqualified from **${tournament.name}**.`)
            .addFields({ name: "Remaining Players", value: `${tournament.players.length}/${tournament.maxPlayers}`, inline: true })
            .setTimestamp()
        );
    }
    const currentMatches = getRoundMatches(tournament, tournament.currentRound);
    const playerMatch = currentMatches.find(m => m.player1 === playerId || m.player2 === playerId);
    if (!playerMatch) {
        return replyEmbed(message, errorEmbed("This participant does not have a match in the current round."));
    }
    if (playerMatch.status === "completed") {
        return replyEmbed(message, errorEmbed(
            `${player}'s match \`${playerMatch.id}\` has already been completed.\n\n` +
            "A completed current-round match cannot be changed by disqualification."
        ));
    }
    const opponentId = playerMatch.player1 === playerId ? playerMatch.player2 : playerMatch.player1;
    tournament.disqualified.push(playerId);
    tournament.players = tournament.players.filter(p => p !== playerId);
    playerMatch.status = "completed";
    playerMatch.winner = opponentId || null;
    playerMatch.resultType = "disqualification";
    playerMatch.completedAt = Date.now();
    await saveTournament(tournament);
    const opponentText = opponentId
        ? `\n\n${await formatUser(message.guild, opponentId)} automatically advances.`
        : "";
    await replyEmbed(message, new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("Participant Disqualified")
        .setDescription(`${player} has been disqualified from **${tournament.name}**.${opponentText}`)
        .addFields({ name: "Match", value: `\`${playerMatch.id}\``, inline: true })
        .setTimestamp()
    );
    const result = await advanceTournament(tournament);
    if (!result) return;
    return sendAdvanceMessage(message, tournament, result);
}

async function myMatch(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament mymatch <tournament_id>`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    if (tournament.status !== "active") {
        return replyEmbed(message, errorEmbed("This tournament is not currently active."));
    }
    const currentMatches = getRoundMatches(tournament, tournament.currentRound);
    const match = currentMatches.find(m => m.player1 === message.author.id || m.player2 === message.author.id);
    if (!match) {
        return replyEmbed(message, infoEmbed(
            "No Match Found",
            `You don't have a match in the current round of **${tournament.name}**.`
        ));
    }
    return replyEmbed(message, new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`Your Match - ${tournament.name}`)
        .setDescription(await formatMatch(message.guild, match))
        .addFields({ name: "Round", value: `${match.round}`, inline: true })
        .setTimestamp()
    );
}

async function startTournament(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament start <tournament_id>`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    if (tournament.hostId !== message.author.id) {
        return replyEmbed(message, errorEmbed("Only the tournament host can start the tournament."));
    }
    if (tournament.status !== "registration" && tournament.status !== "registration_closed") {
        return replyEmbed(message, errorEmbed("This tournament cannot be started."));
    }
    if (tournament.players.length < 2) {
        return replyEmbed(message, errorEmbed("At least 2 players must register before starting."));
    }
    tournament.status = "active";
    tournament.startedAt = Date.now();
    await saveTournament(tournament);
    const matches = await createRound(tournament, tournament.players, 1);
    const lines = await Promise.all(matches.map(match => formatMatch(message.guild, match)));
    const pages = buildPagesFromLines(lines, `${tournament.name} - Round 1`);
    pages[0].description = `**Players:** ${tournament.players.length}\n**Bracket:** Randomized\n\n${pages[0].description}`;
    pages[pages.length - 1].description += "\n\nHost: use `!match result <match_id> @winner` when a match finishes.";
    return sendEmbedPages(message, pages);
}

async function cancelTournament(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament cancel <tournament_id>`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    if (tournament.hostId !== message.author.id) {
        return replyEmbed(message, errorEmbed("Only the tournament host can cancel the tournament."));
    }
    if (tournament.status === "completed" || tournament.status === "cancelled") {
        return replyEmbed(message, errorEmbed("This tournament has already ended."));
    }
    tournament.status = "cancelled";
    tournament.cancelledAt = Date.now();
    await saveTournament(tournament);
    return replyEmbed(message, new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("Tournament Cancelled")
        .setDescription(`**${tournament.name}** has been cancelled.`)
        .addFields({ name: "Tournament ID", value: `\`${tournament.id}\``, inline: true })
        .setTimestamp()
    );
}

async function purgeTournaments(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return replyEmbed(message, errorEmbed("You need the **Manage Server** permission to purge tournaments."));
    }
    const { deletedCount } = await Tournament.deleteMany({
        guildId: message.guild.id,
        status: { $in: ["completed", "cancelled"] }
    });
    if (deletedCount === 0) {
        return replyEmbed(message, infoEmbed(
            "Nothing to Purge",
            "There are no completed or cancelled tournaments to remove."
        ));
    }
    return replyEmbed(message, successEmbed(
        "Tournaments Purged",
        `Removed **${deletedCount}** completed/cancelled tournament(s) from storage.`
    ));
}

async function showBrackets(message, args) {
    if (!args[0]) {
        return replyEmbed(message, errorEmbed("Usage: `!tournament brackets <tournament_id>`"));
    }
    const tournament = await getTournament(message.guild.id, args[0].toUpperCase());
    if (!tournament) return replyEmbed(message, errorEmbed("Tournament not found."));
    const host = await formatUser(message.guild, tournament.hostId);
    const pages = [];
    if (tournament.status === "registration" || tournament.status === "registration_closed") {
        const usernames = await formatUsers(message.guild, tournament.players);
        const lines = tournament.players.length > 0
            ? tournament.players.map((player, i) => {
                const isDQ = tournament.disqualified?.includes(player);
                return `${i + 1}. ${usernames[i]}${isDQ ? " **Disqualified**" : ""}`;
            })
            : ["No players registered yet."];
        const status = STATUS_LABELS[tournament.status];
        pages.push(...buildPagesFromLines(lines, `${tournament.name} - Participants`));
        pages[0].description =
            `**ID:** \`${tournament.id}\`\n**Host:** ${host}\n**Status:** ${status}\n` +
            `**Players:** ${tournament.players.length}/${tournament.maxPlayers}\n\n${pages[0].description}`;
        return sendEmbedPages(message, pages);
    }
    if (tournament.status === "cancelled") {
        return replyEmbed(message, new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle(`${tournament.name}`)
            .setDescription("This tournament has been cancelled.")
            .addFields(
                { name: "Tournament ID", value: `\`${tournament.id}\``, inline: true },
                { name: "Host", value: host, inline: true }
            )
            .setTimestamp()
        );
    }
    const rounds = {};
    for (const match of tournament.matches) {
        (rounds[match.round] ??= []).push(match);
    }
    const sortedRounds = Object.keys(rounds).sort((a, b) => Number(a) - Number(b));
    for (const round of sortedRounds) {
        const roundLines = await Promise.all(rounds[round].map(match => formatMatch(message.guild, match)));
        pages.push(...buildPagesFromLines(roundLines, `${tournament.name} - Round ${round}`));
    }
    if (tournament.status === "completed") {
        const winner = tournament.winner ? await formatUser(message.guild, tournament.winner) : "Unknown";
        pages.unshift({
            title: `${tournament.name} - Tournament Complete`,
            description:
                `**Tournament ID:** \`${tournament.id}\`\n**Host:** ${host}\n**Status:** Completed\n\n` +
                `**Winner:** ${winner}`
        });
    } else {
        pages.unshift({
            title: `${tournament.name} - Brackets`,
            description:
                `**Tournament ID:** \`${tournament.id}\`\n**Host:** ${host}\n` +
                `**Status:** Round ${tournament.currentRound}\n` +
                `**Players:** ${tournament.players.length}/${tournament.maxPlayers}`
        });
    }
    return sendEmbedPages(message, pages);
}

async function findMatch(guildId, matchId) {
    const tournament = await Tournament.findOne({ guildId, "matches.id": matchId }).lean();
    if (!tournament) return null;
    const match = tournament.matches.find(m => m.id === matchId);
    return match ? { tournament, match } : null;
}

async function sendAdvanceMessage(message, tournament, result) {
    if (result.type === "winner") {
        const winner = await formatUser(message.guild, result.winner);
        return replyEmbed(message, new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle("Tournament Complete!")
            .setDescription(`**${tournament.name}** has been completed.`)
            .addFields(
                { name: "Winner", value: winner, inline: false },
                { name: "Tournament ID", value: `\`${tournament.id}\``, inline: true }
            )
            .setTimestamp()
        );
    }
    if (result.type === "nextRound") {
        const lines = await Promise.all(result.matches.map(match => formatMatch(message.guild, match)));
        const pages = buildPagesFromLines(lines, `${tournament.name} - Round ${result.round}`);
        pages[0].description = `**Round ${result.round} is starting!**\n\n${pages[0].description}`;
        pages[pages.length - 1].description += "\n\nHost: use `!match result <match_id> @winner` when a match finishes.";
        return sendEmbedPages(message, pages);
    }
}

async function matchResult(message, args) {
    if (args.length < 2) {
        return replyEmbed(message, errorEmbed("Usage: `!match result <match_id> @winner`"));
    }
    const matchId = args[0].toUpperCase();
    const winnerId = getUserIdFromMention(args[1]);
    if (!winnerId) return replyEmbed(message, errorEmbed("Please mention the winning player."));
    const found = await findMatch(message.guild.id, matchId);
    if (!found) return replyEmbed(message, errorEmbed(`Match \`${matchId}\` not found in this server.`));
    const { tournament, match } = found;
    if (tournament.hostId !== message.author.id) {
        return replyEmbed(message, errorEmbed("Only the tournament host can report match results."));
    }
    if (tournament.status !== "active") {
        return replyEmbed(message, errorEmbed("This tournament is not currently active."));
    }
    if (match.round !== tournament.currentRound) {
        return replyEmbed(message, errorEmbed(
            `This match belongs to Round ${match.round}.\n\nThe current round is Round ${tournament.currentRound}.`
        ));
    }
    if (match.status === "completed") {
        const winner = match.winner ? await formatUser(message.guild, match.winner) : "No winner";
        return replyEmbed(message, errorEmbed(`Match \`${matchId}\` already has a result.\n\nWinner: ${winner}`));
    }
    if (winnerId !== match.player1 && winnerId !== match.player2) {
        const winner = await formatUser(message.guild, winnerId);
        return replyEmbed(message, errorEmbed(`${winner} is not participating in match \`${matchId}\`.`));
    }
    if (tournament.disqualified?.includes(winnerId)) {
        return replyEmbed(message, errorEmbed("A disqualified participant cannot be declared the winner."));
    }
    match.winner = winnerId;
    match.status = "completed";
    match.resultType = "normal";
    match.completedAt = Date.now();
    await saveTournament(tournament);
    const winner = await formatUser(message.guild, winnerId);
    await replyEmbed(message, new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("Match Result Recorded")
        .setDescription(`Match \`${matchId}\` has been completed.`)
        .addFields(
            { name: "Winner", value: winner, inline: false },
            { name: "Round", value: `${match.round}`, inline: true }
        )
        .setTimestamp()
    );
    const result = await advanceTournament(tournament);
    if (!result) return;
    return sendAdvanceMessage(message, tournament, result);
}

async function restartMatch(message, args) {
    if (!args[0]) return replyEmbed(message, errorEmbed("Usage: `!match restart <match_id>`"));
    const matchId = args[0].toUpperCase();
    const found = await findMatch(message.guild.id, matchId);
    if (!found) return replyEmbed(message, errorEmbed(`Match \`${matchId}\` not found in this server.`));
    const { tournament, match } = found;
    if (tournament.hostId !== message.author.id) {
        return replyEmbed(message, errorEmbed("Only the tournament host can restart a match."));
    }
    if (tournament.status !== "active") {
        return replyEmbed(message, errorEmbed("This tournament is not currently active."));
    }
    if (match.round !== tournament.currentRound) {
        return replyEmbed(message, errorEmbed(
            `You can only restart matches from the current round.\n\n` +
            `Match \`${matchId}\` is from Round ${match.round}.\nCurrent round: Round ${tournament.currentRound}.`
        ));
    }
    if (match.status !== "completed") {
        return replyEmbed(message, errorEmbed(`Match \`${matchId}\` does not have a result to restart.`));
    }
    if (match.resultType === "bye") {
        return replyEmbed(message, errorEmbed("A BYE match cannot be restarted."));
    }
    if (match.resultType === "disqualification") {
        return replyEmbed(message, errorEmbed("A disqualification result cannot be restarted."));
    }
    match.status = "pending";
    match.winner = null;
    match.resultType = null;
    match.completedAt = null;
    await saveTournament(tournament);
    const [player1, player2] = await formatUsers(message.guild, [match.player1, match.player2]);
    return replyEmbed(message, new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("Match Restarted")
        .setDescription(`Match \`${matchId}\` has been reset.`)
        .addFields(
            { name: "Players", value: `${player1} vs ${player2}`, inline: false },
            { name: "Status", value: "Pending", inline: true }
        )
        .setTimestamp()
    );
}

function withGuildLock(guildId, task) {
    const previous = guildLocks.get(guildId) || Promise.resolve();
    const result = previous.then(task, task);
    guildLocks.set(guildId, result.catch(() => { }));
    return result;
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
    const stats = await UserStats.findOne({ userId, guildId }).lean();
    if (!stats) return;

    let currentXP = stats.xp;
    let currentLevel = stats.level;
    let requiredXP = stats.nextXP;

    if (!(currentXP >= requiredXP || (currentXP < 0 && currentLevel > 0))) return;

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

    await UserStats.updateOne(
        { userId, guildId },
        { $set: { level: currentLevel, xp: currentXP, nextXP: requiredXP } }
    );

    const channel = client.channels.cache.get('502936933471748126');
    if (channel) {
        const member1 = await guild.members.fetch(userId).catch(() => null);
        const embed = new EmbedBuilder()
            .setDescription(`Congratulations ${member1}, you just levelled up to level ${currentLevel}! Keep going!`)
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
            const boosts = await getXPBoost(guildId);
            const xpAmount = getXpAmount(member, boosts);
            await addXP(userId, guildId, xpAmount);
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
        .createHmac("sha256", TOPGG_WEBHOOK_SECRET)
        .update(`${t}.${JSON.stringify(req.body)}`)
        .digest("hex");
    if (expected !== v1) return res.sendStatus(401);
    const body = req.body;
    if (body.type === "vote.create") {
        const userId = body.data.user.platform_id;
        const guildId = "498898363350253569";
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) throw new Error(`Guild ${guildId} not in cache`);
            await addXP(userId, guildId, 250);
            await processLevelUp(userId, guildId, guild);
        } catch (err) {
            console.error(`Vote level up error for ${userId}:`, err);
        }
    }
    res.sendStatus(200);
});

client.on('clientReady', async () => {
    const guild = client.guilds.cache.get(INVITE_TRACK_GUILD_ID) || await client.guilds.fetch(INVITE_TRACK_GUILD_ID);
    if (guild) {
        try {
            const invites = await guild.invites.fetch();
            guildInvites.set(guild.id, new Map(invites.map(inv => [inv.code, inv.uses])));
        } catch (err) {
            console.error('Failed to cache invites on ready:', err.message);
        }
    }
    console.log('Bot is ready');
    client.user.setActivity(`Inside the AGG universe!`, { type: ActivityType.Playing });
});

client.on("messageCreate", async message => {
    if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
    const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = parts.shift()?.toLowerCase();
    if (command !== "tournament" && command !== "match") return;
    await withGuildLock(message.guild.id, async () => {
        try {
            if (command === "tournament") {
                const subcommand = parts.shift()?.toLowerCase();
                if (!subcommand) {
                    return replyEmbed(message, new EmbedBuilder()
                        .setColor(EMBED_COLOR)
                        .setTitle("Tournament Commands")
                        .setDescription([
                            "`!tournament create <max_players> <name>`",
                            "`!tournament register <tournament_id> [@player]`",
                            "`!tournament leave <tournament_id>`",
                            "`!tournament registrationClose <tournament_id>`",
                            "`!tournament start <tournament_id>`",
                            "`!tournament list`",
                            "`!tournament participants <tournament_id>`",
                            "`!tournament disqualify <tournament_id> @player`",
                            "`!tournament brackets <tournament_id>`",
                            "`!tournament mymatch <tournament_id>`",
                            "`!tournament history`",
                            "`!tournament cancel <tournament_id>`",
                            "`!tournament purge`"
                        ].join("\n"))
                        .setTimestamp()
                    );
                }
                switch (subcommand) {
                    case "create": return createTournament(message, parts);
                    case "register": return registerPlayer(message, parts);
                    case "leave": return leaveTournament(message, parts);
                    case "registrationclose": return closeRegistration(message, parts);
                    case "start": return startTournament(message, parts);
                    case "list": return listTournaments(message);
                    case "participants": return showParticipants(message, parts);
                    case "disqualify": return disqualifyPlayer(message, parts);
                    case "brackets": return showBrackets(message, parts);
                    case "mymatch": return myMatch(message, parts);
                    case "history": return tournamentHistory(message);
                    case "cancel": return cancelTournament(message, parts);
                    case "purge": return purgeTournaments(message);
                    default: return replyEmbed(message, errorEmbed("Unknown tournament command."));
                }
            }
            if (command === "match") {
                const subcommand = parts.shift()?.toLowerCase();
                if (!subcommand) {
                    return replyEmbed(message, new EmbedBuilder()
                        .setColor(EMBED_COLOR)
                        .setTitle("Match Commands")
                        .setDescription(["`!match result <match_id> @winner`", "`!match restart <match_id>`"].join("\n"))
                        .setTimestamp()
                    );
                }
                switch (subcommand) {
                    case "result": return matchResult(message, parts);
                    case "restart": return restartMatch(message, parts);
                    default: return replyEmbed(message, errorEmbed("Unknown match command."));
                }
            }
        } catch (error) {
            console.error("Command error:", error);
            return replyEmbed(message, errorEmbed("An unexpected error occurred while processing the command."));
        }
    });
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
        const truncate = text => text.length > 3900 ? `${text.slice(0, 3900)}\n... (truncated)` : text;
        try {
            const code = args.join(" ");
            let evaled = eval(code);
            if (evaled && typeof evaled.then === "function") evaled = await evaled;
            if (typeof evaled !== "string")
                evaled = require("util").inspect(evaled);
            await message.channel.send({ content: `\`\`\`xl\n${truncate(clean(evaled))}\n\`\`\`` });
        } catch (err) {
            await message.channel.send(`\`ERROR\` \`\`\`xl\n${truncate(clean(String(err)))}\n\`\`\``).catch(() => { });
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
    } else if (message.content.startsWith('!level') || message.content.startsWith('!rank')) {
        let user = message.mentions.users.first() || message.author;
        const [stats, leaderboard, bg, av] = await Promise.all([
            UserStats.findOne({ userId: user.id, guildId: message.guild.id }).lean(),
            getLeaderboard(message.guild.id),
            getBackgroundImage(),
            loadImage(user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 })),
        ]);
        let level = stats?.level ?? 0;
        let XP = stats?.xp ?? 0;
        let nextXP = stats?.nextXP ?? 1000;
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
        await addXP(userId, guildId, parseInt(args[2]));
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
        await addXP(userId, guildId, -parseInt(args[2]));
        await processLevelUp(userId, guildId, message.guild);
        message.channel.send(`Removed ${args[2]}XP from ${user.username}.`);
    } else if (message.content.startsWith("!reset")) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        const user = message.mentions.users.first();
        if (!user) return message.channel.send("Invalid User");
        await UserStats.deleteOne({ userId: user.id, guildId: message.guild.id });
        message.channel.send(`Resetted ${user.username}.`);
    } else if (message.content == "!enable-boost") {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        await setXPBoost(message.guild.id, true);
        message.channel.send("Successfully enabled 3x boost.");
    } else if (message.content == "!disable-boost") {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        await setXPBoost(message.guild.id, false);
        message.channel.send("Successfully disabled 3x boost.");
    } else if (message.content == "!enable-ping") {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        await setGhostPing(message.guild.id, true);
        message.channel.send("Successfully enabled event channel ghost ping.");
    } else if (message.content == "!disable-ping") {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        await setGhostPing(message.guild.id, false);
        message.channel.send("Successfully disabled event channel ghost ping.");
    } else if (message.content == '!leaderboard' || message.content == '!lb') {
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
                description += `${prefix} **${displayName}** - Level ${level} | ${xp} XP\n`;
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
        const staleIds = leaderboard
            .filter(entry => !allMembers.has(entry.userId))
            .map(entry => entry.userId);
        if (staleIds.length > 0) {
            await UserStats.deleteMany({ guildId: message.guild.id, userId: { $in: staleIds } });
        }
        await msg.edit(`Cleanup complete! Removed **${staleIds.length}** users from the leaderboard!`)
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
    if (!excludedChannels.includes(message.channel.id)) {
        const timeout = 60000;
        const stats = await UserStats.findOne({ userId, guildId }).lean();
        const onCooldown = stats?.lastMessageXPAt != null && (Date.now() - stats.lastMessageXPAt) < timeout;
        if (!onCooldown) {
            await UserStats.updateOne(
                { userId, guildId },
                { $set: { lastMessageXPAt: Date.now() }, $setOnInsert: { xp: 0, level: 0, nextXP: 1000 } },
                { upsert: true }
            );
            const boosts = await getXPBoost(guildId);
            const member = await message.guild.members.fetch(userId);
            const xpAmount = getXpAmount(member, boosts);
            await addXP(userId, guildId, xpAmount);
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

client.on('inviteCreate', invite => {
    if (invite.guild.id !== INVITE_TRACK_GUILD_ID) return;
    const invites = guildInvites.get(invite.guild.id) || new Map();
    invites.set(invite.code, invite.uses);
    guildInvites.set(invite.guild.id, invites);
});

client.on('inviteDelete', invite => {
    if (invite.guild.id !== INVITE_TRACK_GUILD_ID) return;
    const invites = guildInvites.get(invite.guild.id);
    if (invites) invites.delete(invite.code);
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
            `Welcome <@${member.id}> to **${member.guild.name}!**`
        );
    } else {
        console.error(`Welcome channel ${WELCOME_CHANNEL_ID} not found in guild ${member.guild.id}`);
    }
    const pingStatus = await getGhostPing(member.guild.id);
    if (pingStatus == 1) {
        const eventchannel = member.guild.channels.cache.get("510673955560882226");
        if (eventchannel) {
            let msg = await eventchannel.send(
                `<@${member.id}>`
            );
            await msg.delete();
        } else {
            console.error(`Event channel not found`);
        }
    }
    if (member.guild.id === INVITE_TRACK_GUILD_ID) {
        try {
            const cachedInvites = guildInvites.get(member.guild.id) || new Map();
            const newInvites = await member.guild.invites.fetch();
            const usedInvite = newInvites.find(inv => {
                const cachedUses = cachedInvites.get(inv.code) || 0;
                return inv.uses > cachedUses;
            });
            guildInvites.set(member.guild.id, new Map(newInvites.map(inv => [inv.code, inv.uses])));
            const logChannel = member.guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
            if (logChannel) {
                let description;
                if (usedInvite && usedInvite.inviter) {
                    description = `\`${member.user.tag}\` (\`${member.id}\`) joined the server using **${usedInvite.code}**, which was created by \`${usedInvite.inviter.tag}\` (\`${usedInvite.inviter.id}\`). This invite has **${usedInvite.uses}** uses.`;
                } else {
                    description = `\`${member.user.tag}\` (\`${member.id}\`) joined the server, but the invite used could not be determined.`;
                }
                const embed = new EmbedBuilder()
                    .setTitle('Animaxia Invite Logging')
                    .setDescription(description)
                    .setColor("#9b5cff")
                    .setTimestamp();
                logChannel.send({ embeds: [embed] });
            } else {
                console.error(`Invite log channel ${INVITE_LOG_CHANNEL_ID} not found in guild ${member.guild.id}`);
            }
        } catch (err) {
            console.error(`Failed to track invite for ${member.id}:`, err.message);
        }
    }
});

client.on('guildMemberRemove', async member => {
    await UserStats.deleteOne({ userId: member.id, guildId: member.guild.id });
});

(async () => {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB.");

    await client.login(DISCORD_TOKEN);
})().catch(error => {
    console.error("Startup failed:", error);
    process.exit(1);
});
