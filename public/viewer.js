// viewer.js
const inputRoomId = document.getElementById('inputRoomId');
const btnJoin = document.getElementById('btnJoin');
const txtViewerStatus = document.getElementById('txtViewerStatus');
const videoEl = document.getElementById('videoEl');
const WEBURL = location.host.includes('localhost') ? `ws://${location.host}` : `wss://${location.host}`;
const params = new URLSearchParams(window.location.search);
const roomIdSearch = params.get('id'); // "12345"=
console.log('Room ID from search:', roomIdSearch);
const ws = new WebSocket(WEBURL);
ws.onopen = () => console.log('Signaling WS open (viewer)');
ws.onmessage = onSignalMessage;

let pc = null;
let viewerId = null;
let roomId = roomIdSearch || null;

if (roomIdSearch) {
  inputRoomId.value = roomIdSearch;
  // setTimeout(() => {
  //   btnJoin.click();
  // }, 3000);
}

btnJoin.onclick = () => {
  roomId = inputRoomId.value.trim();
  if (!roomId) return alert('Enter room ID');
  ws.send(JSON.stringify({ type: 'join-room', roomId }));
  txtViewerStatus.innerText = 'Status: joining...';
};

async function onSignalMessage(evt) {
  let data;
  try { data = JSON.parse(evt.data); } catch (e) { return; }

  if (data.type === 'joined-room') {
    txtViewerStatus.innerText = `Status: joined ${data.roomId}`;
    viewerId = data.viewerId;
    return;
  }

  if (data.type === 'offer') {
    // host (offerer) created offer targeted to this viewer
    const { sdp, viewerId: vId } = data;
    // initialize PC
    await initPeerConnection();
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // send answer back to host via server
    ws.send(JSON.stringify({ type: 'answer', viewerId: vId, sdp: answer.sdp }));
    txtViewerStatus.innerText = 'Status: answered offer — connecting...';
    return;
  }

  if (data.type === 'ice-candidate') {
    const { candidate } = data;
    if (pc && candidate) {
      try { await pc.addIceCandidate(candidate); } catch (e) { console.warn('addIceCandidate failed', e); }
    }
    return;
  }

  if (data.type === 'error') {
    alert(data.message || 'Signaling error');
  }

  if (data.type === 'host-left') {
    txtViewerStatus.innerText = 'Host left';
    if (pc) pc.close();
  }
}

async function initPeerConnection() {
  if (pc) return;

  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

  pc.ontrack = (evt) => {
    // first track is the screen
    videoEl.srcObject = evt.streams[0];
    txtViewerStatus.innerText = 'Status: receiving stream';
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      // send ICE to host (server will forward)
      ws.send(JSON.stringify({ type: 'ice-candidate', target: 'host', candidate: evt.candidate, viewerId }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('PC state', pc.connectionState);
    if (pc.connectionState === 'connected') {
      txtViewerStatus.innerText = 'Connected';
      btnJoin.disabled = true;
    }
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') txtViewerStatus.innerText = 'Disconnected';
  };
}
