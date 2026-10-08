import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";

import Message from "./models/Message.js";

const app = express();
const httpServer = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing in backend/.env");
  process.exit(1);
}

app.use(
  cors({
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ChatBox backend is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.get("/api/messages/:groupName", async (req, res) => {
  try {
    const groupName = decodeURIComponent(req.params.groupName).trim();
    const groupKey = normalizeGroup(groupName);

    const messages = await Message.find({ groupKey })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();

    const formatted = messages.map((message) => ({
      ...message,
      id: message._id.toString(),
      time: new Date(message.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

    res.json(formatted);
  } catch (error) {
    console.error("GET messages error:", error);
    res.status(500).json({ message: "Could not load messages" });
  }
});

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

function normalizeGroup(groupName) {
  return groupName.trim().toLowerCase();
}

function roomName(groupName) {
  return `chat:${normalizeGroup(groupName)}`;
}

function getRoomUsers(room) {
  const sockets = io.sockets.adapter.rooms.get(room);
  if (!sockets) return [];

  const usernames = [];

  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket?.data?.username && !usernames.includes(socket.data.username)) {
      usernames.push(socket.data.username);
    }
  }

  return usernames;
}

function broadcastRoomUsers(groupName) {
  const room = roomName(groupName);
  io.to(room).emit("roomUsers", getRoomUsers(room));
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("joinGroup", async ({ username, groupName }) => {
    try {
      if (
        typeof username !== "string" ||
        typeof groupName !== "string" ||
        !username.trim() ||
        !groupName.trim()
      ) {
        return;
      }

      const cleanUsername = username.trim().slice(0, 40);
      const cleanGroupName = groupName.trim().slice(0, 80);

      socket.data.username = cleanUsername;
      socket.data.groupName = cleanGroupName;

      const room = roomName(cleanGroupName);
      socket.join(room);

      broadcastRoomUsers(cleanGroupName);

      console.log(`${cleanUsername} joined "${cleanGroupName}"`);
    } catch (error) {
      console.error("joinGroup error:", error);
    }
  });

  socket.on("sendMessage", async ({ text }) => {
    try {
      const username = socket.data.username;
      const groupName = socket.data.groupName;

      if (!username || !groupName || typeof text !== "string") {
        return;
      }

      const cleanText = text.trim();

      if (!cleanText || cleanText.length > 2000) {
        return;
      }

      const message = await Message.create({
        username,
        groupName,
        groupKey: normalizeGroup(groupName),
        text: cleanText,
      });

      const payload = {
        _id: message._id.toString(),
        id: message._id.toString(),
        username: message.username,
        groupName: message.groupName,
        text: message.text,
        time: message.createdAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        createdAt: message.createdAt,
      };

      io.to(roomName(groupName)).emit("newMessage", payload);
    } catch (error) {
      console.error("sendMessage error:", error);
      socket.emit("messageError", "Message could not be sent.");
    }
  });

  socket.on("leaveGroup", () => {
    const groupName = socket.data.groupName;

    if (!groupName) return;

    socket.leave(roomName(groupName));
    broadcastRoomUsers(groupName);

    console.log(`${socket.data.username} left "${groupName}"`);

    socket.data.groupName = null;
  });

  socket.on("disconnect", () => {
    const groupName = socket.data.groupName;

    if (groupName) {
      setTimeout(() => broadcastRoomUsers(groupName), 0);
    }

    console.log("Socket disconnected:", socket.id);
  });
});

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected");

    httpServer.listen(PORT, () => {
      console.log(`ChatBox backend running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });
