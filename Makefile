unit:
	npm test
watch:
	npm run watch

test-coverage:
	@echo TRAVIS_JOB_ID $(TRAVIS_JOB_ID)
	npm run coverage

test-browser:
	zuul -- test/*
