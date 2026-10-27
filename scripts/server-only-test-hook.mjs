import { registerHooks } from 'node:module';

// These Node tests execute server modules without Next's compiler. Resolve its
// marker here without switching React and react-dom to their RSC-only exports.
// Production builds still enforce the real server-only import boundary.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
