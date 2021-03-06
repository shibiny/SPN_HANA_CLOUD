'use strict';

const async = require('async');
const hana_helper = require('./hana-helper.js');
const {prepareMake, getDefaultPermissionSet} = require('./hdi_utils.js');
const {callbackTimeout} = require('./utils');
const Make_Task = require('./make');
const connections = require('./connections');

function hdi_callback (logger, callback, calltype='HDI') {
  return function (error, result) {
    if (error) {
      logger.error(error);
      return callback(error);
    } else if (result && result.rc && result.rc === -1) {
      const e = new Error(`${calltype} call failed!`);
      e.result = result;
      logger.error(e);
      return callback(e, result);
    } else {
      return callback(null, result);
    }
  };
}

const messages_hdi = require('./messages.hdi.js');
const {
  SchemaRole,
  File,
  FileWithContent,
  Folder,
  FolderWithContent,
  Parameter,
  PathParameter
} = require('@sap/hdi');

// Object.entries polyfill.
if (!Object.entries) {
  Object.entries = function (obj) {
    const ownProps = Object.keys(obj);

    let i = ownProps.length;

    const resArray = new Array(i); // preallocate the Array
    while (i--) {
      resArray[i] = [ownProps[i], obj[ownProps[i]]];
    }

    return resArray;
  };
}

const printMessages = hana_helper().printMessages;
/**
 * Log the messages.
 *
 * @param {any} messages The messages to log.
 * @param {any} logger Logging utility.
 * @returns {undefined} No return value.
 */
function logfn (messages, logger) {
  printMessages(logger, messages);
}

/**
 * Check result of the delete call.
 * @param {any} result The result of the delete call.
 * @param {logger} logger Logging utility.
 * @param {function} cb Callback
 * @returns {any} Calls the callback with the result or throws an error.
 */
function check (result, logger, cb) {
  if (result.rc >= 0) {
    // don't log anything
    return cb(null, result);
  }

  const messages = result.messages;
  const expectedErrors = [messages_hdi.DELETE_PATHS_FAILED.code, messages_hdi.FOLDER_NOT_FOUND.code];
  let foundErrorCodes = 0;

  for (let i = 0; i < expectedErrors.length; ++i) {
    for (let j = 0; j < messages.length; ++j) {
      if (messages[j].MESSAGE_CODE === expectedErrors[i]) {
        ++foundErrorCodes;
        break;
      }
    }
  }

  if (foundErrorCodes === expectedErrors.length) {
    /*
     * don't log anything.
     * Clear the messages to mimic behaviour of the old hdi api.
     */
    // result.messages = [];
    return cb(null, result);
  }
  logfn(result.messages, logger);
  return cb(new Error('HDI call failed'));
}

/**
 * Recursively delete the supplied directory from the container.
 *
 * @param {any} dir Directory to delete.
 * @param {Container} container The container object.
 * @param {Logger} logger Logging utility.
 * @returns {function} Async tasks.
 */
function deleteDir (dir, container, logger) {
  const folder = [new Folder(dir[0])];
  const params = [new Parameter('RECURSIVE', 'TRUE')];
  return function (callback) {
    container.delete(folder, params, (e, r) => {
      if (e) {
        return callback(e);
      } else {
        check(r, logger, callback);
      }
    });
  };
}

/**
 * A DeployTask wraps the whole deployment lifecycle in an object.
 * It
 * -connects to the container
 * -locks the container (optional)
 * -synchronizes files with the container
 * -prepares and stages files for deployment
 * -deploys the files
 * -disconnects
 *
 * For each step there is a method returning an array of functions to allow chaining via async.
 *
 * @class DeployTask
 */
class DeployTask {
  /**
   * Creates an instance of DeployTask.
   * @param {Container} container The container to deploy to.
   * @param {Object} hdiCreds credentials
   * @param {Object} content The deployment content.
   * @param {Object} options The options for the deploy task.
   * @param {Logger} logger Logging utility.
   * @param {String} schema The schema of the container
   *
   * @memberOf DeployTask
   */
  constructor (container, hdiCreds, content, options, logger, schema) {
    /** @member {Container} */
    this.container = container;
    this.content = content;
    this.logger = logger;
    this.schema = schema;
    this.options = options;
    this.serverTopDirs = content.serverTopDirs || [];
    this._deployFiles = null;
    this._undeployFiles = null;
    this.hdiCreds = hdiCreds;
    connections.push({client: this.container.connection, file: __filename });
  }

