import {
    createRoom,
    getRoom,
    joinRoom,
    leaveRoom,
    startRound,
    resetVotes,
    activePlayers,
    eliminatePlayer,
    defaultWords,
    getAllRooms
} from "../game/rooms.js";

/**
 * Eventos tratados:
 * - create-room (playerName)
 * - join-room ({ roomId, playerName })
 * - start-round (roomId)  <-- solo owner
 * - vote ({ roomId, targetId })  <-- targetId puede ser null para 'abstenerse'
 * - end-round (roomId)  <-- solo owner: inicia siguiente ronda
 * - disconnect
 */
export function initGameSocket(io) {
    io.on("connection", (socket) => {
        console.log("Jugador conectado:", socket.id);

        socket.on("create-room", ({ name }, callback) => {
            try {
                const room = createRoom(name, socket.id);

                socket.join(room.id);
                console.log(`Sala creada: ${room.id} por ${JSON.stringify(name)}`);

                if (callback) callback({ success: true, roomId: room.id });

                io.to(room.id).emit("player-list", room.players);
            } catch (error) {
                console.error("Error al crear sala:", error);
                if (callback) callback({ success: false });
            }
        });
        socket.on("join-room", ({ roomId, playerName }) => {
            const room = getRoom(roomId);
            if (!room) {
                socket.emit("error", { message: "Sala no existe" });
                return;
            }
            joinRoom(roomId, playerName || "Anónimo", socket.id);
            socket.join(roomId);
            io.to(roomId).emit("player-list", room.players);
            console.log(`${playerName} se unió a ${roomId}`);
            console.log(room.players)
        });

        socket.on("player-list-room", ({ roomId }) => {
            const room = getRoom(roomId);
            if (!room) {
                socket.emit("error", { message: "Sala no existe" });
                return;
            }
            // Emitimos solo al socket que pidió la lista
            socket.emit("player-list", room.players);
        });
        socket.on("start-round", (roomId) => {
            if (!room) {
                socket.emit("error", "Sala no encontrada");
                return;
            }
            if (room.ownerId !== socket.id) {
                socket.emit("error", "Solo el creador/owner puede iniciar la ronda");
                return;
            }
            if (room.players.length < 2) {
                socket.emit("error", "Se necesitan al menos 2 jugadores para empezar la ronda");
                return;
            }

            const result = startRound(roomId, defaultWords);
            // Envío individual: cada jugador recibe su rol (impostor o palabra)
            result.room.players.forEach((p) => {
                if (p.id === result.impostorId) {
                    io.to(p.id).emit("round-start", { role: "impostor" });
                } else {
                    io.to(p.id).emit("round-start", { role: "player", word: result.word });
                }
            });

            // Info publica de la ronda
            io.to(roomId).emit("round-info", {
                roundActive: true,
                playersCount: result.room.players.length,
                activeCount: activePlayers(roomId).length
            });
            io.to(roomId).emit("player-list", result.room.players);
            console.log(`Ronda iniciada en ${roomId} - palabra elegida (secreta).`);
        });

        // Voto: { roomId, targetId } (targetId puede ser null -> abstención)
        socket.on("vote", ({ roomId, targetId }) => {
            const room = getRoom(roomId);
            if (!room) return socket.emit("error", "Sala no encontrada");
            if (!room.roundActive) return socket.emit("error", "No hay una ronda activa");
            const player = room.players.find(p => p.id === socket.id);
            if (!player) return socket.emit("error", "Jugador no en la sala");
            if (player.eliminated) return socket.emit("error", "Jugador eliminado no puede votar");

            // Registrar voto
            room.votes[socket.id] = targetId || null;
            io.to(roomId).emit("vote-update", { votesCount: Object.keys(room.votes).length });

            // Comprobar si todos los jugadores activos han votado
            const active = activePlayers(roomId).map(p => p.id);
            const allVoted = active.every(id => Object.prototype.hasOwnProperty.call(room.votes, id));

            if (!allVoted) return; // seguimos esperando votos

            // Contabilizar votos
            const tally = {}; // targetId -> count
            Object.values(room.votes).forEach(t => {
                if (t === null) return; // abstención no cuenta
                tally[t] = (tally[t] || 0) + 1;
            });

            // Si no hay votos (todos abstienen)
            if (!Object.keys(tally).length) {
                io.to(roomId).emit("vote-result", {
                    eliminated: null,
                    reason: "Todos se abstuvieron",
                    votes: room.votes
                });
                // limpiar votos pero permitir nueva votación si quedan suficientes jugadores
                resetVotes(roomId);
                return;
            }

            // Determinar target con más votos (empate -> aleatorio entre top)
            let max = 0;
            for (const k in tally) if (tally[k] > max) max = tally[k];
            const topTargets = Object.keys(tally).filter(k => tally[k] === max);
            const chosenTargetId = topTargets[Math.floor(Math.random() * topTargets.length)];
            const eliminatedPlayer = eliminatePlayer(roomId, chosenTargetId);

            const wasImpostor = (room.impostorId === chosenTargetId);

            // Emitir resultado de la votación
            io.to(roomId).emit("vote-result", {
                eliminated: eliminatedPlayer ? { id: eliminatedPlayer.id, name: eliminatedPlayer.name } : null,
                wasImpostor,
                votes: room.votes
            });

            // Actualizar lista pública
            io.to(roomId).emit("player-list", room.players);

            // Limpiar votos para permitir nueva votación entre los que quedan (si hay >1 jugador activo)
            resetVotes(roomId);

            // Si solo queda 0 o 1 jugadores activos, ya no se puede seguir votando automáticamente
            const remaining = activePlayers(roomId);
            if (remaining.length <= 1) {
                room.roundActive = false;
                io.to(roomId).emit("round-info", { roundActive: false, message: "No quedan suficientes jugadores para seguir votando" });
            } else {
                // Se permite seguir votando: notificar a los clientes que comienzan nueva ronda de votación
                io.to(roomId).emit("vote-next", { activeCount: remaining.length });
            }
        });

        // Owner finaliza la ronda y avanza a la siguiente (start-round automático)
        socket.on("end-round", (roomId) => {
            const room = getRoom(roomId);
            if (!room) return socket.emit("error", "Sala no encontrada");
            if (room.ownerId !== socket.id) return socket.emit("error", "Solo el owner puede terminar la ronda");
            if (room.players.length < 2) return socket.emit("error", "Se necesitan al menos 2 jugadores para iniciar una ronda");

            // Iniciamos nueva ronda
            const result = startRound(roomId, defaultWords);

            // Envío individual
            result.room.players.forEach((p) => {
                if (p.id === result.impostorId) {
                    io.to(p.id).emit("round-start", { role: "impostor" });
                } else {
                    io.to(p.id).emit("round-start", { role: "player", word: result.word });
                }
            });

            // Info pública
            io.to(roomId).emit("round-info", {
                roundActive: true,
                playersCount: result.room.players.length,
                activeCount: activePlayers(roomId).length
            });
            io.to(roomId).emit("player-list", result.room.players);
            console.log(`Owner ${socket.id} avanzó la ronda en ${roomId}`);
        });

        socket.on("disconnect", () => {
            console.log(`Jugador desconectado: ${socket.id}`);

            // Usamos leaveRoom de nuestro módulo para eliminar al jugador de todas las salas
            // Sin acceder directamente a "rooms" (que está encapsulado en el módulo).
            for (const [roomId, room] of Object.entries(getAllRooms())) {
                const playerExists = room.players.find((p) => p.id === socket.id);
                if (playerExists) {
                    leaveRoom(roomId, socket.id);

                    // Si quedan jugadores, actualizamos la lista en el front
                    const updatedRoom = getRoom(roomId);
                    if (updatedRoom) {
                        io.to(roomId).emit("player-list", updatedRoom.players);
                    }
                    console.log(`${socket.id} salió de la sala ${roomId}`);
                }
            }
        });
        // Manejo explícito de "leave-room" desde cliente
        socket.on("leave-room", ({ roomId }) => {
            const room = getRoom(roomId);
            if (!room) return;

            leaveRoom(roomId, socket.id);

            const updatedRoom = getRoom(roomId);
            if (updatedRoom) {
                io.to(roomId).emit("player-list", updatedRoom.players);
            } else {
                console.log(`sala ${roomId} eliminada (sin jugadores)`);
            }

            console.log(`👋 ${socket.id} salió de ${roomId}`);
        });
    })
}
