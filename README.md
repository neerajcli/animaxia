# Animaxia — A Levelling & Tournament System Based Discord Bot

Animaxia is a lightweight and extensible **Discord bot** built using **Discord.js**.  
It features a levelling system that rewards user activity and encourages community engagement within the server.

---

## Features

- **Levelling System** — Rewards users with XP and levels based on their activity in the server.
- **Welcomer Messages** — Sends a welcome message when a new member joins the server.
- **Nickname Moderation** — Automatically checks and moderates usernames when users join the server.
- **Clean Structure** — Easy to understand and extend
- **Beginner-Friendly** — Ideal for learning Discord bot development
- **Quick Startup** — Run the bot instantly with a single command

---

## Tech Stack

- **Node.js v20**
- **Discord.js v14**
- **Mongoose v8**

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

### Add the config details in `index.js`

```js
const DISCORD_TOKEN = "YOUR BOT TOKEN HERE";
const MONGODB_URI = "MONGODB CONNECTION STRING HERE";
const TOPGG_WEBHOOK_SECRET = "TOPGG SECRET HERE";
```

### Start the bot

```bash
node index.js
```

---

## Security Notes

- Never commit your Discord token.
- Use environment variables if hosting online.
