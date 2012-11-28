// todo: move this into its own file

var crypto = require('crypto');
var generateId = function() {
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
  return rand.toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
};

var serverId = generateId();



var events = {};
function on(event, func) {events[event] = func;}

var connections = {};

var welcome = function(connection) {
  // generate id
  connection._user_id = generateId();
  connections[connection._user_id] = connection;
  send("hello", connection);

  connection.on('data', function(message) {
    var data = JSON.parse(message);
    events[data._event](connection, data);
  });

  connection.on('close', function() {
    events["leave"](connection, {id: connection._user_id});
  });
};

var send = function(event, connection, object) {
  object = object || {};
  object._event = event;
  object._user_id = connection._user_id;
  connection.write(JSON.stringify(object));
}

var broadcast = function(event, from, object) {
  for (id in connections) {
    if (id != from)
      send(event, connections[id], object);
  }
}

var rebroadcast = function(connection, data) {
  broadcast(data._event, connection._user_id, data);
}

// events 

on('arrive', rebroadcast);
on('motion', rebroadcast);

on('here', function(connection, data) {
  if (connections[data.to])
    send('here', connections[data.to], data);
});

on('leave', function(connection, data) {
  delete connections[data.id];
  broadcast("leave", data.id, data);
});



/****** setup */

var express = require('express')
  , http = require('http')
  , sockjs = require('sockjs')
  , redis = require('redis');

// server environment
var env = (process.env.NODE_ENV || "development")
  , port = parseInt(process.env.PORT || 80)
  , config = require('./config')[env]
  , log_level = (process.env.LOG || 1); // default to error msgs only

// basic HTTP server
var app = express()
  , server = http.createServer(app);


// initialize redis
if (config.redis.enabled) {
  var pub    = redis.createClient(config.redis.port, config.redis.host)
    , sub    = redis.createClient(config.redis.port, config.redis.host)
    , client = redis.createClient(config.redis.port, config.redis.host);

  ["error", "end", "connect", "ready"].forEach(function(message) {
    pub.on(message, function () {
      log("warn", "[redis] pub: " + message);
    });

    sub.on(message, function () {
      log("warn", "[redis] sub: " + message);
    });

    client.on(message, function () {
      log("warn", "[redis] client: " + message);
    });
  });

  if (config.redis.password) {
    pub.auth(config.redis.password);
    sub.auth(config.redis.password);
    client.auth(config.redis.password);
  }
}

// logging

var severities = {error: 1, warn: 1, info: 2, debug: 3};
var logger, winston, log;
if (config.logentries) {
  logger = require('node-logentries').logger({
    token: config.logentries
  });
  winston = require('winston');
  logger.winston(winston, {});
  winston.handleExceptions(new winston.transports.LogentriesLogger({}));

  log = function(severity, message) {
    if (log_level >= severities[severity]) {
      var msg = "[" + serverId + "] " + message;
      (winston[severity] || winston.error)(msg);
    }
  }
} else {
  log = function(severity, message) {
    if (log_level >= severities[severity])
      console.log("[" + serverId + "] " + message);
  }
}


/** configure servers **/

app.configure(function() {
  app.set('port', port);
  app.enable('trust proxy');
});

var sockets = sockjs.createServer({log: log});
sockets.on('connection', welcome);
sockets.installHandlers(server, {prefix: '/christmas'});

app.get('/', function(req, res) {res.send("Up!");});
// app.get('/dashboard', dashboard);


// start the server

var startServer = function() {
  server.listen(app.get('port'), function(){
    console.log("Express %s server listening on port %s", app.settings.env, app.get('port'));
  });
}

app.configure('development', function() {
  app.use(express.errorHandler());

  require('reloader')({
    watchModules: true,
    onReload: startServer
  });
});

app.configure('production', startServer);