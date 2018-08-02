/* globals describe, it */
import { expect } from 'chai'
import superpipe from '../src'

describe('Superpipe', function() {
  describe('superpipe()', function() {
    it('should create pipeline constructor', function() {
      let sp = superpipe()
      expect(sp).to.be.a('function')

      let pipeline = sp('my pipeline')
      expect(pipeline.end).to.be.a('function')
      expect(pipeline.pipe).to.be.a('function')
      expect(pipeline.error).to.be.a('function')
      expect(pipeline.input).to.be.a('function')
    })
  })

  describe('superpipe(deps)', function() {
    it('should use `deps` as dependencies when creating pipeline', () => {
      let deps = { key: 'value' }
      var sp = superpipe(deps)
      let pipeline = sp('key value pipeline')
        .pipe(
          key => {
            expect(key).to.equal(deps.key)
          },
          'key'
        )
        .end()
      pipeline()
    })
  })
})
