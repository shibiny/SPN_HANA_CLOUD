'use strict';

const logger = require('./logger.js');
const utils = require('./utils');
const fs = require('./fileWorker');
const { SchemaPrivilege } = require('@sap/hdi');
const micromatch = require('micromatch');

/**
 * Filter out client only files in the deploy set and/or transform them accordingly.
 *
 * @param {Array} files List of files to deploy.
 * @returns {Array} The filtered files.
 */
function handle_client_files (files) {
  // Filter out grantor files and turn into a set to allow blindly adding config files without risking duplicates.
  const cleaned = new Set();
  files.forEach((file) => {
    if (!utils.isDeployableFile(file)) {
      // Do nothing.
      logger.log('Filtered undeployable file', file);
    } else if (utils.isSynonymTemplateFile(file)) {
      // Ensure that for each template file the corresponding config will be deployed.
      cleaned.add(utils.rename_synonymtemplate_to_config(file));
      logger.log('Filtered .hdbsynonymtempate file', file);
    } else {
      cleaned.add(file);
    }
  });

  return Array.from(cleaned);
}

/**
 * Filter undeploy with undeploy.json.
 *
 * @param {Array} undeployFiles Files scheduled for undeploy
 * @param {Object} options Options
 * @returns {Array} Undeploy files.
 */
function filterUndeploy (undeployFiles, options) {
  const filename = options.undeployFilename;
  let paths = [];

  if (fs.existsSync(filename)) {
    logger.log('Undeploy allowlist file "undeploy.json" found; deleted files will be filtered by the allowlist');
    try {
      paths = fs.readJSONFile(filename);
    } catch (e) {
      logger.error(`Could not read the "undeploy.json": ${e.message ? e.message : e}`);
      logger.error('Proceeding with an empty allowlist and no files will be scheduled for undeploy.');
      return [];
    }
    return micromatch(undeployFiles, paths, { dot: true});

  } else {
    logger.log('Undeploy allowlist file "undeploy.json" not found; an empty allowlist is used and no files will be scheduled for undeploy');
    return [];
  }
}


/**
 * Prepare the make.
 *
 * @param {any} result Result of a status call.
 * @param {Object} options Options
 * @param {Content} content Content object
 * @returns {Object} Deploy and Undeploy files.
 */
function prepareMake (result, options, content) {
  let deployFiles;
  let undeployFiles;
  const addedFiles = [];
  const modifiedFiles = [];
  let unmodifiedFiles;

  deployFiles = result.filter(function (item) {
    if (item.status === 'A' && !options.excludeFilter.matchesPath(item.path)) {
      addedFiles.push(item.path);
      return true;
    } else if (item.status === 'M' && !options.excludeFilter.matchesPath(item.path)) {
      modifiedFiles.push(item.path);
      return true;
    }
  }).map(function (item) {
    return item.path;
  });


  if (options.treatUnmodifiedAsModified) {
    // schedule all locally collected files for deploy; this maps to Added, Modified, or Unmodified
    deployFiles = content.deployFiles.map(function (item) {
      return item[0];
    })
      .filter((item) => !options.excludeFilter.matchesPath(item));

    unmodifiedFiles = deployFiles.filter(function (item) {
      return (modifiedFiles.indexOf(item) === -1) && (addedFiles.indexOf(item) === -1);
    });

  }
  undeployFiles = result.filter(function (item) {
    return item.status === 'D';
  })
    .map(function (item) {
      return item.path;
    })
    .filter((item) => !options.excludeFilter.matchesPath(item));

  logger.trace('status result:', result);
  logger.log('added files:', addedFiles);
  logger.log('modified files:', modifiedFiles);
  if (options.treatUnmodifiedAsModified) {

    logger.log('treated as modified files:', unmodifiedFiles);
  }

  // filter the undeploy set based on the undeploy.json file
  if (undeployFiles.length && !options.autoUndeploy) {
    undeployFiles = filterUndeploy(undeployFiles, options);
  }
  logger.log('deleted files:', undeployFiles);

  // filter the undeploy set by the include-filter,EW because deleted files are not considered during the file walk
  if (options.includeFilter.valid) {
    undeployFiles = undeployFiles.filter(function (file) {
      return options.includeFilter.matchesPath(file);
    });
  }

  // filter current deployFiles and undeployFiltes via the working set
  if (options.workingSet.valid) {
    deployFiles = deployFiles.filter(function (file) {
      return options.workingSet.matchesPath(file);
    });

    undeployFiles = undeployFiles.filter(function (file) {
      return options.workingSet.matchesPath(file);
    });
  }

  if (options.treatUnmodifiedAsModified) {
    logger.log(`${deployFiles.length} modified, unmodified, or added files are scheduled for deploy`);
  } else {
    logger.log(`${deployFiles.length} modified or added files are scheduled for deploy based on delta detection`);
  }
  logger.log(`${undeployFiles.length} deleted files are scheduled for undeploy based on delta detection (filtered by undeploy allowlist)`);

  const explicit_deploy_files = new Set();
  let options_deploy_count = 0;

  /*
   * add explicit deploy set, but filter it via the working set
   * Since deploy files will be filtered in "Handle client files", already substract files we know will be removed.
   */
  options.deploy.forEachFile(function (p) {
    if (options.workingSet.matchesPath(p)) {
      explicit_deploy_files.add(p);
      if (utils.isGrantorFile(p)) {
        options_deploy_count--;
      }
    }
  });

  // add files defined by file pattern
  if (options.deploy) {
    options.deploy.filter_by_regex(content.deployFiles.map((item) => item[0])).forEach((file) => explicit_deploy_files.add(file));
  }

  explicit_deploy_files.forEach((file) => {
    if (!options.excludeFilter.matchesPath(file)) {
      deployFiles.push(file);
      options_deploy_count++;
    }
  });

  const explicit_undeploy_files = new Set();
  // add explicit undeploy set, but filter it via the working set
  options.undeploy.forEachFile(function (p) {
    if (options.workingSet.matchesPath(p)) {
      explicit_undeploy_files.add(p);
    }
  });

  let options_undeploy_count = 0;

  explicit_undeploy_files.forEach((file) => {
    if (!options.excludeFilter.matchesPath(file)) {
      undeployFiles.push(file);
      options_undeploy_count++;
    }
  });


  deployFiles = handle_client_files(deployFiles);
  // undeployFiles = handle_client_files(undeployFiles);

  logger.log(`${options_deploy_count} files are scheduled for deploy based on explicit specification`);
  logger.log(`${options_undeploy_count} files are scheduled for undeploy based on explicit specification`);

  return {
    deployFiles,
    undeployFiles
  };
}

function getDefaultPermissionSet (containerAccessRoleName, options) {
  const permissions =   [
    ['CREATE TEMPORARY TABLE', '', containerAccessRoleName],
    ['DELETE', '', containerAccessRoleName],
    ['EXECUTE', '', containerAccessRoleName],
    ['INSERT', '', containerAccessRoleName],
    ['SELECT', '', containerAccessRoleName],
  ];

  if (!options.isHanaCloud) {
    permissions.push(['SELECT CDS METADATA', '', containerAccessRoleName]);
  }
  permissions.push(['UPDATE', '', containerAccessRoleName]);

  return permissions.map((permission) => new SchemaPrivilege(permission[0], permission[1], permission[2]));
}

module.exports = {prepareMake, getDefaultPermissionSet};
