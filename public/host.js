const ws = new WebSocket(`ws://${location.host}`);

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.type === 'room-created') {
    document.getElementById('roomId').innerText = "Room ID: " + data.roomId;
  }
};

document.getElementById('start').onclick = async () => {
  ws.send(JSON.stringify({ type: 'create-room' }));
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const track = stream.getVideoTracks()[0];
  const imageCapture = new ImageCapture(track);

  setInterval(async () => {
    const frame = await imageCapture.grabFrame();
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(frame, 0, 0);

    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        ws.send(JSON.stringify({ type: 'screen-data', data: reader.result }));
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg');
  }, 300);
};
