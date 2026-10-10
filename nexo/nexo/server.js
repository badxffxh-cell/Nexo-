const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA = path.join(DATA_DIR, 'data.json');
const MAX_PER_CHANNEL = 500;
const MAX_LEN = 2000;
const MAX_CHANNELS_PER_SERVER = 25;
const MAX_CONN_PER_IP = 8;
const MAX_USERS = 500;
const RESERVED = /^(nexo bot|bot|admin|administrador|moderador|mod|system|sistema|nexo)$/i;

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; " +
      "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
      "connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  });
  next();
});
app.get('/health', (req, res) => res.type('text').send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload: 16 * 1024,
  verifyClient: ({ origin, req }) => {
    if (!origin) return true; // clientes que não são navegador
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  },
});

const uid = () => crypto.randomBytes(5).toString('hex');
const COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6'];
const colorFor = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};
const cleanName = (s) =>
  String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const cleanText = (s) =>
  String(s || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_LEN);
const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x';

function seed() {
  const servers = [
    {
      id: 's-devs', name: 'Nexo Devs', icon: 'ND',
      channels: [
        { id: 'c-boas-vindas', name: 'boas-vindas', type: 'text', topic: 'Comece por aqui' },
        { id: 'c-geral', name: 'geral', type: 'text', topic: 'Papo geral entre devs' },
        { id: 'c-ajuda', name: 'ajuda-codigo', type: 'text', topic: 'Travou? Cole seu código com ``` e pergunte' },
        { id: 'c-projetos', name: 'mostre-seu-projeto', type: 'text', topic: 'Mostre o que você está construindo' },
        { id: 'c-vagas', name: 'vagas', type: 'text', topic: 'Oportunidades e freelas' },
      ],
    },
    {
      id: 's-com', name: 'Comunidade', icon: 'CM',
      channels: [
        { id: 'c-bate-papo', name: 'bate-papo', type: 'text', topic: 'Conversa livre' },
        { id: 'c-games', name: 'games', type: 'text', topic: 'Jogatina e dicas' },
        { id: 'c-musica', name: 'musica', type: 'text', topic: 'O que você está ouvindo?' },
        { id: 'c-memes', name: 'memes', type: 'text', topic: 'Só o melhor conteúdo' },
      ],
    },
  ];
  const now = Date.now();
  const bot = { authorId: 'bot', author: 'Nexo Bot', color: '#818cf8', bot: true };
  const messages = {
    'c-boas-vindas': [{
      id: uid(), channel: 'c-boas-vindas', ...bot, ts: now,
      text: 'Bem-vindo ao **Nexo**.\nEscolha um canal à esquerda e comece a conversar.\nUse ```js ... ``` para enviar código com destaque de sintaxe e @apelido para mencionar alguém.',
    }],
    'c-ajuda': [{
      id: uid(), channel: 'c-ajuda', ...bot, ts: now,
      text: 'Exemplo de como pedir ajuda:\n```js\nconst soma = (a, b) => a + b;\nconsole.log(soma(2, 3));\n```',
    }],
  };
  return { servers, messages };
}

let db = seed();
try {
  const loaded = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  if (Array.isArray(loaded.servers) && loaded.messages) db = loaded;
} catch { /* primeiro start */ }
// versões antigas tinham canais de voz decorativos
db.servers.forEach((s) => { s.channels = s.channels.filter((c) => c.type === 'text'); });

let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  try {
    const tmp = DATA + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA);
  } catch (e) { console.error('Falha ao salvar:', e.message); }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });

const findChannel = (id) => {
  for (const s of db.servers) {
    const c = s.channels.find((c) => c.id === id);
    if (c) return c;
  }
  return null;
};

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
const broadcast = (obj) => wss.clients.forEach((c) => c.user && send(c, obj));
const userList = () => {
  const seen = new Map();
  for (const c of wss.clients) if (c.user && !seen.has(c.user.id)) seen.set(c.user.id, c.user);
  return [...seen.values()];
};
const connsFromIp = (ip) => [...wss.clients].filter((c) => c.ip === ip).length;

// quantas mensagens por janela de tempo
function allowed(ws, limit, windowMs) {
  const now = Date.now();
  ws.hits = (ws.hits || []).filter((t) => now - t < windowMs);
  if (ws.hits.length >= limit) return false;
  ws.hits.push(now);
  return true;
}

