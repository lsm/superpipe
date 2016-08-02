module.exports = {
  setNewMessageDep: function(data, setDep) {
    setDep('message', data)
  },
  isMessageEmpty: function(message, next) {
    if (message === '') {
      next('empty message')
    } else {
      next()
    }
  },
  renderMessage: function(socket, message) {
    socket.emit('chat:new_message', message)
  },
  catchError: function(error, socket) {
    socket.emit('chat:error', error)
  }
}
