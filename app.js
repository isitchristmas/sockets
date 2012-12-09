var events = {};
function on(event, func) {events[event] = func;}
function noop() {};
var deathInterval = 6000;

var connections = {};

var welcome = function(connection) {
  connection._user_id = utils.generateId();
  connections[connection._user_id] = connection;
  send("hello", connection, {
    server: serverId,
    live: live
  });

  connection.on('data', function(message) {
    if (message.length > 1000) return; // 1KB limit

    try {
      var data = JSON.parse(message);
      (events[data._event] || noop)(connection, data);
    } catch (e) {
      log.error("Error parsing message - " + message);
      log.error(e);
    }
  });

  connection.on('close', function() {
    userLeft(connection._user_id, (connection._timed_out ? "timed out" : "departing"));
  });
};

var send = function(event, connection, object) {
  object = object || {};
  object._event = event;
  if (connection) {
    object._user_id = connection._user_id;
    connection.write(JSON.stringify(object));
  }
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

var userLeft = function(id, cause) {
  delete connections[id];
  broadcast("leave", id, {id: id});
  manager.removeUser(id, cause);
}

var setUserHeartbeat = function(id) {
  if (connections[id]) {
    clearTimeout(connections[id]._heartbeat);
    connections[id]._heartbeat = setTimeout(function() {
      if (connections[id]) {
        log.warn("timing out user: " + id);
        connections[id]._timed_out = true;
        connections[id].close();
      }
    }, deathInterval);
  }
}

// events 

on('arrive', function(connection, data) {
  rebroadcast(connection, data);
  manager.addUser(data);
  setUserHeartbeat(data.id);
});

on('heartbeat', function(connection, data) {
  send('heartbeat', connections[data.id], data);
  setUserHeartbeat(data.id);
});

on('motion', rebroadcast);

on('here', function(connection, data) {
  if (connections[data.to])
    send('here', connections[data.to], data);
});


// admin area

var dashboard = function(req, res) {
  manager.allUsers(function(servers) {
    res.render("dashboard", {
      serverId: serverId,
      servers: servers,
      dateFormat: dateFormat
    });
  });
};


var express = require('express')
  , http = require('http')
  , sockjs = require('sockjs')
  , dateFormat = require('dateformat');

// server environment
var env = (process.env.NODE_ENV || "development")
  , config = require('./config')[env]
  , live = (config.live || {})
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
sockets.installHandlers(server, {prefix: '/christmas'});

app.get('/', function(req, res) {res.send("Up!");});
app.get('/dashboard', dashboard);

app.configure(function() {
  app.enable('trust proxy');
  app.engine('.html', require('ejs').__express);
  app.set('view engine', 'html');
  server.listen(port, function(){
    log.warn("Express " + app.settings.env + " server listening on port " + port);
  });
});


// wipe the users clean on process start, the live ones will heartbeat in

manager.clearUsers();
manager.logNewServer();

// target is 'client' or 'server'
manager.onConfig = function(target, key, value) {
  log.warn("live " + target + " change: " + key + " [" + live[key] + " -> " + value + "]");
  live[key] = value;
  log.warn("live config: " + JSON.stringify(live));

  if (target == "client") {
    broadcast("config", null, {
      key: key,
      value: value
    });
  }
};

manager.onCommand = function(command, args) {
  log.warn("live command: " + command + " (" + args.join(", ") + ")");
  broadcast("command", null, {
    command: command,
    arguments: args
  });
}

// get current starting configuration and wait for users
manager.loadConfig(function(initLive, err) {
  if (err) {
    log.error("Couldn't load live config! Crashing myself")
    throw "Oh nooooooo";
  }
  
  for (var key in initLive)
    live[key] = initLive[key];

  log.info("Starting up with live config: " + JSON.stringify(live));

  sockets.on('connection', welcome);
});