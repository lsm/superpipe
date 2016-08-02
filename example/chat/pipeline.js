var pipe = require('./pipe')

module.exports = function(superpipe) {

  superpipe
    .setDep('setNewMessageDep', pipe.setNewMessageDep)
    .setDep('isMessageEmpty', pipe.isMessageEmpty)
    .setDep('renderMessage', pipe.renderMessage)
    .setDep('catchError', pipe.catchError)

  superpipe
    .listenTo('chat:new_message')
    .pipe('setNewMessageDep', [null, 'setDep'], ['message'])
    .pipe('isMessageEmpty', ['message', 'next'])
    .pipe('renderMessage', ['socket', 'message'])
    .error('catchError', [null, 'socket'])

}
