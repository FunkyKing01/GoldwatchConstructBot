import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { state } from './store.js';

export const PRESENCES = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  invisible: 'Invisible',
};

/** The Discord message for one saved dropdown. */
export function menuMessage(menu) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`menu:pick:${menu.id}`)
    .setPlaceholder(menu.placeholder)
    .addOptions(
      menu.options.map((o) => {
        const taken = state.assigned[o.roleId]?.length ?? 0;
        const slots = o.roleId && o.limit ? `${Math.min(taken, o.limit)}/${o.limit} taken` : '';
        const description = [o.description, slots].filter(Boolean).join(' · ').slice(0, 100);
        return { label: o.label, value: o.label, description: description || undefined };
      }),
    );
  return { content: menu.prompt || undefined, components: [new ActionRowBuilder().addComponents(select)] };
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

/** Trims a dropdown from the web panel down to what Discord accepts: 25 options with unique labels. */
export function cleanMenu({ name, prompt, placeholder, options, ledger }) {
  const seen = new Set();
  const cleaned = [];
  for (const o of Array.isArray(options) ? options : []) {
    const label = text(o?.label, 100);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const roleId = /^\d{17,20}$/.test(o.roleId) ? o.roleId : '';
    // limit: how many people may hold the role through the dropdown; 0 means no limit
    const limit = roleId ? Math.min(Math.max(Math.trunc(Number(o.limit)) || 0, 0), 100000) : 0;
    cleaned.push({ label, description: text(o.description, 100), reply: text(o.reply, 2000), roleId, limit });
  }
  return {
    name: text(name, 80) || 'Untitled dropdown',
    prompt: text(prompt, 300),
    placeholder: text(placeholder, 150) || 'Pick an option',
    options: cleaned.slice(0, 25),
    // which Ledger column this dropdown's roles appear under: 'role', 'assignment' or 'none'
    ledger: ['role', 'assignment', 'none'].includes(ledger) ? ledger : 'assignment',
  };
}
