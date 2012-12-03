var crypto = require('crypto');

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
    var log_level = (config.log || process.env.LOG || 1);

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
  }
};