// test this in REPL with:
/*
  id = require("./utils").generateId();
  c = require("./config").development;
  m = require('./redis')(id, c.redis, require("./utils").logger(id, c))
*/

var redis = require('redis'),
    dateFormat = require('dateformat'),
    os = require('os'),
    time = require('time')(Date);

var Manager = function(serverId, config, log) {
  this.serverId = serverId;

  this.password = config.password;
  this.host = config.host;
  this.port = config.port;

  this.onConfig = this.onCommand = this.onChat = function() {};

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

        // convert user time to EST, for my own sanity in watching activity
        var estTime = new Date(parseInt(valuePieces[5]));
        estTime.setTimezone("America/New_York");

        var server = keyPieces[0];
        var user = {
          id: keyPieces[1],
          country: valuePieces[0],
          transport: valuePieces[1],
          browser: valuePieces[2],
          version: valuePieces[3],
          os: valuePieces[4],
          time: estTime
        };

        if (!users[server]) users[server] = [];
        users[server].push(user);
      });

      callback(users);
    });
  },

  // a user has joined, add them to the list and log a bunch of analytics about them
  addUser: function(connection, user, heartbeat) {
    var self = this;

    var key = [this.serverId, connection._user.id].join(":");
    var value = [
      connection._user.country,
      user.transport,
      user.browser,
      user.version,
      user.os,
      Date.now()
    ].join(":");

    this.client.hset("users", key, value, function(err, reply) {
      if (reply == "1")
        self.rlog(self, err, reply, "adding user: " + connection._user.id, "info");
      else
        self.rlog(self, err, reply, "keeping user: " + connection._user.id, "debug");
    });

    if (!heartbeat) {
      if (user.alreadyArrived)
        this.logReconnect(user);
      else
        this.logVisit(user);
    }
  },

  // a user has left, mark that, and if it was a timeout, warn and log it
  removeUser: function(userId, cause) {
    var self = this;

    var key = [this.serverId, userId].join(":");

    this.client.hdel("users", key, function(err, reply) {
      //var severity = (cause == "timed out" ? "warn" : "info");
      var severity = "info"; // always info, timeouts are just frequent
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

  // log number of reconnects all-time, today, and in a 10-minute span
  logReconnect: function(user) {
    var self = this;
    var now = new Date();

    var date = dateFormat(now.getTime(), "mmdd");

    var minutes = now.getMinutes();
    minutes = minutes - (minutes % 10); // round down to 10-minute floor
    minutes = (minutes < 10) ? ("0" + minutes) : ("" + minutes); // 0-prefix
    var span = date + dateFormat(now.getTime(), "HH") + minutes;

    ["all", date, span].forEach(function(prefix) {
      self.client.incr(prefix + ":reconnects");
    });
  },

  // store anonymous visit analytics
  // vital to understanding who is and isn't able to establish connections,
  // especially when compared to conventional metrics like Google Analytics
  logVisit: function(user) {
    var self = this;
    var date = dateFormat(Date.now(), "mmdd");

    // accumulate counters of various combos
    // accumulate both for all-time, and for the date (mmdd:*)

    // not sure where this would come from, but I see it now and then
    if (!user.browser || !user.os || !user.transport || !user.country) {
      self.log.error("possible sadd issue");
      self.log.error("user.browser: " + user.browser);
      self.log.error("user.os: " + user.os);
      self.log.error("user.transport: " + user.transport);
      self.log.error("user.country: " + user.country);
      user.browser = user.browser || "unknown";
      user.os = user.os || "unknown";
      user.transport = user.transport || "unknown";
      user.country = user.country || "unknown";
    }

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
        ["bo", user.browser, user.os].join("-"),
        ["bt", user.browser, user.transport].join("-"),
        ["bv", user.browser, user.version].join("-"),
        ["bvt", user.browser, user.version, user.transport].join("-")
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
    var self = this;

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

    // save snapshot of system state every 5s
    client._system = setInterval(function() {
      self.systemSnapshot.apply(self);
    }, 5000);

    sub.on('message', function(channel, message) {
      if (channel == "command") {
        var args = message.split(":");
        var command = args.shift();
        self.onCommand(command, args);
      } else if (channel == "chat") {
        // don't delimit with colons, human expression online is primarily colon based
        var pieces = message.split("|");
        self.onChat(pieces[0], pieces[2], pieces[3], pieces[4]);
      } else { // "client", "server"
        var pieces = message.split(":");
        self.onConfig(channel, pieces[0], pieces[1]);
        self.saveConfig(pieces[0], pieces[1]);
      }
    });

    sub.on('subscribe', function(channel, count) {
      var severity = (channel == "heartbeat") ? "debug" : "warn";
      log(severity, "[redis] subscribed to " + channel + " [" + count + "]");
    });

    sub.on('unsubscribe', function(channel, count) {
      log.warn("[redis] unsubscribed from " + channel + "[" + count + "]");
    });

    sub.on('ready', function() {
      log.warn("[redis] sub: ready");
      sub.subscribe("client");
      sub.subscribe("server");
      sub.subscribe("command");
      sub.subscribe("chat");
    });

    sub._heartbeat = setInterval(function() {
      sub.subscribe('heartbeat');
    }, 30 * 1000);

    this.client = client;
    this.sub = sub;
  },

  newChat: function(id, time, name, country, message) {
    // clean name and message of delimiters
    name = name.replace(/\|/g, "/");
    message = message.replace(/\|/g, "/");

    var line = [id, time, name, country, message].join("|");
    this.client.publish("chat", line);
    this.client.rpush("chat", line);

    this.log.warn("[chat] [" + id + "] [" + country + "] " + name + ": " + message);
  },

  isBanned: function(id, callback) {
    this.client.sismember("banned", id, function(err, reply) {
      callback(reply == "1");
    });
  },

  systemSnapshot: function() {
    var loadavg = os.loadavg();
    var state = [
      os.totalmem().toString().slice(0, -6),
      os.freemem().toString().slice(0, -6),
      process.memoryUsage().rss.toString().slice(0, -6),
      loadavg[0].toString().slice(0, 4),
      loadavg[1].toString().slice(0, 4),
      loadavg[2].toString().slice(0, 4)
    ].join(":");

    this.client.hset("system", this.serverId, state);
  },

  getSystem: function(callback) {
    var self = this;

    this.client.hgetall("system", function(err, reply) {
      if (err) {
        self.rlog(self, err, reply, "getting system snapshot");
        return callback(null);
      }
      if (!reply) return callback(null);

      var system = {};
      Object.keys(reply).forEach(function(id, i) {
        var serverId = id;
        var pieces = reply[id].split(":");

        system[serverId] = {
          totalmem: pieces[0],
          freemem: pieces[1],
          rss: pieces[2],
          loadavg0: pieces[3],
          loadavg1: pieces[4],
          loadavg2: pieces[5]
        };
      });

      callback(system);
    });
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