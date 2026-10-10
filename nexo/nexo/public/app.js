const $ = (id) => document.getElementById(id);
const state = {
  ws: null, me: null, servers: [], users: [],
  serverId: null, channelId: null,
  messages: {}, unread: {}, typing: {}, lastTypingSent: 0,
  retry: 0, pendingName: '',
};

const ICONS = {
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24">${ICONS[n]}</svg>`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const initial = (n) => (n || '?').trim()[0].toUpperCase();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
};
const clientId = () => {
  let id = store.get('nexo.cid');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    store.set('nexo.cid', id);
  }
  return id;
};
const hhmm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayKey = (ts) => new Date(ts).toDateString();
const fmtTime = (ts) => {
  const d = new Date(ts), now = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === now.toDateString()) return `Hoje às ${hhmm(ts)}`;
  if (d.toDateString() === y.toDateString()) return `Ontem às ${hhmm(ts)}`;
  return `${d.toLocaleDateString('pt-BR')} ${hhmm(ts)}`;
};
const fmtDay = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ---------- markdown simples e seguro (tudo escapado antes) ---------- */
function mentionize(html) {
  const names = state.users.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return html;
  const me = state.me ? esc(state.me.name).toLowerCase() : '';
  const re = new RegExp('(^|[\\s(])@(' + names.map((n) => reEsc(esc(n))).join('|') + ')(?![\\w])', 'gi');
  return html.replace(re, (m, pre, n) => `${pre}<span class="mention-tag${n.toLowerCase() === me ? ' me' : ''}">@${n}</span>`);
}
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
  return mentionize(s);
}
function render(text) {
  return text.split(/```/).map((p, i) => {
    if (i % 2 === 0) return inline(p);
    const nl = p.indexOf('\n');
    let lang = '', code = p;
    if (nl >= 0 && /^[\w+#-]*$/.test(p.slice(0, nl).trim())) { lang = p.slice(0, nl).trim(); code = p.slice(nl + 1); }
    code = code.replace(/\n$/, '');
    let html = esc(code);
    if (window.hljs) {
      try {
        html = lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
      } catch { /* mantém escapado */ }
    }
    return `<pre><div class="pre-bar"><span>${esc(lang)}</span><button type="button" data-copy>copiar</button></div><code>${html}</code></pre>`;
  }).join('');
}

/* ---------- conexão ---------- */
function connect(name) {
  state.pendingName = name;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, clientId: clientId() }));
  ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    if (state.ws !== ws) return;
    if (state.me) {
      $('banner').classList.remove('hidden');
      state.retry = Math.min(state.retry + 1, 6);
      setTimeout(() => connect(state.me.name), 1000 * state.retry);
    } else {
      loginFail('Não foi possível conectar ao servidor. Tente de novo.');
    }
  };
}
const send = (o) => state.ws && state.ws.readyState === 1 && state.ws.send(JSON.stringify(o));

function loginFail(msg) {
  $('loginError').textContent = msg;
  $('loginBtn').disabled = false;
  $('login').classList.remove('hidden');
}

function handle(m) {
  if (m.t === 'init') {
    state.retry = 0;
    state.me = m.me; state.servers = m.servers; state.users = m.users;
    store.set('nexo.name', m.me.name);
    $('banner').classList.add('hidden');
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    $('meName').textContent = m.me.name;
    const av = $('meAvatar'); av.textContent = initial(m.me.name); av.style.background = m.me.color;
    state.messages = {};
    const stillThere = state.serverId && state.servers.some((s) => s.id === state.serverId);
    if (!stillThere) state.serverId = state.servers[0].id;
    const ch = curServer().channels;
    if (!ch.some((c) => c.id === state.channelId)) state.channelId = ch[0].id;
    renderServers(); renderChannels(); renderMembers(); openChannel(state.channelId);
  }
  if (m.t === 'error') {
    if (!state.me) { state.ws = null; loginFail(m.message); } else toast(m.message);
  }
  if (m.t === 'users') { state.users = m.users; renderMembers(); }
  if (m.t === 'history') { state.messages[m.channel] = m.messages; if (m.channel === state.channelId) renderMessages(true); }
  if (m.t === 'msg') {
    const msg = m.message;
    (state.messages[msg.channel] ||= []).push(msg);
    if (msg.channel === state.channelId) {
      const el = $('messages'), atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      renderMessages(atEnd || msg.authorId === state.me.id);
      delete state.typing[msg.author]; renderTyping();
    } else if (msg.authorId !== state.me.id) {
      state.unread[msg.channel] = (state.unread[msg.channel] || 0) + 1;
      renderChannels(); updateTitle();
    }
  }
  if (m.t === 'delete') {
    const list = state.messages[m.channel];
    if (list) {
      const i = list.findIndex((x) => x.id === m.msgId);
      if (i >= 0) list.splice(i, 1);
      if (m.channel === state.channelId) renderMessages(false);
    }
  }
  if (m.t === 'channel') {
    const s = state.servers.find((x) => x.id === m.server);
    if (s && !s.channels.some((c) => c.id === m.channel.id)) { s.channels.push(m.channel); if (s.id === state.serverId) renderChannels(); }
  }
  if (m.t === 'typing' && m.channel === state.channelId) {
    state.typing[m.name] = Date.now() + 3000; renderTyping();
    setTimeout(renderTyping, 3100);
  }
}

/* ---------- render ---------- */
const curServer = () => state.servers.find((s) => s.id === state.serverId);

function updateTitle() {
  const n = Object.values(state.unread).reduce((a, b) => a + b, 0);
  document.title = n ? `(${n}) Nexo` : 'Nexo';
}
function renderServers() {
  $('servers').innerHTML =
    '<div class="srv home" title="Nexo">N</div><div class="sep"></div>' +
    state.servers.map((s) =>
      `<button class="srv ${s.id === state.serverId ? 'active' : ''}" data-srv="${esc(s.id)}" title="${esc(s.name)}" aria-label="${esc(s.name)}">${esc(s.icon)}</button>`).join('');
}
function renderChannels() {
  const s = curServer();
  $('serverName').textContent = s.name;
  $('channelList').innerHTML =
    `<div class="cat"><span>Canais de texto</span><button data-newch title="Criar canal" aria-label="Criar canal">${ico('plus')}</button></div>` +
    s.channels.map((c) => {
      const u = state.unread[c.id];
      return `<button class="ch ${c.id === state.channelId ? 'active' : ''} ${u ? 'unread' : ''}" data-ch="${esc(c.id)}">` +
        `${ico('hash')}<span class="n">${esc(c.name)}</span>${u ? `<span class="badge">${u > 99 ? '99+' : u}</span>` : ''}</button>`;
    }).join('');
}
function renderMembers() {
  $('onlineCount').textContent = state.users.length;
  $('memberList').innerHTML = state.users.map((u) =>
    `<div class="member"><div class="avatar-wrap"><div class="avatar" style="background:${esc(u.color)}">${esc(initial(u.name))}</div><span class="dot"></span></div><span class="nm">${esc(u.name)}</span></div>`).join('');
}
function renderTyping() {
  const now = Date.now();
  const names = Object.keys(state.typing).filter((n) => state.typing[n] > now);
  $('typing').textContent = names.length
    ? (names.length > 2 ? 'Várias pessoas estão digitando...' : `${names.join(' e ')} ${names.length > 1 ? 'estão' : 'está'} digitando...`)
    : '';
}
function renderMessages(scroll) {
  const list = state.messages[state.channelId];
  const box = $('messages');
  const ch = curServer().channels.find((c) => c.id === state.channelId);
  if (!list) { box.innerHTML = ''; return; }
  const myName = state.me.name.toLowerCase();
  let html = '<div class="spacer"></div>';
  if (!list.length) {
    html += `<div class="empty"><h2>Bem-vindo a #${esc(ch.name)}</h2><div>Este é o começo do canal. Seja o primeiro a escrever.</div></div>`;
  }
  let prev = null;
  for (const m of list) {
    const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
    if (newDay) html += `<div class="divider">${fmtDay(m.ts)}</div>`;
    const same = !newDay && prev.authorId === m.authorId && m.ts - prev.ts < 7 * 60 * 1000;
    prev = m;
    const mine = m.authorId === state.me.id;
    const mentioned = !mine && m.text.toLowerCase().includes('@' + myName);
    html += `<div class="msg ${same ? 'same' : ''} ${mentioned ? 'mention' : ''}" data-id="${esc(m.id)}">` +
      (same
        ? `<div class="lead">${hhmm(m.ts)}</div>`
        : `<div class="avatar lead" style="background:${esc(m.color)}">${esc(initial(m.author))}</div>`) +
      `<div class="body">` +
      (same ? '' : `<div class="meta"><span class="author" style="color:${esc(m.color)}">${esc(m.author)}</span>${m.bot ? '<span class="tag">BOT</span>' : ''}<span class="time">${fmtTime(m.ts)}</span></div>`) +
      `<div class="text">${render(m.text)}</div></div>` +
      (mine ? `<div class="tools"><button data-del="${esc(m.id)}" title="Apagar mensagem" aria-label="Apagar mensagem">${ico('trash')}</button></div>` : '') +
      `</div>`;
  }
  const keep = box.scrollHeight - box.scrollTop;
  box.innerHTML = html;
  box.scrollTop = scroll ? box.scrollHeight : box.scrollHeight - keep;
}

