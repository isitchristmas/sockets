// admin area, only available when IIC_ADMIN=true

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

  // static view uses same admin password to grab/render snapshot from admin app
  var boards = function(req, res) {
    var password = req.param("admin");
    if (config.admin && (password != config.admin))
      return (res.status(403).send("What?"));

    res.render('boards', {
      req: req,
      config: config
    });
  };

  var snapshot = function(req, res) {
    var password = req.param("admin");
    if (config.admin && (password != config.admin))
      return (res.status(403).send("What?"));

    res.header('Content-Type', 'application/json');
    recorder.getSnapshot(function(snapshot) {
      res.send(snapshot || "{}");
    });
  };

  app.get('/snapshot', snapshot);
  app.get('/dashboard', dashboard);
  app.get('/boards', boards);
}