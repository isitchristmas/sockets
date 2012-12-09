// test this in REPL with:
/*
  id = require("./utils").generateId();
  c = require("./config").development;
  m = require('./redis')(id, c.redis, require("./utils").logger(id, c))
*/

var redis = require('redis')
  , dateFormat = require('dateformat');

var Manager = function(serverId, config, log) {
  this.serverId = serverId;

  this.password = config.password;
  this.host = config.host;
  this.port = config.port;
  this.default_live = config.default_live;

  // noop
  this.onClient = this.onServer = this.onCommand = function() {};

  this.log = log;
  this.init();
};

Manager.prototype = {

  // return hash indexed by serverId with array of user objects
  allUsers: function(callback) {
    var self = this;

    this.client.hgetall("users", function(err, reply) {
      if (err) {
        self.rlog(self, err, reply, "getting users");
        return callback(null);
      }
      if (!reply) return callback([]);

      var users = {};
      Object.keys(reply).forEach(function(id, i) {
        var keyPieces = id.split(":");
        var valuePieces = reply[id].split(":");

        var server = keyPieces[0];
        var user = {
          id: keyPieces[1],
          country: valuePieces[0],
          transport: valuePieces[1],
          browser: valuePieces[2],
          version: valuePieces[3],
          os: valuePieces[4],
          time: valuePieces[5]
        };

        if (!users[server]) users[server] = [];
        users[server].push(user);
      });

      callback(users);
    });
  },

  // a user has joined, add them to the list and log a bunch of analytics about them
  addUser: function(user) {
    var self = this;

    var key = [this.serverId, user.id].join(":");
    var value = [
      user.country, 
      user.transport, 
      user.browser, 
      user.version,
      user.os,
      user.time
    ].join(":");

    this.client.hset("users", key, value, function(err, reply) {
      if (reply == "1")
        self.rlog(self, err, reply, "adding user: " + user.id, "info");
      else
        self.rlog(self, err, reply, "keeping user: " + user.id, "debug");
    });

    this.logVisit(user);
  },

  // a user has left, mark that, and if it was a timeout, warn and log it
  removeUser: function(userId, cause) {
    var self = this;
    
    var key = [this.serverId, userId].join(":");

    this.client.hdel("users", key, function(err, reply) {
      var severity = (cause == "timed out" ? "warn" : "info");
      self.rlog(self, err, reply, cause + " user: " + userId, severity);
    })

    if (cause == "timed out")
      this.logTimeout();
  },

  // clears ALL users (not just this process').
  // useful to do whenever there's a risk of a server having crashed without
  // clearing its own users, because still-connected users will re-add
  // themselves through heartbeats without trouble (and their connection time
  // will stay correct because it gets generated client-side)
  clearUsers: function() {
    var self = this;
    this.client.del("users", function(err, reply) {
      self.rlog(self, err, reply, "clearing users");
    });
  },

  // store anonymous visit analytics
  // vital to understanding who is and isn't able to establish connections,
  // especially when compared to conventional metrics like Google Analytics
  logVisit: function(user) {
    var self = this;
    var date = dateFormat(Date.now(), "mmdd");
    var key = [this.serverId, user.id].join(":");

    // accumulate counters of various combos
    // accumulate both for all-time, and for the date (mmdd:*)

    ["all:", date + ":"].forEach(function(prefix) {
      self.client.sadd(prefix + "browsers", user.browser);
      self.client.sadd(prefix + "oses", user.os);
      self.client.sadd(prefix + "transports", user.transport);
      self.client.sadd(prefix + "countries", user.country);

      [
        "visitors",
        ["c", user.country].join("-"),
        ["ct", user.country, user.transport].join("-"),
        ["t", user.transport].join("-"),
        ["o", user.os].join("-"),
        ["b", user.browser].join("-"),
        ["bv", user.browser, user.version].join("-"),
        ["bvo", user.browser, user.version, user.os].join("-"),
        ["bvot", user.browser, user.version, user.os, user.transport].join("-")
      ].forEach(function(key) {
        self.client.incr(prefix + key);
      })
    });
    
  },

  // store records of timeouts, though we don't have user-specific info here
  logTimeout: function() {
    var self = this;
    var date = dateFormat(Date.now(), "mmdd");

    ["all:", date + ":"].forEach(function(prefix) {
      self.client.incr(prefix + "timeouts");
    });
  },

  // new servers register on boot, helps give me an idea of how often servers
  // run out of memory, crash, and restart
  logNewServer: function() {
    var self = this;
    var date = dateFormat(Date.now(), "mmdd");

    ["all:", date + ":"].forEach(function(prefix) {
      self.client.sadd(prefix + "servers", self.serverId);
    });
  },

  init: function() {
    var client = redis.createClient(this.port, this.host)
      , sub = redis.createClient(this.port, this.host)
      , log = this.log
      , self = this;

    ["error", "end", "connect", "ready"].forEach(function(message) {
      client.on(message, function () {
        log.warn("[redis] client: " + message);
      });
    });

    ["error", "end", "connect"].forEach(function(message) {
      sub.on(message, function () {
        log.warn("[redis] sub: " + message);
      });
    });

    if (this.password) {
      client.auth(this.password);
      sub.auth(this.password);
    }

    sub.on('message', function(channel, message) {
      if (channel == "command") {
        var args = message.split(":");
        var command = args.shift();
        self.onCommand(command, args);
      } else { // "client", "server"
        var pieces = message.split(":");
        self.onConfig(channel, pieces[0], pieces[1]);
        self.saveConfig(pieces[0], pieces[1]);
      }
    });

    sub.on('subscribe', function(channel, count) {
      log.warn("[redis] subscribed to " + channel + " [" + count + "]");
    });

    sub.on('unsubscribe', function(channel, count) {
      log.warn("[redis] unsubscribed from " + channel + "[" + count + "]");
    });

    sub.on('ready', function() {
      log.warn("[redis] sub: ready");
      sub.subscribe("client");
      sub.subscribe("server");
      sub.subscribe("command");
    });

    sub._heartbeat = setInterval(function() {
      sub.subscribe('heartbeat');
    }, 30 * 1000);

    this.client = client;
    this.sub = sub;
  },

  // load the current live config (on server start)
  // used to initialize incoming clients to the current live config
  loadConfig: function(callback) {
    var self = this;
    this.client.hgetall("live", function(err, reply) {
      if (err) {
        self.rlog(self, err, reply, "Error fetching live config");
        callback(null, err);
      }

      callback(reply || {});
    });
  },

  // will be updated on publish events to client/server config
  // will be updated redundantly by every connected server, but whatever
  saveConfig: function(key, value) {
    var self = this;
    this.client.hset("live", key, value, function(err, reply) {
      if (err)
        self.rlog(self, err, reply, "updating live config: " + key + " -> " + value);
    });
  },

  rlog: function(self, err, reply, message, severity) {
    if (!severity) severity = "info";
    if (err)
      self.log.error("[redis] ERROR " + message + "(" + err + ")");
    else
      self.log[severity]("[redis] " + message + " (" + reply + ")");
  },

  // not used right now, could be to diagnose a problem
  rror: function(err, reply) {
    if (err)
      console.log("[redis] ERROR UNEXPECTED: " + err);
  }
}

module.exports = function(serverId, config, log) {return new Manager(serverId, config, log);}