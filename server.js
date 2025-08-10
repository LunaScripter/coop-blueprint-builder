import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  socket.emit("welcome", "Hello from server!");
  socket.on("chat", (msg) => io.emit("chat", msg));
  socket.on("disconnect", () => console.log("User disconnected:", socket.id));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on ${PORT}`));
