module.exports = {

  addition: function(x, y, setDep) {

    var addition = x + y;

    setDep({
      addition: addition,
      y: y,
      x: x
    });
  },
  substraction: function(x, y, setDep) {

    var substraction = x - y;

    setDep({
      substraction: substraction
    });
  },
  multiplication: function(x, y, setDep) {

    var mul = x * y;

    setDep({
      mul: mul
    });
  },
  division: function(x, y, setDep) {

    var div = x / y;

    setDep({
      div: div
    });
  },
  result: function(addition, substraction, mul, div) {

    console.log('addition is : ', addition);
    console.log('substraction is : ', substraction);
    console.log('multiplication is ', mul);
    console.log('substraction is ', div);

  }

};
