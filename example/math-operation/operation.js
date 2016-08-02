module.exports = {

  addition: function(x, y, setDep) {

    var addition = x + y;

    setDep('addition', addition)
    setDep('x', x)
    setDep('y', y)

  },
  substraction: function(x, y, setDep) {

    var substraction = x - y;

    setDep('substraction', substraction);
  },
  multiplication: function(x, y, setDep) {

    var multiplication = x * y;

    setDep('multiplication', multiplication);
  },
  division: function(x, y, setDep) {

    var division = x / y;

    setDep('division', division);
  },
  result: function(addition, substraction, mul, div) {

    console.log('addition is : ', addition);
    console.log('substraction is : ', substraction);
    console.log('multiplication is ', mul);
    console.log('substraction is ', div);

  }

};