wss.on('connection', (ws, req) => {
  ws.ip = ipOf(req);
  if (connsFromIp(ws.ip) > MAX_CONN_PER_IP) return ws.close(1008, 'Muitas conexões');
  ws.user = null;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join') {
      if (ws.user) return;
      const name = cleanName(m.name);
      if (name.length < 2) return send(ws, { t: 'error', code: 'name', message: 'Escolha um apelido com pelo menos 2 caracteres.' });
      if (RESERVED.test(name)) return send(ws, { t: 'error', code: 'name', message: 'Esse apelido é reservado.' });
      // id público derivado de um segredo guardado só no navegador do usuário
      const secret = /^[a-zA-Z0-9-]{8,64}$/.test(String(m.clientId || '')) ? m.clientId : crypto.randomUUID();
      const pubId = crypto.createHash('sha256').update('nexo:' + secret).digest('hex').slice(0, 12);
      const taken = [...wss.clients].some(
        (c) => c !== ws && c.user && c.user.name.toLowerCase() === name.toLowerCase() && c.user.id !== pubId,
      );
      if (taken) return send(ws, { t: 'error', code: 'name', message: 'Esse apelido já está em uso agora. Escolha outro.' });
      if (userList().length >= MAX_USERS) return send(ws, { t: 'error', code: 'full', message: 'O servidor está cheio. Tente de novo em alguns minutos.' });
      ws.user = { id: pubId, name, color: colorFor(name) };
      send(ws, { t: 'init', me: ws.user, servers: db.servers, users: userList() });
      broadcast({ t: 'users', users: userList() });
      return;
    }
    if (!ws.user) return;

    if (m.t === 'history') {
      if (!findChannel(m.channel)) return;
      send(ws, { t: 'history', channel: m.channel, messages: db.messages[m.channel] || [] });
    }

    if (m.t === 'msg') {
      const ch = findChannel(m.channel);
      const text = cleanText(m.text);
      if (!ch || !text) return;
      if (!allowed(ws, 6, 8000)) return send(ws, { t: 'error', code: 'rate', message: 'Calma, você está enviando mensagens rápido demais.' });
      const msg = {
        id: uid(), channel: ch.id, authorId: ws.user.id, author: ws.user.name,
        color: ws.user.color, ts: Date.now(), text,
      };
      const list = (db.messages[ch.id] ||= []);
      list.push(msg);
      if (list.length > MAX_PER_CHANNEL) list.splice(0, list.length - MAX_PER_CHANNEL);
      save();
      broadcast({ t: 'msg', message: msg });
    }

    if (m.t === 'delete') {
      const list = db.messages[m.channel];
      if (!list) return;
      const i = list.findIndex((x) => x.id === m.msgId && x.authorId === ws.user.id);
      if (i < 0) return;
      list.splice(i, 1);
      save();
      broadcast({ t: 'delete', channel: m.channel, msgId: m.msgId });
    }

    if (m.t === 'typing') {
      if (!findChannel(m.channel)) return;
      wss.clients.forEach((c) => c !== ws && c.user && send(c, { t: 'typing', channel: m.channel, name: ws.user.name }));
    }

    if (m.t === 'newchannel') {
      const srv = db.servers.find((s) => s.id === m.server);
      const name = String(m.name || '').toLowerCase().trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
      if (!srv || !name) return;
      if (srv.channels.length >= MAX_CHANNELS_PER_SERVER) return send(ws, { t: 'error', code: 'limit', message: 'Esse servidor já atingiu o limite de canais.' });
      if (srv.channels.some((c) => c.name === name)) return send(ws, { t: 'error', code: 'dup', message: 'Já existe um canal com esse nome.' });
      if (ws.lastChannel && Date.now() - ws.lastChannel < 10000) return send(ws, { t: 'error', code: 'rate', message: 'Espere alguns segundos para criar outro canal.' });
      ws.lastChannel = Date.now();
      const channel = { id: 'c-' + uid(), name, type: 'text', topic: '' };
      srv.channels.push(channel);
      save();
      broadcast({ t: 'channel', server: srv.id, channel });
    }
  });

  ws.on('close', () => ws.user && broadcast({ t: 'users', users: userList() }));
});

// derruba conexões mortas (proxies fecham conexões ociosas)
const heartbeat = setInterval(() => {
  wss.clients.forEach((c) => {
    if (c.alive === false) return c.terminate();
    c.alive = false;
    c.ping();
  });
}, 30000);
server.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => console.log(`Nexo rodando na porta ${PORT}`));
