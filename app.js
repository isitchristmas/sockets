var events = {};
function on(event, func) {events[event] = func;}
function noop() {};

var connections = {};

var welcome = function(connection) {
  connection._user_id = utils.generateId();
  connections[connection._user_id] = connection;
  
  send("hello", connection, {
    _user_id: connection._user_id,
    server: serverId,
    live: live,
    name: utils.randomName()
  });

  connection.on('data', function(message) {
    if (message.length > 1000) return; // 1KB limit

    try {
      var data = JSON.parse(message);
      (events[data._event] || noop)(connection, data, message);
    } catch (e) {
      log.error("Error parsing message - " + message);
      log.error(e);
    }
  });

  connection.on('close', function() {
    userLeft(connection._user_id, (connection._timed_out ? "timed out" : "departing"));
  });
};

// send a single message to be serialized
var send = function(event, connection, object) {
  object._event = event;
  if (connection)
    connection.write(JSON.stringify(object));
}

// broadcast a single message to be serialized
var broadcast = function(event, from, object) {
  object._event = event;
  var serialized = JSON.stringify(object);
  for (id in connections) {
    if (id != from)
      connections[id].write(serialized);
  }
}

// even thinner layer, just shuttle the original message to others
var rebroadcast = function(connection, data, original) {
  var from = connection._user_id;
  for (id in connections) {
    if (id != from)
      connections[id].write(original);
  }
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
        log.info("timing out user: " + id);
        connections[id]._timed_out = true;
        connections[id].close();
      }
    }, live.death_interval);
  }
}

// events 

// quickly shuttle mouse events through the system
on('motion', rebroadcast);
on('click', rebroadcast);

// on('benchmark1', function(connection, data, original) {
//   var start = Date.now();
//   for (var i =0; i<10000; i++) 
//     rebroadcast(connection, data, original);
//   var elapsed = Date.now() - start;
  
//   send('command', connection, {
//     command: 'blast',
//     arguments: ["Finished benchmark1 in " + elapsed + "ms"]
//   })
// })

// on('benchmark2', function(connection, data, original) {
//   var start = Date.now();
//   for (var i =0; i<10000; i++) 
//     rebroadcast2(connection, data, original);
//   var elapsed = Date.now() - start;
  
//   send('command', connection, {
//     command: 'blast',
//     arguments: ["Finished benchmark2 in " + elapsed + "ms"]
//   })
// })

on('arrive', function(connection, data, original) {
  rebroadcast(connection, data, original);
  manager.addUser(data);
  setUserHeartbeat(data.id);
});

on('heartbeat', function(connection, data) {
  send('heartbeat', connections[data.id], data);
  manager.addUser(data, true); // update user
  setUserHeartbeat(data.id);
});

on('here', function(connection, data) {
  if (connections[data.to])
    send('here', connections[data.to], data);
});

on('chat', function(connection, data) {
  if (live.chat != "true") return;
  
  manager.isBanned(data.id, function(answer) {
    if (answer)
      onBannedChat(data.id, data.name, data.country, data.message);
    else
      manager.newChat(data.id, data.time, data.name, data.country, data.message);
  });
});


// admin area
var dashboard = function(req, res) {
  manager.allUsers(function(servers) {
    manager.getSystem(function(system) {
      res.render("dashboard", {
        serverId: serverId,
        servers: servers,
        system: system,
        dateFormat: dateFormat,
        req: req
      });
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
  , serverId = (env == "admin" ? "admin" : utils.generateId(6))
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


/***********
 handling pub/sub events
************/

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

manager.onChat = function(name, country, message) {
  broadcast("chat", null, {
    name: name,
    country: country,
    message: message
  });
};

// this should only happen for someone on this server
var onBannedChat = function(id, name, country, message) {
  log.warn("[banned] [" + id + "] [" + country + "] " + name + ": " + message);
  if (connections[id]) {
    send("chat", connections[id], {
      name: name,
      country: country,
      message: message
    });
  }
}

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