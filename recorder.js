// test this in REPL with:
/*
  id = require("./utils").generateId();
  c = require("./utils").config('development');
  m = require('./recorder')(id, c.recorder, require("./utils").logger(id, c))
*/

var redis = require('redis');

var Recorder = function(serverId, config, log) {
  this.serverId = serverId;

  this.password = config.password;
  this.host = config.host;
  this.port = config.port;

  // default to 'on' - this is important for the admin app
  this.on = true;

  // will be the main redis client
  this.client = null;

  this.clientTimer = null;
  this.onClientSnapshot = function() {};
  this.currentSnapshot = [];

  this.log = log;
  this.init();
};


Recorder.prototype = {

  // save snapshot of system state every 5s
  startSnapshotting: function() {
    // admin doesn't snapshot
    if (this.serverId == "admin") return;

    var self = this;
    this.clientTimer = setInterval(function() {
      self.clientSnapshot.apply(self);
    }, 5000);
  },

  stopSnapshotting: function() {
    clearInterval(this.clientTimer);
  },

  clearSnapshot: function() {
    this.client.del("current_snapshot");
  },

  snapshotData: function(connection, data) {
    if (this.currentSnapshot) {
      this.currentSnapshot.push({
        id: connection._user.id,
        country: connection._user.country,
        x: data.x,
        y: data.y
      });
    }
  },

  // get the frozen JSON string of the current snapshot
  getSnapshot: function(callback) {
    var self = this;

    if (!this.on)
      return callback("{}");

    this.client.hgetall("current_snapshot", function(err, reply) {
      if (err) {
        self.rlog(self, err, reply, "getting users");
        return callback(null);
      }

      return callback(reply);
    });
  },

  // gets kicked off every 5s -- asks all clients to report their current x/y.
  // maintains a 1s window to receive answers from everyone.
  // then when it's done, publishes to a channel.
  clientSnapshot: function() {
    var self = this;

    // send down the broadcasts
    this.log.debug("[recorder] beginning client snapshot");
    this.currentSnapshot = [];
    this.onClientSnapshot();

    setTimeout(function() {
      // freeze and store snapshot collected in the last 1s
      var snapshot = JSON.stringify(self.currentSnapshot);
      self.currentSnapshot = null;

      self.client.hset("current_snapshot", self.serverId, snapshot);
      self.client.publish("client_snapshot", "done");
      self.log.debug("[recorder] saved client snapshot.");
    }, 1000);
  },

  init: function() {
    var self = this;

    var client = redis.createClient(this.port, this.host),
        sub = redis.createClient(this.port, this.host);

    ["error", "end", "connect", "ready"].forEach(function(message) {
      client.on(message, function(content) {
        self.log.warn("[recorder] client: " + message + (content ? ", " + content : ""));
      });
    });

    ["error", "end", "connect"].forEach(function(message) {
      sub.on(message, function(content) {
        self.log.warn("[recorder] sub: " + message + (content ? ", " + content : ""));
      });
    });

    if (this.password) {
      client.auth(this.password);
      sub.auth(this.password);
    }

    sub.on('subscribe', function(channel, count) {
      var severity = (channel == "heartbeat") ? "debug" : "warn";
      self.log(severity, "[recorder] subscribed to " + channel + " [" + count + "]");
    });

    sub.on('unsubscribe', function(channel, count) {
      self.log.warn("[recorder] unsubscribed from " + channel + "[" + count + "]");
    });

    sub.on('ready', function() {
      self.log.warn("[recorder] sub: ready");
    });

    sub._heartbeat = setInterval(function() {
      sub.subscribe('heartbeat');
    }, 30 * 1000);

    this.client = client;
    this.sub = sub;
  },

  subTo: function(channel) {
    var self = this;
    if (this.sub.ready)
      this.sub.subscribe(channel);
    else
      this.sub.on('ready', function() {self.sub.subscribe(channel)})
  },

  turnOn: function() {
    this.on = true;
    this.startSnapshotting();
  },

  turnOff: function() {
    this.on = false;
    this.clearSnapshot();
    this.stopSnapshotting();
  },

  rlog: function(self, err, reply, message, severity) {
    if (!severity) severity = "info";
    if (err)
      self.log.error("[recorder] ERROR " + message + "(" + err + ")");
    else
      self.log[severity]("[recorder] " + message + " (" + reply + ")");
  }
}

module.exports = function(serverId, config, log) {return new Recorder(serverId, config, log);}