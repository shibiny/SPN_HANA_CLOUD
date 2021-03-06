'use strict';

const async = require('async');

const hana_helper = require('../hana-helper.js');
const connections = require('../connections');
const logger = require('../logger.js');
const utils = require('../utils.js');

const fs = require('../fileWorker');
const paths = require('../paths');

/**
 * Find the schema from the given arguments, use '' as default.
 *
 * @returns {String} Schema
 */
function selectSchema () {
  // return the first non-undefined argument
  for (let i = 0; i < arguments.length; ++i) {
    const schema = arguments[i];
    if (schema !== undefined) {
      return schema;
    }
  }
  return '';
}

/**
 * Assert that the Array is in fact an array. The check if it is not empty.
 *
 * @param {any} to_check Array to check
 * @param {any} var_name Name of the var for the error message.
 * @returns {Boolean} True if not empty.
 * @throws {Error} Throws when to_check is not an Array.
 */
function check_array_is_array_and_not_empty (to_check, var_name) {
  if (!utils.isArray(to_check)) {
    throw new Error(`Expected ${var_name} to be of type Array. Found: ${Object.prototype.toString.call(to_check)}`);
  }

  return to_check.length > 0;
}

/**
 * Handle Privileges.
 *
 * @param {any} get_strategy_fn Function returning the strategy to use. Gets tasks as input.
 * @param {any} privileges Privileges to handle.
 * @param {any} grantee Grantee.
 * @param {any} cb Callback
 * @returns {Function} Return with callback.
 */
