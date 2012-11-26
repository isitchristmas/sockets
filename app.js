var welcome = function(connection) {
  connection.on('data', function(message) {
    console.log("data received: " + message);
    connection.write("received");
  });

  connection.on('close', function() {
    console.log("connection closed: " + connection);
  });
};

  // client.on('arrive', function(data) {
  //   client.broadcast.emit('arrive', data);
  // });

  // directed message to a client that just joined
  // client.on('here', function(data) {
  //   io.sockets.socket(data.to).emit('here', data);
  // });

  // client.on('motion', function(data) {
  //   client.volatile.broadcast.emit('motion', data);
  // });

  // client.on('disconnect', function() {
  //   client.broadcast.emit('leave', client.id);
  // });

  // client.on('manual disconnect', function(id) {
  //   client.broadcast.emit('leave', id);
  // });
// }


/****** setup */

var express = require('express')
  , http = require('http')
  , sockjs = require('sockjs')
  , redis = require('redis');

// server environment
var env = (process.env.NODE_ENV || "development")
  , port = parseInt(process.env.PORT || 80)
  , config = require('./config')[env];

// basic HTTP server
var app = express()
  , server = http.createServer(app);

// setup sockjs
var sockets = sockjs.createServer();
sockets.on('connection', welcome);
sockets.installHandlers(server);

// initialize redis
if (config.store == 'redis') {
  var pub    = redis.createClient(config.redis.port, config.redis.host)
    , sub    = redis.createClient(config.redis.port, config.redis.host)
    , client = redis.createClient(config.redis.port, config.redis.host);

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

app.configure('development', function() {
  app.use(express.errorHandler());

  require('reloader')({
    watchModules: true,
    onReload: startServer
  });
});

app.configure('production', startServer);


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