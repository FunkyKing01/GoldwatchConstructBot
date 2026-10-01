import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { depositTotals, findMenu, newId, rememberPost, save, state } from './store.js';
import { PRESENCES, cleanMenu, menuMessage } from './ui.js';

const PAGE = new URL('./panel.html', import.meta.url);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = (value) => createHash('sha256').update(String(value)).digest();

const snowflake = (value) => /^\d{17,20}$/.test(value);

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Expected JSON.', 415);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65536) throw fail('Request too large.', 413);
  }
  try {
    return JSON.parse(raw || '{}') ?? {};
  } catch {
    throw fail('Invalid JSON.');
  }
}

/**
 * Serves the web control panel. `bot` is the small set of things the panel may do
 * with Discord: info(), setStatus(presence), send(channelId, payload), refreshPosted(menu), deletePosted(menuId) and ledger().
 */
export function startPanel(bot, { host = '127.0.0.1', port = 3000, password, viewPassword }) {
  // Read once, so the page always matches the code this copy of the bot is running.
  // 'build' identifies this version of the page, so a browser tab left open across an update can reload itself.
  const source = readFileSync(PAGE, 'utf8');
  const build = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const page = source.replace('__BUILD__', build);
  // With no password the panel is open, which is only allowed for this computer (see the Host check below).
  const open = !password;
  const secret = digest(password);
  // An optional second password that only lets people look at Receipts and Totals.
  const viewSecret = viewPassword ? digest(viewPassword) : null;
  // session id -> 'admin' or 'viewer'
  const sessions = new Map();

  const deliver = async (channelId, payload) => {
    try {
      return await bot.send(String(channelId), payload);
    } catch (err) {
      throw fail(`Couldn't send: ${err.message}`, 502);
    }
  };

  const api = {
    'GET /api/state': () => ({
      ...bot.info(),
      role: 'admin',
      build,
      open,
      presence: state.presence,
      menus: state.menus,
      presences: PRESENCES,
      deposit: state.deposit,
      moderation: state.moderation,
      receipts: state.receipts.slice(-1000).reverse(),
      totals: depositTotals(),
      logins: state.logins.slice(-500).reverse(),
      ledger: bot.ledger(),
    }),

    'POST /api/deposit': ({ items, reply, retrievalReply, channelId, roleId, retrieveRoleIds }) => {
      const names = new Map();
      for (const item of Array.isArray(items) ? items : []) {
        const name = String(item ?? '').trim().slice(0, 100);
        if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
      }
      state.deposit = {
        items: [...names.values()].slice(0, 500),
        reply: String(reply ?? '').trim().slice(0, 1500),
        retrievalReply: String(retrievalReply ?? '').trim().slice(0, 1500),
        // deposits and retrievals are both posted here
        channelId: /^\d{17,20}$/.test(channelId) ? channelId : '',
        // only members with this role may use /deposit; empty means anyone
        roleId: /^\d{17,20}$/.test(roleId) ? roleId : '',
        retrieveRoleIds: [...new Set(Array.isArray(retrieveRoleIds) ? retrieveRoleIds.filter(snowflake) : [])],
      };
      save();
      return { deposit: state.deposit };
    },

    'POST /api/moderation': ({ roleIds, recordsChannelId }) => {
      state.moderation = {
        roleIds: [...new Set(Array.isArray(roleIds) ? roleIds.filter(snowflake) : [])],
        recordsChannelId: snowflake(recordsChannelId) ? recordsChannelId : '',
      };
      save();
      return { moderation: state.moderation };
    },

    'POST /api/settings': ({ presence }) => {
      if (!Object.hasOwn(PRESENCES, presence)) throw fail('Unknown status.');
      state.presence = presence;
      bot.setStatus(presence);
      save();
    },

    // Saves a dropdown: updates the one with this id, or adds a new one when the id is missing or unknown.
    'POST /api/menu': async (body) => {
      const cleaned = cleanMenu(body);
      if (!cleaned.options.length) throw fail('The dropdown needs at least one option with a label.');
      const existing = findMenu(body.id);
      const menu = existing ? Object.assign(existing, cleaned) : { id: newId(), ...cleaned };
      if (!existing) state.menus.push(menu);
      save();
      return { menu, updated: existing ? await bot.refreshPosted(menu) : 0 };
    },

    // Also removes the messages this dropdown was posted in.
    'POST /api/menu/delete': async ({ id }) => {
      state.menus = state.menus.filter((menu) => menu.id !== id);
      save();
      return { deleted: await bot.deletePosted(id) };
    },

    // `text` replaces the dropdown's saved message for this one post.
    'POST /api/post': async ({ channelId, menuId, text }) => {
      const menu = findMenu(menuId);
      if (!menu) throw fail('Save the dropdown first.');
      const content = String(text ?? '').trim();
      if (content.length > 2000) throw fail('Discord messages are limited to 2000 characters.');
      const payload = menuMessage(menu);
      const message = await deliver(channelId, content ? { ...payload, content } : payload);
      rememberPost(message, menu.id, Boolean(content));
    },

    'POST /api/say': async ({ channelId, text }) => {
      const content = String(text ?? '').trim();
      if (!content) throw fail('Type a message first.');
      if (content.length > 2000) throw fail('Discord messages are limited to 2000 characters.');
      await deliver(channelId, { content });
    },
  };

  const server = createServer(async (req, res) => {
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
      res.end(JSON.stringify(body));
    };

    try {
      const route = `${req.method} ${new URL(req.url, 'http://panel').pathname}`;

      if (open) {
        // Without a password, only a browser on this computer that opened the panel itself may use it.
        // Other websites can't pass these checks, so they can't control the bot behind your back.
        const local = [`localhost:${port}`, `127.0.0.1:${port}`];
        const origin = req.headers.origin;
        if (!local.includes(req.headers.host) || (origin && !local.includes(origin.replace('http://', '')))) {
          return json(403, { error: 'The panel can only be opened on the computer running the bot.' });
        }
      }

      if (route === 'GET /') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
        });
        return res.end(page);
      }

      if (route === 'POST /api/login') {
        const { name, password: attempt } = await readJson(req);
        const who = String(name ?? '').trim().slice(0, 60);
        if (!who) return json(400, { error: 'Enter your name first.' });
        const given = digest(attempt);
        const role = timingSafeEqual(given, secret)
          ? 'admin'
          : viewSecret && timingSafeEqual(given, viewSecret) ? 'viewer' : null;
        // Every attempt is kept for the "Logging in" tab; the password itself is never stored.
        state.logins = [...state.logins, { at: new Date().toISOString(), name: who, result: role ?? 'wrong' }].slice(-2000);
        save();
        if (!role) {
          await sleep(1000); // slows down guessing
          return json(401, { error: 'Wrong password.' });
        }
        const id = randomBytes(32).toString('hex');
        sessions.set(id, role);
        // SameSite=Strict keeps other websites from using this session.
        return json(200, { ok: true }, { 'Set-Cookie': `session=${id}; HttpOnly; SameSite=Strict; Path=/` });
      }

      const session = /(?:^|;\s*)session=([0-9a-f]{64})/.exec(req.headers.cookie ?? '')?.[1];
      if (!open && !sessions.has(session)) return json(401, { error: 'Sign in first.' });

      if (route === 'POST /api/logout') {
        sessions.delete(session);
        return json(200, { ok: true }, { 'Set-Cookie': 'session=; Max-Age=0; Path=/' });
      }

      const role = open ? 'admin' : sessions.get(session);
      if (role === 'viewer') {
        // The view-only password gets the receipts and totals and nothing else.
        if (route !== 'GET /api/state') return json(403, { error: 'This password can only view receipts and totals.' });
        const { tag } = bot.info();
        return json(200, {
          role,
          build,
          tag,
          receipts: state.receipts.slice(-1000).reverse(),
          totals: depositTotals(),
          ledger: bot.ledger(),
        });
      }

      if (!Object.hasOwn(api, route)) return json(404, { error: 'Not found.' });
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      return json(200, (await api[route](body)) ?? { ok: true });
    } catch (err) {
      if (!err.status) console.error(err);
      return json(err.status ?? 500, { error: err.message });
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // Two copies would both answer in Discord, and only the older one would serve the website.
      console.error('The bot is already running in another window. Close that window, then start this one again.');
    } else {
      console.error(`Control panel failed to start: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(port, host, () => {
    const listening = server.address().port;
    console.log(
      host === '0.0.0.0'
        ? `Control panel is on port ${listening}: open http://<this server's address>:${listening}`
        : `Control panel: http://localhost:${listening}`,
    );
  });
  return server;
}
