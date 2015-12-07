var express = require('express')
var app = express()
var http = require('http').Server(app)
var io = require('socket.io')(http)
var path = require('path')
var SuperPipe = require('superpipe')
var superpipe = new SuperPipe()
require('./pipeline')(superpipe)

app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/views/index.html')
})

io.on('connection', function(socket) {

  superpipe
    .setDep('socket', socket)

  superpipe.emit('chat:new_message', 'New User connected')

  socket.on('chat:new_message', function(data) {
    superpipe.emit('chat:new_message', data)
  })
})

http.listen(3000, function() {
  console.log('listening on *:3000')
})
