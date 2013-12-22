var events = {};
function on(event, func) {events[event] = func;}
function noop() {};

var connections = {};

var welcome = function(connection) {
  connection._user = {
    id: utils.generateId(),
    name: utils.randomName()
    // country gets filled in on arrive
  }
  connections[connection._user.id] = connection;

  send("hello", connection, {
    user: connection._user,
    server: serverId.slice(0,6),
    live: live
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
    userLeft(connection._user.id, (connection._timed_out ? "timed out" : "departing"));
  });
};

// send a single message to be serialized
var send = function(event, connection, object) {
  object._event = event;
  if (connection)
    connection.write(JSON.stringify(object));
}

// broadcast a single message to be serialized.
//   currently: used only by config changes and chat commands.
//   so: recipients do not need to know the sender 'id'.
var broadcast = function(event, from, object) {
  object._event = event;
  var serialized = JSON.stringify(object);
  for (id in connections) {
    if (id != from)
      connections[id].write(serialized);
  }
}

// even thinner layer, just shuttle the original message to others
//   currently: used to send sender-specific events.
//   so: the 'id' field needs to have been set by the sending client.
var rebroadcast = function(connection, data, original) {
  var from = connection._user.id;
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
on('scroll', rebroadcast);

on('arrive', function(connection, data, original) {
  rebroadcast(connection, data, original);

  // country is set here, trusted henceforth
  connection._user.country = data.country;

  manager.addUser(connection, data, false); // new user
  setUserHeartbeat(connection._user.id);
});

on('heartbeat', function(connection, data) {
  send('heartbeat', connections[data.id], data);
  manager.addUser(connection, data, true); // update user
  setUserHeartbeat(connection._user.id);
});

on('here', function(connection, data) {
  to = connections[data.to];
  if (to) {
    data.country = to._user.country;
    data.id = to._user.id;
    send('here', to, data);
  }
});

// socket app always snapshots data, only admin uses on/off
on('pong', function(connection, data) {
  recorder.snapshotData(connection, data);
});

// TODO: lock down naming a bit here
on('rename', function(connection, data) {
  if (!data.name) return;
  var name = data.name.slice(0,20);

  // still send down the name message even if it got rejected
  if (!utils.rejectText(data.name))
    connection._user.name = name;

  send('rename', connection, {name: connection._user.name});
});

on('chat', function(connection, data) {
  if (live.chat != "true") return;

  var user = connection._user;
  var time = Date.now();

  manager.isBanned(user.id, function(answer) {
    if (answer || (data.message == connection._user.lastMessage) || utils.rejectText(data.message))
      onBannedChat(user.id, user.name, user.country, data.message);
    else
      manager.newChat(user.id, time, user.name, user.country, data.message);

    connection._user.lastMessage = data.message;
  });
});


var express = require('express'),
    http = require('http'),
    sockjs = require('sockjs');

var util = require('util');
var utils = require("./utils"),
    env = (process.env.NODE_ENV || "development"),
    admin = (process.env.IIC_ADMIN == "true");

var config = utils.config(env),
    live = (config.live || {}),
    port = parseInt(process.env.PORT || config.port || 80);

// full server ID is 12 chars long, only first 6 shared with client
var serverId = (admin ? "admin" : utils.generateId(12)),
    log = utils.logger(serverId, config),
    manager = require("./manager")(serverId, config.manager, log),
    recorder = require("./recorder")(serverId, config.recorder, log);

// tapping system, uses recorder to funnel packets on command
var Calea = require("./calea")(welcome, send, serverId, recorder, log);

// start everything

var app = express(),
    server = http.createServer(app);

var sockets = sockjs.createServer({log: log});
sockets.installHandlers(server, {prefix: '/christmas'});

app.get('/', function(req, res) {res.send("Up!");});

// this can be used as a separate admin app
if (admin) {
  require('./admin')(app, config, manager, recorder);
  Calea.admin.openTaps();
}

else {
  Calea.sockets.openTaps();

  // socket app always listens for snapshot requests
  recorder.listen();

  // wipe the users clean on process start, the live ones will heartbeat in
  manager.clearUsers();
  manager.logNewServer();
}

// turn on CORS
app.all('*', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

// start up express server
app.configure(function() {
  app.enable('trust proxy');
  app.engine('.html', require('ejs').__express);
  app.set('view engine', 'html');
  server.listen(port, function(){
    log.warn("Express " + app.settings.env + " server listening on port " + port);
  });
});


/****************************
 handling pub/sub events
*****************************/

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
  } else if (target == "server") {
    if (key == "snapshot") {
      recorder.turnOff();
      if (value == "on") recorder.turnOn();
    }

    else if (key == "tap") {
      // mark taps as open for future connections
      if (value == "on") {
        log.warn("Turning on the tap.");
        Calea.on = true;
      }

      // clear the taps, turn it off so future connections are rejected
      else {
        log.warn("Turning off the tap.");
        Calea.on = false;
        if (admin) Calea.admin.clearTaps();
        else Calea.sockets.clearTaps();
      }
    }
  }
};

manager.onChat = function(id, name, country, message) {
  broadcast("chat", null, {
    id: id,
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
      id: id,
      name: name,
      country: country,
      message: message
    });
  }
};

manager.onCommand = function(command, args) {
  log.warn("live command: " + command + " (" + args.join(", ") + ")");
  broadcast("command", null, {
    command: command,
    arguments: args
  });
};

// socket app can kick off a client snapshot request to all connected clients
recorder.onClientSnapshot = function() {
  broadcast("ping", null, {});
};


// get current starting configuration and wait for users
log.info("Loading config from manager, and beginning.");
manager.loadConfig(function(initLive, err) {
  if (err) {
    log.error("Couldn't load live config! Crashing myself")
    throw "Oh nooooooo";
  }

  for (var key in initLive)
    live[key] = initLive[key];

  // special initializations based on live values

  // recorder may be turned off and on (only used by admin)
  if (admin)
    (live.snapshot == "on") ? recorder.turnOn() : recorder.turnOff();

  // set Calea to on/off
  Calea.on = (live.tap == "on");

  log.info("Starting up with live config: " + JSON.stringify(live));

  sockets.on('connection', admin ? Calea.admin.welcome : welcome);
});