var crypto = require('crypto');
var names = require('./names');
var badwords = require('badwords/regexp');

var severities = {error: 1, warn: 1, info: 2, debug: 3};

module.exports = {

  generateId: function(limit) {
    var rand = new Buffer(15); // multiple of 3 for base64
    if (!rand.writeInt32BE) {
      return Math.abs(Math.random() * Math.random() * Date.now() | 0).toString()
        + Math.abs(Math.random() * Math.random() * Date.now() | 0).toString();
    }
    var n = 0;
    rand.writeInt32BE(n, 11);
    if (crypto.randomBytes) {
      crypto.randomBytes(12).copy(rand);
    } else {
      // not secure for node 0.4
      [0, 4, 8].forEach(function(i) {
        rand.writeInt32BE(Math.random() * Math.pow(2, 32) | 0, i);
      });
    }

    if (!limit) limit = 16;
    return rand.toString('base64').
      replace(/\//g, '_').
      replace(/\+/g, '-').
      slice(0, limit);
  },

  logger: function(serverId, config) {
    // default to error msgs only
    var log_level = (process.env.LOG || config.log || 1);

    var func;

    if (config.logentries) {
      var logger = require('node-logentries').logger({
        token: config.logentries
      });
      var winston = require('winston');
      logger.winston(winston, {});
      winston.handleExceptions(new winston.transports.LogentriesLogger({}));

      func = function(severity, message) {
        if (log_level >= severities[severity]) {
          var msg = "[" + serverId + "] " + message;
          (winston[severity] || winston.error)(msg);
        }
      }
    } else {
      func = function(severity, message) {
        if (log_level >= severities[severity])
          console.log("[" + serverId + "] " + message);
      }
    }

    // shortcuts: log.warn, log.info, etc.
    ["warn", "info", "debug", "error"].forEach(function(severity) {
      func[severity] = function(message) {func(severity, message)};
    });

    return func;
  },

  randomName: function() {
    return names[Math.floor(Math.random() * names.length)];
  },

  rejectText: function(text) {
    return badwords.test(text);
  },

  // if DEPLOYMENT=heroku, use environment variables to populate
  //   a config.js replacement, then return it.
  // otherwise, if config.js is present, loads and
  //   returns it with the requested env.
  config: function(env) {
    if (process.env.DEPLOYMENT == "env") {
      return {
        log: parseInt(process.env.LOG_LEVEL, 10),
        admin: process.env.ADMIN_PASSWORD,
        manager: {
          port: parseInt(process.env.MANAGER_PORT, 10),
          host: process.env.MANAGER_HOST,
          password: process.env.MANAGER_PASSWORD
        },
        recorder: {
          port: parseInt(process.env.RECORDER_PORT, 10),
          host: process.env.RECORDER_HOST,
          password: process.env.RECORDER_PASSWORD
        },
        live: {
          chat: process.env.LIVE_CHAT,
          death_interval: parseInt(process.env.LIVE_DEATH_INTERVAL, 10),
          heartbeat_interval: parseInt(process.env.LIVE_HEARTBEAT_INTERVAL, 10),
          ghost_max: parseInt(process.env.LIVE_GHOST_MAX, 10),
          ghost_duration: parseInt(process.env.LIVE_GHOST_DURATION, 10),
          recorder: process.env.LIVE_RECORDER
        },
        logentries: process.env.LOGENTRIES
      };
    } else
      return require('./config')[env];
  }
};