import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { initGameSocket } from "./src/sockets/gameSocket.js";

const app = express();

// Configuración CORS más específica
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:4200', 'http://www.mivel.eu', 'https://www.mivel.eu'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

app.get("/", (_, res) => res.send("Servidor impostor activo "));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  },
});

initGameSocket(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
