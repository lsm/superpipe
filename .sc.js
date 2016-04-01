var sauceConnectLauncher = require('sauce-connect-launcher');

var username = process.env.SAUCE_USERNAME
var accessKey = process.env.SAUCE_ACCESS_KEY

sauceConnectLauncher({
  username: username,
  accessKey: accessKey
}, function(err, sauceConnectProcess) {
  if (err) {
    console.error(err.message);
    return;
  }
  console.log("Sauce Connect ready, username: %s", username);
});
