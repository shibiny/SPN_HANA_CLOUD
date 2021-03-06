'use strict';


const logger = require('./lib/logger.js');
logger.timerInit('overall');


const fs = require('fs');
const {basename} = require('path');
const utils = require('./lib/utils.js');
const connections = require('./lib/connections.js');

// if a default-env.json file exists, integrate the contained variables into process.env
const xsenv = require('@sap/xsenv');
const defaultEnvFile = 'default-env.json';
const dotEnvFile = '.env';
let usedDefaultEnvFile = false;
let useDotEnvFile = false;
if (fs.existsSync(defaultEnvFile)) {
  xsenv.loadEnv(defaultEnvFile);
  // we write the log message later
  usedDefaultEnvFile = true;
} else if (fs.existsSync(dotEnvFile)) {
  const res = require('dotenv').config();
  if (!res.error) {
    useDotEnvFile = true;
  }
}

// variables for the default-services.json file
const defaultServicesFile = 'default-services.json';
let usedDefaultServicesFile = false;

const pjson = require('./package.json');
const options = require('./lib/options.js');
const args = require('./lib/arguments.js');

const opt = options();

const exit_rc0_silent = Error('');

function idle () {
  setTimeout(idle, 10 * 60 * 1000);
}

function signalProcessExit (exitCode, showOverallTime, forcedExit) {

  try {
    logger.trace(`Closing ${connections.length} connections, just to be safe...`);
    connections.forEach(({client, file}) => {
      try {
        logger.trace(`  Closing connection from ${basename(file)}...`);
        client.disconnect();
        logger.trace(`  Closing connection from ${basename(file)}... ok`);
      } catch (e) {
        logger.trace(`  Error closing connection from ${basename(file)}: ${e}`);
      }
    });
    logger.trace(`Closing ${connections.length} connections, just to be safe... ok`);
  } catch (e) {
    logger.trace(`General error while closing connections: ${e}`);
  }

  if (showOverallTime) {
    logger.log(logger.timerDelta('overall'));
  }

  if (opt.exit || exitCode || forcedExit) {
    const written = process.stdout.write('\n');
    if (written) {
      // stdout was already drained, just exit now
      process.exit(exitCode);
    } else {
      // register for drain event, and idle until then
      process.stdout.once('drain', function () {
        process.exit(exitCode);
      });
      // fall through to idle()
    }
  } else {
    logger.log('Application can be stopped.');
    // fall through to idle()
  }

  // always idle() if we get here
  idle();

  // note: returning to caller here, idle() is handled in the event loop
}

/*
 * set defaults from environment variables
 * note: for backwards compatibility, support for EXIT should stay forever
 */
if (typeof process.env.EXIT !== 'undefined') {
  opt.exit = true;
}

// check environment variable HDI_DEPLOY_OPTIONS for more options and translate them to process arguments
if (typeof process.env.HDI_DEPLOY_OPTIONS !== 'undefined') {
  let options;
  const name = 'HDI_DEPLOY_OPTIONS';
  try {
    options = JSON.parse(process.env[name]);
  } catch (error) {
    logger.error(`Failed to parse JSON object in HDI_DEPLOY_OPTIONS: ${error}`);
    process.exit(1);
  }

  for (const option in options) {
    if (option === 'auto_undeploy') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'exit') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'detect_server_version') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'detect_container_api_version') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'detect_hdi_version') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'lock_container') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'working_set') {
      args.translateJSONEnvStringArrayOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'include_filter') {
      args.translateJSONEnvStringArrayOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'exclude_filter') {
      args.translateJSONEnvStringArrayOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'deploy') {
      args.translateJSONEnvStringArrayOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'treat_unmodified_as_modified') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'validate_external_dependencies') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'undeploy') {
      args.translateJSONEnvStringArrayOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'parameter') {
      args.translateJSONEnvStringKeyValueObjectOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'path-parameter' || option === 'path_parameter') {
      args.translateJSONEnvStringKeyValueObjectOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'treat_warnings_as_errors') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'simulate_make') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'info') {
      args.translateJSONEnvStringArrayOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'root') {
      args.translateJSONEnvStringOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'structured_log') {
      args.translateJSONEnvStringOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'verbose') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'strip_cr_from_csv') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'connection_timeout') {
      args.translateJSONEnvIntegerOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'delete_timeout') {
      args.translateJSONEnvIntegerOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'write_timeout') {
      args.translateJSONEnvIntegerOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'lock_container_timeout') {
      args.translateJSONEnvIntegerOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'send_messages_to_parent_process') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'treat_wrong_ownership_as_errors') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'migrationtable_development_mode') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'liveness_ping') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'live_messages') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'trace') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'hana_client_trace') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'hana_client_packet_trace') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else if (option === 'version') {
      args.translateJSONEnvBooleanOptionToOption(logger, options, name, option, process.argv);
    } else {
      logger.error(`Unknown option ${option} in HDI_DEPLOY_OPTIONS`);
      process.exit(1);
    }
  }
}

