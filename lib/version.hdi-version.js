'use strict';


const async = require('async');
const hana_helper = require('./hana-helper.js');
const connections = require('./connections');

/**
 * Class to handle the HDI version.
 *
 */
class HDI_Version {
  /**
   * Creates an instance of HDI_Version.
   *
   * @memberOf HDI_Version
   */
  constructor () {
    this._version = -1;
  }
  /**
   * Is the given version greater or equal to this version.
   *
   * @param {any} version version to check
   * @returns {Boolean} True if greater than or equal
   */
  isGreaterThanOrEqualTo (version) {
    return this.version >= version;
  }

  set version (value) {
    this._version = parseInt(value);
  }

  get version () {
    return this._version;
  }
}

/**
 * Get the fallback version -> Empty container API version object
 *
 * @returns {HDI_Version}
 */
function getFallbackVersion () {
  return new HDI_Version();
}

/**
 * Connect to the db and get the container API version.
 *
 * @param {any} credentials Credentials
 * @param {any} cb Callback
 */
function getVersion (credentials, cb) {
  const client = hana_helper(
    credentials.host,
    credentials.port,
    credentials.hdi_user,
    credentials.hdi_password,
    credentials.certificate,
    credentials.db_hosts,
    credentials.hostname_in_certificate,
    credentials.validate_certificate,
    credentials.encrypt,
    credentials.client_authentication_private_key,
    credentials.client_authentication_certificate
  );
  connections.push({client, file: __filename});

  const tasks = [
    client.connect(),
    client.execute("SELECT FEATURE_VERSION FROM SYS.M_FEATURES WHERE COMPONENT_NAME='DI' AND FEATURE_NAME='VERSION'")
  ];

  async.series(tasks, function (err, result) {
    client.end();
    const version = getFallbackVersion();

    if (!err && result.length > 1 && result[1].length > 0 && result[1][0].FEATURE_VERSION) {
      version.version = result[1][0].FEATURE_VERSION;
    } else if (!err) {
      version.error = 'The server does not support HDI version detection.';
    } else {
      version.error = err.message;
    }

    cb(null, version);
  });
}

module.exports = {
  getFallbackVersion: getFallbackVersion,
  getVersion: getVersion
};