function openChannel(id) {
  const ch = curServer().channels.find((c) => c.id === id);
  if (!ch) return;
  state.channelId = id; state.unread[id] = 0; updateTitle();
  $('chName').textContent = ch.name; $('chTopic').textContent = ch.topic || '';
  $('input').placeholder = `Conversar em #${ch.name}`;
  document.body.classList.remove('menu-open');
  renderChannels();
  if (state.messages[id]) renderMessages(true); else { $('messages').innerHTML = ''; send({ t: 'history', channel: id }); }
  state.typing = {}; renderTyping();
}

/* ---------- eventos ---------- */
$('nameInput').value = store.get('nexo.name') || '';
$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('nameInput').value.trim();
  if (name.length < 2) { $('loginError').textContent = 'Escolha um apelido com pelo menos 2 caracteres.'; return; }
  $('loginError').textContent = ''; $('loginBtn').disabled = true;
  connect(name);
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.srv) {
    state.serverId = t.dataset.srv;
    renderServers(); renderChannels(); openChannel(curServer().channels[0].id);
  } else if (t.dataset.ch) {
    openChannel(t.dataset.ch);
  } else if (t.dataset.del) {
    if (confirm('Apagar esta mensagem?')) send({ t: 'delete', channel: state.channelId, msgId: t.dataset.del });
  } else if (t.hasAttribute('data-copy')) {
    const code = t.closest('pre').querySelector('code').innerText;
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
    t.textContent = 'copiado'; setTimeout(() => (t.textContent = 'copiar'), 1200);
  } else if (t.hasAttribute('data-newch')) {
    const name = prompt('Nome do novo canal:');
    if (name && name.trim()) send({ t: 'newchannel', server: state.serverId, name });
  }
});
$('menuBtn').onclick = () => document.body.classList.toggle('menu-open');
$('scrim').onclick = () => document.body.classList.remove('menu-open');
$('membersBtn').onclick = () => $('members').classList.toggle('show');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { document.body.classList.remove('menu-open'); $('members').classList.remove('show'); }
});

const input = $('input');
function submit() {
  const text = input.value.trim();
  if (!text) return;
  send({ t: 'msg', channel: state.channelId, text });
  input.value = ''; input.style.height = 'auto';
}
$('composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  const now = Date.now();
  if (now - state.lastTypingSent > 2500) { state.lastTypingSent = now; send({ t: 'typing', channel: state.channelId }); }
});
