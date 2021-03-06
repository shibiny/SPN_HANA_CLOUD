'use strict';


const fs = require('fs');
const util = require('util');
const async = require('async');

let trace = process.env.TRACE;
let isHanaClientTraceEnabled = false;
let isHanaClientPacketTraceEnabled = false;
const Liveness_Ping = require('./liveness-ping');

// initialize with dummy object, will be replaced with instance of Liveness_Ping if --liveness-ping is set.
let liveness_ping = {
  sent: () => {},
  stop: () => {}
};


let sendMessagesToParentProcess = false;
const couldNotSend = [];

function logToParent (message) {
  if (sendMessagesToParentProcess) {
    if (process.send) {
      if (!process.send(message)) {
        // Saving the message to send later
        couldNotSend.push(message);
      }
    }
  }
}

function WriteToLogFile (message, severity) {
  if (logFile) {
    switch (severity) {
    case 0 : message = JSON.stringify({id: ++logMessageId, origin: '@sap/hdi-deploy', severity: 'INFO', message: message, timestamp_utc: new Date().toUTCString()});
      break;
    case 1 : message = JSON.stringify({id: ++logMessageId, origin: '@sap/hdi-deploy', severity: 'WARNING', message: message, timestamp_utc: new Date().toUTCString()});
      break;
    case 2 : message = JSON.stringify({id: ++logMessageId, origin: '@sap/hdi-deploy', severity: 'ERROR', message: message, timestamp_utc: new Date().toUTCString()});
      break;
    }
    fs.appendFileSync(logFile, `${message}\n`);
  }
}
function writeToStdOut () {
  liveness_ping.sent();
  const str = util.format.apply(null, arguments);
  process.stdout.write(`${str}\n`);

  if (str.indexOf('WARNING:') !== -1) {
    WriteToLogFile(str.replace('WARNING: ', ''), 1);
  } else {
    WriteToLogFile(str, 0);
  }

}

function writeToStdErr () {
  liveness_ping.sent();
  const str = util.format.apply(null, arguments);
  process.stderr.write(`${str}\n`);
  WriteToLogFile(str, 2);
}

exports.set_liveness_ping = function (enable_liveness_ping) {
  if (enable_liveness_ping) {
    liveness_ping = new Liveness_Ping();
  }
};

exports.stop_sending_liveness_ping = function () {
  liveness_ping.stop();
};

exports.log = writeToStdOut;

function warn () {
  const args = arguments;
  args[0] = `WARNING: ${args[0]}`;
  writeToStdOut.apply(null, args);
}

exports.warn = warn;

exports.logfn = function () {
  const args = arguments;
  return function (cb) {
    writeToStdOut.apply(null, args);
    cb();
  };
};

exports.error = function () {
  const args = arguments;
  writeToStdErr.apply(null, args);
  // Ensure that errors are always reported to the parent process.
  if (args[0] && typeof args[0] === 'string') {
    args[0] = JSON.stringify({
      origin: '@sap/hdi-deploy',
      severity: 'ERROR',
      message: args[0],
      timestamp_utc: new Date().toUTCString()
    }, null, 2);
  }
  logToParent.apply(null, args);
};

exports.setTrace = function (value) {
  trace = value;
};

exports.getTrace = function () {
  return trace;
};

exports.setHanaClientTrace = function (value) {
  isHanaClientTraceEnabled = value;
};

exports.getHanaClientTrace = function () {
  return isHanaClientTraceEnabled;
};

exports.setHanaClientPacketTrace = function (value) {
  isHanaClientPacketTraceEnabled = value;
};

exports.getHanaClientPacketTrace = function () {
  return isHanaClientPacketTraceEnabled;
};

exports.checkHanaClientTraceArguments = function () {
  if (isHanaClientPacketTraceEnabled && !isHanaClientTraceEnabled) {
    warn('Option hana-client-packet-trace requires option hana-client-trace to be set.');
  }
};

