var sjsc = require('sockjs-client');
var noop = function() {};



var User = function(host) {
  this.socket = sjsc.create(host + "/christmas");

  this.user = {
    live: {}
  };
  
  this.me = {
    country: "US",
    transport: "xhr-streaming",
    browser: "test.js",
    version: "0.1",
    os: "node"
  };

  this.init();
}

User.prototype = {
  init: function() {
    var self = this;

    this.socket.on('connection', function () { 
      console.log("= Connection established")
    });

    this.socket.on('data', function (msg) {
      var data = JSON.parse(msg);
      (self[data._event] || noop).apply(self, [data]);
    });

    this.socket.on('error', function (e) { 
      console.log("Error: " + e);
    });
  },

  emit: function(event, data) {
    data = data || {};
    data._event = event;
    this.socket.write(JSON.stringify(data));
  },

  hello: function(data) {
    this.me.id = data._user_id;
    this.me.server = data.server;
    console.log("= Assigned ID: " + this.me.id);

    // server-overridden socket options
    for (var key in data.live)
      this.user.live[key] = data.live[key];

    // very simple heartbeat, only for server's sake
    var self = this;
    var heartbeat = setInterval(function() {
      self.emit('heartbeat', self.me)
    }, 3000);
    
    this.emit('arrive', this.me);
  },

  ratelimit: function(fn) {
    var last = (new Date()).getTime();
    return (function() {
      var now = (new Date()).getTime();
      if ((now - last) > this.user.live.mouse_rate) {
        last = now;
        fn.apply(null, arguments);
      }
    });
  }
}

/****** test client *****/
// test clients should send a bunch of events but not process received motion/etc
// the main purpose is to test server throughput,
// and to connect browser clients to the server while these are running,
// to observe how browsers handle many people sending events


function connect(host) {
  if (!host) host = "http://localhost:3000"
  return new User(host);
}

module.exports = {connect: connect};

/* test in repl with

var u = require("./test").connect();

*/