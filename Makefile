unit:
	npm test
watch:
	npm run watch

test-coverage:
	@echo TRAVIS_JOB_ID $(TRAVIS_JOB_ID)
	npm run coverage
	if [ "${REPORT}" == "yes" ]; then cat coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js; fi

test-browser:
	zuul -- test/*