const client_private_key_1_regexp = new RegExp('"client_authentication_private_key":.*', 'ig');
const client_private_key_2_regexp = new RegExp('client_authentication_private_key:.*', 'ig');
// eslint-disable-next-line no-control-regex
const client_private_key_3_regexp = new RegExp('key:(.|\n)*', 'g');
const client_private_key_4_regexp = new RegExp('.*-----BEGIN PRIVATE KEY.*END PRIVATE KEY.*', 'g');
exports.trace = function () {
  if (trace) {
    let str = util.format.apply(null, arguments);
    str = str.replace(/PASSWORD.*/ig, 'p[...]');
    str = str.replace(client_private_key_1_regexp, '"client_authentication_private_key": [..]');
    str = str.replace(client_private_key_2_regexp, 'client_authentication_private_key: [..]');
    str = str.replace(client_private_key_3_regexp, 'key: [..]');
    str = str.replace(client_private_key_4_regexp, '');
    writeToStdOut(str);
  }
};

const timers = {};

function timerInit (timer) {
  timers[timer] = process.hrtime();
}

function timerDelta (timer) {
  const then = timers[timer];
  const diff = process.hrtime(then);
  if (then || diff) {
    return `(${diff[0]}s ${(diff[1] / 1000000).toFixed(0)}ms)`;
  } else {
    return '';
  }
}

exports.timerInit = timerInit;

exports.timerDelta = timerDelta;

function logTimerInit (timer) {
  const args = Array.prototype.slice.call(arguments, 1);
  timerInit(timer);
  writeToStdOut.apply(null, args);
}

function logTimerDelta (timer) {
  const args = Array.prototype.slice.call(arguments, 1);
  const delta = timerDelta(timer);
  args.push(delta);
  writeToStdOut.apply(null, args);
}

exports.logTimerInit = logTimerInit;

exports.logTimerDelta = logTimerDelta;

exports.logfnTimerInit = function () {
  const args = arguments;
  return function (cb) {
    logTimerInit.apply(undefined, args);
    cb();
  };
};

exports.logfnTimerDelta = function () {
  const args = arguments;
  return function (cb) {
    logTimerDelta.apply(undefined, args);
    cb();
  };
};

let verbose = true;

exports.setVerbose = function (value) {
  verbose = value;
};

exports.logVerbose = function () {
  if (verbose) {
    liveness_ping.sent();
    const str = util.format.apply(null, arguments);
    process.stdout.write(`${str}\n`);
  }
};

let logFile;

exports.setLogFile = function (filename) {
  logFile = filename;
};

let logMessageId = 0;

exports.nextMessageId = function () {
  return ++logMessageId;
};

exports.logToFile = function (message) {
  if (logFile) {
    fs.appendFileSync(logFile, `${JSON.stringify(message)}\n`);
  }
};

exports.setSendMessagesToParentProcess = function (value) {
  sendMessagesToParentProcess = value;
};


/**
 * Send the message - retry 5 times, waiting 1s between attempts
 *
 * @param {any} message Message to send to parent
 * @returns {AsyncFunction}
 */
function send (message) {
  return function (cb) {
    /**
     * Attemp to send the message
     *
     * @param {any} attempt Current attempt
     * @returns {undefined}
     */
    function attemptToSendMessage (attempt) {
      if (attempt >= 5) {
        // after 5 attempts give up.
        return cb(new Error('Could not send message to parent process'));
      }

      process.send(message, function (err) {
        if (err) {
          let msg;
          if (err.message) {
            msg = err.message;
          } else {
            msg = err;
          }
          writeToStdErr(`could not send message to parent process: ${msg}\n  trying again in one second...`);

          setTimeout(attemptToSendMessage, 1000, attempt + 1);
        } else {
          return cb();
        }
      });
    }

    attemptToSendMessage(message);
  };
}

exports.sendAllMessages = (cb) => {
  if (sendMessagesToParentProcess) {
    async.series(couldNotSend.map((m) => send(m)), cb);
  } else {
    return cb();
  }
};

exports.getLeftoverMessages = () => couldNotSend;

exports.logToParent = logToParent;
