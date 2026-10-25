# Three.js 0.180.0

Self-hosted `three.module.min.js`, `three.core.min.js` and `examples/jsm/controls/OrbitControls.js` from the published npm package `three@0.180.0` via cdn.jsdelivr.net. MIT license in LICENSE; copyright headers retained. OrbitControls has one local import-path adjustment to `./three.module.min.js`. No other vendor code is changed. The viewer lazily imports these assets only when an Atlas is present.

Update these files together, retain LICENSE, and run the projection/model/browser regressions.

Vendored contents were compared byte-for-byte (after the single documented import-path adjustment) against the npm tarball verified with its registry SHA-512 integrity.
