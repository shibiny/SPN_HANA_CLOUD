'use strict';

/* jslint indent: 4, esversion: 6 */

const fs = require('./fileWorker');
const util = require('util');
const Transform = require('stream').Transform;

const fileWalker = require('./fileWalker.js');
const logger = require('./logger.js');
const template = require('./template.js');
const utils = require('./utils.js');

const paths = require('./paths.js');

const dummyBuffer = Buffer.alloc(0);

const isGrantorFile = utils.isGrantorFile;
const isDeployableFile = utils.isDeployableFile;
const isRevokerFile = utils.isRevokerFile;

/**
 * remove '\r' from files
 *
 * @param {any} options Options for Dos2Unix
 * @returns {Dos2Unix} Instance of Dos2Unix
 */
function Dos2Unix (options) {
  if (!(this instanceof Dos2Unix)) {
    return new Dos2Unix(options);
  }
  Transform.call(this, options);
}

util.inherits(Dos2Unix, Transform);

Dos2Unix.prototype._transform = function (chunk, encoding, done) {
  let p = 0;

  // debug.log(chunk);
  for (let i = 0; i < chunk.length; i = i + 1) {
    if (chunk[i] === 13) { // '\r'
      this.push(chunk.slice(p, i));
      p = i + 1;
    }
  }
  if (p < chunk.length) {
    this.push(chunk.slice(p, chunk.length));
  }
  done();
};

/**
 * add a trailing '/' to the path
 *
 * @param {String} dir directory.
 * @returns {String} dir with / added.
 */
function deployDirPath (dir) {
  if (dir[dir.length - 1] === '/') {
    return dir;
  }

  return `${dir}/`;
}

/**
 * modify the path for certain files
 *
 * @param {String} file Filename
 * @returns {String} Modified path.
 */
function deployFilePath (file) {
  /*
   * we keep configured config-templates files where there are, although we have modified them
   * this way, we don't have to re-map errors messages, path filters, etc.
   */

  // rename old .hdbsynonymtemplate to .hdbsynonymconfig
  if (paths.extname(file) === '.hdbsynonymtemplate') {
    file = utils.rename_synonymtemplate_to_config(file);
  }

  return file;
}

/**
 * Check if the given file is a template file.
 *
 * @param {String} file Filename
 * @returns {Boolean} True or False.
 */
function isTemplateFile (file) {
  const fileExtension = paths.extname(file);

  if (fileExtension === '.hdbsynonymtemplate') {
    // it's an old-style synonym template file
    return true;
  }

  if (fileExtension.indexOf('config') === fileExtension.length - 6 && paths.isInCfgDirectory(file)) {
    // it's a new new-style config template file in cfg/
    return true;
  }

  return false;
}

/**
 * Get a ReadStream to the given file.
 *
 * @param {String} file Filename
 * @param {any} services Services
 * @param {Boolean} stripCRFromCSV True or false
 * @returns {ReadStream|Dos2Unix} The ReadStream
 */
function deployFileContent (file, services, stripCRFromCSV) {
  let dos2unix;

  const p = paths.clientPath(file);

  const fileExtension = paths.extname(file);

  if (stripCRFromCSV) {
    // replace dos /r/n with unix /n (for csv files)
    if (fileExtension.toLowerCase() === '.csv') {
      dos2unix = new Dos2Unix();
      fs.createReadStream(p).pipe(dos2unix);
      return dos2unix;
    }
  }

  // process templates
  if (isTemplateFile(file)) {
    const result = template.convertTemplate(fs.readJSONFile(p), services);
    if (result.converted) {
      return Buffer.from(JSON.stringify(result.content));
    }
  }

  return fs.createReadStream(p);
}

/**
 * check and collect a single module
 *
 * @param {any} modulePath Path of the module
 * @param {any} scopePath Path of the scope
 * @param {SingleReusableModuleCallback} callbackfn Function taking two arguments, the module path and the scope path.
 * @returns {undefined}
 */
function collectSingleReusableModule (modulePath, scopePath, callbackfn) {
  // modulePath already has a trailing /
  const node_modules = 'node_modules/';
  if (fs.existsSync(paths.clientPath(`${modulePath}src/.hdiconfig`))) {
    if (fs.existsSync(paths.clientPath(modulePath + node_modules))) {
      throw new Error(`Nested node_modules found at ${modulePath}`);
    }
    callbackfn(modulePath, scopePath);
  }
}

/**
 * Callback that takes two arguments, the module path and the scope path.
 * @callback SingleReusableModuleCallback
 * @param {String} modulePath The module path.
 * @param {String} scopePath The scope path.
 */

/**
 * find node_modules/<module> folders, where node_modules/<module>/src contains a .hdiconfig file
 *
 * @param {SingleReusableModuleCallback} callbackfn Function taking two arguments, the module path and the scope path.
 * @returns {Array} root paths.
 */
