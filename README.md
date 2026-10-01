# Dropdown bot

A Discord bot that posts a dropdown menu when you allow it, with a web control panel.

## Setup

1. Go to <https://discord.com/developers/applications> and press **New Application**.
2. Open **Bot** in the left sidebar, press **Reset Token**, and copy the token.
3. Open `.env` in this folder and paste the token after `DISCORD_TOKEN=`.
4. Optional: in Discord, turn on **Settings → Advanced → Developer Mode**, right-click your server, choose **Copy Server ID**, and paste it after `GUILD_ID=`. The commands then appear straight away.
5. Optional: choose a panel password after `PANEL_PASSWORD=`. Without one, the panel opens with no sign-in, but only on this computer.
6. Run `npm start`. The console prints an invite link; open it and add the bot to your server.
7. Open <http://localhost:3000>. No password is needed on the computer running the bot.

The bot only works while it is running. On Windows, double-click `start.bat` to start it.

## Web control panel

- **My Dropdowns** tab — every dropdown you've saved, as many as you like. Open one to edit or send it, duplicate it, delete it, or start a new one.
- **Edit and Send** tab — the dropdown you're working on: name, saved message, placeholder and options. An option can give a role to whoever picks it, with a maximum number of people; picking it again gives the role back. Below the editor, pick a channel and press **Save and send dropdown**.
- **Receipts** tab — every deposit and retrieval: Discord name, type, item, amount and time.
- **Totals** tab — what is left of each item (deposited minus retrieved).
- **Moderation** tab — the item list, the messages people see after `/deposit` and `/retrieve`, the receipt channel, the role needed to deposit, the moderator roles, and the channel told when someone uses `/records`.
- **Bot status** tab — online, idle, do not disturb, invisible.

## Discord commands

- `/deposit item quantity` — records a deposit. The person gets your thank-you message privately and a receipt is posted in the receipt channel.
- `/retrieve item quantity` — moderators only. Takes items out, which subtracts from the totals; it can't take more than is left. The receipt goes to the same channel.
- `/records` — moderators only. Shows every item and its total, visible only to the person who asked.

Moderators are people with a role ticked on the Moderation tab, plus anyone who can manage the server.

Saving a dropdown also updates the copies of it already posted in Discord (the latest 200 posts are tracked).

To give out roles, the bot needs the **Manage Roles** permission, and its own role must sit above the roles it assigns in **Server Settings → Roles**.

The panel listens on this computer only. Set `PANEL_HOST=0.0.0.0` in `.env` to reach it from other devices on your network at `http://<this computer's IP>:3000`; choose a strong password first, because the connection is not encrypted.

Everything is saved in `state.json` next to the bot.