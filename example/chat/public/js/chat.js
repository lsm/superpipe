/*global alert */

var socket = io()

$('form').submit(function() {
  socket.emit('chat:new_message', $('#m').val())
  $('#m').val('')
  return false
})

socket.on('chat:new_message', function(msg) {
  $('#messages').append($('<li>').text(msg))
})

socket.on('chat:error', function(msg) {
  alert(msg)
})
