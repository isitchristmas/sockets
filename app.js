function welcome(client) {

  client.on('arrive', function(data) {
    client.broadcast.emit('arrive', data);
  });

  // directed message to a client that just joined
  client.on('here', function(data) {
    io.sockets.socket(data.to).emit('here', data);
  });

  client.on('motion', function(data) {
    client.volatile.broadcast.emit('motion', data);
  });

  client.on('click', function(data) {
    client.broadcast.emit('click', data);
  });

  client.on('disconnect', function() {
    client.broadcast.emit('leave', client.id);
  });
}


/****** setup */

var express = require('express')
  , http = require('http')
  , redis = require('redis')
  , RedisStore = require('socket.io/lib/stores/redis');

var app = express()
  , config = require('./config')[app.get('env')]
  , server = http.createServer(app)
  , io = require('socket.io').listen(server);

if (config.store == 'redis') {
  var pub    = redis.createClient(config.redis.port, config.redis.host)
    , sub    = redis.createClient(config.redis.port, config.redis.host)
    , client = redis.createClient(config.redis.port, config.redis.host);

  if (config.redis.password) {
    pub.auth(config.redis.password);
    sub.auth(config.redis.password);
    client.auth(config.redis.password);
  }

  io.set('store', new RedisStore({
    redis: redis
  , redisPub: pub
  , redisSub: sub
  , redisClient: client
  }));
}

app.configure(function() {
  app.set('port', process.env.PORT || 80);
});

io.configure(function () {
  io.set('transports', ['websocket']);
  io.set('log level', (process.env.LOG ? process.env.LOG : 0));
});

io.sockets.on('connection', welcome);
app.get('/', function(req, res) {res.send("Up!");});


/**** start server ****/

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