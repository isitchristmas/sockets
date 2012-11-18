function welcome(client) {
  // 1) acknowledge
  client.emit('merry christmas');
  
  // re-broadcast motion events to everyone else
  client.on('motion', function(data) {
    client.broadcast.emit('motion', data);
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
  , http = require('http');

var app = express()
  , server = http.createServer(app)
  , io = require('socket.io').listen(server);

app.configure(function(){
  app.set('port', process.env.PORT || 80);
});

io.configure(function () {
  io.set('transports', ['websocket']);
  io.set('log level', (process.env.LOG ? process.env.LOG : 0));
});

// websockets and http endpoints
io.sockets.on('connection', welcome);
app.get('/', function(req, res) {res.send("Up!");}); // testing


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