  /**
   * setter for deploy files.
   * @param {Array} value List of files to deploy.
   *
   * @memberOf DeployTask
   */
  set deployFiles (value) {
    this._deployFiles = value;
  }

  /**
   * Return the deployFiles, but only if present. Otherwise throw an error.
   *
   * @readonly
   *
   * @memberOf DeployTask
   */
  get deployFiles () {
    if (!this._deployFiles) {
      throw new Error('Deploy files have to be initialized by running the make task.');
    } else {
      return this._deployFiles;
    }
  }

  /**
   * setter for undeploy files.
   * @param {Array} value List of files to undeploy.
   *
   * @memberOf DeployTask
   */
  set undeployFiles (value) {
    this._undeployFiles = value;
  }

  /**
   * Return the undeployFiles, but only if present. Otherwise throw an error.
   *
   * @readonly
   *
   * @memberOf DeployTask
   */
  get undeployFiles () {
    if (!this._undeployFiles) {
      throw new Error('Undeploy files have to be initialized by running the make task.');
    } else {
      return this._undeployFiles;
    }
  }

  /**
   * Connect to the container. Also, attaches a onTrace handler to the HANA connection if tracing is enabled.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   *
   * @memberOf DeployTask
   */
  connect () {
    const tasks = [];
    const logger = this.logger;
    tasks.push(this.logger.logfnTimerInit('connect-container', 'Connecting to the container "%s"...', this.schema));
    tasks.push((cb) => this.container.connect(cb));
    if (logger.getHanaClientTrace()) {
      const traceCB = function (buf) {
        logger.log(buf.toString());
      };
      const traceOptions = logger.getHanaClientPacketTrace() ?
        'DEBUG,SQL,PACKET=32K,FLUSH,OutBufferSize=128K' :
        'DEBUG,SQL,PACKET=OFF,FLUSH,OutBufferSize=64K';
      logger.log(`DeployTask SAP HANA client trace options: ${traceOptions}`);
      this.container.connection.onTrace(traceOptions, traceCB);
    }
    if (this.options.live_messages) {
      tasks.push((cb) => this.container.connection.exec('SELECT CURRENT_CONNECTION FROM SYS.DUMMY;', (e, r) => {
        if (e) {
          return cb(e);
        } else {
          try {
            this.connection_id = parseInt(r[0].CURRENT_CONNECTION);
            return cb();
          } catch (e) {
            this.logger.warn(`Could not get the connection ID. Root cause:${e.message ? e.message : e}`);
            this.logger.warn('Live-polling of make messages will not be possible!');
            return cb();
          }
        }
      }));
    }
    tasks.push(this.logger.logfnTimerDelta('connect-container', 'Connecting to the container "%s"... ok', this.schema));

    return tasks;
  }

  /**
   * Lock the container.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   *
   * @memberOf DeployTask
   */
  lock () {
    if (this.options.lockContainer) {
      // Ensure that we also close the lock connection at the end.
      connections.push({
        client: {
          disconnect: () => this.container.unlock(() => {})
        },
        file: __filename
      });
      const tasks = [];
      const {lockContainerTimeout} = this.options;
      tasks.push(this.logger.logfnTimerInit('locking-container', 'Locking the container "%s"...', this.schema));
      tasks.push((callback) => this.container.lock(lockContainerTimeout, [], (e, result) => {
        if (e && (e.code === 258 || e.code === 328)) {
          this.logger.warn(`Locking is not supported by the container or the container cannot be locked due to missing privileges; locking is skipped. (database error ${e.code})`);
          return callback(null, result);
        } else {
          // Not the nicest, but...
          return hdi_callback(this.logger, callback)(e, result);
        }
      }));
      tasks.push(this.logger.logfnTimerDelta('locking-container', 'Locking the container "%s"... ok', this.schema));
      return tasks;
    } else {
      return [];
    }
  }

  /**
   * Unlock the container.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   *
   * @memberOf DeployTask
   */
  unlock () {
    if (this.options.lockContainer) {
      const tasks = [];
      tasks.push(this.logger.logfnTimerInit('unlocking-container', 'Unlocking the container "%s"...', this.schema));
      tasks.push((callback) => this.container.unlock(hdi_callback(this.logger, callback)));
      tasks.push(this.logger.logfnTimerDelta('unlocking-container', 'Unlocking the container "%s"... ok', this.schema));
      return tasks;
    } else {
      return [];
    }
  }

