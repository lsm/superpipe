var findWhere = require('lodash.findWhere')

var users = [{
  id: 1,
  username: 'user1',
  password: '111'
}, {
  id: 2,
  username: 'user2',
  password: '222'
}, {
  id: 3,
  username: 'user3',
  password: '333'
}]

module.exports = {
  findUser: function(username, password) {
    return findWhere(users, {
      username: username,
      password: password
    })
  },
  findId: function(id) {
    return findWhere(users, {
      id: id
    })
  }
}
