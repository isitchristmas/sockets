// admin area, only available when NODE_ENV=admin
// todo: make available only behind a password?

var dateFormat = require('dateformat');

module.exports = function(app, config, manager) {

  var dashboard = function(req, res) {
    manager.allUsers(function(servers) {
      manager.getSystem(function(system) {
        res.render("dashboard", {
          servers: servers,
          system: system,
          dateFormat: dateFormat,
          req: req
        });
      });
    });
  };

  app.get('/dashboard', dashboard);
}