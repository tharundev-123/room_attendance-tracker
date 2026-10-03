import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || (process.env.RENDER ? "/var/data/data.json" : path.join(__dirname, "data.json"));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function normalizeRoom(room, code) {
  if (!room || typeof room !== "object") return null;

  return {
    code: room.code || code,
    name: typeof room.name === "string" && room.name.trim() ? room.name : "My Room",
    members: Array.isArray(room.members) ? room.members : [],
    attendance: room.attendance && typeof room.attendance === "object" ? room.attendance : {},
    logs: Array.isArray(room.logs) ? room.logs : [],
    createdAt: room.createdAt || new Date().toISOString()
  };
}

function normalizeDb(data) {
  const safeDb = data && typeof data === "object" ? data : {};
  const rooms = safeDb.rooms && typeof safeDb.rooms === "object" ? safeDb.rooms : {};

  return {
    rooms: Object.fromEntries(
      Object.entries(rooms)
        .map(([code, room]) => [code, normalizeRoom(room, code)])
        .filter(([, room]) => room)
    )
  };
}

function loadDb() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { rooms: {} };

    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!raw) return { rooms: {} };

    return normalizeDb(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load data file:", error.message);
    const backup = `${DATA_FILE}.corrupt-${Date.now()}.bak`;
    try {
      if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, backup);
    } catch (backupError) {
      console.error("Could not back up corrupted data file:", backupError.message);
    }
    return { rooms: {} };
  }
}

let db = loadDb();

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });

    const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
  } catch (error) {
    console.error("Failed to save data file:", error.message);
    throw error;
  }
}

function roomCode() {
  let c;
  do {
    c = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (db.rooms[c]);
  return c;
}

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function snapshot(room) {
  if (!room) return null;
  return {
    code: room.code,
    name: room.name,
    members: room.members,
    attendance: room.attendance,
    logs: Array.isArray(room.logs) ? room.logs.slice(-100) : []
  };
}

function broadcast(code) {
  const room = db.rooms[code];
  if (!room) return;

  const payload = JSON.stringify({ type: "state", state: snapshot(room) });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomCode === code) client.send(payload);
  }
}

app.post("/api/rooms", (req, res) => {
  try {
    const roomName = String(req.body?.name || "My Room").trim().slice(0, 60) || "My Room";
    const code = roomCode();
    db.rooms[code] = {
      code,
      name: roomName,
      members: [],
      attendance: {},
      logs: [],
      createdAt: new Date().toISOString()
    };
    save();
    res.json(snapshot(db.rooms[code]));
  } catch (error) {
    console.error("Create room error:", error.message);
    res.status(500).json({ error: "Unable to create room" });
  }
});

app.get("/api/rooms/:code", (req, res) => {
  const room = db.rooms[String(req.params.code).toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(snapshot(room));
});

app.post("/api/rooms/:code/members", (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (room.members.some(m => m.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: "That member already exists" });

  const member = { id: crypto.randomUUID(), name };
  room.members.push(member);
  room.logs.push({ at: new Date().toISOString(), actor: "System", action: `added ${name}` });

  try {
    save();
    broadcast(code);
    res.json(member);
  } catch (error) {
    console.error("Add member error:", error.message);
    res.status(500).json({ error: "Unable to save member" });
  }
});

app.delete("/api/rooms/:code/members/:id", (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const member = room.members.find(m => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: "Member not found" });

  room.members = room.members.filter(m => m.id !== member.id);

  for (const date of Object.keys(room.attendance)) {
    if (room.attendance[date] && typeof room.attendance[date] === "object") {
      delete room.attendance[date][member.id];
    }
  }

  room.logs.push({ at: new Date().toISOString(), actor: "System", action: `removed ${member.name}` });

  try {
    save();
    broadcast(code);
    res.json({ ok: true });
  } catch (error) {
    console.error("Remove member error:", error.message);
    res.status(500).json({ error: "Unable to remove member" });
  }
});

app.post("/api/rooms/:code/attendance", (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const date = String(req.body?.date || "").slice(0, 10);
  const memberId = String(req.body?.memberId || "");
  const status = String(req.body?.status || "");
  const actor = cleanName(req.body?.actor) || "Someone";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Invalid date" });
  if (!room.members.some(m => m.id === memberId)) return res.status(400).json({ error: "Invalid member" });
  if (!["present", "absent", "leave", ""].includes(status)) return res.status(400).json({ error: "Invalid status" });

  room.attendance[date] ||= {};
  if (status) room.attendance[date][memberId] = status;
  else delete room.attendance[date][memberId];

  const member = room.members.find(m => m.id === memberId);
  room.logs.push({
    at: new Date().toISOString(),
    actor,
    action: `${status || "cleared"} ${member.name} on ${date}`
  });

  try {
    save();
    broadcast(code);
    res.json({ ok: true });
  } catch (error) {
    console.error("Attendance update error:", error.message);
    res.status(500).json({ error: "Unable to save attendance" });
  }
});

wss.on("connection", ws => {
  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const code = String(msg.code || "").toUpperCase();
      const room = db.rooms[code];
      if (room) {
        ws.roomCode = code;
        ws.send(JSON.stringify({ type: "state", state: snapshot(room) }));
      }
    } catch (error) {
      console.error("WebSocket message error:", error.message);
    }
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
server.listen(PORT, () => console.log(`Room Attendance Tracker running on port ${PORT}`));
