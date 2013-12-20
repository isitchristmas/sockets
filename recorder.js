// test this in REPL with:
/*
  id = require("./utils").generateId();
  c = require("./utils").config('development');
  m = require('./recorder')(id, c.recorder, require("./utils").logger(id, c))
*/

var redis = require('redis'),
    dateFormat = require('dateformat');

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

  // used by a sockets app to snap/save its own piece of the snapshot
  this.onClientSnapshot = function() {};
  this.currentSnapshot = [];

  this.log = log;
  this.init();
};


Recorder.prototype = {

  // admin kicks off snapshot of system state every 5s,
  // and archives 2s after kick-off of snapshot.
  startSnapshotting: function() {

    var self = this;
    this.clientTimer = setInterval(function() {
      // kick off snapshot, which each socket app will do immediately
      self.client.publish("get_snapshot", "now");

      // socket apps leave 1s window for connected clients to ring in.
      // thus, leave socket apps another 1s to write the snapshot,
      // before archiving the current snapshot.
      setTimeout(function() {
        self.archiveSnapshot.apply(self);
      }, 2000);
    }, 5000);
  },

  // only done to admin, will also stop archiving
  stopSnapshotting: function() {
    clearInterval(this.clientTimer);
  },

  // called by admin on stop/start of snapshotting
  clearSnapshot: function() {
    this.client.del("current_snapshot");
  },

  // called by socket app when connected client rings in
  snapshotData: function(connection, data) {
    if (!this.currentSnapshot) return;

    this.currentSnapshot.push({
      id: connection._user.id,
      country: connection._user.country,
      x: data.x,
      y: data.y,
      angle: data.angle
    });
  },

  // gets kicked off by admin every 5s -- asks connected clients to
  // report their current x/y and angle.
  // maintains a 1s window to receive answers from everyone.
  clientSnapshot: function() {
    var self = this;

    // send down the broadcasts
    this.log.debug("[recorder] beginning my client snapshot");
    this.currentSnapshot = [];
    this.onClientSnapshot();

    setTimeout(function() {
      // freeze and store snapshot collected in the last 1s
      var snapshot = JSON.stringify(self.currentSnapshot);
      self.currentSnapshot = null;

      self.client.hset("current_snapshot", self.serverId, snapshot);
      self.log.debug("[recorder] saved my client snapshot.");
    }, 1000);
  },

  // only the admin app does this, every 5s,
  // fetch the current_snapshot, parse it, save it
  archiveSnapshot: function() {
    var self = this;

    this.client.hgetall("current_snapshot", function(err, reply) {
      if (err) {
        self.rlog(self, err, reply, "getting just-published snapshot");
        return;
      }

      console.log(reply);

      var snaps = {};
      for (var server in reply)
        snaps[server] = JSON.parse(reply[server])

      // freeze into string, add to snapshot archive
      var time = dateFormat(new Date().getTime(), "yyyymmddHHMMss");
      var snap = [time, snaps];
      self.client.rpush("snapshots", JSON.stringify(snap));
      self.log.debug("[recorder] archived snapshot for " + time);
    });
  },

  // get the frozen JSON string of the current snapshot,
  // used by admin.js /snapshot endpoint.
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

  // listen for snapshot requests, only used by socket
  listen: function() {
    var self = this;
    this.sub.subscribe("get_snapshot");
    this.sub.on('message', function(channel, message) {
      if (channel == "get_snapshot")
        self.clientSnapshot.apply(self);
    })
  },

  // turn on and off, only used by admin
  turnOn: function() {
    this.on = true;
    this.clearSnapshot();
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