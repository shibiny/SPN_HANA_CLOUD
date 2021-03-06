'use strict';


const async = require('async');
const hana_helper = require('./hana-helper.js');
const connections = require('./connections');

/**
 * Class to handle the server version.
 *
 */
function Version () {
  this.version = '';
  this.major = -1;
  this.minor = -1;
  this.revision = -1;
  this.patch = -1;
  this.build = -1;
  this.versionSynthesized = '';
  this.error = undefined;

  this.calculateSynthesizedVersion = function () {
    this.versionSynthesized = `${String(this.major)}.${this.minor}.${this.revision}.${this.patch}`;
  };

  this.setVersion = function (str) {
    const components = str.split('.');

    if (components.length === 5) {
      this.version = str;
      this.major = parseInt(components[0]);
      this.minor = parseInt(components[1]);
      this.revision = parseInt(components[2]);
      this.patch = parseInt(components[3]);
      this.build = parseInt(components[4]);
    } else {
      this.version = 'unknown';
      this.major = 0;
      this.minor = 0;
      this.revision = 0;
      this.patch = 0;
      this.build = 0;
    }
    this.error = undefined;
    this.calculateSynthesizedVersion();
  };

  /**
   * Is the given version greater or equal to this version.
   *
   * @param {any} major Major
   * @param {any} minor Minor
   * @param {any} revision Revision
   * @param {any} patch Path
   * @param {any} build Build timestamp - optional.
   * @returns {Boolean} True if greater than or equal
   */
  this.isGreaterThanOrEqualTo = function (major, minor, revision, patch, build) {
    if (this.major < major) {
      return false;
    }
    if (this.major > major) {
      return true;
    }

    if (this.minor < minor) {
      return false;
    }
    if (this.minor > minor) {
      return true;
    }

    if (this.revision < revision) {
      return false;
    }
    if (this.revision > revision) {
      return true;
    }

    if (this.patch < patch) {
      return false;
    }

    if (build) {
      if (this.build < build) {
        return false;
      }
    }

    return true;
  };

  this.setVersion('');
}

function getFallbackVersion () {
  return new Version();
}

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
    client.execute('SELECT VERSION FROM SYS.M_DATABASE')
  ];

  async.series(tasks, function (err, result) {
    client.disconnect();
    const version = getFallbackVersion();

    if (!err) {
      version.setVersion(result[1][0].VERSION);
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
