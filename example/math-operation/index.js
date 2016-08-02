var SuperPipe = require('superpipe');
var superpipe = new SuperPipe()
var operation = require('./operation');

superpipe
  .setDep('add', operation.addition)
  .setDep('sub', operation.substraction)
  .setDep('mul', operation.multiplication)
  .setDep('div', operation.division)
  .setDep('result', operation.result)



superpipe
  .listenTo('math operation')
  .pipe('add', [null, null, 'setDep'], ['addition', 'x', 'y'])
  .pipe('sub', ['x', 'y', 'setDep'], ['substraction'])
  .pipe('mul', ['x', 'y', 'setDep'], ['multiplication'])
  .pipe('div', ['x', 'y', 'setDep'], ['division'])
  .pipe('result', ['addition', 'substraction', 'multiplication', 'division']);

var x = 5;
var y = 6;

superpipe.emit('math operation', x, y);
