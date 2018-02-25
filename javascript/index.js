/* eslint-env browser */

let PionEvents = window.PionEvents = {
  WEBSOCKET_OPEN: 'WEBSOCKET_OPEN',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
  WEBSOCKET_CLOSE: 'WEBSOCKET_CLOSE',
  NEW_MEDIA: 'NEW_MEDIA',
  PEER_ENTER_ROOM: 'PEER_ENTER_ROOM',
  PEER_LEAVE_ROOM: 'PEER_LEAVE_ROOM',
  PEER_P2P_MEDIA_STATUS: 'PEER_P2P_MEDIA_STATUS',
  PEER_P2P_SIGNALING_STATUS: 'PEER_P2P_SIGNALING_STATUS'
}

function PionSession (domain, sessionKey, mediaStream) { // eslint-disable-line no-unused-vars
  if (!(this instanceof PionSession)) {
    return new PionSession(domain, sessionKey, mediaStream)
  }

  let peerConnections = {}
  let getPeerConnection = (remoteSessionKey, ws) => {
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

    pc.oniceconnectionstatechange = (event) => {
      this.eventHandler({type: PionEvents.PEER_P2P_MEDIA_STATUS, sessionKey: remoteSessionKey, mediaState: pc.iceConnectionState})
    }

    pc.onsignalingstatechange = (event) => {
      this.eventHandler({type: PionEvents.PEER_P2P_SIGNALING_STATUS, sessionKey: remoteSessionKey, signalingState: pc.signalingState})
    }

    let hasHandled = false
    pc.ontrack = (event) => {
      if (hasHandled) {
        return
      }
      hasHandled = true
      this.eventHandler({type: PionEvents.NEW_MEDIA, media: event.streams[0], sessionKey: remoteSessionKey})
    }
    mediaStream.getTracks().forEach(track => pc.addTrack(track, mediaStream))

    return pc
  }

  let handleMembers = (ws, args) => {
    args.members.forEach(remoteSessionKey => {
      if (remoteSessionKey !== sessionKey) {
        let peerConnection = getPeerConnection(remoteSessionKey, ws)
        peerConnection.createOffer(offer => {
          peerConnection.setLocalDescription(offer, () => {
            ws.send(JSON.stringify({method: 'sdp', args: {src: sessionKey, dst: remoteSessionKey, sdp: offer.toJSON()}}))
          })
        })
      }
    })
  }

  let handleSdp = (ws, args) => {
    let peerConnection = getPeerConnection(args.src, ws)
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
  }
  let handleCandidate = (ws, args) => {
    let peerConnection = getPeerConnection(args.src, ws)
    peerConnection.addIceCandidate(new RTCIceCandidate(args.candidate))
  }

  let handleExit = (ws, args) => {
    let peerConnection = getPeerConnection(args.src, mediaStream, ws)
    if (peerConnection) {
      peerConnection.close()
    }
    this.eventHandler({type: PionEvents.PEER_LEAVE_ROOM, sessionKey: args.sessionKey})
  }

  const RTC_CONFIG = {
    iceServers: [{'urls': 'stun:stun.l.google.com:19302'}],
    mandatory: {OfferToReceiveVideo: true, OfferToReceiveAudio: true}
  }

  this.start = () => {
    if (!this.eventHandler) {
      throw new Error('You must set an event handler')
    }
    const ws = new WebSocket(`wss://${domain}?sessionKey=${sessionKey}`)
    ws.onmessage = () => {
      let message = JSON.parse(event.data)
      if (!message) {
        throw new Error(`Failed to parse ${event.data}`)
      }

      let dispatchMethods = {
        'candidate': handleCandidate,
        'sdp': handleSdp,
        'members': handleMembers,
        'exit': handleExit
      }

      if (!dispatchMethods[message.method]) {
        throw new Error(`Failed to handle ${event.data}`)
      }
      dispatchMethods[message.method](ws, message.args)
    }

    ws.onerror = event => {
      this.eventHandler({type: PionEvents.WEBSOCKET_ERROR, event})
    }
    ws.onclose = event => {
      this.eventHandler({type: PionEvents.WEBSOCKET_CLOSE, event})
    }
    ws.onopen = event => {
      this.eventHandler({type: PionEvents.WEBSOCKET_OPEN, event})
    }
  }
}