  /**
   * Turn the files/folders into "real" HDI API files/folders.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   *
   * @memberOf DeployTask
   */
  preprocessing () {
    return [
      (cb) => {
        this.logger.trace(this.serverTopDirs);

        this.logger.logTimerInit('preprocessing-files', 'Preprocessing files...');
        /**
         * Check if a path ends with a slash to determine if it's a path to a file.
         *
         * @param {any} path The path to check.
         * @returns {boolean} True if it doesn't end with a slash.
         */
        const isFile = function (path) {
          return !path.endsWith('/');
        };

        try {
          this.deployContent = this.content.deployContent.map((fileOrFolder) => {
            if (isFile(fileOrFolder[0])) {
              return new FileWithContent(fileOrFolder[0], fileOrFolder[1]);
            } else {
              return new FolderWithContent(fileOrFolder[0], fileOrFolder[1]);
            }
          });
        } catch (e) {
          cb(e);
          return;
        }

        this.logger.logTimerDelta('preprocessing-files', 'Preprocessing files... ok');
        cb();
      }
    ];
  }

  /**
   * Synchronize files with the container.
   * Deletes folders from the container file system. Basically a preparation to then add files by running make + deploy.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   * @memberOf DeployTask
   */
  synchronize () {
    const tasks = [];
    const {singleDeleteCallsForDirectories} = this.options;

    tasks.push(this.logger.logfnTimerInit('synchronizing-files', 'Synchronizing files with the container "%s"...', this.schema));
    tasks.push(this.logger.logfnTimerInit('deleting-files', '  Deleting files...'));
    if (singleDeleteCallsForDirectories) {
      const subtasks = [];
      this.serverTopDirs.forEach((dir) => {
        subtasks.push(deleteDir(dir, this.container, this.logger));
      });

      tasks.push((callback) => callbackTimeout(
        (cb) => async.series(subtasks, cb),
        (e, r) => {
          if (e) {
            return callback(e);
          } else {
            return callback(null, r);
          }
        },
        this.options.deleteTimeout,
        'DELETE-timeout')
      );
    } else {
      const folders = this.serverTopDirs.map((a) => new Folder(a[0]));
      const parameters = [new Parameter('RECURSIVE', 'TRUE'), new Parameter('IGNORE_NON_EXISTING_PATHS', 'TRUE')];
      tasks.push((callback) => callbackTimeout(
        (cb) => this.container.delete(folders, parameters, cb),
        hdi_callback(this.logger, callback, 'DELETE'),
        this.options.deleteTimeout,
        'DELETE-timeout')
      );
    }
    tasks.push(this.logger.logfnTimerInit('deleting-files', '  Deleting files... ok'));

    tasks.push(this.logger.logfnTimerInit('writing-files', '  Writing files...'));
    tasks.push((callback) => callbackTimeout((cb) =>
      this.container.write(this.deployContent, null, cb),
    hdi_callback(this.logger, callback, 'WRITE'),
    this.options.writeTimeout,
    'WRITE-timeout')
    );
    tasks.push(this.logger.logfnTimerInit('writing-files', '  Writing files... ok'));

    tasks.push(this.logger.logfnTimerDelta('synchronizing-files', 'Synchronizing files with the container "%s"... ok', this.schema));

    return tasks;
  }

