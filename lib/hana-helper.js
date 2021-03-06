'use strict';


const async = require('async');
const hana_client = require('@sap/hana-client');
const hana_util = require('@sap/hana-client/extension/Stream.js');
const {enrich_credentials_with_session_variables} = require('./client-info');

const logger = require('./logger.js');

const identifier = require('./utils.js').identifier;
const dot_quoted_identifier = require('./utils.js').dot_quoted_identifier;
const censor_string = require('./utils').censor_string;

/**
 * Return a new array of the given length initialized with the given value.
 *
 * @param {any} length Length of array
 * @param {any} val Value to init with
 * @returns {Array} Array
 */
function newArray (length, val) {
  const a = [];

  for (let i = 0; i < length; i = i + 1) {
    a[i] = val;
  }
  return a;
}

/**
 * Return n spaces;
 *
 * @param {any} n Number of spaces
 * @returns {string} N spaces
 */
function indentSpaces (n) {
  let spaces = '';
  let i;

  for (i = 0; i < n; i = i + 1) {
    spaces += ' ';
  }
  return spaces;
}

const log_map = new Map();

/**
 * Print messages to console
 *
 * @param {any} logObj Logger to use
 * @param {any} messages Messages
 * @returns {undefined}
 */
function printMessagesToConsole (logObj, messages) {
  messages.forEach(function (message) {
    let time_delta_string = '';
    if (message.MESSAGE.endsWith('... ok')) {
      const key = message.MESSAGE.slice(0, -3);
      if (log_map.has(key)) {
        const delta = Math.abs(new Date(message.TIMESTAMP_UTC) - log_map.get(key));
        time_delta_string = ` (${Math.floor(delta / 1000)}s ${delta % 1000}ms)`;
        log_map.delete(key);
      }
    } else if (message.MESSAGE.endsWith('...')) {
      log_map.set(message.MESSAGE, new Date(message.TIMESTAMP_UTC));
    }

    const locationRowCol = [];
    let id = '';
    let locationText = '';

    if (message.MESSAGE === 'END') {
      return;
    }

    const indent = indentSpaces(message.LEVEL + 1);
    const showDetails = message.SEVERITY === 'ERROR' || message.SEVERITY === 'WARNING';

    if (showDetails) {
      id = message.PLUGIN_ID;
      if (!id) {
        id = message.LIBRARY_ID;
      }

      const severity = (message.SEVERITY === 'ERROR') ? 'Error' : 'Warning';

      if (id) {
        logObj.logVerbose('%s%s: %s: %s [%s]%s', indent, severity, id, message.MESSAGE, message.MESSAGE_CODE, time_delta_string);
      } else {
        logObj.logVerbose('%s%s: %s [%s]%s', indent, severity, message.MESSAGE, message.MESSAGE_CODE, time_delta_string);
      }

      if (message.PATH) {
        if (message.LOCATION) {
          locationRowCol.push(message.LOCATION);
        }
        if (message.LOCATION_PATH) {
          locationRowCol.push(message.LOCATION_PATH);
        }
        if (locationRowCol.length !== 0) {
          locationText = `(${locationRowCol.join(',')})`;
        }
        logObj.logVerbose('%s  at "%s" %s', indent, message.PATH, locationText);
      }
    } else {
      logObj.logVerbose('%s%s %s', indent, message.MESSAGE, time_delta_string);
    }
  });
}

/**
 * Log the given messages to a file and to the parent.
 *
 * @param {any} logObj Logger to use
 * @param {any} messages Messages
 * @returns {undefined}
 */
function logMessagesToFileAndParent (logObj, messages) {
  messages.forEach(function (message) {
    if (message.MESSAGE === 'END') {
      return;
    }

    const jsonObject = {
      id: logger.nextMessageId(),
      origin: 'server',
      request_id: message.REQUEST_ID,
      row_id: message.ROW_ID,
      level: message.LEVEL,
      type: message.TYPE,
      library_id: message.LIBRARY_ID,
      plugin_id: message.PLUGIN_ID,
      path: message.PATH,
      severity: message.SEVERITY,
      message_code: message.MESSAGE_CODE,
      message: message.MESSAGE,
      location: message.LOCATION,
      location_path: message.LOCATION_PATH,
      timestamp_utc: message.TIMESTAMP_UTC
    };

    logObj.logToFile(jsonObject);
    logObj.logToParent(jsonObject);
  });
}

