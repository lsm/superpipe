

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

# Run test and report coverage reports to coveralls.
coveralls: unit
	npm run coverage

# Test on the saucelabs cloud.
browser:
	TEST_ENV=browser ./node_modules/.bin/karma start karma.conf.js

# Test on local browsers.
local-browser:
	./node_modules/.bin/karma start karma.conf.js
