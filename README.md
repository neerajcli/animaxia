# Animaxia - A Levelling & Tournament System Based Discord Bot

Animaxia is a lightweight and extensible **Discord bot** built using **Discord.js** and **MongoDB**.
It features a levelling system that rewards user activity and encourages community engagement within the server, alongside a full single-elimination **tournament system** for running community events - bracket generation, match reporting, host controls, and more.

---

## Features

### Levelling System
- **XP & Levels** - Rewards users with XP and levels based on chat activity and time spent in voice channels.
- **Rank Cards** - Generates a custom image showing a user's rank, level, and XP progress bar.
- **Leaderboards** - Paginated, reaction-navigable server leaderboard.
- **Role Rewards** - Automatically grants/removes roles as users cross level thresholds.
- **Vote Rewards** - Grants bonus XP when a user votes for the bot on top.gg.
- **Admin Tools** - Add/remove XP, reset a user's progress, toggle an XP boost event, and clean up stale leaderboard entries.

### Tournament System
- **Single-Elimination Brackets** - Automatic bracket generation with fair bye handling for any player count.
- **Full Tournament Lifecycle** - Create, register, close registration, start, report results, and complete a tournament from start to finish.
- **Host Controls** - Disqualify players, restart a match, or cancel a tournament.
- **Role-Gated Creation** - Only members with the Tournament Organiser role can create (and therefore host) a tournament.
- **History & Cleanup** - Browse past tournament winners, and purge old completed/cancelled tournaments.

### Other
- **Welcomer Messages** - Sends a welcome message when a new member joins the server.
- **Invite Tracking** - Logs which invite a new member used to join.
- **Nickname Moderation** - Automatically checks and moderates usernames when users join the server.
- **Clean Structure** - Easy to understand and extend.
- **Beginner-Friendly** - Ideal for learning Discord bot development.
- **Quick Startup** - Run the bot instantly with a single command.

---

## Tech Stack

- **Node.js v20+**
- **Discord.js v14**
- **Mongoose v8** (MongoDB)
- **Express** - powers the top.gg vote webhook
- **node-canvas** - renders rank card images

---

## Installation

### Clone the repository

```bash
git clone https://github.com/neerajcli/animaxia.git
cd animaxia
```

### Install dependencies

```bash
npm install
```

### Add the config values in index.js

```js
const DISCORD_TOKEN = "YOUR BOT TOKEN HERE";
const MONGODB_URI = "MONGODB CONNECTION STRING HERE";
const TOPGG_WEBHOOK_SECRET = "TOPGG SECRET HERE";
```

All three are required - the bot checks for them on startup and exits with an error if any are missing, so you'll know right away if something's unset. `TOPGG_WEBHOOK_SECRET` is only used by the vote webhook; if you're not using top.gg voting, set it to any placeholder value.

> A handful of Discord IDs (guild, channel, and role IDs - including the Tournament Organiser role) are configured directly as constants near the top of the source rather than as environment variables, since they're specific to this server. Update those to match your own server before running the bot elsewhere.

### Start the bot

```bash
node index.js
```

---

## Commands

### Levelling

| Command | Access | Description |
|---|---|---|
| `!level` / `!rank [@user]` | Anyone | Shows a rank card for yourself or a mentioned user |
| `!leaderboard` / `!lb` | Anyone | Paginated server leaderboard |
| `!addXP @user <amount>` | Admin | Grants XP to a user |
| `!removeXP @user <amount>` | Admin | Removes XP from a user |
| `!reset @user` | Admin | Resets a user's level and XP |
| `!enable-boost` / `!disable-boost` | Admin | Toggles the 3x XP boost event |
| `!cleanupleaderboard` | Admin | Removes leaderboard entries for users no longer in the server |
| `!eval <code>` | Bot owner only | Runs raw JS in the bot's process - see Security Notes |

### Tournaments

| Command | Access | Description |
|---|---|---|
| `!tournament create <max_players> <name>` | Tournament Organiser role | Creates a tournament (you become the host) |
| `!tournament register <id> [@player]` | Anyone (self) / Host (others) | Registers yourself, or the host registers someone else |
| `!tournament leave <id>` | Anyone | Leaves a tournament before it starts |
| `!tournament registrationClose <id>` | Host | Closes registration |
| `!tournament start <id>` | Host | Locks the player list and generates Round 1 |
| `!tournament list` | Anyone | Lists active tournaments in the server |
| `!tournament participants <id>` | Anyone | Lists a tournament's registered players |
| `!tournament brackets <id>` | Anyone | Shows the full bracket |
| `!tournament mymatch <id>` | Anyone | Shows your match in the current round |
| `!tournament disqualify <id> @player` | Host | Disqualifies a player, auto-advancing their opponent |
| `!tournament cancel <id>` | Host | Cancels a tournament |
| `!tournament history` | Anyone | Lists completed tournaments and their winners |
| `!tournament purge` | Manage Server permission | Deletes all completed/cancelled tournaments |
| `!match result <match_id> @winner` | Host | Reports a match result and advances the bracket |
| `!match restart <match_id>` | Host | Resets a completed match in the current round |

---

## Security Notes

- Never commit your `.env` file, and a leaked value should be rotated immediately (regenerate the Discord token, the top.gg webhook secret, and/or your MongoDB database password).
- `!eval` runs arbitrary code with full access to the bot's process and database. It's restricted to a single hardcoded owner ID in the source - treat that Discord account's security as equivalent to the bot's own credentials.
- Tournament creation and `!tournament purge` are permission-gated (Tournament Organiser role and Manage Server, respectively) - review those checks before adding the bot to a new server.
