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
        var pieces = id.split(":");
        var server = pieces[0]
          , user = pieces[1]
          , country = reply[id];
        if (!users[server]) users[server] = [];
        users[server].push({id: user, country: country});
      });

      callback(users);
    });
  },


  // events:
  addUser: function(userId, country) {
    var self = this;
    this.client.hset("users", [this.serverId, userId].join(":"), country, function(err, reply) {
      if (reply == "1")
        self.rlog(self, err, reply, "adding user: " + userId, "info");
      else
        self.rlog(self, err, reply, "keeping user: " + userId, "debug");
    });
  },

  removeUser: function(userId, cause) {
    var self = this;
    this.client.hdel("users", [this.serverId, userId].join(":"), function(err, reply) {
      self.rlog(self, err, reply, cause + " user: " + userId);
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