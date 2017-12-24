

module.exports = function(app, config, manager) {

  app.post('/slack/chat', function(req, res) {
    if (req.body.token != config.slack.token)
      return (res.status(500).send("Error: unable to validate message as coming from Slack."))

    // (id, time, name, country, message)
    manager.newChat(
      req.body.user_id,
      Date.now(),
      req.body.user_name,
      "US", // hardcoded for now
      req.body.text
    );

    res.send("Message posted.");
  });
}
