// index.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get("/viewer", (req, res) => {
  res.sendFile(path.join(__dirname, 'public/viewer.html'));
});



const server = http.createServer(app);
const wss = new WebSocket.Server({ server });



// rooms: roomId -> { host: ws, viewers: { viewerId: ws } }
const rooms = {};

wss.on('connection', (ws) => {
  ws.id = String(uuidv4()).slice(0, 6).toUpperCase();

  ws.on('message', (msg) => {
    // All messages are JSON control messages
    let data;
    try { data = JSON.parse(msg.toString()); } catch (e) { return; }

    const type = data.type;

    // Create a room (host)
    if (type === 'create-room') {
      const roomId = String(uuidv4()).slice(0, 6).toUpperCase();
      rooms[roomId] = { host: ws, viewers: {} };
      ws.role = 'host';
      ws.roomId = roomId;
      ws.send(JSON.stringify({ type: 'room-created', roomId }));
      return;
    }

    // Viewer joins a room
    if (type === 'join-room') {
      const { roomId } = data;
      const room = rooms[roomId];
      if (!room) return ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
      const viewerId = uuidv4();
      room.viewers[viewerId] = ws;
      ws.role = 'viewer';
      ws.roomId = roomId;
      ws.viewerId = viewerId;

      // notify host
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({ type: 'viewer-joined', viewerId }));
      }
      ws.send(JSON.stringify({ type: 'joined-room', roomId, viewerId }));
      return;
    }

    // Host -> viewer: offer SDP
    if (type === 'offer') {
      const { viewerId, sdp } = data;
      const room = rooms[ws.roomId];
      if (!room) return;
      const viewer = room.viewers[viewerId];
      if (viewer && viewer.readyState === WebSocket.OPEN) {
        viewer.send(JSON.stringify({ type: 'offer', sdp, viewerId }));
      }
      return;
    }

    // Viewer -> host: answer SDP
    if (type === 'answer') {
      const { sdp, viewerId } = data;
      const room = rooms[ws.roomId];
      if (!room) return;
      const host = room.host;
      if (host && host.readyState === WebSocket.OPEN) {
        host.send(JSON.stringify({ type: 'answer', sdp, viewerId }));
      }
      return;
    }

    // ICE candidate relay
    if (type === 'ice-candidate') {
      const { target, candidate, viewerId } = data;
      const room = rooms[ws.roomId];
      if (!room) return;
      if (target === 'host') {
        const host = room.host;
        if (host && host.readyState === WebSocket.OPEN) host.send(JSON.stringify({ type: 'ice-candidate', candidate, from: ws.id, viewerId }));
      } else if (target === 'viewer') {
        const viewer = room.viewers[viewerId];
        if (viewer && viewer.readyState === WebSocket.OPEN) viewer.send(JSON.stringify({ type: 'ice-candidate', candidate, from: ws.id }));
      }
      return;
    }

    // optional: viewer leave
    if (type === 'viewer-leave') {
      const { viewerId } = data;
      const room = rooms[ws.roomId];
      if (!room) return;
      delete room.viewers[viewerId];
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomId];
    if (!room) return;
    if (ws.role === 'host') {
      // notify and close viewers
      Object.values(room.viewers).forEach(v => {
        try { v.send(JSON.stringify({ type: 'host-left' })); v.close(); } catch (e) { }
      });
      delete rooms[ws.roomId];
    } else if (ws.role === 'viewer') {
      // remove viewer from room
      if (ws.viewerId && room.viewers[ws.viewerId]) delete room.viewers[ws.viewerId];
      // notify host so it can close pc
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({ type: 'viewer-left', viewerId: ws.viewerId }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Signaling server listening on http://localhost:${PORT}`));
