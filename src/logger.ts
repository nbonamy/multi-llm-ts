
let _log = console.log;

export default {
  // Standard log method – for general info-level logging
  log: (...args: any[]) => _log(...args),

  // Debug helper – emits only when DEBUG flag is set
  debug: (...args: any[]) => {
    if (process.env.DEBUG) {
      _log(...args);
    }
  },

  // Allow callers to replace the underlying logger implementation (e.g. pino)
  setLogger: (logger: any) => {
    _log = logger;
  },

  // Disable all logging (both log & debug)
  disableLogger: () => {
    _log = () => {};
  }
};
