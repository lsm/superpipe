var express = require('express')
var app = express()
var http = require('http').Server(app)
var io = require('socket.io')(http)
var path = require('path')
var SuperPipe = require('superpipe')
var superpipe = new SuperPipe()
var passport = require('passport')
var LocalStrategy = require('passport-local').Strategy
var bodyParser = require('body-parser')
var cookieParser = require('cookie-parser')
require('./pipeline')(superpipe)
var fakeUser = require('./fake-users')

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
  extended: false
}))
app.use(cookieParser())
app.use(require('express-session')({
  secret: 'keyboard cat',
  resave: false,
  saveUninitialized: false
}))
app.use(passport.initialize())
app.use(passport.session())

app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res, next) {
  if (req.user) {
    next()
  } else {
    res.redirect('/login')
  }
}, function(req, res) {
  console.log(req.user)
  res.sendFile(__dirname + '/views/index.html')
})

app.get('/login', function(req, res, next) {
  if (req.user) {
    res.redirect('/')
  } else {
    next()
  }
}, function(req, res) {
  res.sendFile(__dirname + '/views/login.html')
})

app.post('/login', passport.authenticate('local'), function(req, res, next) {
  req.session.save(function(err) {
    if (err) {
      return next(err)
    }
    res.redirect('/')
  })
})

app.get('/logout', function(req, res, next) {
  req.logout()
  req.session.save(function(err) {
    if (err) {
      return next(err)
    }
    res.redirect('/')
  });
});

passport.use(new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password'
  },
  function(username, password, done) {
    var user = fakeUser.findUser(username, password)
    if (!user) {
      return done(null, false, {
        message: 'Username and passport do not match.'
      })
    } else {
      return done(null, user)
    }
  }))

passport.serializeUser(function(user, done) {
  done(null, user.id)
})

passport.deserializeUser(function(id, done) {
  var userId = fakeUser.findId(id)
  if (!userId) {
    done('Wrong id')
  } else {
    done(null, userId);
  }
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
