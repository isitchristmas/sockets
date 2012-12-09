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

  this.log = log;
  this.init();
};

Manager.prototype = {

  loadConfig: function(callback) {
    var self = this;
    this.client.hgetall("live", function(err, reply) {
      if (err) {
        self.rlog(self, err, reply, "Error fetching live config");
        callback(null, err);
      }

      // if the db has nothing, use config.js
      if (reply == null) 
        callback(self.default_live);
      else
        callback(reply);
    });
  },

  // return hash indexed by serverId with array of {id, country} objects
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


  // events:
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

  // clears ALL users (not just this process')
  clearUsers: function() {
    var self = this;
    this.client.del("users", function(err, reply) {
      self.rlog(self, err, reply, "clearing users");
    });
  },

  // store visits forever
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

  logTimeout: function() {
    var self = this;
    var date = dateFormat(Date.now(), "mmdd");

    ["all:", date + ":"].forEach(function(prefix) {
      self.client.incr(prefix + "timeouts");
    });
  },

  logNewServer: function() {
    var self = this;
    var date = dateFormat(Date.now(), "mmdd");

    ["all:", date + ":"].forEach(function(prefix) {
      self.client.sadd(prefix + "servers", self.serverId);
    });
  },

  init: function() {
    var client = redis.createClient(this.port, this.host)
      , log = this.log;

    ["error", "end", "connect", "ready"].forEach(function(message) {
      client.on(message, function () {
        log.warn("[redis] client: " + message);
      });
    });

    if (this.password)
      client.auth(this.password);

    this.client = client;
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
