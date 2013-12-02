// tapping system, works on top of existing sockets app.
// admin app can use Nsa to initiate a fake sockjs connection that
// actually routes packets through Redis pub/sub channels.

module.exports = function(welcome, send, serverId, recorder, log) {

// used by admin app
var Nsa = {

  // connections, keyed by serverId
  taps: {},

  // when recording is turned on, all sub'd messages go through here
  openTaps: function() {
    recorder.sub.on('message', function(channel, message) {
      // console.log("Got message through tap for " + channel + ": " + message);
      (Nsa.taps[channel] || []).forEach(function(tap) {
        tap.write(message);
      });
    });
  },

  welcome: function(connection) {
    send('identify', connection, {});

    connection.on('data', function(message) {
      // plain-text identify message initiates connection
      if (message.slice(0,8) == "identify") {
        var serverId = message.slice(9);
        var toChannel = "to:" + serverId;
        var fromChannel = "from:" + serverId;

        connection.serverId = serverId;
        connection.toChannel = toChannel;
        connection.fromChannel = fromChannel;

        log.warn("Initiating tap for: " + serverId);

        // store connection locally (absorb one-to-many here)
        if (!Nsa.taps[fromChannel]) Nsa.taps[fromChannel] = [];
        Nsa.taps[fromChannel].push(connection);

        recorder.subTo("from:" + serverId);

        // forward the new tap on so the socket app makes a fake connection
        recorder.client.publish(connection.toChannel, message);
      }

      // send all normal traffic into the tap
      else {
        // console.log("Tap publishing: " + message);
        recorder.client.publish(connection.toChannel, message);
      }
    });

    connection.on('close', function() {
      log.warn("Disconnected client, sending message to close tap.");
      recorder.client.publish(connection.toChannel, "disconnect");

      // remove it from tap record
      Nsa.taps[connection.fromChannel].splice(Nsa.taps[connection.fromChannel].indexOf(connection), 1);
    });
  }

};


// used by sockets app to comply with Nsa tap orders
// creates a fake connection that complies with the sockjs API
var Compliance = {

  // all tapped messages will be from clients connected via the tap
  openTaps: function() {
    recorder.subTo("to:" + serverId);

    var connection;

    recorder.sub.on('message', function(channel, message) {
      var command = message.slice(0,8);

      if (command == "identify") {
        var serverId = message.slice(9);

        // if a connection was already open, close and re-open
        if (connection)
          connection.close();

        connection = new CompliantConnection(recorder.client, serverId);

        log.warn("Tap initiated.");
        welcome(connection);
      }

      // pass on the close message
      else if (command == "disconne") {
        connection.close();
        connection = null;
      }

      // message to be blindly funneled
      else {
        // console.log("Tap receiving: " + message);
        connection.onData(message);
      }
    });
  }
};


// pretend to be a sockjs connection, but actually funnel traffic
var CompliantConnection = function(client, serverId) {
  this.client = client;
  this.serverId = serverId;
  this.channel = "from:" + serverId;

  this.onClose = null;
  this.onData = null;
};

CompliantConnection.prototype = {
  on: function(event, callback) {
    if (event == 'close') this.onClose = callback;
    if (event == 'data') this.onData = callback;
  },

  write: function(data) {
    this.client.publish(this.channel, data);
  },

  close: function() {
    log.warn("Tap closed.");
    this.onClose();
  }
};

return {admin: Nsa, sockets: Compliance};
}