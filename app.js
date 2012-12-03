var events = {};
function on(event, func) {events[event] = func;}

var connections = {};
var welcome = function(connection) {
  connection._user_id = utils.generateId();
  connections[connection._user_id] = connection;
  send("hello", connection);

  connection.on('data', function(message) {
    var data = JSON.parse(message);
    events[data._event](connection, data);
  });

  connection.on('close', function() {
    events.leave(connection, {id: connection._user_id});
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

var userAlive = function(data) {
  manager.addUser(data.id, data.country);
};

// events 

on('arrive', function(connection, data) {
  rebroadcast(connection, data);
  userAlive(data);
});

on('heartbeat', function(connection, data) {
  send('heartbeat', connections[connection._user_id], data);
  userAlive(data);
});

on('motion', rebroadcast);

on('here', function(connection, data) {
  if (connections[data.to])
    send('here', connections[data.to], data);
});

on('leave', function(connection, data) {
  delete connections[data.id];
  broadcast("leave", data.id, data);
  manager.removeUser(data.id);
});

var dashboard = function(req, res) {
  manager.allUsers(function(servers) {
    res.render("dashboard", {
      serverId: serverId,
      servers: servers
    });
  });
};

var clearUsers = function(req, res) {
  manager.clearUsers(function() {
    res.redirect("/dashboard");
  });
}


var express = require('express')
  , http = require('http')
  , sockjs = require('sockjs');

// server environment
var env = (process.env.NODE_ENV || "development")
  , config = require('./config')[env]
  , port = parseInt(process.env.PORT || config.port || 80);

var utils = require("./utils")
  , serverId = utils.generateId(6)
  , log = utils.logger(serverId, config)
  , manager = require("./redis")(serverId, config.redis, log);

// basic HTTP server
var app = express()
  , server = http.createServer(app);

// start everything

var sockets = sockjs.createServer({log: log});
sockets.on('connection', welcome);
sockets.installHandlers(server, {prefix: '/christmas'});

app.get('/', function(req, res) {res.send("Up!");});
app.get('/dashboard', dashboard);
app.get('/dashboard/clear', clearUsers);

app.configure(function() {
  app.enable('trust proxy');
  app.engine('.html', require('ejs').__express);
  app.set('view engine', 'html');
  server.listen(port, function(){
    log.warn("Express " + app.settings.env + " server listening on port " + port);
  });
});