  /**
   * Prepare files for (un)deployment and stage them.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   * @memberOf DeployTask
   */
  make () {
    const tasks = [];

    // copy parameters from options
    const deployParameters = Object.entries(this.options.parameters).map(([k, v]) => new Parameter(k.toUpperCase(), v));

    /**
     * Parse the given raw key value parameter.
     *
     * @param {any} raw_paramter_key Input key
     * @param {any} raw_parameter_value Input value
     * @returns {PathParameter} Parsed path parameter
     */
    const turn_into_path_paramter = (parameter) => {
      const [raw_key, raw_value] = parameter;
      const [path, key] = raw_key.split(':');
      if (!path) {
        this.logger.warn(`Skipping parameter ${raw_key}. Could not extract the path from the given path parameter.`);
        return '';
      } else if (!key) {
        this.logger.warn(`Skipping parameter ${raw_key}. Could not extract the key from the given path parameter.`);
        return '';
      }
      const value = raw_value;
      return new PathParameter(path, key, value);
    };
    // copy path-parameters from options
    const pathParameters = Object.entries(this.options.path_parameters).map(turn_into_path_paramter).filter(p => p !== '');

    // add explicit parameters
    if (this.options.treatWarningsAsErrors) {
      deployParameters.push(new Parameter('TREAT_WARNINGS_AS_ERRORS', 'TRUE'));
    }
    if (this.options.simulateMake) {
      deployParameters.push(new Parameter('SIMULATE_MAKE', 'TRUE'));
    }
    if (this.options.migrationTableDevMode) {
      deployParameters.push(new Parameter('com.sap.hana.di.table.migration/development_mode'.toUpperCase(), 'TRUE'));
    }
    if (this.options.validateExternalDependencies) {
      deployParameters.push(new Parameter('VALIDATE_EXTERNAL_DEPENDENCIES', 'TRUE'));
    }

    tasks.push(function (callback) {
      async.waterfall([
        (innerCB) => this.container.status(this.serverTopDirs.map((a) => new Folder(a[0])), null, hdi_callback(this.logger, innerCB, 'STATUS')),
        (result, innerCB) => {
          const {deployFiles, undeployFiles} = prepareMake(result.results, this.options, this.content);
          this._deployFiles = deployFiles.map((path) => new File(path));
          this._undeployFiles = undeployFiles.map((path) => new File(path));
          this.logger.logTimerInit('deploying-files', 'Deploying to the container "%s"...', this.schema);
          const make_task = new Make_Task(this.connection_id, this.container, this.hdiCreds, this.schema);
          make_task.make(this.deployFiles, this.undeployFiles, pathParameters, deployParameters, innerCB);
        },
        ({results, last_row_id}, innerCB) => {
          logfn(results.messages.filter(message => message.ROW_ID > last_row_id), this.logger);
          if (results.rc < 0) {
            return innerCB(new Error('HDI make failed'), results);
          } else {
            return innerCB(null, results);
          }
        }
      ], callback);
    }.bind(this));

    return tasks;
  }

