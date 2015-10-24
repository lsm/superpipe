unit:
	npm test
watch:
	npm run watch

coverage:
	@echo TRAVIS_JOB_ID $(TRAVIS_JOB_ID)
	npm run coverage

browser:
	zuul -- test/*
