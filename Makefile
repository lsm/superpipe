

unit:
	npm test
watch:
	npm run watch

lib-cov:
	@rm -rf ./lib-cov
	@./node_modules/jscoverage/bin/jscoverage ./lib ./lib-cov

test-report:
	@./node_modules/.bin/mocha --reporter $(REPORTER)

test-coveralls: lib-cov
	@echo TRAVIS_JOB_ID $(TRAVIS_JOB_ID)
	SUPERPIPE_COV=1 $(MAKE) test-report REPORTER=mocha-lcov-reporter | ./node_modules/coveralls/bin/coveralls.js
	@rm -rf ./lib-cov
