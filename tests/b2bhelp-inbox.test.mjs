import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chatKey, chatPreview, dedupeChats, displayName, isOutgoing, isUnread, listFromEnvelope, messageList, orderMessages, readableMessage } from '../b2bhelp-inbox-core.mjs';

test('inbox keys chats by account and chat, preventing cross-account collisions', () => {
  assert.equal(chatKey({ id: 8, account: { id: 2 } }), '2:8');
  assert.equal(chatKey({ id: 8, account_id: 3 }), '3:8');
  assert.notEqual(chatKey({ id: 8, account_id: 2 }), chatKey({ id: 8, account_id: 3 }));
  assert.equal(chatKey({ id: 8 }), '');
  assert.equal(dedupeChats([{ id: 8, account_id: 2 }, { id: 8, account_id: 2 }, { id: 8, account_id: 3 }]).length, 2);
});

test('inbox safely normalizes payloads and unread messages', () => {
  assert.deepEqual(listFromEnvelope({ chats: [{ id: 1 }, null] }, 'chats'), [{ id: 1 }]);
  assert.deepEqual(listFromEnvelope({ chats: {} }, 'chats'), []);
  assert.deepEqual(messageList({ result: { messages: [{ text: 'Hi' }] } }), [{ text: 'Hi' }]);
  assert.deepEqual(orderMessages([{ id: 'later', created_at: '2026-10-06T12:02:00Z' }, { id: 'first', created_at: '2026-10-06T12:01:00Z' }]).map(m => m.id), ['first', 'later']);
  assert.equal(readableMessage({ content: { text: ' Hello ' } }), 'Hello');
  assert.equal(readableMessage({ attachments: [{}] }), 'Вложение');
  assert.equal(displayName({ recipient: { name: 'Анна' } }), 'Анна');
  assert.equal(chatPreview({ last_message: { text: 'Вопрос' } }), 'Вопрос');
  assert.equal(isUnread({ is_unread: true }), true);
  assert.equal(isOutgoing({ direction: 'sent' }), true);
});

test('CRM inbox stays B2BHelp-only, manual, and renders remote text safely', () => {
  const source = fs.readFileSync(new URL('../b2bhelp-inbox.js', import.meta.url), 'utf8');
  assert.match(source, /https:\/\/remontcompsbp\.ru\/api/);
  assert.doesNotMatch(source, /api\.avito\.ru|AVITO_CLIENT_ID|AVITO_CLIENT_SECRET/i);
  assert.doesNotMatch(source, /setInterval\s*\(|addEventListener\(['"](?:online|focus).*refreshInbox/);
  assert.match(source, /n\.textContent\s*=\s*text/);
  assert.match(source, /await cloud\.saveB2BLead\?\.\(leadRecord\(chat\)\)/);
  assert.match(source, /data-b2b-stage/);
  assert.match(source, /data-b2b-master/);
  assert.match(source, /data-b2b-note/);
  assert.match(source, /selectionEpoch/);
  assert.match(source, /credentials:\s*'omit'/);
  assert.match(source, /orderId:\s*state\.currentLead\?\.orderId/);
  assert.match(source, /MASTER_AI_OPEN_ORDER_FROM_B2B/);
  assert.match(source, /if \(chatKey\(chat\) !== chatKey\(state\.selected\)\) panel\.querySelector\('\[data-b2b-input\]'\)\.value = ''/);
  for (const file of ['index.html','dispatcher-logistic.html','master.html']) {
    const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /name:clean\(lead\?\.name\?\?old\.name,160\)/);
    assert.match(html, /advertTitle:clean\(lead\?\.advertTitle\?\?old\.advertTitle,200\)/);
    assert.match(html, /preview:clean\(lead\?\.preview\?\?old\.preview,500\)/);
  }
  assert.match(source, /\.finally\(\(\) => \{ hookSession\(\); accessChanged\(\); \}\)/);
});