function collectReusableModules (callbackfn) {
  const rootPaths = [];
  const node_modules = 'node_modules/';
  if (fs.existsSync(paths.clientPath(node_modules))) {
    const moduleDirs = fs.readdirSync(paths.clientPath(node_modules));

    moduleDirs.forEach(function (dir) {
      if (dir.startsWith('@')) {
        // this is a scoped module folder at node_modules/@<scope>/; collect scoped modules
        const scopePath = `${node_modules + dir}/`;
        const scopedModuleDirs = fs.readdirSync(paths.clientPath(scopePath));
        scopedModuleDirs.forEach(function (scopedModuleDir) {
          // this is a scoped module at node_modules/@<scope>/<module>/
          const modulePath = `${scopePath + scopedModuleDir}/`;
          collectSingleReusableModule(modulePath, scopePath, callbackfn);
        });
      } else {
        // this is a non-scoped module at node_modules/<module>/
        const modulePath = `${node_modules + dir}/`;
        collectSingleReusableModule(modulePath, null, callbackfn);
      }
    });
  }
  return rootPaths;
}

/**
 * Handle collecting of files to deploy etc.
 *
 * @class Content
 */
class Content {
  /**
   * Creates an instance of Content.
   * @param {String} root ROOT for the deployer.
   * @param {Array} services Services
   * @param {PathFilter} workingSet WorkingSet filter
   * @param {Array} deployDirs The directories to check for the deployment
   * @param {PathFilter} pathFilter PathFilter
   * @param {Boolean} stripCRFromCSV Wether to strip CR or not
   * @param {PathFilter} excludeFilter The exclude filter
   *
   * @memberOf Content
   */
  constructor (root, services, workingSet, deployDirs, pathFilter, stripCRFromCSV, excludeFilter) {
    const dirs = [];
    const files = [];

    const defaultAccessRoleFile = 'src/defaults/default_access_role.hdbrole';
    const developmentDebugRoleFile = 'src/defaults/development_debug_role.hdbrole';

    // file walker functions
    /**
     * Function for the fileWalker - action when entering directory.
     *
     * @returns {Boolean} true
     */
    function enterDir (/* level, dir */) {
      return true;
    }

    /**
     * Function for the fileWalker - action when leaving directory.
     *
     * @param {Number} level Depth
     * @param {String} dir Directory
     * @param {Boolean} found Found files (TODO)
     * @returns {undefined}
     */
    function leaveDir (level, dir, found) {
      if (found) {
        dir = paths.serverPath(dir);
        dirs.push(dir);
      }
    }

    /**
     * Function for the fileWalker - action when adding a file.
     *
     * @param {Number} level Depth
     * @param {String} dir Directory
     * @param {String} file File
     * @returns {Boolean} True or false.
     */
    function addFile (level, dir, file) {
    // skip .gitignore files
      if (paths.basename(file) === '.gitignore') {
        return false;
      }

      file = paths.serverPath(file);

      /*
       * apply the filter for paths
       * we apply the path filter in the file walk to ensure that it also affects files which are handled by the deployer application itself, e.g. template files
       * we also apply the exclude filter, to ensure that ignored files don't get picked up.
       */
      if (!pathFilter.matchesPath(file) || excludeFilter.matchesPath(file)) {
      // directory is not in the filter, or file itself is not in the filter; skip the file
        return false;
      }

      // file needs to be added
      if (file.endsWith('.hdbsynonymtemplate')) {
        logger.warn(`File ${file} is using old-style .hdbsynonymtemplate. Please switch to .hdbsynonymconfig`);
      } else if (file.endsWith('.hdbsynonymgrantor')) {
        logger.warn(`File ${file} is using old-style .hdbsynonymgrantor. Please switch to .hdbgrants`);
      }
      files.push(file);
      return true;
    }

    logger.logTimerInit('collect-files', 'Collecting files...');

    // the collect directories are our deploy directories plus the src/ + cfg/ directories of modules
    const collectDirs = deployDirs;

    let reuseModulesCount = 0;
    collectReusableModules(function (modulePath, scopePath) {
      modulePath = paths.serverPath(modulePath);
      // directories in collectDirs will be pushed to dirs automatically
      collectDirs.push(`${modulePath}src/`);
      collectDirs.push(`${modulePath}cfg/`);
      // but, we need to push the root path of the module manually
      dirs.push(modulePath);
      // and, we also need to push the scope's path manually, if it's defined
      if (scopePath) {
        scopePath = paths.serverPath(scopePath);
        if (dirs.indexOf(scopePath) === -1) {
          dirs.push(scopePath);
        }
      }
      reuseModulesCount++;
    });
    if (reuseModulesCount) {
    // also push the lib/
      dirs.push(paths.serverPath('lib/'));
    }

    // check if .hdiconfig exists in cfg
    if (workingSet.matchesPath('src/.hdiconfig') && workingSet.matchesPath('cfg/.hdiconfig')) {
      if (fs.existsSync('cfg') && fs.statSync('cfg').isDirectory() && !fs.existsSync('cfg/.hdiconfig') && fs.existsSync('src/.hdiconfig')) {
        fs.copyFileSync('src/.hdiconfig', 'cfg/.hdiconfig');
        logger.log('No .hdiconfig found in cfg/, using the one in src.');
      }
    }

    // collect now
    fileWalker.walk(root, collectDirs, enterDir, leaveDir, addFile);

    this.root = root;
    /*
     * the directories to consider on the server-side are always our given deployDirs
     * no matter which directories we've found locally, e.g. a cfg/ might not exist locally, but on the server
     * with reusable modules, we also need 'lib/' here
     */

    /*
     * The try catch blocks are only to simulate the previous behavior.
     * Since before the rework these properties were functions, they only threw the exception when called, not on object creation.
     */
    try {
      this._serverTopDirs = [].concat(deployDirs.map((dir) => [deployDirPath(dir)]), [['lib/']]);
    } catch (e) {
      this._serverTopDirs = e;
    }

    try {
      this._deployFiles = files.filter(isDeployableFile).map((file) => [deployFilePath(file)]);
    } catch (e) {
      this._deployFiles = e;
    }

    try {
      this._deployContent = [].concat(dirs.map((dir) => [deployDirPath(dir), dummyBuffer]), files.filter(isDeployableFile).map((file) => [deployFilePath(file), deployFileContent(file, services, stripCRFromCSV)]));
    } catch (e) {
      this._deployContent = e;
    }

    try {
      this.synonymGrantorFiles = files.filter((file) => {
        if (!isGrantorFile(file)) {
          return false;
        }
        if (!workingSet.matchesPath(file)) {
          return false;
        }
        return true;
      });
    } catch (e) {
      this.synonymGrantorFiles = e;
    }

    try {
      this.synonymRevokerFiles = files.filter((file) => {
        if (!isRevokerFile(file)) {
          return false;
        }
        if (!workingSet.matchesPath(file)) {
          return false;
        }
        return true;
      });
    } catch (e) {
      this.synonymRevokerFiles = e;
    }

    this.containsDefaultAccessRoleFile = function () {
      if (!workingSet.matchesPath(defaultAccessRoleFile)) {
        return false;
      }
      if (!pathFilter.matchesPath(defaultAccessRoleFile)) {
        return false;
      }
      if (!fs.existsSync(defaultAccessRoleFile)) {
        return false;
      }
      return true;
    };

    this.containsDevelopmentDebugRoleFile = function () {
      if (!workingSet.matchesPath(developmentDebugRoleFile)) {
        return false;
      }
      if (!pathFilter.matchesPath(developmentDebugRoleFile)) {
        return false;
      }
      if (!fs.existsSync(developmentDebugRoleFile)) {
        return false;
      }
      return true;
    };

    this.checkDevelopmentDebugRoleFile = function () {
      const roleJSON = fs.readJSONFile(developmentDebugRoleFile);

      if (!roleJSON.hasOwnProperty('role')) {
        return `Invalid development-debug-role file "${developmentDebugRoleFile}": key "role" not found`;
      }

      if (!roleJSON.role.hasOwnProperty('name')) {
        return `Invalid development-debug-role file "${developmentDebugRoleFile}": key "name" in object "role" not found`;
      }

      const name = roleJSON.role.name;
      if (name !== 'development_debug_role') {
        return `Invalid development-debug-role file "${developmentDebugRoleFile}": file does not define the "development_debug_role" role`;
      }

      return undefined;
    };

    this.checkDefaultAccessRoleFile = function () {
      const roleJSON = fs.readJSONFile(defaultAccessRoleFile);

      if (!roleJSON.hasOwnProperty('role')) {
        return `Invalid default-access-role file "${defaultAccessRoleFile}": key "role" not found`;
      }

      if (!roleJSON.role.hasOwnProperty('name')) {
        return `Invalid default-access-role file "${defaultAccessRoleFile}": key "name" in object "role" not found`;
      }

      const name = roleJSON.role.name;
      if (name !== 'default_access_role') {
        return `Invalid default-access-role file "${defaultAccessRoleFile}": file does not define the "default_access_role" role`;
      }

      return undefined;
    };

    logger.logTimerDelta('collect-files', 'Collecting files... ok');

    logger.log(`${dirs.length} directories collected`);
    logger.log(`${files.length} files collected`);
    logger.log(`${reuseModulesCount} reusable modules collected`);
  }

  get serverTopDirs () {
    if (this._serverTopDirs instanceof Error) {
      throw this._serverTopDirs;
    }
    return this._serverTopDirs;
  }

  get deployFiles () {
    if (this._deployFiles instanceof Error) {
      throw this._deployFiles;
    }
    return this._deployFiles;
  }

  get deployContent () {
    if (this._deployContent instanceof Error) {
      throw this._deployContent;
    }
    return this._deployContent;
  }

  get synonymGrantorFiles () {
    if (this._synonymGrantorFiles instanceof Error) {
      throw this._synonymGrantorFiles;
    }
    return this._synonymGrantorFiles;
  }

  set serverTopDirs (value) {
    this._serverTopDirs = value;
  }

  set deployFiles (value) {
    this._deployFiles = value;
  }

  set deployContent (value) {
    this._deployContent = value;
  }

  set synonymGrantorFiles (value) {
    this._synonymGrantorFiles = value;
  }
}

module.exports = Content;