/**
 * Print the given messages.
 *
 * @param {any} logObj Logger to use
 * @param {any} messages Messages
 * @returns {undefined}
 */
function printMessages (logObj, messages) {
  if (!Array.isArray(messages)) {
    messages = [messages];
  }

  printMessagesToConsole(logObj, messages);
  logMessagesToFileAndParent(logObj, messages);
}

/**
 *  print hdi stored procedure call result
 *
 * @param {any} cb Callback
 * @param {any} parameters Parameters
 * @param {any} messages Messages
 * @returns {undefined}
 */
function printResult (cb, parameters, messages) {
  printMessages(logger, messages);
  cb(null);
}

/**
 * check hdi stored procedure call result
 *
 *
 * @param {any} phase Phase
 * @param {any} silent Silent
 * @param {any} expectedErrorMessageCodes Errors that are expected to occur
 * @returns {Function} Function taking callback, parameters and messages.
 */
function checkResult (phase, silent, expectedErrorMessageCodes) {
  return function (cb, parameters, messages) {
    if (parameters.RETURN_CODE >= 0) {
      if (!silent) {
        printMessages(logger, messages);
      }
      cb(null, {
        phase: phase,
        messages: messages
      });
      return;
    }

    // it's an error situation
    if (expectedErrorMessageCodes) {
      let foundMessageErrorCodes = 0;
      for (let i = 0; i < expectedErrorMessageCodes.length; ++i) {
        const expectedErrorMessageCode = expectedErrorMessageCodes[i];
        for (let j = 0; j < messages.length; ++j) {
          if (messages[j].MESSAGE_CODE === expectedErrorMessageCode) {
            ++foundMessageErrorCodes;
            break;
          }
        }
      }

      if (foundMessageErrorCodes === expectedErrorMessageCodes.length) {
        // ignore this error if all expected error message codes are in the messages
        cb(null, {
          phase: phase,
          messages: messages
        });
        return;
      }
    }

    printMessages(logger, messages);
    cb(new Error('HDI call failed'));
  };
}

/**
 *  Constructor function for a hana-helper instance.
 *
 * @param {String} host Host of the HANA
 * @param {String} port Port of the HANA
 * @param {String} user User for HANA
 * @param {String} password Password for HANA user
 * @param {String[]} certificate Specifies an array of the Certificate Authority public root certificates that is used to verify the server's certificate.
 * @param {String[]} dbhosts db_hosts list
 * @param {String} hostname_in_certificate Specifies the host name used to verify the server???s identity.
 * @param {Boolean} validate_certificate Specifies whether to validate the server's certificate.
 * @param {Boolean} encrypt Enables or disables TLS 1.1 ??? TLS1.2 encryption. The server will choose the highest available.
 * @param {String} client_key Client key for mutual auth
 * @param {String} client_cert Client certificate for mutual auth
 * @returns {hana-helper} A hana-helper instance
 */
