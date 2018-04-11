/* eslint-env browser */

const PionEvents = window.PionEvents = {
  WEBSOCKET_OPEN: 'WEBSOCKET_OPEN',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
  WEBSOCKET_CLOSE: 'WEBSOCKET_CLOSE',
  MEDIA_START: 'MEDIA_START',
  MEDIA_STOP: 'MEDIA_STOP',
  PEER_ENTER_ROOM: 'PEER_ENTER_ROOM',
  PEER_LEAVE_ROOM: 'PEER_LEAVE_ROOM',
  PEER_P2P_MEDIA_STATUS: 'PEER_P2P_MEDIA_STATUS',
  PEER_P2P_SIGNALING_STATUS: 'PEER_P2P_SIGNALING_STATUS',
  ERROR: 'ERROR'
}

function PionSession (signalerUri, sessionParams, rtcPeerConfiguration) { // eslint-disable-line no-unused-vars
  if (!(this instanceof PionSession)) {
    return new PionSession(signalerUri, sessionParams, rtcPeerConfiguration)
  }

  const DEFAULT_RTC_PEER_CONFIG = {
    iceServers: [
      {'urls': `stun:turn.pion.ly`}
    ],
    mandatory: {OfferToReceiveVideo: true, OfferToReceiveAudio: true}
  }

  if (rtcPeerConfiguration === null || typeof rtcPeerConfiguration !== 'object') {
    rtcPeerConfiguration = DEFAULT_RTC_PEER_CONFIG
  }

  const startExchange = (ws, peerConnection, remoteSessionKey) => {
    let offer = null

    peerConnection
      .createOffer()
      .then(createdOffer => {
        offer = createdOffer
        return peerConnection.setLocalDescription(offer)
      })
      .then(() => ws.send(JSON.stringify({method: 'sdp', args: {dst: remoteSessionKey, sdp: offer.toJSON()}})))
      .catch(e => this.eventHandler({type: PionEvents.ERROR, message: 'Failed to create local offer', error: e}))
  }

  let peerConnections = {}
  let mediaStreams = []
  const getPeerConnection = (remoteSessionKey, ws) => {
    if (peerConnections[remoteSessionKey]) {
      return peerConnections[remoteSessionKey]
    }

    const pc = peerConnections[remoteSessionKey] = new RTCPeerConnection(rtcPeerConfiguration)
    pc.onicecandidate = event => {
      if (!event.candidate) {
        return
      }

      ws.send(JSON.stringify({method: 'candidate', args: {dst: remoteSessionKey, candidate: event.candidate.toJSON()}}))
    }

    pc.oniceconnectionstatechange = (event) => {
      this.eventHandler({type: PionEvents.PEER_P2P_MEDIA_STATUS, sessionKey: remoteSessionKey, mediaState: pc.iceConnectionState})
    }

    pc.onsignalingstatechange = (event) => {
      this.eventHandler({type: PionEvents.PEER_P2P_SIGNALING_STATUS, sessionKey: remoteSessionKey, signalingState: pc.signalingState})
    }

    let handledMediaStreamIds = []
    pc.ontrack = (event) => {
      let mediaStream = event.streams[0]
      let foundIndex = handledMediaStreamIds.indexOf(mediaStream.id)
      if (foundIndex !== -1) {
        return
      }
      handledMediaStreamIds.push(mediaStream.id)

      event.track.onended = () => {
        if (handledMediaStreamIds.indexOf(mediaStream.id) === -1) {
          return
        }
        handledMediaStreamIds = handledMediaStreamIds.filter(mediaStreamId => mediaStreamId !== mediaStream.id)
        this.eventHandler({type: PionEvents.MEDIA_STOP, media: mediaStream, sessionKey: remoteSessionKey})
      }

      this.eventHandler({type: PionEvents.MEDIA_START, media: mediaStream, sessionKey: remoteSessionKey})
    }

    for (let mediaStream of mediaStreams) {
      mediaStream.getTracks().forEach(track => pc.addTrack(track, mediaStream))
    }

    return pc
  }

  const handleMembers = (ws, args) => {
    args.members.forEach(remoteSessionKey => startExchange(ws, getPeerConnection(remoteSessionKey, ws), remoteSessionKey))
  }

  const handleSdp = (ws, args) => {
    const peerConnection = getPeerConnection(args.src, ws)
    let setRemoteDescPromise = peerConnection.setRemoteDescription(new RTCSessionDescription(args.sdp))
      .catch(e => this.eventHandler({type: PionEvents.ERROR, message: 'Failed to handle SDP', error: e}))
    if (args.sdp.type === 'answer') {
      return
    }

    let answer
    setRemoteDescPromise
      .then(() => peerConnection.createAnswer())
      .then(createdAnswer => {
        answer = createdAnswer
        peerConnection.setLocalDescription(answer)
      })
      .then(() => ws.send(JSON.stringify({method: 'sdp', args: {dst: args.src, sdp: answer.toJSON()}})))
  }
  const handleCandidate = (ws, args) => {
    const peerConnection = getPeerConnection(args.src, ws)
    peerConnection.addIceCandidate(new RTCIceCandidate(args.candidate))
      .catch(e => this.eventHandler({type: PionEvents.ERROR, message: 'Failed to add ice candidate', error: e}))
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

    ws = new WebSocket(`wss://${signalerUri}?${sessionParams}`)
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

  let mutatePeerMediaStreams = (mediaStream, mutation) => {
    for (let sessionKey in peerConnections) {
      let pc = peerConnections[sessionKey]

      if (mutation === 'addTrack') {
        mediaStream.getTracks().forEach(track => pc.addTrack(track, mediaStream))
      } else if (mutation === 'removeTrack') {
        let trackIds = mediaStream.getTracks().map(track => track.id)

        for (let rtpSender of pc.getSenders()) {
          if (trackIds.indexOf(rtpSender.track.id) !== -1) {
            pc.removeTrack(rtpSender)
          }
        }
      }
      startExchange(ws, pc, sessionKey)
    }
  }

  this.addMedia = mediaStream => {
    mediaStreams.push(mediaStream)
    mutatePeerMediaStreams(mediaStream, 'addTrack')
  }
  this.removeMedia = mediaStream => {
    mediaStreams = mediaStreams.filter(knownMediaStream => mediaStream.id !== knownMediaStream.id)
    mutatePeerMediaStreams(mediaStream, 'removeTrack')
  }
}

export { PionEvents, PionSession }
