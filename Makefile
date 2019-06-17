

# Build the src code to lib folder for publishing to npm.
build:
	npm run build

# Watch changes and run build.
build-watch:
	npm run build-watch

clean-build:
	rm -rf ./es ./lib ./dist

unit:
	npm test

watch:
	npm run watch

coverage:
	npm run coverage

# Run test and report coverage reports to coveralls.
report-coverage: coverage
	npm run report-coverage
