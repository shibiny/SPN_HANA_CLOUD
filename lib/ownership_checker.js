'use strict';
// Use let to allow testing using rewire
// eslint-disable-next-line prefer-const
let hana_client = require('@sap/hana-client');
const {enrich_credentials_with_session_variables} = require('./client-info');
const {prepareCredentials} = require('./utils');
const logger = require('./logger');
const connections = require('./connections');

/**
 * Calls the callback function and logs the error.
 *
 * @param {any} error Error that occured
 * @param {any} callback Callback
 * @returns {undefined}
 */
function could_not_check_ownership (error, callback) {
  const m = error.message ? error.message : error;
  logger.log(`Could not check ownership of objects: ${m}`);
  callback();
}

/**
 * Check if ownership of the objects in the container is correct, should belong to #OO
 *
 * @param {any} options Options
 * @param {any} target_credentials credentials for the container
 * @param {any} callback Callback
 * @returns {Function} Return with callback
 */
function check_ownership (options, target_credentials, callback) {
  const hdiCreds = enrich_credentials_with_session_variables(prepareCredentials(target_credentials, options, logger));
  const client = hana_client.createConnection();
  connections.push({client, file: __filename});

  logger.logfnTimerInit('check-ownership', 'Checking ownership...')(() => {});

  client.connect(hdiCreds, (e) => {
    if (e) {
      return could_not_check_ownership(e, callback);
    }
    client.exec(`SELECT OBJECT_NAME, OBJECT_TYPE, PATH, OWNER_NAME FROM ${target_credentials.schema}#DI.M_OBJECTS WHERE PATH IS NOT NULL AND DEPENDENT_OBJECT_NAME IS NULL AND CONTAINER_NAME = '${target_credentials.schema}' AND OWNER_NAME != '${target_credentials.schema}#OO'`, (err, r) => {
      client.disconnect();

      if (err) {
        return could_not_check_ownership(err, callback);
      }

      if (r.length > 0) {
        logger.log('Ownership check found the following issues:');
        const messages = r.map(({OBJECT_NAME, OBJECT_TYPE, PATH, OWNER_NAME}) => {
          return ` ${PATH}: Object '${OBJECT_NAME}' of type '${OBJECT_TYPE}' owned by '${OWNER_NAME}'.`;
        });
        messages.forEach(m => logger.log(m));
        return callback(new Error(`Some objects in the container have the wrong owner! Found instances: ${r.length}`));
      }
      logger.logfnTimerDelta('check-ownership', 'Checking ownership... ok')(() => {});
      return callback();
    });
  });
}

module.exports = check_ownership;