// some check functions (to avoid to create functions in loops)
function checkPathInDeployOption (path) {
  if (path[path.length - 1] === '/') {
    logger.error(`Error: option deploy does not support directories: ${path}`);
    process.exit(1);
  }
}
function checkPathInUndeployOption (path) {
  if (path[path.length - 1] === '/') {
    logger.error(`Error: option undeploy does not support directories: ${path}`);
    process.exit(1);
  }
}

function parseTimeoutOption (nameWithoutLeadingDashes, optionName, index) {
  if (index+1 >= process.argv.length || `${Number.parseInt(process.argv[index+1])}` !== `${process.argv[index+1]}`) {
    logger.error(`Option ${nameWithoutLeadingDashes} requires an integer argument`);
    process.exit(1);
  }
  opt[optionName] = Number.parseInt(process.argv[index+1]);
  return index+1;
}

// process arguments
let showInfo = false;
const showInfoComponents = [];
for (let i = 2; i < process.argv.length; ++i) {
  const arg = process.argv[i];
  if (arg === '-h' || arg === '--help') {
    const help = [
      '',
      `  ${pjson.name}, version ${pjson.version}`,
      '',
      '  Options:',
      '',
      '    -h, --help                    print usage information and exit',
      '        --version                 print version and exit',
      '    -t, --trace                   enable tracing',
      '    --hana-client-trace           enable tracing for the SAP HANA client; all interactions with the SAP HANA server will be traced which can lead to a large amount of trace information to be written',
      '    --hana-client-packet-trace    enable PACKET tracing for the SAP HANA client; Must be used in combination with --hana-client-trace',
      "        --[no-]verbose            [don't] print detailed log messages to the console",
      '        --structured-log <file>   write log messages as JSON objects into the given file; messages are appended if the file already exists',
      '',
      '        --info [<component> ..]   show information about the given components and exit; available components: all, client, server',
      '                                  by default, information about all components will be shown',
      '        --[no-]detect-server-version',
      "                                  [don't] detect the version of the server",
      '                                  by default, version detection is enabled',
      '        --[no-]detect-container-api-version',
      "                                  [don't] detect the container api version of the server",
      '                                  by default, container api version detection is enabled',
      '        --[no-]detect-hdi-version',
      "                                  [don't] detect the hdi version of the server",
      '                                  by default, hdi version detection is enabled',
      '',
      "        --[no-]exit               [don't] exit after deployment of artifacts",
      '                                  by default, the application will not exit, but enter an idle mode',
      "        --[no-]lock-container     [don't] acquire the container lock while working with the container",
      '                                  by default, the container is locked for server versions >= 2.0.10.0',
      '',
      '        --root <path>             use the given root path for artifacts',
      '                                  by default, the current work directory is used',
      '        --working-set [<path> ..]',
      '                                  define the given paths (directories and files) as the working set; use -- as a separator if a path starts with --',
      '                                  by default, the default working set is used',
      '                                  a non-default working set applies additional restrictions, e.g. other options might be disallowed',
      '        --include-filter [<path> ..]',
      '                                  only include the given paths (directories and files) during delta detection; use -- as a separator if a path starts with --',
      '                                  by default, no / an empty filter is used',
      '        --deploy [<file> ..]      explicitly schedule the given files for deploy; extends the include-filter for collecting local files',
      '        --[no-]treat-unmodified-as-modified',
      "                                  [don't] treat unmodified files during delta detection as modified files",
      '        --undeploy [<file> ..]    explicitly schedule the given files for undeploy',
      "        --[no-]auto-undeploy      [don't] undeploy artifacts automatically based on delta detection and ignore the undeploy.json file",
      '                                  by default, artifacts will not be undeployed automatically',
      '',
      '        --[no-]treat-warnings-as-errors',
      "                                  [don't] treat warnings as errors",
      "        --[no-]simulate-make      [don't] simulate the make and skip post-make activities; pre-make activities still take effect, e.g. grants",
      '        --parameter [<key>=<value> ..]',
      '                                  pass the given list of key-value parameters to the deployment',
      '        --path-parameter [<path>:<key>=<value> ..]',
      '                                  pass the given list of key-value path-parameters to the deployment',
      '',
      "        --[no-]strip-cr-from-csv  [don't] strip carriage return characters from CSV files",
      '                                  by default, CSV files are not modified',
      '',
      "        --[no-]treat-wrong-ownership-as-errors [don't] treat wrong ownership of objects as errors",
      '                                  by default, wrong ownership will not result in errors',
      '',
      "        --[no-]migrationtable-development-mode [don't] pass the development mode flag for migration tables to HDI, if the parameter is supported by the server",
      '                                  by default, will not pass the flag',
      '',
      "        --[no-]liveness-ping  [don't] send a sign of life from time to time",
      '                                  by default, a sign of life will be sent',
      '',
      "        --[no-]live-messages  [don't] display the make messages while the make is still in progress",
      '                                  by default, the messages will be displayed while the make is in progress',
      '',
      '        --connection-timeout <ms>',
      '                                  number of milliseconds to wait for the database connection(s)',
      `                                  by default, the timeout is ${opt.connectionTimeout} ms`,
      '        --delete-timeout <ms>',
      '                                  number of milliseconds to wait for the HDI delete call',
      `                                  by default, the timeout is ${opt.deleteTimeout} ms`,
      '        --write-timeout <ms>',
      '                                  number of milliseconds to wait for the HDI write call',
      `                                  by default, the timeout is ${opt.writeTimeout} ms`,
      '        --lock-container-timeout <ms>',
      '                                  number of milliseconds to wait for the container lock',
      `                                  by default, the timeout is ${opt.lockContainerTimeout} ms`,
      ''
    ];
    logger.log(help.join('\n'));
    signalProcessExit(0, false, true);
    return;
  } else if (arg === '--version') {
    logger.log(pjson.version);
    signalProcessExit(0, false, true);
    return;
  } else if (arg === '--info') {
    // just collect the components here to ensure that the last occurrence of the option wins
    showInfo = true;
    i = args.translateStringListOptionToArray(i, process.argv, showInfoComponents);
  } else if (arg === '-a' || arg === '--autoUndeploy') {
    opt.autoUndeploy = true;
  } else if (arg === '--auto-undeploy') {
    opt.autoUndeploy = true;
  } else if (arg === '--no-auto-undeploy') {
    opt.autoUndeploy = false;
  } else if (arg === '--exit') {
    opt.exit = true;
  } else if (arg === '--no-exit') {
    opt.exit = false;
  } else if (arg === '--detect-server-version') {
    opt.detectServerVersion = true;
  } else if (arg === '--no-detect-server-version') {
    opt.detectServerVersion = false;
  } else if (arg === '--detect-container-api-version') {
    opt.detectContainerAPIVersion = true;
  } else if (arg === '--no-detect-container-api-version') {
    opt.detectContainerAPIVersion = false;
  } else if (arg === '--detect-hdi-version') {
    opt.detectHDIVersion = true;
  } else if (arg === '--no-detect-hdi-version') {
    opt.detectHDIVersion = false;
  } else if (arg === '--lock-container') {
    opt.lockContainer = true;
  } else if (arg === '--no-lock-container') {
    opt.lockContainer = false;
  } else if (arg === '--working-set') {
    i = args.translatePathListOptionToPathFilter(i, process.argv, opt.workingSet);
  } else if (arg === '--include-filter') {
    i = args.translatePathListOptionToPathFilter(i, process.argv, opt.includeFilter);
  } else if (arg === '--exclude-filter') {
    i = args.translatePathListOptionToPathFilter(i, process.argv, opt.excludeFilter);
  } else if (arg === '--deploy') {
    i = args.translatePathListOptionToPathFilter(i, process.argv, opt.deploy, checkPathInDeployOption);
  } else if (arg === '--treat-unmodified-as-modified') {
    opt.treatUnmodifiedAsModified = true;
  } else if (arg === '--no-treat-unmodified-as-modified') {
    opt.treatUnmodifiedAsModified = false;
  } else if (arg === '--validate-external-dependencies') {
    opt.validateExternalDependencies = true;
  } else if (arg === '--no-validate-external-dependencies') {
    opt.validateExternalDependencies = false;
  } else if (arg === '--undeploy') {
    i = args.translatePathListOptionToPathFilter(i, process.argv, opt.undeploy, checkPathInUndeployOption);
  } else if (arg === '--parameter') {
    i = args.translateStringKeyValueListOptionToObject(i, process.argv, opt.parameters);
  } else if (arg === '--path-parameter') {
    i = args.translateStringKeyValueListOptionToObject(i, process.argv, opt.path_parameters);
  } else if (arg === '--treat-warnings-as-errors') {
    opt.treatWarningsAsErrors = true;
  } else if (arg === '--no-treat-warnings-as-errors') {
    opt.treatWarningsAsErrors = false;
  } else if (arg === '--simulate-make') {
    opt.simulateMake = true;
  } else if (arg === '--no-simulate-make') {
    opt.simulateMake = false;
  } else if (arg === '--root') {
    ++i;
    if (i >= process.argv.length) {
      logger.error('Option root requires a <path> argument');
      process.exit(1);
    }
    opt.root = process.argv[i];
  } else if (arg === '--structured-log') {
    ++i;
    if (i >= process.argv.length) {
      logger.error('Option structured-log requires a <file> argument');
      process.exit(1);
    }
    opt.logFile = process.argv[i];
  } else if (arg === '--send-messages-to-parent-process') {
    opt.sendMessagesToParentProcess = true;
  } else if (arg === '--no-send-messages-to-parent-process') {
    opt.sendMessagesToParentProcess = false;
  } else if (arg === '--verbose') {
    opt.verbose = true;
  } else if (arg === '--no-verbose') {
    opt.verbose = false;
  } else if (arg === '--strip-cr-from-csv') {
    opt.stripCRFromCSV = true;
  } else if (arg === '--no-strip-cr-from-csv') {
    opt.stripCRFromCSV = false;
  } else if (arg === '-t' || arg === '--trace') {
    logger.setTrace(true);
  } else if (arg === '--no-trace') { // fixes dump if set to false via env
    logger.setTrace(false);
  } else if (arg === '--hana-client-trace') {
    logger.setHanaClientTrace(true);
  } else if (arg === '--hana-client-packet-trace') {
    logger.setHanaClientPacketTrace(true);
  } else if (arg === '--connection-timeout') {
    i = parseTimeoutOption('connection-timeout', 'connectionTimeout', i);
  } else if (arg === '--delete-timeout') {
    i = parseTimeoutOption('delete-timeout', 'deleteTimeout', i);
  } else if (arg === '--write-timeout') {
    i = parseTimeoutOption('write-timeout', 'writeTimeout', i);
  } else if (arg === '--lock-container-timeout') {
    i = parseTimeoutOption('lock-container-timeout', 'lockContainerTimeout', i);
  } else if (arg === '--no-treat-wrong-ownership-as-errors') {
    opt.treatWrongOwnershipAsErrors = false;
  } else if (arg === '--treat-wrong-ownership-as-errors') {
    opt.treatWrongOwnershipAsErrors = true;
  } else if (arg === '--no-migrationtable-development-mode') {
    opt.migrationTableDevMode = false;
  } else if (arg === '--migrationtable-development-mode') {
    opt.migrationTableDevMode = true;
  } else if (arg === '--no-liveness-ping') {
    opt.liveness_ping = false;
  } else if (arg === '--liveness-ping') {
    opt.liveness_ping = true;
  } else if (arg === '--no-live-messages') {
    opt.live_messages = false;
  } else if (arg === '--live-messages') {
    opt.live_messages = true;
  } else {
    logger.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
}
logger.checkHanaClientTraceArguments();
/*
 * only do segfault handling for --trace
 * As this is a native module it might cause issues when node_modules are already provided...
 */
if (logger.getTrace()) {
  try {
    process.on('SIGBUS', function (...args) {
      console.trace(args);
      process.exit(7);
    });
    // eslint-disable-next-line node/no-missing-require
    const segfaultHandler = require('segfault-handler');

    // Callback only called on linux
    segfaultHandler.registerHandler('segfault-crash.log', function (signal, address, stack) {
      logger.error(signal);
      logger.error(address);
      logger.error(stack);
    });
    logger.log('Successfully initialized segfault-handler.');
  } catch (e) {
    logger.error(`Warning: Could not initialize segfault handler because of: ${e}`);
  }
}

// check for valid HDI_DEPLOY_MODE values
if (typeof process.env.HDI_DEPLOY_MODE !== 'undefined') {
  const mode = process.env.HDI_DEPLOY_MODE;
  if (mode === 'ZDM') {
    // ok
  } else if (mode === '') {
    // ok, will be treated as default
  } else {
    logger.error(`Unknown value for HDI_DEPLOY_MODE: ${mode}`);
    process.exit(1);
  }
}

// trace the options object after processing the arguments
logger.trace('options:', opt);
logger.trace(`HDI_DEPLOY_MODE: "${process.env.HDI_DEPLOY_MODE}"`);
if (process.execArgv.length !== 0) {
  logger.trace(`Node commandline arguments: ${process.execArgv}`);
}


// argument processing is complete

// apply the logger specific options
logger.setVerbose(opt.verbose);
logger.setLogFile(opt.logFile);
logger.setSendMessagesToParentProcess(opt.sendMessagesToParentProcess); // only used for inter process communication when forked from server.js
logger.set_liveness_ping(opt.liveness_ping);

const async = require('async');
let services;
const version_server = require('./lib/version.server.js');
let serverVersion = version_server.getFallbackVersion();
let info = {};

const version_container_api = require('./lib/version.container-api.js');
let container_api_version = version_container_api.getFallbackVersion();

function initializeContainerAPIVersion (cb) {
  try {
    if (opt.detectContainerAPIVersion) {
      version_container_api.getVersion(services.getTargetCreds(), function (err, result) {
        container_api_version = result;
        cb();
      });
    } else {
      cb();
    }
  } catch (error) {
    cb(error.message);
  }
}

const version_hdi = require('./lib/version.hdi-version.js');
let hdi_version = version_hdi.getFallbackVersion();

function initializeHDIVersion (cb) {
  try {
    if (opt.detectHDIVersion) {
      version_hdi.getVersion(services.getTargetCreds(), function (err, result) {
        hdi_version = result;
        cb();
      });
    } else {
      cb();
    }
  } catch (error) {
    cb(error.message);
  }
}

function handleShowInfoOptionAndExit (cb) {
  try {
    // fill info object
    info = require('./lib/info.js').getInfoForComponents(showInfoComponents, serverVersion, container_api_version, hdi_version);

    // show info and stop; if requested
    if (showInfo) {
      logger.log(JSON.stringify(info, null, 4));
      cb(exit_rc0_silent);
      return;
    }

    cb();
  } catch (error) {
    cb(error.message);
  }
}

function injectDefaultServices (cb) {
  try {
    // if a default-services.json file exists, integrate the contained services into process.env.VCAP_SERVICES
    if (fs.existsSync(defaultServicesFile)) {
      const defaultServices = utils.readJSONFile(defaultServicesFile);

      // get current env.VCAP_SERVICES
      let vcapServices = {};
      if ('VCAP_SERVICES' in process.env) {
        try {
          vcapServices = JSON.parse(process.env.VCAP_SERVICES);
        } catch (error) {
          cb(`Could not parse VCAP_SERVICES environment variable: ${error}`);
        }
      }

      // integrate all default services which do not exist in env.VCAP_SERVICES
      for (const defaultService in defaultServices) {
        if (defaultServices.hasOwnProperty(defaultService)) {
          if (!(defaultService in vcapServices)) {
            vcapServices[defaultService] = defaultServices[defaultService];
          }
        }
      }

      // update env.VCAP_SERVICES
      process.env.VCAP_SERVICES = JSON.stringify(vcapServices, null, 1);

      usedDefaultServicesFile = true;
    }

    cb();
  } catch (error) {
    cb(error.message);
  }
}

function initializeServices (cb) {
  try {
    // read services and service replacements
    services = require('./lib/services.js')();
    /**
     * trace the vcap services
     */
    if (typeof process.env.VCAP_SERVICES !== 'undefined') {
      logger.trace('VCAP_SERVICES:', JSON.stringify(JSON.parse(process.env.VCAP_SERVICES), null, 2));
    } else {
      logger.trace('VCAP_SERVICES: undefined');
    }

    if (opt.detectServerVersion || opt.detectHDIVersion || opt.container_api_version) {
      logger.trace('target credentials:', services.getTargetCreds());
    }
    cb();
  } catch (error) {
    cb(error.message);
  }
}

function initializeServerVersion (cb) {
  try {
    if (opt.detectServerVersion) {
      version_server.getVersion(services.getTargetCreds(), function (err, result) {
        serverVersion = result;
        cb();
      });
    } else {
      cb();
    }
  } catch (error) {
    cb(error.message);
  }
}

function showVersionAndOtherInformation (cb) {
  try {
    // always show our name plus version number; for support cases
    const mode = process.env.HDI_DEPLOY_MODE ? (`${process.env.HDI_DEPLOY_MODE}`).toLowerCase() : 'default';
    logger.log(`${pjson.name}, version ${pjson.version} (mode ${mode}), server version ${serverVersion.version} (${serverVersion.versionSynthesized}), node version ${process.versions.node}, HDI version ${hdi_version.version}, container API version ${container_api_version.version}`);
    // prints date & time in YYYY-MM-DD HH:MM:SS format
    logger.log(`Deployment started at ${utils.currentDateTime()}`);
    // log that we couldn't get the version from the server (usually we don't have privileges for SYS.M_DATABASE)
    if (serverVersion.error) {
      logger.log(`Detection of server version failed; root cause: ${serverVersion.error}`);
    }

    // log that we couldn't get the container api version from the server (usually we don't have privileges for SYS.M_FEATURES)
    if (container_api_version.error) {
      logger.log(`Detection of container API version failed; root cause: ${container_api_version.error}`);
    }

    // log that we couldn't get the hdi version from the server (usually we don't have privileges for SYS.M_FEATURES)
    if (hdi_version.error) {
      logger.log(`Detection of HDI version failed; root cause: ${hdi_version.error}`);
    }

    // if a default-env.json was sourced, write the log message now
    if (usedDefaultEnvFile) {
      logger.log(`Using default environment variables from file "${defaultEnvFile}"`);
    }
    // if a .env was sourced, write the log message now
    if (useDotEnvFile) {
      logger.log(`Using default environment variables from file "${dotEnvFile}"`);
    }

    if (usedDefaultServicesFile) {
      logger.log(`Using default services from file "${defaultServicesFile}"`);
    }

    if (services.usingServiceReplacements()) {
      logger.log(`Using service replacements from environment variable "SERVICE_REPLACEMENTS" with ${Object.getOwnPropertyNames(services.getServiceReplacements()).length} replacements`);
    }

    if (opt.workingSet.valid) {
      logger.log(`Using a non-default working set with ${opt.workingSet.size()} paths`);
    }

    cb();
  } catch (error) {
    cb(error.message);
  }
}

function setInternalOptionsBasedOnServerVersion (cb) {
  if (serverVersion.isGreaterThanOrEqualTo(1, 0, 120, 0)) {
    // since 1.0.120, we can use ignore_non_existing_paths on the server-side
    opt.singleDeleteCallsForDirectories = false;
    logger.trace('Option "singleDeleteCallsForDirectories" set to false based on server version.');
  }

  if (opt.lockContainer === undefined) {
    // since 2.0.10.0, we automatically use the container-level LOCK API on the server-side if nothing was defined explicitly
    opt.lockContainer = serverVersion.isGreaterThanOrEqualTo(2, 0, 10, 0);
  }

  opt.isHanaCloud = serverVersion.isGreaterThanOrEqualTo(4, 0, 0, 0);

  cb();
}

function checkArgumentsAgainstFeatures (cb) {
  if (Object.keys(opt.parameters).length !== 0) {
    if (info.client.features.parameter <= 0) {
      cb(`Option parameter is not supported by the server; based on detected server version ${serverVersion.version}`);
    }
  }

  if (Object.keys(opt.path_parameters).length !== 0) {
    if (info.client.features['path-parameter'] <= 0) {
      cb(`Option path-parameter is not supported by the server; based on detected server version ${serverVersion.version}`);
    }
  }

  if (opt.simulateMake) {
    if (info.client.features['simulate-make'] <= 0) {
      cb(`Option simulate-make is not supported by the server; based on detected server version ${serverVersion.version}`);
    }
  }

  if (opt.treatWarningsAsErrors) {
    if (info.client.features['treat-warnings-as-errors'] <= 0) {
      cb(`Option treat-warnings-as-errors is not supported by the server; based on detected server version ${serverVersion.version}`);
    }
  }

  if (opt.treatWrongOwnershipAsErrors) {
    if (info.client.features['treat-wrong-ownership-as-errors'] <= 0) {
      cb(`Option treat-wrong-ownership-as-errors is not supported by the server; based on HDI version ${hdi_version.version}`);
    }
  }

  if (opt.validateExternalDependencies) {
    if (info.client.features['validate-external-dependencies'] <= 0) {
      cb(`Option validate-external-dependencies is not supported by the server; based on HDI version ${hdi_version.version}`);
    }
  }

  if (opt.lockContainer) {
    if (info.client.features['lock-container'] <= 0) {
      cb(`Option lock-container is not supported by the server; based on detected server version ${serverVersion.version}`);
    }
  }

  if (process.env.HDI_DEPLOY_MODE === 'ZDM') {
    if (info.client.features['zero-downtime-update'] <= 0) {
      cb(`Zero-downtime update is not supported by the server; based on detected server version ${serverVersion.version}`);
    }
  }

  // Don't error out if this is not supported, simply ignore it.
  if (opt.migrationTableDevMode) {
    if (info.client.features['migrationtable-development-mode'] <= 0) {
      logger.log('The server does not support development_mode, --migrationtable-development-mode will be ignored.');
      opt.migrationTableDevMode = false;
    }
  }

  // Don't error out if this is not supported, simply ignore it.
  if (opt.live_messages) {
    if (info.client.features['live-messages'] <= 0) {
      logger.log('The server does not support live updating of make messages. The messages will be displayed, when the make is done.');
      opt.live_messages = false;
    }
  }

  cb();
}

function checkArgumentsForWorkingSet (cb) {
  if (opt.workingSet.valid) {
    opt.deploy.forEachFile(function (file) {
      if (!opt.workingSet.matchesPath(file)) {
        cb(`Explicit deploy of file "${file}" is not allowed; the file is not in the working set`);
      }
    });

    opt.undeploy.forEachFile(function (file) {
      if (!opt.workingSet.matchesPath(file)) {
        cb(`Explicit undeploy of file "${file}" is not allowed; the file is not in the working set`);
      }
    });

    opt.includeFilter.forEachFile(function (file) {
      if (!opt.workingSet.matchesPath(file)) {
        cb(`Explicit delta detection of file "${file}" is not allowed; the file is not in the working set`);
      }
    });
  }

  cb();
}

let deployError;
/*
 * Don't exit after this in case of deployment errors
 * we still need to send the messages to the parent!
 */
function processFilesAndDeploy (cb) {
  try {
    // finally, do the dirty work
    const deploy = require('./lib/deploy.js');
    if (process.env.HDI_DEPLOY_MODE === 'ZDM') {
      const zdmDeployer = require('./lib/zdm/zdmDeployer.js');
      zdmDeployer.deploy(deploy, opt, services, logger, cb);
    } else {
      deploy(opt, services, (e, r) => {
        if (e) {
          deployError = e;
        }

        return cb(undefined, r);
      });
    }
  } catch (error) {
    cb(error.message);
  }
}

function checkDeployError (cb) {
  return cb(deployError);
}
/*
 * Send all messages to the parent process that
 * We couldn't send JIT
 */
function sendAllMessages (cb) {
  return logger.sendAllMessages(cb);
}

function sendFinalMessageToParentProcess (cb) {
  let timeout;
  let waitingForResponseFromParent = true;

  function attemptToSendFinalMessage (attempt) {
    if (attempt >= 5) {
      waitingForResponseFromParent = false;
      // after 5 attempts to send final message without response quit anyway.
      cb('could not send final message or got no response from parent process');
      return;
    }

    process.send({final_message_sent:{}}, function (err) {
      if (err) {
        let msg;
        if (err.message) {
          msg = err.message;
        } else {
          msg = err;
        }
        logger.error(`could not send final message to parent process: ${msg}\n  trying again in one second...`);
      }
      timeout = setTimeout(attemptToSendFinalMessage, 1000, attempt+1);
    });
  }

  if (opt.sendMessagesToParentProcess) {
    if (!process.send) {
      cb('could not send message to parent process due to missing process.send');
      return;
    }

    /*
     * by sending two final messages (to the parent and back) we ensure
     * that all messages were received before exiting the deployer
     */
    process.on('message', function (message) {
      if (message.hasOwnProperty('final_message_received')) {
        if (waitingForResponseFromParent) {
          waitingForResponseFromParent = false;
          clearTimeout(timeout);
          cb();
        }
      }
    });

    attemptToSendFinalMessage(0);
  } else {
    cb();
  }
}

const tasks = [
  injectDefaultServices,
  initializeServices,
  initializeServerVersion,
  initializeContainerAPIVersion,
  initializeHDIVersion,
  handleShowInfoOptionAndExit,
  showVersionAndOtherInformation,
  setInternalOptionsBasedOnServerVersion,
  checkArgumentsAgainstFeatures,
  checkArgumentsForWorkingSet,
  processFilesAndDeploy,
  sendAllMessages,
  sendFinalMessageToParentProcess,
  checkDeployError
];

async.series(tasks, function (err) {
  logger.stop_sending_liveness_ping();
  logger.log(`Deployment ended at ${utils.currentDateTime()}`);
  if (err === exit_rc0_silent) {
    signalProcessExit(0, false, true);
  } else {
    if (err) {
      if (err.message) {
        logger.error(`Error: ${err.message}`);
      } else {
        logger.error(`Error: ${err}`);
      }
    }
    signalProcessExit(err ? 1 : 0, true);
  }
});
