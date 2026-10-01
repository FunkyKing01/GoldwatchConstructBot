# Putting the bot on Wispbyte

This moves the bot from your PC to Wispbyte's free plan so it stays online with your PC off.
Button names on their site may differ slightly from the ones here.

## Before you start

- `dropdown-bot-upload.zip` in this folder is the upload. It holds the bot and your saved dropdowns, items and receipts. It does **not** hold your bot token.
- Have your bot token ready. It is the long text after `DISCORD_TOKEN=` in the `.env` file in this folder.
- Think of a password for the website that you don't use anywhere else. Your friends will use it too.

## Steps

1. Go to <https://wispbyte.com>, create an account, and open the client panel.
2. Create a free server and choose **Node.js** as the type.
3. Open **Files**, upload `dropdown-bot-upload.zip`, then unzip it there (right-click or the menu next to the file → Unarchive / Extract). The files should end up at the top level, not inside a subfolder.
4. Still in **Files**, open the file named `.env` and fill in the two lines, then save:
   - `DISCORD_TOKEN=` your bot token
   - `PANEL_PASSWORD=` the website password you chose
5. Open **Startup** and set the start command / main file to `index.js` (the command is `node index.js`). If there is an option to install packages from `package.json`, leave it on.
6. Open **Console** and press **Start**. After the packages install you should see:
   - `Logged in as Goldwatch Construct#5303`
   - `Control panel is on port ...`
7. **Stop the bot on your PC** (close the black window). Two copies running at once would both answer in Discord and every deposit would be recorded twice.

## Opening the website

The console line `Control panel is on port 1234: open http://<this server's address>:1234` tells you the port.
The server's address is shown in the Wispbyte panel (often under **Network** or on the server's overview page), so the website is `http://that-address:that-port`.
Send that link and the password to the friends who should control the bot.

If the panel shows no address or port for your server, the free plan doesn't expose one. The bot and its commands still work in Discord; only the website is unreachable.

## Good to know

- **Log in every two weeks.** Wispbyte's free plan asks you to sign in to their client panel at least once every two weeks to keep the server.
- **The website link is not encrypted** (`http`, not `https`). Don't reuse a password you care about.
- **Changing things later.** Your data now lives on Wispbyte. Changes you make on your PC's copy don't reach it, and the other way round.
- **Going back to your PC.** Stop the server on Wispbyte, download `state.json` from its Files page into this folder, and double-click `start.bat`.
