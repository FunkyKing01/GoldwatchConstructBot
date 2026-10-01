import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { depositTotals, findMenu, save, state } from './store.js';
import { menuMessage } from './ui.js';
import { startPanel } from './web.js';

// Read .env next to this file, so the bot also works on hosts that start it with plain `node index.js`.
// Variables the host or the start script already set are left alone.
const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const { DISCORD_TOKEN, PANEL_HOST, PANEL_PORT, PANEL_PASSWORD } = process.env;
if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing. Open the .env file and paste your bot token after DISCORD_TOKEN=');
  process.exit(1);
}

// Hosting companies hand the bot a port to listen on; when they do, the panel must be reachable from outside.
const hostedPort = Number(process.env.SERVER_PORT || process.env.PORT) || 0;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ephemeral = { flags: MessageFlags.Ephemeral };

const commands = [
  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Record items you deposited')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('item').setDescription('What you deposited').setRequired(true).setAutocomplete(true))
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(1000000)),
  new SlashCommandBuilder()
    .setName('retrieve')
    .setDescription('Take items out; this subtracts from the totals')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('item').setDescription('What you are taking out').setRequired(true).setAutocomplete(true))
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(1000000)),
  new SlashCommandBuilder()
    .setName('records')
    .setDescription('See the total amount of every item (moderators only; only you see the answer)')
    .setContexts(InteractionContextType.Guild),
];

client.once(Events.ClientReady, async () => {
  // Registered per server so the command shows up immediately; the global list is cleared of older commands.
  await client.application.commands.set([]);
  for (const guild of client.guilds.cache.values()) await guild.commands.set(commands);
  client.user.setStatus(state.presence);
  await updateLedger();
  setInterval(updateLedger, 30000);

  console.log(`Logged in as ${client.user.tag}`);
  console.log(
    `Invite: https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot+applications.commands&permissions=268438528`,
  );

  // No password is needed while the panel is only reachable from this computer.
  // Once it is opened to other devices, one is required: yours from .env, or a random one.
  const host = hostedPort ? '0.0.0.0' : PANEL_HOST || '127.0.0.1';
  const localOnly = host === '127.0.0.1' || host === 'localhost';
  const password = PANEL_PASSWORD || (localOnly ? '' : randomBytes(9).toString('base64url'));
  startPanel(webBot, {
    host,
    port: hostedPort || Number(PANEL_PORT) || 3000,
    password,
    viewPassword: process.env.PANEL_VIEW_PASSWORD || '',
  });
  if (!PANEL_PASSWORD && password) {
    console.log(`Panel password for this run: ${password}  (set PANEL_PASSWORD in .env to choose your own)`);
  }
});

// What the web control panel is allowed to do with the Discord client.
const webBot = {
  info: () => ({
    tag: client.user.tag,
    guilds: client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
      channels: guild.channels.cache
        .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => ({ id: c.id, name: c.name })),
      roles: guild.roles.cache
        .filter((r) => !r.managed && r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, assignable: r.editable })),
    })),
  }),
  setStatus: (presence) => client.user.setStatus(presence),
  send: async (channelId, payload) => {
    const channel = client.channels.cache.get(channelId);
    if (!channel?.isSendable()) throw new Error('that channel no longer exists');
    return channel.send(payload);
  },
  refreshPosted,
  deletePosted,
  ledger: () => ledger,
  updateLedger: () => updateLedger(),
};

// The Ledger tab: every member with a Role and an Assignment column. Each dropdown says which column
// its roles belong in. If no dropdown is marked as a source of roles, the Role column shows all of a
// member's other Discord roles. `complete` is false when Discord won't list everyone.
let ledger = { rows: [], complete: true };

async function refreshLedger() {
  const idsFor = (column) =>
    new Set(
      state.menus
        .filter((menu) => (menu.ledger ?? 'assignment') === column)
        .flatMap((menu) => menu.options.map((o) => o.roleId))
        .filter(Boolean),
    );
  const assignmentIds = idsFor('assignment');
  const roleIds = idsFor('role');
  const hasRoleDropdown = state.menus.some((menu) => menu.ledger === 'role');
  const inRoleColumn = (role) => (hasRoleDropdown ? roleIds.has(role.id) : !assignmentIds.has(role.id));
  const rows = [];
  let complete = true;
  for (const guild of client.guilds.cache.values()) {
    let members;
    try {
      members = [...(await guild.members.list({ limit: 1000 })).values()];
    } catch {
      // Listing everyone needs "Server Members Intent" switched on for the bot in the Developer Portal.
      // Without it, look up just the people the bot already knows: dropdown users and depositors.
      complete = false;
      const known = new Set([...Object.values(state.assigned).flat(), ...state.receipts.map((r) => r.userId)]);
      members = [];
      for (const id of [...known].slice(0, 100)) {
        const member = await guild.members.fetch({ user: id, force: true }).catch(() => null);
        if (member) members.push(member);
      }
    }
    for (const member of members) {
      if (member.user.bot) continue;
      const roles = [...member.roles.cache.values()]
        .filter((role) => role.id !== guild.id)
        .sort((a, b) => b.position - a.position);
      rows.push({
        name: member.displayName,
        username: member.user.username,
        roles: roles.filter(inRoleColumn).map((role) => role.name),
        assignments: roles.filter((role) => assignmentIds.has(role.id)).map((role) => role.name),
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  ledger = { rows, complete };
}

const updateLedger = () => refreshLedger().catch((err) => console.error(`Couldn't refresh the ledger: ${err.message}`));

client.on(Events.GuildCreate, (guild) => guild.commands.set(commands).catch(console.error));

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isAutocomplete()) return await onItemSearch(i);
    if (i.isChatInputCommand() && i.commandName === 'deposit') return await onTransaction(i, 'deposit');
    if (i.isChatInputCommand() && i.commandName === 'retrieve') return await onTransaction(i, 'retrieval');
    if (i.isChatInputCommand() && i.commandName === 'records') return await onRecords(i);
    if (i.isStringSelectMenu() && i.customId.startsWith('menu:pick')) return await onPick(i);
  } catch (err) {
    if (i.isAutocomplete()) return;
    console.error(err);
    const message = { content: `Something went wrong: ${err.message}`, ...ephemeral };
    await (i.replied || i.deferred ? i.followUp(message) : i.reply(message)).catch(() => {});
  }
});

