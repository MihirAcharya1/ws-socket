const ws = new WebSocket(`ws://${location.host}`);

const img = document.getElementById('screen');

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.type === 'screen-data') {
    img.src = data.data;
  }
};

document.getElementById('join').onclick = () => {
  const roomId = document.getElementById('room').value.trim();
  if (roomId) {
    ws.send(JSON.stringify({ type: 'join-room', roomId }));
  }
};
