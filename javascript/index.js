const RTC_CONFIG = {iceServers: [{'urls': 'stun:stun.l.google.com:19302'}], mandatory: {OfferToReceiveVideo: true}}

const sessionKey = Math.random().toString(36).substring(7)
let peerConnections = {}
let getPeerConnection = (remoteSessionKey, localMediaStream, ws) => {
  if (peerConnections[remoteSessionKey]) {
    return peerConnections[remoteSessionKey]
  }

  let pc = peerConnections[remoteSessionKey] = new RTCPeerConnection(RTC_CONFIG)
  pc.onicecandidate = event => {
    if (!event.candidate) {
      return
    }

    ws.send(JSON.stringify({method: 'candidate', args: {src: sessionKey, dst: remoteSessionKey, candidate: event.candidate.toJSON()}}))
  }
  pc.ontrack = (event) => {
    let video = document.createElement('video')
    let container = document.getElementById('remotes')
    container.appendChild(video)

    video.srcObject = event.streams[0]
    video.onloadedmetadata = function(e) {
      video.play();
    }

  }
  localMediaStream.getTracks().forEach(track => pc.addTrack(track, localMediaStream))

  return pc
}

let handleMembers = (ws, args, localMediaStream) => {
  args.members.forEach(remoteSessionKey => {
    if (remoteSessionKey !== sessionKey) {
      let peerConnection = getPeerConnection(remoteSessionKey, localMediaStream, ws)
      peerConnection.createOffer(offer => {
        peerConnection.setLocalDescription(offer, () => {
          ws.send(JSON.stringify({method: 'sdp', args: {src: sessionKey, dst: remoteSessionKey, sdp: offer.toJSON()}}))
        })
      })
    }
  })
}

let handleSdp = (ws, args, localMediaStream) => {
  let peerConnection = getPeerConnection(args.src, localMediaStream, ws)
  peerConnection.setRemoteDescription(new RTCSessionDescription(args.sdp), () => {
    if (args.sdp.type === 'answer') {
      return
    }

    peerConnection.createAnswer(answer => {
      peerConnection.setLocalDescription(answer, () => {
        ws.send(JSON.stringify({method: 'sdp', args: {src: sessionKey, dst: args.src, sdp: answer.toJSON()}}))
      })
    })
  })
  console.log('handleSdp')
}
let handleCandidate = (ws, args, localMediaStream) => {
  let peerConnections = getPeerConnection(args.src, localMediaStream, ws)
  peerConnections.addIceCandidate(new RTCIceCandidate(args.candidate))
}


let wsOnMessage = (ws, event, localMediaStream) => {
  let message = JSON.parse(event.data);
  if (!message) {
    throw `Failed to parse ${event.data}`
  }

  let dispatchMethod
  switch (message.method) {
    case 'candidate':
      dispatchMethod = handleCandidate
      break
    case 'sdp':
      dispatchMethod = handleSdp
      break
    case 'members':
      dispatchMethod = handleMembers
      break
    default:
      throw `Failed to handle ${event.data}`
  }
  dispatchMethod(ws, message.args, localMediaStream)
}

navigator.getUserMedia({
  video: true
},
function(localMediaStream) {
  let el = document.getElementById('foobar')
  el.srcObject = localMediaStream
  el.onloadedmetadata = function(e) {
    el.play();
  };
  const ws = new WebSocket(`wss://signaler.pion.sh?sessionKey=${sessionKey}`)
  ws.onmessage = () => {
    wsOnMessage(ws, event, localMediaStream)
  }
},
function(err) {
  console.log('The following error occurred when trying to use getUserMedia: ' + err);
})
