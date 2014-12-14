## Real-time sockets for isitchristmas.com

This app is the socket server for flag/mouse streaming on [isitchristmas.com](https://isitchristmas.com). This server **does not run** isitchristmas.com -- for that code, see [github.com/isitchristmas/web](https://github.com/isitchristmas/web).

This service is meant to be run on a number of parallel nodes, e.g. 30 Heroku dynos or Nodejitsu drones or whatever. It's okay to run on a weak server, and each service can handle something like ~50 active users.

### Setup

* Install [Redis](http://redis.io).
* Install [Node](http://nodejs.org).
* Copy the template config file:

```bash
cp config.js.example config.js
```

* Run the app at at `http://localhost:3000`:

```bash
node app.js
```

#### Deploying to Heroku

The recommended development/deployment path for Heroku is:

* Copy the template environment to `.env` and fill it out:

```bash
cp env.example .env
```

* Test out by running the app with `foreman`, with the port you want:

```bash
foreman start -p 3000
```

* (Recommended) Install the Heroku config plugin and sync your `.env` to the server:

```bash
heroku config:push -o
```

There's a `Procfile` in this repo already that will run `node app.js`.

### Control Server

Every node connects to a Redis server, and the administrator with access to the Redis server can issue commands that get sent to all server nodes.

Server nodes can then send commands and config changes down to **all** connected users.

#### Commands

An admin can `publish` to a `command` channel to issue commands:

```
publish command refresh
```

Use `:`: to separate arguments:

```
publish command "blast:Testing the emergency broadcast system."
```

Commands include:

* `refresh` - Refresh browsers, using `window.location`. Useful for making client-side code deploys take effect.
* `reconnect` - Cause clients to disconnect and reconnect to the WebSockets endpoint. Useful for making server-side code deploys take effect.
* `blast` - Cause a message to appear in users' developer consoles.

#### Config changes

An admin can `publish` to either the `server` or `client` channel to affect "live" configuration.

`server` changes will be broadcast to every server and only saved there. `client` changes will be broadcast to every server and saved, and then broadcast down from each server to **all** connected clients.

Whether chat is enabled is only controlled server-side. Enable chat:

```
publish server chat:true
```

Changes to the mouse rate limit need to also be seen client-side. Rate limit mouse events to one every 50ms (20 fps):

```
publish client mouse_rate:50
```

The current state of "live" configuration is given to each client upon connecting to the server, so everyone should stay more or less in sync.

Server config values include:

* `chat`  - Enable the chat system with `true`, turn it off with anything else.

Client config values include:

* `mouse_rate` - Rate limit, in milliseconds, for mouse events. 50ms = 20 "frames per second", and is a good value for high traffic use.
* `heartbeat_interval` - Interval, in milliseconds, where connected clients should "heartbeat" in to tell the server they're still around.
* `death_interval` - Time, in milliseconds, to wait for a heartbeat until a connected user is forcibly disconnected. Suggested value: `60000` (1 minute).
* `ghost_duration` - Time, in milliseconds, for a "ghost" flag to stick around until it disappears. (Defaults to 2000.)
* `ghost_max` - Number of "ghost" flags someone can have on screen at a given time. (Defaults to 10.)

### License

Released under the [MIT License](LICENSE).
