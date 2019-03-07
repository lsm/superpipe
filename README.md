# SuperPipe

[![CI status][ci-img]][ci-url]
[![License MIT][license-img]][license-url]
[![NPM version][npm-img]][npm-url]
[![Dependencies][dep-image]][dep-url]
[![Coverage Status][coverage-img]][coverage-url]
[![Code Climate][climate-img]][climate-url]


Hire SuperPipe for your complex reactive javascript application

##  Quick Start

The easiest way to install SuperPipe is with [`npm`](http://npmjs.org)

```sh

npm install superpipe

```

##  Usage example

```javascript

var SuperPipe = require('superpipe');

var sp = new SuperPipe();

```

##  Example

*  [math operation](https://github.com/lsm/superpipe/tree/master/example/math-operation)

##  Documentation

Below is a description of exposed public API

#### Constructor([insider])

SuperPipe constructor can take 1 parameter:

* injector - instance of [insider](https://github.com/lsm/insider)

```javascript
var SuperPipe = require('superpipe')

var superpipe = new SuperPipe()
```

or

```javascript
var insider = require('insider')
var SuperPipe = require('superpipe')

var superpipe = new SuperPipe(insider)

```

#### .listenTo([eventEmitter],eventName)
Return a new pipeline. Listen to the event of emitter and create a new pipeline to handle the emitted events.
The `listenTo` can take 2 parameters:

* eventEmitter -  instance of EventEmitter. Optional parameter. If you not provide eventEmitter, will be used instaoce of `superpipe`
* eventName - name of event for listen. For example `superpipe.listenTo('login')`

#### .pipeline()

Return a new pipeline instance

#### .autoBind({Boolean})
The `autoBind` can take 1 parameter. Paramater is boolean.The `.autoBind()` controls if we should automatically bind the function dependency

```javascript
var SuperPipe = require('superpipe')
var superpipe = new SuperPipe()

var loginPipeline = superpipe
  .pipeline()
  .autoBind(true)
  .pipe(...)
  .pipe(...)
  .toPipe()
```

#### .setDep(name,dep,[props])
The `setDep` can take 3 parameters.
* `name` - Required {String} Name of the dependency to set or prefix if props is present.
* `dep`  - Required {String,Object,Array,Number,Boolean,Function}
* `props` - Optional {String} Name(s) of properties to set as dependencies or shortcuts.
  You can set props in 3 ways :
   * '*' - set all the properties of the object as dependencies.
   * '*^' - set all the function properties of the object as dependencies.
   * '*$' - set all non-function properties of the object as dependencies.

Example without `props`

```javascript
var SuperPipe = require('superpipe')
var superpipe = new SuperPipe()

var secret = 'secret-key'
var x = 5

superpipe
  .setDep('secret',secret)
  .setDep('y',x)  // you can make another name of dep then your variable or function


```

Example with 'props'

```javascript

// For example we have a module that does math operations
// name of file math.js

module.exports = {
  add: function(x,y,setDep){
    ...
  },
  sub: function(x,y,setDep){
    ...
  },
  z: 10
}

```

```javascript
var SuperPipe = require('superpipe')
var superpipe = new SuperPipe()
var math = require('./math')

superpipe
  .setDep('math1',math,'*')  // you can get add,sub,z
  .setDep('math2',math,'*^') // you can get just add and sub (func)
  .setDep('math3',math,'*$') // you can get just z (non-func)

```

#### .getDep(name)

The `getDep` can take 1 parameter
 * `name` - Required {String} Name of the dependency

```javascript

var SuperPipe = require('superpipe')
var superpipe = new SuperPipe()

var x = 5

superpipe
  .setDep('x',x)

var z = superpipe.getDep('x') // z = 5

```

##  Bug Reports [here](https://github.com/lsm/superpipe/issues)

[dep-url]: https://david-dm.org/lsm/superpipe
[dep-image]: https://david-dm.org/lsm/superpipe.svg
[license-img]: https://img.shields.io/npm/l/superpipe.svg
[license-url]: http://opensource.org/licenses/MIT
[npm-img]: http://img.shields.io/npm/v/superpipe.svg
[npm-url]: https://npmjs.org/package/superpipe
[ci-img]: https://circleci.com/gh/lsm/superpipe/tree/master.svg?style=shield
[ci-url]: https://circleci.com/gh/lsm/superpipe/tree/master
[coverage-img]: https://coveralls.io/repos/lsm/superpipe/badge.svg?branch=master&service=github
[coverage-url]: https://coveralls.io/github/lsm/superpipe?branch=master
[climate-img]: https://codeclimate.com/github/lsm/superpipe/badges/gpa.svg
[climate-url]: https://codeclimate.com/github/lsm/superpipe
