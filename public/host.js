// host.js
// Responsible for capturing screen and creating a PeerConnection per viewer

const btnStartShare = document.getElementById('btnStartShare');
const txtRoom = document.getElementById('txtRoom');
const txtStatus = document.getElementById('txtStatus');
const viewersList = document.getElementById('viewersList');

const ws = new WebSocket(`ws://${location.host}`);
ws.onopen = () => console.log('Signaling WS open (host)');
ws.onmessage = onSignalMessage;

let roomId = null;
let localStream = null;
// map viewerId -> RTCPeerConnection and sender
const pcs = {}; // { viewerId: { pc, sender } }

async function startSharing() {
  try {
    // Request high-quality capture. Browsers decide what they can provide.
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });

    // create room
    ws.send(JSON.stringify({ type: 'create-room' }));
    txtStatus.innerText = 'Status: created room (waiting for viewers)';

    // track ended handler
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      // close all peer connections
      Object.keys(pcs).forEach(vid => closeViewer(vid));
      txtStatus.innerText = 'Status: screen sharing stopped';
      btnStartShare.disabled = false;
      txtRoom.innerText = 'Room: (none)';
    });

    btnStartShare.disabled = true;
  } catch (err) {
    alert('Could not start screen capture: ' + err.message);
    console.error(err);
  }
}

btnStartShare.onclick = startSharing;

// receive signaling messages from server
async function onSignalMessage(evt) {
  let data;
  try { data = JSON.parse(evt.data); } catch (e) { return; }

  if (data.type === 'room-created') {
    roomId = data.roomId;
    txtRoom.innerText = `Room: ${roomId}`;
    txtStatus.innerText = 'Status: ready for viewers';
    return;
  }

  if (data.type === 'viewer-joined') {
    // a viewer joined - create PC and send offer
    const viewerId = data.viewerId;
    await createOfferForViewer(viewerId);
    return;
  }

  if (data.type === 'answer') {
    const { viewerId, sdp } = data;
    const entry = pcs[viewerId];
    if (!entry) return;
    await entry.pc.setRemoteDescription({ type: 'answer', sdp });
    txtStatus.innerText = `Status: connected to ${viewerId}`;
    return;
  }

  if (data.type === 'ice-candidate') {
    const { candidate, viewerId } = data;
    const entry = pcs[viewerId];
    if (entry && candidate) {
      try { await entry.pc.addIceCandidate(candidate); } catch (e) { console.warn(e); }
    }
    return;
  }

  if (data.type === 'viewer-left') {
    const { viewerId } = data;
    closeViewer(viewerId);
    return;
  }

  if (data.type === 'host-left') {
    // shouldn't happen for host
  }
}

// create a new RTCPeerConnection for each viewer
async function createOfferForViewer(viewerId) {
  if (!localStream) {
    console.warn('No local stream yet; cannot create offer.');
    return;
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // forward ICE candidates to viewer via server
  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      ws.send(JSON.stringify({ type: 'ice-candidate', target: 'viewer', candidate: evt.candidate, viewerId }));
    }
  };

  // add the screen track(s) to the connection
  const videoTrack = localStream.getVideoTracks()[0];
  const sender = pc.addTrack(videoTrack, localStream);

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // store pc and sender so we can adjust params and close later
  pcs[viewerId] = { pc, sender };

  // send offer to viewer via server
  ws.send(JSON.stringify({ type: 'offer', viewerId, sdp: offer.sdp }));

  // after creating the offer, try to set desired encoding parameters
  try {
    // adjust encoding parameters for higher quality
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    // Configure max bitrate and scaleResolutionDownBy to request higher quality
    params.encodings[0].maxBitrate = 5_000_000; // 5 Mbps target
    params.encodings[0].maxFramerate = 60;     // target 60 fps (best-effort)
    // optional: reduce resolution scaling (1 = full)
    params.encodings[0].scaleResolutionDownBy = 1;
    await sender.setParameters(params);
    console.log('Set sender parameters for viewer', viewerId, params);
  } catch (e) {
    console.warn('Could not set sender parameters:', e);
  }

  // UI
  const li = document.createElement('div');
  li.id = `viewer-${viewerId}`;
  li.innerText = `Viewer ${viewerId} — connecting...`;
  viewersList.appendChild(li);
}

function closeViewer(viewerId) {
  const entry = pcs[viewerId];
  if (!entry) return;
  try { entry.pc.close(); } catch (e) {}
  delete pcs[viewerId];
  const el = document.getElementById(`viewer-${viewerId}`);
  if (el) el.remove();
}
