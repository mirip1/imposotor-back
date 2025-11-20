export const rooms = {};
export const defaultWords = [
  "Malena Bujarra", "Paponazo", "Mario", "Putero", "Serranito"
];

// Crea sala y marca owner
export function createRoom(ownerName, ownerSocketId) {
  const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
  rooms[roomId] = {
    id: roomId,
    ownerId: ownerSocketId,
    players: [
      { id: ownerSocketId, name: ownerName, eliminated: false }
    ],
    word: null,
    impostorId: null,
    votes: {},
    roundActive: false
  };
  return rooms[roomId];
}
export function sendPlayerList(io, room, targetSocket = null) {
  const payload = {
    players: room.players,
    ownerId: room.ownerId
  };
  if (targetSocket) {
    targetSocket.emit("player-list", payload);
  } else {
    io.to(room.id).emit("player-list", payload);
  }
}

export function getRoom(roomId) {
  return rooms[roomId] || null;
}

export function getAllRooms() {
  return rooms;
}

export function joinRoom(roomId, playerName, socketId) {
  const room = rooms[roomId];
  if (!room) return null;
  // evitar duplicados por reconexión simple
  if (!room.players.find(p => p.id === socketId)) {
    room.players.push({ id: socketId, name: playerName, eliminated: false });
  }
  return room;
}

export function leaveRoom(roomId, socketId) {
  const room = rooms[roomId];
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socketId);
  // si owner se va, reasigna owner al primer jugador si existe
  if (room.ownerId === socketId) {
    room.ownerId = room.players.length ? room.players[0].id : null;
  }
  // si no quedan jugadores borra la sala
  if (!room.players.length) {
    delete rooms[roomId];
  }
}

function randomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Inicia una nueva ronda: resetea eliminaciones, selecciona palabra e impostor
export function startRound(roomId, wordList = defaultWords) {
  const room = rooms[roomId];
  if (!room) return null;
  // Resetear eliminados (eliminación era sólo por ronda)
  room.players.forEach(p => p.eliminated = false);
  room.votes = {};
  room.roundActive = true;

  const word = randomFromArray(wordList);
  const impostor = randomFromArray(room.players);

  room.word = word;
  room.impostorId = impostor.id;

  return {
    word,
    impostorId: impostor.id,
    room
  };
}

// Reinicia la votación (vacía votos) — se llama después de cada eliminación si se sigue votando
export function resetVotes(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.votes = {};
}

// Devuelve lista de jugadores activos (no eliminados)
export function activePlayers(roomId) {
  const room = rooms[roomId];
  if (!room) return [];
  return room.players.filter(p => !p.eliminated);
}

// Marca a un jugador como eliminado hasta el siguiente startRound
export function eliminatePlayer(roomId, targetId) {
  const room = rooms[roomId];
  if (!room) return null;
  const target = room.players.find(p => p.id === targetId);
  if (!target) return null;
  target.eliminated = true;
  return target;
}
