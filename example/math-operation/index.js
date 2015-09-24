var SuperPipe = require('../../lib/plumber');
var operation = require('./operation');


var sp = new SuperPipe();
var pipeline = sp
  .listenTo('math operation')
  .pipe(operation.addition, null, null, 'setDep')
  .pipe(operation.substraction, 'x', 'y', 'setDep')
  .pipe(operation.multiplication, 'x', 'y', 'setDep')
  .pipe(operation.division, 'x', 'y', 'setDep')
  .pipe(operation.result, 'addition', 'substraction', 'mul', 'div');

var x = 5;
var y = 6;

pipeline.trigger('math operation', x, y);
