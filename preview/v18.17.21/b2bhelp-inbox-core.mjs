export function listFromEnvelope(payload, key) {
  const list = payload?.[key];
  return Array.isArray(list) ? list.filter(item => item && typeof item === 'object') : [];
}

export function chatKey(chat) {
  const chatId = String(chat?.id ?? '').trim();
  const accountId = String(chat?.account?.id ?? chat?.account_id ?? '').trim();
  if (!chatId || !/^\d+$/.test(accountId)) return '';
  return `${accountId}:${chatId}`;
}

export function dedupeChats(chats) {
  const byKey = new Map();
  for (const chat of chats) {
    const key = chatKey(chat);
    if (key && !byKey.has(key)) byKey.set(key, chat);
  }
  return [...byKey.values()];
}

export function messageList(payload) {
  const result = payload?.result;
  if (Array.isArray(result)) return result.filter(item => item && typeof item === 'object');
  if (Array.isArray(result?.messages)) return result.messages.filter(item => item && typeof item === 'object');
  return [];
}

export function orderMessages(messages) {
  const timed = messages.map((message, index) => ({ message, index, time: messageTime(message) }));
  if (timed.some(item => item.time == null)) return messages;
  return timed.sort((a, b) => a.time - b.time || a.index - b.index).map(item => item.message);
}

function messageTime(message) {
  const value = message?.created_at ?? message?.createdAt ?? message?.date ?? message?.time;
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const number = Number(value);
    return Number.isFinite(number) ? (number < 1e12 ? number * 1000 : number) : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readableMessage(message) {
  for (const value of [message?.text, message?.message, message?.content]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && typeof value.text === 'string' && value.text.trim()) return value.text.trim();
  }
  if (message?.attachments || message?.files) return 'Вложение';
  return '';
}

export function displayName(chat) {
  const recipient = chat?.recipient;
  const name = typeof recipient === 'string' ? recipient : recipient?.name ?? recipient?.title;
  return String(name || chat?.advert?.title || 'Клиент').trim().slice(0, 160) || 'Клиент';
}

export function chatPreview(chat) {
  const message = chat?.last_message;
  return readableMessage(message && typeof message === 'object' ? message : { text: message }) || 'Откройте диалог';
}

export function isUnread(chat) {
  return chat?.is_unread === true;
}

export function isOutgoing(message) {
  return message?.is_outgoing === true || message?.is_me === true ||
    ['outgoing', 'out', 'sent', 'operator'].includes(String(message?.direction ?? message?.type ?? '').toLowerCase());
}
