const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = {};

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  ws.id = uuidv4();

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    const { type } = data;

    if (type === 'create-room') {
      const roomId = uuidv4();
      rooms[roomId] = { host: ws, viewers: [] };
      ws.roomId = roomId;
      ws.role = 'host';
      ws.send(JSON.stringify({ type: 'room-created', roomId }));
    }

    if (type === 'join-room') {
      const { roomId } = data;
      if (!rooms[roomId]) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
      }
      rooms[roomId].viewers.push(ws);
      ws.roomId = roomId;
      ws.role = 'viewer';
      ws.send(JSON.stringify({ type: 'joined-room', roomId }));
    }

    if (type === 'screen-data' && ws.role === 'host') {
      const room = rooms[ws.roomId];
      if (!room) return;
      room.viewers.forEach(viewer => {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(JSON.stringify({ type: 'screen-data', data: data.data }));
        }
      });
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomId];
    if (!room) return;
    if (ws.role === 'host') {
      room.viewers.forEach(v => v.close());
      delete rooms[ws.roomId];
    } else if (ws.role === 'viewer') {
      room.viewers = room.viewers.filter(v => v !== ws);
    }
  });
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
