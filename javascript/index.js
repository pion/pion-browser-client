const ws = new WebSocket('wss://signaler.pion.sh?apiKey=foobar');
ws.onopen = function() {
  ws.send('hello world')
};

navigator.getUserMedia({
    video: true
  },
  function(localMediaStream) {
    let el = document.getElementById('foobar')
    el.srcObject = localMediaStream
    el.onloadedmetadata = function(e) {
      el.play();
    };
  },
  function(err) {
    console.log('The following error occurred when trying to use getUserMedia: ' + err);
  }
);
