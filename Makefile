

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
	npm run coverage

# Run test and report coverage reports to coveralls.
report-coverage: coverage
	npm run report-coverage

# Test on the saucelabs cloud.
browser:
	npm run browser

# Test on local browsers.
local-browser:
	npm run local-browser