module.exports.handlePrivileges = function (get_strategy_fn, privileges, grantee, grantor_schema, grantor_remote, cb) {
  try {
    const tasks = [];

    const strategy = get_strategy_fn(tasks);

    strategy.initialize();

    /*
     * the rule for schema selection is:
     * 1. obj.schema
     * 2. obj.reference, only used for schema_privileges
     * 3. grantor_schema
     */

    if (privileges.roles) {
      /*
       * roles is supported for backwards compatibility
       * string format: "roles": [ "X", "Y" ]
       * object format: "roles": [ { "names": [ "X", "Y" ], "roles": [ "X", "Y" ], "roles_with_admin_option": [ "A", "B" ] } ]
       */
      const string_format_roles = [];
      privileges.roles.forEach(function (obj) {
        if (typeof obj === 'string') {
          string_format_roles.push(obj);
        } else {
          if (obj.names) {
            if (check_array_is_array_and_not_empty(obj.names, 'names')) {
              strategy.handleGlobalRoles(obj.names, grantee, false);
            }
          }
          if (obj.roles) {
            if (check_array_is_array_and_not_empty(obj.roles, 'roles')) {
              strategy.handleGlobalRoles(obj.roles, grantee, false);
            }
          }
          if (obj.roles_with_admin_option) {
            if (check_array_is_array_and_not_empty(obj.roles_with_admin_option, 'roles_with_admin_option')) {
              strategy.handleGlobalRoles(obj.roles_with_admin_option, grantee, true);
            }
          }
        }
      });

      if (string_format_roles.length > 0) {
        strategy.handleGlobalRoles(string_format_roles, grantee, false);
      }
    }

    if (privileges.global_roles) {
      /*
       * global_roles is supported for symmetry with hdbrole
       * string format: "global_roles": [ "X", "Y" ]
       * object format: "global_roles": [ { "names": [ "X", "Y" ], "roles": [ "X", "Y" ], "roles_with_admin_option": [ "A", "B" ] } ]
       */
      const string_format_global_roles = [];
      privileges.global_roles.forEach(function (obj) {
        if (typeof obj === 'string') {
          string_format_global_roles.push(obj);
        } else {
          if (obj.names) {
            if (check_array_is_array_and_not_empty(obj.names, 'names')) {
              strategy.handleGlobalRoles(obj.names, grantee, false);
            }
          }
          if (obj.roles) {
            if (check_array_is_array_and_not_empty(obj.roles, 'roles')) {
              strategy.handleGlobalRoles(obj.roles, grantee, false);
            }
          }
          if (obj.roles_with_admin_option) {
            if (check_array_is_array_and_not_empty(obj.roles_with_admin_option, 'roles_with_admin_option')) {
              strategy.handleGlobalRoles(obj.roles_with_admin_option, grantee, true);
            }
          }
        }
      });

      if (string_format_global_roles.length > 0) {
        strategy.handleGlobalRoles(string_format_global_roles, grantee, false);
      }
    }

    if (privileges.system_privileges) {
      /*
       * string format: "system_privileges": [ "X", "Y" ]
       * object format: "system_privileges": [ { "privileges": [ "X", "Y" ], "privileges_with_admin_option": [ "A", "B" ] } ]
       */
      const string_format_privileges = [];
      privileges.system_privileges.forEach(function (obj) {
        if (typeof obj === 'string') {
          string_format_privileges.push(obj);
        } else {
          if (obj.privileges) {
            if (check_array_is_array_and_not_empty(obj.privileges, 'privileges')) {
              strategy.handleSystemPrivileges(obj.privileges, grantee, false);
            }
          }
          if (obj.privileges_with_admin_option) {
            if (check_array_is_array_and_not_empty(obj.privileges_with_admin_option, 'privileges_with_admin_option')) {
              strategy.handleSystemPrivileges(obj.privileges_with_admin_option, grantee, true);
            }
          }
        }
      });

      if (string_format_privileges.length > 0) {
        strategy.handleSystemPrivileges(string_format_privileges, grantee, false);
      }
    }

    if (privileges.schema_privileges) {
      privileges.schema_privileges.forEach(function (obj) {
        if (obj.privileges) {
          if (check_array_is_array_and_not_empty(obj.privileges, 'privileges')) {
            strategy.handleSchemaPrivileges(obj.privileges, selectSchema(obj.schema, obj.reference, grantor_schema), grantee, false);
          }
        }
        if (obj.privileges_with_grant_option) {
          if (check_array_is_array_and_not_empty(obj.privileges_with_grant_option, 'privileges_with_grant_option')) {
            strategy.handleSchemaPrivileges(obj.privileges_with_grant_option, selectSchema(obj.schema, obj.reference, grantor_schema), grantee, true);
          }
        }
      });
    }

    if (privileges.object_privileges) {
      privileges.object_privileges.forEach(function (obj) {
        if (obj.privileges) {
          if (check_array_is_array_and_not_empty(obj.privileges, 'privileges')) {
            strategy.handleSchemaObjectPrivileges(obj.privileges, selectSchema(obj.schema, grantor_schema), obj.name, grantee, false);
          }
        }
        if (obj.privileges_with_grant_option) {
          if (check_array_is_array_and_not_empty(obj.privileges_with_grant_option, 'privileges_with_grant_option')) {
            strategy.handleSchemaObjectPrivileges(obj.privileges_with_grant_option, selectSchema(obj.schema, grantor_schema), obj.name, grantee, true);
          }
        }
      });
    }

    if (privileges.global_object_privileges) {
      privileges.global_object_privileges.forEach(function (obj) {
        let name = obj.name;
        if (typeof name === 'undefined' && obj.type === 'REMOTE SOURCE') {
          name = grantor_remote;
        }

        if (obj.privileges) {
          if (check_array_is_array_and_not_empty(obj.privileges, 'privileges')) {
            strategy.handleGlobalObjectPrivileges(obj.privileges, name, obj.type, grantee, false);
          }
        }
        if (obj.privileges_with_grant_option) {
          if (check_array_is_array_and_not_empty(obj.privileges_with_grant_option, 'privileges_with_grant_option')) {
            strategy.handleGlobalObjectPrivileges(obj.privileges_with_grant_option, name, obj.type, grantee, true);
          }
        }
      });
    }

    if (privileges.schema_roles) {
      /*
       * string format: "schema_roles": [ "X", "Y" ]
       * object format: "schema_roles": [ { "names": [ "X", "Y" ], "roles": [ "X", "Y" ], "roles_with_admin_option": [ "A", "B" ] } ]
       */
      const string_format_schema_roles = [];
      privileges.schema_roles.forEach(function (obj) {
        if (typeof obj === 'string') {
          string_format_schema_roles.push(obj);
        } else {
          if (obj.names) {
            if (check_array_is_array_and_not_empty(obj.names, 'names')) {
              strategy.handleSchemaRoles(selectSchema(obj.schema, grantor_schema), obj.names, grantee, false);
            }
          }
          if (obj.roles) {
            if (check_array_is_array_and_not_empty(obj.roles, 'roles')) {
              strategy.handleSchemaRoles(selectSchema(obj.schema, grantor_schema), obj.roles, grantee, false);
            }
          }
          if (obj.roles_with_admin_option) {
            if (check_array_is_array_and_not_empty(obj.roles_with_admin_option, 'roles_with_admin_option')) {
              strategy.handleSchemaRoles(selectSchema(obj.schema, grantor_schema), obj.roles_with_admin_option, grantee, true);
            }
          }
        }
      });

      if (string_format_schema_roles.length > 0) {
        strategy.handleSchemaRoles(grantor_schema, string_format_schema_roles, grantee, false);
      }
    }

    if (privileges.container_roles) {
      if (check_array_is_array_and_not_empty(privileges.container_roles, 'container_roles')) {
        strategy.handleSchemaRoles(grantor_schema, privileges.container_roles, grantee, false);
      }
    }

    strategy.finalize();

    async.series(tasks, cb);
  } catch (err) {
    return cb(err);
  }
};

