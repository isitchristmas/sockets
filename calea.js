// tapping system, works on top of existing sockets app.
// admin app can use Nsa to initiate a fake sockjs connection that
// actually routes packets through Redis pub/sub channels.

// unlike snapshotting, openTaps on both Nsa and Compliance
// should be opened regardless of 'on' state. When taps are 'off',
// connections will be cleared and none will be created, but the
// subscriptions are harmless to keep open.

module.exports = function(welcome, send, serverId, recorder, log) {

  var Calea = {on: true};

  // used by admin app
  var Nsa = {

    // connections, keyed by serverId
    taps: {},

    // when tapping is turned on, all sub'd messages go through here.
    openTaps: function() {
      recorder.sub.on('message', function(channel, message) {
        (Nsa.taps[channel] || []).forEach(function(tap) {
          tap.write(message);
        });
      });
    },

    clearTaps: function() {
      Object.keys(Nsa.taps).forEach(function(channel) {

        // close each connected client
        Nsa.taps[channel].forEach(function(connection) {
          connection.close();
        });

        // clear the key
        delete Nsa.taps[channel];
      });
    },

    // the sockjs connection endpoint presented to connectors to admin
    welcome: function(connection) {
      send('identify', connection, {});

      connection.on('data', function(message) {
        // no tapping if Calea is off
        if (!Calea.on) return;

        // initiate a connection via "identify:[serverId]"
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

        else
          recorder.client.publish(connection.toChannel, message);
      });

      connection.on('close', function() {
        log.warn("Disconnected client, sending message to close tap.");
        recorder.client.publish(connection.toChannel, "disconnect");

        // remove it from taps record
        if (Nsa.taps[connection.fromChannel])
          Nsa.taps[connection.fromChannel].splice(Nsa.taps[connection.fromChannel].indexOf(connection), 1);
      });
    }

  };


  // used by sockets app to comply with Nsa tap orders
  // creates a fake connection that complies with the sockjs API
  var Compliance = {

    // max of one tapped connection per sockets instance
    connection: null,

    // all tapped messages will be from clients connected via the tap
    openTaps: function() {
      recorder.subTo("to:" + serverId);

      recorder.sub.on('message', function(channel, message) {
        // accept no messages if Calea is off
        if (!Calea.on) return;

        var command = message.slice(0,8);

        if (command == "identify") {
          var serverId = message.slice(9);

          // if a connection was already open, close and re-open
          if (Compliance.connection)
            Compliance.connection.close();

          Compliance.connection = new CompliantConnection(recorder.client, serverId);

          log.warn("Tap initiated.");
          welcome(Compliance.connection);
        }

        // pass on the close message
        else if (command == "disconne") {
          Compliance.connection.close();
          Compliance.connection = null;
        }

        else
          Compliance.connection.onData(message);
      });
    },

    clearTaps: function() {
      if (Compliance.connection)
        Compliance.connection.close();
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

  Calea.admin = Nsa;
  Calea.sockets = Compliance;

  return Calea;
}