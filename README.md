# SuperPipe

[![License MIT][license-img]][license-url]
[![NPM version][npm-img]][npm-url]
[![Dependencies][dep-image]][dep-url]
[![build status][travis-img]][travis-url]
[![Coverage Status][coverage-img]][coverage-url]
[![Code Climate][climate-img]][climate-url]

[![Sauce Test Status](https://saucelabs.com/browser-matrix/spipe.svg)](https://saucelabs.com/u/spipe)


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


##  Bug Reports [here](https://github.com/lsm/superpipe/issues)

[dep-url]: https://david-dm.org/lsm/superpipe
[dep-image]: https://david-dm.org/lsm/superpipe.svg
[license-img]: https://img.shields.io/npm/l/superpipe.svg
[license-url]: http://opensource.org/licenses/MIT
[npm-img]: http://img.shields.io/npm/v/superpipe.svg
[npm-url]: https://npmjs.org/package/superpipe
[travis-img]: https://travis-ci.org/lsm/superpipe.svg?branch=master
[travis-url]: http://travis-ci.org/lsm/superpipe
[coverage-img]: https://coveralls.io/repos/lsm/superpipe/badge.svg?branch=master&service=github
[coverage-url]: https://coveralls.io/github/lsm/superpipe?branch=master
[climate-img]: https://codeclimate.com/github/lsm/superpipe/badges/gpa.svg
[climate-url]: https://codeclimate.com/github/lsm/superpipe
