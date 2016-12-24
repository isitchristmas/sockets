// admin area, only available when IIC_ADMIN=true

var dateFormat = require('dateformat');

module.exports = function(app, config, manager) {

  app.get('/dashboard', function(req, res) {
    var password = req.query.admin;
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
  });
}