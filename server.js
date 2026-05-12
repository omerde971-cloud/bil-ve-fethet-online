const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const CITY_NAMES = {
  TR01:'Adana',TR02:'Adıyaman',TR03:'Afyonkarahisar',TR04:'Ağrı',TR05:'Amasya',TR06:'Ankara',TR07:'Antalya',TR08:'Artvin',TR09:'Aydın',TR10:'Balıkesir',
  TR11:'Bilecik',TR12:'Bingöl',TR13:'Bitlis',TR14:'Bolu',TR15:'Burdur',TR16:'Bursa',TR17:'Çanakkale',TR18:'Çankırı',TR19:'Çorum',TR20:'Denizli',
  TR21:'Diyarbakır',TR22:'Edirne',TR23:'Elazığ',TR24:'Erzincan',TR25:'Erzurum',TR26:'Eskişehir',TR27:'Gaziantep',TR28:'Giresun',TR29:'Gümüşhane',TR30:'Hakkari',
  TR31:'Hatay',TR32:'Isparta',TR33:'Mersin',TR34:'İstanbul',TR35:'İzmir',TR36:'Kars',TR37:'Kastamonu',TR38:'Kayseri',TR39:'Kırklareli',TR40:'Kırşehir',
  TR41:'Kocaeli',TR42:'Konya',TR43:'Kütahya',TR44:'Malatya',TR45:'Manisa',TR46:'Kahramanmaraş',TR47:'Mardin',TR48:'Muğla',TR49:'Muş',TR50:'Nevşehir',
  TR51:'Niğde',TR52:'Ordu',TR53:'Rize',TR54:'Sakarya',TR55:'Samsun',TR56:'Siirt',TR57:'Sinop',TR58:'Sivas',TR59:'Tekirdağ',TR60:'Tokat',
  TR61:'Trabzon',TR62:'Tunceli',TR63:'Şanlıurfa',TR64:'Uşak',TR65:'Van',TR66:'Yozgat',TR67:'Zonguldak',TR68:'Aksaray',TR69:'Bayburt',TR70:'Karaman',
  TR71:'Kırıkkale',TR72:'Batman',TR73:'Şırnak',TR74:'Bartın',TR75:'Ardahan',TR76:'Iğdır',TR77:'Yalova',TR78:'Karabük',TR79:'Kilis',TR80:'Osmaniye',TR81:'Düzce'
};
const SPECIAL_INCOME = { TR06:60, TR34:60, TR35:40, TR16:40, TR07:40, TR42:40, TR01:40 };
const PLAYER_COLORS = ['#167a5a','#2563eb','#7c3aed','#db2777','#ea580c','#0891b2','#65a30d','#9333ea'];
const QUESTIONS = [
  {cat:'Tarih',q:'Türkiye Cumhuriyeti hangi yılda ilan edildi?',a:['1920','1923','1938','1453'],c:1},
  {cat:'Coğrafya',q:"Türkiye'nin başkenti neresidir?",a:['İstanbul','Ankara','İzmir','Bursa'],c:1},
  {cat:'Bilim',q:'Su molekülünün formülü hangisidir?',a:['CO2','H2O','O2','NaCl'],c:1},
  {cat:'Matematik',q:'12 x 8 kaçtır?',a:['86','92','96','108'],c:2},
  {cat:'Genel Kültür',q:"İstiklal Marşı'nın yazarı kimdir?",a:['Ziya Gökalp','Mehmet Akif Ersoy','Orhan Veli','Nazım Hikmet'],c:1},
  {cat:'LGS',q:'Bir ürünün fiyatı 200 TL iken %15 indirim yapılırsa yeni fiyat kaç TL olur?',a:['150','160','170','185'],c:2},
  {cat:'LGS',q:'Bir zar atıldığında üst yüze çift sayı gelme olasılığı kaçtır?',a:['1/6','1/3','1/2','2/3'],c:2},
  {cat:'LGS',q:'Bir paragrafta "fakat" kelimesi genellikle hangi anlam ilişkisini kurar?',a:['Amaç','Karşıtlık','Koşul','Benzetme'],c:1}
];

