'use strict';


const async = require('async');

const Content = require('./content.js');
const hdi = require('./hdi.js');
const logger = require('./logger.js');
const privileges = require('./privileges/privileges.js');
const PathFilter = require('./filters/PathFilter');
const IgnoreFile = require('./IgnoreFile');
const status = require('./status');
const client_info = require('./client-info');
const check_ownership = require('./ownership_checker');

const fs = require('./fileWorker');

/**
 * Run a deployment, first grants privileges, then runs the actual deployment.
 *
 * @param {any} options Options for the deployment.
 * @param {ServiceAccessor} services Services for the deployment.
 * @param {function} cb Nodeback
 * @returns {(undefined | function)} Either undefined or function, if we exit early.
 */
module.exports = function (options, services, cb) {
  // Make sure that root is set for our fs wrapper.
  fs.set_root(options.root);

  const contentPathsFilter = new PathFilter();
  if (options.includeFilter.valid) {
    /*
     * an include-filter is given, merge the include-filter and the deploy options to ensure that we upload all files which are included in the deploy option;
     * if no include-filter is given, we don't need to care about the deploy option during the file walk
     */
    contentPathsFilter.addPaths(options.includeFilter);
    contentPathsFilter.addPaths(options.deploy);
  }
  /*
   * Make sure that the filter is valid.
   * Since the excludeFilter works "reverse", we need to make sure that it's always valid.
   * An invalid filter would match everything.
   */
  options.excludeFilter.valid = true;

  const ignore_file = new IgnoreFile(options.root);
  options.excludeFilter.addPaths(ignore_file.getPaths());

  const cnt = new Content(options.root, services, options.workingSet, options.deployDirs, contentPathsFilter, options.stripCRFromCSV, options.excludeFilter);

  const tasks = [];

  try {
    const target_service = services.getTarget();
    logger.log('Target service:', target_service.name);
  } catch (e) {
    // Ignore errors.
  }

  logger.trace('top directories: ', cnt.serverTopDirs);

  logger.trace('deploy files: ', cnt.deployFiles);

  const targetCreds = services.getTargetCreds();
  logger.trace('target credentials:', targetCreds);

  const container = `${targetCreds.schema}#OO`;
  const containerRole = `${targetCreds.schema}::access_role`;

  // if we have a default_access_role file in the processing set, check its content
  if (cnt.containsDefaultAccessRoleFile()) {
    const checkDefaultAccessRoleFileResult = cnt.checkDefaultAccessRoleFile();
    if (checkDefaultAccessRoleFileResult !== undefined) {
      return cb(checkDefaultAccessRoleFileResult);
    }
  }

  // if we have a development_debug_role file in the processing set, check its content
  if (cnt.containsDevelopmentDebugRoleFile()) {
    const checkDevelopmentDebugRoleFileResult = cnt.checkDevelopmentDebugRoleFile();
    if (checkDevelopmentDebugRoleFileResult !== undefined) {
      return cb(checkDevelopmentDebugRoleFileResult);
    }
  }

  tasks.push(function (callback) {
    client_info.print_client_info(options, targetCreds, callback);
  });

  tasks.push(function (callback) {
    status.get(options, targetCreds, callback);
  });

  tasks.push(function (callback) {
    privileges.revoke(options, services, cnt, container, containerRole, callback);
  });

  tasks.push(function (callback) {
    privileges.grant(options, services, cnt, container, containerRole, callback);
  });

  if (options.treatWrongOwnershipAsErrors) {
    tasks.push(function (callback) {
      check_ownership(options, targetCreds, callback);
    });
  }

  tasks.push(function (callback) {
    hdi.deploy(options, targetCreds, cnt, callback);
  });

  async.series(tasks, cb);
};