/** Suggests items from the list set up on the web panel as the user types. */
async function onItemSearch(i) {
  const typed = i.options.getFocused().toLowerCase();
  // Retrieval also offers items that were taken off the list but still have some left.
  const items = i.commandName === 'retrieve'
    ? [...new Set([...state.deposit.items, ...depositTotals().filter((t) => t.quantity > 0).map((t) => t.item)])]
    : state.deposit.items;
  const matches = items.filter((item) => item.toLowerCase().includes(typed));
  await i.respond(matches.slice(0, 25).map((item) => ({ name: item, value: item })));
}

const fill = (template, values) => template.replace(/\{(user|item|quantity)\}/g, (_, key) => values[key]);

/** Moderators (who can use /records) hold one of the moderator roles; server managers always count. */
function isModerator(member) {
  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    state.moderation.roleIds.some((id) => member.roles.cache.has(id))
  );
}

function moderatorsOnly(i) {
  const roles = state.moderation.roleIds.map((id) => `<@&${id}>`).join(', ');
  return i.reply({
    content: roles ? `Only moderators can use this. You need one of: ${roles}` : 'Only server managers can use this.',
    ...ephemeral,
  });
}

/** Handles /deposit and /retrieve: records the receipt, answers privately, and posts it in the receipt channel. */
async function onTransaction(i, type) {
  const retrieval = type === 'retrieval';
  if (retrieval) {
    // /retrieve has its own role list; people who can manage the server can always retrieve.
    const roleIds = state.deposit.retrieveRoleIds;
    const allowed =
      i.member.permissions.has(PermissionFlagsBits.ManageGuild) || roleIds.some((id) => i.member.roles.cache.has(id));
    if (!allowed) {
      const roles = roleIds.map((id) => `<@&${id}>`).join(', ');
      return i.reply({
        content: roles ? `You need one of these roles to retrieve: ${roles}` : 'Only server managers can retrieve.',
        ...ephemeral,
      });
    }
  } else {
    const { roleId } = state.deposit;
    if (roleId && !i.member.roles.cache.has(roleId)) {
      return i.reply({ content: `You need the <@&${roleId}> role to deposit.`, ...ephemeral });
    }
  }

  const typed = i.options.getString('item', true).trim().toLowerCase();
  // An item taken off the list can still be retrieved while some of it is left.
  const known = retrieval ? [...state.deposit.items, ...depositTotals().map((total) => total.item)] : state.deposit.items;
  const item = known.find((name) => name.toLowerCase() === typed);
  if (!item) {
    return i.reply({ content: "That item isn't on the list. Pick one of the suggestions.", ...ephemeral });
  }
  const quantity = i.options.getInteger('quantity', true);

  if (retrieval) {
    const available = depositTotals().find((total) => total.item === item)?.quantity ?? 0;
    if (quantity > available) {
      return i.reply({
        content: `There ${available === 1 ? 'is' : 'are'} only ${available.toLocaleString('en-US')} × ${item} to retrieve.`,
        ...ephemeral,
      });
    }
  }

  const name = i.member?.displayName ?? i.user.username;
  const at = new Date();
  state.receipts.push({ at: at.toISOString(), userId: i.user.id, name, type, item, quantity });
  save();

  const template = retrieval ? state.deposit.retrievalReply : state.deposit.reply;
  const reply = fill(template ?? '', { user: name, item, quantity }) || (retrieval ? 'Retrieved.' : 'Thank you!');
  await i.reply({ content: reply, ...ephemeral });

  const channel = client.channels.cache.get(state.deposit.channelId);
  if (channel?.isSendable()) {
    await channel
      .send({
        // <t:…:f> is shown by Discord as a date and time in each reader's own time zone
        content: `**${name}** (${i.user}) ${retrieval ? 'retrieved' : 'deposited'} **${quantity} × ${item}** on <t:${Math.floor(at / 1000)}:f>`,
        allowedMentions: { parse: [] },
      })
      .catch((err) => console.error(`Couldn't post the receipt: ${err.message}`));
  }
}

