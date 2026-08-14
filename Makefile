# Build the src code to lib folder for publishing to npm.
build:
	npm run build

clean-build:
	rm -rf ./es ./lib ./dist

unit:
	npm test

watch:
	npm run watch

coverage:
	npm run coverage
