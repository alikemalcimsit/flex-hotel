/*
 * HotelOS web chat balonu.
 *
 * Otelin sitesine gömülür:
 *   <script src="https://API_ADRESI/webchat/widget.js" data-key="GENEL_ANAHTAR" async></script>
 *
 * Bağımlılığı yok (socket.io istemcisi API sunucusundan yüklenir). Arayüz
 * Shadow DOM içinde: sitenin stilleri balonu, balonun stilleri siteyi bozmaz.
 * Metinler yalnızca `textContent` ile basılır (HTML olarak yorumlanmaz).
 * Oturum token'ı tarayıcıda saklanır; sayfa yenilense de konuşma sürer.
 * Gönderilemeyen mesaj bağlantı gelince aynı kimlikle yeniden gönderilir;
 * sunucu aynı kimliği ikinci kez yazmaz.
 */
(function hotelosWebchat() {
  'use strict';

  var script = document.currentScript;
  if (!script || !script.dataset || !script.dataset.key) return;
  if (window.__hotelosWebchat) return; // aynı sayfaya iki kez gömülürse
  window.__hotelosWebchat = true;

  var KEY = script.dataset.key;
  var API = new URL(script.src, window.location.href).origin;
  var STORAGE = 'hotelos-webchat:' + KEY;
  var MAX_LENGTH = 2000;
  var tr = /^tr\b/i.test(navigator.language || '');
  var TEXT = tr
    ? { open: 'Sohbeti aç', close: 'Kapat', placeholder: 'Mesajınızı yazın…', send: 'Gönder', sending: 'gönderiliyor', failed: 'gönderilemedi, tekrar denenecek', offline: 'Bağlantı yok; mesajlarınız bağlantı gelince gönderilecek.', typing: 'yazıyor…', unavailable: 'Sohbet şu anda kullanılamıyor.', slow: 'çok hızlı yazıyorsunuz; biraz bekleyin', rejected: 'gönderilemedi' }
    : { open: 'Open chat', close: 'Close', placeholder: 'Type your message…', send: 'Send', sending: 'sending', failed: 'not sent, will retry', offline: 'Offline; your messages will be sent when the connection is back.', typing: 'typing…', unavailable: 'Chat is not available right now.', slow: 'too fast; please wait a moment', rejected: 'not sent' };

  function storageGet() {
    try {
      return window.localStorage.getItem(STORAGE);
    } catch (e) {
      return null;
    }
  }
  function storageSet(value) {
    try {
      window.localStorage.setItem(STORAGE, value);
    } catch (e) {
      /* gizli pencere: oturum sayfa ömrü kadar */
    }
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  /* ─────────────── Arayüz ─────────────── */

  var host = document.createElement('div');
  host.setAttribute('data-hotelos-webchat', '');
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.btn{width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:var(--accent,#0f766e);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);display:grid;place-items:center;position:relative}',
    '.btn:focus-visible,.send:focus-visible,.x:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 5px var(--accent,#0f766e)}',
    '.badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#dc2626;color:#fff;font-size:12px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px}',
    '.panel{position:absolute;right:0;bottom:72px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;color:#111}',
    '.panel.open{display:flex}',
    '.head{background:var(--accent,#0f766e);color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.title{font-weight:700;font-size:15px;margin:0}',
    '.x{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:8px}',
    '.list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f7f8}',
    '.msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}',
    '.msg.in{align-self:flex-end;background:var(--accent,#0f766e);color:#fff;border-bottom-right-radius:4px}',
    '.msg.out{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}',
    '.meta{font-size:11px;opacity:.75;margin-top:3px}',
    '.typing{font-size:12px;color:#6b7280;padding:0 16px 6px;min-height:18px}',
    '.note{font-size:12px;color:#92400e;background:#fef3c7;padding:6px 12px;display:none}',
    'form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}',
    'textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font-size:14px;max-height:120px;min-height:40px}',
    'textarea:focus{outline:2px solid var(--accent,#0f766e);border-color:transparent}',
    '.send{border:0;border-radius:10px;background:var(--accent,#0f766e);color:#fff;font-weight:700;padding:0 14px;cursor:pointer}',
    '.send:disabled{opacity:.5;cursor:default}',
    '@media (max-width:480px){.panel{position:fixed;inset:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0;bottom:0}}',
  ].join('\n');
  root.appendChild(style);

  var button = document.createElement('button');
  button.className = 'btn';
  button.type = 'button';
  button.setAttribute('aria-label', TEXT.open);
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var badge = document.createElement('span');
  badge.className = 'badge';
  button.appendChild(badge);

  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  var head = document.createElement('div');
  head.className = 'head';
  var title = document.createElement('p');
  title.className = 'title';
  title.textContent = '…';
  var close = document.createElement('button');
  close.className = 'x';
  close.type = 'button';
  close.setAttribute('aria-label', TEXT.close);
  close.textContent = '×';
  head.appendChild(title);
  head.appendChild(close);
  var note = document.createElement('div');
  note.className = 'note';
  note.setAttribute('role', 'status');
  var list = document.createElement('div');
  list.className = 'list';
  list.setAttribute('aria-live', 'polite');
  var typing = document.createElement('div');
  typing.className = 'typing';
  var form = document.createElement('form');
  var input = document.createElement('textarea');
  input.rows = 1;
  input.maxLength = MAX_LENGTH;
  input.placeholder = TEXT.placeholder;
  input.setAttribute('aria-label', TEXT.placeholder);
  var send = document.createElement('button');
  send.className = 'send';
  send.type = 'submit';
  send.textContent = TEXT.send;
  form.appendChild(input);
  form.appendChild(send);
  panel.appendChild(head);
  panel.appendChild(note);
  panel.appendChild(list);
  panel.appendChild(typing);
  panel.appendChild(form);
  root.appendChild(panel);
  root.appendChild(button);

  var state = { open: false, unread: 0, greeting: null, rendered: {}, pending: [], socket: null, seen: {} };

  function setOpen(open) {
    state.open = open;
    panel.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      state.unread = 0;
      renderBadge();
      input.focus();
      reportSeen();
      list.scrollTop = list.scrollHeight;
    } else {
      button.focus();
    }
  }
  function renderBadge() {
    badge.style.display = state.unread > 0 ? 'flex' : 'none';
    badge.textContent = state.unread > 9 ? '9+' : String(state.unread);
  }
  function timeOf(at) {
    try {
      return new Date(at).toLocaleTimeString(navigator.language || 'tr', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }
  /** @param {{ id: string, author: string, text: string, at: string }} message @param {string} [status] */
  function bubble(message, status) {
    var el = document.createElement('div');
    el.className = 'msg ' + (message.author === 'GUEST' ? 'in' : 'out');
    var body = document.createElement('div');
    body.textContent = message.text;
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = status || timeOf(message.at);
    el.appendChild(body);
    el.appendChild(meta);
    return el;
  }
  function append(message, status) {
    if (state.rendered[message.id]) return state.rendered[message.id];
    var el = bubble(message, status);
    state.rendered[message.id] = el;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    return el;
  }
  function showGreeting() {
    if (state.greeting && list.childElementCount === 0) append({ id: 'greeting', author: 'AI', text: state.greeting, at: new Date().toISOString() });
  }
  function reportSeen() {
    if (!state.open || !state.socket || !state.socket.connected) return;
    var ids = Object.keys(state.seen).filter(function (id) { return state.seen[id] === false; });
    if (!ids.length) return;
    ids.forEach(function (id) { state.seen[id] = true; });
    state.socket.emit('seen', { messageIds: ids.slice(0, 100) });
  }
  function received(message) {
    append(message);
    if (message.author !== 'GUEST' && state.seen[message.id] === undefined) {
      state.seen[message.id] = false;
      if (!state.open) {
        state.unread += 1;
        renderBadge();
      }
    }
    reportSeen();
  }
  function flushPending() {
    if (!state.socket || !state.socket.connected) return;
    state.pending.forEach(function (item) {
      state.socket.emit('send', { clientMessageId: item.clientMessageId, text: item.text });
    });
  }

  button.addEventListener('click', function () { setOpen(!state.open); });
  close.addEventListener('click', function () { setOpen(false); });
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setOpen(false);
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim().slice(0, MAX_LENGTH);
    if (!text) return;
    input.value = '';
    var item = { clientMessageId: uuid(), text: text };
    item.el = append({ id: 'local-' + item.clientMessageId, author: 'GUEST', text: text, at: new Date().toISOString() }, TEXT.sending);
    state.pending.push(item);
    if (state.socket && state.socket.connected) state.socket.emit('send', { clientMessageId: item.clientMessageId, text: item.text });
  });

  /* ─────────────── Bağlantı ─────────────── */

  function connect() {
    var socket = window.io(API + '/webchat', {
      auth: { key: KEY, token: storageGet() },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10000,
    });
    state.socket = socket;

    socket.on('connect', function () {
      note.style.display = 'none';
      flushPending();
    });
    socket.on('disconnect', function () {
      note.textContent = TEXT.offline;
      note.style.display = 'block';
    });
    socket.on('connect_error', function (error) {
      if (error && error.data && error.data.code === 'CHAT_DISABLED') {
        note.textContent = TEXT.unavailable;
        note.style.display = 'block';
        socket.disconnect();
      }
    });
    socket.on('session', function (data) {
      if (data && data.token) storageSet(data.token);
    });
    socket.on('config', function (config) {
      if (!config) return;
      title.textContent = config.title || '';
      panel.setAttribute('aria-label', config.title || 'Chat');
      if (/^#[0-9a-fA-F]{6}$/.test(config.accentColor || '')) host.style.setProperty('--accent', config.accentColor);
      state.greeting = config.greeting || null;
      showGreeting();
    });
    socket.on('history', function (data) {
      (data && data.messages ? data.messages : []).forEach(received);
      showGreeting();
    });
    socket.on('message', received);
    socket.on('typing', function (data) {
      typing.textContent = data && data.on ? TEXT.typing : '';
    });
    socket.on('ack', function (ack) {
      var index = -1;
      for (var i = 0; i < state.pending.length; i += 1) {
        if (state.pending[i].clientMessageId === ack.clientMessageId) index = i;
      }
      if (index < 0) return;
      var item = state.pending[index];
      var meta = item.el && item.el.querySelector('.meta');
      if (ack.error) {
        // Sunucu metni Türkçe; misafire kendi dilinde, koda göre.
        if (meta) meta.textContent = ack.code === 'RATE_LIMITED' ? TEXT.slow : TEXT.rejected;
        state.pending.splice(index, 1);
        return;
      }
      state.pending.splice(index, 1);
      if (meta) meta.textContent = timeOf(new Date().toISOString());
      if (ack.id) state.rendered[ack.id] = item.el;
    });
    socket.on('chat-error', function (data) {
      note.textContent = (data && data.message) || TEXT.unavailable;
      note.style.display = 'block';
    });
  }

  function loadClient() {
    if (window.io) return connect();
    var client = document.createElement('script');
    client.src = API + '/socket.io/socket.io.min.js';
    client.async = true;
    client.onload = connect;
    client.onerror = function () {
      note.textContent = TEXT.unavailable;
      note.style.display = 'block';
    };
    document.head.appendChild(client);
  }

  loadClient();
})();
