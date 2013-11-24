// admin area, only available when NODE_ENV=admin
// todo: make available only behind a password?

var dateFormat = require('dateformat');

module.exports = function(app, config, manager, recorder) {

  var dashboard = function(req, res) {
    var password = req.param("admin");
    if (config.admin && (password != config.admin))
      return (res.status(403).send("What?"));

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