module.exports = function (host, port, user, password, certificate, dbhosts, hostname_in_certificate, validate_certificate, encrypt, client_key, client_cert) {
  const credentials = enrich_credentials_with_session_variables();

  credentials.user = user;
  credentials.password = password;
  if (Array.isArray(dbhosts)) {
    credentials.hosts = dbhosts.map(entry => {
      if (entry.port) {
        entry.port = `${entry.port}`;
      }

      return entry;
    });
  } else {
    credentials.host = host;
    // hana-client@2.7.16 requires this to be a string.
    credentials.port = `${port}`;
  }

  if (client_key) {
    credentials.key = client_key;
    logger.trace(`credentials.key set to '${censor_string(credentials.key, 0.05)}'`);
  }

  if (client_cert) {
    credentials.cert = client_cert;
    logger.trace(`credentials.cert set to '${credentials.cert}'`);
  }

  if (certificate) {
    credentials.ca = Array.isArray(certificate) ? certificate : [certificate];
    logger.trace('credentials.ca set to', credentials.ca);
  }

  if (hostname_in_certificate) {
    credentials.sslHostNameInCertificate = hostname_in_certificate;
    logger.trace('credentials.sslHostNameInCertificate set to', credentials.sslHostNameInCertificate);
  }
  // boolean
  if (validate_certificate !== undefined && validate_certificate !== null) {
    credentials.sslValidateCertificate = validate_certificate;
    logger.trace('credentials.sslValidateCertificate set to', credentials.sslValidateCertificate);
  }
  // boolean
  if (encrypt !== undefined && encrypt !== null) {
    credentials.encrypt = encrypt;
    logger.trace('credentials.encrypt set to', credentials.encrypt);
  }

  const client = hana_client.createConnection();

  /**
   * Format a SQL error message.
   *
   * @param {any} sql SQL that ran.
   * @param {any} err Error that occurred.
   * @returns {Error} Error object
   */
  function formatSqlError (sql, err) {
    if (err) {
      logger.trace(err);
      return new Error(`Error executing: ${sql};\n (nested message: ${err.message})`);
    }
    return null;
  }

  /**
   * Connect to the client.
   *
   * @returns {CallbackFunction} Function taking a standard callback as the only argument.
   */
  function connect () {
    return function (cb) {
      if (logger.getHanaClientTrace()) {
        const traceCB = function (buf) {
          logger.log(buf.toString());
        };
        const traceOptions = logger.getHanaClientPacketTrace() ?
          'DEBUG,SQL,PACKET=32K,FLUSH,OutBufferSize=128K' :
          'DEBUG,SQL,PACKET=OFF,FLUSH,OutBufferSize=64K';
        logger.log(`hana-helper SAP HANA client trace options: ${traceOptions}`);
        client.onTrace(traceOptions, traceCB);
      }
      logger.trace('hana_client connect: ', credentials);
      client.connect(credentials, cb);
    };
  }
  /**
   * Disconnect from.
   *
   * @returns {CallbackFunction} Function taking a standard callback as the only argument.
   */
  function disconnect () {
    return function (cb) {
      logger.trace('hana_client disconnect');
      client.close();
      cb();
    };
  }
  /**
   * Execute the given command.
   *
   * @param {any} sql SQL
   * @returns {CallbackFunction} Function taking a standard callback as the only argument.
   */
  function execute (sql) {
    return function (cb) {
      logger.trace('hana_client exec', sql);
      client.exec(sql, function (err, rows) {
        cb(formatSqlError(sql, err), rows);
      });
    };
  }
  /**
   * Insert the given data
   *
   * @param {any} sql SQL
   * @param {any} data Data
   * @returns {CallbackFunction} Function taking a standard callback as the only argument.
   */
  function insert (sql, data) {
    // no data -> avoid driver error (Invalid input parameter values)
    if (!data.length) {
      return function (cb) {
        cb(null, null);
      };
    }

    return function (cb) {
      // logger.trace('hana_client insert', sql, data);
      logger.trace('hana_client insert', sql);
      async.waterfall([
        function (callback) {
          client.prepare(sql, callback);
        },
        function (stmt, callback) {
          stmt.exec(data, callback);
        }
      ], function (err, results) {
        cb(formatSqlError(sql, err), results);
      });
    };
  }

  // stored procedure returns 1 table result
  /**
   * Calls a stored procedure returning a single table result.
   *
   * @param {any} sql SQL
   * @param {any} input Input parameters
   * @param {any} fct Callback function
   * @returns {CallbackFunction} Function taking a standard callback as the only argument.
   */
  function callproc1 (sql, input, fct) {
    input = input || {}; // if undefined - hana client driver exception
    return function (cb) {
      logger.trace('hana client call proc prepare: %s', sql);
      async.waterfall([
        function (callback) {
          hana_util.createProcStatement(client, sql, callback);
        },
        function (stmt, callback) {
          stmt.exec(input, callback);
        },
        function (parameters, messages, callback) {
          if (fct) {
            return fct(callback, parameters, messages);
          } else {
            return callback(null);
          }
        }
      ], function (err, results) {
        cb(formatSqlError(sql, err), results);
      });
    };
  }

  // stored procedure returns 2 table results
  /**
   * Call a stored procedure returning 2 table results.
   *
   * @param {any} sql SQL
   * @param {any} input Input
   * @param {any} fct Function
   * @returns {CallbackFunction} Function taking a standard callback as the only argument.
   */
  function callproc2 (sql, input, fct) {
    input = input || {}; // if undefined - hana_client driver exception

    return function (cb) {
      logger.trace('hana_client call proc prepare: %s', sql);
      async.waterfall([
        function (callback) {
          hana_util.createProcStatement(client, sql, callback);
        },
        function (stmt, callback) {
          stmt.exec(input, callback);
        },
        function (parameters, messages, result, callback) {
          if (fct) {
            return fct(callback, parameters, messages, result);
          } else {
            return callback(null);
          }
        }
      ], function (err, results) {
        cb(formatSqlError(sql, err), results);
      });
    };
  }

  /**
   * Set the schema for the further calls.
   *
   * @param {any} schema Schema
   * @returns {CallbackFunction} Function taking a standard callback as the only argument.
   */
  function setSchema (schema, useHashDI = false) {
    /*
     * workaround - check in which schema the creation of local temporary tables is possible
     * - use schema in GoBroker / hana client 0.9
     * - use schema + #DI in JavaBroker / hana client 0.10
     */
    return function (cb) {
      async.series([
        execute(`SET SCHEMA ${identifier(useHashDI ? `${schema}#DI` : schema)}`),
        execute('CREATE LOCAL TEMPORARY ROW TABLE #TEST LIKE _SYS_DI.TT_PARAMETERS')
      ], function (err, results) {
        if (!err) {
          cb(err, results);
          return;
        }
        execute(`SET SCHEMA ${identifier(schema)}`)(cb);
      });
    };
  }

  return {
    /**
     * End the connection.
     * @returns {undefined}
     */
    end: function () {
      client.end();
    },

    /**
     * Connect
     *
     * @returns {CallbackFunction}
     */
    connect: connect,

    disconnect: disconnect,

    quotedSQLIdentifier: identifier,

    execute: execute,

    /**
     * Set autocommit on the connection.
     *
     * @param {any} val Value for autocommit
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    setAutoCommit: function (val) {
      return function (cb) {
        client.setAutoCommit(val);
        cb();
      };
    },

    /**
     * Create temporary tables.
     *
     * @param {Array[]} tables Array of tuples, first entry is table name, second is LIKE table.
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    createTmpTables: function (tables) {
      const tasks = tables.map(function (table) {
        return execute(`CREATE LOCAL TEMPORARY ROW TABLE ${table[0]} LIKE ${table[1]}`);
      });

      return function (cb) {
        async.series(tasks, cb);
      };
    },
    /**
     * Drop tables.
     *
     * @param {Array[]} tables Array of arrays, first entry is table name.
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    dropTmpTables: function (tables) {
      const tasks = tables.map(function (table) {
        return execute(`DROP TABLE ${table[0]}`);
      });

      return function (cb) {
        async.series(tasks, cb);
      };
    },

    setSchema: setSchema,

    /**
     * Insert a bunch of values into the respective fields in a table.
     *
     * @param {any} table Table
     * @param {[]} fields Array of field names
     * @param {any} values Values
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    bulkInsert: function (table, fields, values) {
      return function (cb) {
        const fieldList = ` (${fields.map(function (field) {
          return identifier(field);
        }).join(', ')}) `;

        async.forEach(values, (value, callback) => {
          insert(`INSERT INTO ${table}${fieldList} VALUES (${newArray(fields.length, '?').join(', ')})`, value)(callback);
        }, cb);
      };
    },

    /**
     * Create a user with the given credentials.
     *
     * @param {any} username User
     * @param {any} pw Password
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    createUser: function (username, pw) {
      return function (cb) {
        async.series([
          execute(`CREATE USER ${username} PASSWORD ${pw}`),
          execute(`ALTER USER ${username} ENABLE CLIENT CONNECT`),
          execute(`ALTER USER ${username} DISABLE PASSWORD LIFETIME`)
        ], cb);
      };
    },

    /**
     * Drop a user with optional cascade
     *
     * @param {String} username Username
     * @param {Boolean} cascade Cascade flag
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    dropUser: function (username, cascade) {
      if (cascade) {
        return execute(`DROP USER ${username} CASCADE`);
      }
      return execute(`DROP USER ${username}`);
    },

    /**
     * Create a role with the given name
     *
     * @param {any} role Role name
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    createRole: function (role) {
      return execute(`CREATE ROLE ${identifier(role)}`);
    },
    /**
     * Drop a role with the given name
     *
     * @param {any} role Role name
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    dropRole: function (role) {
      return execute(`DROP ROLE ${identifier(role)}`);
    },
    /**
     * Grant a role with the given name to the grantee
     *
     * @param {any} role Role name
     * @param {any} grantee Name of whom  to grant to
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    grantRole: function (role, grantee) {
      return execute(`GRANT ${identifier(role)} TO ${identifier(grantee)}`);
    },
    /**
     * Grant multiple roles to the grantee, optionally with Admin Option.
     *
     * @param {[]} roles Array of role names
     * @param {any} grantee Name of whom  to grant to
     * @param {Boolean} withAdminOption Grant with admin option
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    grantRoles: function (roles, grantee, withAdminOption) {
      const sql = withAdminOption ? `GRANT ${roles.map(identifier).join(',')} TO ${identifier(grantee)} WITH ADMIN OPTION` : `GRANT ${roles.map(identifier).join(',')} TO ${identifier(grantee)}`;

      return execute(sql);
    },
    /**
     * Grant multiple schema roles to the grantee, optionally with Admin Option.
     *
     * @param {String} schema Schema to grant for
     * @param {[]} roles Array of role names
     * @param {any} grantee Name of whom  to grant to
     * @param {Boolean} withAdminOption Grant with admin option
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    grantSchemaRoles: function (schema, roles, grantee, withAdminOption) {
      const sql = withAdminOption ? `GRANT ${roles.map((role) => `${identifier(schema)}.${identifier(role)}`).join(',')} TO ${identifier(grantee)} WITH ADMIN OPTION` : `GRANT ${roles.map((role) => `${identifier(schema)}.${identifier(role)}`).join(',')} TO ${identifier(grantee)}`;

      return execute(sql);
    },
    /**
     * Grant system privileges to the grantee, optionally with Admin Option.
     *
     * @param {[]} privileges Array of privileges
     * @param {any} grantee Name of whom  to grant to
     * @param {Boolean} withAdminOption Grant with admin option
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    grantSystemPrivileges: function (privileges, grantee, withAdminOption) {
      const sql = withAdminOption ? `GRANT ${privileges.map(dot_quoted_identifier).join(',')} TO ${identifier(grantee)} WITH ADMIN OPTION` : `GRANT ${privileges.map(dot_quoted_identifier).join(',')} TO ${identifier(grantee)}`;

      return execute(sql);
    },
    /**
     * Grant schema privileges to the grantee, optionally with Grant Option.
     *
     * @param {[]} privileges Array of privileges
     * @param {String} schema Schema to grant for
     * @param {any} grantee Name of whom  to grant to
     * @param {Boolean} withGrantOption Grant with grant option
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    grantSchemaPrivileges: function (privileges, schema, grantee, withGrantOption) {
      const sql = withGrantOption ? `GRANT ${privileges.map(identifier).join(',')} ON SCHEMA ${identifier(schema)} TO ${identifier(grantee)} WITH GRANT OPTION` : `GRANT ${privileges.map(identifier).join(',')} ON SCHEMA ${identifier(schema)} TO ${identifier(grantee)}`;

      return execute(sql);
    },
    /**
     * Grant object privileges to the grantee, optionally with Grant Option.
     *
     * @param {[]} privileges Array of privileges
     * @param {String} schema Schema to grant for
     * @param {String} obj Object to grant on
     * @param {any} grantee Name of whom  to grant to
     * @param {Boolean} withGrantOption Grant with grant option
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    grantObjectPrivileges: function (privileges, schema, obj, grantee, withGrantOption) {
      const objName = schema ? [identifier(schema), identifier(obj)].join('.') : identifier(obj);
      const sql = withGrantOption ? `GRANT ${privileges.map(identifier).join(',')} ON ${objName} TO ${identifier(grantee)}  WITH GRANT OPTION` : `GRANT ${privileges.map(identifier).join(',')} ON ${objName} TO ${identifier(grantee)}`;

      return execute(sql);
    },
    /**
     * Grant object privileges to the grantee, optionally with Grant Option.
     *
     * @param {[]} privileges Array of privileges
     * @param {String} obj Object to grant on
     * @param {String} type Type of privilege
     * @param {any} grantee Name of whom  to grant to
     * @param {Boolean} withGrantOption Grant with grant option
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    grantGlobalObjectPrivileges: function (privileges, obj, type, grantee, withGrantOption) {
      if (type !== 'REMOTE SOURCE') {
        throw new Error(`${obj} must be of type REMOTE SOURCE`);
      }
      const sql = withGrantOption ? `GRANT ${privileges.map(identifier).join(',')} ON ${type} ${identifier(obj)} TO ${identifier(grantee)} WITH GRANT OPTION` : `GRANT ${privileges.map(identifier).join(',')} ON ${type} ${identifier(obj)} TO ${identifier(grantee)}`;

      return execute(sql);
    },

    /**
     * Grant schema privileges on a container via the group API.
     *
     * @param {String} group Name of the containerGroup
     * @param {String} schema Name of the container
     * @param {String} privTable Table containing the privileges
     * @param {String} prmsTable Table containing the parameters
     * @param {Callback} cb Callback function
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    hdiGrantSchemaPrivileges: function (group, schema, privTable, prmsTable, cb) {
      return callproc1(`CALL _SYS_DI#${group}.GRANT_CONTAINER_SCHEMA_PRIVILEGES(${['?', privTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, {
        CONTAINER_NAME: schema
      }, cb);
    },

    /**
     * HDI grant container schema roles
     *
     * @param {String} schema Name of the container
     * @param {any} rolesTable Table containing the roles
     * @param {String} prmsTable Table containing the parameters
     * @param {Callback} cb Callback function
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    hdiGrantSchemaRoles: function (schema, rolesTable, prmsTable, cb) {
      return callproc1(`CALL ${identifier(`${schema}#DI`)}.GRANT_CONTAINER_SCHEMA_ROLES(${[rolesTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, null, cb);
    },

    /**
     * HDI revoke schema privileges
     *
     * @param {String} schema Name of the container
     * @param {String} privTable Table containing the privileges
     * @param {String} prmsTable Table containing the parameters
     * @param {Callback} cb Callback function
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    hdiRevokeSchemaPrivileges: function (schema, privTable, prmsTable, cb) {
      return callproc1(`CALL ${identifier(`${schema}#DI`)}.REVOKE_CONTAINER_SCHEMA_PRIVILEGES(${[privTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, null, cb);
    },

    /**
     * HDI delete
     *
     * @param {String} schema Name of the container
     * @param {any} delTable Table containing paths to delete
     * @param {String} prmsTable Table containing the parameters
     * @param {Callback} cb Callback function
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    hdiDelete: function (schema, delTable, prmsTable, cb) {
      return callproc1(`CALL ${identifier(`${schema}#DI`)}.DELETE(${[delTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, null, cb);
    },

    /**
     * HDI write
     *
     * @param {String} schema Name of the container
     * @param {any} writeTable Table containing content to write
     * @param {String} prmsTable Table containing the parameters
     * @param {Callback} cb Callback function
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    hdiWrite: function (schema, writeTable, prmsTable, cb) {
      return callproc1(`CALL ${identifier(`${schema}#DI`)}.WRITE(${[writeTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, null, cb);
    },

    /**
     * HDI status
     *
     * @param {String} schema Name of the container
     * @param {any} statTable Table containing paths to get the status for
     * @param {String} prmsTable Table containing the parameters
     * @param {Callback} cb Callback function
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    hdiStatus: function (schema, statTable, prmsTable, cb) {
      return callproc2(`CALL ${identifier(`${schema}#DI`)}.STATUS(${[statTable, prmsTable].concat(newArray(4, '?')).join(', ')})`, null, cb);
    },

    /**
     * HDI make
     *
     * @param {String} schema Name of the container
     * @param {any} deployTable Table containing files to deploy
     * @param {any} undeployTable Table containing files to undeploy
     * @param {any} folderprmsTable Table containing file parameters
     * @param {String} prmsTable Table containing the parameters
     * @param {Callback} cb Callback function
     * @returns {CallbackFunction} Function taking a standard callback as the only argument.
     */
    hdiMake: function (schema, deployTable, undeployTable, folderprmsTable, prmsTable, cb) {
      return callproc1(`CALL ${identifier(`${schema}#DI`)}.MAKE(${[deployTable, undeployTable, folderprmsTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, null, cb);
    },

    hdiPrintResult: printResult,

    hdiCheckResult: checkResult,

    printMessages: printMessages,

    /**
     * Revoke a role.
     *
     * @param {any} role Role to revoke.
     * @param {any} grantee Whom to revoke from.
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    revokeRole: function (role, grantee) {
      return execute(`REVOKE ${identifier(role)} FROM ${identifier(grantee)}`);
    },
    /**
     * Revoke multiple roles.
     *
     * @param {any} roles Roles to revoke.
     * @param {any} grantee Whom to revoke from.
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    revokeRoles: function (roles, grantee) {
      const sql = `REVOKE ${roles.map(identifier).join(',')} FROM ${identifier(grantee)}`;
      return execute(sql);
    },
    /**
     * Revoke multiple schema roles.
     *
     * @param {String} schema Schema to revoke from.
     * @param {any} roles Roles to revoke.
     * @param {any} grantee Whom to revoke from.
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    revokeSchemaRoles: function (schema, roles, grantee) {
      const sql = `REVOKE ${roles.map(function (role) {
        return `${identifier(schema)}.${identifier(role)}`;
      }).join(',')} FROM ${identifier(grantee)}`;
      return execute(sql);
    },
    /**
     * Revoke system privileges.
     *
     * @param {any} privileges Privileges to revoke.
     * @param {any} grantee Whom to revoke from.
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    revokeSystemPrivileges: function (privileges, grantee) {
      const sql = `REVOKE ${privileges.map(dot_quoted_identifier).join(',')} FROM ${identifier(grantee)}`;
      return execute(sql);
    },
    /**
     * Revoke schema privileges.
     *
     * @param {any} privileges Privileges to revoke.
     * @param {String} schema Schema to revoke from.
     * @param {any} grantee Whom to revoke from.
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    revokeSchemaPrivileges: function (privileges, schema, grantee) {
      const sql = `REVOKE ${privileges.map(identifier).join(',')} ON SCHEMA ${identifier(schema)} FROM ${identifier(grantee)}`;
      return execute(sql);
    },
    /**
     * Revoke object privileges.
     *
     * @param {any} privileges Privileges to revoke.
     * @param {String} schema Schema to revoke from.
     * @param {String} obj Object to revoke from.
     * @param {any} grantee Whom to revoke from.
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    revokeObjectPrivileges: function (privileges, schema, obj, grantee) {
      const objName = schema ? [identifier(schema), identifier(obj)].join('.') : identifier(obj);
      const sql = `REVOKE ${privileges.map(identifier).join(',')} ON ${objName} FROM ${identifier(grantee)}`;
      return execute(sql);
    },
    /**
     * Revoke global object privileges.
     *
     * @param {any} privileges Privileges to revoke.
     * @param {String} obj Object to revoke from.
     * @param {String} type Type of object.
     * @param {any} grantee Whom to revoke from.
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    revokeGlobalObjectPrivileges: function (privileges, obj, type, grantee) {
      if (type !== 'REMOTE SOURCE') {
        throw new Error(`${obj} must be of type REMOTE SOURCE`);
      }

      const sql = `REVOKE ${privileges.map(identifier).join(',')} ON ${type} ${identifier(obj)} FROM ${identifier(grantee)}`;
      return execute(sql);
    },
    /**
     * Revoke Container Schema Privileges.
     *
     * @param {any} schema Container name.
     * @param {any} privTable Table containing the privileges.
     * @param {any} prmsTable Table containing parameters.
     * @param {any} cb Callback
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    hdiSysRevokeSchemaPrivileges: function (schema, privTable, prmsTable, cb) {
      return callproc1(`CALL _SYS_DI.REVOKE_CONTAINER_SCHEMA_PRIVILEGES(${['?', privTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, {
        CONTAINER_NAME: schema
      }, cb);
    },
    /**
     * Revoke Container Schema Roles.
     *
     * @param {any} schema Container name.
     * @param {any} rolesTable Table containing the roles.
     * @param {any} prmsTable Table containing parameters.
     * @param {any} cb Callback
     * @returns {CallbackFunction} Function expecting a callback for async chaining.
     */
    hdiRevokeSchemaRoles: function (schema, rolesTable, prmsTable, cb) {
      return callproc1(`CALL ${identifier(`${schema}#DI`)}.REVOKE_CONTAINER_SCHEMA_ROLES(${[rolesTable, prmsTable].concat(newArray(3, '?')).join(', ')})`, null, cb);
    }
  };
};