async function onRecords(i) {
  if (!isModerator(i.member)) return moderatorsOnly(i);

  // Every item on the list, including ones nobody has deposited yet, plus removed items that still have receipts.
  const totals = depositTotals();
  const counted = new Set(totals.map((total) => total.item));
  for (const item of state.deposit.items) {
    if (!counted.has(item)) totals.push({ item, quantity: 0, deposited: 0, retrieved: 0 });
  }

  const at = Math.floor(Date.now() / 1000);
  const number = (value) => value.toLocaleString('en-US');
  const lines = [`**Records** as of <t:${at}:f>`];
  for (const [index, { item, quantity, deposited, retrieved }] of totals.entries()) {
    const line = `• **${item}**: ${number(quantity)} (deposited ${number(deposited)}, retrieved ${number(retrieved)})`;
    // Discord messages stop at 2000 characters.
    if (lines.join('\n').length + line.length > 1900) {
      lines.push(`…and ${totals.length - index} more items. The full list is on the website.`);
      break;
    }
    lines.push(line);
  }
  if (!totals.length) lines.push('No items have been set up yet.');
  await i.reply({ content: lines.join('\n'), ...ephemeral });

  const channel = client.channels.cache.get(state.moderation.recordsChannelId);
  if (channel?.isSendable()) {
    const name = i.member?.displayName ?? i.user.username;
    await channel
      .send({ content: `**${name}** (${i.user}) printed the records on <t:${at}:f>`, allowedMentions: { parse: [] } })
      .catch((err) => console.error(`Couldn't post the records notice: ${err.message}`));
  }
}

async function onPick(i) {
  // Dropdowns posted before there were several of them carry no id; they belong to the first one.
  const menuId = i.customId.split(':')[2];
  const menu = menuId ? findMenu(menuId) : state.menus[0];
  const option = menu?.options.find((o) => o.label === i.values[0]);
  if (!option) return i.reply({ content: 'That option no longer exists.', ...ephemeral });
  if (!option.roleId) {
    return i.reply({ content: option.reply || `You picked **${option.label}**.`, ...ephemeral });
  }

  const role = i.guild.roles.cache.get(option.roleId);
  if (!role) return i.reply({ content: "That option's role doesn't exist in this server.", ...ephemeral });

  // Picking a role you already have gives it back and frees the slot.
  const has = i.member.roles.cache.has(role.id);
  const holders = new Set(state.assigned[role.id]);
  if (!has && option.limit && !holders.has(i.user.id) && holders.size >= option.limit) {
    return i.reply({ content: `${role} is full — all ${option.limit} spots are taken.`, ...ephemeral });
  }

  // Claim or release the slot before the Discord call so two people can't take the last one.
  const before = [...holders];
  if (has) holders.delete(i.user.id);
  else holders.add(i.user.id);
  state.assigned[role.id] = [...holders];

  await i.deferUpdate();
  try {
    await (has ? i.member.roles.remove(role) : i.member.roles.add(role));
  } catch (err) {
    state.assigned[role.id] = before;
    return i.followUp({
      content: `I couldn't change ${role} (${err.message}). I need the Manage Roles permission, and my own role has to sit above ${role} in the server's role list.`,
      ...ephemeral,
    });
  }
  save();
  updateLedger();
  // Refresh the spot counts; the message text stays as it was posted.
  await i.editReply({ components: menuMessage(menu).components });
  return i.followUp({
    content: has ? `Removed ${role} from you.` : option.reply || `You now have ${role}.`,
    ...ephemeral,
  });
}

/** Makes the copies of a dropdown already posted in Discord match its saved version; returns how many were updated. */
async function refreshPosted(menu) {
  const message = menuMessage(menu);
  const kept = [];
  let updated = 0;
  for (const post of state.posted) {
    if (post.menuId !== menu.id) {
      kept.push(post);
      continue;
    }
    const channel = client.channels.cache.get(post.channelId);
    try {
      // A post sent with its own message text keeps that text.
      await channel.messages.edit(post.messageId, post.custom ? { components: message.components } : message);
      updated++;
      kept.push(post);
    } catch (err) {
      // Forget posts whose channel or message was deleted (10008 = Unknown Message).
      if (channel && err.code !== 10008) kept.push(post);
    }
  }
  state.posted = kept;
  save();
  return updated;
}

/** Deletes the Discord messages a dropdown was posted in; returns how many were deleted. */
async function deletePosted(menuId) {
  let deleted = 0;
  for (const post of state.posted.filter((p) => p.menuId === menuId)) {
    try {
      await client.channels.cache.get(post.channelId).messages.delete(post.messageId);
      deleted++;
    } catch {
      // Already gone, or the bot can no longer reach that channel.
    }
  }
  state.posted = state.posted.filter((p) => p.menuId !== menuId);
  save();
  return deleted;
}

client.login(DISCORD_TOKEN);