const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', socket => {
  socket.on('joinLobby', ({ roomId = 'ana-oda', name = 'Oyuncu' } = {}) => {
    const room = getRoom(roomId);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.name = cleanName(name);
    room.players[socket.id] = {
      id: socket.id,
      name: socket.data.name,
      color: PLAYER_COLORS[Object.keys(room.players).length % PLAYER_COLORS.length],
      startVote: null,
      turnReady: false
    };
    emitLobby(room);
    if (room.session) socket.emit('gameStarted', publicSession(room));
  });

  socket.on('requestStart', () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    room.startRequest = { by: socket.id, time: Date.now() };
    Object.values(room.players).forEach(player => {
      player.startVote = player.id === socket.id ? true : null;
    });
    emitLobby(room);
    maybeStartGame(room);
  });

  socket.on('startVote', ({ accepted } = {}) => {
    const room = getSocketRoom(socket);
    if (!room || !room.players[socket.id]) return;
    if (!accepted) {
      room.startRequest = null;
      Object.values(room.players).forEach(player => { player.startVote = null; });
      emitLobby(room);
      return;
    }
    room.players[socket.id].startVote = true;
    emitLobby(room);
    maybeStartGame(room);
  });

  socket.on('requestBattle', ({ targetId, attackerId } = {}) => {
    const room = getSocketRoom(socket);
    if (!room?.session) return;
    const attacker = room.session.provinces[attackerId];
    const target = room.session.provinces[targetId];
    if (!attacker || !target || attacker.owner !== socket.id || target.owner === socket.id || attacker.army <= 0) {
      socket.emit('serverNotice', 'Bu hedefe savaş açılamıyor.');
      return;
    }
    const q = QUESTIONS[rand(0, QUESTIONS.length - 1)];
    const battleId = `${socket.id}-${Date.now()}`;
    room.pendingBattles[battleId] = { battleId, playerId: socket.id, attackerId, targetId, q };
    socket.emit('battleQuestion', {
      battleId,
      attackerId,
      targetId,
      q: { cat: q.cat, q: q.q, a: q.a },
      meta: `${target.name} için ${q.cat} sorusu`,
      power: `Saldırı: ${attacker.name} (${attacker.army} asker)`
    });
  });

  socket.on('submitBattleAnswer', ({ battleId, answerIndex } = {}) => {
    const room = getSocketRoom(socket);
    const battle = room?.pendingBattles?.[battleId];
    if (!room?.session || !battle || battle.playerId !== socket.id) return;
    delete room.pendingBattles[battleId];
    const result = resolveAttack(room, battle, Number(answerIndex));
    io.to(room.id).emit('gameState', publicSession(room));
    socket.emit('battleResult', result);
  });

  socket.on('requestTurnReady', () => {
    const room = getSocketRoom(socket);
    if (!room?.session || !room.session.players[socket.id]) return;
    room.session.players[socket.id].turnReady = true;
    if (Object.values(room.session.players).every(player => player.turnReady)) {
      room.session.day++;
      Object.values(room.session.players).forEach(player => { player.turnReady = false; });
      room.session.log.push(`<span class="good">${room.session.day}. Gün.</span> Tüm oyuncular tur geçmeyi kabul etti.`);
    } else {
      room.session.log.push(`${room.session.players[socket.id].name} tur geçmeye hazır.`);
    }
    io.to(room.id).emit('gameState', publicSession(room));
  });

  socket.on('disconnect', () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    delete room.players[socket.id];
    if (room.session?.players) delete room.session.players[socket.id];
    if (!Object.keys(room.players).length && !room.session) rooms.delete(room.id);
    else {
      emitLobby(room);
      if (room.session) io.to(room.id).emit('gameState', publicSession(room));
    }
  });
});

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { id: roomId, players: {}, startRequest: null, session: null, pendingBattles: {} });
  }
  return rooms.get(roomId);
}

function getSocketRoom(socket) {
  return socket.data.roomId ? rooms.get(socket.data.roomId) : null;
}

function emitLobby(room) {
  io.to(room.id).emit('lobbyState', {
    players: Object.values(room.players),
    startRequest: room.startRequest
  });
}

function maybeStartGame(room) {
  const players = Object.values(room.players);
  if (!room.startRequest || !players.length || !players.every(player => player.startVote === true)) return;
  room.session = createSession(players);
  room.pendingBattles = {};
  room.startRequest = null;
  io.to(room.id).emit('gameStarted', publicSession(room));
  emitLobby(room);
}

