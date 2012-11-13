function welcome(client) {
  client.emit('identity', {identity: client.id});
  
  client.on('acknowledged', function (data) {
    console.log("acknowledged: " + p(data));
  });
}

function p(object) {
  return JSON.stringify(object, null, 4);
}


/****** setup */

var express = require('express')
  , http = require('http');

var app = express()
  , server = http.createServer(app)
  , io = require('socket.io').listen(server);

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
});

io.configure(function () {
  io.set('transports', ['websocket']);
});

io.sockets.on('connection', function (socket) {
  welcome(socket);
});

// Start server

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