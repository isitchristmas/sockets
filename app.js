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
  , config = require('./config')[env]
  , port = parseInt(config.port || process.env.PORT || 80);

var utils = require("./utils")
  , serverId = utils.generateId(6)
  , log = utils.logger(serverId, config);

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
      log.warn("[redis] pub: " + message);
    });

    sub.on(message, function () {
      log.warn("[redis] sub: " + message);
    });

    client.on(message, function () {
      log.warn("[redis] client: " + message);
    });
  });

  if (config.redis.password) {
    pub.auth(config.redis.password);
    sub.auth(config.redis.password);
    client.auth(config.redis.password);
  }
}


/** start everything **/

var sockets = sockjs.createServer({log: log});
sockets.on('connection', welcome);
sockets.installHandlers(server, {prefix: '/christmas'});

app.get('/', function(req, res) {res.send("Up!");});
// app.get('/dashboard', dashboard);


app.configure(function() {
  app.enable('trust proxy');
  server.listen(port, function(){
    log.warn("Express " + app.settings.env + " server listening on port " + port);
  });
});