module.exports.handleUsers = function (isGrantAction, type_function, privileges_function, privileges, grantor, fileName, creds, targetCreds, container, grantee, cb) {
  try {
    const tasks = [];
    const type = type_function(creds);

    const action = isGrantAction ? 'grantor' : 'revoker';

    let host = creds.host;
    let port = creds.port;
    let hosts = creds.db_hosts;
    let certificate = creds.certificate;
    let client_private_key = creds.client_authentication_private_key;
    let client_certificate = creds.client_authentication_certificate;
    let hostname_in_certificate = creds.hostname_in_certificate;
    let validate_certificate = creds.validate_certificate;
    let encrypt = creds.encrypt;

    if (!Array.isArray(hosts) && host === undefined && port === undefined && certificate === undefined &&
          hostname_in_certificate === undefined && validate_certificate === undefined && encrypt === undefined &&
          client_private_key === undefined && client_certificate === undefined) {
      // host, port, certificate are optional in the service credentials, fallback to target credentials if undefined
      host = targetCreds.host;
      port = targetCreds.port;
      hosts = targetCreds.db_hosts;
      certificate = targetCreds.certificate;
      client_private_key = targetCreds.client_authentication_private_key;
      client_certificate = targetCreds.client_authentication_certificate;
      hostname_in_certificate = targetCreds.hostname_in_certificate;
      validate_certificate = targetCreds.validate_certificate;
      encrypt = targetCreds.encrypt;
    }

    let user = creds.user;
    let password = creds.password;
    if (type === 'hdi') {
      user = creds.hdi_user;
      password = creds.hdi_password;
    }

    logger.log(`  Using ${action} service "${grantor}" of type "${type}"`);

    if (type === 'ignore') {
      cb(null);
      return;
    }

    const client = hana_helper(host, port, user, password, certificate, hosts, hostname_in_certificate, validate_certificate, encrypt, client_private_key, client_certificate);
    connections.push({client, file: __filename});

    tasks.push(client.connect());
    if (creds.schema && type !== 'procedure') {
      tasks.push(client.setSchema(creds.schema, type === 'hdi'));
    }

    if (privileges.object_owner) {
      tasks.push(function (callback) {
        privileges_function(client, type, privileges.object_owner, container, creds.schema, creds.remote, creds.procedure, creds.procedure_schema, callback);
      });
    }

    if (privileges.application_user) {
      tasks.push(function (callback) {
        privileges_function(client, type, privileges.application_user, grantee, creds.schema, creds.remote, creds.procedure, creds.procedure_schema, callback);
      });
    }

    tasks.push(client.disconnect());

    return async.series(tasks, function (err, results) {
      client.end();

      if (err) { // add information about grantor service & underlying user
        err.message += `\n${action} service: "${grantor}", type: "${type}", user: "${user}"`;
        if (type === 'hdi') {
          err.message += ' (hdi_user)';
        }
        if (type === 'procedure') {
          err.message += `, procedure: "${creds.procedure}"`;
          if (creds.procedure_schema) {
            err.message += `, procedure_schema: "${creds.procedure_schema}"`;
          }
        }

        err.message += `\nfile name: ${fileName}`;
      }

      cb(err, results);
    });
  } catch (err) {
    return cb(err);
  }
};

module.exports.handleFile = function (isGrantAction, handle_users_fn, services, root, fileName, container, grantee, cb) {
  const tasks = [];
  try {
    const trace_string = isGrantAction ? 'grantor' : 'revoker';

    fileName = paths.clientPath(fileName);

    const file = fs.readJSONFile(fileName);

    const targetCreds = services.getTargetCreds();

    Object.keys(file).forEach(function (grantor) {
      tasks.push(function (callback) {
        let creds;
        try {
          creds = services.getCreds(grantor);
        } catch (err) {
          callback(err);
          return;
        }

        logger.trace(trace_string, file[grantor]);
        handle_users_fn(file[grantor], grantor, fileName, creds, targetCreds, container, grantee, callback);
      });
    });
  } catch (err) {
    return cb(err);
  }

  return async.series(tasks, cb);
};
