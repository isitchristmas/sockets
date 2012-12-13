var sjsc = require('sockjs-client');
var noop = function() {};


function start() {
  for (var n=0; n<4; n++)
    new User("http://localhost:3000", n);
}

/****** test client *****/
// test clients should send a bunch of events but not process received motion/etc
// the main purpose is to test server throughput,
// and to connect browser clients to the server while these are running,
// to observe how browsers handle many people sending events



var mouse_rate = 40;
var move_rate = 10;

var User = function(host, n) {
  if (!n) n = 0;
  
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

  this.n = n;
  this.x = 0;
  this.y = 0;
  this.leg = 1;

  this.host = host;
  this.init();
}

User.prototype = {
  init: function() {
    var self = this;

    this.socket = sjsc.create(this.host + "/christmas");

    this.socket.on('connection', function () { 
      console.log("= Connected: " + self.n)
    });

    this.socket.on('data', function (msg) {
      var data = JSON.parse(msg);
      (self.events[data._event] || noop).apply(self, [data]);
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

  events: {
    arrive: function(data) {
      this.emit("here", {
        to: data.id,
        id: this.me.id,
        country: this.me.country,
        transport: this.me.transport
      });
    },

    hello: function(data) {
      this.me.id = data._user_id;
      this.me.server = data.server;
      // console.log("= Assigned ID: " + this.me.id);

      // server-overridden socket options
      for (var key in data.live)
        this.user.live[key] = data.live[key];

      // very simple heartbeat, only for server's sake
      var self = this;
      var heartbeat = setInterval(function() {
        self.emit('heartbeat', self.me)
      }, 3000);

      this.emit('arrive', this.me);

      // kick off automated motion
      var motion = setInterval(function() {
        self.move.apply(self);
      }, mouse_rate);
    }
  },

  move: function() {
    this.emit('motion', {
      x: this.x + (this.n * 10),
      y: this.y + (this.n * 10),
      id: this.me.id,
      country: this.me.country
    });

    if (this.leg == 1) {
      if (this.x < 400)
        this.x += move_rate;
      else
        this.leg = 2;
    }
    if (this.leg == 2) {
      if (this.y < 400)
        this.y += move_rate;
      else
        this.leg = 3;
    }
    if (this.leg == 3) {
      if (this.x > 0)
        this.x -= move_rate;
      else
        this.leg = 4;
    }
    if (this.leg == 4) {
      if (this.y > 0)
        this.y -= move_rate;
      else
        this.leg = 1;
    }
  }
  
}

start();