function createSession(players) {
  const provinceIds = Object.keys(CITY_NAMES).sort(() => Math.random() - 0.5);
  const provinces = {};
  Object.entries(CITY_NAMES).forEach(([id, name]) => {
    provinces[id] = { id, name, owner: 'neutral', army: rand(7, 15), income: SPECIAL_INCOME[id] || 20 };
  });
  const sessionPlayers = {};
  players.forEach((player, index) => {
    const startId = provinceIds[index % provinceIds.length];
    provinces[startId].owner = player.id;
    provinces[startId].army = rand(30, 42);
    sessionPlayers[player.id] = { ...player, turnReady: false };
  });
  return {
    day: 1,
    provinces,
    players: sessionPlayers,
    log: ['Online oyun başladı. En çok ili toplayan kazanır.'],
    updated: Date.now()
  };
}

function publicSession(room) {
  return {
    day: room.session.day,
    provinces: room.session.provinces,
    players: room.session.players,
    log: room.session.log.slice(-18),
    updated: Date.now()
  };
}

function resolveAttack(room, battle, answerIndex) {
  const attacker = room.session.provinces[battle.attackerId];
  const target = room.session.provinces[battle.targetId];
  if (!attacker || !target || attacker.owner !== battle.playerId || target.owner === battle.playerId) {
    return { title: 'Savaş Geçersiz', text: 'Savaş koşulları artık geçerli değil.', rows: [] };
  }

  const correct = answerIndex === battle.q.c;
  const baseAttack = attacker.army;
  const attack = Math.max(1, Math.round(baseAttack * (correct ? 1.55 : 0.75)) + (correct ? 8 : 0) + rand(-2, 6));
  const defense = Math.max(1, target.army + Math.round(target.army * (correct ? 0.08 : 0.18)) + rand(-2, 5));
  const playerName = room.session.players[battle.playerId]?.name || 'Oyuncu';

  if (!correct) {
    const loss = clamp(Math.round(attacker.army * 0.56) + rand(1, 6), 1, attacker.army);
    attacker.army = Math.max(0, attacker.army - loss);
    room.session.log.push(`<span class="bad">${playerName} ${target.name} saldırısında yanlış cevap verdi.</span> ${loss} asker kaybetti.`);
    return { title: 'Yanlış Cevap', text: `${target.name} ele geçirilemedi.`, rows: [`Saldırı gücü: ${attack}`, `Savunma gücü: ${defense}`, `Kaybedilen asker: ${loss}`] };
  }

  if (attack >= defense || baseAttack >= Math.ceil(target.army * 0.75)) {
    const oldOwner = target.owner;
    const loss = clamp(Math.round(target.army * 0.45) + rand(1, 6), 1, Math.max(1, attacker.army - 1));
    attacker.army = Math.max(1, attacker.army - loss);
    target.owner = battle.playerId;
    target.army = Math.max(3, Math.round((attacker.army - loss) * 0.58));
    room.session.log.push(`<span class="good">${playerName} ${target.name} ilini fethetti.</span> Önceki sahip: ${ownerName(room, oldOwner)}.`);
    return { title: 'Zafer', text: `${target.name} artık senin.`, rows: [`Saldırı gücü: ${attack}`, `Savunma gücü: ${defense}`, `Kalan garnizon: ${target.army}`] };
  }

  const loss = clamp(Math.round(attacker.army * 0.32) + rand(0, 5), 1, attacker.army);
  attacker.army = Math.max(0, attacker.army - loss);
  room.session.log.push(`<span class="bad">${playerName} ${target.name} ilini alamadı.</span> Saldırı gücü yetmedi.`);
  return { title: 'Saldırı Başarısız', text: `${target.name} savunmayı tuttu.`, rows: [`Saldırı gücü: ${attack}`, `Savunma gücü: ${defense}`, `Kaybedilen asker: ${loss}`] };
}

function ownerName(room, owner) {
  if (owner === 'neutral') return 'Tarafsız';
  return room.session.players[owner]?.name || 'Oyuncu';
}

function cleanName(name) {
  return String(name || 'Oyuncu').trim().slice(0, 18) || 'Oyuncu';
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

server.listen(PORT, () => {
  console.log(`BilFet server running on port ${PORT}`);
});
