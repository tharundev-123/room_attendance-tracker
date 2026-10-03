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
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let db = { rooms: {} };
try { if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
catch { db = { rooms: {} }; }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function clearOldAttendance(room) {
  const today = todayKey();
  for (const date of Object.keys(room.attendance || {})) {
    if (date !== today) delete room.attendance[date];
  }
}
function clearAllOldAttendance() {
  for (const room of Object.values(db.rooms)) clearOldAttendance(room);
}
clearAllOldAttendance();

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
function roomCode() {
  let c;
  do { c = crypto.randomBytes(3).toString("hex").toUpperCase(); }
  while (db.rooms[c]);
  return c;
}
function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
}
function snapshot(room) {
  clearOldAttendance(room);
  return {
    code: room.code,
    name: room.name,
    members: room.members,
    attendance: room.attendance,
    logs: room.logs.slice(-100)
  };
}
function broadcast(code) {
  const payload = JSON.stringify({ type: "state", state: snapshot(db.rooms[code]) });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomCode === code) client.send(payload);
  }
}

app.post("/api/rooms", (req, res) => {
  const roomName = String(req.body?.name || "My Room").trim().slice(0, 60) || "My Room";
  const code = roomCode();
  db.rooms[code] = {
    code, name: roomName, members: [], attendance: {}, logs: [],
    createdAt: new Date().toISOString()
  };
  save();
  res.json(snapshot(db.rooms[code]));
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
  save(); broadcast(code);
  res.json(member);
});

app.delete("/api/rooms/:code/members/:id", (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: "Room not found" });
  const member = room.members.find(m => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: "Member not found" });
  room.members = room.members.filter(m => m.id !== member.id);
  for (const date of Object.keys(room.attendance)) delete room.attendance[date][member.id];
  room.logs.push({ at: new Date().toISOString(), actor: "System", action: `removed ${member.name}` });
  save(); broadcast(code);
  res.json({ ok: true });
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
    at: new Date().toISOString(), actor,
    action: `${status || "cleared"} ${member.name} on ${date}`
  });
  save(); broadcast(code);
  res.json({ ok: true });
});

wss.on("connection", ws => {
  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const code = String(msg.code || "").toUpperCase();
      if (db.rooms[code]) { ws.roomCode = code; ws.send(JSON.stringify({ type: "state", state: snapshot(db.rooms[code]) })); }
    } catch {}
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
server.listen(PORT, () => console.log(`Room Attendance Tracker running on port ${PORT}`));
