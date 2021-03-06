'use strict';
const {handleUsers, handlePrivileges, handleFile} = require('./privilege_utils');

const {
  SQLGrantorStrategy,
  HDIContainerGrantorStrategy,
  ProcedureGrantorStrategy
} = require('./strategies');

/**
 * Function that returns the appropriate strategy.
 *
 * @param {any} grantor_type S
 * @param {any} client S
 * @param {any} grantor_schema S
 * @param {any} grantor_procedure S
 * @param {any} grantor_procedure_schema S
 * @returns {Strategy} Strategy
 */
function strategy_function (grantor_type, client, grantor_schema, grantor_procedure, grantor_procedure_schema) {
  return function (tasks) {
    if (grantor_type === 'hdi') {
      return new HDIContainerGrantorStrategy(client, tasks, grantor_schema);
    } else if (grantor_type === 'procedure') {
      return new ProcedureGrantorStrategy(client, tasks, grantor_procedure, grantor_procedure_schema);
    } else {
      return new SQLGrantorStrategy(client, tasks);
    }
  };
}

/**
 * Grant privileges.
 *
 * @param {any} client S
 * @param {any} grantor_type S
 * @param {any} privileges S
 * @param {any} grantee S
 * @param {any} grantor_schema S
 * @param {any} grantor_remote S
 * @param {any} grantor_procedure S
 * @param {any} grantor_procedure_schema S
 * @param {any} cb S
 * @returns {undefined}
 */
function grantPrivileges (client, grantor_type, privileges, grantee, grantor_schema, grantor_remote, grantor_procedure, grantor_procedure_schema, cb) {
  return handlePrivileges(strategy_function(grantor_type, client, grantor_schema, grantor_procedure, grantor_procedure_schema), privileges, grantee, grantor_schema, grantor_remote, cb);
}

/**
 * Grant the privileges to users.
 *
 * @param {any} privileges Privileges
 * @param {any} grantor Grantor
 * @param {any} fileName Name of the .hdbgrants file
 * @param {any} creds Credentials
 * @param {any} targetCreds Target Credentials
 * @param {any} container Container name
 * @param {any} grantee Grantee
 * @param {any} cb Callback
 * @returns {undefined}
 */
function grantUsers (privileges, grantor, fileName, creds, targetCreds, container, grantee, cb) {
  /**
   * Get the grantor type from the credentials.
   *
   * @param {any} credentials Credentials
   * @returns {String} Grantor type
   */
  function  type_function (credentials) {
    let grantor_type;
    if (credentials.type !== undefined) {
      // if the grantor object contains a type field, then use this for selecting the grantor's type
      if (credentials.type === 'hdi' || credentials.type === 'sql' || credentials.type === 'procedure' || credentials.type === 'ignore') {
        grantor_type = credentials.type;
      } else {
        throw new Error("unknown grantor type, known grantor types are 'hdi', 'sql', 'procedure', 'ignore'");
      }
    } else {
      // otherwise, fallback to old auto-sensing for sql and hdi types
      grantor_type = 'sql';
      if (credentials.hdi_user) {
        grantor_type = 'hdi';
      }
    }
    return grantor_type;
  }

  handleUsers(true, type_function, grantPrivileges, privileges, grantor, fileName, creds, targetCreds, container, grantee, cb);
}

module.exports = function (services, root, fileName, container, grantee, cb) {
  return handleFile(true, grantUsers, services, root, fileName, container, grantee, cb);
};