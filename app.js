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
    events["leave"]({id: connection._user_id});
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
  send('here', connections[data.to], data);
});

on('leave', function(connection, data) {
  delete connections[data.id];
  rebroadcast(connection, data)
});

// logging

var severities = {error: 1, info: 2, debug: 3};
var socket_log = function(severity, message) {
  if (log_level >= severities[severity])
    console.log("[" + serverId + "][" + severity + "] " + message);
}


/****** setup */

var express = require('express')
  , http = require('http')
  , sockjs = require('sockjs')
  , redis = require('redis');

// server environment
var env = (process.env.NODE_ENV || "development")
  , port = parseInt(process.env.PORT || 80)
  , config = require('./config')[env]
  , log_level = (process.env.LOG || 1); // default to error msgs

// basic HTTP server
var app = express()
  , server = http.createServer(app);


// initialize redis
if (config.store == 'redis') {
  var pub    = redis.createClient(config.redis.port, config.redis.host)
    , sub    = redis.createClient(config.redis.port, config.redis.host)
    , client = redis.createClient(config.redis.port, config.redis.host);

  ["error", "end", "connect", "ready"].forEach(function(message) {
    pub.on(message, function () {
      console.log("[" + serverId + "][redis] pub: " + message);
    });

    sub.on(message, function () {
      console.log("[" + serverId + "][redis] sub: " + message);
    });

    client.on(message, function () {
      console.log("[" + serverId + "][redis] client: " + message);
    });
  });

  if (config.redis.password) {
    pub.auth(config.redis.password);
    sub.auth(config.redis.password);
    client.auth(config.redis.password);
  }
}

// configure and start server
app.configure(function() {
  app.set('port', port);
  app.enable('trust proxy');
});

app.get('/', function(req, res) {res.send("Up!");});
// app.get('/dashboard', dashboard);

var startServer = function() {
  server.listen(app.get('port'), function(){
    console.log("Express %s server listening on port %s", app.settings.env, app.get('port'));
  });
}


/* utils */

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



/** run servers **/

var sockets = sockjs.createServer({log: socket_log});
sockets.on('connection', welcome);
sockets.installHandlers(server);

app.configure('development', function() {
  app.use(express.errorHandler());

  require('reloader')({
    watchModules: true,
    onReload: startServer
  });
});

app.configure('production', startServer);