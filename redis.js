// test this in REPL with:
/*
  id = require("./utils").generateId();
  c = require("./config").development;
  m = require('./redis')(id, c.redis, require("./utils").logger(id, c))
*/

var redis = require('redis');

var Manager = function(serverId, config, log) {
  this.serverId = serverId;

  this.enabled = config.enabled;
  this.password = config.password;
  this.host = config.host;
  this.port = config.port;

  this.log = log;
  if (this.enabled) this.init();
};

Manager.prototype = {

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
  },

  removeUser: function(userId, cause) {
    var self = this;
    
    var key = [this.serverId, userId].join(":");

    this.client.hdel("users", key, function(err, reply) {
      var severity = (cause == "timing out" ? "warn" : "info");
      self.rlog(self, err, reply, cause + " user: " + userId, severity);
    })
  },

  // clears ALL users (not just this process')
  clearUsers: function(callback) {
    var self = this;
    this.client.del("users", function(err, reply) {
      self.rlog(self, err, reply, "clearing users");
      if (callback) callback();
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
  }
}

module.exports = function(serverId, config, log) {return new Manager(serverId, config, log);}