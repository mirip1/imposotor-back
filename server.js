import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { initGameSocket } from "./src/sockets/gameSocket.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_, res) => res.send("Servidor impostor activo "));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

initGameSocket(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
