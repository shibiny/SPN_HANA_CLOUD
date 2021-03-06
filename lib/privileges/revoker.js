'use strict';
const {handleUsers, handlePrivileges, handleFile} = require('./privilege_utils');

const {
  SQLRevokerStrategy,
  HDIContainerRevokerStrategy,
  ProcedureRevokerStrategy
} = require('./strategies');

/**
 * Function that returns the appropriate strategy.
 *
 * @param {any} revoker_type S
 * @param {any} client S
 * @param {any} revoker_schema S
 * @param {any} revoker_procedure S
 * @param {any} revoker_procedure_schema S
 * @returns {Strategy} Strategy
 */
function strategy_function (revoker_type, client, revoker_schema, revoker_procedure, revoker_procedure_schema) {
  return function (tasks) {
    if (revoker_type === 'hdi') {
      return new HDIContainerRevokerStrategy(client, tasks, revoker_schema);
    } else if (revoker_type === 'procedure') {
      return new ProcedureRevokerStrategy(client, tasks, revoker_procedure, revoker_procedure_schema);
    } else {
      return new SQLRevokerStrategy(client, tasks);
    }
  };
}

/**
 * Grant privileges.
 *
 * @param {any} client S
 * @param {any} revoker_type S
 * @param {any} privileges S
 * @param {any} revokee S
 * @param {any} revoker_schema S
 * @param {any} revoker_remote S
 * @param {any} revoker_procedure S
 * @param {any} revoker_procedure_schema S
 * @param {any} cb S
 * @returns {undefined}
 */
function revokePrivileges (client, revoker_type, privileges, revokee, revoker_schema, revoker_remote, revoker_procedure, revoker_procedure_schema, cb) {
  return handlePrivileges(strategy_function(revoker_type, client, revoker_schema, revoker_procedure, revoker_procedure_schema), privileges, revokee, revoker_schema, revoker_remote, cb);
}

/**
 * Grant the privileges to users.
 *
 * @param {any} privileges Privileges
 * @param {any} revoker Revoker
 * @param {any} fileName Name of the .hdbgrants file
 * @param {any} creds Credentials
 * @param {any} targetCreds Target Credentials
 * @param {any} container Container name
 * @param {any} revokee Grantee
 * @param {any} cb Callback
 * @returns {undefined}
 */
function revokeUsers (privileges, revoker, fileName, creds, targetCreds, container, revokee, cb) {
  /**
   * Get the revoker type from the credentials.
   *
   * @param {any} credentials Credentials
   * @returns {String} Revoker type
   */
  function  type_function (credentials) {
    let revoker_type;
    if (credentials.type !== undefined) {
      // if the revoker object contains a type field, then use this for selecting the revoker's type
      if (credentials.type === 'hdi' || credentials.type === 'sql' || credentials.type === 'procedure' || credentials.type === 'ignore') {
        revoker_type = credentials.type;
      } else {
        throw new Error("unknown revoker type, known revoker types are 'hdi', 'sql', 'procedure', 'ignore'");
      }
    } else {
      // otherwise, fallback to old auto-sensing for sql and hdi types
      revoker_type = 'sql';
      if (credentials.hdi_user) {
        revoker_type = 'hdi';
      }
    }
    return revoker_type;
  }

  handleUsers(false, type_function, revokePrivileges, privileges, revoker, fileName, creds, targetCreds, container, revokee, cb);
}

module.exports = function (services, root, fileName, container, revokee, cb) {
  return handleFile(false, revokeUsers, services, root, fileName, container, revokee, cb);
};
