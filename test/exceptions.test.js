  describe('next', function() {
    it('should throw if next was called more than once in a pipe', function() {
      expect(function() {
        sp('call next twice')
          .pipe(
            function(next) {
              console.log(next.toString())
              next()
              next()
            },
            'next'
          )
          .end()()
      }).to.throw('"next" should not be called more than once in a pipe.')
    })
  })
