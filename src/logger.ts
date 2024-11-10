
let _log = console.log;

export default {
  log: (...args: any[]) => _log(...args),

  setLogger: (logger: any) => {
    _log = logger;
  },

  disableLogger: () => {
    _log = () => {};
  }
};
