/* eslint-env browser */

const PionEvents = window.PionEvents = {
  WEBSOCKET_OPEN: 'WEBSOCKET_OPEN',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
  WEBSOCKET_CLOSE: 'WEBSOCKET_CLOSE',
  NEW_MEDIA: 'NEW_MEDIA',
  PEER_ENTER_ROOM: 'PEER_ENTER_ROOM',
  PEER_LEAVE_ROOM: 'PEER_LEAVE_ROOM',
  PEER_P2P_MEDIA_STATUS: 'PEER_P2P_MEDIA_STATUS',
  PEER_P2P_SIGNALING_STATUS: 'PEER_P2P_SIGNALING_STATUS'
}

function PionSession (domain, authToken, mediaStream) { // eslint-disable-line no-unused-vars
  if (!(this instanceof PionSession)) {
    return new PionSession(domain, authToken, mediaStream)
  }

  const SESSION_KEY = JSON.parse(atob(authToken.split('.')[1])).sessionKey
  const RTC_CONFIG = {
    iceServers: [{'urls': 'stun:stun.l.google.com:19302'}],
    mandatory: {OfferToReceiveVideo: true, OfferToReceiveAudio: true}
  }

  let peerConnections = {}
  const getPeerConnection = (remoteSessionKey, ws) => {
    if (peerConnections[remoteSessionKey]) {
      return peerConnections[remoteSessionKey]
    }

    const pc = peerConnections[remoteSessionKey] = new RTCPeerConnection(RTC_CONFIG)
    pc.onicecandidate = event => {
      if (!event.candidate) {
        return
      }

      ws.send(JSON.stringify({method: 'candidate', args: {src: SESSION_KEY, dst: remoteSessionKey, candidate: event.candidate.toJSON()}}))
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

  const handleMembers = (ws, args) => {
    args.members.forEach(remoteSessionKey => {
      if (remoteSessionKey !== SESSION_KEY) {
        const peerConnection = getPeerConnection(remoteSessionKey, ws)
        peerConnection.createOffer(offer => {
          peerConnection.setLocalDescription(offer, () => {
            ws.send(JSON.stringify({method: 'sdp', args: {src: SESSION_KEY, dst: remoteSessionKey, sdp: offer.toJSON()}}))
          })
        })
      }
    })
  }

  const handleSdp = (ws, args) => {
    const peerConnection = getPeerConnection(args.src, ws)
    peerConnection.setRemoteDescription(new RTCSessionDescription(args.sdp), () => {
      if (args.sdp.type === 'answer') {
        return
      }

      peerConnection.createAnswer(answer => {
        peerConnection.setLocalDescription(answer, () => {
          ws.send(JSON.stringify({method: 'sdp', args: {src: SESSION_KEY, dst: args.src, sdp: answer.toJSON()}}))
        })
      })
    })
  }
  const handleCandidate = (ws, args) => {
    const peerConnection = getPeerConnection(args.src, ws)
    peerConnection.addIceCandidate(new RTCIceCandidate(args.candidate))
  }

  const removePeer = remoteSessionKey => {
    const peerConnection = peerConnections[remoteSessionKey]
    if (peerConnection) {
      peerConnection.close()
      delete peerConnections[remoteSessionKey]
    }
    this.eventHandler({type: PionEvents.PEER_LEAVE_ROOM, sessionKey: remoteSessionKey})
  }

  const handleExit = (ws, args) => {
    removePeer(args.sessionKey)
  }

  const handlePing = (ws, args) => {
    ws.send(JSON.stringify({method: 'pong'}))
  }

  const MAX_TIMEOUT = 2500
  const STEP_TIMEOUT = 500

  let currentTimeout = 0
  let ws = null
  let disableReconnect = false

  const websocketLoop = () => {
    if (currentTimeout >= MAX_TIMEOUT) {
      currentTimeout = 0
    }
    currentTimeout += STEP_TIMEOUT

    ws = new WebSocket(`wss://${domain}?authToken=${authToken}`)
    ws.onmessage = () => {
      let message = JSON.parse(event.data)
      if (!message) {
        throw new Error(`Failed to parse ${event.data}`)
      }

      let dispatchMethods = {
        'candidate': handleCandidate,
        'sdp': handleSdp,
        'members': handleMembers,
        'exit': handleExit,
        'ping': handlePing
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
      for (var key in peerConnections) {
        removePeer(key)
      }
      peerConnections = {}

      this.eventHandler({type: PionEvents.WEBSOCKET_CLOSE, event})
      if (!disableReconnect) {
        setTimeout(websocketLoop, currentTimeout)
      }
    }
    ws.onopen = event => {
      this.eventHandler({type: PionEvents.WEBSOCKET_OPEN, event})
    }
  }

  let started = false
  this.start = () => {
    if (!this.eventHandler) {
      throw new Error('You must set an event handler')
    }

    if (started) {
      throw new Error('PionSession may only be started once')
    }
    started = true

    websocketLoop()
  }

  this.stop = () => {
    if (ws) {
      ws.close()
    }
  }
}

export { PionEvents, PionSession }
