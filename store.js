import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('./state.json', import.meta.url);

export const newId = () => randomBytes(6).toString('hex');

const defaults = {
  presence: 'online',
  // roleId -> user IDs who got that role from a dropdown; counted against an option's limit
  assigned: {},
  // dropdown messages sent to Discord, so saving a dropdown can update them
  posted: [],
  // the /deposit command: allowed items, the reply to the depositor, and the channel receipts go to
  deposit: {
    items: ['Example item'],
    reply: 'Thank you! Your deposit of {quantity} × {item} went through.',
    retrievalReply: 'You have retrieved {quantity} × {item}.',
    channelId: '',
    // roles that may use /deposit; none listed means anyone. Moderators always can.
    roleIds: [],
    // roles that may use /retrieve; people who can manage the server always can
    retrieveRoleIds: [],
  },
  // /records is for moderators: members with one of these roles, plus anyone who can manage the server.
  // recordsChannelId is the channel told when someone uses /records.
  moderation: { roleIds: [], recordsChannelId: '' },
  // every completed /deposit or /retrieve: { at, userId, name, type, item, quantity }; no type means a deposit
  receipts: [],
  // every sign-in attempt on the website: { at, name, result } where result is 'admin', 'viewer' or 'wrong'
  logins: [],
  menus: [
    {
      id: newId(),
      name: 'My first dropdown',
      prompt: 'Choose one:',
      placeholder: 'Pick an option',
      options: [
        { label: 'Option A', description: 'The first choice', reply: 'You picked A.', roleId: '', limit: 0 },
        { label: 'Option B', description: 'The second choice', reply: 'You picked B.', roleId: '', limit: 0 },
      ],
    },
  ],
};

const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

// Earlier versions kept a single dropdown under `menu`; carry it and its posts over.
if (saved.menu && !saved.menus) {
  const id = newId();
  saved.menus = [{ id, name: 'Dropdown 1', ...saved.menu }];
  saved.posted = (saved.posted ?? []).map((post) => ({ ...post, menuId: id }));
}
delete saved.menu;

// /records used to have its own role list; those roles become the moderator roles.
if (saved.records && !saved.moderation) {
  saved.moderation = { roleIds: saved.records.roleIds ?? [], recordsChannelId: saved.records.channelId ?? '' };
}
delete saved.records;

export const state = { ...defaults, ...saved };

// /retrieve used to follow the moderator roles; keep those people able to retrieve.
state.deposit.retrieveRoleIds ??= [...state.moderation.roleIds];

// /deposit used to allow a single role (roleId); it is now a list.
state.deposit.roleIds ??= state.deposit.roleId ? [state.deposit.roleId] : [];
delete state.deposit.roleId;

export const save = () => writeFileSync(FILE, JSON.stringify(state, null, 2));

/** Adds up every receipt per item, largest first. `quantity` is what is left: deposited minus retrieved. */
export function depositTotals() {
  const totals = new Map();
  for (const { item, quantity, type } of state.receipts) {
    const total = totals.get(item) ?? { item, quantity: 0, deposited: 0, retrieved: 0 };
    if (type === 'retrieval') total.retrieved += quantity;
    else total.deposited += quantity;
    total.quantity = total.deposited - total.retrieved;
    totals.set(item, total);
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity);
}

export const findMenu =(id) => state.menus.find((menu) => menu.id === id);

/** Records a posted dropdown. `custom` means it was sent with its own message text. Keeps the latest 200. */
export function rememberPost(message, menuId, custom) {
  const post = { channelId: message.channelId, messageId: message.id, menuId, custom };
  state.posted = [...state.posted, post].slice(-200);
  save();
}
