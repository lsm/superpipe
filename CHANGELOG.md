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
