var redis = require('redis');

var Manager = function(config, log) {
  this.enabled = config.redis.enabled;
  this.password = config.redis.password;
  this.host = config.redis.host;
  this.port = config.redis.port;
  this.log = log;

  this.init();
};

Manager.prototype = {

  // events:
  //   

  init: function() {
    if (!this.enabled) return;

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
  }

}

module.exports = function(config, log) {return new Manager(config, log);}