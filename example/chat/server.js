var express = require('express')
var app = express()
var http = require('http').Server(app)
var io = require('socket.io')(http)
var path = require('path')

app.set('views', path.join(__dirname, 'views'));
// app.set('view engine', 'html');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/views/index.html')
})

io.on('connection', function(socket) {
  console.log('user connected')
})

http.listen(3000, function() {
  console.log('listening on *:3000')
})