  /**
   * (un)deploy the staged files.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   * @memberOf DeployTask
   */
  deploy () {
    const tasks = [];

    tasks.push(this.logger.logfnTimerDelta('deploying-files', 'Deploying to the container "%s"... ok', this.schema));
    /* eslint-disable no-extra-bind */

    /**
     * (Re)assign the default access role.
     *
     * @param {any} callback Callback to call after the deployment is done.
     * @returns {undefined}
     */
    const _deploy_dar = ((callback) => {
      const defaultAccessRoleFile = 'src/defaults/default_access_role.hdbrole';
      const defaultAccessRoleName = 'default_access_role';
      const containerAccessRoleName = `${this.schema}::access_role`;

      const defaultPermissionSet = getDefaultPermissionSet(containerAccessRoleName, this.options);

      /**
       * Checks if the supplied filename is in the array of file objects.
       *
       * @param {File[]} files Files to search through.
       * @param {String} file File to search for.
       * @returns {Boolean} True if the file is in files.
       */
      const isInFiles = (files, file) => files.map((fObj) => fObj.entries[0]).indexOf(file) !== -1;

      if (isInFiles(this.undeployFiles, defaultAccessRoleFile) && !isInFiles(this.deployFiles, defaultAccessRoleFile)) {
        if (this.options.simulateMake) {
          this.logger.log('Default-access-role file "src/defaults/default_access_role.hdbrole" undeployed, but simulate-make option was given; global role "%s" will not be adapted', containerAccessRoleName);
          return callback(null, 'simulate make');
        } else {
          async.series([
            this.logger.logfn('Default-access-role file "src/defaults/default_access_role.hdbrole" undeployed; global role "%s" will be adapted', containerAccessRoleName),
            this.logger.logfnTimerInit('regrant-default-permissions', 'Regranting default permission set to global role "%s"...', containerAccessRoleName),
            (cb) => {
              this.container.grantContainerSchemaPrivileges(defaultPermissionSet, [], hdi_callback(this.logger, cb));
            },
            this.logger.logfnTimerDelta('regrant-default-permissions', 'Regranting default permission set to global role "%s"... ok', containerAccessRoleName)
          ], callback);
        }
      } else if (this.content.containsDefaultAccessRoleFile()) {
        if (this.options.simulateMake) {
          this.logger.log('Default-access-role file "src/defaults/default_access_role.hdbrole" scheduled for deploy, but simulate-make option was given; global role "%s" will not be adapted', containerAccessRoleName);
          return callback(null, 'simulate make');
        } else {
          async.series([
            this.logger.logfn('Default-access-role file "src/defaults/default_access_role.hdbrole" scheduled for deploy; global role "%s" will be adapted', containerAccessRoleName),
            this.logger.logfnTimerInit('grant-default-role', 'Granting container-local default access role "%s"."%s" to global role "%s"...', this.schema, defaultAccessRoleName, containerAccessRoleName),
            (cb) => {
              const role = new SchemaRole(defaultAccessRoleName, '', containerAccessRoleName);
              this.container.grantContainerSchemaRoles([role], [], hdi_callback(this.logger, cb));
            },
            this.logger.logfnTimerDelta('grant-default-role', 'Granting container-local default access role "%s"."%s" to global role "%s"... ok', this.schema, defaultAccessRoleName, containerAccessRoleName),

            this.logger.logfnTimerInit('revoke-default-permissions', 'Revoking default permission set from global role "%s"...', containerAccessRoleName),
            (cb) => {
              this.container.revokeContainerSchemaPrivileges(defaultPermissionSet, [], hdi_callback(this.logger, cb));
            },
            this.logger.logfnTimerDelta('revoke-default-permissions', 'Revoking default permission set from global role "%s"... ok', containerAccessRoleName)
          ], callback);
        }
      } else {
        this.logger.log('No default-access-role handling needed; global role "%s" will not be adapted', containerAccessRoleName);
        return callback(null, undefined);
      }
    }).bind(this);
    /* eslint-enable no-extra-bind */

    /* eslint-disable no-extra-bind */

    /**
     * Assign the development debug role.
     *
     * @param {any} callback Callback to call after the deployment is done.
     * @returns {undefined}
     */
    const _deploy_ddr = ((callback) => {
      const developmentDebugRoleFile = 'src/defaults/development_debug_role.hdbrole';
      const developmentDebugRoleName = 'development_debug_role';
      const containerAccessRoleName = `${this.schema}::access_role`;

      /**
       * Checks if the supplied filename is in the array of file objects.
       *
       * @param {File[]} files Files to search through.
       * @param {String} file File to search for.
       * @returns {Boolean} True if the file is in files.
       */
      const isInFiles = (files, file) => files.map((fObj) => fObj.entries[0]).indexOf(file) !== -1;
      if (isInFiles(this.undeployFiles, developmentDebugRoleFile) && !isInFiles(this.deployFiles, developmentDebugRoleFile)) {
        if (this.options.simulateMake) {
          this.logger.log('Development-debug-role file "src/defaults/development_debug_role.hdbrole" undeployed, but simulate-make option was given; global role "%s" will not be adapted', containerAccessRoleName);
          return callback(null, 'simulate make');
        } else {
          this.logger.log('Development-debug-role file "src/defaults/development_debug_role.hdbrole" undeployed; global role "%s" will be adapted', containerAccessRoleName);
          return callback(null, undefined);
        }
      } else if (this.content.containsDevelopmentDebugRoleFile() && isInFiles(this.deployFiles, developmentDebugRoleFile) && this.options.deploy.valid && this.options.deploy.matchesPath(developmentDebugRoleFile)) {
        if (this.options.simulateMake) {
          this.logger.log('Development-debug-role file "src/defaults/development_debug_role.hdbrole" scheduled for deploy, but simulate-make option was given; global role "%s" will not be adapted', containerAccessRoleName);
          return callback(null, 'simulate make');
        } else {
          async.series([
            this.logger.logfn('Development-debug-role file "src/defaults/development_debug_role.hdbrole" scheduled for deploy; global role "%s" will be adapted', containerAccessRoleName),
            this.logger.logfnTimerInit('grant-debug-role', 'Granting container-local development debug role "%s"."%s" to global role "%s"...', this.schema, developmentDebugRoleName, containerAccessRoleName),
            (cb) => this.container.grantContainerSchemaRoles([new SchemaRole(developmentDebugRoleName, '', containerAccessRoleName)], [], hdi_callback(this.logger, cb)),
            this.logger.logfnTimerDelta('grant-debug-role', 'Granting container-local development debug role "%s"."%s" to global role "%s"... ok', this.schema, developmentDebugRoleName, containerAccessRoleName)
          ], callback);
        }
      } else {
        return callback(null, undefined);
      }
    }).bind(this);
    /* eslint-enable no-extra-bind */

    tasks.push(_deploy_dar);
    tasks.push(_deploy_ddr);

    return tasks;
  }

  /**
   * Disconnect from the container.
   *
   * @returns {Function[]} Returns an array of functions for chaining via async.
   * @memberOf DeployTask
   */
  disconnect () {
    return this.container.disconnect();
  }
}

module.exports = DeployTask;
