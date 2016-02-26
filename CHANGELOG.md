0.10.0 2016-02-25
=================
- Name of error pipe can be retrived by dependency `errPipeName` in the error handler.
- `setDep` can be called through `next.setDep` to reduce the number of arguments
needed for pipe functions when both `next` and `setDep` are required.


0.9.0 2016-01-12
================
- Call `Superpipe` constructor directly returns a new Pipeline instance.
- Class `Pipeline` can be used without Superpipe.
- New prototype methods for Pipeline:
  - `push` is a unified interface for adding pipes to pipeline.
  - `seal` can seal the pipeline which prevent adding more pipes to it.
  - `toCurriedPipe` converts a pipeline into a curry function which connect an
  instance of Superpipe or Injector with the pipeline and returns it. (Later binding)
- Pipeline now returns a function as its instance when initialized/called.

0.8.0 2015-12-15
================
- Upgrade `insider@0.4.0`
- Put number as the first element of dependencies array to indicate the number of
default arguments you want to feed to the piped function.

0.7.1 2015-11-17
================
- Use `#pipe('emit', 'event name', deps)` to emit events.

0.7.0 2015-11-17
================
More strict api.
- `#pipe` only accepts three arguments: `function`, `dependencies` and `supplies`
- New signature `#listenTo('emitterName', eventName)` which allows listen
an emitter which can be found from dependencies (now or later).

0.6.0 2015-10-25
================
- Fully compatible with IE 6/7/8/9.

0.5.0 2015-10-13
================
- `Pipeline.trigger`, `Pipeline.toTrigger` and `Pipeline.emitter` have been removed
- `SuperPipe.listenTo` and `Pipeline.listenTo` use instance of superpipe
as emitter if only event name is provided.

0.4.0 2015-09-23
================
- `#pipe` now accepts number as millisecond for throttling event stream

0.3.0-3 2015-09-16
================
- Bug fix for error handler not getting error object.
- Fix an issue when works with jspm.

0.2.0 2015-05-06
================

- No `this` for piped function.
- Use `next` as error trigger.
- Supprt dependency injection for error handler.


0.1.0 2015-05-04
================

- Initial release.
