

# Build the src code to lib folder for publishing to npm.
build:
	npm run build

# Watch changes and run build.
build-watch:
	npm run build-watch

unit:
	npm test
watch:
	npm run watch

coverage:
	@echo TRAVIS_JOB_ID $(TRAVIS_JOB_ID)
	npm run coverage

browser:
	zuul --no-coverage -- test/*

zuul-local:
	zuul --no-coverage --local 8080 -- test/*

tunnel:
	zuul --no-coverage --local 8080 --tunnel -- test/*

sauce-connect:
	node .sc.js
